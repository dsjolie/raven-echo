# Detecting When an AI Agent is Running in a Terminal

## Problem

A web UI hosts multiple terminal tabs, each potentially running an AI coding agent (Claude Code). The UI needs to show whether the agent is active, idle, or waiting for user permission — without access to the agent's internal state.

## Approach

Two complementary detection methods, because neither alone is reliable:

### 1. Hook-based detection (primary)

The agent fires hooks on lifecycle events. A lightweight notification hook sends the event to the web UI server:

- **SessionStart** → agent is running
- **Stop** → agent has stopped
- **PermissionRequest** → agent is waiting for user approval

This is fast and accurate when it works. The hooks fire within milliseconds of the event.

### 2. PTY output pattern matching (fallback)

The hook mechanism can miss events (server restart, hook failure, agent crash). As a fallback, the terminal manager scans PTY output for known patterns:

```javascript
// Permission prompts use a distinctive Unicode separator
const PERMISSION_SEPARATOR_RE = /╌{20,}/;
const PERMISSION_QUESTION_RE = /Do you want to (?:make this edit|run|execute|write|read|create|allow)/i;
```

The terminal manager maintains a sliding window of recent output and applies these patterns. When a permission separator followed by a permission question is detected, the terminal is marked as "permission pending."

### Detecting agent stop

The trickiest part. The agent's "Stop" hook fires on every conversation turn, not just final exit. The real signal for "agent is done" is: the shell prompt reappears while `claudeRunning` is true. This means the agent exited and the shell regained control.

The terminal manager detects common shell prompts (PowerShell `PS path>`, bash prompts via OSC 7) in PTY output. When a prompt appears and the terminal was marked as agent-running, the state transitions to idle.

## Why Two Methods

- Hooks are authoritative but fragile — they require the notification server to be running and the hook to be configured. If the web UI server restarts while the agent is running, the new server doesn't know an agent is active.
- PTY scanning is resilient but approximate — it can be fooled by output that looks like a prompt, and it requires pattern maintenance as the agent's output format evolves.

The combination covers most scenarios: hooks for normal operation, PTY scanning for recovery after disconnects.

## Gotchas

- **ANSI stripping.** PTY output is full of escape sequences (colors, cursor movement, terminal titles). Strip them before pattern matching, or the regexes won't match.

- **Terminal IDs are type-sensitive.** Server-side terminal IDs are numbers, but DOM `dataset` values are strings. Comparing them with `===` fails silently. Normalize types at the boundary.

- **The Stop hook fires per turn.** Don't treat every Stop event as "agent exited." It just means the current conversation turn ended. The agent may continue with the next turn.
