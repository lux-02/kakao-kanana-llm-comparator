"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Gauge,
  Lock,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  PROVIDERS,
  createCard,
  createFixedCard,
  getModel,
  getStatusLabel,
  type CardStatus,
  type ModelCard,
  type ProviderId,
  type ProviderModel,
  type RunSnapshot,
} from "@/components/comparator/comparator-data";
import type {
  ComparatorRunRequest,
} from "@/lib/comparator/contracts";
import { runComparatorRequest } from "@/lib/comparator/client";
import {
  EMPTY_PROVIDER_KEYS,
  readSessionProviderKeys,
  writeSessionProviderKeys,
} from "@/lib/provider-key-session";
const PROVIDER_ORDER: ProviderId[] = ["kanana", "openai", "gemini", "claude"];
const INITIAL_KEYS: Record<ProviderId, string> = EMPTY_PROVIDER_KEYS;
const INITIAL_KEY_VISIBILITY: Record<ProviderId, boolean> = {
  kanana: false,
  openai: false,
  gemini: false,
  claude: false,
};

type ModalState =
  | { kind: "models" }
  | { kind: "settings" }
  | { kind: "key"; provider: ProviderId }
  | null;

function resetCard(card: ModelCard): ModelCard {
  return {
    ...card,
    status: "idle",
    output: "",
  };
}

