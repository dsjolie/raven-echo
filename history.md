# History

How Raven evolved from a research spike into a working personal AI assistant. This is the one document here that's about Raven specifically rather than generalizable patterns — it's the context for why the patterns and solutions exist.

## Origins (Feb 2026)

Raven began on February 2, 2026 as a research project asking what a personal AI assistant could be. The first commit was structure and notes — no code. The opening days went to surveying the landscape: existing agent frameworks, session-management patterns, the Anthropic Agent SDK, MCPorter, and the build-vs-extend question.

Two serious candidates were evaluated and set aside. A custom TypeScript agent framework would mean reimplementing tool use, editing, and context management that Claude Code already had and would keep improving. The Agent SDK required an API key and lacked official support for subscription-based auth. Both roads led back to the same realization.

## The Pivot (Feb 7)

Five days in, the project pivoted decisively: **extend Claude Code, don't replace it.** This is the most consequential decision in Raven's history. Instead of competing with the agent core, Raven would add capability through Claude Code's native extension points — skills, hooks, and context files — and let the engine improve underneath it for free.

The same day, the first skills appeared (`raven-status` for cross-project git overview, `raven-reflect` for session review), an archive directory was created for abandoned approaches, and an experimental standalone web terminal was folded into the project under a flat, component-per-directory architecture.

## The Web UI (Feb 7–15)

The web terminal outgrew its name fast. Within days it became a panel-based workspace: an app shell with `registerPanel()`, a message bus, and a panel lifecycle. Status and sessions panels landed the same week, then mobile support (touch scrolling, a shortcut bar, compose mode, voice input), terminal-level Claude detection, and an about page.

The organizing metaphor crystallized here and still holds: the server is the kernel, the browser is the window manager, panels are applications. New surfaces plug in without touching the core.

## The Memory Paper (Feb 8 onward)

A research thread ran alongside the tooling: how should AI agents handle persistent memory? It became a formal paper — *"I Know I Know This: Recognition First in Agent Memory"* — applying dual-process theory to agent retrieval, arguing that agents should use cheap recognition signals before paying for expensive retrieval.

A verification pass on the manuscript caught 22 hallucinated bibliography entries. That single incident shaped two later tools (`raven-verify`, then a citation-recall benchmark) and hardened the project's stance on reading and checking sources. A shorter version became the primary submission; the long paper was demoted to reference.

## Verification and Security (Feb 19–22)

`raven-verify` was built directly in response to the bibliography incident — a three-pass tool (extract claims, verify them, audit references) for prose documents. `raven-audit` followed, scanning Claude Code's permission configuration for stale rules and bypass vectors. Research into the "lethal trifecta" (tool access + untrusted input + an exfiltration channel) produced deny rules and tool guidance that still ship today.

## The Task System (Feb 27 onward)

A cross-project task system arrived: markdown files (one per project), a Python CLI parser, and web UI panels. The defining choice was CLI-as-API — Python owns all parsing and deadline logic, Node calls it with `--json` — so the rules live in one place instead of being reimplemented per consumer. It grew inline editing, an urgency-grouped overview across every tracked project, an inbox, and inline tags (`#next`, `#auto`, `#agent`) for working-set selection and autonomous-work marking.

## Sandboxed Work (Mar 1)

`raven-work` introduced spec-driven autonomous sessions with hook-enforced boundaries. Three profiles (dev, research, review) declare what the agent may touch; a PreToolUse hook checks every call against the profile — paths against worktree boundaries, commands against an allowlist. The governing rule: if you can run it, you can't write it.

## The Persistent Coordinator (Mar 14)

Munin — named for one of Odin's ravens, the one that stands for memory — arrived as a persistent Claude Code session that auto-launches with the web UI server and serves as the standing target for scheduled work. The same day, `raven-echo` was created to generate shareable knowledge extracts from the private repo (this repository is its output).

## Notifications and Scheduling (Mar 16–19)

The notification system gave agents a way to push to the browser: persistent modals for things that must not be missed, ephemeral toasts for status. A CLI wrapper made it callable from any context. The server-side scheduler (node-cron over a hot-reloadable JSON config) connected cron expressions to terminal prompt injection — writing commands straight into a named terminal's PTY. First jobs: nightly memory consolidation and a morning briefing.

