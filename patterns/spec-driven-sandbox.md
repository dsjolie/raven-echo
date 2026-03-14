# Spec-Driven Sandbox: Permission Boundaries for Autonomous Agents

## Problem

You want to delegate a task to an autonomous AI agent — "review this codebase for tech debt" or "implement this feature" — but you don't want it to have unrestricted access. It should only touch files in an isolated working copy, run only explicitly approved commands, and never modify its own constraints.

## Approach

A three-layer permission system:

1. **Spec** — a markdown document describing the task, acceptance criteria, and constraints
2. **Profile** — a JSON file defining the permission boundaries (what tools, commands, and paths are allowed)
3. **Hook** — a Python script that intercepts every tool call and enforces the profile

The human approves the full permission set before launch. The agent runs in an isolated worktree (a lightweight copy of the repo) and the hook prevents it from escaping.

### Profiles

Three built-in profiles cover common cases:

| Profile | Purpose | Writes | Bash | Web |
|---------|---------|--------|------|-----|
| **dev** | Implementation tasks | Full worktree (except protected files) | Git + task-specific commands | No |
| **research** | Read-only investigation | Output folder only | Git read-only | Yes |
| **review** | Code review, audits | Output folder only | Git diff/log only | No |

Each profile is a JSON file:

```json
{
  "name": "dev",
  "bash_allowlist": ["git status", "git diff", "git add", "git commit", "git log"],
  "web_enabled": false,
  "read_only": false,
  "write_paths": [],
  "protected_patterns": [
    "package.json", "package-lock.json",
    "*.sh", "*.bat", "*.ps1",
    ".eslintrc*", "biome.json",
    ".github/workflows/*",
    ".claude/hooks/*", ".claude/settings*", ".raven-work/*"
  ]
}
```

### Anti-Tamper: If You Can Run It, You Can't Write It

The core security rule: files that define executable behavior are write-protected. When the agent is allowed to run `npm test`, it must not be able to edit `package.json` (which defines what `test` runs), test configuration files, or linter configs. Otherwise it could make its own work pass checks trivially.

This is enforced by the `protected_patterns` list in the profile. The hook checks every Write/Edit call against these patterns and denies matching paths.

## Implementation

The hook script receives structured JSON on stdin for every tool call:

```
{
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.js", "content": "..." },
  "cwd": "/current/directory"
}
```

It loads config by walking up from `cwd` to find `.raven-work/config.json`, then routes by tool type:

- **Write/Edit** — path must be inside worktree, not matching protected patterns, and (if read-only profile) under an allowed write path
- **Read/Glob/Grep** — path must be inside worktree
- **Bash** — command must prefix-match an allowlist entry
- **WebSearch/WebFetch** — only if profile enables web access
- **Agent** — always allowed (subagents inherit the same hook)
- **Everything else** — denied by default

### Trust Boundaries

```
Human (full trust)
  └─ Orchestrator session (interactive, runs the setup skill)
       ├─ Approves permission set
       ├─ Creates worktree + config
       └─ Launches builder agent
            └─ Builder (sandboxed)
                 ├─ Constrained by PreToolUse hook
                 ├─ Can only touch worktree files
                 ├─ Can only run approved commands
                 └─ Cannot modify its own constraints
```

## Gotchas

- **The hook is the security boundary, not the permission mode.** The agent's built-in permission mode (e.g., `acceptEdits`) prevents the agent from asking the user for approval on every file edit. The hook is what actually enforces path restrictions. Both are needed: permission mode for UX, hook for security.

- **Config walk-up.** The hook walks up from `cwd` to find its config, like git finding `.git/`. If the config isn't found, the hook passes through silently — subagents may run from a different working directory where the walk-up can't reach the worktree root.

- **Prefix matching on Bash commands.** `git status` in the allowlist also permits `git status --porcelain`. This is by design (flexibility), but means allowlist entries should be chosen carefully. `rm` in the allowlist would permit `rm -rf /`.

- **Static anti-tamper.** The protected patterns are defined at profile creation time, not dynamically analyzed. If `package.json` has a script that runs `jest --config custom.config.js`, the builder could modify `custom.config.js` because it's not in the protected list. Dynamic analysis of transitive executables is a known limitation.

- **Agent nesting.** You can't launch a headless agent (`claude -p`) from inside another agent session on all platforms. The sandbox setup creates the config and prints the launch command — the user runs it in a separate terminal.
