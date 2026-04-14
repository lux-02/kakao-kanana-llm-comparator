"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Lock,
  Plus,
  Settings,
  X,
} from "lucide-react";
import {
  PROVIDERS,
  getModel,
  type ProviderId,
} from "@/components/comparator/comparator-data";
import { runComparatorRequest } from "@/lib/comparator/client";
import type { ComparatorRunRequest } from "@/lib/comparator/contracts";
import {
  EMPTY_PROVIDER_KEYS,
  readSessionProviderKeys,
  writeSessionProviderKeys,
} from "@/lib/provider-key-session";
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowRunRequest,
} from "@/components/workflow/workflow-types";

const PROVIDER_ORDER: ProviderId[] = ["kanana", "openai", "gemini", "claude"];
const INITIAL_KEYS: Record<ProviderId, string> = EMPTY_PROVIDER_KEYS;
const INITIAL_KEY_VISIBILITY: Record<ProviderId, boolean> = {
  kanana: false,
  openai: false,
  gemini: false,
  claude: false,
};

type WorkflowModalState =
  | { kind: "settings" }
  | { kind: "key"; provider: ProviderId }
  | null;

type NodeOutcome = {
  status: WorkflowNodeStatus;
  output: string;
  error?: string | null;
};

function createWorkflowModelNode(
  order: number,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id: `wf-node-${crypto.randomUUID().slice(0, 8)}`,
    kind: "model",
    parentIds: [],
    childIds: [],
    provider: "kanana",
    modelId: "kanana-o",
    systemPrompt: "",
    status: "idle",
    output: "",
    error: null,
    order,
    ...overrides,
  };
}

function createWorkflowMergeNode(
  order: number,
  parentIds: string[],
): WorkflowNode {
  return {
    id: `wf-merge-${crypto.randomUUID().slice(0, 8)}`,
    kind: "merge",
    parentIds,
    childIds: [],
    provider: "kanana",
    modelId: "kanana-o",
    systemPrompt: "",
    status: "idle",
    output: "",
    error: null,
    order,
  };
}

function createInitialWorkflowGraph(): WorkflowGraph {
  const firstNode = createWorkflowModelNode(0);
  return {
    rootPrompt: "",
    nodes: [firstNode],
    edges: [],
    selectedNodeId: firstNode.id,
  };
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph);
}

function getWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
): WorkflowNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

function getNextOrder(graph: WorkflowGraph): number {
  return graph.nodes.reduce((max, node) => Math.max(max, node.order), 0) + 1;
}

function sortNodeIds(graph: WorkflowGraph, nodeIds: string[]): string[] {
  return [...nodeIds].sort((leftId, rightId) => {
    const left = getWorkflowNode(graph, leftId);
    const right = getWorkflowNode(graph, rightId);
    const leftRank =
      left?.branchSlot === "secondary"
        ? 1
        : left?.branchSlot === "primary"
          ? 0
          : 0;
    const rightRank =
      right?.branchSlot === "secondary"
        ? 1
        : right?.branchSlot === "primary"
          ? 0
          : 0;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return (left?.order ?? 0) - (right?.order ?? 0);
  });
}

