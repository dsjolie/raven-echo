# A Long-Lived Server Inherits Its Ancestor's Environment

A local web server that spawns terminals, agents and helper processes passes its own environment to every child. Its environment came from whatever launched it, and that launcher's environment came from *its* parent. Two separate bugs in Raven had this shape. In both, restarting the server did not fix anything.

## Case 1: two definitions of "home" on a domain-joined machine

### Symptom

On a Windows machine joined to an organisation's domain, the guard hook ignored the mode it had just been set to, a statusline plugin silently vanished, and several scripts failed naming a path on a network drive. Nothing was wrong with any of the code.

### Cause

Git Bash derives `HOME` from the directory service's home-directory attribute, which on a managed machine points at a network share. Node's `os.homedir()`, Python and PowerShell all use `USERPROFILE`, the local profile. So `~/.claude` names two different directories depending on which process asks. The guard's toggle script (Bash) wrote the mode file under the share, and the guard hook (Node) read it from the profile, found nothing, and fell back to the default mode. A third-party plugin located its own install through `$HOME`, globbed the share, matched nothing, and rendered nothing.

### Fix

Fix `HOME` at the machine, once: set it as a user environment variable pointing at the profile, move the files that tools store under it (git config, SSH known hosts) off the share, and open a *new* terminal.

Two things turned out to matter more than the fix:

- **Per-script compensation was reverted.** The first fix taught eight call sites to prefer `USERPROFILE`. It shipped and was then reverted, because four of the five affected scripts already failed hard, naming the network path. That was the best diagnostic the setup had, and the patch's whole effect was to make a misconfigured machine look healthy. The one script that failed *quietly* (the toggle writing where the hook never reads) now compares the two homes and exits non-zero, pointing at the machine-level fix. Node code keeps `os.homedir()`, because it is the correct platform API and not a workaround.
- **"Open a new terminal" reaches further than it sounds.** A web-UI terminal went on reporting the share path long after the variable was correct. The terminal's PTY inherits from the web server, the server inherits from the desktop app that launched it, and that app had been started before the change. It pins the old environment for every process it will ever spawn. Restarting the server did nothing. The process to restart was the launcher.

The tell: if `echo $HOME` in a fresh OS terminal and in a web-UI terminal disagree, the answer is in an ancestor process, not in the variable.

## Case 2: a server started from inside an agent session

### Symptom

Every agent launched from the web UI's terminals ran as if it were a nested child session, with transcript saving turned off. That included the persistent coordinator session, whose transcript is what gets resumed after a restart.

### Cause

The server is routinely started from a terminal that is itself an agent session. The restart script is designed to be run from a terminal the server spawned. The agent runtime sets environment variables that identify the running session, and the server copied its environment into every PTY. A `claude` launched there saw the markers and concluded it was nested.

Two things made this worse than cosmetic:

- One of the inherited variables was a **credential** for the parent session's IPC socket, handed to every shell the server spawned.
- The server's in-UI restart **respawns itself from its own environment**, so a tainted server re-tainted its successor indefinitely. It cleared only when the whole process tree died.

### Fix

Scrub the session-identifying variables once, at server startup, before any module loads:

```javascript
// Top of server.js, above the requires.
// These name a specific *running* agent session; a server is never one.
for (const k of INHERITED_SESSION_MARKERS) delete process.env[k];
```

Decisions that matter:

- **At startup, not at each spawn site.** Scrubbing in the PTY factory would miss the other five places the server spawns processes (TTS, the task CLI, status scripts, the editor launcher, the self-respawn), plus any added later. Scrubbing the server's own environment covers all of them and breaks the respawn cycle.
- **Above the requires**, so no module captures a stale value at load time.
- **A fixed list, not a `CLAUDE*` wildcard.** Some variables with the same prefix are configuration a terminal *should* inherit (the config directory, provider selection, the binary path). Only the ones that name a specific running session are removed.
- **Unconditional.** The leak happens on every OS.

It was verified through the real PTY path from a deliberately tainted session: ten session variables reached the child before the fix, and only the binary path after.

## The common lesson

Both bugs come from treating a restart as a reset. A long-lived process's environment is a snapshot of an ancestor's, taken when it started, and a self-respawn copies the snapshot forward. When environment-dependent behaviour survives a restart, walk up the process tree before you touch the variable.

## Related

- [pwd-p4-leak.md](pwd-p4-leak.md) — the same family: an inherited `PWD` overriding a tool's real working directory.
- [cross-platform.md](cross-platform.md) — other portability seams between clones.
