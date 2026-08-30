# Transient `Invalid argument` Writes Inside `.git/objects` (Windows + Cloud Sync)

## Symptom

A git command fails with an OS-level `Invalid argument` on a path inside `.git/objects`, sometimes preceded by a failed unlink of a temp object:

```
error: unable to unlink '.git/objects/3d/tmp_obj_oX2mvf': Invalid argument
error: unable to write file .git/objects/3d/d7d8bc…: Invalid argument
```

A single retry almost always succeeds. The failure hits both the read path (`fetch`) and the write path (`add`, `commit`), so it isn't specific to any subcommand. Every failed write leaves one orphan `tmp_obj_*` behind; git writes the real object correctly on retry, so this is failed *writes*, not corruption.

This writeup is deliberately an **open ledger rather than a solved case**. Seventeen instances in, there is still no root cause — and, more usefully, two successive explanatory profiles have been *retired by their own evidence*. What's worth carrying is the investigation shape rather than the conclusion.

## What was ruled out

**Cloud-sync interference with `.git` directly — unlikely from the start.** The repository lives inside a synced folder, but `.git` had been marked sync-ignored weeks before the first instance.

**Antivirus — suspected for three weeks, then acquitted by a pre-declared criterion.** This is the part worth stealing. When the third instance fired, the investigation found the leading suspect had never actually been *tested*: no exclusion covered the synced folder at all, while unrelated development directories had long had them. An exclusion was added by hand.

Rather than declaring victory or leaving an open watch, the carry was closed as a **self-measuring experiment with a verdict lane**: roughly four clean weeks convicts the suspect and closes the pattern; another instance acquits it and buys the deeper capture (a filesystem-level trace filtered on the failing error). The existing instance-counting in the nightly pipeline *was* the measurement apparatus, so the experiment ran with no added vigilance and no one had to remember anything.

Both later instances landed *through* the exclusion. The criterion fired, twice, and was honoured without deliberation — which is exactly what writing it in advance buys. Antivirus is out.

## The second hypothesis, and its retirement

At seven instances the surviving profile looked precise, and it wasn't about git:

> **A git write issued seconds after the same session wrote files into the cloud-synced tree.**

Two clean matches had landed in one night, from the same session, on two different subcommands. The implication was uncomfortable but coherent: marking `.git` sync-ignored evidently does not insulate `.git/objects` from whatever the sync layer does to the *parent* tree.

**Ten instances later that profile is dead.** The majority of subsequent instances carry what the ledger calls a *bare profile* — the session had only read files and run git, with no writes into the synced tree at all, sometimes for several instances running. Both explanatory correlations the investigation ever had (antivirus, then write-into-synced-tree) have now been retired by their own evidence, and the honest position is that **nothing currently predicts an instance.**

That is worth stating as a result rather than as an absence. Two profiles proposed, both testable, both falsified by continued measurement, is a more informative state than one plausible story still standing — and it is only reachable because every instance was logged with its *preceding activity*, not just its error text.

Rate data, with its caveat: gaps have run anywhere from twice in one night (four such nights) to five consecutive quiet nights. Bursts sit comfortably inside gaps of five and fifteen days already recorded, so a quiet week is not evidence in either direction. The repository's activity level varies enough over the same period that load explains as much as any hypothesis does.

**The ledger by surface and subcommand**, which is the part that has actually accumulated signal:

- **Surfaces:** `.git/objects` (fifteen), refs (two, both logged as *adjacent-but-distinct* because they carry no `Invalid argument` text), and the index (one).
- **Subcommands:** 7 `commit`, 3 `add`, 2 `fetch`, 1 `pull`, plus a pair of off-night probes.

Logging the refs-surface failures as adjacent rather than folding them into the count is the discipline that keeps the ledger meaningful: they share the shape (transient, one retry clean, same probe verdict) but not the error, and collapsing them would have made a growing count look like growing evidence for one mechanism.

## The operational lane

Until it's understood:

1. **Probe, then retry once.** A single retry has cleared all but one instance in seventeen — but run the probe first (see below), because a successful retry destroys the evidence.
2. **Never do `.git` surgery.** If the retry also fails, stop and hand it to a human. The orphan temp objects are harmless; deleting things inside `.git/objects` to "clean up" is how a transient becomes permanent.
3. **Log the instance** with date, operation, and what the session was doing in the seconds before. The profile above only emerged because the *preceding activity* was recorded, not just the error.

### The probe worth having

The most useful thing bought by the fifth instance — the first to need more than one retry, three consecutive `commit` failures over ~90 seconds — was a discriminator:

```bash
git hash-object -w <some-file>
```

It succeeded *between* two failed commits. That separates **"git's write path is broken right now"** from **"this particular operation is unlucky"**, and tells you whether to retry immediately or stop. It is a good probe precisely because of what it touches: it writes a real loose object while touching **no index and no HEAD**, so it exercises the failing surface without risking the state a failed retry would.

Since then the probe has run at the moment of failure **seven times**, across the objects surface and the refs surface, and returned the same verdict every time: *git's write path is fine; the individual operation failed transiently.* That consistency is now the strongest single fact in the ledger, and it points away from git and toward external interference — without naming what.

One procedural upgrade is worth copying: the rule became **probe before the retry**, not after. A retry that succeeds destroys the evidence — you can no longer distinguish a broken write path that recovered from an unlucky operation — so the probe has to happen in the window between the failure and the fix. Getting that ordering right took several instances of doing it the other way and learning nothing.

## Two lessons that outlived the bug

**A diagnostic the pipeline can't run in the mode the pipeline runs in will never be exercised.** The probe above could not be used when it was first wanted, because `hash-object` isn't among the git subcommands on the unattended-mode whitelist — and the unattended pipeline is what produces most of the instances. When you buy a probe for an unattended failure, add it to the unattended allowlist in the same change.

This one has aged into something sharper. Every one of the seven at-the-moment probes ran only because the guard *happened* to be in a permissive mode that night — the ledger calls it **mode-luck**. So the family's best evidence is being collected by accident, and a quiet night under the restrictive mode is indistinguishable from a quiet night where a failure fired and simply couldn't be probed. Those are different observations recorded identically, which is the same disease the probe was bought to cure, one level up.

**A watch can stay honest for weeks and still not close, and naming why is the useful output.** One test would settle the trigger — pausing the sync client across a full write window — and it has been requested seventeen times without being run, because it needs a human to do it. The nightly record states that plainly every time rather than restating the ask as though it were news: *nothing moved; the test remains the one thing that would settle it.* An ask restated verbatim for the eighth night is wallpaper. The useful version says what changed since the last one — a new surface, a probe that fired, a profile that died — or admits nothing did.

**A count that lives in two durable artefacts will drift.** This family was tallied both in the pipeline's own thread notes and in a human-attended failure log. One night's instance reached only the first, so the next session numbered its own episode "the fourth" and independently re-derived a verdict the pipeline had already reached. The re-derivation wasn't wasted — two independent routes to the same conclusion is stronger evidence than one — but both records now name a different "fourth instance," and the true count is five. Either give a recurring family one home, or make each record name where the other lives.

## Related

- [solutions/dropbox-file-locking.md](dropbox-file-locking.md) — the well-understood sibling: cloud-sync file locks producing `os error 32` during builds, and temp-file debris in synced working trees.
- [patterns/instrument-trust.md](../patterns/instrument-trust.md) — the falsifiable-window close and the divergent-ledger problem, generalised.
