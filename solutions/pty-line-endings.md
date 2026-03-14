# PTY Line Endings on Windows

## Problem

Sending input to a pseudo-terminal (node-pty) on Windows. The natural instinct is to send `\r\n` (carriage return + line feed) because Windows uses CRLF line endings. But this causes the shell (PowerShell) to show a continuation prompt `>>` instead of executing the command.

## Fix

Send `\r` only, not `\r\n`.

```javascript
// Wrong — causes continuation prompt
pty.write(command + '\r\n');

// Correct — executes normally
pty.write(command + '\r');
```

## Why

A PTY emulates a terminal device, not a file. Terminal devices interpret `\r` as "submit this line." The PTY driver converts `\r` to the appropriate line ending for the host OS. When you send `\r\n`, the PTY sees two line ending signals — the `\r` submits an empty line or triggers the continuation prompt, and the `\n` is interpreted as another newline.

This is specific to node-pty on Windows. On Unix, `\r` and `\n` are both handled, but `\r` is the canonical "submit" character in terminal raw mode.
