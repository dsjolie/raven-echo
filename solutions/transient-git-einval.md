# Transient `Invalid argument` Writes Inside `.git/objects` (Windows + Cloud Sync)

## Symptom

A git command fails with an OS-level `Invalid argument` on a path inside `.git/objects`, sometimes preceded by a failed unlink of a temp object:

```
error: unable to unlink '.git/objects/3d/tmp_obj_oX2mvf': Invalid argument
error: unable to write file .git/objects/3d/d7d8bc…: Invalid argument
```

A single retry almost always succeeds. The failure hits both the read path (`fetch`) and the write path (`add`, `commit`, `stash pop`), so it isn't specific to any subcommand. Git writes the real object correctly on retry, so these are failed *writes*, not corruption. Some failed writes leave an orphan `tmp_obj_*` behind, but not all. Three orphans stood against ten instances when this was checked, so the orphan count is not an independent tally of the instances.

> **Status as of 2026-09-27:** twenty-four instances, the last on 2026-09-24. Leading suspect: interference from the cloud-sync client, supported but not established (see *The sync-pause test* below). **What would falsify it:** an instance on a night when sync was confirmed paused, or a run of instances with sync confirmed paused throughout. **What would establish it:** instances returning on nights with sync confirmed running, after a paused streak. This line is here because an earlier version of this document stated a working hypothesis without its date, and that hypothesis was materially false in this public repo within three weeks.

This writeup is deliberately an **open ledger rather than a solved case**. Two successive explanatory profiles have been *retired by their own evidence*, and a third is now supported by one imperfect test. What's worth carrying is the investigation shape rather than the conclusion.

## What was ruled out

**Cloud-sync interference with `.git` directly — unlikely from the start.** The repository lives inside a synced folder, but `.git` had been marked sync-ignored weeks before the first instance.

**Antivirus — suspected for three weeks, then acquitted by a pre-declared criterion.** This is the part worth stealing. When the third instance fired, the investigation found the leading suspect had never actually been *tested*: no exclusion covered the synced folder at all, while unrelated development directories had long had them. An exclusion was added by hand.

Rather than declaring victory or leaving an open watch, the carry was closed as a **self-measuring experiment with a verdict lane**: roughly four clean weeks convicts the suspect and closes the pattern; another instance acquits it and buys the deeper capture (a filesystem-level trace filtered on the failing error). The existing instance-counting in the nightly pipeline *was* the measurement apparatus, so the experiment ran with no added vigilance and no one had to remember anything.

Both later instances landed *through* the exclusion. The criterion fired, twice, and was honoured without deliberation — which is exactly what writing it in advance buys. Antivirus is out.

## The second hypothesis, and its retirement

At seven instances the surviving profile looked precise, and it wasn't about git:

> **A git write issued seconds after the same session wrote files into the cloud-synced tree.**

Two clean matches had landed in one night, from the same session, on two different subcommands. The implication was uncomfortable but coherent: marking `.git` sync-ignored evidently does not insulate `.git/objects` from whatever the sync layer does to the *parent* tree.

**Ten instances later that profile is dead.** The majority of subsequent instances carry what the ledger calls a *bare profile* — the session had only read files and run git, with no writes into the synced tree at all, sometimes for several instances running. Both explanatory correlations the investigation ever had (antivirus, then write-into-synced-tree) have now been retired by their own evidence, and the honest position at seventeen instances (late August) was that **nothing predicted an instance.** The section below on the sync-pause test covers what changed after that.

That is worth stating as a result rather than as an absence. Two profiles proposed, both testable, both falsified by continued measurement, is a more informative state than one plausible story still standing — and it is only reachable because every instance was logged with its *preceding activity*, not just its error text.

Rate data, with its caveat: gaps have run anywhere from twice in one night (four such nights) to five consecutive quiet nights. Bursts sit comfortably inside gaps of five and fifteen days already recorded, so a quiet week is not evidence in either direction. The repository's activity level varies enough over the same period that load explains as much as any hypothesis does.

**The ledger by surface and subcommand**, which is the part that has actually accumulated signal:

As of the seventeenth instance:

- **Surfaces:** `.git/objects` (fifteen), refs (two, both logged as *adjacent-but-distinct* because they carry no `Invalid argument` text), and the index (one).
- **Subcommands:** 7 `commit`, 3 `add`, 2 `fetch`, 1 `pull`, plus a pair of off-night probes.

Later instances added `stash pop` as a new verb and, outside git altogether, a plain file write in the same synced folder.

Logging the refs-surface failures as adjacent rather than folding them into the count is the discipline that keeps the ledger meaningful: they share the shape (transient, one retry clean, same probe verdict) but not the error, and collapsing them would have made a growing count look like growing evidence for one mechanism.

## The operational lane

Until it's understood:

1. **Probe, then retry once.** A single retry cleared all but one of the first seventeen instances, and every later one logged in detail — but run the probe first (see below), because a successful retry destroys the evidence.
2. **Never do `.git` surgery.** If the retry also fails, stop and hand it to a human. The orphan temp objects are harmless; deleting things inside `.git/objects` to "clean up" is how a transient becomes permanent.
3. **Log the instance** with date, operation, and what the session was doing in the seconds before. The profile above only emerged because the *preceding activity* was recorded, not just the error.

