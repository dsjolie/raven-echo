# Considerations and Handlers

## Problem

An agent that runs unattended generates work faster than a human can absorb it. A nightly rumination pass over a knowledge base notices a stale fact here, a truncated citation there, a doc that drifted from the code. Each finding is filed as a task. Within weeks the task list is mostly agent-filed suggestions — in this project, around 78% — and the handful of items the *human* actually needs to act on are buried in the noise. The backlog stops being a to-do list and becomes a dispatch queue nobody dispatches.

Two bad escapes present themselves:

1. **Blind-apply the suggestions.** Tempting, but the filing agent is the least trustworthy actor in the system: it ran with web access (untrusted input), it can't see gitignored files, and it sometimes confabulates a citation that looks real. Auto-applying its output means writing its mistakes straight into the source of truth.
2. **Ignore them.** Also wrong — buried in the gravel are genuine fixes. And the pile *regenerates*: 3–4 new items a night. A one-time cleanup doesn't converge; the moment you finish, it's refilling.

So the requirement is sharper than "triage the backlog." It's: separate the agent's firehose from the human's real work, and then *converge* the firehose — drive it toward empty by construction — without blind-trusting a single item.

## Approach

Two moves: **separate the pile**, then **route each item by category to a handler**.

### Separate the pile

An agent-filed item is a **consideration**, not a task. It's identified structurally — a provenance tag (`#agent`), no priority lane, no deadline — and it's excluded from the human triage count entirely. The committed task list shows only work a human committed to. Considerations live on their own surface. This single split drops the "you have N things to triage" banner from dozens to a couple, because the dozens were never things the human needed to decide.

### Category → handler → disposition

A separate pile by itself is just a second graveyard — the gravel still has to go somewhere. So each consideration carries a **category** tag, and the category picks a **handler**: the procedure that actually does the verb.

| category | handler | auto? |
|---|---|---|
| `wiki-drift`, `optional-cleanup` | `safe-edit` | yes — safe-list only |
| `verification` | `verify` | yes — with a trust bar |
| `decision` | `decide` | no — surface to human |
| `status` | `surface` | no — needs the user's own knowledge |
| `lookup` | `lookup` | partial |
| `investigation` | `investigate` | no — hand to a research agent |
| `code` | `prepare-diff` | no — human reviews the diff |
| *(uncategorised)* | `review` | no — surface |

The category→handler map is defined once, in the same CLI that parses the tasks, so every consumer derives the same handler from the same tag. The UI owns only presentation (which bucket, what colour); it never re-derives the routing.

### The line that actually matters

The first cut of this design said "verification items are dangerous, always route them to a human." That was too coarse, and the correction is the load-bearing insight:

> The danger is *marking a thing done without doing it*, not the action itself.

A handler may run autonomously **if and only if it does the verb with inspectable evidence**, and surfaces the moment it's in doubt. The `verify` handler doesn't rubber-stamp citations — it finds the primary source, tries to refute the claim, and *resolves* most items autonomously (fix the truncated title, confirm the real paper), surfacing only the genuinely inconclusive ones for a human. Routing an entire category to a human "to be safe" throws away the leverage; the real safety is in the evidence discipline, not in refusing to act.

### Why not just tag them `#auto`?

The project already had an autonomous-work tag. Why not reuse it? Because the existing auto-worker is a *research-and-report* engine — it writes a report to an inbox, it doesn't make in-place edits. Tagging drift `#auto` would produce *reports about drift*, not fixes. The convergence lever had to be a handler that performs the edit locally, behind the commit-lock — which is a different machine entirely from "go research this." Recognizing that two superficially similar tags ("do this autonomously") mean two incompatible things saved building the wrong worker.

## Implementation

### Considerations are derived, not stored

There's no consideration table. A consideration is computed from tags at parse time:

```python
CONSIDERATION_TAGS = {"agent", "consideration"}

# an item is a consideration if it carries the provenance tag and isn't
# committed work (no lane, no deadline)
consideration = bool(tags & CONSIDERATION_TAGS) and not has_lane and deadline is None

# the keystone: a consideration is NOT untriaged — it has its own surface
untriaged = (not has_lane and not dropped
             and not consideration and deadline is None)
```

