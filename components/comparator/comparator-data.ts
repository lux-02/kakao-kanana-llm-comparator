export type ProviderId = "kanana" | "openai" | "gemini" | "claude";

export type CardStatus =
  | "idle"
  | "queued"
  | "streaming"
  | "completed"
  | "error"
  | "missing-key";

export type ModelTag = "추천" | "활성" | "안정" | "미리보기";

export interface ProviderModel {
  id: string;
  label: string;
  status: ModelTag;
  description: string;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  fixed?: boolean;
  mark: string;
  models: ProviderModel[];
}

export interface ModelCard {
  id: string;
  provider: ProviderId;
  modelId: string;
  removable: boolean;
  status: CardStatus;
  output: string;
}

export interface RunSnapshot {
  runId: string;
  prompt: string;
  options: {
    stream: boolean;
    temperature: number;
    maxTokens: number;
  };
}

export const PRESET_PROMPTS: Record<string, string> = {
  "한국어 다듬기":
    '아래 문장을 한국어 숏폼 콘텐츠 대본처럼 자연스럽고 짧게 다듬어줘. 말맛은 살리고 과한 표현은 줄여줘.\n\n"코드 완벽? 배포 망하면 멘탈 터지지? 이거 하나만 기억하면 된다."',
  "훅 카피":
    "분산 트랜잭션을 주제로 인스타 릴스 첫 줄 훅 5개와 CTA 3개를 만들어줘. 비전공자도 바로 이해하게 짧고 강하게 써줘.",
  "개념 설명":
    "REST API가 뭔지 비전공자도 이해하게 식당 주문 비유로 설명해줘. 숏폼 스크립트 톤으로 8문장 이내로 써줘.",
  요약: "아래 내용을 5문장 이내로 요약해줘. 핵심 개념, 왜 중요한지, 실무에서 언제 마주치는지 순서로 정리해줘.\n\n이벤트 드리븐 아키텍처는 서비스 간 결합을 낮추고 비동기 확장을 가능하게 하지만, 관찰성과 재처리 전략이 부족하면 장애 추적이 어려워진다.",
  "말투 변경":
    '아래 문장을 직설적이지만 부담스럽지 않은 한국어 구어체로 다시 써줘.\n\n"지금 이 개념을 이해하지 못하면 이후 시스템 설계 토론에서 계속 밀릴 가능성이 큽니다."',
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  kanana: {
    id: "kanana",
    label: "Kanana",
    fixed: true,
    mark: "/provider-marks/kanana.png",
    models: [
      {
        id: "kanana-o",
        label: "Kanana-1.5-o-9.8B-instruct-2602",
        status: "활성",
        description: "한국어 보정과 표현 정리에 강한 기준 모델",
      },
    ],
  },
  openai: {
    id: "openai",
    label: "GPT",
    mark: "/provider-marks/openai.webp",
    models: [
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
        status: "추천",
        description: "가장 먼저 비교해보기 좋은 균형형",
      },
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        status: "활성",
        description: "상위 추론 품질 기준선",
      },
      {
        id: "gpt-5.4-nano",
        label: "GPT-5.4 Nano",
        status: "활성",
        description: "저비용, 고속 비교용",
      },
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        status: "활성",
        description: "non-reasoning 비교 기준선",
      },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    mark: "/provider-marks/gemini.webp",
    models: [
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        status: "추천",
        description: "안정적이고 가벼운 기본 비교 모델",
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        status: "안정",
        description: "상위 stable 비교축",
      },
      {
        id: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash-Lite",
        status: "안정",
        description: "경량 stable 모델",
      },
      {
        id: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
        status: "미리보기",
        description: "최신 고성능 preview",
      },
      {
        id: "gemini-3-flash-preview",
        label: "Gemini 3 Flash Preview",
        status: "미리보기",
        description: "최신 균형 preview",
      },
      {
        id: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash-Lite Preview",
        status: "미리보기",
        description: "최신 경량 preview",
      },
    ],
  },
  claude: {
    id: "claude",
    label: "Claude",
    mark: "/provider-marks/claude.webp",
    models: [
      {
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        status: "추천",
        description: "가장 먼저 써보기 좋은 균형형",
      },
      {
        id: "claude-opus-4-6",
        label: "Claude Opus 4.6",
        status: "활성",
        description: "상위 성능 기준선",
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        status: "활성",
        description: "고속 경량 옵션",
      },
    ],
  },
};

