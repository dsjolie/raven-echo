# Architecture

## Core Strategy: Extend, Don't Replace

Raven is not an agent framework. It's a layer on top of Claude Code — Anthropic's CLI agent, which already handles tool use, file editing, code generation, subagent orchestration, and conversation management.

The reasoning is economic. Claude Code is built by a well-resourced team and improves continuously; every gain in models, tool handling, and context management arrives for free. Building a competing harness means reimplementing all of that and then racing to keep up. So Raven adds capability through Claude Code's native extension points instead:

- **Skills** — markdown instruction files that teach the agent new workflows, each re-read on invocation.
- **Hooks** — scripts that fire on agent lifecycle events (session start, every tool call, permission requests, stop).
- **Context files** — instruction and memory files that carry persistent knowledge into every session.

The entire "agent core" is Claude Code itself. Raven supplies the domain knowledge, the access layer, and the glue between the agent and a real working environment.

## Component Map

```
Claude Code (the engine)
  │
  ├── skills/         Markdown skills + CLI tools, synced via filesystem links
  │     ├── SKILL.md      Instructions for the agent (re-read each invocation)
  │     ├── references/   Supporting docs (live, no restart needed)
  │     └── scripts/      CLI tools in Python / Go / Bash
  │
  ├── web-ui/         Browser-based workspace
  │     ├── server.js     HTTP + WebSocket, PTY management, scheduler, notifications
  │     ├── lib/          Service modules (terminals, tasks, sessions, threads,
  │     │                 status cache, memory monitor, files)
  │     ├── public/       Client panels + the core app shell
  │     ├── hooks/        Agent hook scripts (notify, guard, gitlock-nudge, away-reject)
  │     └── data/         Runtime config (jobs.json, documents.json, notifications.json)
  │
  ├── desktop-app/    Native shell (Wails / Go) wrapping one or more web-ui instances
  ├── scripts/        CLI tools callable from any context (audio narration, sync, etc.)
  ├── knowledge/      Wiki: index, topic articles, daily narratives
  ├── in_progress/    Thread state + per-machine session sidecars
  ├── tasks/          Per-project task files (markdown)
  ├── docs/           Research, architecture notes, design documents
  └── projects.json   Registry of tracked projects: paths, shorthands, metadata
```

Each top-level directory is independent. No component requires another to run — the web UI works without skills, skills work without the web UI, and tasks are usable from either the CLI or the browser. The coupling that exists is through shared *data* (the registry, the task files, the git repo), not through code dependencies.

## The Web UI: An OS Metaphor

The web UI is organized like an operating system: the server is the kernel, the browser is the window manager.

**Server (kernel):** `server.js` plus the `lib/` modules handle system-level concerns — spawning PTY processes, managing WebSocket connections, executing task operations, watching memory usage, running scheduled jobs, storing notifications. It exposes an API (HTTP + WebSocket) and renders no UI.

**Client (window manager):** `app.js` provides panel registration and switching, a message bus, and connection lifecycle management. It holds no domain logic — panels plug into it.

**Panels (applications):** Each panel registers with `Raven.registerPanel()` and gets an init/activate/deactivate lifecycle. Panels talk through the message bus (`Raven.on`/`dispatch` for local events, `Raven.send` for server events). Adding a panel means writing one JavaScript file — no changes to the server or the shell.

This keeps the protocol boundary clean: hooks, browser panels, CLI scripts, and scheduled jobs are all just API consumers, none of them privileged.

## CLI-as-API

A pattern used throughout: **the CLI tool is the implementation; everything else calls it.**

A Python CLI owns all task-file parsing, deadline logic, and project resolution, and offers a `--json` flag. The Node server module is a thin wrapper that shells out to it and returns parsed JSON to the browser. The same tool runs standalone in a terminal, and every other consumer gets identical behavior for free — no parser reimplemented in a second language. A separate Bash CLI wraps the web UI's own HTTP API (notifications, terminal creation, session queries) so the UI's capabilities are reachable from hooks, cron jobs, and other agents. The cost is a subprocess per request, which is irrelevant at personal-tool scale.

## Hooks as Integration Points

Hooks fire scripts on agent lifecycle events, and they're the primary way Raven integrates with the agent without modifying it. They run at several complexity levels:

1. **Notification** — a lightweight hook fires on session start/stop and permission requests, POSTs a single event to the web UI, and exits. The UI uses these to track terminal state (running? awaiting permission?).
2. **Guard** — a mid-weight PreToolUse hook fires on every tool call and reads a mode file to decide its behavior: in default mode it catches command patterns that would trigger permission prompts and returns guidance; in away mode it additionally blocks tools that need prompts, enabling unattended runs behind a whitelist.
3. **Sandbox enforcement** — a heavyweight hook gates every tool call during sandboxed work, checking paths against worktree boundaries and commands against an allowlist.
4. **Advisory nudges** — a PostToolUse hook reminds a session to release the commit-lock after committing; a PermissionRequest hook auto-rejects prompts in away mode.

Exit codes are the API: 0 allows, nonzero blocks with a message surfaced to the agent so it can adapt. Behavior that needs to change at runtime (the guard's mode) lives in an external file the hook reads on each invocation, not in the hook itself.

## Notification System

Agents push notifications to the browser through an HTTP endpoint. Two types, distinguished by durability:

- **Modals** — persistent, stored to disk, survive server restarts, require explicit dismissal. For briefings and alerts that must not be missed.
- **Toasts** — ephemeral, WebSocket-broadcast, auto-dismissed. For status and confirmations.

Both render markdown. Undismissed modals are re-sent to a browser when it reconnects, so nothing is lost across a refresh. A CLI wrapper makes the whole thing callable from any context.

## Scheduler and the Persistent Coordinator

The server runs a cron scheduler that injects prompts into named terminals by writing directly to their PTYs. Jobs live in a JSON config — data, not code — specifying a cron expression, a target terminal (matched by name prefix), and a prompt; the file is watched so edits take effect without a restart.

The standing coordinator is **Munin**, a persistent Claude Code session that auto-launches with the server and auto-resumes its most recent session on restart (newest session UUID wins). Scheduled jobs originally all targeted Munin; routing has since moved to **threads** — terminals carry a `thread` property, jobs target a thread label, and a `launch-thread` action can start a fresh session on a thread (skipping if one is already live, so a re-firing cron never double-runs a pipeline). The nightly pipeline now runs in its own fresh session each night; Munin's role narrowed to lifecycle management — a morning check verifies the night's work from durable state and closes the tab. The coordinator manages; it no longer relays messages.

## Overnight Pipeline

The scheduler and the guard's away mode together enable unattended overnight operation, split across two agents because web access is the dangerous capability (untrusted content + tools + an exfiltration path). A **local** agent, constrained by the guard, does pre-fetching, committing, memory consolidation, and review. A **cloud** Claude Code session, scheduled hourly, handles web-access tasks — one per run, committed incrementally to a shared branch, following a strict decision tree (execute / review a plan / decompose a heavy task / exit). A nightly local night-pull reviews the branch and merges to main as a human-absent quality gate. The git repo is the coordination bus; lock files serialize runs and auto-retry stale locks rather than blocking forever.

## Thread Routing and Events

External processes — cron jobs, sessions on other machines, skills — message *threads*, not sessions. One endpoint (`POST /api/event`) appends the event to a durable per-thread log and, if a session is live on that thread, injects a short doorbell pointing at the log. The principle: **files carry content, injection carries doorbells** — a message survives whether or not anyone is home, and the API never grows payload schemas. Injections are verified after the fact against the prompt-submission log; misses are logged for the morning sweep rather than filed as tasks. Cross-machine messaging is the same endpoint on the target's VPN address. Receiving threads treat events as *requests, not authorizations* — the session verifies an event's claims before mutating anything. Details in [patterns/thread-routing.md](patterns/thread-routing.md).

## Interactive Artefacts and Worklogs

HTML reports collect their own review: declarative choice widgets and auto-anchored headings, activated by one script, persist annotations to a sidecar JSON next to the artifact; an explicit Submit bundles the review into a single consideration routed to an apply-feedback handler. Because anchors are derived and the script is injected server-side when serving any registered document, the entire back catalogue is commentable without regeneration. Long tasks emit **worklogs** — JSONL events appended by a CLI, rendered live by a generic polling viewer, and finalized into a static report that inherits the annotation layer. Details in [patterns/interactive-artefacts.md](patterns/interactive-artefacts.md).

## Multi-Session Safety

More than one agent session can share a single clone — and then they share one working tree, index, and HEAD. Concurrent `git add` cross-contaminates the staged index, and `git commit --amend` can rewrite whichever commit HEAD now points at. An advisory **commit-lock** serializes the stage→commit critical section: a session acquires the lock (keyed on its session id) before mutating git, and the guard hook blocks index/HEAD-mutating git verbs unless the caller holds it. Reads and `push` are never gated; the lock fails open so it can never brick the repo. Cross-machine coordination stays on push/pull, deliberately — the lock is intra-clone only.

## Knowledge Base

A wiki-style store lives in `knowledge/`: an index, topic articles, and dated daily narratives. Articles cross-reference with wikilinks; backlinks are computed on demand by scanning the file set, so there's no link database to maintain. A nightly consolidation skill acts as a librarian — it gathers the day's inputs and updates topic articles *in place* (living documents, not append-only logs), then writes a reflective daily narrative. Git holds the history.

Crucially, the store isn't trapped in one repo: a CLI reads and writes the wiki from *any* project's working directory, gated by a discovery sentinel and narrowly-scoped file allows, with an audit scanner enforcing the routing discipline. The web UI adds a wiki panel with search, wikilink navigation, and backlink display.

## Audio Narration

A pipeline turns documents into listenable audio: markdown → strip markup → chunk → text-to-speech → a content-hashed cache → published audio files (single, or multi-part for long documents). The cache is keyed on the text itself, so unchanged content is never re-synthesized. The canonical reader-panel entry is the spoken *source* document; the audio files are artifacts grouped under it. The core thesis — the rewrite-into-spoken-form step matters more than the engine choice — resolved upstream: the model that authors a document writes its spoken version, and the pipeline just synthesizes. The engine is now a self-hosted TTS server on a fleet machine, which made rendering free and turned listening versions from a rationed luxury into a default.

## Self-Hosted GPU Services

Spare GPUs in the fleet host model servers behind a common shape: VPN-bound FastAPI, one GPU thread for all pipeline work, seed-as-ID for reproducible output, content-hashed client-side caching, boot-time start with wait-for-VPN. The TTS server keeps its model resident; the image-generation server (an open-weight, caption-trained model on a machine with a day job) **loads on demand and unloads after idle**, with a keep-loaded lease endpoint so iteration loops don't pay the multi-minute cold load per round. Serving is offline-first — cached weights load without any network validation (see [solutions/offline-first-model-serving.md](solutions/offline-first-model-serving.md)). On top of the image service sits a figure-generation workflow for papers, where the structured caption — not the image — is the artifact under iteration ([patterns/figure-generation.md](patterns/figure-generation.md)).

## Service Registry

Projects register web services (dev servers, doc previews, tool UIs) by adding a `server` field to their registry entry. The web UI auto-discovers them, pings each for liveness (HTTP HEAD, short timeout), and shows status dots in the dashboard. For remote access, the browser rewrites a service's `localhost` host to the current page's hostname — no proxy, no DNS, just URL rewriting on the client.

## Skills as the Extension Mechanism

Skills are markdown files the agent reads when invoked, optionally with supporting docs (`references/`) and CLI tools (`scripts/`). They're synced to the agent's discovery path via filesystem junctions (symlinks on macOS) — the skill lives in the repo for version control, but the agent finds it through its global skills directory, and edits in either location are live immediately, with no build step. A sync registry tracks which skills sync where, including third-party skills cloned into a gitignored directory.

## Task System

Tasks are plain markdown lines — `- [ ] text #tags (deadline)` — greppable, hand-editable, and diffable, with no database. A central Python CLI is the single parser (deadline logic, project resolution); the web UI's per-project and cross-project overview panels call it via `--json`. Inline tags carry working-set selection and autonomous-work marking. The project registry maps shorthands to file paths so one CLI spans every project.

## Considerations and the Project Focus Cockpit

Once agents run unattended, they file suggestions of their own — and they file them faster than a human drains them. To keep the agent's firehose from drowning the human's backlog, agent-filed items (`#agent`, no lane, no deadline) are reclassified as **considerations**: a derived set, computed by the same parser from the same task file, but deliberately excluded from the human "to triage" count. Each consideration's category tag routes it to a **handler** — the procedure that actually does the work (a safe in-place edit, an adversarial citation verification, or "surface this to a human"). A handler runs autonomously only if it can do its verb with inspectable evidence and surface on doubt; everything else routes to a person. Every action appends to a log that doubles as the UI's review surface.

The project's Tasks panel became a **Project Focus** cockpit on top of this: sub-views for committed Tasks, the Considerations pile (grouped into human buckets — needs-you, agent-will-handle, uncategorised — with promote/dismiss per item), and Review (the handler action log, each row carrying a copyable revert command, because the UI itself never runs git). Pending human decisions are *not* buried behind a tab — they sit as a callout in the primary view, because a hidden decision is still a human to-do you're lying to yourself about.

## Task Discussions

Backlog items lose their context faster than their content. A per-item "Discuss" button spawns a fresh, context-primed agent session in a modal that — before the human types — reconstructs when and why the item was filed (git-blame), what it points at, and whether its premise still holds. The conversation is scoped to one item, ephemeral (its own lightweight file-based pile, not a thread), and lands on a concrete disposition. The modal is backed by a real PTY terminal; an Elevate action re-homes it into a normal terminal tab without killing the session when a quick discussion turns into real work. This works because the client event bus is multi-subscriber, so a modal and a tab can share one session's output stream.

## Session Management

Sessions are tracked through Claude Code's own JSONL transcript files. A persistent name cache scans them for custom titles, using file modification times to skip unchanged transcripts — this replaced an earlier index-based approach that was slower and more brittle. The sessions panel exposes recent sessions with metadata and supports resuming by UUID.

## Memory and Continuity

Claude Code provides auto-memory (an index file plus topic files) that persists across conversations. Raven adds a session save/restore cycle on top: **reflect** saves working state to a labeled file (`in_progress/<label>.md`) at session end — what's in progress, key decisions, files touched, next steps — and **continue** reads `in_progress/` at session start and offers to resume the most recent, or shows a digest to pick from. The label is a human-chosen stash key.

A consolidation skill periodically snapshots auto-memory, runs health diagnostics (dangling pointers, bloated index, unreachable files), and guides pruning — treating memory maintenance as a first-class operation.

## Threads

The labeled files that reflect and continue read and write are **threads** — the work unit between a single task and a whole project (a refactor, a feature design, a paper revision). Threads are first-class: they have an overview CLI, a web UI panel, and a session-tracking layer that works across machines.

Because one repo is often cloned on several machines, session bookkeeping is split into **per-machine sidecars** (`in_progress/machines/<clone>/<label>.md`) — one file per machine per thread. Each clone appends only to its own sidecar, so git never sees a conflict on session data while the thread file itself stays clean. Machine identity resolves through a checked-in hostname→friendly-name map, with a raw-hostname fallback for unregistered clones. The CLI gives a cross-project overview (threads, last activity, and session counts aggregated across every machine's sidecar), idempotent session-linking, and backfill that reconstructs history from past transcripts.

## Native Desktop Shell

A small Wails app (Go backend + system WebView) wraps the browser workspace as a native, multi-instance launcher. It spawns and stops *local* web-ui instances itself (running the Node server with a chosen port and streaming its startup log) and merely connects to *remote* instances over a VPN. Each instance is embedded in its own iframe, so switching between Ravens preserves each one's live session and terminal state. Process management is split per platform (separate Go files for Windows and Unix), because killing a spawned process tree differs across OSes.

## Cross-Platform

Raven started Windows-only and now also runs on macOS and a headless Linux node — several clones of one repo across a small fleet. The large pieces port cleanly; the breakage is at the seams — in-place `sed` flags (BSD vs GNU), path separators, OS-conditional UI terminology, and machine identity. The hostname→name map is what lets git-tracked, per-machine state coexist across a mixed fleet. On the always-on Linux node the web UI runs as a user service and binds only to loopback and the machine's own auto-detected VPN address — never the public interface — so a shared instance is reachable from the other machines without being exposed. The secondary VPN binds are self-healing: after a restart the address can briefly still be held by the dying server, so they retry `EADDRINUSE` instead of silently degrading to loopback-only, while the primary loopback bind is allowed to fail loudly.

## Machine Fleet

The fleet itself became first-class. A single git-tracked **machine registry** (hostname → name, platform, role, VPN address, availability, capabilities, proxy port) feeds everything that needs a roster: a fleet status card with availability-aware liveness (a machine that's off *on schedule* renders grey, not red), the desktop launcher, and **backend switching** — every server reverse-proxies every other machine's UI on a globally unique per-machine port, so `<any-host>:<machine's-port>` reaches that machine from anywhere and links compose correctly through switched views. Proxied requests are header-stamped, and the backend blocks mutations that would land in the wrong machine's working tree. Coordination channels are chosen by what's moving: git for durable shared truth, direct HTTP over the VPN for control (events, liveness, dispatch), a shared folder for bulk artifacts only. Details in [patterns/machine-fleet.md](patterns/machine-fleet.md).
