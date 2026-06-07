# Skill System: Teaching Domain Workflows to a General-Purpose Agent

## Problem

A general-purpose AI coding agent handles breadth well — it can read unfamiliar code, run tests, and search the web — but it has no knowledge of your specific workflows. It doesn't know how your task system is structured, what guardrails you want during unattended runs, or how your project verification process works. You need to encode that knowledge somewhere the agent can find it without forking the agent itself or maintaining a prompt-injection wrapper around every session.

The secondary problem is deployment: the knowledge has to live in one canonical place (your project repo, under version control) while being accessible where the agent looks for it (a global skills directory). Any approach that requires a manual copy step means the two drift apart.

## Approach

Each skill is a directory containing a `SKILL.md` — a markdown file with YAML frontmatter and free-form natural-language instructions. The agent reads it when invoked and follows the workflow it describes. Supporting material lives in the same directory:

```
skills/
  my-skill/
    SKILL.md              # Workflow instructions, frontmatter with name + description
    improvements.md       # Dated one-liners noting gaps observed during invocation
    references/
      methodology.md      # Supporting knowledge the agent consults mid-workflow
      task-format.md      # Lookup tables, schemas, classification conventions
    scripts/
      my-tool             # CLI wrapper (handles venv activation, cross-platform paths)
      my-tool.py          # Actual implementation
```

The frontmatter `description` field is what triggers discovery — the agent matches it against the user's request at invocation time:

```yaml
---
name: my-skill
description: Brief statement of when to invoke this — what the user says that should trigger it
---
```

Because SKILL.md is re-read on every invocation, edits take effect immediately. There is no compilation, no cache invalidation, no restart. This matters: it makes the skill system a live document, not a build artifact.

The `references/` subdirectory holds supporting knowledge the agent reads *during* the workflow — lookup tables, format specifications, examples. These are also live: the agent fetches them on demand, so they can be updated between invocations without any sync step. This makes `references/` the right home for frequently-evolving knowledge that the SKILL.md itself would bloat if inlined.

The `scripts/` subdirectory holds CLI tools. The SKILL.md refers to them by relative path (`<base-dir>/scripts/my-tool`). This decoupling matters: the agent calls the CLI tool as an opaque command; the CLI tool handles environment setup, cross-platform quirks, and output formatting. The skill instructs; the tool executes.

A skill may also maintain an `improvements.md` file — a dated one-liner log of gaps noticed during invocation. This gives the system a lightweight self-improvement loop: observations accumulate in a low-friction format, and a maintenance pass later promotes them to actual changes. The instruction to append a one-liner appears at the end of each SKILL.md, making the feedback mechanism self-documenting.

## Implementation

Skills live in `skills/<name>/` in the project repo. The agent discovers skills at `~/.claude/skills/` (the global skills directory). The problem of keeping one copy is solved with filesystem junctions (Windows) or symlinks (Unix/macOS): the junction is a live link, not a copy. Any edit to the source is immediately reflected at the link target. No sync step required after setup.

A registry file (`skills/sync-config.json`) maps skill names to their deployment targets:

```json
{
  "my-skill": ["global"],
  "project-only-skill": ["project-shorthand"],
  "known-but-undeployed": [],
  "third-party-skill": {
    "source": "refs/external-skill-repo",
    "targets": ["global"]
  }
}
```

Four cases:

1. `["global"]` — the skill goes to `~/.claude/skills/`, available in every session.
2. `["shorthand"]` — the skill goes to `<project-path>/.claude/skills/`, available only in that project.
3. `[]` — the skill is known but deliberately not deployed; the entry suppresses a "not in config" warning.
4. Object with `source` + `targets` — a third-party skill cloned into `refs/` and junctioned from there. Same mechanism, external source.

The sync script (`skills/raven-dev/scripts/sync-skills.py`) reads the registry, resolves project paths from a central `projects.json`, creates junctions, and warns about skills present in `skills/` but absent from the config. The warning on unlisted skills is important: without it, a newly created skill silently goes undeployed and the developer doesn't notice until much later.

The `--clean` flag removes stale junctions — links that once existed in the config but no longer do. Safety constraint: the script only removes links that point back into the project repo. External junctions are untouched.

Path resolution is done relative to the script's own location (`Path(__file__).resolve().parent.parent.parent.parent`), so no absolute paths are hardcoded. The script works correctly after a repo clone to a new machine or path.

## Gotchas

**Discovery is session-scoped, not file-scoped.** The agent scans its skills directory at session start. A newly junctioned skill won't be available by name until the session is restarted. This is a Claude Code constraint, not a design choice. A workaround: the agent can read a SKILL.md directly with its path even before the skill is formally discovered — useful when bootstrapping.

**CLI tools should be self-contained wrappers.** A skill script referenced as `<base-dir>/scripts/my-tool` needs to handle its own environment setup. If it requires a Python venv, the wrapper script activates it; the SKILL.md doesn't try to emit activation commands into the shell. This keeps the agent's Bash invocations simple (no compound `&&` chains, no `source` calls) and avoids triggering permission prompts on patterns the security layer watches for.

**SKILL.md instructions are prompts, not code.** Their effect depends on how precisely they're written. Ambiguous instructions produce inconsistent agent behavior across invocations. Instructions that say "do X, then Y" are more reliable than instructions that say "handle the situation appropriately." Concrete examples inline are worth the extra lines.

**Third-party skills need a `refs/` clone, not a subtree.** The junction mechanism expects a local directory. The workflow for adding an external skill is: clone it into `refs/` (gitignored), add the registry entry with `source` pointing to the `refs/` path, run the sync script. The clone in `refs/` can be updated independently without affecting the registry.

**Improvements.md is a signal buffer, not a changelog.** It's meant to be low-friction — append a one-liner during invocation, don't stop to edit. A separate maintenance pass reviews it and promotes findings into actual changes. Conflating the two (editing the skill in-flight to fix something noticed mid-task) risks corrupting a live invocation.
