# Implementation Plan: Agent Avatar UI

## Milestone 0 — MVP (single agent, emoji avatar)

Goal: prove the full loop (agent curl → spoken emoji avatar → mic reply → agent reads it)
with the smallest possible build. Single hardcoded agent, in-memory, browser TTS/STT.

- [x] M0.1 Minimal Node project
  - `package.json` with `express`; `start` script; `public/` + `src/server.js`.
  - _Requirements: MVP Scope, NFR3_

- [x] M0.2 In-memory conversation log (single conversation)
  - Simple array of `{ id, source, text, emoji, ts }` with an incrementing cursor.
  - `append()` and `getSince(cursor)`.
  - _Requirements: MVP acceptance 1 & 4, FR7.2_

- [x] M0.3 Minimal API
  - `POST /api/messages` — agent posts `{ text, emoji? }` (single agent, no agentId).
  - `GET /api/messages?since=<cursor>` — agent reads user replies.
  - `POST /api/user/messages` — UI posts user reply.
  - Validate: reject when both `text` and `emoji` are empty; validate/truncate `emoji`.
  - _Requirements: MVP acceptance 1, 3, 4; FR1.1, FR1.2, FR5, FR7.2_

- [x] M0.4 SSE broadcast to browser
  - `GET /api/stream` (SSE); on new message push it to connected clients; send recent
    history snapshot on connect. (Originally built on WebSocket; switched to SSE since
    the browser only receives — one push mechanism now shared with agents.)
  - _Requirements: MVP acceptance 1, FR3.1_

- [x] M0.5 Frontend: emoji avatar + TTS
  - Single large emoji avatar. Connect via `EventSource('/api/stream')`.
  - Set the avatar face to the message's `emoji` (default 🤖 when none supplied).
  - On agent message with text: speak via `speechSynthesis` and bounce the emoji while
    speaking; a message with `emoji` and no `text` updates the face without speaking.
  - Show a simple transcript line.
  - _Requirements: MVP acceptance 1 & 2, FR4.1, FR4.3, FR5_

