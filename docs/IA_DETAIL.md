# LLM Comparator IA Detail

Last updated: 2026-04-14 (Asia/Seoul)

Related docs:

- [PROVIDER_MATRIX.md](/Users/lux/Documents/kakao-kanana-llm-comparator/docs/PROVIDER_MATRIX.md)
- [ADAPTER_CONTRACT.md](/Users/lux/Documents/kakao-kanana-llm-comparator/docs/ADAPTER_CONTRACT.md)
- [HISTORY.md](/Users/lux/Documents/kakao-kanana-llm-comparator/HISTORY.md)

## Goal

Define the detailed information architecture for the v1 comparator dashboard.

Scope:

- `text input -> text output`
- single-screen comparator
- fixed `Kanana` baseline
- user-added comparison cards
- common options with provider adapter translation

## Page Map

```text
Comparator Dashboard
├─ Top Bar
├─ Input Hub
├─ Model Board
├─ Add Model Modal
└─ Utility Layer
```

There is no landing page in v1.

## 1. Top Bar

Purpose:

- establish product identity
- state current mode
- surface low-frequency help actions

Contents:

- product name
- mode badge: `Text -> Text`
- help entry point
- trust/security shortcut

Recommended labels:

- Title: `Kanana Comparator`
- Mode badge: `Text Compare`
- Help CTA: `How it works`
- Security CTA: `Keys & Privacy`

## 2. Input Hub

Purpose:

- gather the prompt
- configure common generation behavior
- manage provider keys
- trigger one comparison run

### 2.1 Input Hub Structure

```text
Input Hub
├─ Prompt Area
├─ Optional System Prompt
├─ Prompt Presets
├─ Common Options
├─ API Key Drawer
└─ Submit Row
```

### 2.2 Prompt Area

Contents:

- main textarea
- character count
- optional clear action

Rules:

- this is the only required field for a run
- empty prompt disables submit
- multiline input is supported

### 2.3 Optional System Prompt

Default:

- collapsed

Purpose:

- advanced instruction layer for controlled comparisons

Rules:

- global across all cards in v1
- not provider-specific in the UI

### 2.4 Prompt Presets

Purpose:

- accelerate first-run usage
- anchor Kanana-centric usage scenarios

Recommended presets:

- `Korean Polish`
- `Hook Copy`
- `Concept Explain`
- `Summary`
- `Tone Rewrite`

Behavior:

- selecting a preset fills the prompt textarea
- preset selection does not auto-run

### 2.5 Common Options

Scope:

- shared UI controls only
- actual translation happens in provider adapters

Visible by default:

- `Stream` toggle

Collapsed advanced options:

- `Temperature`
- `Max output`

Rules:

- `Stream` default is `ON`
- advanced values apply to all cards in the run
- unsupported provider behavior should surface as a card-level note, not as a global failure

### 2.6 API Key Drawer

Purpose:

- keep the primary surface clean
- allow per-provider BYOK configuration

Sections:

- `Kanana API Key`
- `OpenAI API Key`
- `Gemini API Key`
- `Claude API Key`

Rules:

- hidden by default
- values stored in memory only in v1
- `Clear all keys` action included
- each input should show provider-specific placeholder text

Trust note:

- `Keys are not stored on our server.`
- `Keys are used only in your browser for provider requests.`

### 2.7 Submit Row

Contents:

- primary `Submit` button
- optional secondary `Reset run` action

Rules:

- submit uses the current prompt, system prompt, options, and card set as a single run snapshot
- input hub stays visible during execution

## 3. Model Board

Purpose:

- show all selected models side by side
- stream or render their outputs independently

### 3.1 Board Composition

```text
Model Board
├─ Fixed Kanana Card
├─ Dynamic Model Cards...
└─ Add Model Card (+)
```

Rules:

- `Kanana` is always first
- `+` card is always last
- dynamic cards are inserted between them

### 3.2 Card Anatomy

Each model card should contain:

- header
- status row
- response body
- footer actions

#### Header

- provider badge
- model name
- removable cards only: `X` button on top-right
- fixed Kanana card: `Fixed` badge instead of delete

#### Status Row

Possible states:

- `Idle`
- `Queued`
- `Streaming`
- `Completed`
- `Error`
- `Missing Key`

