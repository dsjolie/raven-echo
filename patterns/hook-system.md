# Hook System: Agent Lifecycle Events as Extension Points

## Problem

An AI coding agent runs in a terminal, issuing tool calls — shell commands, file reads, web fetches, and more. You want to integrate that agent into a broader environment: notify a web UI when it starts, enforce security policies during autonomous work, catch bad command patterns before they cause problems. You have no access to the agent's source code.

The naive approach is to wrap every tool call with custom logic in your prompts, or to instruct the agent to self-check before acting. Both are fragile: the agent can drift from instructions, and prompts don't survive context changes. What you need is an out-of-band mechanism that fires reliably regardless of what the agent was told.

## Approach

Claude Code fires shell commands at each lifecycle event: session start, tool use requests (before the tool runs), tool use completions, permission escalation requests, and session stop. Each hook is a shell command that receives structured JSON on stdin describing the event. The hook communicates back through two channels:

- **Exit code** — the primary signal: `0` = allow/success, `2` = block with message, `1` = fall through (for permission hooks that want to observe without deciding)
- **Stdout JSON** — for richer decisions, a hook can print a structured decision object (`hookSpecificOutput`) that overrides the exit-code semantics with an explicit `behavior: allow/deny` and a message surfaced to the agent

This two-channel design matters: exit codes are coarse (allow or block), but a blocked agent that receives only an exit code can't adapt its behavior. When the deny JSON includes a message explaining *why* and suggesting what to do instead, the agent can reason about the failure and try a different approach. The message is part of the API.

Three complexity levels emerge naturally from what different hooks need to do.

### Level 1: Notification Hooks (fire-and-forget)

The simplest hooks don't affect agent behavior at all. They fire on `SessionStart`, `Stop`, or `PermissionRequest` events, forward structured data to an external system, and exit. Their only concern is correctness of the exit code: exit 0 for informational events (a non-zero exit from `SessionStart` produces a visible warning), exit 1 for permission events where the hook is only observing and wants normal behavior to continue.

```javascript
// notify-hook.js — stripped to essentials
const event = process.argv[2]; // 'session-start' | 'stop' | 'permission'

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  const data = JSON.parse(input);
  const body = JSON.stringify({ terminal: terminalId, event, data });

  // Fire HTTP request; don't wait longer than necessary
  const req = http.request({ hostname: 'localhost', port: PORT, path: '/api/hook',
    method: 'POST', timeout: 5000 }, () => {
    process.exit(event === 'permission' ? 1 : 0);
  });
  req.on('error', () => process.exit(event === 'permission' ? 1 : 0));
  req.write(body);
  req.end();
});
```

A subtlety: when the hook is attached to `PermissionRequest`, the exit code must be 1 (fall through), not 0 (which would auto-allow) and not 2 (which would auto-deny). The hook is a side-effect, not a decision.

This same hook can double as a decision-maker in away mode by printing a deny JSON object when it detects the mode flag set — keeping the "away = auto-reject" logic in one place rather than scattered across hooks.

### Level 2: Guard Hooks (PreToolUse — guidance + gating)

Mid-weight hooks intercept every tool call before execution. The key design choice here is where to put the policy: hard-coded patterns for stable rules that never change, but a file-based mode for behavior that needs to change at runtime without restarting the agent.

```javascript
// raven-guard.js — mode-file approach
let mode = 'default';
try { mode = fs.readFileSync(MODE_FILE, 'utf8').trim(); } catch {}
// Missing file = default. No daemon, no IPC — just readFileSync.

if (mode === 'off') process.exit(0); // fast path

// Tier 1: Always-on (applies in default and away)
if (/\bcd\s+\S+\s*&&/.test(cmd)) {
  block('Compound cd triggers permission prompts. Use relative paths or separate calls.');
}

// Tier 2: Away mode only
if (mode === 'away' && BLOCKED_TOOLS.has(toolName)) {
  block(`${toolName} blocked while user is away. Use Read/Edit/Grep instead.`);
}
```

The tiered structure matters because not all guardrails should apply in all contexts. Tier 1 catches patterns that cause friction regardless of mode (command substitution `$()` triggers a CC permission escalation, `cd /path &&` locks a pre-approval to one specific path). Tier 2 enforces tool-level blocking only when the human is absent.

Guards also need to handle false positives carefully. A `git commit -m "...message..."` might legitimately contain words that look like dangerous patterns in the message body. Strip commit message bodies before running pattern checks — but only for patterns that check the body content; security checks targeting shell semantics (like `$()`) still need the raw command because the shell expands those before git sees them.

The guard's block messages are teaching material, not just stop signs. When the agent knows *why* a command was blocked and what to do instead, it adapts. A guard that says "don't do X" without explaining the alternative forces the agent to guess or ask; one that says "don't do X, do Y instead" closes the loop.

Data-driven patterns extend the guard without code changes: a `guidance-db.json` file holds regex patterns with associated messages, scoped by tool name. Adding a new guardrail becomes a data edit, not a code change. Patterns sourced from past failures give the guard operational memory.

### Level 3: Permission Enforcement Hooks (PreToolUse — hard boundary)

Heavyweight hooks implement a security policy for sandboxed work. Unlike the guard (which guides the agent toward good behavior), permission enforcement hooks implement a hard boundary: every tool call must affirmatively match a policy or it is denied.

