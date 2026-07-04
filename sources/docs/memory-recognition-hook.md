# Recognition Hook: Design

A CC hook that provides recognition-gated memory retrieval by injecting relevant memory keywords into the prompt before the model sees it.

## Core Concept

The hook intercepts every user prompt (`UserPromptSubmit`), scans it against a database of **recognition keywords** (many variants of known concepts), maps matches to **memory keywords** (canonical terms that exist in memory files), and injects those memory keywords into the prompt. The model then decides whether to retrieve details.

This implements the recognition/retrieval separation from dual-process memory theory: recognition ("I know something about this") is fast and automatic; retrieval ("here are the details") is deliberate and on-demand.

## Three-Step Pipeline

```
User prompt
    │
    ▼
Step 1: Recognition (hook, programmatic)
    Scan prompt against recognition keywords.
    Many variants per concept, brute force substring matching.
    "line endings" → match, "compose" → match
    │
    ▼
Step 2: Memory keyword lookup (hook, programmatic)
    Map matched recognition keywords to canonical memory keywords.
    "line endings" → PTY line endings
    "compose" → compose popup
    Deduplicate. Apply per-keyword cap.
    │
    ▼
Step 3: Injection
    Output memory keywords to stdout.
    CC injects as <user-prompt-submit-hook> content.
    Model sees keywords, decides whether to grep/read.
```

Steps 1 and 2 both happen in the hook — no LLM involved. Step 3 is the model doing what models do: deciding whether the hint is relevant and acting on it.

## Hook Output Format

Clean list of memory keywords. No descriptions, no elaborations. The model already knows memory lives in `memory/` and MEMORY.md.

**Simple case** (few matches):
```
Memory keywords: PTY line endings, compose popup
```

**Rich case** (many matches, showing importance through footprint):
```
Memory keywords: PTY line endings, compose popup, send \r pattern, web-ui terminals
```

**Capped case** (per-keyword limit exceeded):
```
Memory keywords: PTY line endings, compose popup, send \r pattern, scroll preservation, terminal ID type gotcha (7 more on "terminal")
```

### What the output signals

- **Number of keywords** = memory footprint = implicit importance. Four keywords lighting up means "you know a lot about this intersection." One keyword means "small note, maybe worth a quick check."
- **Overflow notes** = deep topic. The count tells the model how much more is available.
- **No matches** = nothing injected. The hook is silent, the model proceeds normally.

## Per-Keyword Cap

Configurable limit (start with 5) on how many memory keywords are included per recognition keyword. When exceeded:

- Show top N memory keywords (ordering TBD — could be alphabetical, or by number of recognition variants matched)
- Append: `(M more on "recognition keyword")`
- The model can investigate further if curious, by searching memory files directly

The cap is per recognition keyword, not global. A prompt mentioning both "terminal" and "caching" gets up to 5 for each — the clusters are independent.

## Recognition Database

### Structure

Many-to-one mapping: many recognition keywords → one memory keyword.

```
┌─────────────────────────┐         ┌──────────────────────┐
│ Recognition keywords    │         │ Memory keywords      │
│ (match against prompt)  │         │ (grep against files) │
├─────────────────────────┤         ├──────────────────────┤
│ line endings            │───┐     │                      │
│ \r\n                    │───┼────▶│ PTY line endings     │
│ CRLF                    │───┤     │                      │
│ carriage return         │───┘     │                      │
│                         │         │                      │
│ compose                 │───┐     │                      │
│ bottom sheet            │───┼────▶│ compose popup        │
│ mobile input            │───┘     │                      │
│                         │         │                      │
│ cache miss              │───┐     │                      │
│ TTL                     │───┼────▶│ prompt caching       │
│ prefix matching         │───┤     │                      │
│ cached tokens           │───┘     │                      │
└─────────────────────────┘         └──────────────────────┘
```

### Storage

Recognition keywords and memory keywords must not be mixed in a way that pollutes matching. How they're separated is an implementation detail — options include:

1. **Grouped text file** (INI-style): headings are memory keywords, items are recognition variants. Simple, human-readable, version-controllable.
   ```
   [PTY line endings]
   line endings
   \r\n
   CRLF
   carriage return
   newline

   [compose popup]
   compose
   bottom sheet
   mobile input
   text input popup
   ```

2. **JSON**: natural separation of fields. Slightly harder to hand-edit.
   ```json
   [
     {
       "memory_keyword": "PTY line endings",
       "variants": ["line endings", "\\r\\n", "CRLF", "carriage return", "newline"]
     }
   ]
   ```

