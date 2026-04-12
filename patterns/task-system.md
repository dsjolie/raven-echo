# Task System

## Problem

Tasks live across many projects — each in its own repo, its own context, its own timeline. A researcher might have deadlines for three courses, two papers, and a software project, all tracked in different places. What's overdue? What's due this week? Which tasks are eligible for autonomous agent work overnight?

Without a unified view, the only way to answer is to check each project individually.

## Approach

Markdown files as the storage format, a Python CLI as the parser, and a Node.js web UI for browsing. The architecture is a four-layer stack:

```
Markdown files (one per project)
    ↓
Python CLI with --json flag
    ↓
Node.js wrapper (thin, ~100 lines)
    ↓
Browser panels via WebSocket
```

Each layer does one thing. Python handles the parsing — deadline logic, tag extraction, fuzzy matching. Node handles the serving. The browser handles the interaction. No layer reimplements what another does.

### Task file format

```markdown
# Project Name

ONGOING: Current continuous work description

## Tasks
- [ ] Implement feature #next (Mar 15)
- [ ] Research topic (2026-03-20)
- [ ] Background job #auto (Early March 2026)
- [x] Completed task ✓
```

Deadlines are parenthesized at the end: ISO dates, month names, fuzzy periods ("Early March 2026" → the 10th). Year is inferred — if a date is more than 90 days in the past, it bumps to next year. Tags are inline hashtags: `#next` (working set), `#auto` (eligible for autonomous agent work), `#agent` (added by an agent, not the user).

### Two-place storage

Tasks live in one of two places:

1. **Project-local**: `tasks.md` in the project root (keeps the repo self-contained)
2. **Centralized fallback**: `tasks/<shorthand>.md` in the assistant's root (for projects without a codebase — committee work, fund applications, external obligations)

If both exist, project-local wins. The UI shows a conflict warning rather than silently picking one — the user should consolidate.

### Inbox

A flat `inbox.md` for quick capture without project assignment. Items can have optional `@project` tags for draft routing. The workflow is: capture fast, route later. This separates capture speed from routing intelligence.

## Implementation

### CLI operations

The Python CLI uses fuzzy substring matching for task identification — no IDs, no line numbers:

```bash
rtasks add myproject "Write documentation (Apr 15)"
rtasks done myproject "Write doc"     # matches by substring
rtasks next myproject "Write doc"     # toggle #next tag
rtasks auto myproject "Background"    # toggle #auto tag
rtasks top myproject "Urgent thing"   # move to top of list
```

Tags are preserved during edits and inserted before the deadline parenthetical. The `--json` flag on any command returns structured output for the web UI.

### Urgency grouping

The overview panel calculates urgency from deadlines — no stored state, just `deadline vs. today`:

- **Overdue** — deadline has passed (red)
- **Today** — due today (yellow)
- **This week** — 1–7 days (blue)
- **Next week** — 8–14 days
- **Upcoming** — 15+ days
- **No deadline** — lowest priority

The overview shows one card per project with its most urgent task, a deadline badge, and an "N more tasks" count. This keeps the view scannable even with 60+ tasks across 20 projects. A color indicator (red → yellow → blue → green) gives the system state at a glance.

### WebSocket updates

All write operations (add, complete, edit) invalidate a short cache and broadcast updates to all connected browsers. Multiple browser tabs, phone and desktop, all stay in sync.

## Gotchas

- **Fuzzy matching is a feature, not a bug.** `rtasks done raven "feature"` matches the first task containing "feature". This makes CLI usage natural but means task descriptions need to be reasonably distinct within a project.
- **Deadline parsing is generous.** "Early March 2026", "Mar 15", "2026-03-15", and "March" all work. The year inference (bump past dates to next year) occasionally surprises when you genuinely mean a past date.
- **Orphan task files need frontmatter.** Centralized task files for projects without repos use YAML frontmatter for the project description, since there's no `projects.json` entry to derive it from.
- **The overview polls every 5 minutes** even when the panel isn't active, to keep the status indicator fresh. At personal scale this is negligible; at team scale you'd want event-driven updates.