## The Guard System (Mar 20–22)

`raven-guard` reorganized tool gating into three modes: always-on guidance that catches permission-triggering command patterns, away-mode blocking for unattended runs, and off. The key insight was *guidance over blocking* in the default mode — teaching the agent to avoid problematic patterns rather than just refusing them. A sidebar toggle and API endpoint exposed the modes.

## The Overnight Pipeline (Mar 22–30)

Away mode plus the scheduler enabled a qualitative shift: unattended overnight automation. Local-only operation couldn't do web research, so the work split in two. A cloud-hosted Claude Code session (scheduled hourly) handles tasks needing web access — one task per run, committed incrementally to a shared branch. The local agent brackets the cloud run: a night-push commits safe work and pre-fetches JavaScript-rendered pages, a night-pull reviews the branch and merges to main as a quality gate.

The git repo became the coordination bus between agents — no direct agent-to-agent channel, just files in a repo. The cloud agent's undocumented time limit forced an incremental-commit habit and a continuation pattern (merge partial results, push, re-trigger with "continue from where you left off") that delivered a multi-run literature review across sequential cloud sessions.

## Threads as First-Class State (late Apr)

The reflect/continue pair had been stashing per-session working state to `in_progress/<label>.md`. In late April that crystallized into a named concept — a *thread*, the unit of work between a single task and a whole project — with its own skill (`raven-threads`) and web UI panel. The important wrinkle: sessions touching a thread are recorded in **per-machine sidecar files** (`in_progress/machines/<clone>/<label>.md`), so several machines cloning the same repo each log their own session history without git conflicts. Machine identity resolves through a hostname→friendly-name map.

## The Reading Principle (May 7)

The project's principle set had covered debugging, error handling, simplicity, critical reasoning, intellectual honesty, and synthesis. A seventh was added: **Read fully — directly or by proxy. Log the read.** It names the failure mode of routing source material through a summarizer and reasoning about the gist, and prescribes the careful-reader subagent as the cost-mitigation that preserves the read instead of discarding it. A per-conversation reading log (with provenance and verbatim excerpts) makes "I read it" auditable.

## Audio (May)

A text-to-speech pipeline turned documents into listenable audio: markdown → strip → chunk → TTS → a content-hashed cache → published audio files, surfaced in the web UI's reader panel. The headline lesson is a thesis the project still holds with appropriate humility — the *rewrite* step (turning prose into spoken form) matters more than the engine, and the hand-rewrite-vs-LLM-rewrite link is the part not yet validated.

## Cross-Project Knowledge (May 14)

The wiki had lived inside the Raven repo. An `rwiki` CLI made it readable and writable from *any* project's working directory, via a discovery sentinel and narrowly-scoped file allows, with an audit-side scanner enforcing the routing discipline. Knowledge stopped being trapped in one repo — a session in any tracked project can reach the shared store without switching context.

## Multi-Session Safety: The Commit-Lock (May 28)

Running more than one Claude Code session in a single shared clone exposed a real hazard: they share one working tree, index, and HEAD, so concurrent `git add` cross-contaminates the stage and a `git commit --amend` can rewrite the wrong commit. `raven-gitlock` added an advisory commit-lock — a session claims the stage→commit sequence; the guard hook blocks index/HEAD-mutating git unless the caller holds the lock; reads and `push` are never gated; the lock fails open so it can never brick the repo.

## The Desktop Shell (late May)

A small Wails app (Go + system WebView) wrapped the browser workspace as a native, multi-instance launcher: it spawns and stops *local* web-ui instances itself, connects to *remote* ones over a VPN, and embeds each in its own iframe so switching between Ravens preserves live session and terminal state. Several Windows GUI/environment gotchas (PATH for spawned processes, iframe clipboard delegation, an environment-variable leak that confused a config-walking tool) were worked out here.

## Going Cross-Platform (early Jun)

What started Windows-only grew a second home on macOS. The skill-sync mechanism already handled symlinks alongside junctions; the June work filled in the smaller seams where portability actually breaks — BSD vs GNU `sed -i` flags, OS-conditional UI labels (Finder vs Explorer), and the multi-machine identity map that keeps per-clone state files from colliding.

