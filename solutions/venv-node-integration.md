# Node.js → Python: Venv Resolution and Output Encoding

Two independent gotchas that always appear together when a Node.js server shells out to a Python script. Solve both up front.

---

## Problem 1: execFile('python') ignores the venv

`execFile('python', [...])` resolves `python` from the Node process's `PATH`. That `PATH` was fixed when the server started — not when a terminal later activates a venv, and not when a service manager or npm script launches the server without any venv context. The venv's packages are simply absent at runtime.

### Fix

Resolve the interpreter path explicitly at startup, before any subprocess call:

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

function findPython() {
  const isWin = process.platform === 'win32';
  const bin  = isWin ? 'Scripts' : 'bin';
  const ext  = isWin ? '.exe' : '';

  // 1. Venv is active in the current process environment
  if (process.env.VIRTUAL_ENV) {
    const p = path.join(process.env.VIRTUAL_ENV, bin, 'python');
    if (fs.existsSync(p + ext)) return p;
  }

  // 2. Known centralized venv location (adjust name to match your project)
  const known = path.join(os.homedir(), '.venvs', 'MyProject-py312', bin, 'python');
  if (fs.existsSync(known + ext)) return known;

  // 3. System fallback — deps may be missing, but at least it runs
  return 'python';
}

const PYTHON = findPython();
```

Use `PYTHON` (not the string `'python'`) for every `execFile` or `spawn` call:

```javascript
execFile(PYTHON, [scriptPath, ...args], { /* options */ }, callback);
```

### Why this works

Virtual environments operate by prepending their `bin/` (or `Scripts/`) directory to `PATH` in the activating shell. Node inherits its parent's `PATH` snapshot; child processes it spawns inherit Node's snapshot. Activation in a later terminal has no effect. Pinning the binary path sidesteps `PATH` resolution entirely — the interpreter is found by its filesystem location, not by shell state.

The three-tier probe (active venv → known location → system fallback) covers:
- **Active venv**: developer runs the server from an activated shell
- **Known location**: server is started by a service, npm script, or editor launch where no venv is active but the venv exists at a predictable path
- **System fallback**: catches unexpected setups and surfaces a clear error from the script itself if required deps are missing

---

## Problem 2: Python subprocess output is garbled on Windows

Once the correct interpreter is running, stdout from Python scripts passed through `execFile` may contain mojibake (`Ã¶` for `ö`, etc.) or throw JSON parse errors on any non-ASCII content. This happens on Windows because the default console encoding is cp1252, not UTF-8. Node.js reads the subprocess stdout as UTF-8 and misinterprets the bytes.

### Fix

Set `PYTHONUTF8=1` in every subprocess environment:

```javascript
execFile(PYTHON, [scriptPath, ...args], {
  env: { ...process.env, PYTHONUTF8: '1' },
}, callback);
```

`PYTHONUTF8=1` forces Python's standard streams to UTF-8 regardless of locale or console code page, affecting both `print()` output and `sys.stdout`.

### Why this matters

The failure is silent on pure-ASCII input — tests pass, the server appears to work. The first non-ASCII byte (a path with a diacritic, a task label with an em-dash, any UTF-8 string from a file) causes a parse error or corrupted output. Setting the flag unconditionally costs nothing and eliminates the entire class of problem.

---

## Combined pattern

Both fixes belong in the same call site. Resolving the interpreter and pinning the encoding are two sides of the same contract: "call exactly this Python with exactly this output behavior":

```javascript
execFile(PYTHON, [scriptPath, '--json', ...args], {
  timeout: 15000,
  env: { ...process.env, PYTHONUTF8: '1' },
}, (err, stdout, stderr) => {
  if (err) {
    reject(new Error(`script failed: ${err.message}${stderr ? ' — ' + stderr.trim() : ''}`));
    return;
  }
  resolve(JSON.parse(stdout));
});
```

The general rule: whenever a Node service shells out to Python, pin **both** the interpreter path and its output encoding. Trusting `PATH` or the OS locale for either produces failures that are environment-dependent, intermittent, and hard to reproduce in development.
