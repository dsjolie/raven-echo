# Session Continuity

## Problem

AI coding agents start each session with no memory of the last one. When a session ends — deliberately, by timeout, or because the context window filled — the agent loses what problem was being solved, which decisions were made, and what the next concrete step was. Re-explaining all of that at the start of every session is expensive and error-prone. Keeping a free-form running notes file helps only if the agent reliably writes it at the end and reads it at the start; left to ad-hoc discipline, it drifts stale and gets ignored.

## Approach

Bracket every session with two skills that save and restore a single labeled state file:

- **Reflect** runs at session end and writes (or updates) the state file: what's in progress, key decisions, files touched, concrete next steps, open questions.
- **Continue** runs at session start, finds the most recent state file, and presents it so the user can decide how to proceed.

The state file is keyed by a **human-chosen label** — the agent suggests one from the session's topic, the user can override. A label like `memory-architecture` is interpretable at a glance and stable across time and machines, which a generated session ID is not. This makes the mechanism a lightweight stash: `reflect` pushes working state under a name, `continue` pops the most recent one.

Two properties keep it honest. The save step *updates* an existing file for the same topic rather than spawning near-duplicates, so there's always one canonical record. And the restore step *presents* state but never auto-executes it — the gap between sessions may have changed priorities or invalidated a planned step, so the agent shows what it found and waits.

These labeled state files are **threads**. This document covers the per-session save/restore loop on one machine; how threads are tracked across many sessions, multiple machines, and projects — and resumed by session ID — lives in [threads.md](threads.md).

## Implementation

**Reflect (save path):**

1. Identify or create the state file. If one already exists for the topic, update it — append new decisions, resolve answered questions, replace stale next steps — rather than create a second file.
2. Write the five sections (in progress / decisions / files / next steps / open questions).
3. Record that this session worked on the thread (the session-linking step — see threads.md).

**Continue (restore path):**

1. Check recency. If the most recent state file is under roughly a day old, propose it immediately; otherwise show a digest of recent threads and let the user pick.
2. Record the resume against the thread *before* presenting state — a bookkeeping step that must happen reliably, so it runs first, not as an afterthought.
3. Present the state and ask how to proceed. Do not auto-execute the recorded next steps.

## Gotchas

- **Human labels, not session IDs, are the stash key.** Session IDs are machine-generated and meaningless to someone scanning a directory. Labels are interpretable and portable; the underlying session IDs are kept for machine use (resume), but navigation is by label.

- **Update, don't duplicate.** When a session continues work already captured under a label, the save step should update that file. Multiple near-identical state files for one topic make it unclear which is canonical — default to updating, and ask when ambiguous.

- **Don't auto-execute restored state.** Presenting a thread's contents is safe; acting on its "next steps" without checking is not. Time has passed; the plan may be stale.

- **Bookkeeping is its own step, not a tail bullet.** An early version buried session-linking as the last sub-point of the state-writing step, and it got skipped. Anything that must happen reliably belongs as a distinct numbered step ahead of the visible payoff, not appended after it.
