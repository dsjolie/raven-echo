# PTY Line Endings on Windows

## Problem

When programmatically injecting commands into a node-pty shell on Windows, the
obvious choice is `\r\n` — it's the standard Windows line ending. But sending
`\r\n` to a PowerShell PTY causes it to display `>>` (the line-continuation
prompt) and hang waiting for more input, rather than executing the command.

## Fix

Send `\r` alone for PowerShell and other Windows shells; use `\n` for POSIX
shells. Key: branch on the shell name, not on the OS.

```javascript
const lineEnd = shell.includes('powershell') ? '\r' : '\n';
ptyProcess.write(command + lineEnd);
```

## Why

A PTY is a terminal device, not a file or a pipe. Terminal devices work in
"raw mode": the *carriage return* (`\r`) is the submit key — it tells the
shell "execute what's on this line." The PTY driver owns translation between
what it receives and what the underlying process sees.

When you send `\r\n`, the driver delivers both characters. PowerShell sees the
`\r` and starts processing the line, then sees the `\n` and interprets it as a
request to continue on the next line — the same signal a user gets from
pressing Shift+Enter. Result: the `>>` continuation prompt.

Sending a bare `\r` avoids this entirely. The PTY driver passes it through as
the canonical submit signal and the shell executes immediately.

On POSIX (bash, zsh), `\n` is the conventional submit character in raw PTY
mode and works fine; `\r` also works, but `\n` is idiomatic and less
surprising.

## Generalisation

Whenever you inject text into a PTY — automated test runners, session
resumers, shell-driving agents — use the *submit key* for that shell, not a
file-level line ending:

| Shell       | Submit key |
|-------------|-----------|
| PowerShell  | `\r`      |
| cmd.exe     | `\r`      |
| bash / zsh  | `\n`      |

The test for correctness: after writing the command string, does the shell
execute it immediately? If you see `>>` or no prompt, the line ending is wrong.

## Related

A separate issue on Windows: the server process may inherit a `PWD` env var
set by MSYS/Git Bash (e.g. an MSYS-style path like `/e/project/web-ui`). Some
native Windows tools trust `PWD` over the actual working directory to locate
config files. Spawning PTY child processes without stripping `PWD` and
`OLDPWD` on Windows causes those tools to search the wrong directory tree.
Strip both variables from the child environment on Windows before calling
`pty.spawn`.
