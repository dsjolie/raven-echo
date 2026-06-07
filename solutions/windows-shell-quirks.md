# Windows Shell Quirks for Agent Development

Concrete, reproducible issues when building AI agent tooling on Windows with Git Bash,
PowerShell, and Node.js — each with the fix and the underlying reason.

---

## Path-format consistency for file-tracking tools

**Problem:** A file read as `D:/project/file.txt` (forward slashes, Git Bash style) then
written or edited as `D:\project\file.txt` (backslashes, Windows style) fails with
"file not found" or "file has been unexpectedly modified" — even though no external
change occurred.

**Fix:** Pick one slash convention and use it for every operation on the same file within
a single session. Backslashes work reliably across Windows tools; forward slashes work
within Git Bash. Mixing them within the same tool call sequence is what breaks things.

**Why:** These tools track file identity by exact path string, not by filesystem inode.
`D:/project/file.txt` and `D:\project\file.txt` resolve to the same bytes on disk, but
the tool sees two different strings and treats them as two different files. The read
populates a slot under one key; the subsequent write looks up the other key, finds
nothing, and refuses.

---

## CRLF line endings break exact-string edits

**Problem:** An edit operation that replaces a precisely quoted string fails to find the
string in a file that was just successfully read — even though the content visually
matches. The error is something like "string not found" or "no match".

**Fix:** When a file has Windows line endings (`\r\n`), use the Write tool to rewrite it
in full once (which normalizes to LF). After that, targeted edits work normally. For
new files, create them with LF endings from the start.

**Why:** Many read tools normalize line endings on output — they strip the `\r` so the
displayed content looks like Unix text. Edit tools, however, operate on the raw bytes and
require a byte-exact match. If you copy a string from the normalized display and ask the
editor to find it, the `\r` bytes are still in the file but not in your search string, so
the match fails.

---

## Running .bat files from Git Bash

**Problem:** `.\script.bat` (backslash prefix) in Git Bash either fails silently or
triggers an error. The script never runs.

**Fix:** Use `./script.bat` (forward slash). Git Bash recognizes the forward-slash form
as a path, detects the `.bat` extension, and delegates to `cmd.exe` automatically.

**Why:** Git Bash interprets a leading backslash as an escape character, not a path
separator, so `.\script.bat` is not parsed as a relative file path. The forward-slash
form is unambiguous in the POSIX layer that Git Bash sits on, and `.bat` dispatch to
`cmd.exe` is built into Git Bash's execution model.

---

## Null redirection in Git Bash

**Problem:** `command 2>NUL` in a Git Bash script creates a literal file named `NUL` in
the current directory instead of discarding stderr.

**Fix:** Use `2>/dev/null`. This is the POSIX form; Git Bash maps `/dev/null` to the
Windows null device correctly.

**Why:** `NUL` is the Windows null device by convention in `cmd.exe` and PowerShell, but
it is not a special name in Git Bash's POSIX emulation layer. From Git Bash's perspective
`NUL` is just a filename, so the redirect creates a regular file. `/dev/null` is the
POSIX name, which Git Bash does understand and routes to the Windows null device.

---

## Agent permission prompts from cd-compounds and command substitution

**Problem:** Certain shell patterns trigger extra interactive permission prompts in agent
shells, interrupting automated flows. The two main triggers are `cd /some/path && command`
chains and `$(...)` command substitution embedded in arguments (e.g., inside a commit
message string).

**Fix:**
- For `cd` + command: run the command using an absolute or relative path directly, from
  the working directory the shell is already in. Avoid compound `&&` chains just to
  change directory.
- For `$(...)` in arguments: pass multi-line content via a variable or a flag that
  accepts literal text, rather than inline command substitution.

**Why:** Agent harnesses inspect each tool call for patterns associated with privilege
escalation or code injection risk. `cd /path &&` looks like a working-directory bypass;
`$(...)` in an argument looks like untrusted code injection into a shell context. Both
patterns are flagged at the structural level, independent of what they actually do in
this instance. Restructuring the invocation to avoid the syntactic trigger is more
reliable than trying to whitelist specific commands.

---

## Python console encoding (cp1252)

**Problem:** Python subprocesses called from Node.js produce garbled or errored output
when filenames or content contain non-ASCII characters (accented letters, emoji, etc.).

**Fix:** Set `PYTHONUTF8=1` in the subprocess environment. Brief cross-reference: the
full picture of venv resolution in Node.js subprocesses is in
[venv-node-integration.md](venv-node-integration.md).

**Why:** Windows defaults Python's standard I/O to the console code page, typically
cp1252. When Node.js reads subprocess stdout expecting UTF-8, the cp1252 bytes for
characters outside ASCII are misinterpreted. `PYTHONUTF8=1` forces Python's I/O to
UTF-8 regardless of the system locale, which is what the calling process expects.

---

## Cross-references

Related solution docs for issues that overlap with shell context:

- [venv-node-integration.md](venv-node-integration.md) — venv Python path resolution in
  Node.js `execFile` calls; encoding environment variables
- [pty-line-endings.md](pty-line-endings.md) — `\r` vs `\r\n` when writing to node-pty
  on Windows
- [process-lifecycle.md](process-lifecycle.md) — process-tree orphaning when stopping
  servers started via npm
- [dropbox-file-locking.md](dropbox-file-locking.md) — Dropbox sync locking build
  artifacts mid-write
