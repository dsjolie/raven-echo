#!/usr/bin/env python3
"""Sync the CC runtime MEMORY.md index with the git-mastered repo copy.

Master:  <repo>/memory/MEMORY.md          (git-tracked, canonical, fleet-shared)
Runtime: ~/.claude/projects/<key>/memory/MEMORY.md  (auto-loaded by CC)

The runtime file is the master content plus an optional per-machine local
section below a marker line. Everything above the marker is "shared" and must
converge with the master; everything below stays on this machine.

Commands:
  status   Compare runtime shared part against master. Exit 0 in sync, 1 drift.
  pull     Overwrite runtime shared part with master, preserving the local
           section. Creates the runtime file (new clone) if absent. The old
           runtime file is backed up to memory/cc-snapshot/MEMORY.pre-pull.md.
  push     Overwrite master with the runtime shared part (hub shortcut when
           runtime is strictly ahead). Git history is the backup.

Promotion judgment (which runtime-side changes belong in master vs the local
section) is agent work at consolidate time — this script only compares and
projects. See raven-consolidate SKILL.md and knowledge/topics/memory-index-sync.md.
"""
import difflib
import json
import socket
import sys
from pathlib import Path

# Windows consoles default to cp1252; memory files carry arrows/em-dashes.
# Established convention: CLIs handle UTF-8 internally (feedback_pythonutf8_internal).
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[3]
MASTER = REPO / "memory" / "MEMORY.md"
BACKUP = REPO / "memory" / "cc-snapshot" / "MEMORY.pre-pull.md"
# CC keys runtime memory by project path, with separators flattened to dashes.
KEY = str(REPO).replace(":", "-").replace("\\", "-").replace("/", "-")
RUNTIME = Path.home() / ".claude" / "projects" / KEY / "memory" / "MEMORY.md"

def machine_name() -> str:
    """Friendly name from known-machines.json, falling back to hostname."""
    host = socket.gethostname()
    try:
        machines = json.loads((REPO / "known-machines.json").read_text(encoding="utf-8"))
        return machines.get(host, {}).get("name", host)
    except (OSError, json.JSONDecodeError):
        return host


MARKER_PREFIX = "<!-- ==== LOCAL SECTION"
MARKER_LINE = (
    "<!-- ==== LOCAL SECTION — entries below stay on this machine "
    f"({machine_name()}); everything above is mastered in "
    "Raven/memory/MEMORY.md ==== -->"
)


def split_runtime(text: str) -> tuple[str, str]:
    """Return (shared, local) where local includes the marker line."""
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith(MARKER_PREFIX):
            return "".join(lines[:i]), "".join(lines[i:])
    return text, ""


def normalize(text: str) -> str:
    return text.replace("\r\n", "\n").rstrip() + "\n"


def status() -> int:
    if not MASTER.exists():
        print(f"master missing: {MASTER} (run push from a machine with a good runtime index)")
        return 1
    if not RUNTIME.exists():
        print(f"runtime missing: {RUNTIME} (run pull to project the master)")
        return 1
    shared, local = split_runtime(RUNTIME.read_text(encoding="utf-8"))
    m, s = normalize(MASTER.read_text(encoding="utf-8")), normalize(shared)
    if m == s:
        print(f"in sync ({len(s.splitlines())} shared lines; "
              f"local section: {'yes' if local else 'none'})")
        return 0
    diff = difflib.unified_diff(
        m.splitlines(keepends=True), s.splitlines(keepends=True),
        fromfile="master (repo memory/MEMORY.md)",
        tofile="runtime shared part",
    )
    sys.stdout.writelines(diff)
    print("\ndrift — reconcile (promote runtime-side changes into master, or move "
          "them below the local marker), then pull.")
    return 1


def pull() -> int:
    if not MASTER.exists():
        print(f"master missing: {MASTER} — nothing to pull")
        return 1
    local = ""
    if RUNTIME.exists():
        _, local = split_runtime(RUNTIME.read_text(encoding="utf-8"))
        BACKUP.parent.mkdir(parents=True, exist_ok=True)
        BACKUP.write_text(RUNTIME.read_text(encoding="utf-8"), encoding="utf-8")
    if not local:
        local = MARKER_LINE + "\n"
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME.write_text(
        normalize(MASTER.read_text(encoding="utf-8")) + "\n" + local,
        encoding="utf-8",
    )
    print(f"pulled master -> {RUNTIME}"
          + (f" (previous runtime backed up to {BACKUP})" if BACKUP.exists() else ""))
    return 0


def push() -> int:
    if not RUNTIME.exists():
        print(f"runtime missing: {RUNTIME} — nothing to push")
        return 1
    shared, _ = split_runtime(RUNTIME.read_text(encoding="utf-8"))
    MASTER.parent.mkdir(parents=True, exist_ok=True)
    MASTER.write_text(normalize(shared), encoding="utf-8")
    print(f"pushed runtime shared part -> {MASTER} (commit it; git is the history)")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd not in ("status", "pull", "push"):
        print(__doc__)
        return 2
    return {"status": status, "pull": pull, "push": push}[cmd]()


if __name__ == "__main__":
    sys.exit(main())
