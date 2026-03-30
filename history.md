# History

A timeline of how Raven evolved from a research spike into a working personal AI assistant.

## Origins (Feb 2026)

Raven started on February 2, 2026 as a research project exploring what a personal AI assistant could look like. The first commit was just structure and notes — no code. The initial days were spent surveying the landscape: existing agent frameworks, session management patterns, the Agent SDK, MCPorter, and whether to build something from scratch.

The early research looked seriously at TypeScript (for a custom agent framework) and at the Anthropic Agent SDK (for a standalone interface). Both were evaluated and set aside. The Agent SDK required an API key and didn't have official support for subscription-based authentication. A custom framework meant reimplementing features that Claude Code already had and would keep improving.

## The Pivot (Feb 7)

Five days in, the project pivoted decisively: **extend Claude Code, don't replace it.** This was the most important architectural decision. Rather than building a competing agent framework, Raven would add capabilities through CC's native extension points — skills, hooks, and context files.

The same day, the first skills appeared (`raven-status` for cross-project overview, `raven-reflect` for session review), the archive directory was created for abandoned approaches, and the web terminal — originally a standalone experiment — was moved into the project and restructured as a flat architecture.

## The Web UI (Feb 7–15)

The web terminal quickly evolved beyond a simple terminal. On February 7 it became a panel-based workspace — an app shell with `registerPanel()`, a message bus, and lifecycle hooks. Status and sessions panels appeared the same day.

Over the next week, the UI grew mobile support (touch scrolling, shortcut bar, compose mode, voice input), Claude detection in terminals, and an About page. The metaphor crystallized: the server is the kernel, the browser is the window manager, panels are applications. Each new surface could be added without touching the core.

## The Memory Paper (Feb 8–Mar)

Alongside the tool-building, a research thread was running: how should AI agents handle persistent memory? This became a formal paper — "I Know I Know This: Recognition First in Agent Memory" — exploring dual-process theory applied to agent retrieval. The recognition-gated retrieval design emerged on February 8, arguing that agents should use cheap recognition signals before expensive retrieval.

The paper went through multiple revision cycles, a verification pass that caught 22 hallucinated bibliography entries (a significant lesson), a novelty search, and deep dives into related work (Memento 2's SRDP framework, ENGRAM's typed memory, HiMem's reconsolidation). A shorter version became the primary submission target, with the long paper demoted to reference.

## Verification and Security (Feb 19–22)

The `raven-verify` skill was built to verify claims and references in prose documents — prompted directly by the bibliography hallucination incident. Three-pass extraction (claims, verification, references) with four modes.

`raven-audit` followed, auditing Claude Code's permission configuration for security issues, stale rules, and bypass vectors. Research into the "lethal trifecta" (tool access + untrusted input + exfiltration channel) shaped deny rules and tool guidance that persists today.

## The Task System (Feb 27–Mar)

A centralized task management system appeared on February 27: markdown files (one per project), a Python CLI parser (`rtasks`), and web UI panels. The key design choice was CLI-as-API — Python owns all parsing, Node.js calls it with `--json`. This avoided reimplementing deadline logic and project resolution in two languages.

The system grew incrementally: inline editing, an overview panel with urgency-grouped cards across all 17 tracked projects, an inbox, `#next` and `#auto` tags for working-set selection and autonomous work marking, and orphan task file detection.

## Sandboxed Work (Mar 1)

`raven-work` introduced spec-driven autonomous work sessions with hook-enforced permission boundaries. Three profiles (dev, research, review) define what the agent can access. A PreToolUse hook checks every tool call against the profile — file paths against worktree boundaries, commands against allowlists. The principle: if you can run it, you can't write it.

## The Persistent Coordinator (Mar 14)

Munin — named after one of Odin's ravens (the one representing memory) — was introduced as a persistent Claude Code session that auto-launches with the web UI server. It handles scheduled tasks and serves as a coordination point. A toolbar button in the web UI indicates whether Munin is running.

The same day, `raven-echo` was created to generate shareable knowledge extracts from the private repo.

## Notifications and Scheduling (Mar 16–19)

The notification system gave agents a way to push messages to the browser — persistent modals for things that shouldn't be missed, ephemeral toasts for status updates. A CLI wrapper (`raven-ui modal/toast`) made it callable from any context.

The server-side scheduler (node-cron with a JSON config file) connected cron expressions to terminal prompt injection — writing commands directly to named terminal PTYs when the agent is running. Hot-reloadable without server restart. First jobs: daily memory consolidation at 04:00, morning briefings at 06:28.

## The Guard System (Mar 20–22)

`raven-guard` refactored away-mode into a three-tier system: always-on guardrails that catch permission-triggering patterns (like `cd && command` or `$()`), away-mode blocking for unattended operation, and off. The key insight was guidance over blocking in default mode — teaching the agent to avoid problematic patterns rather than just preventing them.

The web UI got a sidebar button and API endpoint for toggling guard modes, and a speed dial submenu for quick access.

## The Overnight Pipeline (Mar 22–30)

The guard's away mode plus the scheduler enabled a qualitative shift: unattended overnight automation. The initial pipeline ran auto-tasks locally at 03:05, but local-only operation couldn't do web research.

The solution was a local-cloud split. A cloud-hosted Claude Code session (via Anthropic's RemoteTrigger API, running Sonnet on a 03:00 UTC cron) handles tasks needing web access. The local agent brackets the cloud run: a night-push at 02:30 commits safe work and pre-fetches JavaScript-rendered URLs (via headless Chrome), a night-pull at 05:00 retrieves cloud results.

The git repository became a coordination bus between agents. The cloud agent reads task files, writes reports to `incoming/`, and pushes. The local agent pulls and summarizes. No direct agent-to-agent communication — just files in a repo.

The cloud agent's undocumented execution time limit prompted an incremental commit pattern: commit and push after each completed task rather than batching at the end. When a large research task timed out, a continuation pattern emerged: merge partial results into main, push, create a new one-shot trigger with "continue from where you left off" instructions. This delivered a complete 7-theme literature review across 3 sequential cloud agent runs.

Cross-platform support also landed in this period: the sync-skills script gained macOS symlink support (previously Windows junctions only), and the activate-venv script handles both platforms.

## Current State (Mar 30, 2026)

Eight weeks from first commit. The system has:

- **15 skills** covering status, reflection, continuity, task management, verification, security auditing, sandboxed work, paper reading, memory consolidation, knowledge sharing, tool guardrails, and skill development
- **A panel-based web UI** with terminal, tasks, overview, sessions, status, memory, settings, read, and about panels — accessible from desktop and mobile
- **A notification and scheduling system** for proactive agent behavior
- **An overnight local-cloud pipeline** for unattended research, memory maintenance, and security auditing
- **A research paper** on agent memory architecture, under revision for publication — plus a new assessment/examination paper spawned from overnight cloud research
- **An echo system** (this repo) for sharing knowledge from a private codebase

Active work fronts include memory architecture implementation (recognition hook design converged, implementation next), the assessment paper (courses-as-courses), and continued overnight pipeline refinement.
