# Raven

Personal AI assistant agent.

## Project Overview

Raven extends Claude Code with skills, CLI tools, and a web UI — not a competing agent framework. CC improvements (models, tools, context) come for free.

## Development Guidelines

1. **Modularity** - Keep components loosely coupled and independently testable
2. **Privacy-first** - User data stays local; external API calls should be opt-in and transparent
3. **Graceful degradation** - Features should fail gracefully when dependencies are unavailable
4. **Clear logging** - Log decisions and actions for debugging and transparency

## Architecture

Flat structure — each top-level directory is an independent component.

```
skills/             # CC skills (SKILL.md + references/), synced via junctions
web-ui/             # Browser-based workspace (Node.js, xterm.js, panel system)
docs/               # Research, architecture notes, design docs
refs/               # Reference projects (gitignored, cloned repos for inspiration)
archive/            # Stale docs, notes, and material kept for reference
```

## Reference Projects

The `refs/` directory (gitignored) holds cloned repos for inspiration and temporary use. Not dependencies — learning material and scaffolding.

## Tech Stack

- **web-ui**: Node.js, xterm.js, node-pty, ws
- **skills**: Markdown (SKILL.md) + Python/Bash CLI tools
- Package management: uv (Python) / npm (Node.js)

## Getting Started

```bash
# Web UI
cd web-ui && npm install && node server.js
# Opens at http://localhost:3000

# Python venv (when needed)
source ./activate_venv.sh  # Git Bash
uv pip install -r requirements.txt
```

## Conventions

- Type hints / strict types throughout
- Tests in `tests/` mirroring source structure
- Config via environment variables or `config/` files

## Skill Conventions

- **visual-explainer**: Save output to `docs/diagrams/`, not `~/.agent/diagrams/`
- **Improvement notes**: If something doesn't work well during a skill invocation, append a dated one-liner to `improvements.md` in that skill's directory. If a skill's tools don't provide what you need, note it there — don't work around the tool with Grep/Glob/Read. The tools should be sufficient; if they're not, that's an improvement to log.

## Project Knowledge

These terms have detailed context in `docs/` and `docs/research/`. Search before asking.

OpenClaw, Pi, Steinberger, MCPorter, Synchronized Intelligence, ACE, A-MEM, Zettelkasten, MemAgents, ENGRAM, Memento 2, HiMem

## Bare URL = Auto Task

When the user posts a URL with no further instruction, add it as an `#auto` task to the Raven tasks (`rtasks add raven "Read <url> #auto"`). The cloud agent picks these up overnight and should:

- Read and research the content
- Consider where it fits in ongoing work (papers, docs, projects)
- Write a report to `docs/reports/`
- Create a visual explainer if the content warrants it
- Add to the reading panel if it's a keeper
- Note findings for upcoming morning briefings

## Current Status

Skills system working. Web UI working, evolved as needed. Memory architecture researched, implementation next.