export function createFixedCard(): ModelCard {
  return {
    id: "card-kanana-fixed",
    provider: "kanana",
    modelId: "kanana-o",
    removable: false,
    status: "idle",
    output: "",
  };
}

export function createCard(provider: ProviderId, modelId: string): ModelCard {
  return {
    id: `card-${provider}-${modelId}-${crypto.randomUUID().slice(0, 6)}`,
    provider,
    modelId,
    removable: true,
    status: "idle",
    output: "",
  };
}

export function getModel(
  providerId: ProviderId,
  modelId: string,
): ProviderModel | null {
  return (
    PROVIDERS[providerId].models.find((model) => model.id === modelId) ?? null
  );
}

export function getStatusLabel(status: CardStatus): string {
  const labels: Record<CardStatus, string> = {
    idle: "생성 대기",
    queued: "준비 중",
    streaming: "생성 중",
    completed: "생성 완료",
    error: "오류 발생",
    "missing-key": "API Key 필요",
  };

  return labels[status];
}

export function buildMockResponse(
  card: Pick<ModelCard, "provider">,
  snapshot: RunSnapshot,
): string {
  const shortened =
    snapshot.prompt.length > 120
      ? `${snapshot.prompt.slice(0, 120)}...`
      : snapshot.prompt;

  const templates: Record<ProviderId, string[]> = {
    kanana: [
      "한국어 말맛 기준으로 보면, 이 프롬프트는 문장을 더 짧게 끊고 과한 표현을 눌러주는 쪽이 자연스럽습니다.",
      `핵심 표현은 "${shortened}"에서 너무 딱딱한 부분을 먼저 풀어주는 것입니다.`,
      "결과 문장은 리듬이 부드럽고, 말하듯 읽히는 구어체를 우선합니다.",
      "짧은 CTA가 필요하면 '딱 하나만 기억하면 된다'처럼 압축된 마무리가 어울립니다.",
      `현재 비교 설정은 temperature=${snapshot.options.temperature}, maxTokens=${snapshot.options.maxTokens} 기준입니다.`,
    ],
    openai: [
      "구조적으로 정리하면, 이 프롬프트는 문제 정의 -> 핵심 설명 -> 활용 예시 -> CTA 순서가 가장 안정적입니다.",
      `입력 요약: "${shortened}"`,
      "출력은 항목화와 논리 전개가 분명한 쪽으로 잡는 것이 유리합니다.",
      `현재 데모 값 기준 temperature=${snapshot.options.temperature}, maxTokens=${snapshot.options.maxTokens}를 사용합니다.`,
      "실제 연동 후에는 reasoning 성향 모델일수록 설명의 계층화가 더 강하게 드러날 가능성이 큽니다.",
    ],
    gemini: [
      "빠른 훅과 압축 요약 관점에서 보면, 첫 문장에서 청자의 시선을 끌고 바로 대비를 만드는 방식이 효과적입니다.",
      `이 프롬프트는 "${shortened}"를 짧은 후킹 라인과 설명 블록으로 나누는 편이 읽기 좋습니다.`,
      "카드형 비교에서는 문장 길이가 짧고 단락이 선명할수록 차이가 더 잘 보입니다.",
      "preview 계열은 실전에서 실험 축으로, stable 계열은 기준선으로 두는 구성이 적절합니다.",
      `현재 비교 설정은 temperature=${snapshot.options.temperature}, maxTokens=${snapshot.options.maxTokens} 기준입니다.`,
    ],
    claude: [
      "톤을 너무 세게 밀기보다 독자가 따라오기 쉬운 흐름으로 다듬는 접근이 적합합니다.",
      `입력 프롬프트의 의도는 "${shortened}"로 요약할 수 있습니다.`,
      "설명은 차분하지만 밀도 있게, 예시는 적게 두고 문장 간 연결을 자연스럽게 두는 편이 좋습니다.",
      "긴 문단보다는 읽기 리듬을 해치지 않는 중간 길이 문장이 비교 화면에서 더 설득력 있게 보입니다.",
      `현재 비교 설정은 temperature=${snapshot.options.temperature}, maxTokens=${snapshot.options.maxTokens} 기준입니다.`,
    ],
  };

  return templates[card.provider].join("\n\n");
}

export function splitIntoChunks(text: string): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  let buffer = "";

  words.forEach((word) => {
    const next = buffer ? `${buffer} ${word}` : word;
    if (next.length > 34) {
      if (buffer) {
        chunks.push(`${buffer} `);
      }
      buffer = word;
      return;
    }
    buffer = next;
  });

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
