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
  │     ├── server.js      HTTP + WebSocket server, PTY management, scheduler, notifications
  │     ├── lib/           Service modules (terminals, tasks, sessions, memory, status)
  │     ├── public/        Client-side panels + core app shell
  │     ├── hooks/         CC hook scripts (notification, guard)
  │     └── data/          Runtime config (jobs.json, documents.json, notifications.json)
  │
  ├── scripts/             CLI tools callable from any context (raven-ui, raven-guard)
  ├── docs/                Research, architecture notes, design documents
  ├── tasks/               Per-project task files (markdown)
  └── projects.json        Registry of all tracked projects with paths and metadata
```

Each top-level directory is independent. No component requires another to function — the web UI can run without skills, skills work without the web UI, and task management works from either the CLI or the browser.

## The Web UI: An OS Metaphor

The web UI follows an operating system metaphor where the server is the kernel and the browser is the window manager.

**Server (kernel):** `server.js` + `lib/` modules handle system-level concerns — spawning PTY processes, managing WebSocket connections, executing task operations, monitoring memory usage, running scheduled jobs, storing notifications. It exposes an API (HTTP + WebSocket) and doesn't render any UI.

**Client (window manager):** `app.js` provides panel registration and switching, a message bus, and connection lifecycle management. It contains no domain logic — it's a window manager that panels plug into.

**Panels (applications):** Each panel registers with `Raven.registerPanel()` and gets an init/activate/deactivate lifecycle. Panels communicate through the message bus (`Raven.on/dispatch` for local events, `Raven.send` for server events). Current panels include terminal, tasks, overview, sessions, status, settings, memory monitoring, and more.

This separation matters because it keeps the protocol boundary clean. CC hooks, browser panels, CLI scripts, and scheduled jobs are all just API consumers. Adding a new panel means writing one JavaScript file that calls `registerPanel()` — no changes to the server or the core app shell.

## CLI-as-API

The task system demonstrates a pattern used throughout: **Python owns the parsing, Node.js owns the serving.**

A Python CLI tool (`rtasks.py`) handles all task file parsing, deadline logic, and project resolution. It accepts a `--json` flag for structured output. The Node.js server (`lib/tasks.js`) is a thin wrapper — ~100 lines — that calls the Python script via `execFile` and returns parsed JSON to the browser.

A Bash CLI tool (`scripts/raven-ui`) wraps the web UI's HTTP API — sending notifications, creating terminals, querying sessions — all via curl. This makes the web UI's capabilities available to any context: hooks, cron jobs, other agents.

This avoids reimplementing complex parsing in two languages. Each CLI tool works standalone from the terminal, and other components get the same logic for free. The trade-off is a subprocess per request, which is fine at personal-tool scale.

## Hooks as Integration Points

CC hooks fire shell commands on agent lifecycle events. Raven uses them at three different complexity levels:

1. **Notification** — A lightweight hook (`notify-hook.js`) fires on session start, stop, and permission requests. It sends a single HTTP POST to the web UI and exits. The web UI uses these events to update terminal state (is Claude running? is it waiting for permission?).

2. **Guard** — A mid-weight hook (`raven-guard.js`) fires on every tool call as a PreToolUse handler. It reads a mode file to determine its behavior: in default mode, it catches common patterns that trigger permission prompts (command substitution, unnecessary cd chains, redundant venv activation) and returns guidance. In away mode, it additionally blocks tools that require permission prompts — enabling unattended operation with a whitelist of trusted commands.

3. **Sandbox enforcement** — A heavyweight hook (`sandbox-hook.py`) intercepts every tool call during sandboxed work sessions. It checks file paths against worktree boundaries, commands against an allowlist, and file writes against anti-tamper patterns. Exit code 0 means allow, exit code 2 means deny with a reason.

The hook system is the primary mechanism for integrating CC with external services without modifying CC itself.

## Notification System

Agents can push notifications to the browser through an HTTP API (`/api/ui`). Two types exist:

- **Modals** — persistent, stored in `notifications.json`, survive server restarts, require explicit user dismissal. Used for daily briefings, important alerts, or anything that shouldn't be missed.
- **Toasts** — ephemeral, broadcast via WebSocket, disappear after a timeout. Used for status updates, confirmations, progress notes.

Both support markdown rendering. Pending (undismissed) modals are sent to new WebSocket clients on connect, so nothing gets lost if the browser reconnects. A CLI tool (`raven-ui modal/toast`) makes this callable from hooks, cron jobs, or other agents.

## Scheduler and Overnight Pipeline

The server runs a cron scheduler (node-cron) that injects prompts into named terminals. Jobs are defined in `data/jobs.json` — a data file, not code — specifying a cron expression, a target terminal (matched by name prefix), and a prompt string. Complex instructions are externalized to markdown prompt files for readability.

When a job fires, the scheduler finds the target terminal and writes the prompt directly to the PTY. The jobs file is watched with `fs.watch` — editing it takes effect immediately without a server restart.

The scheduler anchors an overnight pipeline that splits work between a local agent and a cloud agent. The local agent (constrained to safe operations by the guard) handles pre-fetching, committing, memory consolidation, and reviewing cloud results. A cloud-hosted Claude Code session (scheduled hourly via Anthropic's web UI) handles tasks requiring web access — one task per run, committed incrementally to a shared branch.

The cloud agent follows a strict decision tree each run: execute a task, review a completed plan, decompose a heavy task, or exit. Heavy tasks are broken into plan files with narrow sub-tasks that span multiple runs. A nightly local job (night-pull) reviews the shared branch and merges to main — acting as a quality gate. Lock files coordinate between runs, with stale locks auto-retried rather than blocking permanently.

## Knowledge Base

A wiki-style knowledge store lives in `knowledge/` with an index, topic articles, and daily narrative entries. Topic articles use wikilinks (`[[topic-name]]`) for cross-referencing; backlinks are computed on request by scanning the file set.

A nightly consolidation skill acts as librarian — gathering inputs from cloud agent reports, research documents, and the day's activity, then updating topic articles in place and writing a reflective daily narrative. Topics are living documents, not append-only logs. Git provides version history.

The web UI provides a wiki panel with sidebar navigation, search, wikilink-based browsing, and backlink display.

## Service Registry

Projects can register web services (dev servers, documentation previews, tool UIs) by adding a `server` field to their `projects.json` entry. The web UI auto-discovers registered services, pings each for liveness (HTTP HEAD, 500ms timeout), and displays them in the dashboard with green/gray status dots.

Client-side host rewriting makes services accessible from any machine on the network: `localhost:5000` is automatically rewritten to use the current browser's hostname when accessed remotely. No proxy, no DNS — just URL rewriting in the browser.

## Skills as the Extension Mechanism

Skills are markdown files that CC reads when invoked. A skill can reference supporting documents (in `references/`) and CLI tools (in `scripts/`). Skills are synced to CC's discovery path via filesystem junctions (symlinks on Unix) — the skill lives in the project repo for version control, but CC discovers it through its global skills directory.

A sync registry (`sync-config.json`) tracks which skills sync where. A Python script creates the junctions. Skills are re-read on every invocation, so editing a SKILL.md takes effect immediately — no restart, no build step.

Current skills cover: project status, session reflection and continuity, task management, document verification, security auditing, sandboxed autonomous work, tool call guardrails, paper reading, memory consolidation, knowledge echo generation, and skill development itself (a meta-skill that creates new skills).

## Task System

Tasks are markdown files — one per project — with a simple format: `- [ ] Task text #tags (deadline)`. A central Python CLI tool parses these, handles deadline logic (smart year defaulting, relative dates), and exposes operations (add, complete, edit, reorder, tag toggle) via subcommands. An inline tag system (`#next`, `#auto`, `#agent`) provides working-set selection, autonomous-work marking, and provenance tracking.

