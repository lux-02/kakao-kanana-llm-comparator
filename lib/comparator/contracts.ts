export type ProviderId = "kanana" | "openai" | "gemini" | "claude";

export type ComparatorRunRequest = {
  runId: string;
  cardId: string;
  provider: ProviderId;
  model: string;
  apiKey: string | null;
  prompt: string;
  systemPrompt?: string | null;
  options: {
    stream: boolean;
    temperature: number;
    maxTokens: number;
  };
};

export type NormalizedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
};

export type NormalizedError = {
  code:
    | "missing_api_key"
    | "invalid_api_key"
    | "network_error"
    | "rate_limited"
    | "provider_error"
    | "unsupported_option"
    | "invalid_request"
    | "unknown_error";
  message: string;
  retryable?: boolean;
  rawStatus?: number;
  rawCode?: string;
};

export type AdapterEvent =
  | {
      type: "start";
      runId: string;
      cardId: string;
      provider: ProviderId;
      model: string;
      startedAt: string;
    }
  | {
      type: "delta";
      runId: string;
      cardId: string;
      textDelta: string;
    }
  | {
      type: "complete";
      runId: string;
      cardId: string;
      outputText: string;
      finishReason?: string;
      usage?: NormalizedUsage;
      completedAt: string;
    }
  | {
      type: "error";
      runId: string;
      cardId: string;
      error: NormalizedError;
      occurredAt: string;
    };

export function isProviderId(value: string): value is ProviderId {
  return value === "kanana" || value === "openai" || value === "gemini" || value === "claude";
}
