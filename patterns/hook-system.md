# Hook System: Agent Lifecycle Events as Extension Points

## Problem

An AI coding agent runs in a terminal, making tool calls (file edits, shell commands, web searches). You want to react to these events — notify a web UI when the agent starts, enforce permission boundaries during sandboxed work, catch common mistakes before they trigger permission prompts. But you don't control the agent's source code.

## Approach

Claude Code fires shell commands on lifecycle events: session start, session stop, tool use requests, and more. Each hook receives structured JSON on stdin and communicates through exit codes:

- **Exit 0** — success (for notification hooks) or allow (for permission hooks)
- **Exit 1** — fall through to normal behavior (for permission hooks that just want to observe)
- **Exit 2** — deny with a reason (for permission enforcement hooks)

This creates three distinct hook complexity levels:

### Notification Hooks (fire-and-forget)

Lightweight scripts that inform external systems about agent events without affecting the agent's behavior. They receive event data, send it somewhere, and exit.

```javascript
// Simplified notification hook
const event = process.argv[2]; // 'session-start', 'stop', 'permission'
const data = JSON.parse(readStdin());

// Send to web UI, exit immediately
http.post('/api/hook', { terminal: terminalId, event, data });
process.exit(event === 'permission' ? 1 : 0);
// permission hooks exit 1 to fall through to normal dialog
// other hooks exit 0 (exit 1 would show a warning)
```

### Guard Hooks (guidance + gating)

Mid-weight scripts that intercept all tool calls, read external state (a mode file) on each invocation, and either pass through or block with guidance. The key difference from permission enforcement: guards teach the agent to avoid problematic patterns rather than just blocking them.

```javascript
// Read mode fresh on every invocation — no daemon, no cache
let mode = 'default';
try { mode = fs.readFileSync(MODE_FILE, 'utf8').trim(); } catch {}
if (mode === 'off') process.exit(0);

// Tier 1: Always-on guidance (catch permission-triggering patterns)
if (/\bcd\s+\S+\s*&&/.test(cmd)) {
  block('Use relative paths, or run cd and the command as separate calls.');
}

// Tier 2: Away mode (block tools that need permission)
if (mode === 'away' && BLOCKED_TOOLS.has(toolName)) {
  block(`${toolName} is blocked while the user is away. Use built-in tools.`);
}
```

The mode file approach means the hook's behavior can be changed at runtime — toggle between default, away, and off — without restarting the agent or touching the settings.

### Permission Enforcement Hooks (PreToolUse)

Heavier scripts that intercept tool calls and decide whether to allow them based on a security policy. They read the tool name and input, check against a policy, and exit with 0 (allow) or 2 (deny + reason).

```python
# Simplified permission hook
hook_input = json.loads(sys.stdin.read())
tool_name = hook_input["tool_name"]
tool_input = hook_input["tool_input"]

if tool_name == "Bash":
    command = tool_input.get("command", "")
    if not any(command.startswith(p) for p in allowlist):
        deny(f"command not in allowlist: {command.split()[0]}")
    allow()
```

## Implementation

Hooks are configured in the agent's settings file with a matcher-based format:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "node hooks/notify-hook.js session-start"
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "node hooks/raven-guard.js"
        }]
      },
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "python sandbox-hook.py"
        }]
      }
    ]
  }
}
```

The `matcher` field filters which tools the hook applies to. An empty string or `*` matches everything. Specific tool names (e.g., `"Bash"`) narrow the scope. Multiple PreToolUse hooks run in order — the guard catches common patterns, then the sandbox enforces worktree boundaries.

## Gotchas

- **Settings format is strict.** The hook configuration format has changed across agent versions. An incorrectly structured settings file doesn't produce a parse error — the agent silently ignores the entire settings file. Validate the format before deploying.

- **Environment variables for routing.** If multiple terminals share a web UI, hooks need to know which terminal they're running in. Set a terminal-specific environment variable (e.g., `RAVEN_TERMINAL_ID`) when spawning the terminal, and read it in the hook.

- **Hooks must be fast.** Every hook adds latency to the agent's tool calls. Notification hooks should fire-and-forget (send HTTP request, don't wait for response beyond a short timeout). Guard hooks should read only local files — no network calls. Permission hooks should avoid network calls too.

- **File-based state is the simplest runtime toggle.** A text file read on each invocation is simpler than environment variables (set at spawn, can't change), IPC (needs a daemon), or API calls (needs network). The cost is one `readFileSync` per tool call — negligible.

- **Config walk-up for sandboxed work.** Permission hooks in a sandboxed worktree need to find their config file. Walk up from `cwd` looking for `.raven-work/config.json`, similar to how git finds `.git/`. If not found, pass through silently — subagents may run from a different working directory.

- **Subagents inherit hooks.** When the agent spawns subagents, they run under the same hook configuration. This is usually what you want for permission enforcement (the sandbox applies to subagents too) and notification (you want to know about subagent events). The Agent tool itself should be allowed through the permission hook so subagent spawning works.
