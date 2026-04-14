import { PROVIDERS } from "@/components/comparator/comparator-data";
import type {
  AdapterEvent,
  ComparatorRunRequest,
  NormalizedError,
  NormalizedUsage,
  ProviderId,
} from "@/lib/comparator/contracts";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const KANANA_BASE_URL = "https://kanana-o.a2s-endpoint.kr-central-2.kakaocloud.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type SseMessage = {
  event: string;
  data: string;
};

type JsonRecord = Record<string, unknown>;

export async function* runProvider(
  input: ComparatorRunRequest,
): AsyncGenerator<AdapterEvent> {
  if (!input.apiKey?.trim()) {
    yield createErrorEvent(input, {
      code: "missing_api_key",
      message: "API 키가 필요합니다.",
      retryable: false,
    });
    return;
  }

  const provider = PROVIDERS[input.provider];
  const modelExists = provider.models.some((model) => model.id === input.model);

  if (!modelExists) {
    yield createErrorEvent(input, {
      code: "invalid_request",
      message: "지원하지 않는 모델입니다.",
      retryable: false,
    });
    return;
  }

  switch (input.provider) {
    case "kanana":
      yield* runOpenAICompatible({
        input,
        baseUrl: KANANA_BASE_URL,
        useMultipartContent: false,
      });
      return;
    case "openai":
      yield* runOpenAIResponses(input);
      return;
    case "gemini":
      yield* runGemini(input);
      return;
    case "claude":
      yield* runClaude(input);
      return;
    default:
      yield createErrorEvent(input, {
        code: "invalid_request",
        message: "지원하지 않는 프로바이더입니다.",
        retryable: false,
      });
  }
}

async function* runOpenAIResponses(
  input: ComparatorRunRequest,
): AsyncGenerator<AdapterEvent> {
  const startedAt = new Date().toISOString();
  const apiKey = input.apiKey ?? "";
  const requestBody: JsonRecord = {
    model: input.model,
    input: input.prompt,
    stream: input.options.stream,
    temperature: clampTemperature(input.provider, input.options.temperature),
    max_output_tokens: clampMaxTokens(input.provider, input.options.maxTokens),
  };

  if (input.systemPrompt?.trim()) {
    requestBody.instructions = input.systemPrompt.trim();
  }

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    yield createErrorEvent(input, await normalizeErrorResponse(response));
    return;
  }

  yield createStartEvent(input, startedAt);

  if (!input.options.stream) {
    const payload = (await response.json()) as JsonRecord;
    const outputText = extractOpenAIResponsesText(payload);

    yield {
      type: "complete",
      runId: input.runId,
      cardId: input.cardId,
      outputText,
      finishReason: readString(payload, "status"),
      usage: normalizeOpenAIResponsesUsage(payload),
      completedAt: new Date().toISOString(),
    };
    return;
  }

  if (!response.body) {
    yield createErrorEvent(input, {
      code: "network_error",
      message: "응답 스트림을 읽을 수 없습니다.",
      retryable: true,
    });
    return;
  }

  let outputText = "";
  let usage: NormalizedUsage | undefined;
  let finishReason: string | undefined;

  for await (const message of iterateSseMessages(response.body)) {
    if (!message.data || message.data === "[DONE]") {
      continue;
    }

    const payload = safeParseJson(message.data);
    if (!payload) {
      continue;
    }

    if (payload.type === "response.output_text.delta") {
      const textDelta = typeof payload.delta === "string" ? payload.delta : "";
      if (textDelta) {
        outputText += textDelta;
        yield {
          type: "delta",
          runId: input.runId,
          cardId: input.cardId,
          textDelta,
        };
      }
    }

    if (payload.type === "response.completed") {
      const responsePayload = isRecord(payload.response) ? payload.response : undefined;
      if (responsePayload) {
        finishReason = readString(responsePayload, "status") ?? finishReason;
        usage = normalizeOpenAIResponsesUsage(responsePayload) ?? usage;
        if (!outputText) {
          outputText = extractOpenAIResponsesText(responsePayload);
        }
      }
    }

    if (payload.type === "error") {
      yield createErrorEvent(input, normalizeOpenAIErrorPayload(payload));
      return;
    }
  }

  yield {
    type: "complete",
    runId: input.runId,
    cardId: input.cardId,
    outputText,
    finishReason,
    usage,
    completedAt: new Date().toISOString(),
  };
}

