# Overnight Pipeline

## Problem

A personal AI assistant can do useful work while the user sleeps — researching URLs, checking literature, writing reports, maintaining memory. But unattended operation introduces constraints: the local agent can't browse the web (the guard blocks it), can't ask for permission, and must fail gracefully. Meanwhile, some tasks genuinely need web access.

A further problem: heavy research tasks don't fit a single agent run. A literature review or positioning analysis might take hours of work, but each cloud execution window is ~15 minutes. The system needs to decompose, coordinate, and review multi-run work without human intervention.

## Approach

Split work between a local agent (constrained, always running) and a cloud agent (has web access, runs hourly, one task per run). The git repository is the coordination bus — no direct communication between agents. They share state through files.

### The split

**Local agent** (Munin, persistent session): runs scheduled jobs via server-side cron. Handles pre-fetching JS-heavy URLs via headless browser, memory consolidation, security audit, pulling and reviewing cloud results, and preparing morning briefings. Constrained by the guard system to safe operations only.

**Cloud agent** (hourly scheduled task via Anthropic's web UI): reads a prompt file, picks one task, executes it, commits results. Uses Claude Opus with a 1M context window. Has web search and fetch but no browser.

### Shared branch as coordination substrate

All cloud runs work on a single shared branch (`claude/cloud_research`), not main. This is critical — it prevents:

- Unreviewed mutations to main
- Branch-per-run proliferation that breaks coordination between runs
- Merge conflicts from parallel work

Main stays protected. A nightly local job (night-pull) reviews the shared branch and merges to main — acting as a quality gate.

### Decision tree per run

Each cloud run does exactly one thing (pick first that applies):

1. **Execute** — a task or sub-task fits within ~15 minutes → do it
2. **Review** — a plan's sub-tasks are all complete → review whether the parent goal is met
3. **Decompose** — a heavy task has no plan yet → break it into sub-tasks
4. **Exit** — nothing to do → exit silently

Never combine. One action per run. This keeps runs predictable and failures contained.

## Implementation

### Task tagging

Tasks tagged `#auto` are eligible for autonomous processing:

```markdown
- [ ] Read https://example.com/interesting-paper #auto
- [ ] Research current state of X topic #auto
```

Bare URLs posted to the agent with no instruction are automatically added as `#auto` tasks.

### Plan decomposition for heavy tasks

When a task is too large for one run, a dedicated run decomposes it into a plan file:

```markdown
# Plan: Research Positioning

Parent task: Research and write positioning brief

## Sub-tasks
- [x] Literature inventory — collect recent papers
- [x] Check academic registry for related work
- [ ] Analyze methodology gaps
- [ ] Draft positioning summary
```

The parent task in `tasks.md` gets a `#plan:<slug>` tag pointing to the plan file. Sub-tasks are first-class candidates alongside top-level tasks — the cloud agent picks from both pools.

Sub-tasks must be self-contained, individually executable, and have quality criteria (not quantity caps). "Until the gap analysis is complete" rather than "write 500 words."

### Lock files for coordination

Each run claims a task by writing a lock file (`incoming/locks/<slug>.lock`) and committing it before starting work. This prevents two runs from picking the same task. The lock is removed atomically in the finalization commit.

Stale locks (older than 1 hour) are auto-retried — the next run detects them, reads the previous run's `wip:` commits to determine what's already collected, and continues from there rather than starting over.

### Skeleton-first commits

Before any research or fetching, the cloud agent writes a stub report with section headers and TBD markers, commits it (`wip: <slug> — skeleton`), and pushes immediately. Then it works through collection, synthesis, and deepening with incremental commits.

This means any timeout leaves visible progress. If a run dies during deepening, raw data is already committed. A retry run skips collection and goes straight to synthesis.

### Review pass

When all sub-tasks in a plan are checked but the parent task is still open, a subsequent run (never the one that finished the last sub-task) reviews the plan:

- Reads the plan file and each sub-task report
- Judges: does the combined output meet the parent's intent?
- **Met** → marks parent done, logs verdict in the plan file
- **Needs more work** → adds new sub-tasks, logs verdict

A loop guard closes the parent after 2+ "needs more work" verdicts with a "human review suggested" note, preventing infinite loops.

### Night-pull as review gate

The local 05:00 job reviews the shared branch before merging to main:

- Examines commits since last merge
- Checks new files in `incoming/`, plan quality, review verdicts
- Notes stuck locks (doesn't delete them — the cloud agent's auto-retry handles recovery)
- Writes a summary for the morning briefing
- Merges to main if clean; aborts and surfaces issues if not

### JS-heavy URL pre-fetching

The cloud agent has `WebFetch` but no browser — JavaScript-rendered pages come back empty. The local night-push job scans `#auto` tasks for known JS-heavy URL patterns, fetches them via headless Chrome, and saves rendered text to `incoming/prefetch-*.md`. The cloud agent checks for pre-fetched content before fetching. As a fallback, it can use a Jina Reader proxy (`https://r.jina.ai/<url>`) which renders JavaScript server-side.

### Pipeline schedule

| Time  | Agent | What |
|-------|-------|------|
| 00-03 | Local | Auto-away: guard mode set if idle >40min |
| 02:30 | Local | Pre-fetch JS URLs, commit+push |
| Hourly :07 | Cloud | One task from the decision tree |
| 04:00 | Local | Memory consolidation + knowledge base update |
| 05:00 | Local | Night-pull: review cloud branch, merge to main |
| 05:30 | Local | Security audit |
| 06:28 | Local | Morning briefing → notification |

## Gotchas

- **One task per run is intentional.** Earlier designs tried to batch multiple tasks. This made timeout management fragile and failures harder to diagnose. One task per run with incremental commits is slower but dramatically more reliable.
- **The shared branch accumulates.** Without periodic cleanup, the branch history grows with every run. Night-pull merges reset the divergence, but `incoming/` files accumulate. The consolidation step processes and archives them.
- **Stale lock auto-retry is load-bearing.** Without it, a single timed-out run blocks a task permanently. The 1-hour threshold balances between "give slow runs time to finish" and "don't wait forever."
- **Review pass judgment is imperfect.** The cloud agent reviewing its own collective output can miss quality issues that a human would catch. The night-pull gate and morning briefing surface review verdicts for human inspection.
- **Daylight saving.** Jobs scheduled during the clock-change hour (02:00-03:00) may be skipped. Night-push at 02:30 was missed during a spring-forward transition. Schedule critical jobs outside this window.
- **Rate limits.** Cloud scheduled tasks share rate limits with all other usage on the account. Heavy daytime usage can delay overnight runs.
