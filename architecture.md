# Architecture

## Core Strategy: Extend, Don't Replace

Raven is not an agent framework. It's a layer on top of Claude Code — Anthropic's CLI agent that already handles tool use, file editing, code generation, subagent orchestration, and conversation management.

The rationale: CC is actively developed by a well-resourced team. Every improvement to models, tool handling, and context management comes for free. Building a competing harness means reimplementing features that already exist and will keep improving. Instead, Raven extends CC through its native extension points:

- **Skills** — markdown instruction files that teach CC new workflows
- **Hooks** — shell scripts that fire on CC lifecycle events (session start, tool use, stop)
- **Context files** — CLAUDE.md and memory files that provide persistent knowledge

This means the entire "agent core" is CC itself. Raven provides the domain knowledge, the access layer, and the glue.

## Component Map

```
Claude Code (the engine)
  │
  ├── skills/              Markdown skills + CLI tools, synced via filesystem links
  │     ├── SKILL.md       Instructions for CC (re-read on each invocation)
  │     ├── references/    Supporting docs (always live, no restart needed)
  │     └── scripts/       CLI tools in Python/Go/Bash
  │
  ├── web-ui/              Browser-based workspace
  │     ├── server.js      HTTP + WebSocket server, PTY management
  │     ├── lib/           Service modules (terminals, tasks, sessions, memory)
  │     ├── public/        Client-side panels + core app shell
  │     └── hooks/         CC hook scripts for web UI integration
  │
  ├── docs/                Research, architecture notes, design documents
  ├── tasks/               Per-project task files (markdown)
  └── projects.json        Registry of all tracked projects with paths and metadata
```

Each top-level directory is independent. No component requires another to function — the web UI can run without skills, skills work without the web UI, and task management works from either the CLI or the browser.

## The Web UI: An OS Metaphor

The web UI follows an operating system metaphor where the server is the kernel and the browser is the window manager.

**Server (kernel):** `server.js` + `lib/` modules handle system-level concerns — spawning PTY processes, managing WebSocket connections, executing task operations, monitoring memory usage. It exposes an API (HTTP + WebSocket) and doesn't render any UI.

**Client (window manager):** `app.js` provides panel registration and switching, a message bus, and connection lifecycle management. It contains no domain logic — it's a window manager that panels plug into.

**Panels (applications):** Each panel registers with `Raven.registerPanel()` and gets an init/activate/deactivate lifecycle. Panels communicate through the message bus (`Raven.on/dispatch` for local events, `Raven.send` for server events). Current panels include terminal, tasks, overview, sessions, status, settings, memory monitoring, and more.

This separation matters because it keeps the protocol boundary clean. CC hooks, browser panels, and any future clients are all just API consumers. Adding a new panel means writing one JavaScript file that calls `registerPanel()` — no changes to the server or the core app shell.

## CLI-as-API

The task system demonstrates a pattern used throughout: **Python owns the parsing, Node.js owns the serving.**

A Python CLI tool (`rtasks.py`) handles all task file parsing, deadline logic, and project resolution. It accepts a `--json` flag for structured output. The Node.js server (`lib/tasks.js`) is a thin wrapper — ~100 lines — that calls the Python script via `execFile` and returns parsed JSON to the browser.

This avoids reimplementing complex parsing in two languages. The CLI tool works standalone from the terminal, and the web UI gets the same logic for free. The trade-off is a subprocess per request, which is fine at personal-tool scale.

## Hooks as Integration Points

CC hooks fire shell commands on agent lifecycle events. Raven uses them for two distinct purposes:

1. **Notification** — A lightweight hook (`notify-hook.js`) fires on session start, stop, and permission requests. It sends a single HTTP POST to the web UI and exits. The web UI uses these events to update terminal state (is Claude running? is it waiting for permission?).

2. **Permission enforcement** — A heavier hook (`sandbox-hook.py`) intercepts every tool call during sandboxed work sessions. It checks file paths against worktree boundaries, commands against an allowlist, and file writes against anti-tamper patterns. Exit code 0 means allow, exit code 2 means deny with a reason.

The hook system is the primary mechanism for integrating CC with external services without modifying CC itself.

## Skills as the Extension Mechanism

Skills are markdown files that CC reads when invoked. A skill can reference supporting documents (in `references/`) and CLI tools (in `scripts/`). Skills are synced to CC's discovery path via filesystem junctions (symlinks on Unix) — the skill lives in the project repo for version control, but CC discovers it through its global skills directory.

A sync registry (`sync-config.json`) tracks which skills sync where. A Python script creates the junctions. Skills are re-read on every invocation, so editing a SKILL.md takes effect immediately — no restart, no build step.

Current skills cover: project status, session reflection and continuity, task management, document verification, security auditing, sandboxed autonomous work, paper reading, and skill development itself (a meta-skill that creates new skills).

## Task System

Tasks are markdown files — one per project — with a simple format: `- [ ] Task text (deadline)`. A central Python CLI tool parses these, handles deadline logic (smart year defaulting, relative dates), and exposes operations (add, complete, edit, reorder) via subcommands.

A `projects.json` file at the repo root maps project names to filesystem paths, shorthands, and metadata. The task CLI reads this to resolve project references. The web UI provides a per-project task panel with inline editing, and an overview panel that shows urgency-grouped cards across all projects.

## Memory and Continuity

CC provides auto-memory (`MEMORY.md` as an index, topic files for detail) which persists across conversations. Raven adds two session-continuity mechanisms:

1. **Reflect** — At session end, saves working state to `in_progress/[label].md`: what's in progress, key decisions, files touched, next steps. The label is user-chosen (suggested by the agent), making it a lightweight stash system.

2. **Continue** — At session start, reads `in_progress/` and presents the most recent state, offering to resume. If nothing is recent, shows a digest of recent states for the user to pick from.

This pair bridges the gap between CC sessions, where context resets on each start. The state files accumulate as a lightweight work log.