## The Fleet Grows a Server (mid-Jun)

The mixed-OS fleet gained an always-on Linux node. The web UI became a user-level system service there, and an important security posture got nailed down: bind only to loopback and the machine's *own* auto-detected VPN address, never the public interface, so a shared instance is reachable across the fleet without being exposed to the internet. An earlier version had hardcoded one machine's VPN IP as a fleet-wide default — a small mistake that became a principle: machine-specific values must be auto-detected per host, never baked in as defaults. The fleet still coordinates purely through git push/pull; there is deliberately no machine-to-machine RPC.

## The Considerations Cockpit (Jun 26)

The overnight pipeline had been quietly creating a problem of its own. The nightly rumination pass files suggestions — drift fixes, citation checks, cleanups — at 3–4 a night, and they had accumulated until roughly 78% of the task list was agent-filed noise burying the dozen items the human actually owned. The fix was a two-part design, stress-tested by a multi-persona review panel before building: **separate the pile** (agent-filed items become *considerations*, computed as a distinct set and excluded from the human's triage count) and **route each by category to a handler** that does the actual work — a safe in-place edit, an adversarial citation verification, or "surface this to a person."

The load-bearing correction came during the build. The first cut said "verification is dangerous, always route it to a human." Proven wrong by running it: an adversarial verification handler resolved most flagged citations autonomously (confirming real papers, fixing one truncated title) and surfaced only the genuinely unsourced one — catching a confabulation. The real line isn't "don't act on uncertain categories," it's *do the verb with inspectable evidence, surface on doubt*. The review panel forced a second correction too: pending human decisions don't get buried behind a tab — a hidden decision is still a to-do you're lying to yourself about — so they sit as a callout in the primary view. The Tasks panel became a **Project Focus** cockpit: committed tasks, the considerations pile, and a review surface where every autonomous edit shows up with a one-command revert.

## Task Discussions (Jun 26)

The same day, a sibling feature addressed the *other* end of the backlog problem: items that rot because their context is forgotten, not because they're hard. A per-item "Discuss" button spawns a fresh agent session, primed to reconstruct — before the human types — when and why the item was filed, what it points at, and whether its premise still holds. It opens with a reorientation rather than a question, stays scoped to the one item, and lands on a concrete disposition. The session runs in a terminal-backed modal that can be *elevated* into a full terminal tab without losing state when a quick chat turns into real work — a clean move only because the modal was a real terminal all along, and the client event bus already fanned out to multiple subscribers.

## Current State (Jun 26, 2026)

Not quite five months from first commit. The system now has:

- **Around two dozen skills** — status, reflection, continuity, threads, task and inbox management, claim/reference verification, security auditing, sandboxed work, paper reading, memory consolidation, knowledge wiki access, audio narration, knowledge-echo generation, tool guardrails, away mode, commit-locking, considerations-convergence, task discussions, and skill development itself.
- **A panel-based web UI** spanning terminal, a Project Focus cockpit (tasks, considerations, review), overview, sessions, status, memory, wiki, reader, and settings — usable from desktop, mobile, and a native desktop shell.
- **A considerations-and-handlers loop** that keeps the agent's own filed suggestions from drowning the human backlog — routing each to a handler that does the verb with inspectable evidence, or surfaces on doubt.
- **A notification and scheduling system** plus a persistent coordinator session for proactive, scheduled agent behavior.
- **An overnight local-cloud pipeline** for unattended research, memory maintenance, and security auditing.
- **A wiki knowledge base** reachable from every tracked project, with nightly librarian-style consolidation and reflective daily narratives.
- **A mixed-OS fleet** — Windows and macOS clones plus an always-on Linux node running the web UI as a VPN-only service, coordinating purely through git.
- **Research papers** on agent memory and on assessment design, both spun out of the day-to-day work.
- **This echo repo**, regenerated periodically from the private codebase.

Active fronts include incremental memory-architecture work, draining and converging the considerations pile, the assessment and memory papers, and continued refinement of the overnight pipeline.
