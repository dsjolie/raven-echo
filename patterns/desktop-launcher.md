# Desktop Launcher: Native Shell for a Local Web Service

## Problem

A browser-based tool works fine for occasional use, but as a daily driver it has
friction: the user navigates to a URL, browser tabs compete with unrelated pages,
and there is no concept of "starting" or "stopping" the server. Add multiple
instances — a local one on the current machine plus one or more running on remote
machines reachable over a VPN — and the problem compounds. Each instance lives at
a different URL, switching between them in a browser tab reloads the page and
kills live terminal sessions, and there is no unified status view.

The deeper issue is that the web tool is _already_ the right UI. Building a
separate native frontend from scratch would duplicate all that work. What is
actually needed is a thin native shell around it.

## Approach

Wrap the web tool in a minimal native window using **Wails** (Go backend + system
WebView). The Go backend handles the things a browser tab cannot: spawning and
stopping local server processes, persisting running-state across launcher restarts,
and pinging remote hosts. The frontend is embedded in the same binary and is plain
vanilla JS — no framework needed because the UI is just a sidebar list plus
iframes.

Each instance gets its own persistent `<iframe>`. The key insight: an iframe that
is hidden (CSS `display: none`) but never removed keeps its full session state
alive — terminal buffers, WebSocket connections, scroll position. Switching
instances is a CSS toggle, not a navigation. This means switching from the local
instance to a remote one and back is instantaneous and stateless from the user's
perspective.

Local and remote instances are treated differently at the data model level but
uniformly in the UI:

- **Local**: the launcher spawns `node server.js` with `PORT` set via env, streams
  its log into a startup panel, and can stop it. The server is detached into its
  own process group so it outlives the launcher; PIDs are persisted so a relaunched
  launcher can re-adopt servers it started.
- **Remote**: a host/port entry only. The launcher pings it periodically and shows
  a status dot, but cannot start or stop it.

Status dots (reachable / starting / stopped / unreachable) come from a periodic
HTTP ping against each instance's root URL.

## Implementation

**Config model** (`config.go`): a flat JSON array of instance records stored in
the OS user-config directory (`%AppData%\raven-desktop\ravens.json` on Windows,
`~/.config/raven-desktop/ravens.json` on Linux/macOS). Each record carries `id`,
`name`, `host`, `port`, `kind` (`"local"` or `"remote"`), and for local instances
`webUiDir` and `nodePath`.

```go
type Raven struct {
    ID       string `json:"id"`
    Name     string `json:"name"`
    Host     string `json:"host"`   // empty = localhost
    Port     int    `json:"port"`
    Kind     string `json:"kind"`   // "local" or "remote"
    WebUIDir string `json:"webUiDir"`
    NodePath string `json:"nodePath"`
}
```

First run seeds a single local entry pointing at the conventional port; `WebUIDir`
is intentionally left blank so `Start` surfaces a clear error until the user sets
it via the Edit dialog.

**Process lifecycle** (`app.go`): `StartLocal` resolves the `node` executable
(checking PATH first, then the login shell's PATH — necessary on macOS/Linux where
GUI apps get a stripped environment), opens a log file per instance, and calls
`exec.Command` with `detach(cmd)` applied before `cmd.Start`. The server writes
its stdout/stderr directly to the log file — not a pipe to the launcher — so the
server keeps running after the launcher exits. A goroutine tails the log file and
streams lines to the frontend via a Wails runtime event (`raven:log`).

`StopLocal` calls `terminateGroup(pid)`, polls `alive(pid)` for up to 5 seconds,
then calls `killGroup(pid)` if the process is still present. The escalation ensures
the port is free before the function returns, which matters for Restart.

**Running-state persistence** (`app.go`): a `running.json` file in the same
config directory maps instance IDs to PIDs. On startup, for each saved PID the
launcher checks (1) the process is alive, _and_ (2) the instance's port is actually
serving (`Ping`). The second check guards against PID reuse after a reboot, where
the saved PID may now belong to an unrelated process. Only if both checks pass does
the launcher re-adopt the server and resume tailing its log.

