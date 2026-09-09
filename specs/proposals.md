# Proposals — post-MVP design

Forward-looking design for Locutus beyond the MVP. Each proposal is a place for the
thinking to live: the problem, decisions locked, options considered, open questions, and
(where useful) an implementation sketch. Nothing here is built yet.

- `requirements.md` / `design.md` describe the **MVP as built**.
- `tasks.md` is the **status checklist** — it points here for each proposal.
- This file is where designs **evolve** before they're scheduled.

Status legend: 🔜 near-term priority · 💡 idea.

> Architectural positioning (AG-UI vs. A2UI, and why a simple media-type-based protocol)
> lives in [`design.md`](./design.md), since it's commentary on the architecture rather
> than a discrete proposal.

---

## P1 — Conversational ease: walkie-talkie mode + turn cues  🔜

**Problem (from user testing).** Cross-talk: (1) the avatar and user talk over each
other, and (3) the user is unsure when it's their turn. Root cause: turn-taking is
implicit, and the always-on mic + automatic TTS mute is fiddly — prior attempts at
automatic mic control caused echo, first-word clipping, and recognizer-restart races.

**Walkie-talkie mode (new, opt-in).** An explicit, user-controlled mic mode offered as a
**mode** — not a replacement for the continuous mic.

- **Latched toggle, NOT press-and-hold:** click to start talking (indicator → 🔴
  "Listening — click when done"), click again to send. Latching avoids the
  pointerdown/up event races that broke the earlier push-to-talk attempt; and because
  the user clicks *then* speaks, `recognition.start()` has warmed up — fixing the
  first-word clipping.