3. **SQLite**: cleanest separation, queryable, but heavier infrastructure for what may be a small dataset.

Start with whichever feels simplest to read and edit. The hook script just needs to load it and scan.

### Variant Generation

Variants are generated at **write time** by `raven-reflect` (or a similar consolidation process). The reflect step already uses an LLM, so generating good variants is essentially free — ask it to produce terms, synonyms, abbreviations, and related phrases that a user might naturally use when talking about the concept.

This is the "bitter lesson" in action: invest computation at write time (LLM generates many variants) so that read time stays simple (substring scan). The recognition database grows with each reflect session — scaling with data, not engineering.

### Importance Through Coverage

No explicit importance weights. Importance emerges from the data:

- **More recognition variants per memory keyword** = higher probability of matching = more "recognizable" concept
- **More memory keywords matching a prompt** = larger memory footprint = the model sees it's a well-known area
- **Overflow caps triggering** = explicit signal of depth

Important topics naturally accumulate more variants across reflect sessions. A one-off note gets 2 variants; a core architectural concept gets 20. This is not designed — it emerges from how memory is used and consolidated.

## Write Path: raven-reflect

When reflect consolidates a session, it:

1. Writes/updates topic files in `memory/` (existing behavior)
2. **Updates the recognition database** — adds new memory keywords, generates recognition variants for new and updated concepts, prunes entries for deleted or superseded knowledge

The paper's concept of "consolidation produces recognition traces as distinct output" is this, literally. Reflect doesn't just store knowledge — it also maintains the vocabulary of what's recognizable.

## Relationship to MEMORY.md

MEMORY.md is loaded into the system prompt on every session. It provides baseline context — the model always has it. The recognition hook extends beyond this:

- **MEMORY.md** = always present, costs system prompt tokens, limited to ~200 lines
- **Recognition hook** = activated only when relevant, injects only keywords (minimal tokens), unbounded size

Over time, MEMORY.md could become leaner (project overview, core conventions) while the recognition database carries the full vocabulary of known concepts. They're complementary, not competing.

## Retrieval Complement: raven-memory Skill

The recognition hook is one half of the system — it makes the agent aware of what it *could* retrieve. The other half is giving the agent tools and instructions to actually retrieve it.

This could be as simple as a `raven-memory` skill that tells the agent: "memory lives in `memory/` as text files, here are the memory keywords you can grep for, go look if you want." The agent already has grep and read tools — no special retrieval infrastructure needed. The skill provides the **instructions and context**, not new tools.

Over time the skill could grow to include:
- Structured search across the recognition database itself (e.g., exploring what's available on "terminal" when the hook showed an overflow)
- Memory keyword listing / browsing
- Writing back to memory (observations, corrections) outside of full reflect sessions

The key design principle: **the hook makes the agent aware, the skill makes it capable, the agent decides whether to act.** Neither the hook nor the skill forces retrieval — they create the conditions for the agent to make good decisions about when memory is worth loading.

## Implementation Notes

- **Hook type**: `UserPromptSubmit` command hook
- **Hook script**: a small script (Python or Node) that loads the recognition database, scans the prompt, outputs matching memory keywords
- **Latency**: substring scanning a text file is sub-millisecond. The hook adds negligible delay.
- **Failure mode**: if the hook fails, CC proceeds normally — no recognition, but no breakage. Graceful degradation.
- **Location**: `web-ui/hooks/` (alongside existing `notify-hook.js`) or `skills/raven-dev/scripts/` — TBD based on where it fits best

## Open Questions

1. **Matching strategy**: case-insensitive substring? Word-boundary matching? Start with case-insensitive substring and tighten if false positives are a problem.
2. **Ordering within cap**: when capping at 5, which memory keywords are shown? Most-variants-matched? Alphabetical? Most recently updated?
3. **Generic terms**: "terminal", "file", "error" might match too broadly. Options: minimum variant match count as threshold, or a stoplist. Defer until real false positive data exists.
4. **Database location**: in-repo `memory/.recognition-db` (versioned) or in CC project memory (local)? Same considerations as topic file location.
5. **Hook scope**: should this fire for ALL CC sessions, or only Raven project sessions? Could gate on working directory or a flag.

---

*Created: 2026-02-17*
*Status: Design — emerged from discussion, not yet implemented*
*Depends on: memory architecture Phase 1 (structured reflect)*
*Prior art survey: [`docs/research/recognition-hook-prior-art.md`](research/recognition-hook-prior-art.md)*
*Implementation plan: [`docs/raven-memory-skill-plan.md`](raven-memory-skill-plan.md)*
