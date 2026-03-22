# Guard System

## Problem

AI coding agents like Claude Code have a permission system — certain tool calls (Bash commands, web fetches, file writes to new paths) require user approval. This is good for safety, but creates two problems:

1. **Permission prompt fatigue.** Common patterns trigger prompts unnecessarily. `cd /path && command` is a single safe operation, but the compound form triggers a permission check. Command substitution `$()` in arguments triggers another. Users approve these reflexively, weakening the protection.

2. **Unattended operation.** When the user steps away, pending permission prompts block all progress. The agent sits idle waiting for approval that won't come.

## Approach

A PreToolUse hook intercepts every tool call before execution. It reads a mode file to determine behavior:

- **Default** — always-on guardrails that catch patterns known to trigger unnecessary permission prompts. Instead of blocking, it returns guidance: "use relative paths instead of `cd /path &&`" or "use direct values instead of `$()`." The agent adjusts its approach and the tool call succeeds on retry without needing user approval.

- **Away** — default guardrails plus active blocking of tools that require permission (Bash, WebFetch, WebSearch, etc.). A whitelist allows trusted commands through: the project's own CLI tools, skill scripts, and localhost API calls. The agent can still read files, search code, edit, and plan — just not run arbitrary commands or fetch external content.

- **Off** — no checks. Fast exit on every call.

The key design choice is **guidance over blocking** in default mode. The hook doesn't prevent the agent from doing its work — it teaches it to avoid permission-triggering patterns. This reduces prompt fatigue without reducing capability.

## Implementation

The mode file is a plain text file containing one word (`default`, `away`, or `off`). Missing file means default. Read fresh on every hook invocation — no daemon, no IPC, no cache.

```
~/.claude/raven-guard    # "away", "off", or absent (= default)
```

The hook is a Node.js script installed as a PreToolUse handler with no matcher (fires for all tools). It receives the tool name and input as JSON on stdin, writes guidance to stderr on block, and uses exit codes as the API:

- **Exit 0** — allow the tool call
- **Exit 2** — block with a reason (stderr becomes the agent's error message)

### Tier 1: Always-on guardrails

These fire in both default and away modes:

```javascript
// Catch cd /path && command — triggers permission prompt
if (/\bcd\s+\S+\s*&&/.test(cmd)) {
  block('Use relative paths, or run cd and the command as separate Bash calls.');
}

// Catch $() in arguments — triggers CC protection
if (/\$\(/.test(cmd) && !/^\s*(echo|printf)\b/.test(cmd)) {
  block('Use direct values instead, or split into separate calls.');
}
```

### Tier 2: Away-mode blocking

A whitelist of trusted Bash patterns passes through:

```javascript
const safe =
  /\brtasks\b/.test(cmd) ||              // task management CLI
  /skills\/raven-[^/]+\/scripts\//.test(cmd) ||  // skill scripts
  /scripts\/raven-ui\b/.test(cmd) ||     // web UI CLI
  /\bcurl\b.*\blocalhost\b/.test(cmd);   // local API calls
```

Whitelisted commands still get one additional check: compound operators (`&&`, `;`) are blocked even in safe commands, because they trigger CC's own security checks and would cause permission prompts with nobody to approve them.

Everything else that requires permission (Bash, WebFetch, WebSearch, SendMessage, MCP tools) is blocked with a message listing available alternatives.

### Mode switching

A Bash script toggles modes and can cycle through them:

```bash
raven-guard.sh away      # enable away mode
raven-guard.sh default   # back to always-on guardrails
raven-guard.sh status    # show current mode
raven-guard.sh           # cycle: default → away → off → default
```

The web UI also has a sidebar button and API endpoint (`/api/guard`) for toggling from the browser.

## Gotchas

- **False positives on keywords.** The `activate_venv` check matches the string anywhere — including in commit messages about venv activation. Temporary workaround: turn guard off for that commit.
- **Compound command blocking is conservative.** `echo "hello" && echo "world"` in a whitelisted context gets blocked because `&&` is checked after whitelist match. The fix is to split into separate calls, which is what the guidance says.
- **Model behavior when blocked.** The hook message tells the agent what to do instead, but the agent must cooperate. The skill documentation includes explicit instructions: "when you see a guard block message, pivot to built-in tools. If the task genuinely can't proceed, enter plan mode."
