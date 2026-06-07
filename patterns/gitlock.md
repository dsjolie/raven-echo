# Advisory Commit-Lock for Shared Git Clones

## Problem

When two agent sessions share one git clone, they share one working tree, one
index, and one HEAD pointer. This creates three concrete failure modes:

1. **Index cross-contamination.** Session A runs `git add file-a`; before it
   commits, Session B runs `git add file-b`. Both sessions now see each other's
   staged changes. Session A's commit ships B's work; Session B's commit ships
   A's.

2. **Amend-on-wrong-HEAD.** Session A commits, then Session B also commits and
   advances HEAD. Session A then runs `git commit --amend` — which amends
   whatever HEAD now points to, which is B's commit, not A's. The wrong commit
   gets rewritten.

3. **Merge/rebase state collision.** `git merge` and `git rebase` write
   in-progress state into `.git/MERGE_HEAD` or `.git/rebase-merge/`. Two
   concurrent merge operations corrupt each other.

All three stem from the same root: the git index and HEAD are a single mutable
shared resource, and nothing serialises writers by default.

## Approach

Introduce an advisory, per-clone commit-lock keyed on agent identity. A session
**acquires** the lock before any index- or HEAD-mutating git command, performs
its staging and commit sequence, then **releases** the lock. A PreToolUse hook
blocks any attempt to run a mutating git command without holding the lock,
providing both enforcement and a discovery path for sessions that haven't
adopted the protocol yet.

Key design decisions:

- **Advisory, not mandatory filesystem serialisation.** The lock is a JSON file
  in `.git/`, not an OS-level lock or a git hook that rejects pushes. The goal
  is cooperative coordination among agent sessions, not defence against
  adversarial actors. An OS-level approach would require kernel support and add
  complexity with no marginal benefit.

- **Fail-open.** If the session id is unavailable or the lock file is
  unreadable, the hook allows the command rather than blocking it. An advisory
  lock that bricks a repository because it encountered an unexpected state is
  worse than no lock at all.

- **Lock lives in `.git/`, not the working tree.** `.git/` is per-clone and
  never tracked by git, so the lock is invisible to commits, pushes, and other
  clones. It disappears on a fresh clone — appropriate, since a fresh clone has
  no competing sessions.

- **Read-only git and `push` are never gated.** `git status`, `git log`,
  `git diff`, and `git fetch` do not touch the index or HEAD. `git push` only
  talks to the remote; it does not mutate local index/HEAD. Gating these would
  add friction with no safety benefit.

- **No TTL in v1.** Stale locks (from a crashed session) are rare and are
  cleared manually with `release --force` or by deleting the lock file. Adding
  TTL expiry introduces a race: if expiry fires mid-commit-sequence, the next
  session acquires while the first is still staging, which is exactly the
  problem being prevented.

## Implementation

### Identity

Agent identity is `CLAUDE_CODE_SESSION_ID`, an environment variable set by the
harness in each session. Both the CLI tool and the hook read this value, so they
agree on identity without any additional registration step.

### Lock file

```
<repo-root>/.git/raven-commit.lock
```

JSON with three fields:

```json
{
  "owner": "<session-id>",
  "acquired_at": "2026-06-06T14:23:00+02:00",
  "cwd": "/absolute/path/at/acquire-time"
}
```

Both the CLI and the hook discover `<repo-root>` by walking up from their
respective `cwd` until they find a `.git` entry. This walk is identical in both
components, so they agree on the lock path regardless of where each is invoked.

### Acquire: atomic creation

```python
fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
```

`O_CREAT | O_EXCL` is atomic on POSIX: exactly one caller succeeds, others get
`FileExistsError`. This is the standard "create-or-fail" pattern for filesystem
advisory locks — no separate existence-check-then-create race.

### PreToolUse hook gate

The hook matches a fixed set of mutating subcommands:

```
add  commit  merge  rebase  reset  restore  stash
cherry-pick  am  rm  mv
```

If the command matches and the current session does not hold the lock, the hook
exits with status 2 (block) and writes a guidance message to stderr explaining
how to acquire. If the session holds the lock, the hook exits 0 (allow). On any
error reading session id or lock file, the hook exits 0 (fail-open).

The gate runs in **all** guard modes, including the "off" mode that disables
other guardrails. The commit-lock is a correctness mechanism for shared-state
safety, not a permission guardrail — these are separate concerns and should not
be coupled.

### PostToolUse nudge

A separate PostToolUse hook fires after a `git commit` or `git push`. If the
current session still holds the lock, it injects a non-blocking `additionalContext`
reminder to release. This is a backstop against a forgotten lock — a session
that commits and then switches to other work without releasing.

The nudge is PostToolUse by design: running it PreToolUse on a commit/push would
place it in the same hook phase as the commit-lock gate, creating an ordering
dependency. PostToolUse runs after the command completes and after the PreToolUse
checks — it cannot interfere with them.

### CLI

```
raven-gitlock.py acquire          # claim the lock; fails if held by another session
raven-gitlock.py release          # release; owner-only (--force clears stale locks)
raven-gitlock.py status           # print holder or "free"
```

Acquire is idempotent for the current session: re-acquiring when you already
hold the lock succeeds silently.

Release refuses to clear another session's lock without `--force`, preventing
one session from accidentally unblocking a different session mid-sequence.

### Unattended flows

Interactive sessions can rely on the hook's block-with-guidance to learn the
protocol. Unattended flows (scheduled commits, automated pipelines) should
`acquire` explicitly at the start and `release` at the end of the git sequence.
Relying on reading-and-reacting to a block is fragile in unattended execution
where a blocked command may simply fail silently.

## Gotchas

**Stale locks after a crash.** If a session crashes or is killed while holding
the lock, the lock file persists. No TTL means it stays until manually cleared.
`release --force` or deleting `.git/raven-commit.lock` directly are equivalent.
The `status` subcommand shows the holder's session id and acquire time, which is
enough context to decide whether a lock is stale.

**Session id must be set.** The lock is keyed on `CLAUDE_CODE_SESSION_ID`. If a
script runs in an environment where this variable is not set, `acquire` refuses
to proceed (it would write a lock with no identity, making ownership checks
meaningless). The hook fails open in the same case rather than blocking, so an
unidentified session can still run git commands — advisory locks cannot be
enforced without identity.

**Lock is per-clone, not per-repo-URL.** Two clones of the same remote have
independent lock files. They do not coordinate with each other — that is
intentional; cross-clone coordination is handled by the normal push/pull cycle,
not by the commit-lock.

**Push is not gated, but ordering still matters.** If Session A holds the lock
and pushes, then releases, Session B acquires and also pushes without fetching
first, B's push will be rejected by the remote as non-fast-forward. The lock
only protects the local index/HEAD sequence; pull-before-push discipline is
still the caller's responsibility.

**`O_CREAT | O_EXCL` atomicity on Windows.** Python's `os.open` with this flag
combination is atomic on Windows for local filesystems. For network-mounted
directories (NFS, SMB shares), OS-level create-or-fail atomicity is not
guaranteed. For Raven's use case — a local Dropbox-synced directory — the lock
file lives on a local NTFS filesystem and the flag combination is reliable.

**The generalizable pattern.** Whenever multiple agents share mutable global
state — git index/HEAD, a shared database, a build artifact directory — the
right structure is: identify the critical section (stage through commit),
identify the agents (by session id or process id), build an advisory fail-open
lock keyed on agent identity, enforce it at the tool boundary rather than inside
individual commands, and separate the correctness mechanism from other
permission guardrails so it cannot be accidentally disabled.
