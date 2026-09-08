# Agent Avatar UI

A web-based "room" where CLI agents send text messages over a simple HTTP API and are
represented by talking avatars in the browser. The browser reads each message aloud
(text-to-speech) and animates the avatar. A human user replies by speaking into their
microphone; the speech is transcribed and made available back to the agents.

> **Status: MVP working.** Milestone 0 supports a **single agent** with an **emoji
> avatar** (🤖) as a quick end-to-end test. See [`specs/`](./specs) for requirements,
> design, and the task plan.

## Why

Give headless CLI agents (scripts, bots, LLM agents) a voice and a face, and let a
human talk back — without either side needing anything more than plain HTTP and a
browser.

## Requirements

- Node.js LTS
- A browser that supports the Web Speech API for TTS/STT (Chrome/Edge recommended)
- A microphone for voice replies (typing is supported as a fallback)
- **Headphones recommended.** On speakers, the mic can hear the avatar's own
  text-to-speech and transcribe it as your reply. The app strips the avatar's speech
  from transcripts on a best-effort basis, but headphones eliminate this entirely and
  give the cleanest capture.

## Getting started

```bash
npm install
npm start
```

Then open the UI:

```
http://localhost:3000
```

You'll see a single emoji avatar. Anything an agent posts will be spoken aloud, and the
avatar reacts while speaking. Agents can send an emoji with each message to set the
avatar's expression (🤔 thinking, 🎉 celebrating, ✅ done, and so on).

## The loop

1. An agent posts a message via `curl` → it appears and is spoken in the browser.
2. The emoji avatar animates while speaking.
3. You click the mic, speak a reply, and see the live transcript.
4. The agent reads your reply with a single `curl` request.

## Quick test

Post a message (spoken in the browser, with an expression):

```bash
curl -sX POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello! I am your friendly agent.","emoji":"👋"}'
```

Read user replies since a cursor:

```bash
curl -s "http://localhost:3000/api/messages?since=0"
```

## For agent authors

This is an accessory for existing CLI/TUI agents (Kiro, opencode, pi, shell scripts).
Use the tiny `avatar` command to speak and to read the human's replies:

```bash
npm link                                   # put `avatar` on your PATH
avatar state 🤔                            # set expression
avatar say "All tests passed" --emoji ✅   # speak a line
answer="$(avatar ask "What next?" --emoji 🎤)"  # ask and wait for the spoken reply
your-tui | avatar pipe                      # or just pipe a tool's output
```

See [AGENTS.md](./AGENTS.md) for the full CLI reference, TUI wiring examples, and the
raw HTTP contract.

### Hands-free with Kiro

This repo ships a Kiro agent (`.kiro/agents/avatar.json`) that pre-trusts the `avatar`
commands (no approval prompts) and knows to narrate progress and use `avatar ask` for
spoken input. Launch Kiro with it:

```bash
kiro chat --agent avatar
# ...or switch mid-session with the /agent command and pick "avatar"
```

Make sure the server is running (`npm start`) and the browser tab is open so it can
speak and listen.

### Hands-free with opencode

This repo also ships opencode config: `opencode.json` allows the `avatar` bash commands
without prompts, and `.opencode/agents/avatar.md` defines an `avatar` agent that narrates
progress and uses `avatar ask` for input. Use it with:

```bash
opencode --agent avatar
# ...or pipe any run's output straight to the avatar (zero config):
opencode run "…" | avatar pipe
```

Add `--auto` to auto-approve anything not explicitly denied. Point at a non-local server
with `AVATAR_URL=http://host:3000`.

There's also an opencode **skill** at `.opencode/skills/avatar-voice/SKILL.md`, so *any*
agent (including the default Build agent) can discover and load the avatar instructions
on demand — no need to switch to the `avatar` agent.

### Hands-free with Claude Code

This repo ships Claude Code config too: `.claude/settings.json` pre-approves the avatar
`curl`/`avatar` commands (no permission prompts), and `CLAUDE.md` tells Claude to
narrate progress and use `/api/ask` for spoken input. Just run Claude Code in the repo:

```bash
claude
# ...or narrate a headless run's output:
claude -p "…" | avatar pipe
```

Make sure the server is running (`npm start`) and the browser tab is open.

### Hands-free with Codex CLI

Codex reads **`AGENTS.md`** for project guidance, and this repo's `AGENTS.md` already
documents the avatar (the `curl` HTTP contract, `/api/ask`, and the `avatar` CLI) — so
Codex can drive the avatar with no extra files.

Codex gates command execution through its **permission profiles / sandbox** rather than
a per-command allowlist, so "frictionless" is a runtime choice you make when you launch
it (approve the avatar's `curl` calls, and allow local network access to
`localhost:3000`). Pick the approval/sandbox mode you're comfortable with via
`/permissions` in the CLI or defaults in `~/.codex/config.toml` — see Codex's
Permissions & Sandboxing docs. Or narrate a run's output with zero setup:

```bash
codex … | avatar pipe
```

## Project layout

```
specs/            Requirements, design, and task plan
bin/              The `avatar` CLI accessory (say/state/listen/pipe)
src/              Node.js backend (Express + SSE)
public/           Browser UI (emoji avatar, TTS, mic/STT)
README.md         This file
AGENTS.md         Guide for CLI/AI agents using the API
```

## Roadmap

- **MVP (Milestone 0):** single agent, emoji avatar, in-memory, browser TTS/STT.
- **Post-MVP:** multiple agents with names/voices, richer avatars, SSE stream,
  pluggable cloud TTS/STT, optional persistence. See [`specs/tasks.md`](./specs/tasks.md).
