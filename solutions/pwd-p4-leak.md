# MSYS PWD Leak into Spawned Shells

## Problem

A web UI server is launched from a Git Bash / MSYS2 terminal. The Node.js
process inherits an MSYS-style `PWD` environment variable (e.g.
`/e/project/web-ui` — a POSIX-form path). When the server spawns PowerShell
terminals via node-pty, that `PWD` is passed through unchanged into every
child shell's environment.

PowerShell itself ignores `PWD` — it tracks the working directory internally
and doesn't read or write that variable. But native Windows tools that walk
the directory tree to locate config files often trust `PWD` over the shell's
actual current directory. The result: a user opens a terminal, navigates to
a project directory, and a config-aware tool reports "no config found" or
wrong-context state — because it's walking up from the MSYS path in `PWD`
instead of the real path.

The symptom appears intermittently: it only manifests when the server was
launched from a POSIX-style shell, not when launched from PowerShell or a
plain cmd.exe context.

## Fix

Strip `PWD` and `OLDPWD` from the environment passed to each spawned shell on
Windows, before calling `pty.spawn`:

```javascript
const childEnv = { ...process.env, /* other additions */ };

if (IS_WIN) {
  delete childEnv.PWD;
  delete childEnv.OLDPWD;
}

const ptyProcess = pty.spawn(SHELL, SHELL_ARGS, {
  cwd: initialCwd,
  env: childEnv,
  // ...
});
```

Per-shell manual unblock (without restarting the server):

```powershell
Remove-Item Env:\PWD
```

## Why

POSIX shells maintain `PWD` as a contract: every `cd` updates it, and tools
can rely on it as a canonical representation of the working directory. Windows
is different — `PWD` has no standard meaning, and Windows shell sessions don't
maintain it. But some cross-platform tools are written with the POSIX contract
in mind and read `PWD` as the authoritative cwd signal, falling back to OS
APIs only when `PWD` is absent.

When the server process is launched from Git Bash or any MSYS2-based terminal,
`process.env.PWD` holds the MSYS-form path of whichever directory the server
was *started* from — not the terminal's current directory. That stale path
propagates silently into every spawned child. Tools that trust it get the
wrong starting point for directory-tree walks, config-file discovery, and
any other cwd-relative operation.

Stripping `PWD` and `OLDPWD` forces those tools to fall back to the OS-level
cwd, which node-pty sets correctly via the `cwd` option on `pty.spawn`. POSIX
shells running inside the PTY re-establish `PWD` themselves on the first `cd`
anyway, so the strip has no adverse effect in those shells either.

## Generalisation

Whenever a server process can be launched from different shell contexts
(POSIX-style vs. native Windows), its child-process environment is a mixture
of conventions from whichever shell launched it. Variables like `PWD` that are
*maintained as invariants* in one environment become *stale noise* in another.

Before spawning any child shell, audit the inherited environment for variables
that:

- Are actively maintained by POSIX shells but not by Windows shells (`PWD`,
  `OLDPWD`, `SHLVL`)
- Would be trusted by downstream tools over the actual working directory

Strip or reset those variables at the spawn boundary rather than relying on
every downstream tool to handle them gracefully.

The test: open a terminal via the server, navigate (`cd`) to a project
directory, and check that config-aware tools see the right context. If they
report "no config" when a config file clearly exists in the tree, check
`$env:PWD` in that PowerShell session — if it's set to a path you didn't
navigate to, the inherited env hasn't been cleaned.

## Related

- [pty-line-endings.md](pty-line-endings.md) — a separate node-pty issue on
  Windows: `\r\n` vs `\r` for command submission in PowerShell
- [windows-shell-quirks.md](windows-shell-quirks.md) — broader collection of
  Windows-specific shell environment surprises
