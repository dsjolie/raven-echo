# Detecting Whether an AI Agent Is Busy in a Terminal

## Problem

A web UI hosts multiple terminal tabs, each potentially running an AI coding agent. The UI
needs to show per-tab state: idle, running, or awaiting user permission. The agent is a
black-box process; there is no shared memory and no internal API to call.

## Solution

Combine two independent signals and reconcile them into one UI state variable per terminal.

### Signal 1 — lifecycle hook (authoritative, fragile)

The agent supports hook scripts that fire on lifecycle events. A small hook script reads the
event type from its argument, reads the terminal's assigned ID from an environment variable
set at PTY spawn time, and POSTs to the web UI server:

- `session-start` → mark terminal as running
- `stop` → log only (see gotcha below)
- `permission` → mark terminal as awaiting permission, extract tool type from the hook's
  stdin payload

The hook is precise — it fires within milliseconds of the event, and the permission payload
carries the exact tool name, enabling a more informative UI label. But it requires the server
to be up when the hook fires; a server restart while the agent is running leaves the new
server with no record of that agent.

### Signal 2 — PTY output regex (resilient, approximate)

The terminal manager keeps a 2000-character sliding window of recent stripped output. Two
pattern families:

**Permission detection** — the agent's permission prompt has a consistent visual structure:
a row of `╌` (U+254C, not a regular hyphen) at least 20 characters wide, plus a question
line matching known verb phrases:

```javascript
const PERMISSION_SEPARATOR_RE = /╌{20,}/;
const PERMISSION_QUESTION_RE = /Do you want to (?:make this edit|run|execute|write|read|create|allow)/i;
```

Both must be present in the sliding window before the terminal is marked permission-pending.
Requiring two patterns reduces false positives from incidental output that resembles one of
them.

**Stop detection** — when the agent exits, the shell regains the PTY and emits a prompt. The
terminal manager already parses shell prompts for CWD tracking (PowerShell `PS path>` and
bash OSC 7 escape sequences). Reusing that: if a shell prompt is detected while the terminal
is marked as running, the agent has exited and the terminal transitions to idle.

### Why the Stop hook cannot be the stop signal

The agent fires its `stop` hook at the end of every conversation turn, including turns that
are followed immediately by the next turn. Treating every `stop` event as "agent exited"
causes the UI to flash idle between turns. The only reliable exit signal is the shell prompt
reappearing — that only happens when the agent process has fully exited and the parent shell
has taken back the PTY.

### UI state reconciliation

The server holds a small record per terminal: `claudeRunning`, `permissionPending`,
`permissionType`. Hook events and PTY pattern matches both write into this record; the server
broadcasts the updated state to all connected browser clients over WebSocket. The browser
keeps a parallel copy in a `Map` keyed on terminal ID. All UI updates (tab label suffix,
mobile key row visibility, CSS highlight class) read from that in-memory copy.

Tab label encoding: `(CC)` when running, `(CC! Edit)` when awaiting an edit permission,
`(CC?)` for interactive-choice prompts. Permission-pending tabs also gain a CSS class for a
visual highlight.

Permission state clears on user input (the user responded to the prompt), not on output —
the agent's response to the user's decision does not have a reliably distinctive pattern.

## Why it generalizes

To track whether any interactive external process is busy:

1. If the process offers a lifecycle hook or event callback, register it — it is the
   authoritative source when it fires.
2. Watch the output stream for distinctive markers (preferably multi-criterion AND logic to
   reduce false positives). Strip formatting characters before matching.
3. For "process exited," watch for the host shell's prompt reappearing rather than trusting
   the process's own exit signal, which may fire on non-final events.
4. Keep state server-side and broadcast deltas; browser clients are views, not state owners.

## Gotchas

**ANSI stripping is mandatory.** PTY output contains color codes, cursor movements, and
terminal title sequences. Without stripping, character-by-character regex patterns fail
because the literal characters are interleaved with escape sequences.

**Sliding window, not per-chunk.** PTY output is chunked unpredictably. The separator and
the question line can arrive in different chunks. Match against a concatenated window, not
individual chunks.

**The stop hook fires per turn.** Do not act on it for UI state. Log it for diagnostics, but
wait for the shell prompt to confirm the agent is really gone.

**Type mismatch at the DOM boundary.** Terminal IDs are server-side integers but become
strings in DOM `dataset` attributes. Comparing them with strict equality silently fails.
Normalize to one type at the layer where they cross the boundary.
