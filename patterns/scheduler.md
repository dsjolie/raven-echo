# Scheduler

## Problem

Some agent tasks should happen on a schedule — daily memory maintenance, morning briefings, periodic checks. Running separate cron jobs or systemd timers outside the agent's environment means maintaining another layer of infrastructure. What's needed is a way to trigger agent actions on a schedule using the same agent sessions that handle interactive work.

## Approach

The web UI server runs a cron scheduler (node-cron) that injects prompts directly into named terminal PTYs. Jobs are defined as data in a JSON config file — not code. When a job fires, the scheduler finds the target terminal by name prefix, verifies that an agent is running in it, and writes the prompt string to the PTY as if a user had typed it.

This reuses the existing terminal infrastructure. No separate daemon, no new communication channel. The agent receives the prompt through its normal input path and handles it like any other request.

## Implementation

### Job configuration

Jobs live in a JSON file watched by the server:

```json
[
  {
    "id": "memory-consolidate",
    "cron": "0 4 * * *",
    "terminal": "Munin",
    "prompt": "/raven-consolidate",
    "enabled": true
  },
  {
    "id": "morning-briefing",
    "cron": "28 6 * * *",
    "terminal": "Munin",
    "prompt": "Gather tasks and compose a morning briefing...",
    "enabled": true
  }
]
```

Each job specifies a cron expression, a target terminal name (matched by prefix), a prompt string, and an enabled flag. The prompt can be anything — a slash command, a natural language instruction, a multi-step request.

### Terminal injection

When a job fires:

1. Find a terminal whose name starts with the target string
2. Check that the agent is actually running (not at a shell prompt)
3. Write the prompt to the PTY with a carriage return

```javascript
const entry = [...terminals.getEntries()].find(
  ([, e]) => e.name.startsWith(target)
);
if (!entry) return;                    // terminal not found, skip
if (!entry[1].claudeRunning) return;   // agent not active, skip
terminals.write(id, job.prompt + '\r');
```

The "agent running" check is important — writing to a terminal where only a shell is active would execute the prompt as a shell command, which is both useless and potentially dangerous.

### Hot reload

The server watches the jobs file with `fs.watch`. On change, it stops all existing cron tasks and reloads from disk. A 200ms debounce handles editors that write in multiple steps.

This means editing the schedule doesn't require a server restart. Add a job, save the file, and it's registered within a second.

## Gotchas

- **Agent must be running.** If the target agent session has ended or is idle at a shell prompt, the job silently skips. This is by design — injecting into a shell would be wrong — but it means you need a persistent agent session for scheduled tasks.
- **Name prefix matching.** The terminal is found by name prefix, not exact match. A job targeting "Munin" matches "Munin (raven-ui)" but also "Munin2" if it exists. Keep terminal names distinct.
- **Prompt length.** The full prompt is written to the PTY as a single string. Very long prompts (multi-paragraph instructions) work but are harder to debug in terminal scrollback.
- **Timezone.** node-cron uses the server's system timezone. No per-job timezone override.
- **No failure notification.** If the agent can't complete the scheduled task (context full, error, etc.), the scheduler doesn't know. A more robust setup would have the agent report completion back, but at personal-tool scale the log output is sufficient.
