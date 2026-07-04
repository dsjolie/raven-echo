# Threads

## Problem

Agent work doesn't decompose cleanly into "tasks" and "projects." There's a middle unit — a refactor, a feature design, a paper revision, an investigation — that spans many sessions, sometimes weeks, and often more than one machine. A task is too granular to hold it; a project is too coarse. Without a first-class home for this unit, its history scatters: which sessions touched it, what was decided across them, where to pick it back up.

A second problem sits underneath. When the same repository is cloned on several machines, the obvious place to record "which sessions worked on this" — a shared file — collides in git the moment two machines write at once. Session bookkeeping is exactly the kind of high-frequency, multi-writer append that turns version control into a merge-conflict generator.

## Approach

Make the mid-size unit explicit: a **thread**. A thread is a labeled markdown file (`in_progress/<label>.md`) holding durable working state — what's in progress, key decisions, next steps. It persists across sessions and is the thing you resume. Two mechanisms surround it:

1. **Per-machine session sidecars.** Session records — "this session worked on this thread, on this date, and here's what it did" — live in `in_progress/machines/<clone>/<label>.md`, one sidecar per machine per thread. Every clone appends only to its own sidecar, so git never sees a conflict on session data, and the thread file itself stays clean.

2. **Stable clone identity.** A small checked-in map turns the opaque OS hostname into a friendly, durable name (`{ "HOSTNAME": { "name": "laptop" } }`), falling back to the raw hostname for unregistered machines. It's the single source of "which machine am I," so per-machine paths are readable and don't churn when a hostname changes after a reinstall or domain join.

A CLI is the tooling layer over this substrate: an **overview** across one project or all of them, idempotent **session-linking**, and **backfill** that reconstructs history from past transcripts.

The reason to split sidecars out at all is that thread *content* and session *records* change on different cadences and from different writers. Content is edited deliberately, usually from one machine at a time; records are appended mechanically at the start and end of every session, from whichever machine ran it. Co-locating them guarantees conflicts. Separating them by writer — one file per machine — removes the entire conflict class with no locking and no coordination.

## Implementation

### Layout

```
in_progress/
  <label>.md                     # thread: durable working state, edited deliberately
  machines/
    <clone>/<label>.md           # sidecar: session log, one file per machine
```

A sidecar is just a `## Sessions` block plus free-form `## Notes`:

```
# <label> on <clone>

## Sessions
- `<full-uuid>` — 2026-05-28 — fixed the lock race, added the nudge hook
- `<full-uuid>` — 2026-05-24 — _resumed_

## Notes
(machine-specific notes — paths, env quirks)
```

### Session-linking

Linking records that a session worked on a thread. It is idempotent and always writes to the *current* machine's sidecar (created lazily on first link):

```
threads link <label> <session-id> [--summary "what this session did"]
```

- A bare link (no summary) writes a `_resumed_` placeholder — "this session touched the thread" — which a later reflect upgrades to a real one-line summary.
- Re-linking the same session with no summary is a no-op; with a summary it overwrites (most-recent wins).
- Every write **re-sorts** the `## Sessions` block newest-first. This matters because auto-resume reads the *first* entry: if file order ever drifted from chronological order, resume would silently pick the wrong session.

### Overview

The overview scans each project's `in_progress/` for thread files and, for each, aggregates session entries from *every* `machines/*/<label>.md` sidecar. So one view shows total session count and last activity across the whole fleet, even though each machine only ever wrote its own file. "Last activity" is the max of the thread file's mtime and its most-recent session date — a thread reads as current whether its content or just its session log changed.

### Backfill

Threads that predate the sidecar mechanism have no recorded history. Backfill reconstructs it: scan recent agent transcripts, find sessions that invoked the save/restore skills *and* edited an `in_progress/<label>.md`, and link them — marked `_backfill_` so reconstructed entries are distinguishable from ones written live. The last touch-timestamp per thread wins, since a long session's start time misrepresents when the work actually happened.

### Resume

Sidecars store full session UUIDs (the overview may show short prefixes, but resuming requires the whole UUID). To resume a thread on a given machine, read *that machine's* sidecar, pick a session from its `## Sessions` block, and resume it — only sessions recorded on the current machine are resumable there.

### Long-running threads: the head/log split

Most threads live for days or weeks and then close. A *coordinator* thread — the standing state file of a persistent, scheduled agent session — never closes, and grows by appended increments until it outgrows what a reader can take in one pass (in our runtime, the agent's file-read tool caps out around 25K tokens). Past that point the file stops functioning as working state: resuming means reading a novel, and the operational facts are scattered through months of narrative.

The fix separates the two things such a file was conflating:

- **Head** — operational state that is *maintained in place*: `## Standing carries`, `## Open decisions`. Always at the top, never archived, single source of truth. Editing it is deliberate, like editing the thread body of any other thread.
- **Increment log** — dated, append-only entries, delimited by HTML-comment fences (`<!-- increments:start -->` / `<!-- increments:end -->`). This is the part that grows without bound.

An `archive` subcommand rolls the oldest increments out to `archive/threads/<label>.md` when the file exceeds a character budget (characters as a cheap proxy for tokens, ~4 chars each): roll oldest-first until under a target size, but never below a minimum number of retained increments, so recent context always survives. The command is **self-deciding and idempotent** — a no-op below the threshold — which is the property that makes it usable: the end-of-session routine calls it unconditionally on every run instead of anyone having to decide when archiving is due.

If the file is over budget but has no fences, the tool warns and refuses to roll rather than guessing at structure from headings — the file needs restructuring, and a heuristic roll that guessed wrong would silently destroy operational state.

## Gotchas

- **Per-machine sidecars are the whole design — don't merge them back.** The instinct to keep session history "in one place" inside the thread file is exactly what created git conflicts. One file per writer is the fix; resist re-centralizing it.

- **Re-sort on every write, don't trust insertion order.** Anything that reads "the latest session" (auto-resume, last-activity) depends on chronological order. Out-of-order timestamps — from a `--date` override or a backfill — break it unless the block is re-sorted on each write.

- **Clone identity must degrade gracefully.** A brand-new machine isn't in the map yet. Falling back to the raw hostname means it still works immediately; registering a friendly name later is an optional cleanup, not a prerequisite.

- **Backfill is best-effort and labels itself as such.** A reconstructed entry marked `_backfill_` is honestly distinguishable from a summary the agent actually wrote — better than fabricating a confident summary from a transcript scan.

- **Threads accumulate; that's intended.** They aren't auto-pruned. The growing set of `in_progress/<label>.md` files is a lightweight, human-scannable work log — closing a thread is a deliberate act (archive or delete), not a side effect.

- **Size limits arrive before you expect them.** Any append-only state file read by an agent will eventually exceed the agent's read window. Plan the head/log split before a coordinator-style thread hits the wall — retrofitting fences into a 90K-character narrative is exactly the kind of restructuring nobody wants to do under pressure.

---

Threads are *written and restored* by the reflect/restore cycle — see [session-continuity.md](session-continuity.md) for that loop. This document is about the durable unit itself and how it's tracked across sessions, machines, and projects.
