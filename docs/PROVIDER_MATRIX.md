# LLM Comparator Provider Matrix

Last updated: 2026-04-14 (Asia/Seoul)

## Scope

This document defines the v1 integration scope for the comparator dashboard.

- Primary scope: `text input -> text output`
- Primary UX: single dashboard
- First card: fixed `Kanana`
- Additional cards: user-added `GPT`, `Gemini`, `Claude`
- Submission model: parallel execution across selected cards

The goal of this document is to keep provider choices, adapter boundaries, and operating assumptions explicit before implementation starts.

## Product Shape

### Dashboard IA

- Top: `Input Hub`
  - Prompt
  - Optional system prompt
  - Common options
  - API key inputs
  - Submit
- Bottom: `Model Board`
  - Fixed `Kanana` card
  - Dynamic model cards
  - `+` card for adding more providers/models

### Model Add Flow

1. User clicks the `+` card.
2. A modal opens with provider buttons: `GPT`, `Gemini`, `Claude`.
3. After selecting a provider, the model dropdown appears.
4. A new card is added to the board.
5. All cards except `Kanana` can be removed.

## Provider Adapters

The UI should expose one common interaction model, but the runtime should use provider-specific adapters.

| Provider | v1 adapter type | Recommended API path | Notes |
| --- | --- | --- | --- |
| Kanana | OpenAI-compatible | `OpenAI SDK + custom base_url + /v1/chat/completions` | Best fit for parity with existing comparator mental model |
| OpenAI | Native | `Responses API` preferred | `chat.completions` can be used if compatibility pressure is higher than purity |
| Gemini | Native | `generateContent` / `streamGenerateContent` | Prefer native API over compatibility layers |
| Claude | Native | `/v1/messages` | Native API keeps payload and streaming behavior explicit |

## Recommended Curated Models

These are the first models to expose in the recommended section of the add-model modal.

### Kakao / Kanana

| Model ID | Status | Role |
| --- | --- | --- |
| `kanana-o` | Active | Fixed baseline card for all comparisons |

Notes:

- Public API release: `2026-03-04`
- Model release date: `2026-02-12`
- Public HF API doc is currently the clearest source of truth for external access.

### OpenAI

| Model ID | Status | Role |
| --- | --- | --- |
| `gpt-5.4` | Active | top-end reasoning baseline |
| `gpt-5.4-mini` | Active | balanced default |
| `gpt-5.4-nano` | Active | low-cost / fast option |
| `gpt-4.1` | Active | non-reasoning comparison baseline |

### Gemini

| Model ID | Status | Role |
| --- | --- | --- |
| `gemini-3.1-pro-preview` | Preview | latest high-end preview |
| `gemini-3-flash-preview` | Preview | latest balanced preview |
| `gemini-3.1-flash-lite-preview` | Preview | latest lightweight preview |
| `gemini-2.5-pro` | Stable | stable high-end baseline |
| `gemini-2.5-flash` | Stable | stable balanced default |
| `gemini-2.5-flash-lite` | Stable | stable lightweight baseline |

### Claude

| Model ID | Status | Role |
| --- | --- | --- |
| `claude-opus-4-6` | Active | top-end intelligence baseline |
| `claude-sonnet-4-6` | Active | balanced default |
| `claude-haiku-4-5` | Active | low-cost / fast option |

## Connection Matrix

This table is for implementation planning, not for user-facing copy.

| Provider | Models in scope | Auth input | Connection shape | Text extraction |
| --- | --- | --- | --- | --- |
| Kanana | `kanana-o` | user-entered API key | `OpenAI(base_url=...) -> chat.completions.create(...)` | `choices[0].message.content` or stream delta |
| OpenAI | `gpt-5.4*`, `gpt-4.1` | user-entered API key | `responses.create(...)` or compatibility fallback | `response.output_text` or event stream |
| Gemini | `gemini-2.5*`, `gemini-3*` | user-entered API key | `generateContent` / `streamGenerateContent` | `candidates[].content.parts[]` |
| Claude | `claude-*` | user-entered API key | `POST /v1/messages` | concatenate `content[]` text blocks |

