# Echo Generation: Publishing Knowledge from a Private Repo

## Problem

Private projects accumulate genuinely useful knowledge: architectural decisions with real rationale, edge-case fixes that took hours to find, patterns that work for non-obvious reasons. Most of it never leaves the machine.

The conventional escape routes are costly. Copying the repo and manually redacting private data is error-prone — one missed reference exposes something it shouldn't, and the redacted copy immediately diverges from the source. Writing documentation by hand is slow and drifts out of date as the project evolves. Publishing individual blog posts captures only what you chose to write about on that particular day.

The deeper problem: filtering a private document to make it public requires you to know exactly what's private. That knowledge is usually implicit. An automated sanitizer makes guesses; guesses leak.

## Approach

Instead of filtering a copy of the source, generate fresh descriptions from the source into a separate public repository. The generator reads the live project — code, configuration, skills — and writes new prose describing what exists and why. No private text is ever copied, so nothing private can be accidentally included.

This is the central design decision: **generate, don't filter**. It means the output is always new writing, not a transformed version of internal docs. The generator acts as a reader and writer, not a redactor.

Two supporting artifacts define how generation works:

**A source map** specifies, for each output document, exactly which project files to read. This prevents the generator from loading the entire repo into context at once (which would exhaust the AI's working memory before writing started), and it enforces scope — the generator doesn't wander.

**An output guide** sets the voice and privacy rules that apply to all generated content: what to include (relative repo paths, technical detail, short illustrative code), what to exclude (names, absolute paths, personal data, content from memory/task files), and how to write (focus on why, generalize beyond the specific project, no hedging).

The output goes to a separate git repository. The private repo's history, branches, and working state are never visible. Each full run regenerates the complete set — there is no incremental patch, no diff to maintain. The echo reflects the current project state on each invocation.

### Scripts: copy clean or report dirty

Scripts are the one category where the generator may include verbatim content. Before copying any script, it checks for *specifics*: hardcoded absolute paths, personal usernames, machine-specific identifiers, project-specific values that aren't parameterized.

If the script is clean, it is copied verbatim with no modifications.

If specifics are found, the script is **not copied**. The generator reports the exact lines that failed the check. The fix belongs at the source — parameterize the script, then re-run the echo. Auto-sanitizing is explicitly prohibited: a sanitizer that removes the offending line hides the fact that the script wasn't properly written for portability in the first place.

This discipline keeps the echo honest. A script that appears in the output is genuinely reusable; a script that fails the check gets fixed at source rather than patched in transit.

## Implementation

The skill runs in four phases:

**Survey.** Read the source map to understand which files feed which output documents. Read selectively — only enough to build a working model of the project before writing begins.

**Generate.** Write each output document in dependency order: README and architecture first (no dependencies), then principles, then patterns and solutions (which can reference earlier docs). For each document, read only the sources listed in the source map for that document, write it, then move on. This keeps context pressure manageable.

**Visual overview.** Update a standalone HTML page that serves as the visual entry point — architecture diagram, cards linking to every pattern and solution, principles summary. This page can be hosted as a GitHub Pages site directly from the output repo.

**Script verification.** Check each script candidate against the specifics rules. Copy clean ones verbatim; report dirty ones with the failing lines.

### Source map structure

The source map is a Markdown file in the skill's `references/` directory. Each output document gets its own section listing the input files and the key ideas to extract:

```
## patterns/hook-system.md
- web-ui/hooks/notify-hook.js      # simple hook example
- web-ui/hooks/raven-guard.js      # complex hook with mode-based gating
- web-ui/hooks/gitlock-nudge.js    # advisory PostToolUse example

Key ideas: exit-code API (0/1/2), external state read at invocation time,
matcher-based config format, behavior guidance messages to the model.
```

This makes the scope explicit and reviewable. If a new pattern is added to the project, you add a section to the source map and the next echo run picks it up.

### Output structure

```
echo-repo/
  README.md          # entry point, contents, about this repo
  architecture.md    # system design and component relationships
  principles.md      # design philosophy with concrete examples
  history.md         # project timeline, pivots, abandoned approaches
  patterns/          # reusable patterns (one file each)
  solutions/         # edge-case fixes (one file each)
  scripts/           # verbatim clean scripts
  overview.html      # visual companion, GitHub Pages landing
```

Each pattern and solution file follows the same structure: Problem, Approach, Implementation, Gotchas.

### Self-reference

This file is itself an echo output. The echo system describes how it generates the echo. The source map lists `skills/raven-echo/SKILL.md`, `skills/raven-echo/references/source-map.md`, and `skills/raven-echo/references/output-guide.md` as the inputs for this document. Reading those three files is sufficient to reconstruct the full generation workflow.

## Gotchas

**Context scales with project size.** A large project has many source map entries. The per-document reading strategy keeps individual reads manageable, but a single session may not be able to cover the full output set. The skill notes this: split large runs across sessions, writing architecture and principles first, then patterns and solutions.

**Non-determinism is acceptable here.** Two generation runs of the same file may phrase things differently. This is a property of AI-generated text, not a defect. The output is a snapshot of current understanding, not a document with a canonical form. The output repo's git log records the history of snapshots.

**The output guide must be specific about privacy.** Vague privacy rules ("don't include personal information") produce inconsistent results. The output guide names exactly what to exclude — names, usernames, absolute paths, memory file content, task lists — and exactly what to include — relative repo paths, technical detail, short illustrative snippets. Specificity makes the rules checkable.

**Echo is not documentation.** It doesn't replace internal READMEs, code comments, or design docs. It's a curated external-facing view, written for builders of similar systems who want to understand what's interesting and why. Internal documentation explains the what; the echo explains the why in terms that generalize.

**Scope discipline requires active enforcement.** The source map and output guide define scope, but the generator still needs to apply judgment about what is genuinely non-obvious. Routine CRUD endpoints, standard configuration boilerplate, and project-specific implementation details without transferable decisions don't belong in the echo. The test: would a builder of a different agent extension recognize this as a pattern worth knowing?

## Relationship to Spec-Driven Development

The SDD movement (GitHub Spec Kit, Tessl, AWS Kiro) treats specifications as the primary artifact and code as generated output. The echo pattern sits in adjacent territory: it treats knowledge descriptions as primary artifacts and generates them from code.

Where SDD shares intent so others can regenerate an equivalent implementation, the echo shares understanding so others can recognize patterns and adapt them. The two approaches are complementary — a project could maintain both a spec repo (for reproducible implementation) and an echo repo (for transferable knowledge).

The echo is closer to a "prompt repo" in the SDD taxonomy: structured descriptions of what exists, written in natural language, organized for an AI reader as much as a human one. An agent reading `patterns/hook-system.md` has enough information to implement an equivalent hook system in a different project without access to the source.
