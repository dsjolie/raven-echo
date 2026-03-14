# CLI-as-API: Python Parses, Node.js Serves

## Problem

You have a web UI in Node.js and complex parsing logic (task files with deadlines, project resolution, markdown conventions). Writing the parser in JavaScript means maintaining it in two places — the terminal CLI and the web server. Writing it only in Python means the web UI can't use it.

## Approach

Put all parsing logic in a Python CLI tool. Give it a `--json` flag for structured output. The Node.js server calls it via `execFile` and parses the JSON response. The CLI works standalone from the terminal, and the web UI gets the same logic for free.

```
Terminal user                    Web UI
     │                             │
     ▼                             ▼
  rtasks list raven          lib/tasks.js
     │                        calls execFile
     ▼                             │
  rtasks.py --json list raven  ◄───┘
     │
     ▼
  Parsed task data (JSON)
```

The Node.js wrapper is minimal — ~100 lines total, mostly one-line functions:

```javascript
function rtasks(...args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, '--json', ...args], {
      timeout: 15000,
      env: { ...process.env, PYTHONUTF8: '1' },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`rtasks ${args.join(' ')}: ${err.message}`));
      resolve(JSON.parse(stdout));
    });
  });
}

// Each operation is a thin wrapper
function addTask(project, text) { return rtasks('add', project, text); }
function completeTask(project, text) { return rtasks('done', project, text); }
```

## Implementation

The Python CLI uses Click for argument parsing and outputs JSON when `--json` is set. Without `--json`, it outputs human-readable text for terminal use. This dual-mode approach means one tool serves both interfaces.

The server resolves the Python executable at startup:

```javascript
function findPython() {
  // 1. Check active venv (VIRTUAL_ENV env var)
  // 2. Check known project venv path
  // 3. Fall back to system python
}
```

This resolution is necessary because `execFile('python', ...)` always uses the system Python, even if the terminal that started the server had a venv activated. The venv activation only affects the current shell's PATH — child processes spawned by Node don't inherit it.

## Gotchas

- **Python stdout encoding on Windows.** Windows defaults to cp1252 for subprocess stdout, not UTF-8. Characters like `ö` and `ä` in file paths get corrupted. Set `PYTHONUTF8: '1'` in the `execFile` environment to force UTF-8. Without this, any non-ASCII content silently breaks.

- **Venv doesn't propagate to child processes.** `execFile('python', ...)` ignores the calling terminal's venv. You must resolve the venv's Python binary path explicitly and pass it to `execFile`. Check `process.env.VIRTUAL_ENV` first, then a known venv location, then fall back to system Python.

- **Timeout matters.** Complex operations (scanning all projects, resolving deadlines) can take a few seconds. Set a reasonable timeout on `execFile` — 15 seconds is generous for a local CLI tool. Without a timeout, a stuck Python process blocks the web UI indefinitely.

- **Error messages are useful.** When `execFile` fails, include both the error message and stderr in the rejection. Python tracebacks in stderr are the fastest way to diagnose issues.

- **One process per request.** Each web UI action spawns a Python subprocess. This is fine at personal-tool scale (single user, infrequent requests). For higher throughput, you'd want a long-running Python process with IPC — but that's premature optimization for a personal tool.