async function* runOpenAICompatible({
  input,
  baseUrl,
  useMultipartContent,
}: {
  input: ComparatorRunRequest;
  baseUrl: string;
  useMultipartContent: boolean;
}): AsyncGenerator<AdapterEvent> {
  const startedAt = new Date().toISOString();
  const apiKey = input.apiKey ?? "";
  const requestBody: JsonRecord = {
    model: input.model,
    stream: input.options.stream,
    temperature: clampTemperature(input.provider, input.options.temperature),
    max_tokens: clampMaxTokens(input.provider, input.options.maxTokens),
    messages: [],
  };

  const messages = requestBody.messages as Array<Record<string, unknown>>;

  if (input.systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: input.systemPrompt.trim(),
    });
  }

  messages.push({
    role: "user",
    content: useMultipartContent
      ? [{ type: "text", text: input.prompt }]
      : input.prompt,
  });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    yield createErrorEvent(input, await normalizeErrorResponse(response));
    return;
  }

  yield createStartEvent(input, startedAt);

  if (!input.options.stream) {
    const payload = (await response.json()) as JsonRecord;
    yield {
      type: "complete",
      runId: input.runId,
      cardId: input.cardId,
      outputText: extractOpenAICompatibleMessageText(payload),
      finishReason: readNestedString(payload, ["choices", 0, "finish_reason"]),
      usage: normalizeChatCompletionUsage(payload),
      completedAt: new Date().toISOString(),
    };
    return;
  }

  if (!response.body) {
    yield createErrorEvent(input, {
      code: "network_error",
      message: "응답 스트림을 읽을 수 없습니다.",
      retryable: true,
    });
    return;
  }

  let emittedText = "";
  let finishReason: string | undefined;
  let usage: NormalizedUsage | undefined;

  for await (const message of iterateSseMessages(response.body)) {
    if (!message.data || message.data === "[DONE]") {
      continue;
    }

    const payload = safeParseJson(message.data);
    if (!payload) {
      continue;
    }

    const nextText = extractOpenAICompatibleDeltaText(payload);
    const textDelta = deriveStreamingTextDelta(nextText, emittedText);
    if (textDelta) {
      emittedText += textDelta;
      yield {
        type: "delta",
        runId: input.runId,
        cardId: input.cardId,
        textDelta,
      };
    }

    finishReason = readNestedString(payload, ["choices", 0, "finish_reason"]) ?? finishReason;
    usage = normalizeChatCompletionUsage(payload) ?? usage;

    if (hasOpenAICompatibleError(payload)) {
      yield createErrorEvent(input, normalizeOpenAICompatibleErrorPayload(payload));
      return;
    }
  }

  yield {
    type: "complete",
    runId: input.runId,
    cardId: input.cardId,
    outputText: emittedText,
    finishReason,
    usage,
    completedAt: new Date().toISOString(),
  };
}

async function* runGemini(
  input: ComparatorRunRequest,
): AsyncGenerator<AdapterEvent> {
  const startedAt = new Date().toISOString();
  const apiKey = input.apiKey ?? "";
  const endpoint = input.options.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const requestBody: JsonRecord = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
      },
    ],
    generationConfig: createGeminiGenerationConfig(input),
  };

  if (input.systemPrompt?.trim()) {
    requestBody.system_instruction = {
      parts: [{ text: input.systemPrompt.trim() }],
    };
  }

  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(input.model)}:${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    cache: "no-store",
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    yield createErrorEvent(input, await normalizeErrorResponse(response));
    return;
  }

  yield createStartEvent(input, startedAt);

  if (!input.options.stream) {
    const payload = (await response.json()) as JsonRecord;
    yield {
      type: "complete",
      runId: input.runId,
      cardId: input.cardId,
      outputText: extractGeminiText(payload),
      finishReason: readNestedString(payload, ["candidates", 0, "finishReason"]),
      usage: normalizeGeminiUsage(payload),
      completedAt: new Date().toISOString(),
    };
    return;
  }

  if (!response.body) {
    yield createErrorEvent(input, {
      code: "network_error",
      message: "응답 스트림을 읽을 수 없습니다.",
      retryable: true,
    });
    return;
  }

  let emittedText = "";
  let latestUsage: NormalizedUsage | undefined;
  let finishReason: string | undefined;

  for await (const message of iterateSseMessages(response.body)) {
    if (!message.data) {
      continue;
    }

    const payload = safeParseJson(message.data);
    if (!payload) {
      continue;
    }

    const nextText = extractGeminiText(payload);
    let textDelta = "";

    if (nextText.startsWith(emittedText)) {
      textDelta = nextText.slice(emittedText.length);
      emittedText = nextText;
    } else if (nextText) {
      textDelta = nextText;
      emittedText += nextText;
    }

    if (textDelta) {
      yield {
        type: "delta",
        runId: input.runId,
        cardId: input.cardId,
        textDelta,
      };
    }

    latestUsage = normalizeGeminiUsage(payload) ?? latestUsage;
    finishReason = readNestedString(payload, ["candidates", 0, "finishReason"]) ?? finishReason;

    if (hasGeminiError(payload)) {
      yield createErrorEvent(input, normalizeGeminiErrorPayload(payload));
      return;
    }
  }

  yield {
    type: "complete",
    runId: input.runId,
    cardId: input.cardId,
    outputText: emittedText,
    finishReason,
    usage: latestUsage,
    completedAt: new Date().toISOString(),
  };
}

