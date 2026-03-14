# Skill System: Extending an AI Agent with Markdown

## Problem

An AI coding agent (like Claude Code, Cursor, or Copilot) is good at general programming but doesn't know your specific workflows — how you verify papers, manage tasks across projects, or audit permissions. You need a way to teach it domain-specific procedures without forking the agent itself.

## Approach

Each skill is a markdown file (`SKILL.md`) that describes a workflow in natural language. The agent reads it when invoked and follows the instructions. Supporting material lives alongside in `references/` (always available for the agent to read) and `scripts/` (CLI tools the agent can call).

```
skills/
  my-skill/
    SKILL.md              # Instructions — the workflow the agent follows
    references/
      methodology.md      # Supporting knowledge the agent can consult
      categories.md       # Lookup tables, classification schemes
    scripts/
      my-tool.py          # CLI tool the agent calls during the workflow
```

The SKILL.md has YAML frontmatter with a name and description (used for discovery), then free-form markdown describing the steps:

```yaml
---
name: my-skill
description: When to use this skill — triggers discovery in the agent
---

# What This Skill Does

## Steps

1. Read references/methodology.md for context
2. Do the thing
3. Call scripts/my-tool.py with the result
```

Skills are re-read on every invocation. Editing a SKILL.md takes effect immediately — no build step, no restart, no cache invalidation.

## Implementation

Skills need to be discoverable by the agent at its expected path, but you want them version-controlled in your project repo. Filesystem junctions (Windows) or symlinks (Unix) solve this — they create a live link so edits in either location are immediately visible.

A sync registry (`sync-config.json`) maps skill names to their targets:

```json
{
  "my-skill": ["global"],
  "project-specific-skill": ["ProjectA", "ProjectB"],
  "third-party-skill": {
    "source": "refs/external-skill",
    "targets": ["global"]
  }
}
```

A sync script reads this registry and creates junctions. It also warns about skills not listed in the config (so new skills don't silently go unsynced).

## Gotchas

- **Discovery is one level only.** The agent scans its skills directory on session start. New skills need a session restart (or a context clear) before they're discoverable by name. Direct file reads work immediately.

- **Reference files are always live.** Unlike the SKILL.md itself, files in `references/` don't need any restart — the agent reads them on demand during the workflow. This makes `references/` the right place for knowledge that evolves frequently.

- **Skills can be self-improving.** A skill's own workflow can include updating its `references/` files based on what it learns. This creates a feedback loop where each invocation potentially improves future invocations.

- **CLI tools need environment setup.** If a skill's script requires a Python venv or specific dependencies, the SKILL.md should document this. The agent doesn't automatically activate environments.

- **Third-party skills work too.** Skills from external repos (cloned into a `refs/` directory) sync the same way as first-party skills. The sync config just needs a `source` field pointing to the external location.