- [x] M0.6 Frontend: mic input + STT
  - Click-to-toggle mic using browser SpeechRecognition (continuous); shows live
    interim transcript. On result, POST to `/api/user/messages`. Typed fallback input.
  - Robustness: preserve the last non-empty interim so trailing empty results don't
    drop the text; auto-restart across natural pauses; flush leftover on stop; handle
    permission errors gracefully. (Push-to-talk/mode-toggle were tried and dropped in
    favor of this single reliable model.)
  - Echo prevention (best-effort): keep recognition running continuously (stopping it
    clips the reply's first word) and strip from each transcript any contiguous run
    that fuzzily matches the just-spoken text (handles US/UK spelling + minor STT
    slips via edit-distance), keeping the remainder. Removes full-question echo
    reliably; short/variant echoes may slip through. Headphones recommended for clean
    capture (documented in README).
  - _Requirements: MVP acceptance 3, FR6.1, FR6.2, FR6.4, FR6.6_

- [x] M0.7 MVP smoke test
  - Manual: `curl` a message, hear it, speak a reply, `curl GET` to read it back.
  - README with the exact `curl` commands.
  - _Requirements: MVP acceptance 1–4, NFR1_

- [x] M0.8 `avatar` CLI accessory + blocking ask
  - Dependency-free `bin/avatar` with `say`, `state`, `ask`, `listen`, `pipe`.
  - Blocking `GET /api/ask` (speak prompt, long-poll for reply, 408 on timeout) and an
    `avatar ask` command so a full voice Q&A is one fast, single-approval call.
  - AGENTS.md rewritten as a TUI accessory guide (curl-first + CLI; Kiro/opencode/pi).
  - _Requirements: MVP acceptance 3, NFR1, FR7.3_

- [x] M0.9 UI polish
  - Live status line reflecting real state (connected / agent speaking / ready /
    listening / you replied / disconnected).
  - `Cache-Control: no-store` on static assets so frontend edits show on a plain
    refresh during development.
  - _Requirements: FR3.3, FR4.3_

- [x] M0.10 Hands-free agent integration (trust + guidance)
  - Kiro: `.kiro/agents/avatar.json` pre-trusts curl-to-`localhost:3000/api/` (and the
    `avatar` CLI) and narrates progress / uses `/api/ask` for input. Verified live.
  - opencode: `opencode.json` permissions + `.opencode/agents/avatar.md` +
    `.opencode/skills/avatar-voice/SKILL.md` (curl and CLI). Config validated; runtime
    test pending (opencode not installed in this env).
  - _Requirements: NFR1, NFR3_

---

## Post-MVP (full build)

The tasks below expand the MVP into the full multi-agent design. Start these only after
Milestone 0 works end to end.


- [ ] 1. Project scaffolding
  - Initialize Node.js project (`package.json`, scripts, LTS engines field).
  - Add dependencies: `express`; dev: `supertest`, test runner (node:test or vitest).
  - Create directory structure per design (`src/`, `public/`, `test/`).
  - Add a `start` script and a basic `README` with run instructions.
  - _Requirements: NFR3_

- [ ] 2. Core conversation store
  - Implement append-only message log with monotonic cursor and bounded buffer.
  - `append(msg)` returns stored message with `id`, `cursor`, `ts`.
  - `getSince(cursor)` returns new messages + latest cursor.
  - Unit tests: ordering, cursor increments, buffer bound eviction.
  - _Requirements: FR7.2, FR8.1_

- [ ] 3. Agent registry
  - `Map`-based registry with `register/update` and `list`.
  - Auto-register unknown agents with default `displayName`, `avatar`, `voice`.
  - Unit tests: registration, defaults, update, auto-register path.
  - _Requirements: FR2.1, FR2.2, FR1.3_

- [ ] 4. REST API endpoints
  - `POST /api/agents` register/update profile.
  - `GET /api/agents` list roster.
  - `POST /api/agents/:agentId/messages` with validation (empty text/emoji → 400).
  - `GET /api/messages?since=<cursor>` poll.
  - `POST /api/user/messages` user reply.
  - Wire endpoints to registry + conversation store.
  - Integration tests (supertest): post→poll round-trip, validation errors, user reply.
  - _Requirements: FR1.1, FR1.2, FR1.4, FR2, FR5, FR7.1, FR7.2_

- [ ] 5. Broadcast hub (SSE) + roster
  - Extend the SSE hub (`GET /api/stream`, already built in M0.4) to also send a
    `roster` event on connect and when agents register/update.
  - On new message (agent or user): broadcast `message` event to all subscribers.
  - Clean up clients on connection close.
  - Test: SSE client receives roster + history on connect and message on broadcast.
  - _Requirements: FR3.1, FR3.2, FR7.1_

- [ ] 6. (done in MVP) SSE stream
  - `GET /api/stream` is implemented in M0.4 and shared by the UI and agents; it works
    from plain `curl`. Post-MVP just adds the `roster` event (task 5).
  - _Requirements: FR7.3_

- [ ] 7. Frontend shell + connection layer
  - Static `index.html`, `styles.css`, served by Express from `public/`.
  - `EventSource('/api/stream')` (SSE auto-reconnects natively).
  - Handle `roster`, `history`, `message` events; render transcript panel.
  - _Requirements: FR3.1, FR3.3, FR8.2_

- [ ] 8. Avatar stage rendering
  - Render one avatar per agent with `displayName`.
  - Display each agent's current emoji expression; update on each message's `emoji`.
  - Speaking indicator/animation hooks (start/stop).
  - _Requirements: FR2.3, FR4.3, FR5_

- [ ] 9. Text-to-speech + speech queue
  - `SpeechQueue` serializing utterances (no overlap).
  - Map `agentId → voice`; consistent per-agent voice selection.
  - Drive avatar speaking-start/speaking-end animation from TTS events.
  - Apply per-message emoji; emoji-only messages update expression without speaking.
  - Graceful fallback + notice if `speechSynthesis` unavailable.
  - _Requirements: FR4.1, FR4.2, FR4.3, FR4.4, FR5_

- [ ] 10. Microphone input + STT
  - Mic toggle using browser SpeechRecognition; show interim transcript.
  - On final transcript, POST to `/api/user/messages`.
  - Typed-text fallback input for no-mic scenarios.
  - Graceful fallback + notice if recognition unavailable.
  - _Requirements: FR6.1, FR6.2, FR6.3, FR6.4_

- [ ] 11. End-to-end wiring and manual checklist
  - Verify agent `curl` → spoken output → mic reply → agent retrieval loop.
  - Document a manual browser test checklist (TTS, mic, animation, reconnect).
  - Update README with `curl` examples from the design.
  - _Requirements: NFR1, NFR2, NFR5_

- [ ] 12. (Optional) Pluggable TTS/STT + persistence
  - Define TTS/STT provider interfaces to allow cloud providers later.
  - Optional NDJSON append-only persistence for the conversation log.
  - _Requirements: NFR4, Open Questions 1 & 3_

---

## Backlog / Ideas (not yet scheduled)

- [ ] Conversation lifecycle protocol — explicit start / pause / resume / end
  - **Problem:** today the flow is implicit; agents just post messages and call
    `/api/ask`. There's no session concept, no "get ready / speak now" cue (which
    contributes to first-word clipping), and no clean way to pause or end.
  - **Sketch:**
    - Start: signal a conversation is beginning so the UI/STT can prepare (prime mic,
      show "session active", optional countdown / "speak now" cue).
    - Pause / resume: temporarily suspend capture (and optionally TTS) without ending.
    - End: cleanly close the session, reset UI state, optionally summarize.
  - **Open questions:** server-side session endpoints (`/api/session/start|pause|
    resume|end` with state) vs. UI/agent conventions (special status messages the
    avatar interprets); does pause gate TTS+STT or just listening; visible session
    indicator + "speak now" cue in the UI.
  - **Related:** would mitigate the first-word clipping seen in testing and remove
    ambiguity about whether the mic is actively listening.

