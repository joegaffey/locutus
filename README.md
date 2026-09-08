# Locutus — give your coding agent a voice and a face

Your terminal agent works in silence. Locutus gives it an on-screen **talking emoji
avatar**: it speaks its progress aloud, shows how it's feeling with an emoji, and
**listens for your spoken reply** — so you can step back from the keyboard and just talk
to it.

![Locutus in the browser: an emoji avatar speaking, with a Speak button, a typed-reply
fallback, and a live transcript of an agent/human conversation.](./images/locutus-screenshot1.png)

It's a tiny accessory, not a framework. Your existing agent (Kiro, Claude Code, Codex,
Gemini, opencode, or any shell script) drives it with one-line HTTP calls. No SDK, no
API keys, no cloud — just a local server and a browser tab.

```
  your agent  ──curl──▶  Locutus server  ──▶  🗣️  browser speaks it
      ▲                                          🎤  you reply out loud
      └───────────  transcribed reply  ◀─────────────┘
```

> **Status: MVP working** — single agent, emoji avatar, in-memory. See [`specs/`](./specs).

## Quickstart

**1. Start the server** (needs Node.js LTS):

```bash
npm install && npm start
```

**2. Open the room** at <http://localhost:3000> in Chrome or Edge, and leave the tab
focused so it can speak and listen. *(Headphones recommended — otherwise the mic can
hear the avatar's own voice.)*

**3. Make your agent talk.** Any agent that can run a shell command can drive the avatar
with plain `curl`. The whole contract is three calls:

```bash
# Speak a line (the emoji sets the avatar's expression)
curl -sX POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"Running the test suite","emoji":"🏃"}'

# Ask the human a question and wait for their spoken reply (prints {"reply":"..."})
curl -sG http://localhost:3000/api/ask \
  --data-urlencode 'text=Which environment should I deploy to?' --data-urlencode 'emoji=🎤'

# Or poll for replies yourself, since a cursor
curl -s "http://localhost:3000/api/messages?since=0"
```

To wire this into a real agent, tell it (in its system prompt / instructions) to call
those endpoints — narrate progress with `POST /api/messages` and ask for input with
`GET /api/ask`. That's it; the agent now has a voice and can hear you. This repo already
ships that guidance and no-prompt command config for several popular CLIs — see
[Supported CLIs](#supported-clis) below.

Prefer a wrapper over raw `curl`? There's also an [`avatar` CLI](#for-agent-authors) —
an alternative integration with shorter commands and a `pipe` mode.

## For agent authors

This is an accessory for existing CLI/TUI agents (Kiro, opencode, pi, shell scripts).
Agents drive it two ways — both equally valid; pick whatever's easiest to invoke and
pre-approve in your tool.

**Plain `curl`** (most portable — the primary path in the per-tool guides):

```bash
# speak a line (optional emoji sets the avatar's expression)
curl -sX POST http://localhost:3000/api/messages -H 'Content-Type: application/json' -d '{"text":"All tests passed","emoji":"✅"}'
# ask a question and block for the spoken reply
curl -sG http://localhost:3000/api/ask --data-urlencode 'text=What next?' --data-urlencode 'emoji=🎤'
```

**The `avatar` CLI** — an alternative integration with shorter commands and a `pipe` mode:

```bash
npm link                                   # put `avatar` on your PATH
avatar state 🤔                            # set expression
avatar say "All tests passed" --emoji ✅   # speak a line
answer="$(avatar ask "What next?" --emoji 🎤)"  # ask and wait for the spoken reply
your-tui | avatar pipe                      # or pipe a tool's output straight through
```

See [AGENTS.md](./AGENTS.md) for the full HTTP contract, the `avatar` CLI reference, and
TUI wiring examples.

### Supported CLIs

Any tool that can run a shell command can drive the avatar (plain `curl` or the `avatar`
CLI). This repo also ships per-tool config so it runs **without approval prompts**, plus
guidance so the assistant knows to narrate and ask for voice input.

| CLI | Guidance file | Frictionless command setup | Maturity |
|-----|---------------|----------------------------|----------|
| **Kiro** | `.kiro/agents/avatar.json` (prompt) | `toolsSettings.execute_bash.allowedCommands` (curl + `avatar`) | ✅ Verified end-to-end (live) |
| **opencode** | `.opencode/agents/avatar.md` + `.opencode/skills/avatar-voice/SKILL.md` | `opencode.json` `permission.bash` rules | 🟡 Built from docs, not run here |
| **Claude Code** | `CLAUDE.md` | `.claude/settings.json` `permissions.allow` (`Bash(...)` rules) | 🟡 Built from docs, not run here |
| **Codex CLI** | `AGENTS.md` (shared) | Runtime permission profile / sandbox (no per-command allowlist) | 🟠 Guidance only; execution is a runtime choice |
| **Gemini CLI** | `GEMINI.md` | `~/.gemini/policies/*.toml` (`gemini-policy.sample.toml`); user-level only | 🟡 Built from docs, not run here |
| **Copilot CLI** | `.github/copilot-instructions.md` (also reads `AGENTS.md`) | `--allow-tool='shell(curl)' --allow-tool='shell(avatar)'` at launch | 🟡 Built from docs, not run here |
| **Other / any TUI** | `AGENTS.md` | Approve `curl`/`avatar` in that tool, or `tool \| avatar pipe` | ⚪ Works via curl/pipe; no bundled config |

Legend: ✅ verified · 🟡 configured from official docs, untested here · 🟠 partial
(guidance only) · ⚪ generic path.

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

### Hands-free with Gemini CLI

Gemini CLI reads **`GEMINI.md`** for project context — this repo's `GEMINI.md` tells it
to narrate progress and use `/api/ask` for spoken input, so it works out of the box:

```bash
gemini
# ...or narrate a headless run's output:
gemini -p "…" | avatar pipe
```

To run the avatar's `curl`/`avatar` commands **without approval prompts**, copy the
bundled policy sample to your user policies directory (Gemini loads user-level
`~/.gemini/policies/*.toml`; workspace policies are disabled by default):

```bash
mkdir -p ~/.gemini/policies
cp gemini-policy.sample.toml ~/.gemini/policies/locutus.toml
```

### Hands-free with Copilot CLI

GitHub Copilot CLI reads **`.github/copilot-instructions.md`** (and also `AGENTS.md`) for
project guidance — both are in this repo, so it knows to narrate progress and use
`/api/ask` for spoken input. Pre-approve the avatar's shell calls at launch so they run
without prompts:

```bash
copilot --allow-tool='shell(curl)' --allow-tool='shell(avatar)'
```

(Or approve each command interactively, or narrate a headless run with
`copilot -p "…" | avatar pipe`.)

## Requirements & notes

- **Node.js LTS** for the server.
- A **Chromium browser** (Chrome/Edge) — TTS/STT use the Web Speech API.
- A **microphone** for voice replies; typing is supported as a fallback.
- **Headphones recommended.** On speakers the mic can hear the avatar's own speech and
  transcribe it as your reply. Locutus strips the avatar's speech from transcripts on a
  best-effort basis, but headphones eliminate it entirely for the cleanest capture.
- **In-memory (MVP):** restarting the server clears the conversation.
- Point the server elsewhere with `PORT=…`, and the `avatar` CLI with `AVATAR_URL=…`.

## Project layout

```
specs/            Requirements, design, and task plan
bin/              The `avatar` CLI accessory (say/state/listen/pipe)
src/              Node.js backend (Express + SSE)
public/           Browser UI (emoji avatar, TTS, mic/STT)
README.md         This file
AGENTS.md         Guide for CLI/AI agents using the API
images/           Screenshots and doc assets
```

## Roadmap

- **MVP (Milestone 0):** single agent, emoji avatar, in-memory, browser TTS/STT.
- **Post-MVP:** multiple agents with names/voices, richer avatars, SSE stream,
  pluggable cloud TTS/STT, optional persistence. See [`specs/tasks.md`](./specs/tasks.md).
