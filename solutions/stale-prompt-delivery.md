# A Prompt Fix Isn't In Force When You Commit It

## Symptom

You ship a constraint into a prompt that drives an automated agent run — "always cite the command that produced this date, or omit the value." Twelve hours later the next scheduled run violates both halves of it.

The obvious reading is that the constraint didn't land: too weak, too easy to skip, badly worded. That reading is wrong often enough to be dangerous, because the recurrence of the exact failure a fix targets is *powerful* evidence that the fix is inadequate — and if the run never received the fix, that evidence points at a rule that had never been given a chance to fail.

## Cause

The consuming run reads the prompt from **its own checkout**, not from your working tree.

In the case that named this: cloud runs operate on a long-lived shared branch, and the documented contract said that branch "should be a strict superset of main — it merges main in at the start of every run." The constraint landed on main at 11:59. The run at 00:09 the next morning had a branch whose newest main-side content was from 07:02 the previous day, because no main-merge had run at the start of that job. The run consumed the *old* prompt. The documented invariant was a claim about a mechanism nobody was verifying per-run, and on that run it did not hold.

The same shape appears wherever a running thing reads config from somewhere other than where you edited it: a container image built before the change, a scheduled job with a pinned ref, a long-lived process that read its config at boot, a CDN with a cache still warm.

## Fix

**Read the file at the run's own commit before concluding anything about the fix.**

```bash
git show <run-commit>:path/to/prompt.md
```

That single command answers two different questions and is cheap enough to run unconditionally:

- **On a miss** (the constraint's text isn't there) it prevents a false conviction. You know the fix wasn't delivered, so the next action is *fix propagation*, not *rewrite the rule*. Those are entirely different pieces of work, and one of them is wasted effort that also degrades a good rule.
- **On a hit** it licenses the verdict. The run genuinely had the constraint, so whatever it did is a real measurement of the constraint's effectiveness.

The second half is a bookkeeping discipline: **when a fix lands, record which run is its first real test.** Not "the next run by wall-clock" — the next run whose checkout demonstrably includes it. Without that, a partial result is just another ambiguous data point instead of the first clean one.

This paid off in both directions within two days. The first night's `git show` found the constraint absent and stopped a rewrite of a rule that was fine. The next night's found it present, which made that run the fix's first genuine test — and its result (one of three values correctly cited) a real measurement, precisely locating the failure in the *omission* clause rather than in the rule as a whole.

## Related

- Same shape one layer down: a dev server logged "Reloading…" after an edit and kept serving the old module, so a correct fix appeared to change nothing. Diagnosis that worked: run the edited logic directly in a fresh interpreter against the same inputs — it produced the new result, proving the edit was right and the *serving process* was stale.
- The general form is *the input a run consumed is older than it looks*. Its mirror image — *the output a run produced is older than it looks* — is covered in [patterns/instrument-trust.md](../patterns/instrument-trust.md).
- A documented invariant about a mechanism ("it merges main at the start of every run") is not an observation of that mechanism running. If a fix's delivery depends on it, verify it per-run rather than trusting the doc.
