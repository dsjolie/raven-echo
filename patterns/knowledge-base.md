# Knowledge Base

## Problem

Knowledge accumulates faster than it coheres. Overnight agents produce research reports. Skills log improvement notes. Conversations yield insights that never make it past the transcript. The result is a pile of individually correct files with no compiled view and no cross-referencing — storage without understanding.

The deeper problem is locality: if the knowledge store lives in one repo, every other project session is locked out. A fact discovered while working on project A isn't accessible when you're in project B's directory an hour later. You end up re-deriving things you already know.

## Approach

Three-layer structure compiled by a nightly librarian, accessible from any project directory via a thin CLI:

1. **Index** — a curated entry point (`knowledge/index.md`) that organizes topic articles by theme using `[[wikilinks]]`. Updated manually when new articles are created.
2. **Topic articles** — living documents (`knowledge/topics/<slug>.md`), one per subject, updated in place. Git holds history; the current file is always the best current understanding.
3. **Daily narratives** — reflective diary entries (`knowledge/daily/YYYY-MM-DD.md`) written nightly, connecting the day's events back to the topic graph via wikilinks.

The core design decision is **living documents over append-only logs**. An article on a subject should read as the current understanding of that subject — not as a sequence of "learned X on date Y" entries. Append-only growth produces notes files; in-place updating produces knowledge.

A second decision: **structure emerges from content**, not from pre-defined categories. Articles use inline `#tags` instead of a folder taxonomy. The index is hand-curated, not auto-generated. Topic files get created when a subject has earned its own article, not on first mention.

Cross-referencing uses `[[slug]]` wikilinks. Backlinks — which articles link to this one — are computed on demand by scanning the file set for the pattern. No graph database, no maintained link index; just a file scan that's cheap at personal scale.

## Implementation

### The librarian: nightly consolidation

Consolidation runs as a nightly skill and acts as a librarian rather than a logger. It:

1. **Gathers inputs** — new files landed in `incoming/` (cloud agent outputs, prefetched content), research reports written since yesterday, the morning briefing, `git log --since="yesterday"` to see what changed in code, and `improvements.md` files from each skill directory.

2. **Updates topic articles in place** — for each substantive input, identifies the relevant topic article(s) and integrates the new information. The default is enrichment of existing articles, not proliferation of new ones. A new article is created only when a subject has enough substance to stand alone and doesn't fit an existing topic cleanly.

3. **Writes the daily narrative** — a reflective entry covering what happened, what was learned, open threads. Liberal use of `[[wikilinks]]` to connect the day's events to the durable topic graph. Tone is diary, not changelog: "what does today mean in the arc of this project" rather than "here is a list of things that occurred."

4. **Promotes actionable open threads to tasks** — when an open thread in the daily narrative implies someone needs to do something, it becomes a tracked task. The daily prose carries context; the task carries trackability. The two surfaces are parallel, not substitutes.

The consolidation's governing principle: compile before maintain. Knowledge growth takes priority over memory trimming. Write the daily note first; check health after.

### Cross-project CLI (`rwiki`)

The `rwiki` CLI wraps the knowledge store so it's accessible from any project directory, not just from the Raven repo:

```bash
rwiki list                          # enumerate articles
rwiki list --tag memory             # filter by inline tag
rwiki get <slug>                    # read one article
rwiki search "delegation"           # full-text search across topics/
rwiki tags                          # enumerate inline #tags with counts
rwiki add <slug> --tags a,b         # create stub article (refuses to overwrite)
rwiki edit <slug>                   # print absolute path for native Read/Edit
rwiki edit <slug> --append "..."    # append note at end
```

The CLI works from any working directory. Access is enabled by a discovery sentinel injected into the global Claude configuration and a narrowly scoped file-allow rule covering `knowledge/**`. This means any project session — not just Raven sessions — can read and write the shared wiki without switching directories.

Authorship is not embedded in article content. The originating project is recoverable from CC session JSONLs alongside each tool call. The audit skill has a `wiki-edits` scanner that flags writes from non-Raven project sessions, both for hygiene and to catch unintended access.

For non-trivial edits, the pattern is: call `rwiki edit <slug>` to get the absolute path, then use the native `Edit` tool for surgical control. The `--append` form covers the simple "drop a note at the end" case.

### Wiki panel in the web UI

The web UI serves a browsable wiki panel via a `/api/wiki` endpoint with three actions:

- `action=index` — returns the article list (topics alphabetical, daily reverse-chronological) with title extraction from the first `# Heading` in each file.
- `action=page&page=<slug>` — returns the file content plus backlinks. Backlinks are computed by scanning all topic and daily files for `[[slug]]` matches. Path is validated to stay within `knowledge/` before the read.
- `action=search&q=<query>` — full-text search across both `topics/` and `daily/`, returning slug, title, and a ±60-character snippet around the first match.

The panel renders markdown in an iframe for style isolation. Wikilinks are intercepted client-side and converted to panel navigation rather than browser navigation. The `/wiki` route also serves a standalone page view of any article for sharing or deep-linking.

### The narrative-knowledge loop

Daily narratives and topic articles feed each other in a cycle:

- Raw inputs (reports, agent outputs, git changes) arrive overnight
- Consolidation updates topic articles with the new material
- Consolidation writes a daily narrative that references topics via wikilinks
- Future consolidation runs read both topics and narratives as context

This means the knowledge base isn't a static reference — it's a record of an evolving understanding. The daily narrative is the bridge between ephemeral conversation and durable knowledge; the topic article is where that knowledge stabilizes into something reusable.

## Gotchas

- **Backlink computation is a full scan.** Every page view in the wiki panel scans all files. At a few dozen articles this costs nothing. If the knowledge base grows into thousands of entries, you'd want a precomputed index. For personal scale, the simplicity of no maintained index is worth the linear cost.

- **Living documents require editorial judgment.** In-place updates mean the consolidation agent decides what stays, what changes, and what gets cut. It gets this right most of the time, but occasionally removes a nuance or over-synthesizes. Git diff on any article shows what changed; the history is the safety net.

- **Wikilink resolution is flat.** `[[slug]]` maps directly to `topics/<slug>.md`. No aliases, no redirects, no case normalization beyond what the search uses. Renaming a file breaks existing links. The backlink panel makes it easy to find all references before renaming, but the update is manual.

- **Cross-project writes need routing discipline.** The `rwiki` CLI is the intended interface from non-Raven sessions. Direct `Read`/`Edit` calls to `knowledge/**` from other project directories are technically possible (the allow rule permits them) but bypass the CLI's slug validation and stub conventions. The audit scanner catches these; the pattern to enforce is: always go through `rwiki`.

- **Discovery sentinel must stay in sync.** The cross-project access depends on a sentinel injected into the global Claude configuration. If the sentinel is out of date — say, after the CLI moves or its interface changes — sessions won't know to use it. A sync script (`scripts/sync-discovery.sh`) regenerates the sentinel from its source and is idempotent; run it after any interface change.
