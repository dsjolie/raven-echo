# Overnight Pipeline

## Problem

An agent that can act unattended overnight is genuinely useful — researching URLs queued during the day, maintaining memory, writing reports nobody had time to read. But unattended operation concentrates risk: web access enables untrusted content injection, and an agent that can both fetch from the web and write to local state is one errant response away from exfiltration or corruption. The obvious answer — "just block web access at night" — trades safety for uselessness. A subtler constraint: even cloud-hosted agents with web access can't sustain multi-hour research. Any given run fits in roughly 15 minutes. Long work has to span multiple runs without losing coherence between them.

The challenge is not just scheduling. It's figuring out which agent should do what, how they coordinate without talking directly, and how quality gates work when there's no human present.

## Approach

Split the overnight workload across two agents differentiated by capability and trust level:

**The local agent** has a persistent session, runs scheduler-triggered jobs, and is constrained by a hook-enforced guard that blocks web access and destructive operations during unattended hours. It handles everything that doesn't require the open internet: committing queued work, pre-fetching known JS-heavy URLs using a local headless browser before the cloud agent needs them, consolidating memory, reviewing cloud results for safety, and assembling the morning briefing.

**The cloud agent** runs on a scheduled external trigger — hourly, at the same minute each hour. It has web search and fetch. It operates on a single shared branch rather than main, and each run does exactly one thing before exiting.

The critical architectural choice is that the git repository itself is the coordination bus. The two agents never communicate directly. They share state through files: lock files claiming tasks, report files depositing results, plan files decomposing heavy work across runs. Git commits are the synchronization primitive. An agent that never touches main cannot corrupt the live system; main updates flow only through a local review job.

### The danger framing

Web access is the dangerous capability. An agent that can fetch arbitrary URLs, execute tools against a local filesystem, and push to a shared branch satisfies two of the three preconditions for what security researchers call the "lethal trifecta" (untrusted content + tool execution + exfiltration path). Containing this means isolating the capable agent from the main branch and routing its output through a local quality gate before it reaches anything consequential. The cloud agent's writes go to a branch the local agent inspects before merging.

### Decision tree per run

Each cloud run reduces to a single decision:

1. **Execute** — an unlocked task fits within a single run → do it
2. **Review** — a plan's sub-tasks are all marked complete but the parent task is still open → assess whether the goal was actually met
3. **Decompose** — a task is too heavy for one run and has no plan yet → break it into bounded sub-tasks
4. **Exit** — nothing qualifies → exit silently

One action per run, in that priority order. The constraint is not accidental: batching tasks per run makes timeout management fragile and turns failures into multi-task rollbacks. Single-task runs mean a failure scope is always one task, and incremental commits mean a partial run leaves visible progress.

## Implementation

### Job schedule

`web-ui/data/jobs.json` defines all scheduled local jobs as cron entries. Each job is either a server-side action (auto-away, which needs no agent) or a prompt injected into the persistent local agent session. The cloud job is a separately scheduled external trigger — not in this file.

| Time | Agent | Job |
|------|-------|-----|
| 00:00–03:00 | Local (server) | Auto-away: switch to guarded mode if idle >40 min |
| 02:30 | Local | Night-push: pre-fetch JS-heavy URLs, commit and push to main |
| Hourly :07 | Cloud | Cloud research run: decision tree, one task |
| 04:00 | Local | Memory consolidation |
| 05:00 | Local | Night-pull: review cloud branch, merge to main |
| 05:30 | Local | Security audit |
| 06:28 | Local | Morning briefing |

### Task eligibility

Tasks tagged `#auto` are eligible for cloud research runs. They must be bounded — a specific URL to read, a narrow question with a defined deliverable. The cloud research prompt explicitly skips tasks with language like "exhaustive", "comprehensive", "survey", or "go wide", tasks listing five or more external sources, and tasks whose deliverable is unbounded. These filters exist because an unbounded task in a 15-minute window produces either a timeout or a low-quality stub that isn't labeled as one.

```markdown
- [ ] Read https://example.com/interesting-paper #auto
- [ ] Check current state of X — narrow, 200 words max #auto
```

### Lock files as coordination

When a cloud run selects a task, it writes a lock file to `incoming/locks/<slug>.lock` and commits it before touching anything else. Any subsequent run in the same hour sees the lock and skips that task. The lock is removed in the same atomic commit that finalizes the result and marks the task done. A run that times out or crashes leaves its lock in place — this is intentional. It makes failures visible rather than silently releasing the task for a retry that starts from scratch. Locks older than one hour are eligible for retry: a new run reads any `wip:` commits the stalled run left behind, determines what was already collected, and continues from that point rather than restarting.

### The shared branch as trust boundary

All cloud runs push to a single shared branch (e.g., `claude/cloud_research`), never to main. Every run starts by merging `origin/main` into the shared branch — this keeps cloud work current with local commits and prevents drift. The local agent's guard permits `git merge origin/claude/*` in away mode specifically to support the night-pull job; it blocks all destructive git operations.

Main only receives cloud work through the night-pull job, which:
- Reads the diff of commits accumulated since the last merge
- Checks for suspicious content, stuck locks, and plan quality
- Merges to main with `--no-ff` if clean, otherwise writes issues to a notes file and aborts
- Passes its verdict to the morning briefing

