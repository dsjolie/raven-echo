# Knowledge Base

## Problem

Knowledge accumulates in scattered places — research notes, conversation transcripts, reports from overnight agents, committed documentation. Each piece lands somewhere reasonable, but nothing connects them. There's no compiled view, no cross-referencing, and no process for turning raw inputs into durable knowledge.

The gap isn't storage — it's synthesis. Files exist. Understanding doesn't accumulate.

## Approach

A wiki-style knowledge store with three layers, compiled by a nightly librarian process:

1. **Index** — a curated entry point (`index.md`) with wikilinks to topic articles, organized by theme
2. **Topics** — living articles (`topics/*.md`), one per subject, updated in place as understanding evolves
3. **Daily narratives** — reflective diary entries (`daily/YYYY-MM-DD.md`), written nightly, connecting the day's events to the knowledge graph

The key design choice is **living documents over append-only logs**. Topic articles are updated in place — not versioned per session, not appended to. Git provides the version history. The current file is always the best current understanding.

### Conventions

- **Wikilinks**: `[[topic-name]]` creates bidirectional links. The wiki panel computes backlinks by scanning all files for links to the current page — no graph database, just a file search.
- **Tags over taxonomy**: `#topic-name` inline tags for cross-cutting themes. Structure emerges from use, not from pre-defined categories.
- **Topic creation threshold**: A new topic file is created when a wikilink recurs 3+ times across other articles. This prevents premature proliferation.
- **References section**: Each topic ends with a `## References` section pointing to source files — research documents, code files, external links that informed the article.

## Implementation

### The librarian: nightly consolidation

A consolidation skill runs nightly and acts as a librarian. It:

1. **Gathers inputs** — new files in `incoming/` (cloud agent outputs, prefetched content), research reports, the day's morning briefing, git log of changes, skill improvement notes
2. **Updates topic articles** — for each substantive input, identifies which topic(s) it relates to, updates those articles in place with new information and fresh wikilinks
3. **Writes the daily narrative** — a reflective entry covering what happened, what was learned, open threads, with liberal wikilinks connecting to the topic graph

The consolidation creates new topics only when needed — the default is to enrich existing articles rather than proliferate files.

### Wiki panel

The web UI provides a browsable wiki panel with:

- **Sidebar**: search (filters by title and content), hierarchical article list (topics alphabetical, daily reverse-chronological), backlinks panel showing what links to the current page
- **Content area**: markdown rendered in an iframe (style isolation), wikilinks intercepted for client-side navigation
- **API**: `/api/wiki` endpoint with index, page, and search actions. Backlinks computed on request from the full file set.

### The narrative-knowledge loop

Daily narratives and topic articles feed each other:

- **Narratives** capture the journey — decisions, dead ends, surprises, the story arc of a day's work
- **Topics** distill reusable facts — the canonical reference for a subject
- **Consolidation** reads narratives and updates topics; future narratives reference topics

This creates a loop: raw inputs → compiled topics → reflective narrative → new inputs tomorrow. The daily narrative is the bridge between ephemeral conversation and durable knowledge.

## Gotchas

- **Backlink computation scales linearly.** Every page view scans all files for wikilinks to the current page. At 50 articles this is instant; at 5,000 you'd want an index. Fine for personal scale.
- **Living documents require judgment.** Updating an article in place means deciding what to keep, what to revise, what to remove. The consolidation agent makes these calls — good enough most of the time, but occasionally overwrites a nuance. Git history is the safety net.
- **Wikilink-to-filename mapping is simple.** `[[topic-name]]` maps to `topics/topic-name.md`. No aliases, no redirects. If you rename a file, you need to update the links. The backlink panel makes finding them easy.
- **Daily narratives are agent-written.** They reflect the consolidation agent's understanding of the day, not the user's. The user reviews them but doesn't typically rewrite. This means the narrative voice is consistent but sometimes misses context the agent didn't have.