async function* runClaude(
  input: ComparatorRunRequest,
): AsyncGenerator<AdapterEvent> {
  const startedAt = new Date().toISOString();
  const apiKey = input.apiKey ?? "";
  const requestBody: JsonRecord = {
    model: input.model,
    stream: input.options.stream,
    max_tokens: clampMaxTokens(input.provider, input.options.maxTokens),
    temperature: clampTemperature(input.provider, input.options.temperature),
    messages: [
      {
        role: "user",
        content: input.prompt,
      },
    ],
  };

  if (input.systemPrompt?.trim()) {
    requestBody.system = input.systemPrompt.trim();
  }

  const response = await fetch(CLAUDE_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    cache: "no-store",
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    yield createErrorEvent(input, await normalizeErrorResponse(response));
    return;
  }

  yield createStartEvent(input, startedAt);

  if (!input.options.stream) {
    const payload = (await response.json()) as JsonRecord;
    yield {
      type: "complete",
      runId: input.runId,
      cardId: input.cardId,
      outputText: extractClaudeText(payload),
      finishReason: readString(payload, "stop_reason"),
      usage: normalizeClaudeUsage(payload),
      completedAt: new Date().toISOString(),
    };
    return;
  }

  if (!response.body) {
    yield createErrorEvent(input, {
      code: "network_error",
      message: "응답 스트림을 읽을 수 없습니다.",
      retryable: true,
    });
    return;
  }

  let outputText = "";
  let usage: NormalizedUsage | undefined;
  let finishReason: string | undefined;

  for await (const message of iterateSseMessages(response.body)) {
    if (!message.data) {
      continue;
    }

    const payload = safeParseJson(message.data);
    if (!payload) {
      continue;
    }

    if (payload.type === "content_block_delta" && isRecord(payload.delta)) {
      const textDelta = typeof payload.delta.text === "string" ? payload.delta.text : "";
      if (textDelta) {
        outputText += textDelta;
        yield {
          type: "delta",
          runId: input.runId,
          cardId: input.cardId,
          textDelta,
        };
      }
    }

    if (payload.type === "message_delta" && isRecord(payload.delta)) {
      finishReason =
        (typeof payload.delta.stop_reason === "string" ? payload.delta.stop_reason : undefined) ??
        finishReason;
      usage = normalizeClaudeUsage(payload) ?? usage;
    }

    if (payload.type === "message_stop") {
      usage = normalizeClaudeUsage(payload) ?? usage;
    }

    if (payload.type === "error" && isRecord(payload.error)) {
      yield createErrorEvent(input, normalizeClaudeErrorPayload(payload));
      return;
    }
  }

  yield {
    type: "complete",
    runId: input.runId,
    cardId: input.cardId,
    outputText,
    finishReason,
    usage,
    completedAt: new Date().toISOString(),
  };
}

async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = findSseBoundary(buffer);
      if (!boundary) {
        break;
      }

      const rawMessage = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const parsed = parseSseMessage(rawMessage);
      if (parsed) {
        yield parsed;
      }
    }
  }

  const trailing = parseSseMessage(buffer);
  if (trailing) {
    yield trailing;
  }
}

