# Hook System: Agent Lifecycle Events as Extension Points

## Problem

An AI coding agent runs in a terminal, making tool calls (file edits, shell commands, web searches). You want to react to these events — notify a web UI when the agent starts, enforce permission boundaries during sandboxed work, detect when the agent is waiting for input. But you don't control the agent's source code.

## Approach

Claude Code fires shell commands on lifecycle events: session start, session stop, tool use requests, and more. Each hook receives structured JSON on stdin and communicates through exit codes:

- **Exit 0** — success (for notification hooks) or allow (for permission hooks)
- **Exit 1** — fall through to normal behavior (for permission hooks that just want to observe)
- **Exit 2** — deny with a reason (for permission enforcement hooks)

This creates two distinct hook categories:

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

### Permission Enforcement Hooks (PreToolUse)

Heavier scripts that intercept tool calls and decide whether to allow them. They read the tool name and input, check against a policy, and exit with 0 (allow) or 2 (deny + reason).

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

The `matcher` field filters which tools the hook applies to. An empty string or `*` matches everything. Specific tool names (e.g., `"Bash"`) narrow the scope.

## Gotchas

- **Settings format is strict.** The hook configuration format has changed across agent versions. An incorrectly structured settings file doesn't produce a parse error — the agent silently ignores the entire settings file. Validate the format before deploying.

- **Environment variables for routing.** If multiple terminals share a web UI, hooks need to know which terminal they're running in. Set a terminal-specific environment variable (e.g., `RAVEN_TERMINAL_ID`) when spawning the terminal, and read it in the hook.

- **Hooks must be fast.** Every hook adds latency to the agent's tool calls. Notification hooks should fire-and-forget (send HTTP request, don't wait for response beyond a short timeout). Permission hooks should avoid network calls — read config from local files.

- **Config walk-up for sandboxed work.** Permission hooks in a sandboxed worktree need to find their config file. Walk up from `cwd` looking for `.raven-work/config.json`, similar to how git finds `.git/`. If not found, pass through silently — subagents may run from a different working directory.

- **Subagents inherit hooks.** When the agent spawns subagents, they run under the same hook configuration. This is usually what you want for permission enforcement (the sandbox applies to subagents too) and notification (you want to know about subagent events). The Agent tool itself should be allowed through the permission hook so subagent spawning works.