Optional metadata:

- latency
- token usage when available

#### Response Body

Rules:

- text-first rendering
- preserve whitespace reasonably
- support long outputs with internal scroll
- while streaming, append text incrementally

#### Footer Actions

- `Copy`
- optional `Retry`
- optional `Expand`

### 3.3 Board-Level Behavior

Rules:

- cards run in parallel after submit
- completed cards become readable immediately
- one card failing does not block the others
- if a required key is missing, only that card fails

## 4. Add Model Modal

Purpose:

- add new comparison cards without cluttering the board

### 4.1 Modal Flow

```text
Add Model
├─ Provider Picker
├─ Recommended Models
├─ Full Chat Model List
└─ Add Action
```

### 4.2 Provider Picker

Buttons:

- `GPT`
- `Gemini`
- `Claude`

Rules:

- one provider active at a time
- changing provider resets model selection

### 4.3 Recommended Models

Purpose:

- fast path for common comparisons

Behavior:

- shown first
- sorted by product recommendation, not by raw release date

### 4.4 Full Chat Model List

Purpose:

- allow deeper model comparisons beyond the curated set

Recommended controls:

- search box
- status filters:
  - `Stable`
  - `Preview`
  - `Deprecated` later, not required in v1

Rules:

- only text-chat-capable models should appear in v1
- non-chat, audio-only, image-generation-only models stay out of scope

### 4.5 Add Action

Rules:

- disabled until a model is selected
- after add:
  - create the card
  - insert before the `+` card
  - close the modal

Open question:

- duplicate model instances are still undecided

## 5. Utility Layer

Purpose:

- handle low-latency feedback without disturbing the board

Includes:

- toast notifications
- copy confirmation
- non-blocking warnings
- global fatal error banner only when the whole app is broken

## 6. Main User Flows

### Flow A: First Run

1. User enters prompt.
2. User opens key drawer and adds required keys.
3. User optionally adds GPT, Gemini, Claude cards.
4. User presses submit.
5. Cards run in parallel.
6. Outputs appear progressively.

### Flow B: Add Another Model

1. User clicks the `+` card.
2. User selects provider.
3. User chooses a model.
4. A new card appears.
5. User reruns the same prompt.

### Flow C: Missing Key

1. User runs without one provider key.
2. Relevant card enters `Missing Key`.
3. Other cards continue normally.
4. User opens key drawer and retries later.

### Flow D: Prompt Iteration

1. User edits the prompt while previous results remain visible.
2. User submits again.
3. Current board composition stays the same.
4. Card states reset for the new run.

## 7. State Model

The UI should think in terms of three layers:

### Global UI State

- modal open/close
- active provider in modal
- key drawer open/close
- preset selection

### Run State

- prompt snapshot
- system prompt snapshot
- common option snapshot
- selected card list snapshot
- run identifier

### Card State

- provider
- model
- lifecycle status
- output text
- usage metadata
- error metadata

## 8. Empty, Loading, and Error States

### Empty Board

Default board:

- fixed Kanana card in `Idle`
- `+` card visible
- hint text explaining how to add comparison models

### Loading

Rules:

- use card-level loading rather than full-page takeover
- streaming cards should feel active without collapsing the rest of the board

### Error

Rules:

- local provider errors stay local to the card
- app boot failures can use a top-level banner

## 9. Responsive Behavior

Desktop:

- horizontal comparison board
- cards shown in columns

Tablet:

- fewer visible columns
- horizontal scroll still acceptable

Mobile:

- stacked card layout is acceptable
- modal may become a bottom sheet
- input hub remains above results

## 10. Content and Copy Rules

Tone:

- utility-first
- concise
- technical but not opaque

Do:

- explain state clearly
- surface missing key issues directly
- make copy shareable and screenshot-friendly

Do not:

- overclaim fairness or scientific rigor
- imply provider parity where the adapters differ

## 11. IA Decisions Locked for v1

- single-screen dashboard
- fixed Kanana baseline card
- add-model modal flow
- common options with provider translation
- stream default `ON`
- BYOK key drawer in memory only

## 12. Deferred from IA v1

- score/judge mode
- shareable public comparison permalink
- saved comparison history
- image/audio/document modes
- provider-specific advanced settings panes
