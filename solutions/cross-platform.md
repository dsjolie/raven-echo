# Cross-Platform Portability Gotchas for Personal Tooling

A personal tool that starts on one OS and later runs on a second tends to fail at small
seams, not big structural ones. The filesystem works, the language runtimes work, the
repo clones cleanly — then something quietly breaks because of a flag difference or a
naming collision. This document records the specific seams that have bitten in practice.

---

## BSD sed vs GNU sed: `-i` requires an explicit backup suffix

**Problem:** `sed -i 's/old/new/' file` works on Linux and Git Bash (GNU sed) but fails
on macOS (BSD sed) with a parse error, or silently clobbers the file depending on the
macOS version.

**Fix:** Either branch explicitly on platform, or — better — avoid in-place `sed`
entirely in cross-platform scripts and use Python or a write-then-replace idiom instead.
If you must use `sed -i`, the portable form requires an explicit backup suffix argument
on BSD:

```bash
# GNU (Linux / Git Bash)
sed -i 's/old/new/' file

# BSD (macOS)
sed -i '' 's/old/new/' file

# Portable branch
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i 's/old/new/' file
else
  sed -i '' 's/old/new/' file
fi
```

**Why:** BSD `sed` treats `-i` as taking a mandatory argument (the backup suffix). GNU
`sed` treats it as an optional argument with an implicit empty suffix. The two conventions
are source-incompatible: on BSD, `sed -i 's/...' file` parses `'s/...'` as the backup
suffix and `file` as the script — it either errors or corrupts the file. Passing `''` as
an explicit empty suffix is safe on BSD; GNU `sed` accepts it too, so `sed -i ''` is the
lowest-common-denominator form if you want a single line, though it reads strangely.

---

## Multi-machine identity: hostname → clone name mapping

**Problem:** When several machines clone the same repository and write git-tracked
per-machine state files (e.g. `state/machines/<clone>/session.md`), you need a stable,
human-readable name for "the machine I am currently running on." Raw OS hostnames work as
unique keys but are often opaque (`DESKTOP-LH3I1D9`, `MacS-XXXXXXX`) and expose hardware
or institutional detail you may not want in a public repo.

**Fix:** Keep a `known-clones.json` at the repo root that maps each hostname to a
friendly clone name:

```json
{
  "HOSTNAME-A": { "name": "home" },
  "HOSTNAME-B": { "name": "laptop" }
}
```

Scripts resolve the current machine's identity by looking up `os.hostname()` (Node) or
`socket.gethostname()` (Python) in this map, falling back to the raw hostname if the
machine is not yet registered. Per-machine state files are written under the friendly
name, so paths like `state/machines/home/session.md` are stable across reboots and
readable without knowing the hardware.

**Why:** Hostnames change (after a reinstall, a domain join, a VM rename). Friendly names
don't — they reflect the human mental model ("my home machine", "my work laptop"). The
map also doubles as the registry for onboarding new clones: adding an entry to
`known-clones.json` is the explicit, reviewable act of "this machine is now part of the
fleet." Files named after raw hostnames scatter opaque strings through git history;
friendly names stay readable.

**Privacy note:** `known-clones.json` maps raw hostnames to friendly names. If hostnames
contain institutional or personal identifiers, the file should be gitignored (and
distributed by other means) or the sensitive entries redacted before publishing. The
friendly names themselves are safe.

---

## OS-conditional UI labels: "Finder" vs "Explorer"

**Problem:** A web UI shows a button to open a project folder in the system file browser.
On macOS the correct name is "Finder"; on Windows it is "Explorer". Using the wrong name
is a minor annoyance, but it signals that the tool was written for one platform and
ported carelessly.

**Fix:** Detect the client OS from the browser side and switch the label accordingly:

```js
const isMac = navigator.platform.toUpperCase().includes('MAC');
const label = isMac ? 'finder' : 'explorer';
const title = isMac ? 'Open in Finder' : 'Open in Explorer';
```

On the server side, the corresponding process launch is also OS-conditional:

```js
const opener = process.platform === 'win32' ? 'explorer.exe'
  : process.platform === 'darwin' ? 'open'
  : 'xdg-open';
spawn(opener, [folderPath], { detached: true, stdio: 'ignore' }).unref();
```

**Why:** The browser-side and server-side branches are separate concerns — the label is
cosmetic, the opener is functional. Both need branching; a mismatch (correct label, wrong
opener) produces broken behavior that looks like a server bug. Putting both branches in
proximity and deriving them from the same platform check makes the coupling explicit.

---

## Venv layout: `Scripts/` vs `bin/`

**Problem:** Python virtual environments on Windows use `<venv>/Scripts/python.exe`;
on macOS/Linux they use `<venv>/bin/python`. Node.js code that calls the venv Python by
constructing the path directly gets it wrong on one platform or the other.

**Fix:** Branch on `process.platform`:

```js
const subdir = process.platform === 'win32' ? 'Scripts' : 'bin';
const ext    = process.platform === 'win32' ? '.exe'    : '';
const python = path.join(venvRoot, subdir, `python${ext}`);
```

For shell activation scripts, a single cross-platform script can branch on `$OSTYPE` or
check for the `Scripts/` directory's existence:

```bash
if [ -d "$VENV/Scripts" ]; then
  source "$VENV/Scripts/activate"
else
  source "$VENV/bin/activate"
fi
```

**Why:** The `Scripts` / `bin` split is a Python venv convention, not a filesystem
accident. Hardcoding either form silently fails on the other platform — `fs.existsSync`
returns false, the fallback lands on the system Python, and the wrong packages are
loaded. The `process.platform` check is the minimal correct fix.

---

## Skill sync: junctions (Windows) vs symlinks (macOS/Linux)

**Problem:** The skill-sync pattern links skill directories from a central repo into
`~/.claude/skills/` (and per-project `.claude/skills/` dirs) so that Claude Code can
discover them without duplicating files. Windows requires NTFS junctions (`mklink /J`);
macOS and Linux use POSIX symlinks (`Path.symlink_to()`). The underlying data model is
the same; only the OS call differs.

**Fix:** Detect platform in the sync script and dispatch accordingly:

```python
IS_WINDOWS = platform.system() == "Windows"

def create_link(link_path, source):
    if IS_WINDOWS:
        subprocess.run(["cmd", "/c", "mklink", "/J",
                        str(link_path), str(source)], check=True)
    else:
        link_path.symlink_to(source)
```

Verification also differs: POSIX `ls -la` shows `name -> target`; Windows junctions
appear as directories and `Path.is_symlink()` returns `False` for them, so junction
detection needs a separate check (`os.readlink` succeeds on a junction).

**Why:** Junctions are a Windows-only concept that predate symlinks on NTFS and don't
require Developer Mode or admin rights (unlike directory symlinks on Windows). On
macOS/Linux, POSIX symlinks are the natural equivalent. Treating them as equivalent
in the sync logic — same config, same commands, different OS dispatch — keeps the skill
registry portable without any per-platform config.

---

## macOS bootstrap: two files that must exist before sync scripts run

**Problem:** On a fresh macOS clone, two sync scripts fail before doing anything useful
because they unconditionally reference files that don't yet exist on a brand-new machine.

1. The skill-sync script calls a project-registry loader at startup — if the registry
   file is absent (it is gitignored, so a fresh clone never has one), the script exits
   with `FileNotFoundError` before linking a single skill.

2. The principles-sync script checks for the global `~/.claude/CLAUDE.md` in a preflight
   and exits with an error if absent. A fresh Claude Code install may not have created it
   yet.

**Fix:** Create both files before running sync on a new machine:

```bash
# Minimal project registry (add real entries later)
[ -f projects.json ] || echo '[]' > projects.json

# Ensure global CC instructions file exists
[ -f ~/.claude/CLAUDE.md ] || printf '# Global CLAUDE.md\n' > ~/.claude/CLAUDE.md
```

**Why:** Both scripts are designed for machines that already have a working setup — the
preflight checks are correct defensive programming for an established clone. They just
weren't tested against a genuinely blank slate. On Windows, both files tend to exist
because the machine was set up iteratively; on a fresh macOS clone cloned from the same
repo, neither exists. The fix is minimal: two guard lines at the start of the new-machine
setup sequence, before running any sync.

---

## Firewall: Windows auto-blocks, macOS one-time dialog

**Problem:** On Windows, if a Node.js server's firewall prompt is dismissed rather than
allowed, Windows automatically creates a Block rule for that executable. Block rules win
over port-based Allow rules, so the server is listening but unreachable from other
devices — no connection refused, just silence. The symptom is indistinguishable from the
server being down.

On macOS the failure mode is different and milder: the Application Firewall (off by
default) shows a one-time "allow incoming connections?" dialog on first bind. Canceling
it means LAN access is blocked until the setting is changed, but there is no equivalent
auto-generated Block rule.

**Fix (Windows):** Check for and remove auto-generated Block rules, then add a scoped
Allow rule for the server port:

```cmd
netsh advfirewall firewall show rule name="node.exe" verbose
netsh advfirewall firewall delete rule name="node.exe"
netsh advfirewall firewall add rule name="Web UI - LAN" dir=in action=allow ^
  protocol=TCP localport=3000 remoteip=10.0.0.0/24 profile=any
```

Use `remoteip` scoping rather than a fully open rule. Note: a Node version upgrade via a
version manager changes the `node.exe` path, which Windows treats as a new binary —
the Allow dialog fires again.

**Fix (macOS):** Click Allow on the one-time dialog. If missed, add `node` to
System Settings → Network → Firewall → Options.

**Why (Windows):** Windows Firewall's auto-block is a security default — it blocks
executables that bind ports without explicit Allow rules. The auto-created Block rule is
specifically for the executable, not the port, so a port-based Allow rule doesn't
override it. `profile=any` on the Allow rule prevents it from silently disabling when
Windows reclassifies a Wi-Fi or VPN adapter between Public and Private.

---

## Cross-references

- [windows-shell-quirks.md](windows-shell-quirks.md) — path separators, CRLF, null
  redirection, and other Windows-specific shell issues
- [venv-node-integration.md](venv-node-integration.md) — Python venv path resolution in
  Node.js subprocesses
- [process-lifecycle.md](process-lifecycle.md) — process-tree management across platforms
