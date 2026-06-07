#!/usr/bin/env python3
"""raven-gitlock — a mandatory, advisory commit-lock for multi-session safety.

When two Claude sessions share one clone (one working tree + index + HEAD), a
`git commit --amend` or concurrent staging can catch the wrong commit. This lock
serialises the stage->commit sequence across sessions: a session must hold the
lock before any index/HEAD-mutating git command. The raven-guard PreToolUse hook
enforces it; this CLI is how a session acquires/releases/inspects it.

Identity = CLAUDE_CODE_SESSION_ID (the same value the hook reads from its payload).
Lock file = <repo-root>/.git/raven-commit.lock (per-clone, untracked, JSON).

Subcommands:
  acquire        claim the lock for this session (fails if another holds it)
  release        release it (only the owner; --force to clear a stale lock)
  status         show holder or "free"

v1 deliberately has NO stale-lock TTL — rare, and `release --force` (or deleting
the file) is the manual fix. See docs/failure-log.md 2026-05-28.
"""
import os
import sys
import json
import datetime


def find_repo_root(start=None):
    d = os.path.abspath(start or os.getcwd())
    while True:
        git = os.path.join(d, ".git")
        if os.path.isdir(git) or os.path.isfile(git):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def lock_path(root):
    return os.path.join(root, ".git", "raven-commit.lock")


def my_id():
    return os.environ.get("CLAUDE_CODE_SESSION_ID", "")


def read_lock(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def short(s):
    return (s or "?")[:8]


def cmd_acquire(p):
    sid = my_id()
    if not sid:
        print("error: CLAUDE_CODE_SESSION_ID not set; cannot identify this session", file=sys.stderr)
        return 1
    cur = read_lock(p)
    if cur:
        if cur.get("owner") == sid:
            print(f"already held by this session (since {cur.get('acquired_at')})")
            return 0
        print(f"LOCKED by another session (owner {short(cur.get('owner'))}, since "
              f"{cur.get('acquired_at')}). Wait and retry; do not steal another session's lock.",
              file=sys.stderr)
        return 1
    data = {
        "owner": sid,
        "acquired_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "cwd": os.getcwd(),
    }
    try:
        fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        cur = read_lock(p)
        print(f"LOCKED by another session (race on acquire; owner {short((cur or {}).get('owner'))}).",
              file=sys.stderr)
        return 1
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"acquired (session {short(sid)})")
    return 0


def cmd_release(p, force):
    sid = my_id()
    cur = read_lock(p)
    if not cur:
        print("no lock to release (free)")
        return 0
    if cur.get("owner") != sid and not force:
        print(f"refusing: lock owned by {short(cur.get('owner'))}, not this session. "
              f"Use --force to clear a stale lock.", file=sys.stderr)
        return 1
    try:
        os.remove(p)
    except FileNotFoundError:
        pass
    print("released")
    return 0


def cmd_status(p):
    cur = read_lock(p)
    if not cur:
        print("free")
        return 0
    mine = " (this session)" if cur.get("owner") == my_id() else ""
    print(f"held by {cur.get('owner')}{mine} since {cur.get('acquired_at')} (cwd={cur.get('cwd')})")
    return 0


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    sub = argv[0]
    root = find_repo_root()
    if not root:
        print("error: not inside a git repository", file=sys.stderr)
        return 1
    p = lock_path(root)
    if sub == "acquire":
        return cmd_acquire(p)
    if sub == "release":
        return cmd_release(p, force="--force" in argv)
    if sub == "status":
        return cmd_status(p)
    print(f"unknown subcommand: {sub} (use acquire|release|status)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