- [ ] Interaction protocol alignment — AG-UI vs. A2UI (strategic)
  - **Context:** Locutus is conceptually an **AG-UI**-style channel — an event-based,
    bi-directional, multimodal Agent↔User Interaction protocol (agent streams events
    to the browser via SSE; user events posted back over HTTP). The current bespoke
    envelope (`{text, emoji}` + SSE `history`/`message`) is effectively a mini-AG-UI.
  - **Direction:** if we want a standard, align event/message shapes toward **AG-UI**
    (the agent↔user layer) rather than A2UI. AG-UI sits alongside MCP (agent↔tools)
    and A2A (agent↔agent).
  - **A2UI's role:** A2UI is a *generative UI* spec (agent streams component trees +
    data binding for a generic renderer). NOT needed to have UI — our components are
    a known, app-owned set. Only warranted if agents must generate arbitrary,
    open-ended interactive UI at runtime. A2UI can layer over AG-UI if that need
    arises; treat as optional, not core.

- [ ] Renderable content types via pluggable DSL renderers
  - **Idea:** let messages carry a content `type` + payload so the browser can render
    rich, declarative third-party DSLs — while voice narrates a short caption. This is
    more natural for agents (emit a standard spec) and cheaper than a generic UI
    protocol.
  - **Shape:** extend the message with an optional `type` + payload, e.g.
    `{ "type": "vega-lite", "spec": {…} }`, `{ "type": "mermaid", "source": "…" }`,
    `{ "type": "markdown", "text": "…" }`. Default `text`/`emoji` messages are spoken
    as today; typed messages render below the avatar. The agent may still send a short
    spoken caption alongside (voice narrates, visual renders).
  - **Frontend:** a renderer registry keyed by `type` (text/emoji default, `vega-lite`
    → Vega-Embed, `mermaid`, `markdown`, …). Unknown types fall back to text/notice.
    **Vega-Lite is the reference first renderer.**
  - **Constraints:** treat all payloads as UNTRUSTED (sanitize Markdown/HTML; prefer
    declarative/sandboxable Vega-Lite over full Vega expression features); lazy-load
    renderer libraries per type so the base voice UI stays light.
  - **Why this over A2UI for content:** domain DSLs + a small renderer registry cover
    the real cases (charts, diagrams, tables, math) without adopting a generic
    component protocol; keeps the curl/JSON agent contract simple and voice-first.
