<!-- Copied from the private Raven repository 2026-07-04. One machine-local path
     replaced with the placeholder `<raven-repo>`; otherwise verbatim. -->

# Raven Vision

## Primary Goals

### 1. Always On, Always Accessible
Raven should be reachable from anywhere — desktop, phone, tablet — without setup friction. A persistent agent that survives disconnects and is ready when you are.

The web UI is the access layer — a panel-based workspace that hosts terminals, agent interactions, and status surfaces. Mobile-optimized, no native apps needed. One interface, responsive to context. The UI is infrastructure, not intelligence: a window manager for agents and tools.

### 2. Self-Improving
Raven should get better at its job over time, with minimal manual curation. Skills accumulate lessons in reference files. Patterns that work get recorded. Patterns that don't get flagged. The agent participates in its own development.

Near-term this means skills with self-updating references/ files. Longer-term it means exploring richer forms of memory — episodic (what happened), semantic (what's known), procedural (how to do things) — and how to persist, retrieve, and prune them effectively.

### 3. Self-Extending
Raven should be able to build new capabilities for itself. The `raven-dev` skill is the bootstrap: a skill that creates skills. When a new need arises, the response is "let's build a skill for that" — not "let me research a tool."

Inspired by OpenClaw/Pi's philosophy: minimal core + self-extension. Claude Code is the core. Skills are the extensions. The agent proposes and builds them.

### 4. Automated and Proactive
Raven shouldn't only respond — it should act on schedules and triggers. Check things periodically. Surface information before being asked. Send notifications when something needs attention.

Near-term: background tasks as pseudo-timers within running sessions. Mid-term: integration with Home Assistant for notifications, presence awareness, and IoT context. Long-term: scheduled `claude -p` invocations for autonomous check-ins.

## Strategy

**Extend Claude Code, don't replace it.** CC is actively developed by a team. Every improvement to models, tools, and context management comes for free. Raven adds personality, domain skills, and persistent access on top.

- **Skills with CLI tools** are the primary extension mechanism
- **Web terminal** provides the always-on access layer
- **Memory files** (CLAUDE.md, project memory, skill references) provide continuity
- **No custom agent harness** unless CC becomes fundamentally limiting
- **Agent SDK** remains an option for a future custom interface

## Architecture

```
Claude Code (the engine)
  + Skills (`<raven-repo>\skills\`, synced via junctions)
  + Memory (CLAUDE.md, ~/.claude/projects/*/memory/)
  + Web UI (panel-based workspace — terminals, agent surfaces, status)
  + Home Assistant (notifications, presence — future)
```

## Near-Term

- Build skills for concrete workflows (research, writing, project management)
- Iterate on the `raven-dev` meta-skill based on real usage
- Explore CC's built-in documentation/memory features and extend where needed

## Mid-Term

- Home Assistant integration (notifications, triggers, presence context)
- Richer memory patterns (pre-compaction saves, cross-session knowledge)
- Web UI agent panels (persistent CC sessions per context)
- Background task scheduling within sessions

## Long-Term

- Evaluate whether CC's TUI is sufficient or Agent SDK is needed
- Plugin packaging if marketplace supports live editing
- Multi-context session routing (work vs personal vs project-specific)
- Visual workspace / live canvas for interactive exploration

## Inspirations

- **OpenClaw**: Gateway architecture, cron automation, self-extension philosophy, session routing, live canvas
- **Claude Code**: The engine itself — skills, hooks, memory, subagents
- **Pi (minimal agent)**: Four tools + "ask the agent to extend itself"

---

*Established: 2026-02-06*
