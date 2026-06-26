# Task System

## Problem

When an agent coordinates work across many projects — each in its own directory, its own repo, its own lifecycle — task visibility fragments. What's overdue across all of them? What tasks are queued for overnight autonomous work? What came in yesterday that hasn't been routed yet?

A database is the obvious answer, but it buys complexity before it earns it: migrations, IDs, a query layer, and something the user can't simply open in a text editor to fix when something goes wrong. The alternative is to make the storage format so simple that it's greppable, diffable in git, and hand-editable in any editor — and then build one authoritative parser that every consumer calls.

## Approach

Plain markdown files hold the tasks. One Python CLI is the sole parser. Everything else — a web UI, a morning briefing script, an AI agent — calls that CLI with `--json` and consumes the output. No consumer reimplements deadline logic or tag parsing.

```
tasks/<shorthand>.md        one file per project
      ↓
rtasks.py --json            single parser, structured output
      ↓
tasks.js                    thin Node.js execFile wrapper
      ↓
web UI panels               browser, WebSocket broadcast
```

The storage is shallow enough that a builder can grep the task files directly when debugging, audit them in git history, or edit them with sed. The parsing layer exists so no one has to parse them manually at runtime.

### Task file format

Each project has one markdown file with this structure:

```markdown
# Project Name

## Tasks
ONGOING: Short description of continuous background work
- [ ] Open task with no deadline #next
- [ ] Task with deadline (Apr 15)
- [ ] Task eligible for agent work #auto (2026-06-20)
- [x] Completed task ✓
```

The format has four intentional properties:

1. **Checkbox lines are the only structured data.** Everything else — headers, prose sections, comments — is noise-tolerant. The parser skips non-checkbox lines.
2. **Deadlines are parenthesized at the end.** This makes them visually distinct and easy to strip when displaying task text. Accepted forms: ISO dates (`2026-04-15`), month + day (`Apr 15`), month + year (`March 2026`), and vague qualifiers (`Early March 2026` → day 10, `Late March 2026` → day 25).
3. **Tags are inline hashtags.** `#next` marks working-set tasks for today. `#auto` marks tasks eligible for autonomous overnight work. `#agent` marks a *consideration* — an item the agent filed, not work the human committed to — which is structurally separated from the committed task list (see Considerations below). Tags survive edits — the CLI preserves them when rewriting task lines.
4. **The `✓` on completed lines is additive, not structural.** The checkbox state `[x]` is the parse signal; the tick is decoration.

### Project registry

A central JSON file (`projects.json`) maps shorthand identifiers to project paths and metadata. The CLI reads this to resolve `rtasks list myproject` → the actual file on disk. The registry is gitignored on the primary machine and falls back to raven-only mode when absent — so cloud clones and CI can still call `rtasks` for the assistant project without the full local config.

### Two-location storage

Tasks live in one of two places:

1. **Project-local** — `tasks.md` in the project root. Keeps the task list alongside the code, versioned with the project.
2. **Central** — `tasks/<shorthand>.md` in the assistant's repo. For projects without a codebase: committee work, grant applications, external obligations.

Project-local takes precedence. If both exist, the CLI emits a conflict warning rather than silently picking one. The presence of both is always a user mistake to fix, not a state to auto-resolve.

### Inbox

`inbox.md` is a flat capture buffer — task ideas that aren't ready to route. Items can carry `@shorthand` tags as a routing hint. The workflow is capture-first, route-later: `rtasks inbox add "Thing I should do"`, then `rtasks inbox move 0 myproject` when you have context to assign it.

### Considerations

Once an agent runs unattended and files suggestions of its own, a second class of item appears: the **consideration** — an `#agent`-tagged line with no lane and no deadline. These are computed as a distinct set from the committed tasks and deliberately *excluded* from the "untriaged" count, so the agent's firehose never crowds the human's real backlog. Each consideration's category tag routes it to a handler that does the work, and a `promote` command strips `#agent` to graduate one into committed work. The mechanics — category→handler routing, the trust bar, the convergence model — are their own pattern: [considerations-and-handlers.md](considerations-and-handlers.md). The point here is only that the *same task file and the same parser* carry both human tasks and agent considerations; the split is a derived view, not a separate store.

## Implementation

### Deadline parsing and year inference

The deadline parser handles multiple formats because task writers don't want to stop and look up the ISO date. The interesting part is year defaulting: when a date is specified without a year (e.g., `Apr 15`), the parser defaults to the current year but bumps to next year if the resulting date is more than 90 days in the past. The threshold is 90 days, not "already passed", to account for deadlines entered slightly late.

