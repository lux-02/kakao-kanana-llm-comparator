# LLM Comparator Adapter Contract

Last updated: 2026-04-14 (Asia/Seoul)

Related docs:

- [PROVIDER_MATRIX.md](/Users/lux/Documents/kakao-kanana-llm-comparator/docs/PROVIDER_MATRIX.md)
- [IA_DETAIL.md](/Users/lux/Documents/kakao-kanana-llm-comparator/docs/IA_DETAIL.md)
- [HISTORY.md](/Users/lux/Documents/kakao-kanana-llm-comparator/HISTORY.md)

## Goal

Define the runtime boundary between the UI and provider-specific adapters.

This document is not implementation-specific to one framework. It is a contract document for:

- what the UI sends
- what each adapter must return
- how streaming should behave
- how errors and unsupported options should surface

## Design Principles

- One common UI contract
- One adapter per provider family
- Card-level isolation
- Streaming-first behavior
- Graceful degradation when provider support differs

## 1. Adapter Responsibilities

Each provider adapter is responsible for:

- validating required credentials
- translating the common request shape into provider-specific payloads
- executing the request
- normalizing streaming and final output events
- returning normalized usage and error data

The UI layer should not know provider-specific field names.

## 2. Adapter Registry

Expected v1 adapters:

- `kanana`
- `openai`
- `gemini`
- `claude`

Suggested registry shape:

```ts
type ProviderId = "kanana" | "openai" | "gemini" | "claude";

type AdapterRegistry = Record<ProviderId, ModelAdapter>;
```

## 3. Common Request Contract

The UI should build one run request per card.

### 3.1 ComparatorRunInput

```ts
type ProviderId = "kanana" | "openai" | "gemini" | "claude";

type ComparatorRunInput = {
  runId: string;
  cardId: string;
  provider: ProviderId;
  model: string;
  apiKey: string | null;
  prompt: string;
  systemPrompt?: string;
  options: {
    stream: boolean;
    temperature?: number;
    maxOutputTokens?: number;
  };
  metadata?: {
    initiatedAt?: string;
    presetId?: string;
  };
};
```

Rules:

- `prompt` is required
- `apiKey` may be absent, but the adapter must surface a normalized missing-key error
- the UI uses `maxOutputTokens` as the common name even if providers map it differently

## 4. Common Response Contract

Adapters should emit normalized events rather than provider-native payloads.

### 4.1 Event Types

```ts
type AdapterEvent =
  | AdapterStartEvent
  | AdapterDeltaEvent
  | AdapterCompleteEvent
  | AdapterErrorEvent;

type AdapterStartEvent = {
  type: "start";
  runId: string;
  cardId: string;
  provider: ProviderId;
  model: string;
  startedAt: string;
};

type AdapterDeltaEvent = {
  type: "delta";
  runId: string;
  cardId: string;
  textDelta: string;
};

type AdapterCompleteEvent = {
  type: "complete";
  runId: string;
  cardId: string;
  outputText: string;
  finishReason?: string;
  usage?: NormalizedUsage;
  warnings?: NormalizedWarning[];
  completedAt: string;
};

type AdapterErrorEvent = {
  type: "error";
  runId: string;
  cardId: string;
  error: NormalizedError;
  occurredAt: string;
};
```

### 4.2 Usage Contract

```ts
type NormalizedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
};
```

### 4.3 Warning Contract

```ts
type NormalizedWarning = {
  code:
    | "option_ignored"
    | "option_unverified"
    | "partial_usage"
    | "provider_notice";
  message: string;
};
```

### 4.4 Error Contract

```ts
type NormalizedError = {
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
```

## 5. Adapter Interface

Suggested logical interface:

```ts
type ModelAdapter = {
  provider: ProviderId;
  capabilities: AdapterCapabilities;
  run(input: ComparatorRunInput): AsyncIterable<AdapterEvent>;
};
```

### 5.1 Capabilities Contract

```ts
type AdapterCapabilities = {
  supportsStreaming: boolean;
  supportsTemperature: boolean;
  supportsMaxOutputTokens: boolean;
  supportsSystemPrompt: boolean;
  notes?: string[];
};
```

Purpose:

- enable UI hints if needed later
- support diagnostics and documentation
- keep runtime assumptions explicit

## 6. Provider Mapping Rules

### 6.1 Kanana Adapter

Base assumption:

- OpenAI-compatible request style

Expected mapping:

```ts
prompt + systemPrompt -> chat.completions messages[]
stream -> stream
temperature -> unverified
maxOutputTokens -> unverified
```

Contract rules:

- if `temperature` or `maxOutputTokens` are passed, the adapter may:
  - map them if validated later
  - ignore them and emit a warning
- `stream` should be treated as supported

### 6.2 OpenAI Adapter

Preferred mapping:

```ts
prompt -> input
systemPrompt -> instructions
stream -> stream
temperature -> temperature
maxOutputTokens -> max_output_tokens
```

Fallback compatibility mapping if needed:

```ts
prompt + systemPrompt -> messages[]
maxOutputTokens -> max_tokens
```

Contract rules:

- adapter owns whether it uses `Responses API` or a compatibility layer
- UI contract does not change

### 6.3 Gemini Adapter

Expected mapping:

```ts
prompt -> contents.parts.text
systemPrompt -> system_instruction
stream -> streamGenerateContent
temperature -> generationConfig.temperature
maxOutputTokens -> generationConfig.maxOutputTokens
```

Contract rules:

- flatten response parts into one `outputText`
- if the provider returns multiple candidate structures, the adapter chooses the primary candidate

### 6.4 Claude Adapter

Expected mapping:

```ts
prompt -> messages[]
systemPrompt -> system
stream -> stream
temperature -> temperature
maxOutputTokens -> max_tokens
```

Contract rules:

- concatenate text blocks from `content[]`
- normalize provider-specific stop reasons if available

## 7. Streaming Contract

The UI should treat all streaming providers through the same event model.

### Rules

- emit one `start` event before any content
- emit zero or more `delta` events
- emit exactly one terminal event:
  - `complete`, or
  - `error`

- partial text should still be preserved if a late error occurs, where feasible

### UI Expectations

- `start` -> card state becomes `Streaming`
- `delta` -> append to card body
- `complete` -> card state becomes `Completed`
- `error` -> card state becomes `Error`

## 8. Missing Key and Validation Behavior

The adapter must not silently no-op when credentials are missing.

Rules:

- if `apiKey` is missing:
  - emit `error`
  - use `missing_api_key`
  - mark `retryable: true`

- if `prompt` is empty:
  - this should be blocked by the UI before adapter invocation

## 9. Unsupported Option Behavior

The UI can expose common options even when support differs.

Rules:

- unsupported or unverified options should not crash the whole run
- adapters may:
  - ignore the option
  - emit `option_ignored` or `option_unverified`
  - continue the request if safe

Example:

- Kanana receives `temperature`
- adapter cannot verify support
- adapter sends request without `temperature`
- adapter emits warning:
  - code: `option_unverified`
  - message: `Temperature was not forwarded for Kanana because support is not yet validated.`

## 10. Error Normalization Rules

The adapter should convert provider-native failures into user-meaningful categories.

### Recommended Mapping

| Situation | Normalized code |
| --- | --- |
| key absent | `missing_api_key` |
| auth rejected | `invalid_api_key` |
| HTTP 429 | `rate_limited` |
| timeout / fetch failure | `network_error` |
| provider 4xx request error | `invalid_request` |
| provider 5xx | `provider_error` |
| anything uncategorized | `unknown_error` |

## 11. Observability Boundaries

v1 should not log raw prompts or raw API keys outside the local session unless the user later opts into diagnostics.

Adapter-safe telemetry, if any:

- provider
- model
- startedAt
- completedAt
- success/failure
- normalized error code
- latency

Do not collect by default:

- API keys
- full prompt text
- full completion text

## 12. Security Constraints

The contract should assume a BYOK browser-first public app.

Rules:

- adapters must accept runtime keys from the UI, not from a server session
- adapters must not persist keys
- adapters must not embed keys in URLs
- adapters should work with in-memory values only in v1

## 13. Implementation Notes

This contract intentionally leaves room for multiple implementation strategies:

- direct fetch
- official SDK
- lightweight provider wrapper

The contract is about runtime shape, not library choice.

That flexibility matters because browser support and CORS behavior may differ from raw HTTP shape.

## 14. v1 Decisions Locked

- one adapter per provider family
- one normalized request shape from UI
- one normalized event stream back to UI
- card-level isolation for errors
- warnings allowed when parity is incomplete

## 15. Deferred from Contract v1

- multimodal request contract
- tool-calling contract
- persisted run history schema
- share/export schema
- provider-specific advanced settings contract
