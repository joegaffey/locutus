# GEMINI.md — project context for Gemini CLI

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
- Stay in the conversation: once you're talking through the avatar, keep the loop going. After each `/api/ask` returns — including a 408 timeout — immediately ask again so the human is never left waiting on a silent avatar. Only stop the loop when the task is truly finished or the human tells you to stop. Use a long `timeout` (up to 300s) to avoid idle gaps.
- If the server is unreachable, just continue without the avatar; don't block on it.

## Running without approval prompts (optional)

Gemini CLI's policy engine loads rules from **`~/.gemini/policies/*.toml`** (user-level;
workspace `.gemini/policies` is disabled by default). To pre-approve the avatar's shell
calls, copy this repo's sample to your user policies directory:

```bash
mkdir -p ~/.gemini/policies
cp gemini-policy.sample.toml ~/.gemini/policies/locutus.toml
```

See `AGENTS.md` for the full HTTP contract and the `avatar` CLI reference.