(The spec-driven sandbox workflow this tier was built for has since been retired — the guard's away mode plus provider-sandboxed cloud sessions covered the unattended-work need with less machinery. The tier stays documented because the techniques below — walk-up config discovery, fail-open policy loading, path containment — apply to any hard-boundary hook.)

```python
# sandbox-hook.py — simplified
hook_input = json.loads(sys.stdin.read())
tool_name = hook_input["tool_name"]
tool_input = hook_input["tool_input"]
cwd = hook_input.get("cwd", os.getcwd())

config = load_config(cwd)  # walk up from cwd to find .raven-work/config.json
if not config:
    allow()  # no sandbox active — pass through silently

if tool_name in ("Write", "Edit"):
    resolved = resolve_path(tool_input["file_path"], cwd)
    if not is_under(resolved, config["worktree_root"]):
        deny(f"path outside worktree: {tool_input['file_path']}")
    if config.get("read_only") and not any_write_path_matches(resolved, config):
        deny("read-only profile — writes restricted")
    allow()

elif tool_name == "Bash":
    if not any(tool_input["command"].startswith(p) for p in config["bash_allowlist"]):
        deny(f"command not in allowlist: {first_word(tool_input['command'])}")
    allow()
```

Several design decisions here are non-obvious:

**Walk-up config discovery** mirrors how git finds `.git/`. The hook fires for all tool calls, but sandbox config only exists in sandboxed worktrees. Walking up from the current working directory to find `config.json` means the same hook binary works everywhere — it self-deactivates when no config is found.

**Fail open on config load errors**. The sandbox hook is a correctness mechanism for sandboxed sessions. If it breaks (config not found, parse error), it should let the tool call through rather than brick the session. An unanticipated failure in a safety mechanism is better surfaced later than hidden behind a blocked agent.

**Subagents inherit hooks**. When the main agent spawns a subagent via the `Agent` tool, the subagent runs with the same hook configuration. This means the sandbox applies to subagents automatically — no special handling needed. The `Agent` tool itself should be explicitly allowed; otherwise, spawning subagents is blocked.

**Anti-tamper patterns** protect the hook's own config files. A `protected_patterns` list in the config prevents the agent from modifying `.raven-work/config.json` or the hook script itself — the very files that define the boundary.

## Implementation

Hooks are registered in the agent's settings file under an event-keyed structure. Each event has a list of matchers; each matcher has a tool-name filter and a list of commands to run:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node hooks/raven-guard.js" }]
      },
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "python sandbox-hook.py" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node hooks/gitlock-nudge.js" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node hooks/notify-hook.js session-start" }]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node hooks/away-reject.js" }]
      }
    ]
  }
}
```

An empty `matcher` string matches all tools. A specific name like `"Bash"` narrows the hook to that tool only, which matters for `PostToolUse` hooks that only care about one tool type.

Multiple hooks on the same event run in order. For `PreToolUse`, this means broad-pattern hooks run before policy hooks — the guard catches patterns that should never run regardless of any policy state; a policy hook catches everything the guard doesn't explicitly address.

`PostToolUse` hooks are advisory — they cannot block (the tool already ran). They can inject `additionalContext` into the agent's next input. This is the right place for reminders: the gitlock-nudge hook runs after `git commit` or `git push`, checks if the current session still holds a commit-lock, and injects a reminder to release it. Placing this in `PostToolUse` rather than `PreToolUse` ensures it doesn't interfere with the guard's pre-execution checks.

## Gotchas

**Silent settings failure.** An incorrectly structured settings file causes the agent to silently ignore the entire hooks configuration — no error, no warning, hooks just don't run. Validate the format against a known-working example before deploying. Test by adding a trivially visible side-effect (a log write) to confirm the hook fires at all.

**Exit code 1 vs 2 on PermissionRequest.** Exit 1 from a `PermissionRequest` hook means "fall through to normal behavior" — the permission dialog appears. Exit 2 means "deny, surface my stderr as the reason." Exit 0 means "auto-allow." These three behaviors are distinct; using the wrong one produces unexpected results (a logging-only hook that accidentally auto-allows, for instance, is a security hole).

**Terminal routing via environment variable.** If multiple agent terminals share a web UI, the notification hook needs to know which terminal it's running in to route events correctly. Inject a terminal-specific identifier as an environment variable when spawning the terminal (`RAVEN_TERMINAL_ID=<id>`). This variable is present for all hooks that run in that terminal.

**File-based state vs. environment variables for runtime toggles.** Environment variables are set at session spawn and can't change without restarting. A mode file read fresh on each hook invocation can be toggled at any time — write a single word to the file, and the next tool call sees the new behavior. The performance cost is one `readFileSync` per tool call, which is negligible compared to actual tool execution time.

**Hook latency compounds.** Every `PreToolUse` hook adds latency before the agent can act. Notification hooks should fire-and-forget (send the HTTP request, don't block waiting for the response beyond a short timeout). Guard hooks should only touch local files. Permission hooks should avoid all network I/O. A hook that takes 500ms to complete adds noticeable friction to a session with many tool calls.

**Path normalization across platforms.** On Windows, paths arrive with backslashes; `resolve()` may return mixed slashes depending on how paths were constructed. Sandbox hooks doing containment checks (`is path under root?`) must normalize both sides to the same slash convention before comparing. Lowercase comparison handles case-insensitive filesystems. The common failure mode is a path that is in the worktree but compares as "outside" because the prefix check uses different slash styles.

**False positives from commit message bodies.** Guardrail patterns that scan Bash commands for keywords can misfire on legitimate commit messages that happen to contain those words. A git commit command with a message body is structurally `git commit -m "...prose..."` — the prose is inert, but pattern scanners see it. Strip the quoted message body before running keyword checks, but leave the raw command intact for checks that target actual shell semantics (where the shell expands the command before git sees it).