That last line is the keystone. "Untriaged" — the thing the human is nagged about — explicitly excludes considerations. The agent's pile and the human's pile are different sets, computed from the same task file.

### Category resolution is priority-ordered

A consideration can carry several tags; one categorical tag wins, by a fixed priority, with aliases normalized:

```python
CATEGORY_PRIORITY = ["decision", "verification", "investigation", "lookup",
                     "status", "code", "wiki-drift", "optional-cleanup", ...]
CATEGORY_HANDLERS = {"decision": "decide", "verification": "verify",
                     "wiki-drift": "safe-edit", ...}

def derive_handler(tags):
    for tag in CATEGORY_PRIORITY:
        if tag in tags:
            category = ALIASES.get(tag, tag)
            return category, CATEGORY_HANDLERS.get(category, "review")
    return "uncategorized", "review"   # unknown → surfaced, never auto-run
```

The fallback is the safe one: anything uncategorised routes to `review` and is shown to a human, never auto-executed. New categories are added by extending the map; downstream inherits the routing for free.

### Promotion is the escape hatch

A consideration that turns out to be real work is **promoted** — the CLI strips the `#agent` tag, and the item rejoins the committed task list. Handlers only ever touch tagged considerations, so promotion is the clean boundary between "the agent's suggestion" and "work the human owns." The inverse is `drop` (dismiss).

### The handler contract

Handlers that run autonomously obey a fixed contract, learned from the first real drain:

1. **Verify the premise first.** Before any edit, check that what the consideration describes is still true of the *current* file. If the premise is stale, **skip and flag** — never write a fix on top of drift that's already gone. On the very first live drain this caught two items whose premises had been silently invalidated by other work. It's the load-bearing step, not a nicety.
2. **Safe-list only, default to human.** Only an explicit allow-list of classes (prose in wiki/docs, additive notes) auto-executes. Skill code, settings, permissions, the project registry, anything touching stability or security — all surface.
3. **One commit per file.** Revert is always a single command.
4. **Log every action.** Edited, verified, skipped, routed — every outcome appends one line to an action log. Silent auto-action is the swallow-errors antipattern in a nicer coat.
5. **Local executes, cloud only proposes.** The execute step runs locally, with full file visibility, behind the commit-lock. A web-exposed cloud agent runs the same handler in a propose-only dry-run — it never holds execute authority. (This isn't only policy: the action log lives in a gitignored dir a cloud clone can't write anyway.)

### The action log is the Review surface

Every handler action appends a JSON line to a log:

```json
{"ts":"…","action":"edited","category":"wiki-drift","handler":"safe-edit",
 "file":"…","task":"…","summary":"…","commit":"a1b2c3d","route":null}
```

The UI's Review surface reads the same records. So the agent's digest and the human's review never diverge — they're the same data. Each row is framed as "your eyes, ~10 seconds" rather than "done," and each carries a **copyable revert command** rather than a revert button, because the UI deliberately never runs git itself. (Git mutation is exactly the class that routes to a human; the UI showing a one-command undo is consistent with that, where a one-click undo button would not be.)

## Gotchas

- **A separate pile without handlers is just a second graveyard.** This is the failure mode the whole design exists to avoid. If the pile regenerates and nothing drains it, you've only moved the clutter. The handlers — and a scheduled drain that runs them — are what make it converge, not the separation.
- **"Route the whole category to a human to be safe" is the wrong safety.** It feels conservative but throws away the autonomy that makes the system worth building. The right safety is per-item evidence ("do the verb with inspectable evidence; surface on doubt"), which lets the safe 80% drain automatically while the genuinely uncertain 20% reaches a person.
- **Verify the premise before every edit, every time.** The filing agent and the executing agent run at different times; the world moved in between. An edit that assumes a stale premise writes drift on drift. Skip-and-flag is cheaper than the cleanup.
- **The category map is the single source of truth — don't let the UI re-derive it.** The moment a second consumer computes "which handler" from tags independently, the two drift and a consideration routes two different ways depending on who's looking. Derive once, in the parser; pass the resolved category and handler through.
- **Keep "untriaged" and "considerations" as disjoint sets in one place.** The keystone is one boolean expression. If a refactor lets a consideration leak back into the untriaged count, the human's triage banner re-inflates with the agent's noise and the whole point is lost.
