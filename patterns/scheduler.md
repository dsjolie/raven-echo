# Scheduler

## Problem

Autonomous agent work needs time-based triggers — nightly maintenance, morning briefings, periodic security checks. The naive approach is external cron jobs or systemd timers that shell out to scripts. This works, but it creates a split system: infrastructure-level scheduling driving application-level agent sessions through a side channel. Every handoff between them is a seam where things break silently.

The deeper issue is that scheduled work isn't fundamentally different from interactive work. Both are prompts delivered to an agent. If the agent's interactive and scheduled paths share no infrastructure, you're maintaining two separate pipelines to do the same thing.

## Approach

The web UI server owns the scheduler. On startup it loads a JSON file of job definitions and uses `node-cron` to register each one. When a job fires, it locates a named PTY terminal and writes the prompt string directly to it — the same write path that handles interactive keyboard input. The agent receives a scheduled prompt through exactly the same channel it receives user input.

Two job types exist within the same config format. **Prompt jobs** identify a target terminal by name and inject a string into it. **Action jobs** call named functions registered inside the server process — for operations that belong to the server (like toggling security mode based on idle time) rather than to the agent.

The config file is data, not code. Adding, removing, or changing a schedule is a text editor operation. `fs.watch` makes changes take effect immediately without a server restart.

### The persistent coordinator terminal

The design depends on there being a live agent session to inject into. This is Munin: a terminal created automatically when the server starts, which runs the agent and resumes the most recent prior session. The resume target is read from a per-machine sidecar file — a small markdown file containing a list of past session UUIDs. The server picks the newest one by timestamp (not insertion order, since sidecar edits can arrive out of order) and passes it to the agent's `--resume` flag. If no sessions are recorded, the agent starts fresh.

Munin is the standing target for scheduled prompt injection. It's always present when the server is running, it carries accumulated context from previous sessions, and it's the first tab created — pinned to position in the UI. Scheduled jobs specify `"terminal": "Munin"` and can count on finding it.

## Implementation

### Job config format

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
    "prompt": "Read and follow the instructions in web-ui/prompts/morning-briefing.md",
    "enabled": true
  }
]
```

Each job has an `id`, a standard cron expression, and `enabled`. For prompt jobs: `terminal` (matched by name prefix) and `prompt` (the string injected). For action jobs: `action` (a key into the server's `serverActions` registry).

The prompt field accepts anything the agent understands: a slash command, a plain instruction, or a pointer to a prompt file stored in the repo. Externalizing complex instructions to prompt files keeps the config readable and makes the prompts independently version-controlled.

### Scheduler initialization

On server start, `loadJobs()` reads the file, stops any previously registered cron tasks, then iterates the job list:

```javascript
for (const job of jobs) {
  if (!job.enabled || !job.cron) continue;

  if (job.action) {
    const fn = serverActions[job.action];
    if (!fn) { console.error(...); continue; }
    const task = cron.schedule(job.cron, () => fn(job));
    _cronTasks.push(task);
  } else if (job.prompt) {
    const task = cron.schedule(job.cron, () => {
      const target = job.terminal || 'Munin';
      const entry = [...terminals.getEntries()].find(
        ([, e]) => e.name.startsWith(target)
      );
      if (!entry) return;
      const [id] = entry;
      terminals.write(id, job.prompt);
      setTimeout(() => terminals.write(id, '\r'), 100);
    });
    _cronTasks.push(task);
  }
}
```

The prompt and carriage return are written in two separate calls with a 100ms delay. Writing them together caused the agent's TUI to interpret `\r` as a cursor-column-reset rather than submit, silently dropping the prompt. Separating the writes fixes this — confirmed via a log of prompt-submit events showing joined writes concatenating across injection cycles.

### Server actions

The `serverActions` map holds named functions for jobs that should run in the server process rather than in the agent. The current example is `auto-away`: it reads the guard mode file, checks how long since the last user interaction, and writes `away` to the guard file if the idle threshold is exceeded. This wakes up security restrictions without needing the agent to be active.

This pattern generalizes: any server-level operation that doesn't require agent reasoning — file cleanup, status resets, external pings — can be registered here and fired by a cron expression using the same config format.

### Hot reload

```javascript
fs.watch(JOBS_FILE, { persistent: false }, (eventType) => {
  if (eventType === 'change') {
    setTimeout(loadJobs, 200);
  }
});
```

The 200ms debounce prevents double-loads from editors that write files in two stages (truncate then write). The reload stops all current tasks before re-registering, so there's no risk of duplicate job instances after a config change.

### Nightly pipeline

The scheduler anchors a multi-stage overnight pipeline. Local jobs bracket an external cloud agent that handles tasks requiring web access:

| Time  | Job | What happens |
|-------|-----|------|
| 00:00–03:00 | auto-away (action) | Set away mode if idle >40 min |
| 02:30 | night-push (prompt) | Pre-fetch JS-heavy pages, commit and push safe work |
| 03:00 | *external cloud agent* | Processes `#auto` tagged tasks with web access, pushes results |
| 04:00 | memory-consolidate (prompt) | Memory health check and compaction |
| 05:00 | night-pull (prompt) | Pull cloud results, summarize new arrivals |
| 05:30 | security-audit (prompt) | Permission audit |
| 06:28 | morning-briefing (prompt) | Compose daily task briefing, deliver as a modal notification |

Night-push prepares work for the cloud agent; night-pull retrieves it. The cloud agent is entirely external — a separate hosted trigger that clones the repo, runs, and pushes back. The local scheduler only needs to know when to prepare and when to collect.

## Gotchas

- **`\r` timing.** Write the prompt and the carriage return as two separate PTY writes with a short delay between them. A single concatenated write causes the terminal emulator to misinterpret `\r` as cursor movement instead of submit, silently dropping the prompt.

- **Name prefix matching.** Terminals are located by `name.startsWith(target)`. A job targeting `"Munin"` will match `"Munin (coordinator)"` but also `"Munin2"` if it exists. Keep terminal names unambiguous.

- **No execution guard.** The scheduler injects prompts unconditionally if the terminal exists. An earlier version skipped injection when the agent appeared "not running," but this caused jobs to silently miss when the agent was idle at its input prompt — the correct state to inject into. Removing the guard is the right behavior; the terminal being absent is the only legitimate skip condition.

- **No feedback channel.** The scheduler fires and forgets. If the agent fails to complete a job — due to an error, context issues, or an unavailable tool — the scheduler doesn't know. Downstream jobs (particularly the morning briefing) serve as indirect feedback by reviewing what actually ran overnight.

- **System timezone.** `node-cron` uses the Node.js process timezone, which follows the system clock. Daylight saving transitions can cause jobs to fire at the wrong wall-clock time or skip entirely. Avoid scheduling critical jobs in the transition window (typically 02:00–03:00).

- **Server must be running.** All jobs depend on the web UI server being live. Missed runs don't auto-recover — but most agent tasks are inherently idempotent (consolidation, briefing generation) so the next scheduled run picks up cleanly.
