# AGENTS.md — Give your TUI agent a face and voice

This is an **accessory** for CLI/TUI agents (Kiro, opencode, pi, shell scripts, …).
It doesn't run any logic of its own — your existing agent pushes its output to an
on-screen **emoji avatar** that speaks it aloud, and reads back the human's spoken
replies. Integration is just shell commands, so any tool that can run a command or
pipe its output can use it.

Two ways in — use whichever fits your agent:

1. **Plain `curl`** (most portable) — just HTTP to a port; no install, no PATH, works
   from any directory. Best for wiring into agents whose shell commands you want to
   pre-approve.
2. **`avatar` CLI** — a tiny, dependency-free wrapper for humans and piping
   (`tool | avatar pipe`), and shorter to type interactively.

Both hit the same endpoints; mix and match freely.

## Setup

Start the server (from this repo):

```bash
npm install
npm start           # serves the UI + API on http://localhost:3000
```

Open `http://localhost:3000` in Chrome/Edge and leave the tab focused so it can speak
and hear you.

Make the `avatar` command available:

```bash
npm link            # puts `avatar` on your PATH
# ...or call it directly: ./bin/avatar ...
# ...or point it elsewhere: AVATAR_URL=http://host:3000 avatar say "hi"
```

## The `avatar` CLI

```
avatar say <text> [--emoji E]   Speak a line in the browser (optional expression).
avatar state <emoji>            Change the avatar's expression, without speaking.
avatar ask <text> [--emoji E]   Speak a question and print the human's reply.
              [--timeout S]     One call = one full voice Q&A. Exit 1 on timeout.
avatar listen [--timeout S]     Print the next human reply to stdout, then exit.
              [--follow]        Keep printing replies until Ctrl-C.
avatar pipe [--emoji E]         Speak each line read from stdin.
```

`avatar ask` and `avatar listen` exit `0` when they printed a reply, `1` on timeout —
so scripts can tell "got input" from "nothing yet".

### Wiring it into a TUI agent

**Speak notable events.** Call `avatar say` where your agent already reports progress:

```bash
avatar state 🤔                              # thinking / working
avatar say "Running the test suite" --emoji 🏃
avatar say "All 42 tests passed" --emoji ✅
avatar say "Deploy failed: timeout" --emoji ❌
```

**Speak everything a tool prints (zero integration).** Pipe its stdout:

```bash
my-tui-agent | avatar pipe
# each line the tool prints is spoken in order
```

**Ask a question and wait for the answer (recommended for input).** One call speaks
the prompt and blocks until the human replies — no polling loop, one shell command:

```bash
answer="$(avatar ask "What should I work on next?" --emoji 🎤 --timeout 60)" \
  || { echo "no reply"; exit 1; }
echo "human said: $answer"     # feed $answer back into your agent
```

**Capture the human's voice without prompting.** `avatar listen` blocks until the next
reply (useful if the prompt was spoken separately):

```bash
avatar say "I'm listening…" --emoji 🎤
reply="$(avatar listen --timeout 60)" || { echo "no reply"; exit 1; }
```

**Tool-specific hooks.** Kiro agent hooks, opencode/pi command or event hooks — anywhere
you can run a shell command, call `avatar say`/`state` on start, on completion, or on
error, and `avatar listen` when you want spoken input.

## Suggested expressions

| Emoji | State it conveys        |
|-------|-------------------------|
| 🤔    | thinking / working      |
| 😕    | confused / unsure       |
| ✅    | done / success          |
| ❌    | failed / error          |
| 🎉    | celebrating             |
| 👀    | looking / reviewing     |
| 🎤    | asking for input        |
| 😴    | idle / waiting          |

---

## Raw HTTP contract

If you'd rather not use the CLI, everything above is thin wrappers over these endpoints.

### Base URL

```
http://localhost:3000
```

### Conversation model

- One shared, ordered conversation log; each message has an increasing integer **cursor**.
- `source` is `"agent"` (you) or `"user"` (the human's transcribed speech / typed text).

A message looks like:

```json
{ "id": 7, "cursor": 7, "source": "user", "text": "sounds good, ship it", "emoji": null, "ts": 1725730000000 }
```

### Post a message (spoken aloud)

```
POST /api/messages
Content-Type: application/json

{ "text": "your message", "emoji": "🤔" }
```

- `text` — spoken aloud; may be empty if you only want to change expression.
- `emoji` — optional short expression string.
- Both empty/missing → `400`. Otherwise `201` with the stored message.

```bash
curl -sX POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"The deployment finished.","emoji":"🎉"}'
```

Change expression only (no speech):

```bash
curl -sX POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' -d '{"emoji":"🤔"}'
```

### Read the human's replies

```
GET /api/messages?since=<cursor>
```

Returns messages after `since` plus the latest `cursor` to poll with next:

```json
{ "messages": [ { "cursor": 4, "source": "user", "text": "great, thanks" } ], "cursor": 4 }
```

Start at `since=0`; filter `source == "user"` for just the human's speech.

```bash
curl -s "http://localhost:3000/api/messages?since=0"
```

### Ask a question and block for the reply

```
GET /api/ask?text=<prompt>&emoji=<E>&timeout=<seconds>
```

Speaks the prompt (if given), then long-polls until the human replies. Returns
`200 { "reply": "...", "message": {...} }` on a reply, or `408` on timeout. `timeout`
defaults to 60s (capped at 300s). This is one HTTP round trip for a full voice Q&A.

```bash
curl -sG http://localhost:3000/api/ask \
  --data-urlencode 'text=What should I work on next?' \
  --data-urlencode 'emoji=🎤' --data-urlencode 'timeout=60'
```

### Stream messages instead of polling (SSE)

```
GET /api/stream
```

A Server-Sent Events stream: on connect it sends a `history` event (recent messages +
cursor), then a `message` event for each new message (agent or user). Works with plain
`curl` and any `EventSource` client — no polling needed.

```bash
curl -sN http://localhost:3000/api/stream
# event: history
# data: {"type":"history","messages":[...],"cursor":3}
# event: message
# data: {"type":"message","message":{"cursor":4,"source":"user","text":"..."}}
```

## Behavior notes & etiquette

- **Speech is queued.** Multiple messages are spoken in order; they don't overlap.
  Avoid flooding — one thought per line reads best.
- **Use emoji for state, text for speech.** Flip to 🤔 while working and ✅/❌ when done.
- **Keep it speakable.** Short plain sentences beat large code blocks or tables.
- **The human needs time.** They click the mic and speak; expect latency. `avatar listen`
  polls about once a second.
- **State is in-memory (MVP).** Restarting the server clears the conversation.

## Errors

| Status | Meaning                                        |
|--------|------------------------------------------------|
| 400    | Both `text` and `emoji` missing/empty          |
| 404    | Unknown route                                  |
| 5xx    | Server error — retry with backoff              |

## Roadmap (post-MVP)

- Multiple agents with distinct names, emoji, and voices sharing one room.

See [`specs/design.md`](./specs/design.md) for the full intended contract.