- The mic is only open during the explicit "talking" window, so it can't fight the
  avatar → eliminates cross-talk (#1) by construction and gives a concrete "my turn"
  action (#3).

**A — turn cue.** On handoff to the user (avatar finished / ready for input), make it
unmistakable: status → "Your turn"/"Ready", avatar → 🎤, optional soft chime.

**C — persistent state label.** Always-visible turn state (Speaking / Ready / Talking)
so the user is never guessing.

**Hands-free (continuous) mode** remains the **default**, including the TTS-mute +
best-effort echo strip; monitor for improvements. Walkie-talkie is the opt-in
alternative when cross-talk matters.

**Decisions locked:** latched (not hold) · a mode, not a replacement, hands-free is
default · keep echo-mute for hands-free · scope is turn-taking UX only (the lifecycle
protocol P4 stays separate) · spec-only for now.

---

## P2 — Inbound rich IO: paste/drop images & files via the browser  🔨

**Status:** image **paste** shipped (v1). `POST /api/upload` stores the image and
records a user message with both `image` (absolute path) and `url`; the transcript shows
a thumbnail. Remaining: drag-and-drop, file-picker, non-image files, staged caption UI,
and the UI storage-dir setting.

**Insight.** A CLI is a text-only pipe — you can't paste an image or drop a file into a
terminal. The browser is a first-class IO surface that handles all of it. Since Locutus
already has a browser tab open beside the agent, it can be the agent's **input bridge**
for content the CLI can't accept. This is the **input-direction complement** to P3
(agent→user rendering); here the browser contributes rich content user→agent.

**Killer use case.** Paste a **screenshot** (mockup, diagram, error screen) to a coding
agent — hugely useful and impossible in a raw terminal. Also drag-and-drop files (logs,
CSV, PDF, assets), large/rich text blocks, general clipboard.

**Message shape.** A user message carries a content key (same key-as-type model as P3),
e.g. `{ "source":"user", "image":"/uploads/abc.png", "text":"why is this misaligned?" }`
— may pair with spoken/typed text. Agents consume it via the existing
poll / stream / `GET /api/messages` flow.

**Server implication.** A step up from today's in-memory, text-only model: the server
gains a small **upload/storage** responsibility — the browser uploads the file, the
server stores it and hands the agent a **file path or URL** in the user message.
(Alternative for small images: inline data URI — simpler, no storage, but bloats the
log; prefer upload+path for anything non-trivial.)

**Implementation sketch.**

```
1. User copies a screenshot → OS clipboard holds image data
2. Focus the Locutus tab, Ctrl/Cmd-V
3. Browser `paste` handler grabs the image blob from clipboardData
4. Browser POSTs the blob to the server
5. Server saves it, returns { path, url }
6. Server appends a user message carrying the image reference (+ optional caption)
7. Agent (polling/streaming) sees the message and reads the image from the path/URL
```

- **Capture (browser):** `paste` event (`clipboardData.items`, `image/*` → `getAsFile()`);
  `drop` event for drag-and-drop; `<input type=file>` as a third entry — all funnel to
  the same upload.
- **Upload (server):** `POST /api/upload` (multipart or raw body) → write to `uploads/`
  with a safe generated name → return `{ url: "/uploads/abc.png", path: "/abs/.../abc.png" }`.
- **Reference handed to the agent:** provide **both** path and URL.
  - **Filesystem path** — best for a *local* agent: it reads the file directly with its
    normal file-read tool. This is the elegant part — the filesystem is the shared
    medium, so "paste a screenshot" becomes "here's a file path", which every coding
    agent already knows how to consume. No base64 in the log, no special agent-side
    image handling.
  - **URL** — for remote/browser-fetchable cases.
- **Agent guidance:** one line in `AGENTS.md` — "user messages may include an `image`
  path; read it if present."

**Local vs remote.** Path-passing works when the agent shares a filesystem with the
server (the common local case). Remote agents use the URL and fetch it (network/auth
considerations). **Optimize for local first.**

**UX.** Paste into the room, drag-and-drop onto the avatar/transcript, or a file-picker;
show a thumbnail/chip in the transcript so the user sees what was sent.

**Storage location (as built).** Resolved in one place (`src/config.js`): default
`<os tmpdir>/locutus/uploads` (ephemeral, no repo pollution, matches the in-memory
ethos), overridable via the `LOCUTUS_DATA_DIR` env var. **Eventually a UI setting** the
user sets, applied server-side, with precedence: UI setting → `LOCUTUS_DATA_DIR` →
default. That likely arrives with a general settings mechanism (none exists yet), so it
is deferred; the single config point makes adding it later a small change.

**Security.** Untrusted uploads — validate MIME/size, cap size (10 MB), sanitize/
generate filenames (UUID, never client-supplied), store outside any executable path,
define retention/cleanup, and note the agent will read whatever path it's handed.

**Why it may outrank P3 (output rendering).** "Paste a screenshot to my CLI agent" is a
frequently-wished-for capability with no good terminal-native answer. Voice solves
"don't want to type"; this solves "can't input this as text".

---

## P3 — Renderable content types (content-typed message keys + built-in renderers)  💡

**Idea.** Let a message's **content key name the content type**, so the browser can
render media and declarative DSLs while voice narrates a short caption. Cleaner than a
separate `type`+payload envelope, and additive to today's `text`/`emoji`.

**Message model.** The payload key *is* the type — `{ "text": "…" }` (spoken, as today),
`{ "image": "https://…/chart.png" }`, `{ "vega": { …spec… } }`, plus `mermaid`,
`markdown`, etc. `text` and `emoji` may accompany any content key (avatar speaks the
caption, the content renders below). **One content key per message** besides text/emoji
(define precedence or reject if multiple). Validation on `POST /api/messages` becomes
"at least one recognized content key present."

> **Note on `video`:** dropped from the core set — coding agents don't generate video
> and rarely reference it, and it clashes with voice-first. Trivially addable later
> under the same key-as-type model if a real case (e.g. E2E test recordings) appears.

**Renderers are BUILT-IN, not pluggable** — a fixed set the app ships. Frontend has a
renderer registry keyed on which content field is present; unknown keys fall back to a
caption/link/notice. **`image` is the smallest first renderer; `vega` (Vega-Lite) the
first DSL.**

**Capability discovery — B1 (server-declared).** Add `GET /api/capabilities` returning
the server's declared, built-in content-type list (a constant matching the bundled UI),
e.g. `{ "contentTypes": ["text","emoji","image","vega"] }`. This lets **AGENTS.md stay
concise** — it references `/api/capabilities` as the source of truth instead of
enumerating (and drifting on) the type list.

> **B1 vs B2 (decided: B1).** B2 = browsers report their renderers on connect and the
> server returns the intersection. Rejected: renderers are built-in and ship with the
> server, so a server-declared constant is honest and far simpler. Revisit only if
> pluggable renderers or version-skew handling are ever needed.

**Server stays dumb:** stores/broadcasts whatever content keys arrive (light
validation); the browser owns rendering. Rides the existing SSE channel.

**Constraints.** Treat all payloads as UNTRUSTED (validate `image` as URL/data-URI;
sanitize Markdown/HTML; prefer sandboxable Vega-Lite over full Vega). Transcript shows a
sensible representation (thumbnail/link/caption). `/api/ask` remains speech-only.

**Why this over A2UI for content.** Built-in content types + a small renderer registry
cover the real cases (charts, diagrams, media, tables, math) without a generic component
protocol; keeps the curl/JSON contract simple and voice-first.

**Deferred:** design locked; implement alongside the first renderers (`image`, then `vega`).

---

## P4 — Conversation lifecycle protocol: start / pause / resume / end  💡

**Problem.** Today the flow is implicit; agents just post messages and call `/api/ask`.
There's no session concept, no "get ready / speak now" cue (which contributes to
first-word clipping), and no clean way to pause or end.

**Sketch.**
- **Start:** signal a conversation is beginning so the UI/STT can prepare (prime mic,
  show "session active", optional countdown / "speak now" cue).
- **Pause / resume:** temporarily suspend capture (and optionally TTS) without ending.
- **End:** cleanly close the session, reset UI state, optionally summarize.

**Open questions.** Server-side session endpoints (`/api/session/start|pause|resume|end`
with state) vs. UI/agent conventions (special status messages the avatar interprets);
does pause gate TTS+STT or just listening; visible session indicator + "speak now" cue.

**Related.** Overlaps with P1 (turn cues); would mitigate first-word clipping and remove
ambiguity about whether the mic is actively listening. P1 is the focused near-term slice;
P4 is the fuller protocol.

---

## P6 — Consolidate per-tool agent guidance  💡 (maintenance)

**Problem.** The avatar guidance is duplicated across six per-tool files (`.kiro/agents/
avatar.json`, `.opencode/agents/avatar.md`, `.opencode/skills/avatar-voice/SKILL.md`,
`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`) plus `AGENTS.md`. Every new
capability (e.g. the pasted-image note) has to be fanned out to all of them — a drift/
maintenance smell.

**Idea.** Make **`AGENTS.md` the single source of the HTTP/behaviour contract**, and slim
each per-tool file to only its *tool-specific* bits: the frictionless command config
(trust rules / permissions / launch flags) and a one-line pointer to `AGENTS.md` for the
contract. Future capability docs then land once, in `AGENTS.md`.

**Caveat.** Not every tool auto-reads `AGENTS.md` (Kiro's prompt is inline JSON; Codex
and Copilot do read it). So the per-tool file may still need a short "see AGENTS.md"
nudge or a minimal inlined summary rather than relying on the tool to load it. Weigh
per tool.

**Deferred / spec-only.** Low urgency; do it when the duplication next bites or before
adding another CLI.

