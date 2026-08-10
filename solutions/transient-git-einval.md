# Transient `Invalid argument` Writes Inside `.git/objects` (Windows + Cloud Sync)

## Symptom

A git command fails with an OS-level `Invalid argument` on a path inside `.git/objects`, sometimes preceded by a failed unlink of a temp object:

```
error: unable to unlink '.git/objects/3d/tmp_obj_oX2mvf': Invalid argument
error: unable to write file .git/objects/3d/d7d8bc…: Invalid argument
```

A single retry almost always succeeds. The failure hits both the read path (`fetch`) and the write path (`add`, `commit`), so it isn't specific to any subcommand. Every failed write leaves one orphan `tmp_obj_*` behind; git writes the real object correctly on retry, so this is failed *writes*, not corruption.

This writeup is deliberately an **open ledger rather than a solved case** — the honest state after seven instances is a sharp profile and no root cause. What's worth carrying is the investigation shape more than the conclusion.

## What was ruled out

**Cloud-sync interference with `.git` directly — unlikely from the start.** The repository lives inside a synced folder, but `.git` had been marked sync-ignored weeks before the first instance.

**Antivirus — suspected for three weeks, then acquitted by a pre-declared criterion.** This is the part worth stealing. When the third instance fired, the investigation found the leading suspect had never actually been *tested*: no exclusion covered the synced folder at all, while unrelated development directories had long had them. An exclusion was added by hand.

Rather than declaring victory or leaving an open watch, the carry was closed as a **self-measuring experiment with a verdict lane**: roughly four clean weeks convicts the suspect and closes the pattern; another instance acquits it and buys the deeper capture (a filesystem-level trace filtered on the failing error). The existing instance-counting in the nightly pipeline *was* the measurement apparatus, so the experiment ran with no added vigilance and no one had to remember anything.

Both later instances landed *through* the exclusion. The criterion fired, twice, and was honoured without deliberation — which is exactly what writing it in advance buys. Antivirus is out.

## Current working hypothesis

The surviving profile is precise, and it isn't about git:

> **A git write issued seconds after the same session wrote files into the cloud-synced tree.**

Two clean matches landed in one night, from the same session, on two different git subcommands — four article files written, then a failed `commit`; one note edited, then a failed `add`. A third instance was *claimed* to match (a neighbouring session dropping ~30 files) but its recorded timing doesn't reconcile with git's own record, so it counts as suggestive rather than confirming.

The uncomfortable implication: marking `.git` sync-ignored evidently does **not** insulate `.git/objects` from whatever the sync layer does to the *parent* tree.

Rate data, stated with its caveat: gaps ran 5 days, 15 days, 3 days, 1 day, 1 day. Three instances in the three days after the antivirus exclusion, against three in the three preceding weeks. Worth stating and worth *not* over-reading — the repository also got markedly busier in that period, with parallel sessions and large file drops, so activity explains the acceleration at least as well as anything the exclusion did.

## The operational lane

Until it's understood:

1. **Retry once.** It has succeeded on the first retry in six of seven instances.
2. **Never do `.git` surgery.** If the retry also fails, stop and hand it to a human. The orphan temp objects are harmless; deleting things inside `.git/objects` to "clean up" is how a transient becomes permanent.
3. **Log the instance** with date, operation, and what the session was doing in the seconds before. The profile above only emerged because the *preceding activity* was recorded, not just the error.

### The probe worth having

The most useful thing bought by the fifth instance — the first to need more than one retry, three consecutive `commit` failures over ~90 seconds — was a discriminator:

```bash
git hash-object -w <some-file>
```

It succeeded *between* two failed commits. That separates **"git's write path is broken right now"** from **"this particular operation is unlucky"**, and tells you whether to retry immediately or stop.

## Two lessons that outlived the bug

**A diagnostic the pipeline can't run in the mode the pipeline runs in will never be exercised.** The probe above could not be used when it was finally wanted, because `hash-object` isn't among the git subcommands on the unattended-mode whitelist — and the unattended pipeline is what produces most of the instances. When you buy a probe for an unattended failure, add it to the unattended allowlist in the same change.

**A count that lives in two durable artefacts will drift.** This family was tallied both in the pipeline's own thread notes and in a human-attended failure log. One night's instance reached only the first, so the next session numbered its own episode "the fourth" and independently re-derived a verdict the pipeline had already reached. The re-derivation wasn't wasted — two independent routes to the same conclusion is stronger evidence than one — but both records now name a different "fourth instance," and the true count is five. Either give a recurring family one home, or make each record name where the other lives.

## Related

- [solutions/dropbox-file-locking.md](dropbox-file-locking.md) — the well-understood sibling: cloud-sync file locks producing `os error 32` during builds, and temp-file debris in synced working trees.
- [patterns/instrument-trust.md](../patterns/instrument-trust.md) — the falsifiable-window close and the divergent-ledger problem, generalised.