```python
def smart_year(month_idx, day):
    today = date.today()
    candidate = date(today.year, month_idx + 1, day)
    if (today - candidate).days > 90:
        return today.year + 1
    return today.year
```

Vague month qualifiers map to mid-month anchor days: `Early` → 10th, `Late` → 25th, unqualified or `Mid` → 15th. These are approximate by design — they give the urgency calculator something to work with without pretending false precision.

### Urgency grouping

The overview groups all open tasks across all projects by urgency bucket, computed fresh on each read:

- **overdue** — deadline in the past
- **today** — due today
- **this-week** — 1–7 days out
- **next-week** — 8–14 days
- **upcoming** — 15+ days
- **no-deadline** — undated tasks, shown last

There is no stored urgency. Urgency is a function of (deadline, today). This means the urgency shown is always current, and there's nothing to keep in sync.

### Fuzzy matching for mutations

Write operations (done, edit, next, top) identify tasks by fuzzy substring match against the tag-stripped task text, case-insensitive. There are no task IDs. `rtasks done myproject "feature"` matches the first open task whose text contains "feature".

This is a deliberate tradeoff: it makes CLI use natural and fast (no copying IDs), but task descriptions within a project should be distinctive. The `done` command finds the first match and stops; the edit warning fires when the replacement text is suspiciously shorter than the original, as a guard against confusing substring substitution with full-body replacement.

### Single parser contract

The `--json` flag on any subcommand returns structured JSON to stdout. This is the integration contract for everything that isn't a human at a terminal:

```bash
rtasks --json               # full overview: all projects, all tasks, inbox
rtasks --json list myproj   # one project's task list with parsed deadlines
rtasks --json add myproj "text"
```

The Node.js wrapper (`web-ui/lib/tasks.js`) is ~130 lines: find the right Python binary (prefer the project venv, fall back to a known path, fall back to system), call `execFile` with `--json`, parse the result. The wrapper exports named functions (`getOverview`, `listProject`, `addTask`, etc.) that the web server calls. The wrapper doesn't interpret the output — it just passes it through. If parsing behavior needs to change, only `rtasks.py` changes.

```javascript
function rtasks(...args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [RTASKS_SCRIPT, '--json', ...args], {
      timeout: 15000,
      env: { ...process.env, PYTHONUTF8: '1' },
    }, (err, stdout, stderr) => {
      if (err) { reject(...); return; }
      resolve(JSON.parse(stdout));
    });
  });
}
```

The `PYTHONUTF8: '1'` environment variable is load-bearing on Windows: the default console encoding is cp1252, which can't represent the `✓` completion character. Setting it at invocation time avoids requiring callers to configure their environment.

### Orphan task files

Task files in `tasks/` that have no matching `projects.json` entry are "orphans." The CLI picks them up automatically by scanning the directory. Orphans use YAML frontmatter to supply the description that would otherwise come from the registry:

```markdown
---
description: Short project description
---
# Project Name

## Tasks
- [ ] Some task
```

This means a project can be fully tracked through its task file alone, with the registry entry added later when there's a path to resolve.

## Gotchas

- **Fuzzy match finds the first hit.** If two tasks share a word, `rtasks done myproj "submit"` marks the first one. Keep task descriptions distinct within a project, or be more specific in the match string.
- **Year inference surprises on historical tasks.** If you're recording a task that was genuinely due three months ago (for tracking completed work), the year bumps to next year. Use explicit ISO dates for historical entries.
- **projects.json is gitignored.** It contains project paths and names that are local-machine-specific and potentially private. Cloud agents and fresh clones run in raven-only mode and can only see tasks for the assistant project itself — they can't reach tasks for other tracked projects. This is a privacy boundary, not a bug.
- **Conflict detection is a warning, not a block.** If both `tasks.md` and `tasks/<shorthand>.md` exist for a project, the CLI warns and uses the project-local file. The warning shows up in `--json` output as a `conflict: true` field — the web UI surfaces it as a badge, not a blocker.
- **Deadline substitution replaces trailing parens.** The `substitute_due` function detects any trailing `(...)` group that looks like a date and replaces it in place rather than appending a second parenthetical. If the trailing group isn't date-shaped (e.g., `(see above)`), it's left alone and the new date is appended.
- **Python venv resolution is explicit.** On Windows, `execFile('python', ...)` from Node hits the system Python, not the venv. The wrapper walks: `VIRTUAL_ENV` env var → known venv path → `'python'`. Projects on other platforms should apply the same pattern rather than assuming `python` resolves correctly from a spawned process.
