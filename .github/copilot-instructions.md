# Copilot instructions

This project includes **Locutus**, an on-screen emoji avatar that speaks aloud and
captures the human's voice replies. Use it to narrate your progress and to ask the
human questions by voice — hands-free.

## The avatar

It's a local HTTP server, by default at `http://localhost:3000` (start it with
`npm start` in this repo, or `PORT=xxxx npm start`; if it runs elsewhere, use that base
URL). Drive it with plain `curl` — no SDK or keys.

Speak a line (spoken aloud; optional emoji sets the avatar's expression):

```bash
curl -sX POST http://localhost:3000/api/messages -H 'Content-Type: application/json' -d '{"text":"All tests passed","emoji":"✅"}'
```

Change expression without speaking:

```bash
curl -sX POST http://localhost:3000/api/messages -H 'Content-Type: application/json' -d '{"emoji":"🤔"}'
```

Ask a question and block until the human replies (prints `{"reply":"..."}`; HTTP 408 on
timeout). Read the reply from the command's stdout:

```bash
curl -sG http://localhost:3000/api/ask --data-urlencode 'text=What should I work on next?' --data-urlencode 'emoji=🎤' --data-urlencode 'timeout=60'
```

(If the `avatar` CLI is on PATH via `npm link`, `avatar say/state/ask/listen/pipe` work too.)

## When and how to use it

- Narrate notable progress: 🏃 running, ✅ done, ❌ failed, 🤔 thinking, 👀 reviewing.
- Ask for input with `/api/ask` when you need a decision from the human.
- Keep spoken lines short and plain — they're read aloud. Don't speak large code or tables.
- Use emoji for state, text for speech; one thought per line.
- Narration is optional — still do the actual task and report normally.
- **Pasted images:** a user message may include an `image` (absolute file path) when the
  human pastes a screenshot. If present, read that path with your file-read tool to view it.
- If the server is unreachable, just continue without the avatar; don't block on it.

## Running without approval prompts (optional)

Pre-approve the avatar's shell calls with `--allow-tool` when launching Copilot CLI:

```bash
copilot --allow-tool='shell(curl)' --allow-tool='shell(avatar)'
```

See `AGENTS.md` for the full HTTP contract and the `avatar` CLI reference.
