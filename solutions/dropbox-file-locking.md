# Build and Write Failures from Cloud Sync File Locking

## Problem

Two distinct failure modes arise when a code repo lives inside a cloud-synced folder
on Windows:

**1. Build tool failures ("os error 32").**
Build tools that write many files quickly (static site generators, compilers, bundlers)
hit sharing violations because the sync client locks a file for upload at the same
moment the tool is trying to write it. The error is intermittent and timing-dependent,
which makes it hard to diagnose — the build works most of the time and the error
message doesn't mention the sync service.

**2. Orphaned temp files from atomic writes.**
Tools that write atomically — write to a `.tmp.<pid>.<timestamp>` sibling, then rename
it over the target — can leave those temp files behind on Windows. The mechanism: the
rename (`MoveFileEx`) fails if the sync client has a transient lock on the target file
during that window. On Unix, rename is atomic across open handles and the temp vanishes
in microseconds. On Windows it isn't, so the rename can fail partway, leaving the temp
sibling orphaned in the working tree. Any frequently-edited file is a candidate: config
files, task lists, source files touched on every session.

Both failure modes are caused by the same underlying condition: the sync client holds
file handles on actively-edited files.

## Fix

### Pause sync around build windows

Stop the sync client before a build, restart after:

```bash
# dropbox_stop.sh — kills the sync process
if tasklist 2>/dev/null | grep -qi "Dropbox.exe"; then
  taskkill //F //IM Dropbox.exe //T >/dev/null 2>&1
fi

# dropbox_start.sh — relaunches it
if ! tasklist 2>/dev/null | grep -qi "Dropbox.exe"; then
  cmd //c start "" "C:\Program Files (x86)\Dropbox\Client\Dropbox.exe" /home
fi
```

Usage:

```bash
./dropbox_stop.sh
quarto render        # or any heavy build
./dropbox_start.sh
```

### Clean up orphaned temp files

A periodic cleanup script removes `.tmp.<pid>.<timestamp>` debris. Key safety
properties: dry-run by default (`--apply` to actually delete), minimum-age filter
(default 5 minutes, avoids racing with in-flight writes), strict regex so it only
matches the sync-orphan pattern and never touches generic temp files, skips symlinks
entirely:

```bash
# dry-run: see what would be deleted
python scripts/clean-dropbox-tmp.py

# actually delete files older than 5 minutes
python scripts/clean-dropbox-tmp.py --apply

# scan a specific directory
python scripts/clean-dropbox-tmp.py --path path/to/dir --apply
```

The regex it matches: `<something>.tmp.<digits>.<digits>` — the exact pattern produced
by the sync-orphan failure mode. Nothing else is touched.

## Why the two problems need separate fixes

Pausing the sync client eliminates both failure modes during the pause window, but it
also halts sync for all content on the device — a broad trade-off acceptable for a
short build but wrong as a permanent posture for a repo that is also your cross-device
working copy.

The cleanup script addresses the atomic-write debris without touching sync at all. It
runs after the fact, so it can't prevent the write failure — but for tools where a
failed atomic write is retried automatically, the debris is the main practical problem.
Together, the two scripts cover different threat surfaces: pause sync for builds, sweep
debris for routine file churn.

## Alternatives

- **Exclude temp-file patterns from sync.** Most sync clients support gitignore-style
  ignore rules (e.g., `rules.dropboxignore` for Dropbox). Adding `**/*.tmp.*` means
  the client never tries to sync the temp sibling, so it never takes a lock on it, so
  the rename succeeds. This is the least-invasive fix and should be tried first —
  note that ignore-rule files are per-device and don't sync themselves.

- **Exclude build output directories.** If build output goes to a dedicated directory
  (`_site/`, `dist/`, `build/`), exclude that directory from sync. The sync client
  won't watch those paths and can't race with the build tool. Source files stay synced;
  generated output doesn't need to be.

- **Build outside the synced tree.** Build in a temp directory on a local-only drive,
  copy artifacts back after. Fully eliminates the race condition at the cost of a
  more complicated build script.

## Generalizing the pattern

Any code that does atomic writes (write-temp-then-rename) or heavy file churn inside a
cloud-sync folder must account for the sync client holding file handles. The sync client
is not doing anything wrong — it is doing exactly what it is supposed to do. The race is
architectural: two processes (your tool and the sync client) are both watching and
writing the same directory tree, with no coordination between them.

The practical hierarchy:
1. Ignore rules — narrowest scope, prevents the sync client from ever touching the
   problem files. Best starting point.
2. Pause sync for build windows — broader scope, solves everything during the window,
   adds scope bleed (all sync pauses, not just this tree).
3. Post-build or periodic cleanup — handles the debris that slips through; doesn't
   prevent the underlying write failure, but keeps the working tree clean.
