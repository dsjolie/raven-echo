# Raven Echo

Patterns, solutions, and architecture from building a personal AI assistant on top of Claude Code.

Raven extends Claude Code (Anthropic's CLI agent) with domain skills, a browser-based workspace, cross-project task and knowledge management, and an overnight automation pipeline. Instead of building a custom agent framework, it treats Claude Code as the engine and adds capability through its native extension points: skills, hooks, and context files.

This repository captures the interesting parts — architecture decisions, reusable patterns, and edge-case solutions found along the way. It's written for two audiences:

1. **Developers** building similar systems (AI-assisted tools, coding-agent extensions, local-first workflows).
2. **AI agents** that could use these documents to bootstrap an equivalent system from scratch.

**[Visual overview](https://dsjolie.github.io/raven-echo/overview.html)** — a designed one-page overview with architecture diagram and navigation.

## Screenshots

![Dashboard](screenshots/dashboard-full.jpg)
*Central dashboard — terminals, sessions, tasks, services, and uptime at a glance*

| | | |
|---|---|---|
| ![Visual explainer](screenshots/visual-explainer.jpg) | ![Wiki](screenshots/wiki.jpg) | ![Tasks](screenshots/tasks-overview.jpg) |
| Auto-generated architecture docs | Knowledge base wiki | Task overview with permission indicator |
| ![Hero](screenshots/hero.jpg) | ![Terminal](screenshots/terminal.jpg) | ![Memory](screenshots/memory.jpg) |
| Splash screen | Web terminal building a UE project | Memory monitoring |

## Contents

### Architecture & Philosophy

- [architecture.md](architecture.md) — System design: how the components connect and why
- [principles.md](principles.md) — Design philosophy with concrete examples
- [history.md](history.md) — Project timeline: origins, pivots, growth, and current state

### Patterns

Reusable approaches that generalize beyond this specific project.

- [patterns/skill-system.md](patterns/skill-system.md) — Extending an AI agent with domain skills via markdown and CLI tools
- [patterns/hook-system.md](patterns/hook-system.md) — Using agent hooks for notification, detection, and permission enforcement
- [patterns/panel-system.md](patterns/panel-system.md) — A minimal panel-based web UI as a window manager for agent tools
- [patterns/cli-as-api.md](patterns/cli-as-api.md) — CLI tools as the implementation layer, called from Node.js with `--json`
- [patterns/session-continuity.md](patterns/session-continuity.md) — A save-at-end / restore-at-start stash cycle for working state across agent sessions
- [patterns/threads.md](patterns/threads.md) — The work unit between a task and a project, tracked across sessions and machines via per-machine sidecars
- [patterns/spec-driven-sandbox.md](patterns/spec-driven-sandbox.md) — Sandboxing autonomous agents with hook-enforced permission boundaries
- [patterns/guard-system.md](patterns/guard-system.md) — Mode-based tool-call guardrails via a PreToolUse hook
- [patterns/gitlock.md](patterns/gitlock.md) — An advisory commit-lock for multiple agent sessions sharing one git clone
- [patterns/notification-system.md](patterns/notification-system.md) — Agent-to-browser messaging with persistent modals and ephemeral toasts
- [patterns/scheduler.md](patterns/scheduler.md) — Server-side cron with prompt injection into a persistent agent terminal
- [patterns/overnight-pipeline.md](patterns/overnight-pipeline.md) — Local-cloud split for unattended research, with plan decomposition and review gates
- [patterns/task-system.md](patterns/task-system.md) — Cross-project task management with markdown files, urgency grouping, and autonomous-task tagging
- [patterns/knowledge-base.md](patterns/knowledge-base.md) — Wiki-style knowledge store with wikilinks, nightly consolidation, and cross-project access
- [patterns/service-registry.md](patterns/service-registry.md) — Declarative service registration with liveness pinging and host rewriting for remote access
- [patterns/audio-pipeline.md](patterns/audio-pipeline.md) — Document-to-speech where the rewrite step matters more than the engine, with content-hashed caching
- [patterns/desktop-launcher.md](patterns/desktop-launcher.md) — A native Wails shell that manages multiple local and remote web-app instances
- [patterns/echo-generation.md](patterns/echo-generation.md) — Auto-generating shareable knowledge extracts from a private repo

### Solutions

Specific edge-case fixes and workarounds — problems that took real debugging time.

- [solutions/pty-line-endings.md](solutions/pty-line-endings.md) — Why `\r\n` breaks terminal input on Windows
- [solutions/venv-node-integration.md](solutions/venv-node-integration.md) — Pinning the Python interpreter and its output encoding when called from Node.js
- [solutions/claude-detection.md](solutions/claude-detection.md) — Detecting when an AI agent is running in a terminal
- [solutions/process-lifecycle.md](solutions/process-lifecycle.md) — Orphaned child processes when stopping a wrapper launcher
- [solutions/pwd-p4-leak.md](solutions/pwd-p4-leak.md) — An inherited `PWD` env var that overrides a tool's real working directory
- [solutions/dropbox-file-locking.md](solutions/dropbox-file-locking.md) — Build failures and temp-file debris from cloud-sync file locks
- [solutions/windows-shell-quirks.md](solutions/windows-shell-quirks.md) — Encoding, paths, and shell compatibility on Windows
- [solutions/cross-platform.md](solutions/cross-platform.md) — Portability seams between Windows and macOS clones of one repo
- [solutions/xterm-upgrade.md](solutions/xterm-upgrade.md) — Migrating from xterm.js 5.x to 6.x without breaking scrolling

### Scripts

Self-contained, reusable scripts copied verbatim from the project.

- [scripts/](scripts/) — Guard hook, notification hook, sandbox hook, commit-lock CLI, permission profiles

## How to Use This

**As a human:** Browse the patterns and solutions that interest you. Each document explains the problem, the approach, and the gotchas.

**As an AI agent:** Read `architecture.md` first for the overall system design, then `principles.md` for the philosophy. Use the patterns as blueprints and the solutions as known-issue references. Together they should be enough to build an equivalent system in your preferred stack.

## About This Repo

This repository is itself an echo — regenerated from a private project by an AI skill that reads the live codebase and writes fresh descriptions. Documentation is written fresh, not copied and filtered. Each pattern and solution is produced by a focused subagent that reads its specific sources in full; scripts that are self-contained and free of specifics are copied verbatim, and any script with hardcoded specifics is reported rather than auto-sanitized.

The approach is itself a reusable pattern: [patterns/echo-generation.md](patterns/echo-generation.md) describes how it works and how to set it up for your own projects. The short version — an AI agent reads your private repo, writes shareable descriptions into a separate public repo, and you review and commit when satisfied.