function findSseBoundary(
  buffer: string,
): {
  index: number;
  length: number;
} | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || match.index === undefined) {
    return null;
  }

  return {
    index: match.index,
    length: match[0].length,
  };
}

function parseSseMessage(rawMessage: string): SseMessage | null {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawMessage.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function createStartEvent(
  input: ComparatorRunRequest,
  startedAt: string,
): AdapterEvent {
  return {
    type: "start",
    runId: input.runId,
    cardId: input.cardId,
    provider: input.provider,
    model: input.model,
    startedAt,
  };
}

function createErrorEvent(
  input: ComparatorRunRequest,
  error: NormalizedError,
): AdapterEvent {
  return {
    type: "error",
    runId: input.runId,
    cardId: input.cardId,
    error,
    occurredAt: new Date().toISOString(),
  };
}

async function normalizeErrorResponse(response: Response): Promise<NormalizedError> {
  const text = await response.text();
  const payload = safeParseJson(text);

  if (response.status === 401 || response.status === 403) {
    return {
      code: "invalid_api_key",
      message: extractErrorMessage(payload) ?? "API 키가 올바르지 않습니다.",
      retryable: false,
      rawStatus: response.status,
    };
  }

  if (response.status === 429) {
    return {
      code: "rate_limited",
      message: extractErrorMessage(payload) ?? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      retryable: true,
      rawStatus: response.status,
    };
  }

  return {
    code: response.status >= 500 ? "provider_error" : "invalid_request",
    message: extractErrorMessage(payload) ?? "프로바이더 요청에 실패했습니다.",
    retryable: response.status >= 500,
    rawStatus: response.status,
  };
}

function normalizeOpenAIErrorPayload(payload: JsonRecord): NormalizedError {
  const error = isRecord(payload.error) ? payload.error : payload;
  return {
    code: "provider_error",
    message: readString(error, "message") ?? "OpenAI 요청 중 오류가 발생했습니다.",
    retryable: true,
  };
}

function normalizeOpenAICompatibleErrorPayload(payload: JsonRecord): NormalizedError {
  const error = isRecord(payload.error) ? payload.error : payload;
  return {
    code: "provider_error",
    message: readString(error, "message") ?? "요청 처리 중 오류가 발생했습니다.",
    retryable: true,
  };
}

function normalizeGeminiErrorPayload(payload: JsonRecord): NormalizedError {
  const error = isRecord(payload.error) ? payload.error : payload;
  return {
    code: "provider_error",
    message: readString(error, "message") ?? "Gemini 요청 중 오류가 발생했습니다.",
    retryable: true,
  };
}

function normalizeClaudeErrorPayload(payload: JsonRecord): NormalizedError {
  const error = isRecord(payload.error) ? payload.error : payload;
  return {
    code: "provider_error",
    message: readString(error, "message") ?? "Claude 요청 중 오류가 발생했습니다.",
    retryable: true,
  };
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  return undefined;
}

function hasOpenAICompatibleError(payload: JsonRecord): boolean {
  return isRecord(payload.error);
}

function hasGeminiError(payload: JsonRecord): boolean {
  return isRecord(payload.error);
}

function extractOpenAICompatibleDeltaText(payload: JsonRecord): string {
  const content = readNestedUnknown(payload, ["choices", 0, "delta", "content"]);
  return normalizeContentValue(content);
}

function extractOpenAICompatibleMessageText(payload: JsonRecord): string {
  const content = readNestedUnknown(payload, ["choices", 0, "message", "content"]);
  return normalizeContentValue(content);
}

function extractOpenAIResponsesText(payload: JsonRecord): string {
  const output = readUnknownArray(payload, "output");
  if (!output) {
    return "";
  }

  const parts: string[] = [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    const content = readUnknownArray(item, "content");
    if (!content) {
      continue;
    }

    for (const block of content) {
      if (!isRecord(block) || block.type !== "output_text") {
        continue;
      }

      if (typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }

  return parts.join("");
}

function extractGeminiText(payload: JsonRecord): string {
  const candidates = readUnknownArray(payload, "candidates");
  if (!candidates?.length) {
    return "";
  }

  const firstCandidate = candidates[0];
  if (!isRecord(firstCandidate)) {
    return "";
  }

  const content = isRecord(firstCandidate.content) ? firstCandidate.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  return parts
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }

      if (part.thought === true) {
        return "";
      }

      if (typeof part.thoughtSignature === "string" && typeof part.text !== "string") {
        return "";
      }

      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
}

function createGeminiGenerationConfig(input: ComparatorRunRequest): JsonRecord {
  const config: JsonRecord = {
    temperature: getGeminiTemperature(input.model, input.options.temperature),
    maxOutputTokens: getGeminiMaxOutputTokens(input.model, input.options.maxTokens),
  };

  const thinkingConfig = getGeminiThinkingConfig(input.model);
  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  return config;
}

function getGeminiThinkingConfig(model: string): JsonRecord | null {
  if (model.startsWith("gemini-2.5-flash") || model.startsWith("gemini-2.5-flash-lite")) {
    return {
      thinkingBudget: 0,
    };
  }

  if (model.startsWith("gemini-2.5-pro")) {
    return {
      thinkingBudget: 512,
    };
  }

  if (model.startsWith("gemini-3.1-pro")) {
    return {
      thinkingLevel: "low",
    };
  }

  if (model.startsWith("gemini-3")) {
    return {
      thinkingLevel: "minimal",
    };
  }

  return null;
}

function getGeminiTemperature(model: string, value: number): number {
  if (model.startsWith("gemini-3")) {
    return 1;
  }

  return clampTemperature("gemini", value);
}

function getGeminiMaxOutputTokens(model: string, value: number): number {
  const clamped = clampMaxTokens("gemini", value);

  if (model.startsWith("gemini-3.1-pro") || model.startsWith("gemini-2.5-pro")) {
    return Math.max(clamped, 2048);
  }

  return clamped;
}

function extractClaudeText(payload: JsonRecord): string {
  const content = readUnknownArray(payload, "content");
  if (!content) {
    return "";
  }

  return content
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

function normalizeOpenAIResponsesUsage(payload: JsonRecord): NormalizedUsage | undefined {
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: readNumber(usage, "input_tokens"),
    outputTokens: readNumber(usage, "output_tokens"),
    totalTokens: readNumber(usage, "total_tokens"),
  };
}

function normalizeChatCompletionUsage(payload: JsonRecord): NormalizedUsage | undefined {
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: readNumber(usage, "prompt_tokens"),
    outputTokens: readNumber(usage, "completion_tokens"),
    totalTokens: readNumber(usage, "total_tokens"),
  };
}

function normalizeGeminiUsage(payload: JsonRecord): NormalizedUsage | undefined {
  const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : undefined;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: readNumber(usage, "promptTokenCount"),
    outputTokens: readNumber(usage, "candidatesTokenCount"),
    totalTokens: readNumber(usage, "totalTokenCount"),
  };
}

