# Overnight Pipeline

## Problem

A personal AI assistant can do useful work while the user sleeps — research tasks, memory maintenance, security audits, briefing preparation. But unattended operation introduces constraints: the agent can't browse the web (guard blocks it), can't ask for permission, and must fail gracefully. Meanwhile, some tasks genuinely need web access (researching URLs, searching for papers).

## Approach

Split the work between a local agent (constrained, always running) and a cloud agent (has web access, runs on a schedule, limited execution time). The local scheduler coordinates handoff:

1. **Local agent pushes** — commits safe work (task files, reports) and pre-fetches JS-heavy URLs via headless browser, then pushes to the remote repo
2. **Cloud agent pulls** — clones the repo, works through `#auto` tagged tasks using web search and fetch, writes results, commits, pushes
3. **Local agent pulls** — retrieves cloud results, summarizes what's new

This turns the git repo into a coordination bus. No direct communication between agents — they share state through files in the repository.

### Cloud agent via RemoteTrigger

The cloud agent is an Anthropic-hosted Claude Code session triggered on a cron schedule. It clones the repo, reads a prompt file with instructions, works through tasks, and pushes results. The prompt file lives in the repo, so instructions are updatable without touching the trigger configuration.

```
Trigger prompt: "Read and follow the instructions in prompts/cloud-auto-tasks.md"
```

The instructions tell it to: find `#auto` tasks, research each one, write a report, mark the task done, and commit+push after each task (not batched — the cloud agent has an undocumented execution time limit, and incremental commits ensure partial progress is saved if it times out).

### JS-heavy URL pre-fetching

The cloud agent has `WebFetch` but no browser — JavaScript-rendered pages (Twitter/X, single-page apps) come back empty. The local night-push job handles this: before pushing, it scans `#auto` tasks for known JS-heavy URL patterns, fetches them via headless Chrome, and saves the rendered text to `incoming/prefetch-*.md`. The cloud agent checks for pre-fetched content before fetching.

As a fallback, the cloud agent can use a Jina Reader proxy (`https://r.jina.ai/<url>`) which renders JavaScript server-side and returns markdown.

### Continuation for large tasks

Cloud agent runs sometimes timeout mid-task. The pattern for recovery:

1. Merge partial results from the cloud branch into main
2. Push main with any partial results now on the trunk
3. Create a new one-shot trigger with continuation instructions ("themes 1-4 are complete, continue from theme 5")
4. Run the trigger manually

One-shot triggers: create with `enabled: false` and a far-future cron expression, then `run` manually. This avoids recurring scheduling for a one-time continuation.

## Implementation

### Task tagging

Tasks tagged `#auto` are eligible for autonomous processing:

```markdown
- [ ] Read https://example.com/interesting-paper #auto
- [ ] Research current state of X topic #auto
```

Bare URLs posted to the agent with no further instruction are automatically added as `#auto` tasks — a convention in the project's CLAUDE.md.

### Pipeline schedule

The full nightly sequence:

| Time  | Agent | What |
|-------|-------|------|
| 00-03 | Local (action) | Auto-away: set guard to away mode if idle >40min |
| 02:30 | Local (prompt) | Pre-fetch JS URLs, commit+push safe work |
| 03:00 | Cloud | Process `#auto` tasks with web access |
| 04:00 | Local (prompt) | Memory consolidation |
| 05:00 | Local (prompt) | Pull cloud results |
| 05:30 | Local (prompt) | Security audit |
| 06:28 | Local (prompt) | Morning briefing → modal notification |

### Prompt externalization

Complex prompts are stored as markdown files rather than inline in the job config. The job just says "read and follow X.md." This keeps the job config clean, makes prompts version-controlled and editable, and allows the cloud agent to read the same instruction format.

## Gotchas

- **Cloud timeout.** The cloud agent has an undocumented execution time limit. Always instruct it to commit after each completed task, not at the end. Partial results are vastly better than no results.
- **Daylight saving.** Jobs scheduled during the clock-change hour (typically 02:00-03:00) may be skipped. The night-push at 02:30 was skipped during a spring-forward transition. Schedule critical jobs outside this window, or accept that DST transitions cause a one-night gap.
- **Server must be running.** All local jobs depend on the web UI server and the persistent agent session being active. Travel or power loss means missed runs — tasks carry forward.
- **Git conflicts.** The cloud agent works on main (or its own branch). If local changes conflict with cloud changes, the pull step may need manual resolution. In practice this is rare because the cloud agent only writes to `incoming/` and `tasks.md`.
- **Rate limits.** Cloud scheduled tasks share rate limits with all other Claude usage on the account. Heavy daytime usage could delay overnight runs.