### The probe worth having

The most useful thing bought by the fifth instance — the first to need more than one retry, three consecutive `commit` failures over ~90 seconds — was a discriminator:

```bash
git hash-object -w <some-file>
```

It succeeded *between* two failed commits. That separates **"git's write path is broken right now"** from **"this particular operation is unlucky"**, and tells you whether to retry immediately or stop. It is a good probe precisely because of what it touches: it writes a real loose object while touching **no index and no HEAD**, so it exercises the failing surface without risking the state a failed retry would.

Since then the probe has run at the moment of failure **seven times**, across the objects surface and the refs surface, and returned the same verdict every time: *git's write path is fine; the individual operation failed transiently.* That consistency is now the strongest single fact in the ledger, and it points away from git and toward external interference — without naming what. Every later probe that ran at the moment, including those at the twenty-third and twenty-fourth instances, returned the same verdict.

One procedural upgrade is worth copying: the rule became **probe before the retry**, not after. A retry that succeeds destroys the evidence — you can no longer distinguish a broken write path that recovered from an unlucky operation — so the probe has to happen in the window between the failure and the fix. Getting that ordering right took several instances of doing it the other way and learning nothing.

## The sync-pause test

From early September a 23:00 reminder asked for sync to be paused each evening. The human paused it by hand, the nightly pipeline counted its write operations without knowing which nights were test nights, and the coordinator's morning check joined the two records. Seven consecutive paused nights came in clean. Instances had landed on 4 of the 12 nights before the test, so seven clean nights in a row has a probability of about 6% at the old rate.

The verdict was written as **suggestive, not established**, for three reasons that transfer to other before/after tests:

1. **The control arm had no contrast.** The only unpaused nights inside the window were also clean.
2. **The window was confounded.** The system drive was cleared, pipeline work moved to another drive, and the model and guard mode both changed during the same weeks.
3. **The streak began after the phenomenon had already stopped.** The last instance before the test predated its first night, so the test never observed the transition it was meant to cause. Before counting clean nights, check where the last instance sits relative to night one. A streak that starts after the effect stopped measures the base rate of the new regime, not the effect of the intervention.

The discriminating next step was the inverse arm: stop pausing and count. It cost nothing, and it stalled on bookkeeping. The reminder job was meant to be retired, but it kept firing, and each evening the coordinator overrode its text by hand. On one of those nights an instance landed, and nobody recorded whether sync had been paused. One missing answer gives two opposite readings, so that instance stays unscored. The experiment was then suspended rather than left nominally running, because *an experiment whose arm is never recorded is not in progress.* Two smaller tells came out of it. First, a recommendation to retire a scheduled job is not in force until the job file is edited, and an executor overriding the job's text each night leaves the schedule describing behaviour that no longer happens. Second, a test whose arm depends on an unlogged human action can only be scored by asking, and asking is the part that decays.

The evidence has since moved further toward sync. The twenty-fourth instance hit a new verb (`stash pop`) with sync running and a clean probe. Two nights later, the task CLI's plain write to an ordinary markdown file in the same synced folder failed with `OSError: [Errno 22] Invalid argument`. That was the first instance of the error outside `.git` entirely. It is one data point, and it fits the sync reading better than anything git-specific.

## Two lessons that outlived the bug

**A diagnostic the pipeline can't run in the mode the pipeline runs in will never be exercised.** The probe above could not be used when it was first wanted, because `hash-object` isn't among the git subcommands on the unattended-mode whitelist — and the unattended pipeline is what produces most of the instances. When you buy a probe for an unattended failure, add it to the unattended allowlist in the same change.

This one has aged into something sharper. Every one of the seven at-the-moment probes ran only because the guard *happened* to be in a permissive mode that night — the ledger calls it **mode-luck**. So the family's best evidence is being collected by accident, and a quiet night under the restrictive mode is indistinguishable from a quiet night where a failure fired and simply couldn't be probed. Those are different observations recorded identically, which is the same disease the probe was bought to cure, one level up.

**A watch can stay honest for weeks and still not close, and naming why is the useful output.** The test most likely to settle the trigger, pausing the sync client across a full write window, was requested in sixteen morning briefings without being run, because it needed a human to do it. The useful version of a repeated ask says what changed since the last one (a new surface, a probe that fired, a profile that died) or admits that nothing did. An ask restated verbatim for the eighth night is wallpaper. What finally got the test run was not a better-worded ask. It was a scheduled reminder at the moment the action was needed (see below).

**A count that lives in two durable artefacts will drift.** This family was tallied both in the pipeline's own thread notes and in a human-attended failure log. One night's instance reached only the first, so the next session numbered its own episode "the fourth" and independently re-derived a verdict the pipeline had already reached. The re-derivation wasn't wasted — two independent routes to the same conclusion is stronger evidence than one — but both records now name a different "fourth instance," and the true count is five. Either give a recurring family one home, or make each record name where the other lives.

## Related

- [solutions/dropbox-file-locking.md](dropbox-file-locking.md) — the well-understood sibling: cloud-sync file locks producing `os error 32` during builds, and temp-file debris in synced working trees.
- [patterns/instrument-trust.md](../patterns/instrument-trust.md) — the falsifiable-window close and the divergent-ledger problem, generalised.