function getRunSnapshot(
  prompt: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
): RunSnapshot {
  return {
    runId: `run-${Date.now()}`,
    prompt: prompt.trim(),
    options: {
      stream,
      temperature,
      maxTokens,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getModelTagIcon(model: ProviderModel): LucideIcon {
  if (
    model.id.includes("nano") ||
    model.id.includes("lite") ||
    model.id.includes("haiku")
  ) {
    return Gauge;
  }

  if (model.status === "추천") {
    return Sparkles;
  }

  if (model.status === "안정") {
    return ShieldCheck;
  }

  if (model.status === "미리보기") {
    return FlaskConical;
  }

  return Sparkles;
}

function getModelGroups(providerId: ProviderId) {
  const models = PROVIDERS[providerId].models;

  return {
    recommended: models.filter((model) => model.status === "추천"),
    rest: models.filter((model) => model.status !== "추천"),
  };
}

export function ComparatorApp() {
  const [prompt, setPrompt] = useState("");
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
  const [cards, setCards] = useState<ModelCard[]>([createFixedCard()]);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pickerProvider, setPickerProvider] = useState<ProviderId>("openai");
  const [selectedModelId, setSelectedModelId] = useState("");
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
    if (!modalState) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalState(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modalState]);

  useEffect(() => {
    if (!toastVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToastVisible(false);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toastVisible]);

  const selectedModel = selectedModelId
    ? getModel(pickerProvider, selectedModelId)
    : null;
  const selectedModelAlreadyAdded = cards.some(
    (card) =>
      card.provider === pickerProvider && card.modelId === selectedModelId,
  );
  const { recommended, rest } = getModelGroups(pickerProvider);
  const hasKananaKey = Boolean(keys.kanana.trim());

  function pushToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
  }

  function applyKeys(nextKeys: Record<ProviderId, string>) {
    setKeys(nextKeys);
    setCards((prev) =>
      prev.map((card) =>
        nextKeys[card.provider].trim() && card.status === "missing-key"
          ? { ...card, status: "idle" }
          : card,
      ),
    );
  }

  function updateCard(cardId: string, updater: (card: ModelCard) => ModelCard) {
    setCards((prev) =>
      prev.map((card) => (card.id === cardId ? updater(card) : card)),
    );
  }

  function updateCardOutput(cardId: string, output: string) {
    updateCard(cardId, (card) => ({ ...card, output }));
  }

  function appendCardOutput(cardId: string, textDelta: string) {
    updateCard(cardId, (card) => ({
      ...card,
      output: `${card.output}${textDelta}`,
    }));
  }

  function openModelModal() {
    setPickerProvider("openai");
    setSelectedModelId("");
    setModalState({ kind: "models" });
  }

  function openSettingsModal() {
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
    setKeyDraft(keys[provider]);
    setShowKeyDraft(false);
    setModalState({ kind: "key", provider });
  }

  function closeModal() {
    setModalState(null);
  }

  async function runCard(
    target: Pick<ModelCard, "id" | "provider" | "modelId">,
    snapshot: RunSnapshot,
  ) {
    if (!keys[target.provider].trim()) {
      updateCard(target.id, (card) => ({
        ...card,
        status: "missing-key",
        output: "",
      }));
      return;
    }

    updateCard(target.id, (card) => ({
      ...card,
      status: "queued",
      output: "",
    }));

    const requestBody: ComparatorRunRequest = {
      runId: snapshot.runId,
      cardId: target.id,
      provider: target.provider,
      model: target.modelId,
      apiKey: keys[target.provider].trim(),
      prompt: snapshot.prompt,
      options: {
        stream: snapshot.options.stream,
        temperature: snapshot.options.temperature,
        maxTokens: snapshot.options.maxTokens,
      },
    };

    try {
      for await (const event of runComparatorRequest(requestBody)) {
        if (event.type === "start") {
          updateCard(target.id, (card) => ({
            ...card,
            status: "streaming",
          }));
          continue;
        }

        if (event.type === "delta") {
          appendCardOutput(target.id, event.textDelta);
          continue;
        }

        if (event.type === "complete") {
          updateCard(target.id, (card) => ({
            ...card,
            status: "completed",
            output: event.outputText || card.output,
          }));
          continue;
        }

        if (event.type === "error") {
          updateCard(target.id, (card) => ({
            ...card,
            status: "error",
            output: event.error.message,
          }));
          return;
        }
      }
    } catch (error) {
      updateCard(target.id, (card) => ({
        ...card,
        status: "error",
        output:
          error instanceof Error
            ? error.message
            : "요청 중 오류가 발생했습니다.",
      }));
    }
  }

  async function runComparator(snapshot: RunSnapshot) {
    const targets = cards.map((card) => ({
      id: card.id,
      provider: card.provider,
      modelId: card.modelId,
    }));

    setCards((prev) => prev.map((card) => resetCard(card)));
    await Promise.all(targets.map((target) => runCard(target, snapshot)));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasKananaKey) {
      pushToast("Kanana API 키를 먼저 입력해 주세요.");
      openKeyModal("kanana");
      return;
    }

    const snapshot = getRunSnapshot(
      prompt,
      stream,
      Number(temperature || 0.8),
      Number(maxTokens || 768),
    );

    if (!snapshot.prompt) {
      pushToast("프롬프트를 입력해 주세요.");
      return;
    }

    void runComparator(snapshot);
  }

  function handleAddModel() {
    if (!selectedModelId || selectedModelAlreadyAdded) {
      return;
    }

    const card = createCard(pickerProvider, selectedModelId);
    setCards((prev) => [...prev, card]);
    closeModal();
  }

  function handleRemoveCard(cardId: string) {
    setCards((prev) => prev.filter((card) => card.id !== cardId));
  }

  async function handleCopyCard(cardId: string) {
    const card = cards.find((item) => item.id === cardId);
    if (!card?.output) {
      return;
    }

    await navigator.clipboard.writeText(card.output);
    pushToast("복사했습니다.");
  }

  function applySettings() {
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
    if (!modalState || modalState.kind !== "key") {
      return;
    }

    applyKeys({
      ...keys,
      [modalState.provider]: keyDraft.trim(),
    });
    closeModal();
  }

  function clearProviderKey() {
    if (!modalState || modalState.kind !== "key") {
      return;
    }

    applyKeys({
      ...keys,
      [modalState.provider]: "",
    });
    setKeyDraft("");
    closeModal();
  }

  function renderModelOption(model: ProviderModel) {
    const isSelected = selectedModelId === model.id;
    const isAdded = cards.some(
      (card) => card.provider === pickerProvider && card.modelId === model.id,
    );
    const TagIcon = getModelTagIcon(model);
    const provider = PROVIDERS[pickerProvider];

    return (
      <button
        key={model.id}
        type="button"
        className={`model-option${isSelected ? " active" : ""}${isAdded ? " disabled" : ""}`}
        onClick={() => setSelectedModelId(model.id)}
        disabled={isAdded}
        aria-pressed={isSelected}
      >
        <div className="model-option-main">
          <span
            className={`provider-mark provider-mark-small provider-${pickerProvider}`}
          >
            <img src={provider.mark} alt="" aria-hidden="true" />
          </span>
          <div className="model-option-copy">
            <strong>
              {model.label} {isAdded ? "(추가됨)" : ""}
            </strong>

            <span>{model.description}</span>
          </div>
        </div>

        <span
          className={`model-state-chip model-state-${isAdded ? "added" : "default"}`}
        >
          <TagIcon size={20} aria-hidden="true" />
        </span>
      </button>
    );
  }

  function renderCardBody(card: ModelCard) {
    const provider = PROVIDERS[card.provider];
    const hasKey = Boolean(keys[card.provider].trim());

    if (!hasKey) {
      return (
        <div className="key-cta-panel">
          <p className="key-cta-copy">
            {provider.label} API 키 값을 입력하세요.
          </p>
          <button
            className="ghost small button-with-icon"
            type="button"
            onClick={() => openKeyModal(card.provider)}
          >
            API 키 입력
          </button>
        </div>
      );
    }

    if (card.output) {
      return (
        <pre dangerouslySetInnerHTML={{ __html: escapeHtml(card.output) }} />
      );
    }

    return (
      <div className="placeholder-copy">실행하면 결과가 여기에 표시됩니다.</div>
    );
  }

  function getDisplayStatus(card: ModelCard): CardStatus {
    if (!keys[card.provider].trim()) {
      return "missing-key";
    }

    return card.status === "missing-key" ? "idle" : card.status;
  }

  return (
    <>
      <section className="panel input-hub compact-panel">
        <form onSubmit={handleSubmit} noValidate>
          <div className="prompt-stack">
            {!hasKananaKey ? (
              <div className="prompt-lock-panel">
                <div className="prompt-lock-copy">
                  <strong>Kanana API 키를 먼저 입력하세요.</strong>
                </div>

                <button
                  className="primary small button-with-icon"
                  type="button"
                  onClick={() => openKeyModal("kanana")}
                >
                  <Lock size={16} aria-hidden="true" />
                  Kanana API 키 입력
                </button>
              </div>
            ) : null}

            <div
              className={`field field-large prompt-input-shell${hasKananaKey ? "" : " field-disabled"}`}
            >
              <button
                className="ghost icon-button prompt-settings-button"
                type="button"
                aria-label="고급 설정"
                onClick={openSettingsModal}
              >
                <Settings
                  size={18}
                  className="prompt-settings-icon"
                  aria-hidden="true"
                />
              </button>

              <textarea
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  hasKananaKey
                    ? "프롬프트를 입력하세요.."
                    : "Kanana API 키를 입력하면 프롬프트를 작성할 수 있습니다"
                }
                disabled={!hasKananaKey}
              />
            </div>

            <button
              className="primary full-width"
              type="submit"
              disabled={!hasKananaKey}
            >
              결과 확인
            </button>
          </div>
        </form>
      </section>

      <section className="board-panel compact-board-panel">
        <div className="model-board" aria-live="polite">
          {cards.map((card) => {
            const provider = PROVIDERS[card.provider];
            const model = getModel(card.provider, card.modelId);
            const displayStatus = getDisplayStatus(card);

            return (
              <article
                key={card.id}
                className={`model-card provider-${card.provider}`}
              >
                <div className="model-card-inner">
                  <div className="card-top">
                    <div className="card-heading">
                      <div className="card-heading-line">
                        <span
                          className={`provider-mark provider-${card.provider}`}
                        >
                          <img src={provider.mark} alt="" aria-hidden="true" />
                        </span>
                        <h3>{model?.label ?? card.modelId}</h3>
                      </div>
                    </div>

                    {card.removable ? (
                      <button
                        className="delete-button"
                        type="button"
                        aria-label="카드 삭제"
                        onClick={() => handleRemoveCard(card.id)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="fixed-tag">
                        <Lock size={14} aria-hidden="true" />
                      </span>
                    )}
                  </div>

                  <div className="card-meta-row">
                    <span className={`status-pill status-${displayStatus}`}>
                      {getStatusLabel(displayStatus)}
                    </span>
                  </div>

                  <div className="card-output">{renderCardBody(card)}</div>

                  <div className="card-footer">
                    <div className="card-actions">
                      <button
                        className="ghost small button-with-icon"
                        type="button"
                        onClick={() => void handleCopyCard(card.id)}
                        disabled={!card.output}
                      >
                        <Copy size={15} aria-hidden="true" />
                        복사
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}

          <button className="add-card" type="button" onClick={openModelModal}>
            <span className="add-mark" aria-hidden="true">
              <Plus size={28} />
            </span>
            <div>
              <strong>모델 추가</strong>
            </div>
          </button>
        </div>
      </section>

      {modalState ? (
        <div className="modal">
          <div className="modal-backdrop" onClick={closeModal}></div>
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modalTitle"
          >
            {modalState.kind === "models" ? (
              <>
                <div className="mini-head modal-head">
                  <h2 id="modalTitle">모델 추가</h2>
                </div>

                <div className="provider-picker">
                  {(["openai", "gemini", "claude"] as ProviderId[]).map(
                    (providerId) => (
                      <button
                        key={providerId}
                        type="button"
                        className={`provider-button${pickerProvider === providerId ? " active" : ""}`}
                        onClick={() => {
                          setPickerProvider(providerId);
                          setSelectedModelId("");
                        }}
                      >
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
                      </button>
                    ),
                  )}
                </div>

                <div className="modal-fields">
                  {recommended.length > 0 ? (
                    <div className="model-section">
                      <p className="section-label">추천</p>
                      <div className="model-option-list">
                        {recommended.map(renderModelOption)}
                      </div>
                    </div>
                  ) : null}

                  {rest.length > 0 ? (
                    <div className="model-section">
                      <p className="section-label">전체 모델</p>
                      <div className="model-option-list">
                        {rest.map(renderModelOption)}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="modal-actions">
                  <button className="ghost" type="button" onClick={closeModal}>
                    취소
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={handleAddModel}
                    disabled={!selectedModel || selectedModelAlreadyAdded}
                  >
                    추가
                  </button>
                </div>
              </>
            ) : null}

            {modalState.kind === "settings" ? (
              <>
                <div className="mini-head modal-head">
                  <h2 id="modalTitle">고급 설정</h2>
                </div>

                <div className="settings-section">
                  <div className="mini-head"></div>

                  <div className="settings-grid">
                    <div className="settings-row">
                      <span>Streaming</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={settingsDraft.stream}
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
                  <div className="mini-head"></div>

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
                        onChange={(event) => setKeyDraft(event.target.value)}
                      />
                      <button
                        className="ghost icon-button key-visibility-toggle"
                        type="button"
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
                  <button className="ghost" type="button" onClick={closeModal}>
                    취소
                  </button>
                  {keys[modalState.provider] ? (
                    <button
                      className="ghost"
                      type="button"
                      onClick={clearProviderKey}
                    >
                      지우기
                    </button>
                  ) : null}
                  <button
                    className="primary"
                    type="button"
                    onClick={saveProviderKey}
                    disabled={!keyDraft.trim()}
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
