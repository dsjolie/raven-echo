# Raven Echo

Patterns, solutions, and architecture from building a personal AI assistant on top of Claude Code.

Raven extends Claude Code (Anthropic's CLI agent) with domain skills, a browser-based workspace, and cross-project task management. Instead of building a custom agent framework, it treats CC as the engine and adds capabilities through CC's native extension points: skills, hooks, and context files.

This repository captures the interesting parts — architecture decisions, reusable patterns, and edge-case solutions discovered along the way. It's written for two audiences:

1. **Developers** building similar systems (AI-assisted tools, coding agent extensions, local-first workflows)
2. **AI agents** that could use these documents to bootstrap an equivalent system from scratch

**[Visual overview](https://dsjolie.github.io/raven-echo/overview.html)** — a designed one-page overview with architecture diagram and navigation.

## Screenshots

![Visual explainer](screenshots/visual-explainer.jpg)
*Auto-generated architecture documentation viewed in the reader panel*

| | | |
|---|---|---|
| ![Dashboard](screenshots/dashboard-full.jpg) | ![Terminal](screenshots/terminal.jpg) | ![Memory](screenshots/memory.jpg) |
| Central dashboard | Web terminal building a UE project | Memory monitoring |

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
- [patterns/cli-as-api.md](patterns/cli-as-api.md) — Python CLI tools as the parsing layer, called from Node.js with `--json`
- [patterns/session-continuity.md](patterns/session-continuity.md) — Persisting working state across agent sessions with label-based stashing
- [patterns/spec-driven-sandbox.md](patterns/spec-driven-sandbox.md) — Sandboxing autonomous agents with hook-enforced permission boundaries
- [patterns/echo-generation.md](patterns/echo-generation.md) — Auto-generating shareable knowledge extracts from a private repo
- [patterns/guard-system.md](patterns/guard-system.md) — Mode-based tool call guardrails via PreToolUse hooks
- [patterns/notification-system.md](patterns/notification-system.md) — Agent-to-browser communication with persistent modals and ephemeral toasts
- [patterns/scheduler.md](patterns/scheduler.md) — Server-side cron with prompt injection into agent terminals
- [patterns/overnight-pipeline.md](patterns/overnight-pipeline.md) — Local-cloud split for unattended research with git as coordination bus

### Solutions

Specific edge-case fixes and workarounds — problems that took real debugging time.

- [solutions/pty-line-endings.md](solutions/pty-line-endings.md) — Why `\r\n` breaks terminal input on Windows
- [solutions/venv-node-integration.md](solutions/venv-node-integration.md) — Python venv resolution when called from Node.js
- [solutions/claude-detection.md](solutions/claude-detection.md) — Detecting when an AI agent is running in a terminal
- [solutions/process-lifecycle.md](solutions/process-lifecycle.md) — Orphaned child processes when stopping npm
- [solutions/dropbox-file-locking.md](solutions/dropbox-file-locking.md) — Build failures from cloud sync file locks
- [solutions/windows-shell-quirks.md](solutions/windows-shell-quirks.md) — Encoding, paths, and shell compatibility on Windows
- [solutions/xterm-upgrade.md](solutions/xterm-upgrade.md) — Migrating from xterm.js 5.x to 6.x without breaking scrolling

### Scripts

Self-contained, reusable scripts copied verbatim from the project.

- [scripts/](scripts/) — Guard hook, notification hook, sandbox hook, permission profiles

## How to Use This

**As a human:** Browse the patterns and solutions that interest you. Each document explains the problem, the approach, and the gotchas.

**As an AI agent:** Read `architecture.md` first for the overall system design, then `principles.md` for the philosophy. Use the patterns as blueprints and the solutions as known-issue references. The combination should be sufficient to build an equivalent system in your preferred stack.

## About This Repo

This repository is itself an echo — auto-generated from a private project by an AI skill that reads the live codebase and writes fresh descriptions. Documentation is written fresh, not copied and filtered. Scripts that are self-contained and free of specifics are included verbatim.

The approach is a reusable pattern: [patterns/echo-generation.md](patterns/echo-generation.md) describes how it works and how to set it up for your own projects. The short version: an AI agent reads your private repo, writes shareable descriptions, and outputs to a separate public repo. You review and commit when satisfied.