function getWorkflowStatusLabel(status: WorkflowNodeStatus): string {
  const labels: Record<WorkflowNodeStatus, string> = {
    idle: "대기",
    queued: "준비 중",
    running: "실행 중",
    completed: "완료",
    error: "오류",
    blocked: "차단됨",
    "missing-key": "API Key 필요",
  };

  return labels[status];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPreview(node: WorkflowNode): string {
  const text = node.output || node.error || "";
  if (!text) {
    return node.kind === "merge"
      ? "브랜치를 합치는 노드"
      : "결과를 아직 받지 않았습니다.";
  }

  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function traceBranchLane(graph: WorkflowGraph, startId: string): string[] {
  const lane: string[] = [];
  let currentId: string | null = startId;

  while (currentId) {
    const currentNode = getWorkflowNode(graph, currentId);
    if (!currentNode) {
      break;
    }

    lane.push(currentId);

    if (currentNode.childIds.length !== 1) {
      break;
    }

    const nextId = currentNode.childIds[0];
    const nextNode = getWorkflowNode(graph, nextId);

    if (!nextNode || nextNode.kind === "merge") {
      break;
    }

    currentId = nextId;
  }

  return lane;
}

function getSharedMergeId(
  graph: WorkflowGraph,
  splitNodeId: string,
): string | null {
  const splitNode = getWorkflowNode(graph, splitNodeId);
  if (!splitNode || splitNode.childIds.length !== 2) {
    return null;
  }

  const [firstChildId, secondChildId] = sortNodeIds(graph, splitNode.childIds);
  const firstLane = traceBranchLane(graph, firstChildId);
  const secondLane = traceBranchLane(graph, secondChildId);
  const firstLeaf = getWorkflowNode(graph, firstLane.at(-1) ?? "");
  const secondLeaf = getWorkflowNode(graph, secondLane.at(-1) ?? "");

  if (!firstLeaf || !secondLeaf) {
    return null;
  }

  if (
    firstLeaf.childIds.length === 1 &&
    secondLeaf.childIds.length === 1 &&
    firstLeaf.childIds[0] === secondLeaf.childIds[0]
  ) {
    const mergeNode = getWorkflowNode(graph, firstLeaf.childIds[0]);
    return mergeNode?.kind === "merge" ? mergeNode.id : null;
  }

  return null;
}

function findOpenSplitNode(graph: WorkflowGraph): WorkflowNode | null {
  return (
    graph.nodes.find(
      (node) => node.childIds.length === 2 && !getSharedMergeId(graph, node.id),
    ) ?? null
  );
}

function getRootNodeIds(graph: WorkflowGraph): string[] {
  return sortNodeIds(
    graph,
    graph.nodes
      .filter((node) => node.parentIds.length === 0)
      .map((node) => node.id),
  );
}

export function WorkflowApp() {
  const [graph, setGraph] = useState<WorkflowGraph>(createInitialWorkflowGraph);
  const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
  const [stream, setStream] = useState(true);
  const [temperature, setTemperature] = useState("0.8");
  const [maxTokens, setMaxTokens] = useState("768");
  const [settingsDraft, setSettingsDraft] = useState({
    stream: true,
    temperature: "0.8",
    maxTokens: "768",
  });
  const [settingsKeyDraft, setSettingsKeyDraft] =
    useState<Record<ProviderId, string>>(INITIAL_KEYS);
  const [keys, setKeys] = useState<Record<ProviderId, string>>(INITIAL_KEYS);
  const [hasLoadedSessionKeys, setHasLoadedSessionKeys] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [settingsKeyVisibility, setSettingsKeyVisibility] = useState<
    Record<ProviderId, boolean>
  >(INITIAL_KEY_VISIBILITY);
  const [showKeyDraft, setShowKeyDraft] = useState(false);
  const [modalState, setModalState] = useState<WorkflowModalState>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    const restoredKeys = readSessionProviderKeys();
    setKeys(restoredKeys);
    setSettingsKeyDraft(restoredKeys);
    setHasLoadedSessionKeys(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSessionKeys) {
      return;
    }

    writeSessionProviderKeys(keys);
  }, [keys, hasLoadedSessionKeys]);

  useEffect(() => {
    if (!modalState) {
      document.body.classList.remove("modal-open");
      return;
    }

    document.body.classList.add("modal-open");
    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [modalState]);

  useEffect(() => {
    if (!toastVisible) {
      return;
    }

    const timer = window.setTimeout(() => setToastVisible(false), 1800);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  const selectedNode = useMemo(
    () =>
      graph.selectedNodeId
        ? getWorkflowNode(graph, graph.selectedNodeId)
        : null,
    [graph],
  );

  function pushToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
  }

  function closeModal() {
    setModalState(null);
  }

  function openSettingsModal() {
    if (isWorkflowRunning) {
      return;
    }

    setSettingsDraft({
      stream,
      temperature,
      maxTokens,
    });
    setSettingsKeyDraft({ ...keys });
    setSettingsKeyVisibility(INITIAL_KEY_VISIBILITY);
    setModalState({ kind: "settings" });
  }

  function openKeyModal(provider: ProviderId) {
    if (isWorkflowRunning) {
      return;
    }

    setKeyDraft(keys[provider]);
    setShowKeyDraft(false);
    setModalState({ kind: "key", provider });
  }

  function setSelectedNode(nodeId: string) {
    setGraph((prev) => ({
      ...prev,
      selectedNodeId: nodeId,
    }));
  }

  function applyKeys(nextKeys: Record<ProviderId, string>) {
    if (isWorkflowRunning) {
      return;
    }

    setKeys(nextKeys);
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        nextKeys[node.provider].trim() && node.status === "missing-key"
          ? { ...node, status: "idle", error: null }
          : node,
      ),
    }));
  }

  function applySettings() {
    if (isWorkflowRunning) {
      return;
    }

    setStream(settingsDraft.stream);
    setTemperature(settingsDraft.temperature);
    setMaxTokens(settingsDraft.maxTokens);
    applyKeys({
      kanana: settingsKeyDraft.kanana.trim(),
      openai: settingsKeyDraft.openai.trim(),
      gemini: settingsKeyDraft.gemini.trim(),
      claude: settingsKeyDraft.claude.trim(),
    });
    closeModal();
  }

  function saveProviderKey() {
    if (isWorkflowRunning || !modalState || modalState.kind !== "key") {
      return;
    }

    applyKeys({
      ...keys,
      [modalState.provider]: keyDraft.trim(),
    });
    closeModal();
  }

  function clearProviderKey() {
    if (isWorkflowRunning || !modalState || modalState.kind !== "key") {
      return;
    }

    applyKeys({
      ...keys,
      [modalState.provider]: "",
    });
    setKeyDraft("");
    closeModal();
  }

  function updateNode(
    nodeId: string,
    updater: (node: WorkflowNode) => WorkflowNode,
  ) {
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        node.id === nodeId ? updater(node) : node,
      ),
    }));
  }

  function appendNodeOutput(nodeId: string, textDelta: string) {
    updateNode(nodeId, (node) => ({
      ...node,
      output: `${node.output}${textDelta}`,
    }));
  }

  function handleRootPromptChange(value: string) {
    if (isWorkflowRunning) {
      return;
    }

    setGraph((prev) => ({
      ...prev,
      rootPrompt: value,
    }));
  }

  function handleChangeSelectedProvider(provider: ProviderId) {
    if (isWorkflowRunning || !selectedNode || selectedNode.kind !== "model") {
      return;
    }

    const nextModel = PROVIDERS[provider].models[0];
    updateNode(selectedNode.id, (node) => ({
      ...node,
      provider,
      modelId: nextModel.id,
    }));
  }

  function handleChangeSelectedModel(modelId: string) {
    if (isWorkflowRunning || !selectedNode || selectedNode.kind !== "model") {
      return;
    }

    updateNode(selectedNode.id, (node) => ({
      ...node,
      modelId,
    }));
  }

  function handleChangeSystemPrompt(value: string) {
    if (isWorkflowRunning || !selectedNode || selectedNode.kind !== "model") {
      return;
    }

    updateNode(selectedNode.id, (node) => ({
      ...node,
      systemPrompt: value,
    }));
  }

  function handleAddBelow(nodeId: string) {
    if (isWorkflowRunning) {
      return;
    }

    const node = getWorkflowNode(graph, nodeId);
    if (!node) {
      return;
    }

    if (node.childIds.length > 1) {
      pushToast("분기 노드 아래에는 바로 추가할 수 없습니다.");
      return;
    }

    const next = cloneGraph(graph);
    const nextNode = getWorkflowNode(next, nodeId);
    if (!nextNode) {
      return;
    }

    const newNode = createWorkflowModelNode(getNextOrder(next), {
      parentIds: [nodeId],
      branchSlot: nextNode.branchSlot,
    });

    next.nodes.push(newNode);

    if (nextNode.childIds.length === 0) {
      nextNode.childIds = [newNode.id];
      next.edges.push({ from: nodeId, to: newNode.id });
    } else {
      const childId = nextNode.childIds[0];
      const childNode = getWorkflowNode(next, childId);
      if (!childNode) {
        return;
      }

      nextNode.childIds = [newNode.id];
      childNode.parentIds = childNode.parentIds.map((parentId) =>
        parentId === nodeId ? newNode.id : parentId,
      );
      newNode.childIds = [childId];
      next.edges = next.edges
        .filter((edge) => !(edge.from === nodeId && edge.to === childId))
        .concat(
          { from: nodeId, to: newNode.id },
          { from: newNode.id, to: childId },
        );
    }

    next.selectedNodeId = newNode.id;
    setGraph(next);
  }

  function handleAddAbove(nodeId: string) {
    if (isWorkflowRunning) {
      return;
    }

    const node = getWorkflowNode(graph, nodeId);
    if (!node) {
      return;
    }

    if (node.parentIds.length > 1) {
      pushToast("합류 노드 위에는 직접 추가할 수 없습니다.");
      return;
    }

    const next = cloneGraph(graph);
    const nextNode = getWorkflowNode(next, nodeId);
    if (!nextNode) {
      return;
    }

    const newNode = createWorkflowModelNode(getNextOrder(next), {
      childIds: [nodeId],
      branchSlot: nextNode.branchSlot,
    });

    if (nextNode.parentIds.length === 0) {
      nextNode.parentIds = [newNode.id];
    } else {
      const parentId = nextNode.parentIds[0];
      const parentNode = getWorkflowNode(next, parentId);
      if (!parentNode) {
        return;
      }

      parentNode.childIds = parentNode.childIds.map((childId) =>
        childId === nodeId ? newNode.id : childId,
      );
      newNode.parentIds = [parentId];
      nextNode.parentIds = [newNode.id];
      next.edges = next.edges
        .filter((edge) => !(edge.from === parentId && edge.to === nodeId))
        .concat(
          { from: parentId, to: newNode.id },
          { from: newNode.id, to: nodeId },
        );
      next.nodes.push(newNode);
      next.selectedNodeId = newNode.id;
      setGraph(next);
      return;
    }

    next.edges.push({ from: newNode.id, to: nodeId });
    next.nodes.push(newNode);
    next.selectedNodeId = newNode.id;
    setGraph(next);
  }

  function handleAddBranch(nodeId: string) {
    if (isWorkflowRunning) {
      return;
    }

    const node = getWorkflowNode(graph, nodeId);
    if (!node || node.kind !== "model") {
      return;
    }

    if (node.childIds.length > 0) {
      pushToast("브랜치는 리프 노드에서만 추가할 수 있습니다.");
      return;
    }

    const openSplit = findOpenSplitNode(graph);
    if (openSplit) {
      pushToast("열린 분기를 먼저 합류하세요.");
      return;
    }

    const next = cloneGraph(graph);
    const nextNode = getWorkflowNode(next, nodeId);
    if (!nextNode) {
      return;
    }

    const primaryNode = createWorkflowModelNode(getNextOrder(next), {
      parentIds: [nodeId],
      branchSlot: "primary",
    });
    const secondaryNode = createWorkflowModelNode(getNextOrder(next) + 1, {
      parentIds: [nodeId],
      branchSlot: "secondary",
    });

    nextNode.childIds = [primaryNode.id, secondaryNode.id];
    next.nodes.push(primaryNode, secondaryNode);
    next.edges.push(
      { from: nodeId, to: primaryNode.id },
      { from: nodeId, to: secondaryNode.id },
    );
    next.selectedNodeId = primaryNode.id;
    setGraph(next);
  }

  function canDeleteNode(node: WorkflowNode): boolean {
    if (graph.nodes.length === 1) {
      return false;
    }

    if (node.kind === "merge") {
      return node.childIds.length === 0;
    }

    if (node.childIds.length > 1 || node.parentIds.length > 1) {
      return false;
    }

    const childNode =
      node.childIds.length === 1
        ? getWorkflowNode(graph, node.childIds[0])
        : null;
    const parentNode =
      node.parentIds.length === 1
        ? getWorkflowNode(graph, node.parentIds[0])
        : null;

    if (childNode?.kind === "merge") {
      return false;
    }

    return true;
  }

  function handleDeleteNode(nodeId: string) {
    if (isWorkflowRunning) {
      return;
    }

    const node = getWorkflowNode(graph, nodeId);
    if (!node) {
      return;
    }

    if (!canDeleteNode(node)) {
      pushToast("이 노드는 현재 구조에서 삭제할 수 없습니다.");
      return;
    }

    const next = cloneGraph(graph);
    const nextNode = getWorkflowNode(next, nodeId);
    if (!nextNode) {
      return;
    }

    const fallbackSelection =
      nextNode.parentIds[0] ??
      nextNode.childIds[0] ??
      next.nodes[0]?.id ??
      null;

    if (nextNode.kind === "merge") {
      nextNode.parentIds.forEach((parentId) => {
        const parentNode = getWorkflowNode(next, parentId);
        if (parentNode) {
          parentNode.childIds = parentNode.childIds.filter(
            (childId) => childId !== nodeId,
          );
        }
      });
      next.edges = next.edges.filter(
        (edge) => edge.to !== nodeId && edge.from !== nodeId,
      );
    } else if (
      nextNode.parentIds.length === 0 &&
      nextNode.childIds.length === 1
    ) {
      const childNode = getWorkflowNode(next, nextNode.childIds[0]);
      if (childNode) {
        childNode.parentIds = [];
      }
      next.edges = next.edges.filter(
        (edge) => edge.from !== nodeId && edge.to !== nodeId,
      );
    } else if (
      nextNode.parentIds.length === 1 &&
      nextNode.childIds.length === 1
    ) {
      const parentId = nextNode.parentIds[0];
      const childId = nextNode.childIds[0];
      const parentNode = getWorkflowNode(next, parentId);
      const childNode = getWorkflowNode(next, childId);
      if (parentNode && childNode) {
        parentNode.childIds = parentNode.childIds.map((candidateId) =>
          candidateId === nodeId ? childId : candidateId,
        );
        childNode.parentIds = childNode.parentIds.map((candidateId) =>
          candidateId === nodeId ? parentId : candidateId,
        );
        next.edges = next.edges
          .filter(
            (edge) =>
              !(edge.from === parentId && edge.to === nodeId) &&
              !(edge.from === nodeId && edge.to === childId),
          )
          .concat({ from: parentId, to: childId });
      }
    } else if (
      nextNode.parentIds.length === 1 &&
      nextNode.childIds.length === 0
    ) {
      const parentNode = getWorkflowNode(next, nextNode.parentIds[0]);
      if (parentNode) {
        parentNode.childIds = parentNode.childIds.filter(
          (childId) => childId !== nodeId,
        );
      }
      next.edges = next.edges.filter(
        (edge) => edge.to !== nodeId && edge.from !== nodeId,
      );
    } else {
      pushToast("이 노드는 현재 구조에서 삭제할 수 없습니다.");
      return;
    }

    next.nodes = next.nodes.filter((candidate) => candidate.id !== nodeId);
    next.selectedNodeId = fallbackSelection;
    setGraph(next);
  }

  function handleAddMerge(splitNodeId: string) {
    if (isWorkflowRunning) {
      return;
    }

    const splitNode = getWorkflowNode(graph, splitNodeId);
    if (!splitNode || splitNode.childIds.length !== 2) {
      return;
    }

    if (getSharedMergeId(graph, splitNodeId)) {
      pushToast("이미 합류 노드가 연결되어 있습니다.");
      return;
    }

    const [firstChildId, secondChildId] = sortNodeIds(
      graph,
      splitNode.childIds,
    );
    const firstLane = traceBranchLane(graph, firstChildId);
    const secondLane = traceBranchLane(graph, secondChildId);
    const firstLeaf = getWorkflowNode(graph, firstLane.at(-1) ?? "");
    const secondLeaf = getWorkflowNode(graph, secondLane.at(-1) ?? "");

    if (
      !firstLeaf ||
      !secondLeaf ||
      firstLeaf.childIds.length ||
      secondLeaf.childIds.length
    ) {
      pushToast("현재는 두 브랜치의 끝 노드에서만 합류할 수 있습니다.");
      return;
    }

    const next = cloneGraph(graph);
    const nextFirstLeaf = getWorkflowNode(next, firstLeaf.id);
    const nextSecondLeaf = getWorkflowNode(next, secondLeaf.id);
    if (!nextFirstLeaf || !nextSecondLeaf) {
      return;
    }

    const mergeNode = createWorkflowMergeNode(getNextOrder(next), [
      nextFirstLeaf.id,
      nextSecondLeaf.id,
    ]);
    nextFirstLeaf.childIds = [mergeNode.id];
    nextSecondLeaf.childIds = [mergeNode.id];
    next.nodes.push(mergeNode);
    next.edges.push(
      { from: nextFirstLeaf.id, to: mergeNode.id },
      { from: nextSecondLeaf.id, to: mergeNode.id },
    );
    next.selectedNodeId = mergeNode.id;
    setGraph(next);
  }

  function resetWorkflowNode(node: WorkflowNode): WorkflowNode {
    return {
      ...node,
      status: "idle",
      output: "",
      error: null,
    };
  }

  function setNodeStatus(
    nodeId: string,
    status: WorkflowNodeStatus,
    extras?: Partial<WorkflowNode>,
  ) {
    updateNode(nodeId, (node) => ({
      ...node,
      status,
      ...extras,
    }));
  }

  async function handleRunWorkflow(event?: FormEvent) {
    event?.preventDefault();

    if (isWorkflowRunning) {
      return;
    }

    if (!graph.rootPrompt.trim()) {
      pushToast("시작 프롬프트를 입력하세요.");
      return;
    }

    const runSnapshot: WorkflowRunRequest = {
      rootPrompt: graph.rootPrompt.trim(),
      graph: cloneGraph(graph),
      providerKeys: { ...keys },
      globalOptions: {
        stream,
        temperature: Number(temperature || 0.8),
        maxTokens: Number(maxTokens || 768),
      },
    };

    setIsWorkflowRunning(true);
    try {
      setGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => resetWorkflowNode(node)),
      }));

      const nodeExecutionCache = new Map<string, Promise<NodeOutcome>>();
      const subtreeExecutionCache = new Map<string, Promise<void>>();

      const executeNode = async (nodeId: string): Promise<NodeOutcome> => {
        const cached = nodeExecutionCache.get(nodeId);
        if (cached) {
          return cached;
        }

        const promise: Promise<NodeOutcome> =
          (async (): Promise<NodeOutcome> => {
            const node = getWorkflowNode(runSnapshot.graph, nodeId);
            if (!node) {
              return {
                status: "error",
                output: "",
                error: "노드를 찾을 수 없습니다.",
              };
            }

            if (node.kind === "merge") {
              setNodeStatus(nodeId, "queued");

              const parentResults = await Promise.all(
                node.parentIds.map(executeNode),
              );
              if (
                parentResults.some((result) => result.status !== "completed")
              ) {
                setNodeStatus(nodeId, "blocked", {
                  error: "브랜치 결과를 모두 확보하지 못했습니다.",
                });
                return {
                  status: "blocked",
                  output: "",
                  error: "브랜치 결과를 모두 확보하지 못했습니다.",
                };
              }

              setNodeStatus(nodeId, "running");
              const mergedOutput = [
                parentResults[0]?.output ?? "",
                "",
                parentResults[1]?.output ?? "",
              ].join("\n");

              setNodeStatus(nodeId, "completed", {
                output: mergedOutput,
                error: null,
              });

              return {
                status: "completed",
                output: mergedOutput,
              };
            }

            const apiKey = runSnapshot.providerKeys[node.provider].trim();
            if (!apiKey) {
              setNodeStatus(nodeId, "missing-key", {
                error: "API 키가 필요합니다.",
              });
              return {
                status: "missing-key",
                output: "",
                error: "API 키가 필요합니다.",
              };
            }

            let prompt = runSnapshot.rootPrompt;

            if (node.parentIds.length === 1) {
              const [parentResult] = await Promise.all(
                node.parentIds.map(executeNode),
              );
              if (parentResult.status !== "completed") {
                setNodeStatus(nodeId, "blocked", {
                  error: "부모 노드 실행이 완료되지 않았습니다.",
                });
                return {
                  status: "blocked",
                  output: "",
                  error: "부모 노드 실행이 완료되지 않았습니다.",
                };
              }

              prompt = parentResult.output;
            }

            if (!prompt.trim()) {
              setNodeStatus(nodeId, "blocked", {
                error: "입력 프롬프트가 비어 있습니다.",
              });
              return {
                status: "blocked",
                output: "",
                error: "입력 프롬프트가 비어 있습니다.",
              };
            }

            const requestBody: ComparatorRunRequest = {
              runId: `workflow-${Date.now()}-${nodeId}`,
              cardId: nodeId,
              provider: node.provider,
              model: node.modelId,
              apiKey,
              prompt,
              systemPrompt: node.systemPrompt.trim() || null,
              options: {
                stream: runSnapshot.globalOptions.stream,
                temperature: runSnapshot.globalOptions.temperature,
                maxTokens: runSnapshot.globalOptions.maxTokens,
              },
            };

            setNodeStatus(nodeId, "queued", {
              output: "",
              error: null,
            });

            let latestOutput = "";

            try {
              for await (const event of runComparatorRequest(requestBody)) {
                if (event.type === "start") {
                  setNodeStatus(nodeId, "running");
                  continue;
                }

                if (event.type === "delta") {
                  latestOutput += event.textDelta;
                  appendNodeOutput(nodeId, event.textDelta);
                  continue;
                }

                if (event.type === "complete") {
                  const finalOutput = event.outputText || latestOutput;
                  setNodeStatus(nodeId, "completed", {
                    output: finalOutput,
                    error: null,
                  });

                  return {
                    status: "completed",
                    output: finalOutput,
                  };
                }

                if (event.type === "error") {
                  setNodeStatus(nodeId, "error", {
                    error: event.error.message,
                    output: "",
                  });
                  return {
                    status: "error",
                    output: "",
                    error: event.error.message,
                  };
                }
              }
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "알 수 없는 오류가 발생했습니다.";
              setNodeStatus(nodeId, "error", {
                error: message,
                output: "",
              });
              return {
                status: "error",
                output: "",
                error: message,
              };
            }

            setNodeStatus(nodeId, "error", {
              error: "응답이 비어 있습니다.",
            });
            return {
              status: "error",
              output: "",
              error: "응답이 비어 있습니다.",
            };
          })();

        nodeExecutionCache.set(nodeId, promise);
        return promise;
      };

      const executeSubtree = async (nodeId: string): Promise<void> => {
        const cached = subtreeExecutionCache.get(nodeId);
        if (cached) {
          return cached;
        }

        const promise = (async () => {
          const result = await executeNode(nodeId);
          if (result.status !== "completed") {
            return;
          }

          const node = getWorkflowNode(runSnapshot.graph, nodeId);
          if (!node || !node.childIds.length) {
            return;
          }

          await Promise.all(node.childIds.map(executeSubtree));
        })();

        subtreeExecutionCache.set(nodeId, promise);
        return promise;
      };

      const rootNodeIds = getRootNodeIds(runSnapshot.graph);
      await Promise.all(rootNodeIds.map(executeSubtree));
      pushToast("워크플로우 실행이 끝났습니다.");
    } finally {
      setIsWorkflowRunning(false);
    }
  }

  function renderNodeControls(node: WorkflowNode) {
    const branchDisabled =
      isWorkflowRunning ||
      node.kind !== "model" ||
      node.childIds.length > 0 ||
      Boolean(findOpenSplitNode(graph));

    return (
      <>
        <button
          className="ghost icon-button workflow-socket workflow-socket-top"
          type="button"
          aria-label="위에 노드 추가"
          onClick={(event) => {
            event.stopPropagation();
            handleAddAbove(node.id);
          }}
          disabled={isWorkflowRunning || node.parentIds.length > 1}
        >
          <span className="workflow-socket-stack" aria-hidden="true">
            <Plus size={10} />
            <ArrowUp size={15} />
          </span>
        </button>

        <button
          className="ghost icon-button workflow-socket workflow-socket-bottom"
          type="button"
          aria-label="아래에 노드 추가"
          onClick={(event) => {
            event.stopPropagation();
            handleAddBelow(node.id);
          }}
          disabled={isWorkflowRunning || node.childIds.length > 1}
        >
          <span className="workflow-socket-stack" aria-hidden="true">
            <Plus size={10} />
            <ArrowDown size={15} />
          </span>
        </button>

        {node.kind === "model" ? (
          <button
            className="ghost icon-button workflow-branch-socket"
            type="button"
            aria-label="분기 추가"
            onClick={(event) => {
              event.stopPropagation();
              handleAddBranch(node.id);
            }}
            disabled={branchDisabled}
          >
            <span className="workflow-branch-stack" aria-hidden="true">
              <GitBranch size={15} />
              <Plus size={10} />
            </span>
          </button>
        ) : null}

        <button
          className="ghost icon-button workflow-delete-button"
          type="button"
          aria-label="노드 삭제"
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteNode(node.id);
          }}
          disabled={isWorkflowRunning || !canDeleteNode(node)}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </>
    );
  }

  function renderWorkflowCard(nodeId: string) {
    const node = getWorkflowNode(graph, nodeId);
    if (!node) {
      return null;
    }

    const isSelected = graph.selectedNodeId === node.id && !isWorkflowRunning;
    const isExecuting = node.status === "queued" || node.status === "running";
    if (node.kind === "merge") {
      return (
        <div
          key={node.id}
          className={`workflow-node-shell${isExecuting ? " running-focus-shell" : ""}`}
        >
          {renderNodeControls(node)}
          <article
            className={`model-card workflow-model-card workflow-merge-card${isSelected ? " selected" : ""}${isExecuting ? " running-focus" : ""}${isWorkflowRunning ? " locked" : ""}`}
            onClick={() => setSelectedNode(node.id)}
          >
            <div className="model-card-inner workflow-merge-inner">
              <div className="workflow-merge-head">
                <strong>Merge</strong>
                <span className={`status-pill status-${node.status}`}>
                  {getWorkflowStatusLabel(node.status)}
                </span>
              </div>

              <p className="workflow-merge-copy">
                Branch A와 Branch B 결과를 순서대로 합쳐 다음 노드에 전달합니다.
              </p>
            </div>
          </article>
        </div>
      );
    }

    const provider = PROVIDERS[node.provider];
    const model = getModel(node.provider, node.modelId);
    const displayStatus =
      !keys[node.provider].trim() && node.status === "idle"
        ? "missing-key"
        : node.status;

    return (
      <div
        key={node.id}
        className={`workflow-node-shell${isExecuting ? " running-focus-shell" : ""}`}
      >
        {renderNodeControls(node)}
        <article
          className={`model-card workflow-model-card provider-${node.provider}${isSelected ? " selected" : ""}${isExecuting ? " running-focus" : ""}${isWorkflowRunning ? " locked" : ""}`}
          onClick={() => setSelectedNode(node.id)}
        >
          <div className="model-card-inner">
            <div className="card-top">
              <div className="card-heading">
                <div className="card-heading-line">
                  <span className={`provider-mark provider-${node.provider}`}>
                    <img src={provider.mark} alt="" aria-hidden="true" />
                  </span>
                  <h3>{model?.label ?? node.modelId}</h3>
                </div>
              </div>
            </div>

            <div className="card-meta-row">
              <span className={`status-pill status-${displayStatus}`}>
                {getWorkflowStatusLabel(displayStatus)}
              </span>
            </div>

            <div className="card-output workflow-card-output">
              <p>{buildPreview(node)}</p>
            </div>
          </div>
        </article>
      </div>
    );
  }

  function renderStartNode() {
    return (
      <div className="workflow-flow-node">
        <div className="workflow-node-shell workflow-start-shell">
          <article
            className={`model-card workflow-model-card workflow-start-card${isWorkflowRunning ? " locked" : ""}`}
          >
            <div className="model-card-inner workflow-start-inner">
              <div className="workflow-start-head">
                <div className="card-heading-line">
                  <span className="fixed-tag">시작</span>
                </div>
                <button
                  className="ghost icon-button prompt-settings-button"
                  type="button"
                  aria-label="고급 설정"
                  onClick={openSettingsModal}
                  disabled={isWorkflowRunning}
                >
                  <Settings
                    size={18}
                    className="prompt-settings-icon"
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="field field-large workflow-start-input-shell">
                <textarea
                  rows={6}
                  value={graph.rootPrompt}
                  onChange={(event) =>
                    handleRootPromptChange(event.target.value)
                  }
                  placeholder="워크플로우의 시작 프롬프트를 입력하세요"
                  disabled={isWorkflowRunning}
                />
              </div>

              <button
                className="primary full-width"
                type="button"
                onClick={() => void handleRunWorkflow()}
                disabled={isWorkflowRunning}
              >
                {isWorkflowRunning ? "실행 중" : "전체 실행"}
              </button>
            </div>
          </article>
        </div>
        <div className="workflow-connector-line" aria-hidden="true" />
      </div>
    );
  }

  function renderNodeFlow(nodeId: string): ReactElement | null {
    const node = getWorkflowNode(graph, nodeId);
    if (!node) {
      return null;
    }

    const children = sortNodeIds(graph, node.childIds);

    if (children.length === 0) {
      return (
        <div className="workflow-flow-node">{renderWorkflowCard(nodeId)}</div>
      );
    }

    if (children.length === 1) {
      return (
        <div className="workflow-flow-node">
          {renderWorkflowCard(nodeId)}
          <div className="workflow-connector-line" aria-hidden="true" />
          {renderNodeFlow(children[0])}
        </div>
      );
    }

    const [primaryId, secondaryId] = children;
    const primaryLane = traceBranchLane(graph, primaryId);
    const secondaryLane = traceBranchLane(graph, secondaryId);
    const mergeId = getSharedMergeId(graph, nodeId);

    return (
      <div className="workflow-flow-node">
        {renderWorkflowCard(nodeId)}
        <div className="workflow-branch-wrap">
          <div className="workflow-branch-divider" aria-hidden="true" />
          <div className="workflow-branch-lanes">
            <div className="workflow-branch-lane">
              {primaryLane.map((branchNodeId) => (
                <div key={branchNodeId} className="workflow-branch-node">
                  {renderWorkflowCard(branchNodeId)}
                </div>
              ))}
            </div>
            <div className="workflow-branch-lane">
              {secondaryLane.map((branchNodeId) => (
                <div key={branchNodeId} className="workflow-branch-node">
                  {renderWorkflowCard(branchNodeId)}
                </div>
              ))}
            </div>
          </div>

          {mergeId ? (
            <div className="workflow-merge-wrap">
              <div className="workflow-merge-divider" aria-hidden="true" />
              {renderNodeFlow(mergeId)}
            </div>
          ) : (
            <div className="workflow-merge-cta">
              <button
                className="ghost small"
                type="button"
                onClick={() => handleAddMerge(nodeId)}
                disabled={isWorkflowRunning}
              >
                합류 노드 추가
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const rootNodes = getRootNodeIds(graph);

  return (
    <>
      <section className="workflow-layout">
        <section className="board-panel compact-board-panel workflow-board-panel">
          <div className="workflow-board-shell">
            {renderStartNode()}
            {rootNodes.map((rootNodeId) => (
              <div key={rootNodeId}>{renderNodeFlow(rootNodeId)}</div>
            ))}
          </div>
        </section>

        <aside className="panel workflow-detail-panel">
          {selectedNode ? (
            <>
              <div className="workflow-detail-head">
                <div>
                  <h2>
                    {selectedNode.kind === "merge" ? "Merge 노드" : "노드 설정"}
                  </h2>
                  <p className="microcopy">
                    {selectedNode.kind === "merge"
                      ? "두 브랜치 결과를 하나로 합칩니다."
                      : "선택한 노드의 모델과 시스템 프롬프트를 수정합니다."}
                  </p>
                </div>
                <span className={`status-pill status-${selectedNode.status}`}>
                  {getWorkflowStatusLabel(selectedNode.status)}
                </span>
              </div>

              {selectedNode.kind === "model" ? (
                <div className="workflow-detail-fields">
                  <label className="field">
                    <span>Provider</span>
                    <select
                      value={selectedNode.provider}
                      onChange={(event) =>
                        handleChangeSelectedProvider(
                          event.target.value as ProviderId,
                        )
                      }
                      disabled={isWorkflowRunning}
                    >
                      {PROVIDER_ORDER.map((providerId) => (
                        <option key={providerId} value={providerId}>
                          {PROVIDERS[providerId].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Model</span>
                    <select
                      value={selectedNode.modelId}
                      onChange={(event) =>
                        handleChangeSelectedModel(event.target.value)
                      }
                      disabled={isWorkflowRunning}
                    >
                      {PROVIDERS[selectedNode.provider].models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!keys[selectedNode.provider].trim() ? (
                    <div className="key-cta-panel key-cta-inline">
                      <div className="key-cta-inline-copy">
                        <span className="key-cta-inline-badge">
                          <Lock size={14} aria-hidden="true" />
                          API 키 필요
                        </span>
                        <p className="key-cta-copy">
                          {PROVIDERS[selectedNode.provider].label} API 키를 먼저
                          입력해야 이 노드를 실행할 수 있습니다.
                        </p>
                      </div>
                      <button
                        className="ghost small button-with-icon"
                        type="button"
                        onClick={() => openKeyModal(selectedNode.provider)}
                        disabled={isWorkflowRunning}
                      >
                        API 키 입력
                      </button>
                    </div>
                  ) : null}

                  <label className="field">
                    <span>System Prompt</span>
                    <textarea
                      rows={5}
                      value={selectedNode.systemPrompt}
                      onChange={(event) =>
                        handleChangeSystemPrompt(event.target.value)
                      }
                      placeholder="이 노드에만 적용할 시스템 프롬프트를 입력하세요"
                      disabled={isWorkflowRunning}
                    />
                  </label>
                </div>
              ) : (
                <div className="workflow-merge-note">
                  <p className="microcopy">
                    이 노드는 Branch A와 Branch B 순서로 결과를 합친 뒤 다음
                    노드 입력으로 전달합니다.
                  </p>
                </div>
              )}

              <div className="workflow-detail-output">
                <div className="workflow-detail-output-head">
                  <strong>결과</strong>
                  <button
                    className="ghost small button-with-icon"
                    type="button"
                    onClick={() =>
                      selectedNode.output
                        ? void navigator.clipboard.writeText(
                            selectedNode.output,
                          )
                        : undefined
                    }
                    disabled={!selectedNode.output}
                  >
                    <Copy size={15} aria-hidden="true" />
                    복사
                  </button>
                </div>

                {selectedNode.output ? (
                  <pre
                    dangerouslySetInnerHTML={{
                      __html: escapeHtml(selectedNode.output),
                    }}
                  />
                ) : (
                  <div className="placeholder-copy">
                    실행하면 선택한 노드의 결과가 여기에 표시됩니다.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </aside>
      </section>

      {modalState ? (
        <div className="modal">
          <div className="modal-backdrop" onClick={closeModal}></div>
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflowModalTitle"
          >
            {modalState.kind === "settings" ? (
              <>
                <div className="mini-head modal-head">
                  <h2 id="workflowModalTitle">고급 설정</h2>
                </div>

                <div className="settings-section">
                  <div className="settings-grid">
                    <div className="settings-row">
                      <span>Streaming</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={settingsDraft.stream}
                          disabled={isWorkflowRunning}
                          onChange={(event) =>
                            setSettingsDraft((prev) => ({
                              ...prev,
                              stream: event.target.checked,
                            }))
                          }
                        />
                        <span className="switch-track"></span>
                      </label>
                    </div>

                    <label className="field">
                      <span>Temperature</span>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={settingsDraft.temperature}
                        disabled={isWorkflowRunning}
                        onChange={(event) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            temperature: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Max Token</span>
                      <input
                        type="number"
                        min="64"
                        max="4096"
                        step="64"
                        value={settingsDraft.maxTokens}
                        disabled={isWorkflowRunning}
                        onChange={(event) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            maxTokens: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-grid key-settings-grid">
                    {PROVIDER_ORDER.map((providerId) => (
                      <div
                        key={providerId}
                        className="field provider-key-field"
                      >
                        <span className="provider-key-label">
                          <span
                            className={`provider-mark provider-mark-small provider-${providerId}`}
                          >
                            <img
                              src={PROVIDERS[providerId].mark}
                              alt=""
                              aria-hidden="true"
                            />
                          </span>
                          <span>{PROVIDERS[providerId].label}</span>
                        </span>

                        <div className="provider-key-input-row">
                          <input
                            type={
                              settingsKeyVisibility[providerId]
                                ? "text"
                                : "password"
                            }
                            autoComplete="off"
                            placeholder={`${PROVIDERS[providerId].label} API 키`}
                            value={settingsKeyDraft[providerId]}
                            disabled={isWorkflowRunning}
                            onChange={(event) =>
                              setSettingsKeyDraft((prev) => ({
                                ...prev,
                                [providerId]: event.target.value,
                              }))
                            }
                          />
                          <button
                            className="ghost icon-button key-visibility-toggle"
                            type="button"
                            disabled={isWorkflowRunning}
                            aria-label={
                              settingsKeyVisibility[providerId]
                                ? `${PROVIDERS[providerId].label} API 키 숨기기`
                                : `${PROVIDERS[providerId].label} API 키 보기`
                            }
                            onClick={() =>
                              setSettingsKeyVisibility((prev) => ({
                                ...prev,
                                [providerId]: !prev[providerId],
                              }))
                            }
                          >
                            {settingsKeyVisibility[providerId] ? (
                              <EyeOff size={16} aria-hidden="true" />
                            ) : (
                              <Eye size={16} aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    className="primary"
                    type="button"
                    onClick={applySettings}
                    disabled={isWorkflowRunning}
                  >
                    적용
                  </button>
                </div>
              </>
            ) : null}

            {modalState.kind === "key" ? (
              <>
                <div className="settings-grid">
                  <label className="field">
                    <div className="provider-key-input-row">
                      <input
                        type={showKeyDraft ? "text" : "password"}
                        autoComplete="off"
                        placeholder={`${PROVIDERS[modalState.provider].label} API 키를 입력하세요`}
                        value={keyDraft}
                        disabled={isWorkflowRunning}
                        onChange={(event) => setKeyDraft(event.target.value)}
                      />
                      <button
                        className="ghost icon-button key-visibility-toggle"
                        type="button"
                        disabled={isWorkflowRunning}
                        aria-label={
                          showKeyDraft
                            ? `${PROVIDERS[modalState.provider].label} API 키 숨기기`
                            : `${PROVIDERS[modalState.provider].label} API 키 보기`
                        }
                        onClick={() => setShowKeyDraft((prev) => !prev)}
                      >
                        {showKeyDraft ? (
                          <EyeOff size={16} aria-hidden="true" />
                        ) : (
                          <Eye size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="modal-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={clearProviderKey}
                    disabled={isWorkflowRunning}
                  >
                    삭제
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={saveProviderKey}
                    disabled={isWorkflowRunning}
                  >
                    저장
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="toast" hidden={!toastVisible}>
        {toastMessage}
      </div>
    </>
  );
}
