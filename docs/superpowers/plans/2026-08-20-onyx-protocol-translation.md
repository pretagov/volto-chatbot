# Onyx Protocol Translation Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chatbot work against upgraded Onyx again by translating the new streaming protocol into the shape the existing components already parse — without editing them.

**Status:** The deployed demo's chat is **broken**. This is not a polish task.

**Architecture:** The translation lives in `packages/middleware`, which is entirely our code. The frontend keeps speaking the protocol it already knows, so `useBackendChat.js` and friends stay mergeable with upstream. One layer serves both the Volto add-on and the embeddable widget.

**Tech Stack:** Node 20, Express, Vitest (existing middleware workspace).

---

## What broke

Upgraded Onyx renamed the endpoint and replaced the wire format:

| | Before | After |
| --- | --- | --- |
| Endpoint | `POST /api/chat/send-message` | `POST /api/chat/send-chat-message` |
| Request | old ad-hoc body | `SendMessageRequest { message, llm_override, file_descriptors, deep_research, … }` |
| Stream | flat packets: `{answer_piece}`, `{top_documents}`, `{tool_name}` | NDJSON of `Packet { placement, obj: { type, … } }` |

The frontend still calls the old endpoint, so **every request 404s**.

**Upstream has not fixed this.** `eea/master` (v2.0.4) still calls `chat/send-message`; its `_v1_da` prefix is only its own proxy naming and still maps to `${DANSWER_URL}/api${path}`. There is no Onyx v1 compatibility layer — nothing is mounted under `/v1`. We are ahead of upstream into this problem, and 155 commits ahead / 280 behind overall.

## Why translate rather than fix the frontend

`useBackendChat.js` is among the most-churned files in the add-on, and upstream is 280 commits ahead on the old protocol. Rewriting its parser means permanent divergence in exactly the file we can least afford to fork. The middleware is ours alone, already has 85 tests and a mock, and serves both consumers. If EEA migrate later, the shim is deleted.

This is the same "add, don't move" principle the widget design rests on.

## Packet mapping

| Frontend expects | New packet | Notes |
| --- | --- | --- |
| `{answer_piece}` | `message_delta` → `AgentResponseDelta.content` | the answer text |
| `{top_documents, rephrased_query}` | `search_tool_documents_delta.documents`, `message_start.final_documents` | citations source |
| `{tool_name, tool_args}` | `custom_tool_start`, `custom_tool_args` | |
| citation refs | `citation_info { citation_number, document_id }` | |
| TableRAG progress | `custom_tool_delta` | see Task 4 |
| error | `error` → `PacketException.exception` | |
| end of turn | `stop` → `OverallStop.stop_reason` | |
| `{user_message_id, reserved_assistant_message_id}` | synthesised | the new protocol does not carry these |

Unmappable packet types (`deep_research_*`, `python_tool_*`, `bash_tool_*`, `memory_tool_*`, `coding_agent_*`) are dropped: the current UI has nothing to render them with, and inventing a rendering is out of scope.

## Endpoint corrections

My existing allowlist was verified against the mock, not real Onyx. Corrected:

| Path | Status |
| --- | --- |
| `chat/send-message` | **gone** — replaced by `chat/send-chat-message` |
| `chat/create-chat-session` | exists |
| `chat/create-chat-message-feedback` | exists |
| `health` | exists at **root** `/health`, not `/api/health` — the rewake ping needs remapping |

---

## Task 1: Fix the allowlist and health path

**Files:** Modify `packages/middleware/src/proxy.js`, `packages/middleware/src/proxy.test.js`

- [ ] **Step 1:** Add a failing test — `/_da/chat/send-chat-message` resolves, `/_da/chat/send-message` does not, and `/_da/health` maps to `/health` rather than `/api/health`.
- [ ] **Step 2:** Run, expect failure.
- [ ] **Step 3:** Update `ALLOWED_PATHS` and give `resolveOnyxPath` a per-path prefix so `health` bypasses `/api`.
- [ ] **Step 4:** Run, expect pass.
- [ ] **Step 5:** Commit.

## Task 2: Translate the response stream

**Files:** Create `packages/middleware/src/protocol.js`, `packages/middleware/src/protocol.test.js`