A `projects.json` file at the repo root maps project names to filesystem paths, shorthands, and metadata. The task CLI reads this to resolve project references. The web UI provides a per-project task panel with inline editing, and an overview panel that shows urgency-grouped cards across all projects.

## Session Management

Sessions are tracked through CC's own JSONL transcript files. A persistent name cache scans these files for custom titles (from `/rename` commands), using file modification times to avoid re-reading unchanged transcripts. This replaces an earlier index-based approach that was slower and less reliable.

The sessions panel and API expose recent sessions with metadata (project, model, duration, message count) and support resuming by session UUID.

## Memory and Continuity

CC provides auto-memory (`MEMORY.md` as an index, topic files for detail) which persists across conversations. Raven adds two session-continuity mechanisms:

1. **Reflect** — At session end, saves working state to `in_progress/[label].md`: what's in progress, key decisions, files touched, next steps. The label is user-chosen (suggested by the agent), making it a lightweight stash system.

2. **Continue** — At session start, reads `in_progress/` and presents the most recent state, offering to resume. If nothing is recent, shows a digest of recent states for the user to pick from.

This pair bridges the gap between CC sessions, where context resets on each start. The state files accumulate as a lightweight work log.

A consolidation skill periodically snapshots auto-memory, runs health diagnostics (dangling pointers, bloated index, unreachable files), and guides pruning — treating memory maintenance as a first-class operation rather than an afterthought.
