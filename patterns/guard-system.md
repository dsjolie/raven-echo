# Guard System

## Problem

An AI coding agent that can run Bash, fetch URLs, and call external services is useful precisely because it can reach out and act. That same reach creates two friction points that compound each other:

**Permission prompt fatigue.** The agent's host (Claude Code) gates certain tool calls behind user approval. Some of those approvals are meaningful — running an untrusted install script, fetching an external URL. Others aren't — `cd /path && command` is a compound form that mechanically triggers the prompt even when both halves are routine. `$()` in an argument does the same. Users learn to approve reflexively, which trains them to stop reading the prompts, which is exactly when the meaningful ones go by unnoticed.

**Unattended operation.** When the user steps away, any pending permission prompt stops all progress. The agent sits idle. Overnight automation — nightly research runs, scheduled consolidation, cloud merges — requires the agent to keep working with no human in the loop, which means it cannot issue anything that would prompt.

The naive fix for the second problem is to pre-approve everything. That solves the blocking but eliminates the protection. The actual problem is that "what needs approval" and "what is safe to do unattended" are different sets, and the architecture needs to express that difference.

## Approach

A PreToolUse hook intercepts every tool call before the agent executes it. The hook's behavior is selected by reading a single-word mode file at invocation time — no daemon, no IPC, no in-process state:

- **Default** — always-on guardrails. When the hook detects a pattern that would unnecessarily trigger a permission prompt, it blocks the call and returns a message explaining how to rephrase. The agent retries using the correct pattern and the tool runs without requiring approval. The user is never interrupted.

- **Away** — extends default with active tool blocking. A layered whitelist specifies exactly what can run unattended: the project's own CLI tools, skill scripts, local API calls, safe git subcommands, and a headless browser under task-scoped URL restrictions. Everything else that would require a prompt is hard-blocked with a message listing available alternatives.

- **Off** — no checks at all. Fast exit.

The distinction between default and away is intentional: in default mode the goal is guidance, not restriction. The hook teaches the agent to avoid friction patterns rather than preventing work. In away mode the goal is containment: the agent must operate inside a known-safe boundary because there is no user to approve deviations.

A second hook, on the PermissionRequest event, handles the complementary case: anything that escapes the PreToolUse gate and still reaches the approval layer gets auto-rejected in away mode (returning a JSON deny decision) and logged in all modes. This closes the loop — a PreToolUse block prevents the prompt from appearing; a PermissionRequest deny prevents it from blocking even if something slips through.

A third cross-cutting policy — commit-lock — runs in all modes including off. It gates index- and HEAD-mutating git operations (`add`, `commit`, `merge`, `rebase`, `reset`, etc.) on a per-repo advisory lock. This is not a guardrail against prompt fatigue; it is a correctness mechanism for multi-session safety. It fails open on any error because an advisory lock must never brick a repository.

A fourth time-limited policy — web-approve — allows the user to temporarily open the web-tool gate for a set window (e.g. 30 minutes) without switching to off mode. Both the PreToolUse hook and the PermissionRequest hook check a `web-approve.json` state file; if the window is active and unexpired, web tools are let through and logged separately for post-hoc review.

## Implementation

### Mode file

```
~/.claude/raven-guard    # "away" | "off" | absent (= default)
```

The default state requires no file — absence equals default. Setting default deletes the file rather than writing the string. This means a fresh machine or a failed write naturally lands in the safest non-blocking mode.

The hook reads the file fresh on every invocation. This is deliberate: mode changes (toggling to away, switching back) must take effect immediately without restarting any process. The cost is one filesystem read per tool call; given that the hook itself is cheap Node.js I/O, this is not a bottleneck.

### Hook structure

The PreToolUse hook receives tool name and input as JSON on stdin, writes guidance messages to stderr on block, and communicates its decision via exit code:

- **Exit 0** — allow the tool call to proceed
- **Exit 2** — block, with the stderr content becoming the agent's error message

This exit-code convention is what separates "block with guidance" from "hook error". Exit 2 is a clean block the agent sees as a legible refusal. An unexpected non-zero exit code would be treated as a hook failure and might fall back to prompting the user — the wrong outcome in away mode.

### Execution order inside the hook

