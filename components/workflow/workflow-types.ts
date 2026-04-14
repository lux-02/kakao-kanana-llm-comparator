import type { ProviderId } from "@/components/comparator/comparator-data";

export type WorkflowNodeStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "blocked"
  | "missing-key";

export type WorkflowBranchSlot = "primary" | "secondary";

export type WorkflowNode = {
  id: string;
  kind: "model" | "merge";
  parentIds: string[];
  childIds: string[];
  provider: ProviderId;
  modelId: string;
  systemPrompt: string;
  status: WorkflowNodeStatus;
  output: string;
  error: string | null;
  order: number;
  branchSlot?: WorkflowBranchSlot;
};

export type WorkflowEdge = {
  from: string;
  to: string;
};

export type WorkflowGraph = {
  rootPrompt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
};

export type WorkflowRunRequest = {
  rootPrompt: string;
  graph: WorkflowGraph;
  providerKeys: Record<ProviderId, string>;
  globalOptions: {
    stream: boolean;
    temperature: number;
    maxTokens: number;
  };
};

export type WorkflowNodeEvent =
  | {
      type: "node_start";
      nodeId: string;
    }
  | {
      type: "node_delta";
      nodeId: string;
      textDelta: string;
    }
  | {
      type: "node_complete";
      nodeId: string;
      outputText: string;
    }
  | {
      type: "node_error";
      nodeId: string;
      message: string;
    }
  | {
      type: "workflow_complete";
    };