function normalizeClaudeUsage(payload: JsonRecord): NormalizedUsage | undefined {
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: readNumber(usage, "input_tokens"),
    outputTokens: readNumber(usage, "output_tokens"),
  };
}

function normalizeContentValue(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function deriveStreamingTextDelta(nextText: string, emittedText: string): string {
  if (!nextText) {
    return "";
  }

  if (!emittedText) {
    return nextText;
  }

  if (nextText === emittedText) {
    return "";
  }

  if (nextText.startsWith(emittedText)) {
    return nextText.slice(emittedText.length);
  }

  if (emittedText.endsWith(nextText)) {
    return "";
  }

  return nextText;
}

function clampTemperature(provider: ProviderId, value: number): number {
  if (!Number.isFinite(value)) {
    return provider === "gemini" ? 1 : 0.8;
  }

  if (provider === "claude") {
    return Math.min(1, Math.max(0, value));
  }

  return Math.min(2, Math.max(0, value));
}

function clampMaxTokens(provider: ProviderId, value: number): number {
  const fallback = provider === "claude" ? 1024 : 768;
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(4096, Math.max(64, Math.round(value)));
}

function safeParseJson(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function readNumber(record: JsonRecord, key: string): number | undefined {
  return typeof record[key] === "number" ? record[key] : undefined;
}

function readUnknownArray(record: JsonRecord, key: string): unknown[] | undefined {
  return Array.isArray(record[key]) ? record[key] : undefined;
}

function readNestedUnknown(record: JsonRecord, path: Array<string | number>): unknown {
  let current: unknown = record;

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function readNestedString(record: JsonRecord, path: Array<string | number>): string | undefined {
  const value = readNestedUnknown(record, path);
  return typeof value === "string" ? value : undefined;
}
