# Process Tree Orphaning with npm

## Problem

Running the web UI server via `npm start` spawns a child `node` process. When you stop the npm process (e.g., via a task manager or Ctrl+C in some contexts), the child `node` process survives as an orphan, still holding the network port. The next startup fails with `EADDRINUSE`.

## Fix

Run `node server.js` directly instead of `npm start`.

```bash
# Instead of:
npm start

# Run directly:
node server.js
```

When running the server as a background task, this is especially important — killing the parent npm process leaves the actual server running invisibly.

## Why

`npm start` creates a process tree: npm → node. On Windows (and some Unix configurations), killing the parent process doesn't automatically send a signal to all children. The npm wrapper is the parent; the actual server is a child process that npm spawns. When npm exits (cleanly or not), the child continues running.

Running `node server.js` directly means there's only one process. Killing it releases the port immediately.

## Detection

If you suspect an orphaned process is holding a port:

```bash
# Find what's using port 3000
netstat -ano | grep 3000    # Windows/Git Bash
lsof -i :3000               # macOS/Linux

# Kill by PID
taskkill /PID <pid> /F       # Windows
kill <pid>                   # Unix
```
