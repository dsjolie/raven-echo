# Python Venv Resolution from Node.js

## Problem

A Node.js server needs to call a Python script that requires packages from a virtual environment. The obvious approach — `execFile('python', [...])` — always uses the system Python, not the venv, even if the terminal that started the server had the venv activated. The venv activation only sets `PATH` for the current shell; child processes spawned by Node don't inherit it.

## Fix

Resolve the venv Python binary path explicitly at server startup:

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

function findPython() {
  const isWin = process.platform === 'win32';
  const binDir = isWin ? 'Scripts' : 'bin';
  const ext = isWin ? '.exe' : '';

  // 1. Check active venv (VIRTUAL_ENV env var)
  if (process.env.VIRTUAL_ENV) {
    const p = path.join(process.env.VIRTUAL_ENV, binDir, 'python');
    if (fs.existsSync(p + ext)) return p;
  }

  // 2. Check known project venv
  const known = path.join(os.homedir(), '.venvs', 'MyProject-py312', binDir, 'python');
  if (fs.existsSync(known + ext)) return known;

  // 3. System fallback
  return 'python';
}

const PYTHON = findPython();
```

Then use `PYTHON` for all `execFile` calls:

```javascript
execFile(PYTHON, [SCRIPT, ...args], {
  env: { ...process.env, PYTHONUTF8: '1' },
}, callback);
```

## Why

Virtual environments work by prepending the venv's `bin/` directory to `PATH`. This only affects the current shell process. When Node.js spawns a child process, it inherits the Node process's `PATH`, which was set when the server was started — possibly by a different mechanism (systemd, npm, a different terminal) that didn't have the venv activated.

The reliable approach: don't depend on `PATH` resolution at all. Find the Python binary by its absolute path. The three-tier fallback (active venv → known location → system) handles the common cases.

## Related

See also: [Python stdout encoding on Windows](windows-shell-quirks.md) — when you've solved the venv problem, you'll hit the encoding problem next. Set `PYTHONUTF8: '1'` in the `execFile` environment.