Merge conflicts are not auto-resolved. They abort the merge and surface in the briefing — the cost of a missed night's merge is lower than the cost of a silent bad merge.

### Containment lanes, and moving them into the prompt

The gate's job turns out to be less "is this diff safe" and more "which of this run's claims are allowed to become durable." Two lanes emerged from running it for months:

- **Report-only content.** Anything the run sourced from the open web stays in its report and never lands in a knowledge article, no matter how well-argued. This was enforced by hand at the merge gate for six weeks before it was written into the prompt — and the six weeks were the evidence that it needed to be.
- **Measured-or-omitted values.** Any date, count, or version an agent states about a repository artefact must cite the command that produced it *in the same pass*, or be left out. See [patterns/instrument-trust.md](instrument-trust.md) for why the omission clause is the load-bearing half.

Both of these are **prompt-layer** constraints rather than hook-layer ones, and the distinction is architectural. A hook can block a dangerous command form unconditionally, everywhere. It cannot distinguish a measured date from a fabricated one, because stating a date is a legitimate action — so the constraint has to live where the action is *specified*, in the prompt that drives the run. The price is coverage: a prompt-layer rule protects only the runs consuming that prompt and leaves every other session unguarded against the same mistake.

The gate's cheapest and highest-yield move is one verification command per stated claim. Over eight instances of an agent inventing plausible "last edited" dates, the gate spending a single `git log` line per claim kept all but one out of the knowledge base.

### JS-heavy URL handling

The cloud agent has `WebFetch` but no browser, so JavaScript-rendered pages return empty. A two-tier strategy handles this. The night-push job at 02:30 scans `#auto` tasks for known JS-heavy URL patterns (social media, single-page apps) and fetches them via a locally running headless browser, saving the rendered text to `incoming/prefetch-<date>-<slug>.md` before the cloud runs begin. The cloud agent checks for pre-fetched content first. If nothing is pre-fetched, it falls back to a server-side rendering proxy (`https://r.jina.ai/<url>`), which returns Markdown without requiring browser infrastructure.

### Plan decomposition for heavy tasks

When a task can't be completed in one run and has no plan yet, one run's entire purpose is decomposition. It writes a plan file:

```markdown
# Plan: <parent task slug>

Parent task: <original task text>

## Sub-tasks
- [ ] Collect recent sources — stop at 8 items #auto
- [ ] Summarize methodology gaps — 300 words max #auto
- [ ] Draft positioning section #auto
```

Sub-tasks need quality criteria, not just quantity caps — "until the gaps are characterized" over "write N words". The parent task in the task list gets a reference to the plan file. Sub-tasks are drawn from the same `#auto` pool as top-level tasks; the cloud agent treats them equivalently when picking its next run's work.

When all sub-tasks are done, a subsequent run (not the one that finished the last sub-task) acts as reviewer: it reads the full set of sub-task outputs, assesses whether the combined result actually meets the parent's intent, and either marks the parent done or adds further sub-tasks. After two consecutive "needs more work" verdicts with no human intervention, the parent closes with a "human review suggested" note — this loop guard prevents infinite refinement cycles.

## Gotchas

- **Single-task-per-run is a feature, not a limitation.** The temptation is to batch tasks per run for efficiency. Resist it. The cost of batching shows up at timeout: a partial multi-task run leaves ambiguous state, rollback is multi-task, and failures blur together. One task per run means one failure surface.

- **The shared branch accumulates state.** `incoming/` files grow with every run. The consolidation job at 04:00 processes and archives them. If consolidation falls behind, the branch diff the night-pull reads becomes unwieldy.

- **Stale lock retry is load-bearing.** Without it, a single stalled run blocks a task permanently with no recovery path except human intervention. The auto-retry on locks older than one hour is the only automatic recovery mechanism in the system.

- **The night-pull gate is not infallible.** An agent reviewing content produced by another agent on the same model family will miss some failure modes. The gate's real value is catching *structural* problems (merge conflicts, stuck locks, suspicious volume of changes) rather than subtle *content* problems. Human inspection of the morning briefing closes that gap.

- **Schedule jobs away from clock-change windows.** Jobs timed to 02:00–03:00 are vulnerable to daylight saving transitions. The night-push job at 02:30 has been lost to a spring-forward transition. If a job must run in that window, duplicate it with a guard against running twice.

- **A prompt fix is in force when the consuming run's checkout contains it, not when you commit it.** The shared branch is supposed to merge main at the start of every run; on the night that mattered, it didn't, and a constraint committed twelve hours earlier was violated by a run that had never received it. Verify per-run with `git show <run-commit>:<prompt-path>` before concluding a rule is too weak — see [solutions/stale-prompt-delivery.md](../solutions/stale-prompt-delivery.md).

- **The pipeline's reports are instruments, and instruments can be dead.** A guardrail switched off for four days produced two consecutive nightly reports recording "zero guard bounces" as a property of the night. Have each run state which mode it executed under, so a clean result always arrives with evidence that the check was live.

- **Cloud runs share account rate limits.** Heavy daytime usage competes with overnight slots. The scheduled hourly trigger fires at :07, but actual execution can be delayed. Design tasks to be stateless across a run delay — the lock file prevents double-execution, not delay.
