# Spec-Driven Sandbox: Enforced Permission Boundaries for Autonomous Agents

## Problem

When you give an autonomous agent a task — implement a feature, audit a codebase, write a research summary — you face a gap between what you intend and what you can guarantee. The agent has access to every tool in its session. Instructions in a prompt say what the agent *should* do; nothing prevents it from doing more.

That gap matters for two distinct reasons. First, an agent with good intentions but poor judgment can corrupt files it was never meant to touch, run commands with side effects it didn't anticipate, or pass tests by modifying the tests. Second, even a well-behaved agent can be steered by prompt injection — content in a file or web page that redirects its behavior. If the only boundary is a polite request in the system prompt, there is no real boundary.

The usual responses to this are either coarse (turn off dangerous tools entirely) or incomplete (ask the human to approve every action). What's needed is a way to grant exactly the capability the task requires — no more — and enforce that grant regardless of what the agent reads or is told to do mid-task.

## Approach

The solution separates policy from enforcement, and puts enforcement in code the agent cannot modify.

**Policy lives in data.** A JSON profile declares the permission set for a task category: which commands are approved, whether web access is on, which paths the agent may write to, and which files are protected against any write regardless of other permissions. A human reviews and approves the profile before the agent launches. The profile is static; it cannot change during the run.

**Enforcement lives in a hook.** A `PreToolUse` hook — a script CC executes before every tool call — reads the active config and decides allow or deny. The hook has no interface the agent can address; it reads from `stdin` and writes a JSON decision to `stdout`. The agent sees a denied tool call, not a negotiation.

**Isolation lives in a worktree.** The agent runs in a git worktree: a lightweight, separate working copy of the repository on its own branch. Even without any hook, the worktree limits blast radius. With the hook enforcing path restrictions, the worktree boundary is checked on every file operation.

Three built-in profiles cover the common task shapes, each trading capability for safety:

| Profile | Bash | File writes | Web |
|---------|------|-------------|-----|
| `dev` | git read/write + task-specific extras | Anywhere in worktree (anti-tamper excepted) | Off |
| `research` | git read-only | Designated output folder only | On |
| `review` | git diff/log | Designated output folder only | Off |

The key structural decision is that profiles are the mechanism for adding capability, not for reducing it from a default-permissive state. The baseline is deny-everything; a profile is an explicit grant.

## Implementation

The hook script (`skills/raven-work/scripts/sandbox-hook.py`) handles the CC `PreToolUse` protocol directly: reads JSON from `stdin`, exits `0` with `{"permissionDecision": "allow"}` or exits `2` with `{"permissionDecision": "deny", "reason": "..."}`.

Config is loaded by walking up from the agent's `cwd` until `.raven-work/config.json` is found — the same discovery pattern git uses for `.git/`. If no config is found, the hook passes through silently, which handles the case where a subagent spawned by the builder runs from a different directory.

Routing by tool type:

```python
if tool_name in ("Write", "Edit"):
    check_file_write(tool_input, config, cwd)
elif tool_name in ("Read", "Glob", "Grep"):
    check_file_read(tool_input, config, cwd)
elif tool_name == "Bash":
    check_bash(tool_input, config)
elif tool_name in ("WebSearch", "WebFetch"):
    check_web(config)
elif tool_name == "Agent":
    allow()   # subagents inherit the same hook
else:
    deny(f"tool not allowed: {tool_name}")
```

The default-deny `else` branch matters: any tool not explicitly categorized is blocked. New tools added in a future CC version don't become silently available.

**Anti-tamper: if you can run it, you can't write it.** This is the non-obvious security requirement. When a profile grants `npm test`, the agent can verify its own work by running tests — but if it can also write `package.json`, it can redefine what `npm test` runs. If it can write test files, it can make tests pass trivially. The `protected_patterns` list in each profile blocks writes to files that define or configure anything the agent can execute: build manifests, shell scripts, linter configs, CI definitions, and — critically — the sandbox config and hook files themselves.

```json
"protected_patterns": [
  "package.json", "package-lock.json",
  "*.sh", "*.bat", "*.ps1",
  "Makefile", "Justfile",
  "pyproject.toml", "setup.py",
  ".eslintrc*", "biome.json", ".ruff.toml",
  ".github/workflows/*",
  ".claude/hooks/*", ".claude/settings*",
  ".raven-work/*"
]
```

The last two entries — hook config and sandbox metadata — close the self-escape loop: the agent cannot modify the rules it is running under.

For read-only profiles (`research`, `review`), an additional check restricts all writes to a specific output folder. The agent can read anything in the worktree but can only write to, say, `docs/research/`. This models the real task shape: the agent is an analyst, not an editor.

Path resolution uses `Path.resolve()` to normalize symlinks and `..` components before comparing against the worktree root. All comparisons normalize to forward slashes and lowercase to handle Windows path variants.

## Gotchas

**The hook is the real boundary; the permission mode is UX.** CC's `--permission-mode acceptEdits` suppresses the per-edit approval prompt so the agent can run unattended. It does not restrict what the agent can edit. Conversely, the hook enforces path and command restrictions but doesn't present a user-visible dialog. Both layers are needed for different reasons — confusing them leads to thinking one is redundant.

**Prefix matching is intentional but sharp.** Bash allowlist entries match by prefix: `git status` also permits `git status --porcelain`. This is the right trade-off for ergonomics — you don't enumerate every flag combination — but it means allowlist entries must be chosen carefully at the command boundary. `git` as an entry would permit `git push --force`.

**Subagent cwd drift.** When the builder spawns a subagent via the `Agent` tool, the subagent may have a different `cwd`. The walk-up config discovery handles most cases, but if the subagent's starting directory is on a completely different path, the config won't be found and the hook passes through. For sensitive profiles, this is worth understanding: subagents effectively run without the sandbox if the walk-up fails.

**Static anti-tamper has a transitive blind spot.** The protected patterns guard known config files. They don't dynamically analyze what scripts reference. If `package.json`'s `test` script runs `jest --config jest.config.js`, and `jest.config.js` is not in the protected list, the agent could modify it. The pattern is a substantial improvement over no protection, but it isn't a formal proof of tamper-resistance.

**You cannot launch headless agents from inside an agent session on all platforms.** The setup workflow creates the worktree, generates the config, and prints the launch command — the user runs it in a separate terminal. This is a known CC platform constraint, not a design choice. It also doubles as a natural human checkpoint: the user must explicitly start the sandboxed run.
