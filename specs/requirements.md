# Requirements: Agent Avatar UI

## Overview

A web-based interface where CLI agents (e.g. automated scripts, AI agents running in
terminals) send text messages to a backend over a simple HTTP API. Each agent is
represented by an avatar in the browser that "speaks" the message aloud using
text-to-speech and visual animation. A human user can respond by speaking into their
microphone; speech is transcribed and made available back to the agents.

The goal is a real-time, voice-driven "room" where multiple headless agents and one
human can converse.

Agents integrate over a simple HTTP contract — plain `curl` is the primary, most
portable path (easy to pre-approve in a tool's command allowlist), and the bundled
`avatar` CLI is an equally-valid alternative integration with shorter commands and a
`pipe` mode. Per-tool guidance and frictionless command config ship for several
assistant CLIs (see README's Supported CLIs table).

## Actors

- **CLI Agent** — A headless process (script, bot, LLM agent) that posts messages via
  HTTP (e.g. `curl`) and polls/streams for user replies. Identified by an agent ID.
- **Human User** — Person viewing the web UI, hears agent messages, speaks replies.
- **Backend** — Node.js server that receives agent messages, broadcasts to the UI,
  and collects user speech for agents to retrieve.

## MVP Scope (v0 — quick test)

The very first version is a minimal end-to-end test to prove the loop works. It is
deliberately stripped down:

- **Single agent only.** No roster, no multi-agent layout. One hardcoded agent.
- **Emoji avatar with agent-supplied emotion.** The avatar is a single emoji rendered
  large, not an image or animation asset. The agent MAY include an `emoji` with each
  message to convey its state/emotion (e.g. 🤔 thinking, 😕 confused, 🎉 celebrating,
  ✅ done). The avatar shows that emoji; if none is supplied it uses a default (🤖).
  "Speaking" is shown with a simple bounce/animation of the current emoji.
- **One shared conversation.** No sessions/rooms beyond a single log.
- **No auth, no persistence.** In-memory only; state resets on restart.
- **Browser-native TTS/STT.** No cloud providers.

MVP acceptance (the loop that must work):
1. An agent runs `curl POST` a message → it appears in the browser and is spoken aloud.
2. The single emoji avatar visibly reacts while speaking, and shows the emotion emoji
   the agent supplied (or a default when none is given).
3. The user clicks the mic, speaks, sees the transcript, and it is sent to the backend.
4. The agent can read the user's reply via a single `curl GET`.

Everything in the full functional requirements below (multi-agent registry, avatar
images/animation, SSE, pluggable providers, etc.) is deferred to post-MVP iterations.

## Functional Requirements

### FR1 — Agent message submission
As a CLI agent, I want to post a message to the backend via a simple HTTP call, so
that it appears and is spoken in the web UI.

Acceptance criteria:
1. WHEN an agent sends `POST /api/agents/:agentId/messages` with a JSON body
   `{ "text": "..." }` THEN the backend SHALL accept it and return `201` with a
   message ID.
2. WHEN the request omits `text` or sends an empty string THEN the backend SHALL
   return `400` with an error description.
3. WHEN an unknown `agentId` posts a message THEN the backend SHALL auto-register the
   agent with a default avatar and display name.
4. The endpoint SHALL be usable with a single `curl` command without special headers
   beyond `Content-Type: application/json`.

### FR2 — Agent registration and identity
As a CLI agent, I want to declare my display name and avatar, so the UI shows me
distinctly.

Acceptance criteria:
1. WHEN an agent sends `POST /api/agents` with `{ "agentId", "displayName", "avatar",
   "voice" }` THEN the backend SHALL register or update the agent profile.
2. IF `avatar` or `voice` is omitted THEN the backend SHALL assign defaults.
3. The UI SHALL render each agent's `displayName` and avatar image/style.

### FR3 — Real-time delivery to the UI
As a user, I want agent messages to appear and be spoken as soon as they are sent.

Acceptance criteria:
1. WHEN an agent message is accepted THEN the backend SHALL push it to all connected
   browsers in real time (WebSocket or SSE) within 1 second under normal load.
2. WHEN a browser connects THEN it SHALL receive the current roster of known agents.
3. WHEN the connection drops THEN the UI SHALL attempt to reconnect automatically.

### FR4 — Text-to-speech avatar playback
As a user, I want each agent's messages read aloud by a voice tied to that avatar.

Acceptance criteria:
1. WHEN a message arrives in the browser THEN the UI SHALL speak it using text-to-speech.
2. Each agent SHALL use a consistent voice across its messages where the TTS engine
   supports voice selection.
3. WHILE an avatar is speaking THE UI SHALL visually indicate it (e.g. animation,
   highlight, mouth movement).
4. WHEN multiple messages arrive close together THEN the UI SHALL queue them so speech
   does not overlap unintelligibly.

### FR5 — Expressive avatar state via emoji
As a CLI agent, I want to attach an emoji to my message to convey my emotional state,
so the avatar can express more than plain text (thinking, confused, happy, done, etc.).

Acceptance criteria:
1. WHEN an agent posts a message with an optional `emoji` field THEN the backend SHALL
   store it with the message and broadcast it to the UI.
2. WHEN the UI receives a message with an `emoji` THEN the avatar SHALL display that
   emoji as its current face while presenting/speaking the message.
3. IF no `emoji` is supplied THEN the avatar SHALL use a default emoji (🤖).
4. An agent MAY set the avatar's emotion without speech by posting an `emoji` with
   empty or omitted `text` (a state change only); the UI SHALL update the avatar and
   SHALL NOT speak.
5. THE `emoji` value SHALL be validated as a short string; overly long values SHALL be
   rejected or truncated so the avatar renders a single expression.

### FR6 — Microphone input and transcription
As a user, I want to speak my reply and have it transcribed and sent to agents.

Acceptance criteria:
1. WHEN the user activates the mic THEN the UI SHALL capture audio and produce a text
   transcript (browser Speech Recognition API or backend STT).
2. WHEN a transcript is finalized THEN the UI SHALL send it to the backend as a user
   message. IF recognition ends or the user stops the mic with an unfinalized interim
   transcript THEN the UI SHALL send that interim text (so short utterances are not
   lost).
3. THE UI SHALL show the live/interim transcript so the user can confirm what was heard.
4. THE UI SHALL provide a way to send typed text as a fallback when no mic is available.
5. THE mic SHALL be a single click-to-toggle control (start listening / stop),
   listening continuously across natural pauses until the user stops it.
6. WHILE the avatar is speaking (TTS active) THE UI SHALL make a best-effort attempt
   to prevent the avatar's own audio from being sent as a user reply. It keeps
   recognition running continuously (stopping/restarting it drops the first word of the
   real reply) and, for a guard window around/after speech, strips from each transcript
   any contiguous run of words that (fuzzily) matches what the avatar just said,
   keeping the remainder as the user's reply. This reliably removes full-question echo;
   short or spelling-variant echoes may occasionally slip through. Headphones eliminate
   echo entirely and are recommended for the cleanest capture.

### FR7 — User replies retrievable by agents
As a CLI agent, I want to read what the user said, so I can continue the conversation.

Acceptance criteria:
1. WHEN a user message is created THEN it SHALL be broadcast to the UI and stored for
   agent retrieval.
2. WHEN an agent calls `GET /api/messages?since=<cursor>` THEN the backend SHALL return
   messages (user and agent) after that cursor with a new cursor for the next poll.
3. THE backend SHALL optionally support long-polling or an SSE stream at
   `GET /api/stream` so agents can react without tight polling.

### FR8 — Conversation session/room
As a user, I want messages grouped in a session so context is coherent.

Acceptance criteria:
1. THE backend SHALL maintain an ordered conversation log of user and agent messages.
2. WHEN the UI loads THEN it SHALL show recent conversation history.

## Non-Functional Requirements

- **NFR1 Simplicity:** Agent-facing API must be trivially callable from `curl`/shell.
- **NFR2 Real-time:** End-to-end latency from agent post to spoken output should feel
  immediate (< ~1s excluding TTS duration).
- **NFR3 Portability:** Runs on Node.js LTS; single command to start; no external
  cloud service required for a basic setup (browser-native TTS/STT as default).
- **NFR4 Extensibility:** TTS/STT should be pluggable so cloud providers can be added
  later without changing the agent API.
- **NFR5 Concurrency:** Support multiple agents and multiple browser viewers at once.

## Out of Scope (initial version)

- Authentication / access control (assume trusted local/LAN use initially).
- Persistent database storage (in-memory or flat-file log to start).
- Multi-room / multi-user-per-room beyond a single shared conversation.
- Photorealistic or 3D avatars (start with simple 2D avatars/animations).

## Open Questions

1. TTS/STT: browser-native only, or also support cloud providers (e.g. for better
   voices) from the start?
2. Should agents authenticate, even with a simple shared token?
3. Do we need message persistence across server restarts?
4. Avatars: static images, CSS animation, or something richer (e.g. lip-sync)?
5. Should the user's spoken replies be routed to a specific agent or broadcast to all?