## Common Option Support

Current v1 product stance:

- `stream`: common option, default `ON`
- `temperature`: common advanced option
- `max output`: common advanced option

### Support Status

| Provider | Model group | Temperature | Max output | Stream | Confidence |
| --- | --- | --- | --- | --- | --- |
| Kanana | `kanana-o` | not publicly verified | not publicly verified | verified | medium |
| OpenAI | `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-4.1` | supported | supported | supported | high |
| Gemini | `gemini-2.5*`, `gemini-3*` | supported | supported | supported | high |
| Claude | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` | supported | supported | supported | high |

### UI to Provider Parameter Mapping

| UI option | Kanana | OpenAI | Gemini | Claude |
| --- | --- | --- | --- | --- |
| `stream` | `stream` | `stream` | streaming endpoint / SDK stream | `stream` |
| `temperature` | unverified | `temperature` | `generationConfig.temperature` | `temperature` |
| `max output` | unverified | `max_output_tokens` or `max_tokens` | `generationConfig.maxOutputTokens` | `max_tokens` |

### Product Note

The UI should present a common option layer, but the implementation should not assume provider parity. The adapter must translate or ignore options safely on a per-provider basis.

## Security and Operating Model

The current recommended operating model is `BYOK` with no server-side persistence.

### Principle

- Users enter their own provider API keys.
- Keys must not be stored on our server.
- Keys should not be persisted by default.
- The safest public claim is: `we do not send or store your keys on our server`.

### Recommended Runtime Model

- Public app shape: static web app
- Deployment target: Vercel
- Key usage: browser-side only
- Default key lifetime: in-memory only
- Refresh behavior: key is cleared on reload

### Guardrails

- No key in URL or query params
- No server relay for user provider keys in v1
- No default `localStorage` persistence
- No logging, analytics, or session replay for raw key values
- Sensitive fields should disable browser autofill where practical
- Add `Clear all keys` action
- Add visible trust note in the settings area

### Recommended User-Facing Copy

- `Your API keys are not stored on our server.`
- `Keys are used only to call providers directly from your browser.`
- `For high-trust use, run locally or self-host.`

## Deployment Recommendation

### Preferred

`Web app + Vercel`

Why:

- The product is UI-heavy and comparison-first.
- Parallel streaming cards are better suited to a web app than a server-rendered Python app shell.
- Browser-first BYOK aligns better with the non-storage requirement.
- The existing workflow dashboard is already a strong UI reference.

### Not Preferred for v1

`Python + Streamlit`

Why:

- Streamlit keeps user interaction state on the app server.
- Even if keys are not persisted, the server process still sees the user input.
- The resulting trust model is weaker than a browser-first public comparator.

## Known Risks and Pending Validation

- Kanana public docs clearly show `stream=True`, but do not explicitly show `temperature` or `max_tokens`.
- Browser-direct CORS behavior must still be validated per provider.
- SDK choice must account for browser constraints, not only HTTP payload shape.
- `remember key on this device` should be deferred until trust messaging and local-storage policy are intentionally designed.

## Source References

- Kanana API doc:
  - https://huggingface.co/kakaocorp/Kanana-1.5-o-9.8B-instruct-2602-API_Doc
- OpenAI:
  - https://developers.openai.com/api/docs/models
  - https://developers.openai.com/api/reference/resources/responses/methods/create
  - https://developers.openai.com/api/docs/models/gpt-5.4
  - https://developers.openai.com/api/docs/models/gpt-5.4-mini
  - https://developers.openai.com/api/docs/models/gpt-5.4-nano
  - https://developers.openai.com/api/docs/models/gpt-4.1
- Gemini:
  - https://ai.google.dev/gemini-api/docs/models
  - https://ai.google.dev/gemini-api/docs/changelog
  - https://ai.google.dev/gemini-api/docs/text-generation
- Claude:
  - https://platform.claude.com/docs/en/about-claude/models/overview
  - https://platform.claude.com/docs/en/release-notes/overview
  - https://platform.claude.com/docs/en/api/messages/create
