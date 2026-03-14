# Session Continuity: Label-Based State Stashing

## Problem

AI coding agents reset their context between sessions. When you resume work the next day, the agent doesn't know what you were doing, what decisions you made, or what comes next. You need a way to persist working state across sessions without coupling it to session IDs or process state.

## Approach

Two complementary skills form a stash/pop cycle:

1. **Reflect** (at session end) — saves working state to `in_progress/[label].md`
2. **Continue** (at session start) — reads `in_progress/` and offers to resume

The label is user-chosen, suggested by the agent based on the session's topic. This makes it a human-readable stash system — you can have multiple in-progress states and pick which one to resume.

```
in_progress/
  memory-architecture.md     # Saved 2 hours ago
  web-ui-refactor.md         # Saved 3 days ago
  paper-revision.md          # Saved last week
```

## Implementation

**Reflect** produces a structured markdown file:

```markdown
# Memory Architecture

## What's in progress
Designing the recognition hook for the memory system.
Converged on keyword database approach.

## Key decisions
- Two-tier storage: MEMORY.md as index, topic files for detail
- Recognition hook scans prompts against keyword database
- Reflect maintains both memory files AND recognition database

## Files touched
- docs/memory-architecture.md (updated design)
- docs/memory-recognition-hook.md (new)

## Next steps
- Implement storage format for recognition keywords
- Write the hook script
- Wire up in settings.json

## Open questions
- How many keywords per memory file before splitting?
- Should the hook inject keywords or full file paths?
```

**Continue** checks recency and offers options:
- If the most recent file is less than ~1 day old: present its summary, ask if the user wants to resume
- If nothing is recent: show a digest of recent states (up to 10), let the user pick or start fresh
- If `in_progress/` is empty: say so, suggest starting fresh

## Gotchas

- **Labels, not session IDs.** Tying state to session IDs or PIDs makes it impossible to resume from a different terminal or machine. Labels are human-meaningful and portable.

- **Don't auto-execute next steps.** Present the saved state and let the user decide. The context may have changed since the state was saved — a dependency may have been updated, priorities may have shifted, or the user may want to take a different approach.

- **Update, don't duplicate.** When reflecting on work that matches an existing in-progress file, the agent should offer to update the existing file rather than creating a new one. This keeps related work consolidated across sessions instead of producing a trail of near-identical state files.

- **Old files accumulate.** This is fine — they serve as a lightweight work log. The user cleans them up when they want. Don't auto-prune; the user might want to resume something from weeks ago.

- **Cross-project state.** The `in_progress/` directory lives in the current project root, so each project has its own stash. If you work across multiple projects, each has independent state.
