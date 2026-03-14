# Echo Generation: Shareable Knowledge from a Private Repo

## Problem

You have a private project with interesting solutions, architecture decisions, and hard-won edge-case fixes. You want to share this knowledge with colleagues and friends — but the repo also contains personal data, project-specific configuration, memory files, and task lists that shouldn't leave your machine.

The options aren't great:
- **Share the repo** — exposes everything, requires cleanup, and couples the recipient to your specific implementation
- **Write a blog post** — high effort, goes stale, covers only a fraction of what's interesting
- **Write documentation** — manual curation, constantly out of date

You want something in between: a comprehensive extract that stays current with the project, is safe to share, and is useful to both humans and AI agents.

## Approach

An AI skill reads the live project and **writes fresh descriptions** of its architecture, patterns, and solutions. The output goes to a separate, public repository. The key design decisions:

### Generate, don't filter

The skill doesn't copy existing documents and strip private information. It reads the source code, docs, and configuration, then writes new prose describing what the system does and why. This eliminates the risk of leaking something — there's no private text to accidentally include.

### Scripts must be clean at source

Scripts that are candidates for verbatim inclusion get a specifics check: grep for hardcoded paths, usernames, machine-specific references. If any are found, the script is **not copied** and the failure is reported. The fix happens at the source — parameterize the script — not in the echo generator. This follows the "surface errors, don't swallow them" principle.

### Separate repository

The output lives in its own git repo, decoupled from the private project. You commit and push when you're satisfied with a generation. The private repo's git history, branches, and working state are never exposed.

### Regeneration over maintenance

Each run produces a complete fresh set. There's no incremental update or diff — the AI reads the current project state and writes the current echo. This means the echo naturally reflects the project's evolution without manual maintenance. The trade-off: you lose git-level history of how the echo changed over time (though the output repo has its own commits).

## Implementation

The generator is structured as an AI skill with three phases:

**Phase 1 — Survey.** Read a source map that lists which project files feed each output document. Build understanding before writing.

**Phase 2 — Generate.** Write each output document in order: README, architecture, principles, patterns, solutions. Each document is written after reading only the sources relevant to it (context management — don't load everything at once).

**Phase 3 — Verify scripts.** Check candidates for hardcoded specifics. Copy clean scripts verbatim. Report dirty ones as errors.

### Source map

A reference document maps output files to input sources:

```
For architecture.md, read:
  - CLAUDE.md (project overview)
  - server.js (first 80 lines for structure)
  - lib/ (list files, read headers)
  - Key skill files (for extension architecture)

For solutions/pty-line-endings.md, read:
  - terminals.js (where the fix lives)
  - Memory notes (context on why this was tricky)
```

This prevents the AI from wandering through the repo and keeps context focused.

### Output structure

```
echo-repo/
  README.md              # Entry point — what this is, contents, how to use it
  architecture.md        # System design, component relationships
  principles.md          # Design philosophy with examples
  patterns/              # Reusable approaches (one file each)
  solutions/             # Edge-case fixes (one file each)
  scripts/               # Verbatim clean scripts
```

### Writing guidelines

The generator follows explicit rules:
- **Focus on why**, not just what — the decision and reasoning matter more than the implementation
- **Generalize** — describe patterns in terms that apply beyond this specific project
- **No private content** — no names, usernames, institutions, absolute paths, or personal data
- **Code snippets over full files** — short, illustrative, with enough context to understand

## Gotchas

- **Context pressure.** The survey phase reads many files. Reading everything at once fills the AI's context before generation starts. The source map enables reading per-document, keeping context manageable.

- **Non-determinism is a feature.** Two runs may describe the same thing differently. This is fine — the latest run reflects the latest understanding. The output is a snapshot, not a maintained document.

- **Scope creep.** The temptation is to extract everything. Not every function and file is interesting. The source map and writing guidelines emphasize selectivity — only patterns and solutions that are genuinely non-obvious.

- **The echo is not documentation.** It doesn't replace internal docs, READMEs, or code comments. It's a curated external view — what's worth sharing, written for an outside audience.

## Why "Echo"

An echo is a recognizable reflection that travels to others. It's not the original — it's shaped by the space it passes through, simplified by distance, but faithful enough to carry the essential signal. It naturally updates when you call again.