The core of the plan. A pure function from a new-protocol packet to zero or more
old-format packets, so it is testable without a server.

- [ ] **Step 1: Write the failing tests**, one per mapping row above, plus:
  - an unknown packet type yields nothing rather than throwing (upstream will add types)
  - `message_delta` packets concatenate rather than replace
  - `citation_info` is emitted in the shape the citation renderer expects
  - a malformed line is skipped rather than killing the stream
- [ ] **Step 2:** Run, expect failure.
- [ ] **Step 3: Implement** `translatePacket(packet) -> object[]` and
  `createTranslateStream()` returning a `Transform` that parses NDJSON, translates,
  and re-emits NDJSON. It must stay incremental — no buffering the whole answer.
- [ ] **Step 4:** Run, expect pass.
- [ ] **Step 5:** Commit.

## Task 3: Translate the request and wire it in

**Files:** Modify `packages/middleware/src/proxy.js`, `packages/middleware/src/routes.js`, tests

- [ ] **Step 1:** Failing test — a POST to `/_da/chat/send-message` reaches Onyx as `send-chat-message` with a `SendMessageRequest`-shaped body, still pinned to the tenant's assistant.
- [ ] **Step 2–5:** implement `translateRequest`, pipe the response through
  `createTranslateStream()`, verify, commit.

Keep accepting the old path from clients: the frontend is what we are avoiding
changing, so the old name is the public contract now and the rename is internal.

## Task 4: TableRAG emits tool packets, not reasoning

**Files:** Modify `onyx/backend/onyx/tools/tool_implementations/search/search_tool.py`, `onyx/backend/onyx/table_processing/progress.py` (**onyx repo**)

TableRAG currently yields `TableRagProgressPiece`, which `search_tool.py` converts
into `ReasoningStart`/`ReasoningDelta`. That claims the model reasoned its way to
an answer when in fact a SQL query ran. TableRAG is a tool, so it should say so.

- [ ] **Step 1:** Failing test — running the pipeline emits `custom_tool_start`
  with a `table_query` tool name, `custom_tool_args` carrying the table and SQL,
  and `custom_tool_delta` per progress step.
- [ ] **Step 2–5:** implement, verify, commit.
- [ ] Drop the vestigial `answer_type` field from `TableRagProgressPiece`, which
  only existed to mimic the removed `AgentAnswerPiece`.

## Task 5: Mock the new protocol

**Files:** Modify `tests-playwright/fixtures/mock-onyx-server.js`

The mock currently serves the **old** endpoint and format, which is why the
Playwright suite passed while production was broken. That is the bug that let this
reach a deployed demo.

- [ ] **Step 1:** Add `POST /api/chat/send-chat-message` streaming NDJSON
  `Packet` objects: `message_start`, `search_tool_documents_delta`,
  `custom_tool_start`/`args`/`delta`, several `message_delta`, `citation_info`,
  `stop`.
- [ ] **Step 2:** Keep the old `send-message` route temporarily, marked deprecated,
  so the suite can be migrated test by test.
- [ ] **Step 3:** Point the Playwright suite at the middleware rather than the raw
  mock, so it exercises the translation.
- [ ] **Step 4:** Commit.

## Task 6: Point Volto at the hosted middleware

**Files:** Modify `src/index.js` registration or deployment config (**decision required**)

The in-Volto proxy (`src/middleware.js`) is upstream's file, so it cannot carry the
translation without diverging — which is the thing this plan exists to avoid. Plone
should therefore use the hosted middleware.

This reverses the earlier "keep both proxies, hosted is authoritative for embedded
sites only" decision, and it is the main consequence of this plan.

- [ ] **Step 1:** Confirm the approach before implementing — the alternative is a
  translation copy inside the add-on, accepting the divergence.
- [ ] **Step 2–4:** implement, verify against the demo, commit.

---

## Done when

- `pnpm --filter @pretagov/chatbot-middleware test` passes
- The Playwright suite passes **through the middleware** against the new-protocol mock
- The deployed demo answers a question again
- No file under `src/` has been modified

## Out of scope

Rendering the new capabilities the old protocol had no equivalent for — deep
research, python/bash tools, memory, coding agent. They are dropped in translation
and can be surfaced later if wanted.