**OS-conditional process management**: process tree handling differs enough between
Windows and POSIX that it is split into two build-tagged files.

On Windows (`proc_windows.go`):
- `detach`: sets `CREATE_NEW_PROCESS_GROUP` on the child's creation flags.
- `terminateGroup` / `killGroup`: both call `taskkill /F /T /PID <pid>`, which
  force-kills the entire process tree. The web server spawns `node-pty` child
  processes; a plain `TerminateProcess` on the parent leaves them orphaned and
  holding the port.
- `alive`: queries `tasklist /FI "PID eq <pid>"` to avoid `OpenProcess` permission
  issues.
- Helper processes (`tasklist`, `taskkill`) are spawned with `CREATE_NO_WINDOW`
  because the launcher is a GUI process with no console: without this flag each
  helper call flashes a console window, which is visible on every 4-second status
  poll.
- `loginShellEnv` / `nodeFromLoginShell` are no-ops: Windows GUI apps already
  inherit the full user environment, so `os.Environ()` and PATH lookup suffice.

On Unix (`proc_unix.go`):
- `detach`: sets `Setpgid: true` so the child gets its own process group.
- `terminateGroup`: `kill(-pgid, SIGTERM)` — negative PID addresses the group.
  This gives the server a chance to clean up its own child processes.
- `killGroup`: `kill(-pgid, SIGKILL)` as fallback.
- `alive`: `kill(pid, 0)` — signal 0 probes existence without sending a signal.
- `loginShellEnv`: spawns `$SHELL -lic` with a marker-bracketed `env` call to
  capture the login shell's full environment. The markers (`__RAVEN_ENV_BOUNDARY__`)
  strip interactive startup noise (banners, prompts) that some shells print before
  the actual env output.
- `nodeFromLoginShell`: spawns `$SHELL -lic "command -v node"` with a 5-second
  timeout and scans the output from the end (profile noise appears first) to find
  the resolved path. Handles nvm/fnm/homebrew setups that add node to PATH only
  inside the shell profile.

**Wails wiring** (`main.go`): the app intentionally has no `OnShutdown` hook. The
comment makes the decision explicit: started servers are detached and meant to
outlive the app; they are re-adopted on next launch.

## Gotchas

**PID reuse after reboot.** A saved PID that is alive is not necessarily the right
process. The launcher re-adopts only if `alive(pid) && Ping(id)` both pass —
process exists _and_ the expected port is serving.

**Process tree on Windows.** `node server.js` itself is not the only process that
holds the port; `node-pty` forks additional node children. Killing only the parent
leaves the port occupied. `taskkill /F /T` (tree-kill) is mandatory on Windows;
`SIGTERM` to the process group covers this on Unix.

**Console window flashing on Windows.** Any subprocess spawned from a GUI process
(no console) pops a console window unless `CREATE_NO_WINDOW` is set. This includes
diagnostic calls like `tasklist` that run on every status-poll tick — the flashing
is continuous and immediately visible.

**GUI PATH is not the terminal PATH on macOS/Linux.** Apps launched from the dock
or file manager inherit a minimal environment that typically lacks nvm, homebrew,
or fnm on its PATH. Resolving `node` via the login shell (`$SHELL -lic "command -v
node"`) is the correct fix; falling back to `os.Environ()` silently fails for most
developer setups.

**Login shell startup noise.** Interactive shell flags (`-i`) source `.zshrc` /
`.bashrc`, which may print banners or run commands that emit text before `env`.
Using boundary markers to extract only the region between two known strings is more
reliable than stripping leading lines by count.

**iframe state preservation.** Each iframe is created once and toggled visible/
hidden via CSS. Never remove and re-add the iframe for switching: that reloads the
page, discards terminal buffers, and drops WebSocket connections. The `display:
none` toggle is sufficient and free.

**Server log via file, not pipe.** Redirecting the child's stdout/stderr to a pipe
means the pipe's read-end must stay open. When the launcher exits, the read-end
closes, and the server gets `EPIPE` on its next write — killing it. Write to a log
file instead and tail the file from the launcher. The child holds its own file
handle; the launcher's handle can be closed immediately after `cmd.Start`.
