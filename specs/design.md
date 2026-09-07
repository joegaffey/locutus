# Design: Agent Avatar UI

## Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │              Web Browser (UI)             │
                    │  ┌───────────┐   ┌──────────────────┐    │
   speaks aloud <───┤  │  Avatars  │   │  Mic capture +   │    │
   hears agents     │  │  + TTS    │   │  Speech-to-Text  ├──┐ │
                    │  └─────┬─────┘   └──────────────────┘  │ │
                    │        │  SSE stream (live messages)    │ │
                    └────────┼────────────────────────────────┼─┘
                             │ (in)                    (out)   │
                    ┌────────▼─────────────────────────────────▼─┐
                    │            Node.js Backend                  │
                    │  ┌─────────────┐   ┌────────────────────┐   │
                    │  │ HTTP API    │   │  SSE broadcast hub  │   │
                    │  │ (Express)   │   │  (/api/stream)      │   │
                    │  └──────┬──────┘   └─────────┬──────────┘   │
                    │         │   ┌────────────────▼──────────┐   │
                    │         └──▶│  Conversation store +      │   │
                    │             │  Agent registry (in-mem)   │   │
                    │             └────────────────────────────┘   │
                    └─────────────▲───────────────────▲────────────┘
                                  │ POST message       │ GET/stream
                                  │ (curl)             │ user replies
                        ┌─────────┴─────┐     ┌─────────┴─────┐
                        │  CLI Agent A  │     │  CLI Agent B  │
                        └───────────────┘     └───────────────┘
