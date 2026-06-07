# CLI-as-API: One Language Owns the Logic, Others Consume It

## Problem

A web UI (Node.js) and a terminal both need to work with the same data: task files, markdown conventions, deadline parsing, project resolution. Writing the parsing logic in JavaScript means it must be maintained alongside the Python version. Skipping the Python version means the terminal experience degrades. Adding a REST microservice just for internal logic is absurd overhead for a single-user tool.

The same tension applies in the other direction: the web UI exposes HTTP endpoints for notifications, terminals, and session queries. Every hook, cron job, and agent session needs access to those capabilities, but constructing raw curl calls inline is brittle and undocumented.

The core question: how do you write parsing and business logic once and make it available from a terminal, a web server, a cron job, and an AI agent hook — without duplicating it or standing up internal services?

## Approach

Nominate one language as the owner of a capability. Expose it through a CLI that supports two output modes: human-readable text for direct terminal use, and `--json` for machine consumption. Then make every other context a thin wrapper around that CLI.

This produces two complementary variants of the same pattern:

**Python CLI → Node.js server.** Python owns the parsing. The Node server calls the Python CLI via `execFile`, passes `--json`, and returns parsed output to the browser. The Python CLI is also directly invocable from the terminal with the same subcommands. Node contributes nothing to the logic — it just dispatches and relays.

**Bash CLI → HTTP API.** A Bash script owns the vocabulary for web UI interactions. It wraps the server's HTTP endpoints with named, validated subcommands. Instead of every caller hand-writing curl, they call `raven-ui modal "Title" "Body"` or `raven-ui terminal "Name" --claude`. The Bash script handles curl, JSON construction, and error reporting once.

The contract between these is stable: the Python CLI's `--json` output format and the HTTP API's endpoint contracts are the only interfaces that need to stay consistent. Neither consumer — Node or Bash — contains business logic; they're both couriers.

## Implementation

### Python CLI with dual output mode

The Python CLI accepts a global `--json` flag that switches all output from human-readable text to a JSON envelope. The same `add`, `done`, `list`, and `edit` subcommands work in both modes — `--json` changes the renderer, not the logic.

```python
# Force UTF-8 output on Windows (default console encoding is cp1252)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
```

This reconfiguration is unconditional — it runs on startup regardless of whether `--json` is set, because encoding corruption is silent and hard to diagnose after the fact.

### Node.js wrapper

The wrapper is a single `execFile` call plus a resolve/reject pair. All subcommand functions delegate to it:

```javascript
function rtasks(...args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, '--json', ...args], {
      timeout: 15000,
      env: { ...process.env, PYTHONUTF8: '1' },
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`rtasks ${args.join(' ')}: ${err.message}${stderr ? ' — ' + stderr.trim() : ''}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`rtasks ${args.join(' ')}: invalid JSON — ${stdout.slice(0, 200)}`));
      }
    });
  });
}

function addTask(project, text)        { return rtasks('add', project, text); }
function completeTask(project, text)   { return rtasks('done', project, text); }
function listProject(project)          { return rtasks('list', project); }
```

The error path includes both the Node error and Python's stderr. A Python traceback in stderr is far more actionable than the generic Node process-exit message.

### Venv resolution

`execFile('python', ...)` uses the system Python regardless of what the calling terminal had activated. The server resolves the correct Python binary once at startup:

```javascript
function findPython() {
  if (process.env.VIRTUAL_ENV) {
    const p = path.join(process.env.VIRTUAL_ENV,
      process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
    if (fs.existsSync(p + (process.platform === 'win32' ? '.exe' : ''))) return p;
  }
  const knownVenv = path.join(os.homedir(), '.venvs', 'ProjectName-py312',
    process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
  if (fs.existsSync(knownVenv + (process.platform === 'win32' ? '.exe' : ''))) return knownVenv;
  return 'python';
}
```

Resolution order: active venv from `VIRTUAL_ENV`, then a known centralized venv path, then system fallback. This covers the common case (server started from a shell with the venv active) and the common failure case (server auto-started at boot with a clean environment).

### Bash CLI wrapping HTTP

The Bash variant constructs curl calls from named subcommands. JSON payloads are assembled via inline Python (one-liners), which avoids shell-escaping issues with special characters in markdown content:

```bash
post_json() {
  local endpoint="$1" payload="$2" resp http body rc=0
  resp=$(curl -s -w '\n%{http_code}' "${BASE}${endpoint}" \
    -H "Content-Type: application/json" -d "$payload") || rc=$?
  http="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  [[ -n "$body" ]] && printf '%s\n' "$body"
  if [[ "$http" -ge 400 ]]; then
    echo "raven-ui: HTTP $http from ${endpoint}" >&2
    return 1
  fi
}
```

Using Python for JSON construction rather than string interpolation sidesteps quoting bugs when content includes backticks, dollar signs, or Unicode.

### Server-side session cache as a complementary layer

Not every data layer benefits from the subprocess model. The session scanner reads Claude Code JSONL transcript files directly in Node — a server-side module with its own mtime-keyed disk cache (`data/session-names.json`). It re-scans only files whose mtime changed since the last run, making repeated requests fast without a subprocess per call.

The distinction is deliberate: the task CLI owns mutable, writeable data that must stay consistent across consumers. Session data is read-only from Node's perspective and high-volume enough that subprocess-per-request would be noticeable. The cache layer handles the read path efficiently; the CLI-as-API pattern handles the write path correctly.

## Gotchas

**Encoding is silent until it isn't.** Windows console defaults to cp1252. Accented characters in file paths, task text, or project names get corrupted without `PYTHONUTF8: '1'` in the `execFile` env and `sys.stdout.reconfigure(encoding='utf-8')` in the Python script. Neither alone is sufficient — both sides must agree.

**Venv activation doesn't survive `execFile`.** Shell venv activation changes PATH in the current process. Node's `execFile` spawns a new process with the inherited environment, not a fresh shell. The inherited PATH may or may not include the venv's `Scripts/bin`. Resolve the binary path explicitly; don't rely on `python` resolving to the right interpreter.

**One subprocess per request is a deliberate trade-off.** Python startup overhead (~50–100ms) and the subprocess model mean you get ~10 requests/second at most. For a personal single-user tool this is fine — it's never the bottleneck. If it were, the right fix is a long-running Python process with a socket or pipe, not reimplementing logic in Node.

**Error context matters.** When `execFile` fails, Python's stderr typically contains the traceback. Concatenate stderr to the rejection message. Without it, a missing import or bad file path produces only `Command failed with exit code 1`.

**The `--json` flag belongs at the top level, not per subcommand.** Placing it as a global flag (before the subcommand) means it applies uniformly to every operation. Placing it per-subcommand forces every caller to know which subcommands support it — that's a leaky detail.

**Bash JSON assembly via shell interpolation breaks on special characters.** Markdown content, task text with backticks or dollar signs, and non-ASCII all misbehave when interpolated into JSON strings in Bash. A one-liner Python call to `json.dumps` is the correct fix: delegate JSON encoding to a tool that understands it.