```
stdin parsed
    │
    ▼
Commit-lock check (ALL modes, incl. off)
    │  blocks index/HEAD-mutating git if no lock held
    ▼
mode == 'off'? → exit 0
    │
    ▼
Tier 1: Always-on guardrails
    │  guidance-db patterns (data-driven, any tool)
    │  activate_venv, cd &&, $(), grep/rg via Bash, inline python pipe, git -C /abs/path
    ▼
mode != 'away'? → exit 0
    │
    ▼
Tier 2: Away-mode blocking
    │  Bash whitelist check → compound-op check → allow or block
    │  Rodney: lifecycle always; URL must match task
    │  MCP tools: hard block
    │  WebFetch: allow if URL matches task; else fall through
    │  web-approve window active? → let through to PermissionRequest
    │  BLOCKED set (Bash, WebFetch, WebSearch, SendMessage, Cron*): block
    ▼
exit 0 (any tool not matched above)
```

### Tier 1: Pattern guidance

The always-on patterns split between two sources. A data-driven set loads from `guidance-db.json` — a flat list of `{pattern, tool, message}` objects sourced from a failure log during periodic consolidation. This is the recognition-hook concept: observed failures become encoded rules without requiring code changes.

Hardcoded patterns cover the cases where the message and context need to be more precise than a generic match:

```javascript
// activate_venv — the venv is already active in project terminals
if (/activate_venv/.test(cmd)) { block('Run the command directly...'); }

// cd /path && command — triggers permission prompt
if (/\bcd\s+\S+\s*&&/.test(cmd)) { block('Use relative paths...'); }

// $() command substitution — triggers CC protection
// rawCmd used here: $() expands before git sees the message body
if (/\$\(/.test(rawCmd) && !/^\s*(echo|printf)\b/.test(rawCmd)) {
  block('Use direct values instead...');
}

// grep/rg via Bash — bypasses deny rules; use built-in Grep
if (/^\s*(grep|rg)\b/.test(rawCmd)) { block('Use the built-in Grep tool...'); }

// Inline python pipe — bypasses CLI tool contracts
if (/\|\s*python3?\s+-c\b/.test(rawCmd)) { block('Use the dedicated CLI tool...'); }
```

One non-obvious detail: `git commit -m "..."` bodies can contain tokens that match guardrail patterns — phrases about venv activation, semicolons in prose, mentions of destructive git flags. Before running any body-content token scan (but not the `$()` check, which fires before git sees the message), commit-message bodies are stripped:

```javascript
function stripCommitMessageBodies(cmd) {
  return cmd
    .replace(/(-m|-F)(\s+)"((?:[^"\\]|\\.)*)"/g, '$1$2""')
    .replace(/(-m|-F)(\s+)'((?:[^'\\]|\\.)*)'/g, "$1$2''");
}
```

This was added after six attested false positives. The guard itself is not turned off — the scanning target is narrowed.

### Tier 2: Away-mode whitelist

The whitelist is stratified rather than a flat list. Each stratum has a different trust basis:

```javascript
const safe =
  cmd.includes('raven-guard.sh') ||           // mode toggle
  /\brtasks\b/.test(cmd) ||                   // task management CLI
  /skills\/raven-[^/]+\/scripts\//.test(cmd) ||  // skill scripts (junction path)
  /scripts\/raven-ui\b/.test(cmd) ||          // web UI CLI
  /\bcurl\b.*\blocalhost\b/.test(cmd) ||      // local API only
  gitSafe ||                                   // safe git subcommands
  gitMergeCloud;                               // merge cloud-agent branches
```

Safe git is defined by subcommand allowlist AND flag denylist — both conditions must hold:

```javascript
const gitSafe =
  /^\s*git\s+(add|commit|push|pull|status|log|diff|branch|fetch|show|stash|mv|rm)\b/.test(cmd) &&
  !/--force\b/.test(cmd) && !/--hard\b/.test(cmd) &&
  !/\bcheckout\s+\./.test(cmd) && !/\brestore\s+\./.test(cmd) &&
  !/\breset\b/.test(cmd) && !/\bclean\b/.test(cmd) &&
  !/-D\b/.test(cmd) && !/\brm\b.*-r/.test(cmd);
```

The cloud-merge whitelist is deliberately narrow: merges must target `origin/claude/*` branches (the naming convention used by cloud agents) and cannot use rewrite strategies (`--squash`, `-s ours`). This enables the nightly cloud-research pipeline to merge its own results unattended without opening a general merge path.

