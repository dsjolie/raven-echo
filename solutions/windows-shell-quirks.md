# Windows Shell Quirks for Agent Development

A collection of Windows-specific issues encountered while building AI agent tooling on Windows with Git Bash, PowerShell, and Node.js.

## Python stdout encoding (cp1252 vs UTF-8)

**Problem:** Python scripts called from Node.js via `execFile` produce garbled output for non-ASCII characters. File paths containing `ö`, `ä`, `ü` come out as `Ã¶`, `Ã¤`, `Ã¼` or trigger encoding errors.

**Cause:** Windows console processes default to cp1252 encoding, not UTF-8. When Node.js reads subprocess stdout, it expects UTF-8 and misinterprets the cp1252 bytes.

**Fix:** Set `PYTHONUTF8=1` in the subprocess environment:

```javascript
execFile(python, args, {
  env: { ...process.env, PYTHONUTF8: '1' },
}, callback);
```

## Path format inconsistency

**Problem:** Development tools on Windows produce paths in different formats — `D:/Project/file.js` (forward slashes, from Git Bash) vs `D:\Project\file.js` (backslashes, from Windows APIs). Some tools track files by exact path string, so reading a file with one format and editing with another fails ("file not found" or "file has been modified").

**Fix:** Use a consistent path format throughout. Pick one convention and stick to it for all operations on the same file. When working with tools that use exact string matching for file identity, normalize paths at the boundary.

## Git Bash and .bat files

**Problem:** Running a `.bat` file in Git Bash with `.\script.bat` (backslash) fails. Git Bash interprets the backslash as an escape character, not a path separator.

**Fix:** Use `./script.bat` (forward slash). Git Bash recognizes this as a file path and invokes cmd.exe to run it.

## Null redirection

**Problem:** `2>NUL` in Git Bash creates a literal file called `NUL` instead of discarding stderr.

**Fix:** Use `2>/dev/null`. Git Bash maps `/dev/null` to the Windows null device. The Windows-native `NUL` only works in cmd.exe and PowerShell.

## Venv doesn't propagate to child processes

**Problem:** Activating a Python venv in a terminal, then starting a Node.js server from that terminal, then calling `execFile('python', ...)` from the server — uses the system Python, not the venv.

**Cause:** Venv activation modifies the shell's `PATH`. The Node.js server inherits that `PATH`, but `execFile` searches for `python` using the process's own `PATH` at the time it was started. If the server was started before venv activation, or via a mechanism that doesn't inherit the shell environment (like a service manager), the venv Python won't be found.

**Fix:** Resolve the venv Python binary by absolute path. See [venv-node-integration.md](venv-node-integration.md).

## PTY line endings

**Problem:** Sending `\r\n` to node-pty on Windows causes PowerShell to show a continuation prompt `>>` instead of executing the command.

**Fix:** Send `\r` only. See [pty-line-endings.md](pty-line-endings.md).

## Process tree killing

**Problem:** `npm start` creates a process tree where the actual server is a child of the npm process. Killing npm orphans the server, which keeps holding the port.

**Fix:** Run `node server.js` directly. See [process-lifecycle.md](process-lifecycle.md).