```

## Technology Choices

- **Runtime:** Node.js (LTS).
- **HTTP server:** Express — minimal, ubiquitous, easy for the simple REST surface.
- **Real-time push:** Server-Sent Events (SSE) at `GET /api/stream` — a single
  one-way (server → client) stream shared by the browser UI and by agents that prefer
  a stream over polling. SSE fits the need exactly (the browser only *receives* pushes;
  it sends replies via HTTP POST), is plain HTTP (works with `curl`/`EventSource`),
  auto-reconnects natively, and needs no extra dependency. (An earlier design used a
  WebSocket for the browser; it was replaced by SSE since the browser never pushed over
  the socket, so a bidirectional protocol was unnecessary.)
- **TTS (default):** Browser Web Speech API (`speechSynthesis`) — zero external
  dependencies, per-voice selection. Pluggable interface allows swapping in cloud TTS.
- **STT (default):** Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
  Pluggable to allow backend STT (e.g. Whisper) later.
- **Frontend:** Plain HTML/CSS/JS served statically to keep it simple, or a light
  build (Vite) if we want components. Start with static + vanilla JS.
- **Storage:** In-memory ring buffer for the conversation log + a Map for agents.
  Optional append-only JSON/NDJSON file for durability later.

Rationale: keep the agent contract dead-simple (plain HTTP + JSON) so any language or
shell can drive it, and keep TTS/STT in the browser so no cloud account is required to
get started.

## Backend Components

### 1. HTTP API (Express)

| Method | Path                              | Purpose                              |
|--------|-----------------------------------|--------------------------------------|
| POST   | `/api/agents`                     | Register/update an agent profile     |
| GET    | `/api/agents`                     | List known agents                    |
| POST   | `/api/agents/:agentId/messages`   | Agent posts a message                |
| GET    | `/api/messages?since=<cursor>`    | Poll conversation after cursor       |
| GET    | `/api/ask?text=&emoji=&timeout=`  | Speak a prompt, block for the reply  |
| GET    | `/api/stream`                     | SSE stream of messages (UI + agents) |
| POST   | `/api/user/messages`              | UI posts a user (spoken/typed) reply |

### 2. Agent Registry

- `Map<agentId, AgentProfile>`.
- Auto-registers unknown agents with defaults on first message (FR1.3).
- `AgentProfile`: `{ agentId, displayName, avatar, voice }`.

### 3. Conversation Store

- Ordered append-only list of messages with a monotonic integer cursor.
- Each `Message`: `{ id, cursor, source: "agent"|"user", agentId?, text, emoji?, ts }`.
  `emoji` is an optional short string the agent supplies to set the avatar's expression
  (e.g. 🤔, 😕, 🎉). A message may carry `emoji` with empty `text` to change the
  avatar's state without speaking.
- Bounded in-memory buffer (configurable size) to avoid unbounded growth.
- `getSince(cursor)` returns new messages + latest cursor.

### 4. Broadcast Hub (SSE)

- Tracks connected SSE clients (browsers and any streaming agents) as open responses.
- On subscribe → send a `history` snapshot (recent messages + cursor); heartbeat
  comments keep idle connections alive; cleans up on client close.
- On new message → write a `message` SSE event to all subscribers.

## Frontend Components

### 1. Connection layer
- Opens an `EventSource` to `/api/stream` (SSE auto-reconnects natively).
- Receives named events: `history` (snapshot on connect) and `message` (live pushes).

### 2. Avatar stage
- Renders one avatar per known agent (grid or "stage" layout).
- Shows `displayName`; highlights/animates the currently speaking avatar.
- Displays the agent-supplied `emoji` as the avatar's face/expression; falls back to a
  default (🤖) when none is provided. Expression persists until the next message
  updates it.

### 3. Speech output (TTS) + queue
- `SpeechQueue`: serializes utterances so they don't overlap.
- Maps `agentId → voice` for consistent voices.
- Emits speaking-start / speaking-end to drive avatar animation.
- Applies each message's `emoji` before speaking; if a message has an `emoji` but no
  `text`, updates the avatar expression without enqueuing speech.

### 4. Microphone + STT
- Toggle button to start/stop recognition.
- Shows interim transcript; on final result, POSTs to `/api/user/messages`.
- Typed-text fallback input.

### 5. Transcript panel
- Scrolling log of all messages (agent + user) for visual reference.

## Data Flow

**Agent → User (speak):**
1. Agent `POST /api/agents/:id/messages { text, emoji? }` (MVP: `POST /api/messages`).
2. Backend appends to conversation store, assigns cursor, returns `201 { id }`.
3. Broadcast hub pushes `message` (incl. `emoji`) over WS to browsers.
4. Browser sets the avatar expression to `emoji`, enqueues utterance; TTS speaks it;
   avatar animates. A message with `emoji` but no `text` changes expression only.

**User → Agent (reply):**
1. User speaks → browser STT produces transcript.
2. Browser `POST /api/user/messages { text }`.
3. Backend appends as `source: "user"`, broadcasts to WS + SSE.
4. Agents pick it up via `GET /api/messages?since=<cursor>` or `/api/stream`.

## Example Agent Usage (curl)

Post a message:
```bash
curl -sX POST http://localhost:3000/api/agents/navi/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hey, listen! The build finished.","emoji":"🎉"}'
```

Register with a voice/avatar:
```bash
curl -sX POST http://localhost:3000/api/agents \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"navi","displayName":"Navi","avatar":"fairy","voice":"Google UK English Female"}'
```

Read user replies since a cursor:
```bash
curl -s "http://localhost:3000/api/messages?since=42"
```

## Error Handling

- Validation errors → `400` with `{ error }`.
- Unknown route → `404`.
- WS/SSE disconnects → client reconnects; server drops dead clients on write failure.
- TTS/STT unavailable in browser → fall back to text display + typed input, show a notice.

## Testing Strategy

- **Unit:** conversation store (cursor ordering, buffer bounds), agent registry
  (auto-register, defaults), request validation.
- **API integration:** supertest against Express — post message, poll since cursor,
  user reply round-trip.
- **Real-time:** WS client test asserting broadcast delivery and roster-on-connect.
- **Manual/browser:** TTS playback, mic capture, avatar animation (hard to automate;
  cover with a manual checklist).

## Project Structure (proposed)

```
/agent-avatar-ui
  package.json
  src/
    server.js            # Express app + WS wiring
    api/routes.js        # REST endpoints
    core/registry.js     # agent registry
    core/conversation.js # conversation store
    core/hub.js          # WS/SSE broadcast
  public/
    index.html
    app.js               # connection + UI orchestration
    speech.js            # TTS queue + STT
    avatars.js           # avatar rendering/animation
    styles.css
  test/
    conversation.test.js
    registry.test.js
    api.test.js
```