Headless browser access (for JS-rendered pages) uses a task-URL gate: the hook scans task files for URLs and only allows navigation to a URL that appears in a pending task. Lifecycle operations (start, stop, screenshot) and stateless operations on an already-loaded page (js expression evaluation, clicking) are always allowed because they carry no URL.

Whitelisted commands get one additional check — compound operators (`&&`, `;`) are blocked even for safe commands. Compound forms trigger Claude Code's own per-character security scan, which would prompt even for a safe operation. The correct form is two separate Bash calls.

### Mode switching

The toggle script writes or deletes the mode file:

```bash
raven-guard.sh away    # write "away"
raven-guard.sh default # delete the file
raven-guard.sh off     # write "off"
raven-guard.sh         # cycle: default → away → off → default
raven-guard.sh status  # read and print current mode
```

Writing "default" as a file value vs. deleting it would both work. Deletion is the implementation because it makes the mode file's meaning clear: its presence is always a deviation from normal operation. This also means the file's contents never need to be read on a machine that hasn't been put in a special mode.

### Commit-lock

The commit-lock check runs before everything else, including the mode check. It reads `.git/raven-commit.lock` in the nearest ancestor repo:

```javascript
// block if no lock file exists
if (!lock) { return blockMessage('Acquire the lock first...'); }
// block if lock is owned by a different session
if (lock.owner !== myId) { return blockMessage(`Locked by ${lock.owner.slice(0,8)}...`); }
// this session holds it — allow
return null;
```

The lock is advisory and fails open: any I/O error, missing session ID, or missing repo root causes the check to return null (allow). The invariant being enforced is that two concurrent sessions don't interleave `git add / commit` sequences, not that the operation is impossible when the lock check fails.

### Web-approve

The web-approve state is a JSON file with `{active, expires_at, tools, bash_prefixes}`. Both hooks read it: PreToolUse passes the call through to PermissionRequest (rather than blocking), and PermissionRequest auto-approves and logs to a separate audit trail. When the window expires the files remain and the next read finds `new Date(wa.expires_at) > new Date()` is false, so normal blocking resumes without any cleanup step.

## Gotchas

**False positives require narrowing the scan target, not disabling the check.** The commit-message body problem (attested six times) was solved by stripping message bodies before the token scan, not by weakening the pattern. Disabling the guard is itself blocked by the guard: the hook catches `raven-guard.sh off` and returns guidance to try the command without disabling first.

**Compound operators are blocked after whitelisting, not before.** A whitelisted command that uses `&&` gets blocked. This is intentional: the compound form would re-trigger CC's own security prompt with no user present to approve it. The correct fix is always to split the command, not to relax the compound check.

**Away-mode blocking and PermissionRequest denial are separate layers that must both be correct.** The PreToolUse hook prevents the prompt from appearing; the PermissionRequest hook handles anything that somehow reaches the approval layer. Exit code semantics matter: the PermissionRequest hook emits a JSON `{behavior: "deny"}` decision and exits 0, not exit 2. Exit 2 from a PermissionRequest hook is a hook error, which may fall back to prompting the user — the wrong outcome when nobody is there.

**The guidance-db is data, not code.** Patterns observed in the failure log get added to `guidance-db.json` during consolidation without touching the hook. This keeps the hook's logic stable (it loads the database on first call and caches it) while allowing the pattern set to grow as new failure modes are observed.

**Off is sticky, and a disabled guard is silent rather than absent.** The mode file was found reading `off` four days after someone set it that way. In that mode the PreToolUse hook exits after the commit-lock check and the permission hook returns early, so nothing can block or bounce anything — and the automated nightly runs during those four days duly reported "zero guard bounces" as if that were a property of the night. One of them even attributed a bounce to an away-mode whitelist that could not have been executing. The scheduled auto-away job cannot correct this: it only promotes *default* → *away*, so a deliberate *off* survives, which is correct behaviour for a user setting. The missing piece is visibility — nothing surfaced which mode a given run was executing under. Any report asserting an absence of guard events should carry the live mode beside it. Generalised in [instrument-trust.md](instrument-trust.md).

**Fail-open is a deliberate policy for correctness mechanisms, not laziness.** The commit-lock and the web-approve check both fail open. For the lock, an advisory mechanism that can brick a repo is worse than one that occasionally allows a concurrent operation. For web-approve, a parse error on the state file should not unexpectedly lock out web access mid-task. Fail-open is correct here because the mechanism is advisory; fail-open on a security check would be wrong.
