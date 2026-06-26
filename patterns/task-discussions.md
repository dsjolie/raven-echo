# Task Discussions: Re-Priming a Stale Backlog Item

## Problem

Backlog items rot from the context end, not the content end. A task filed three weeks ago still reads fine — but you no longer remember *when* you filed it, *why*, what files it points at, or whether its premise still holds. To decide what to do with it, you'd have to reconstruct all of that: git-blame the line, open the files it references, check them against the current state of the repo. That reconstruction is tedious and low-status, so it doesn't happen, and the item sits — neither done nor dismissed — indefinitely. The pile of "I'll deal with that later" items is mostly things you've simply lost the context to decide on.

This is exactly the kind of work an AI agent is good at and a human avoids: cheap, mechanical context reconstruction. The leverage isn't answering a question — it's *re-loading what you've forgotten before you have to ask*.

## Approach

A **Discuss button** on each backlog item. Clicking it spawns a fresh agent session, primed with the item's context, in a conversation modal. The agent's first job — before the human types anything — is to reconstruct the forgotten picture:

- **When and why it was filed.** `git log -S"<distinctive phrase>"` / `git blame` on the task line finds the commit that added it; the message usually names the reason or the report that triggered it.
- **What it points at.** Open the files, wiki articles, or reports the text names.
- **Whether the premise still holds.** The single most useful check: is what the item describes still true of the *current* repo? If the premise is stale, that may be the entire answer.

It opens with a reorientation, not a question:

> *This was filed three weeks ago from the nightly rumination pass. It's about the citation in `security-model.md`. Since then that file was rewritten and the citation is already correct — the premise is stale. Dismiss it, or did you want to dig into something?*

Then it's a normal conversation, scoped to this one item, that **lands on a concrete disposition** — promote to real work, dismiss, edit, file a follow-up concern, or "re-loaded, no change needed." A discussion that changes nothing and records nothing was just rumination; the disposition is what makes opening it worthwhile.

The design principle is **priming over prompting**. A generic "ask the AI about this task" chat would make the human supply the context. The value is the inversion: the agent supplies the context the human lost.

### Ephemeral, not a thread

This is deliberately *not* the project's durable work-unit (a thread). Threads accumulate, are resumed, and represent ongoing work. A discussion is scoped to one item, short-lived, and lives in its own lightweight pile so it doesn't pollute the thread space. It's resumable if it turns out to need more, but it isn't *expected* to be — "just there for the sense of access."

## Implementation

### The filesystem is the store

Each discussion is one JSON file in a gitignored data dir. The file is simultaneously the pile entry *and* the priming input the skill reads:

```json
{"id":"disc-…","project":"…","taskText":"the item under discussion",
 "kind":"task","created":"…","sessionId":null,"status":"open"}
```

No database. To list the pile, read the directory. The priming skill reads its own discussion file by absolute path (passed as the slash-command argument), because the spawned session's working directory may be a different repo entirely.

### Spawn and prime

Creating a discussion mirrors how the project launches its persistent coordinator: write the record, create a terminal, inject a slash-command that invokes the priming skill.

```
start-discussion → discussions.create(...)            // write the JSON
                 → terminals.create({cwd, name, discussion:true})
                 → submitLine(id, 'claude "/discuss <abs-path-to-json>"')
```

The `discussion: true` flag is the only structural addition: terminals carrying it are skipped by the normal tab strip, because a discussion shouldn't appear as a pinned terminal tab.

### A modal backed by a terminal

The conversation renders in a modal, not a tab — but it's still a real PTY-backed terminal underneath. This works because the client event bus is **multi-subscriber** (`Map<type, Set<callback>>`), so the modal's xterm can subscribe to the same `output` stream that a terminal tab would, without stealing it:

```js
// app.js — multiple panels can listen to the same event type
Raven.on('output', cb)   // adds cb to the Set for 'output'; doesn't replace
```

That one property — events fan out to a *set* of subscribers, not a single handler — is what lets a modal and a tab coexist on one session. It's worth designing in from the start; retrofitting single-subscriber buses into multi-subscriber ones is painful.

### Resume without skill bookkeeping

For a discussion to be resumable, its CC session id has to be captured. Rather than make the skill write its own id back into the file (fragile, and the skill would have to know its id), the server captures it: at the agent's `SessionStart` hook, the server maps the firing terminal to its discussion record and records the session id. Resume is then `claude --resume "<sessionId>"`. The capture is idempotent — first non-null id wins, so a re-prime can't clobber the original.

### Elevate: re-home, don't restart

When a quick discussion grows into real work, an **Elevate** button moves it from modal to a proper terminal tab. This is clean precisely because the discussion already *is* a real terminal — elevating only changes its presentation:

```
elevate-discussion → flip the terminal's `discussion` flag off
                   → drop it from the discussion map
                   → mark the record status:'elevated'
                   → broadcast; the modal disposes its xterm (PTY stays alive),
                     terminal.js opens a tab for the same terminalId
```

The PTY is never killed, so no session is lost — the same conversation simply reappears as a tab. The one wrinkle: the new tab needs the scrollback so far, so the server keeps a circular output buffer per terminal and replays it on attach. Elevated discussions **leave the pile** (filtered out by `status:'elevated'`) and live on as ordinary tabs and in the session listing.

## Gotchas

- **Priming must be proportionate.** A one-line task needs one `git log` and one file read, not a research project. The skill is told explicitly to keep reconstruction proportional and not sprawl into adjacent work — the value is fast reorientation, not a deep dive nobody asked for.
- **It has to land somewhere.** Without a disposition step, a discussion is just talking. The skill closes by offering the concrete moves that fit (promote / dismiss / edit / file-concern / leave) and *performing* the one chosen, so the conversation ends in a state change, not a trailing-off.
- **Don't over-build the lifecycle.** There's no archiving, no expiry, no status machine beyond open/elevated — deliberately, because usage was unknown at build time. Building a retention policy for a feature nobody has used yet is speculative. The store is just files; a cleanup pass can be added if the pile ever grows enough to need one.
- **Multi-subscriber bus is a prerequisite, not a detail.** The whole modal-and-tab-on-one-session trick depends on the event bus fanning out to a set. If yours dispatches to a single handler per event, the modal and the tab fight over the output stream.
- **A brief output-order race on mid-stream elevate.** If Elevate is clicked while the agent is actively streaming, the buffer replay and the live stream can momentarily interleave out of order. It's cosmetic and self-corrects; worth knowing before you chase it as a bug.
