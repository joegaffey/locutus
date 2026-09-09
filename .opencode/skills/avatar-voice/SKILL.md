---
name: avatar-voice
description: Speak progress aloud and ask the human for spoken input through the Agent Avatar UI. Use when you want to narrate what you're doing via an on-screen emoji avatar, or when you need a voice/typed reply from the human. Backed by the `avatar` CLI (say/state/ask/listen/pipe) talking to a local server.
license: MIT
compatibility: opencode
metadata:
  audience: agents
  workflow: voice
---

## What I do

I let you give your work a face and voice through the Agent Avatar UI. The `avatar`
CLI (`./bin/avatar`, or `avatar` if linked) posts to a server at http://localhost:3000
that speaks your lines aloud in the browser and captures the human's spoken replies.
Override the target with `AVATAR_URL=http://host:3000`.

## When to use me

- To narrate notable progress so the human can listen instead of watch.
- To ask the human a question and wait for a spoken (or typed) answer.

## How to use me

Two ways — use whichever is available. Plain `curl` needs no setup and works from any
directory; the `avatar` CLI is a convenience if it's on PATH.

### With curl (no dependency)

```bash
# speak a line (optional emoji sets the avatar's expression)
curl -sX POST http://localhost:3000/api/messages -H 'Content-Type: application/json' -d '{"text":"Running the test suite","emoji":"🏃"}'
# change expression without speaking
curl -sX POST http://localhost:3000/api/messages -H 'Content-Type: application/json' -d '{"emoji":"🤔"}'
# ask a question and block for the reply (prints {"reply":"..."}; HTTP 408 on timeout)
curl -sG http://localhost:3000/api/ask --data-urlencode 'text=What should I work on next?' --data-urlencode 'emoji=🎤' --data-urlencode 'timeout=60'
```

Override the target with `AVATAR_URL`/host as needed (default http://localhost:3000).

### With the `avatar` CLI

Speak a line (optional expression emoji):

```bash
./bin/avatar say "Running the test suite" --emoji 🏃
./bin/avatar say "All tests passed" --emoji ✅
./bin/avatar say "Deploy failed: timeout" --emoji ❌
```

Change expression without speaking:

```bash
./bin/avatar state 🤔
```

Ask a question and block for one reply (recommended for input; exit 1 on timeout):

```bash
answer="$(./bin/avatar ask "What should I work on next?" --emoji 🎤 --timeout 60)"
```

Speak everything a tool prints, with zero integration:

```bash
some-command | ./bin/avatar pipe
```

## Etiquette

- Keep spoken lines short and plain — they're read aloud. Don't speak large code or tables.
- Use emoji for state, text for speech; one thought per line.
- Narration is optional; still do the task and report normally in chat.
- Pasted images: a user message may include an `image` (absolute file path) when the human
  pastes a screenshot. If present, read that path with your file-read tool to view it.
- If the server is unreachable, continue without the avatar rather than blocking.

## Suggested emoji

🤔 thinking · 😕 confused · ✅ done · ❌ failed · 🎉 celebrating · 👀 reviewing ·
🎤 asking for input · 😴 idle
