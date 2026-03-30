# Scheduler

## Problem

Some agent tasks should happen on a schedule — daily memory maintenance, morning briefings, periodic security audits, overnight research pipelines. Running separate cron jobs or systemd timers outside the agent's environment means maintaining another layer of infrastructure. What's needed is a way to trigger agent actions on a schedule using the same agent sessions that handle interactive work.

## Approach

The web UI server runs a cron scheduler (node-cron) that injects prompts directly into named terminal PTYs. Jobs are defined as data in a JSON config file — not code. When a job fires, the scheduler finds the target terminal by name prefix and writes the prompt string to the PTY as if a user had typed it.

This reuses the existing terminal infrastructure. No separate daemon, no new communication channel. The agent receives the prompt through its normal input path and handles it like any other request.

Two job types are supported: **prompt injection** (write a string to a terminal) and **server actions** (call a named function in the server process, e.g. auto-away detection). Both are configured in the same jobs file.

## Implementation

### Job configuration

Jobs live in a JSON file watched by the server:

```json
[
  {
    "id": "auto-away",
    "cron": "0 0,1,2,3 * * *",
    "action": "auto-away",
    "idleMin": 40,
    "enabled": true
  },
  {
    "id": "night-push",
    "cron": "30 2 * * *",
    "terminal": "Munin",
    "prompt": "Read and follow the instructions in prompts/night-push.md",
    "enabled": true
  },
  {
    "id": "morning-briefing",
    "cron": "28 6 * * *",
    "terminal": "Munin",
    "prompt": "Read and follow the instructions in prompts/morning-briefing.md",
    "enabled": true
  }
]
```

Each prompt job specifies a cron expression, a target terminal name (matched by prefix), and a prompt string. The prompt can be anything — a slash command, a reference to an instruction file, a natural language request. Complex prompts are externalized to markdown files for readability and version control.

Action jobs specify a named function instead of a terminal. Server-side actions run in Node.js (e.g. checking idle time and toggling guard mode).

### Terminal injection

When a prompt job fires:

1. Find a terminal whose name starts with the target string
2. Write the prompt to the PTY with a carriage return

```javascript
const entry = [...terminals.getEntries()].find(
  ([, e]) => e.name.startsWith(target)
);
if (!entry) return;  // terminal not found, skip
terminals.write(id, job.prompt + '\r');
```

The prompt is written unconditionally if the terminal exists. An earlier version gated on whether the agent was detected as "running" (`claudeRunning` flag), but this caused nightly jobs to silently skip when the agent was idle at its input prompt — technically not "running" from the detection system's perspective. The gate was removed: writing to a terminal where the agent is idle at its prompt is the correct behavior (the prompt becomes the agent's next input). Writing to a terminal with only a shell is unlikely in practice since the persistent agent session is always active.

### Hot reload

The server watches the jobs file with `fs.watch`. On change, it stops all existing cron tasks and reloads from disk. A 200ms debounce handles editors that write in multiple steps.

This means editing the schedule doesn't require a server restart. Add a job, save the file, and it's registered within a second.

### Nightly pipeline

The scheduler anchors a multi-stage overnight pipeline:

| Time  | Job | What |
|-------|-----|------|
| 00-03 | auto-away (action) | Set away mode if user idle >40min |
| 02:30 | night-push (prompt) | Pre-fetch JS-heavy URLs, commit+push safe work |
| 03:00 | *cloud agent* | Remote trigger processes research tasks with web access |
| 04:00 | consolidate (prompt) | Memory health check and compaction |
| 05:00 | night-pull (prompt) | Pull cloud results, summarize new work |
| 05:30 | security-audit (prompt) | Permission security audit |
| 06:28 | morning-briefing (prompt) | Compose daily task briefing, send as modal notification |

The cloud agent (03:00) is external — a separate Anthropic-hosted trigger that clones the repo, processes `#auto` tagged tasks, and pushes results. The local jobs bracket it: night-push prepares work for the cloud, night-pull retrieves results.

## Gotchas

- **Name prefix matching.** The terminal is found by name prefix, not exact match. A job targeting "Munin" matches "Munin (raven-ui)" but also "Munin2" if it exists. Keep terminal names distinct.
- **Prompt length.** The full prompt is written to the PTY as a single string. Very long prompts work but are harder to debug in terminal scrollback. Externalize complex instructions to prompt files.
- **Timezone.** node-cron uses the server's system timezone. Daylight saving transitions can skip or double-fire jobs — avoid scheduling critical jobs during the transition hour (e.g. 02:00-03:00 in spring).
- **No failure notification.** If the agent can't complete a scheduled task, the scheduler doesn't know. The morning briefing downstream catches most issues by reviewing what happened overnight.
- **Server must be running.** Jobs only fire while the web UI server is up. Travel or connectivity issues mean missed jobs — but tasks carry forward to the next run.
