# Process Tree Orphaning

## Problem

A background server launched via a wrapper (e.g. `npm start`) survives attempts to stop it. Killing the wrapper exits cleanly, the port stays occupied, and the next launch fails with `EADDRINUSE`. The real server process is running invisibly — an orphan with no owner.

## Fix

Launch the long-lived process directly, bypassing the wrapper entirely.

```bash
# Wrapper launch — creates a two-process tree
npm start        # npm (PID A) → node server.js (PID B)

# Direct launch — one process, one PID
node server.js   # node (PID A only)
```

When a task manager or automated stop signal targets PID A, the direct launch guarantees the server actually stops.

## Why

A wrapper launcher like `npm start` forks a child process to run the real command. On Windows (and some Unix configurations without explicit process-group signaling), killing a parent does not propagate to its children. The parent exits; the child inherits the port and keeps listening. The wrapper is ephemeral — the thing you wanted to manage — but what you actually killed was just the shell around it.

The fix removes the indirection. When the managed PID *is* the server PID, a stop signal reaches the actual process and the resource (port, file lock, socket) is released cleanly.

This is a general principle for any long-lived managed process: avoid wrapper launchers that fork the real process. The PID you track must be the PID that owns the resource.

## Detection

If a port remains occupied after a stop:

```bash
# Find the process holding the port (Windows/Git Bash)
netstat -ano | grep 3000

# Kill it directly
taskkill /PID <pid> /F
```

The surviving PID will belong to the server process, not the wrapper — confirming the wrapper exited but the child did not.

## Generalization

The same failure mode appears anywhere a long-lived process is started through a launcher that does not forward signals or manage its own process group: shell wrapper scripts, `npx`, language runtimes that exec a child, and some systemd `ExecStart` configurations. The diagnostic is always the same: check which PID actually owns the resource, and verify that stopping the launcher reaches that PID. If it doesn't, move up one level — launch the real process directly, or use a process manager that explicitly tracks and signals the full process tree.
