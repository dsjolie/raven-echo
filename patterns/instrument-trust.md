# Instrument Trust: Making an Agent's Own Checks Falsifiable

## Problem

A system that runs unattended reports on itself. The nightly pipeline says the merge was clean, the audit says settings are unchanged, the coverage script says 16 of 17 screens pass, the review says no problems found. Those reports are the only thing standing between an autonomous loop and silent drift — and they have a failure mode that ordinary bugs don't.

**A check that didn't run is indistinguishable from one that passed.** Both produce a clean report. Both look like evidence. Nothing in the output distinguishes "I verified this and it's fine" from "the instrument was dead, the scope was empty, or I never ran the command and wrote a plausible value instead."

This is not hypothetical hand-wringing. Over a few weeks of running one such pipeline, all of these landed:

- A guardrail hook had been switched **off** for four days. Two consecutive nightly reports recorded "zero guard bounces" as a property of the night. A third attributed a bounce to a whitelist that could not have been executing. The instrument's silence got written down as the instrument's verdict.
- A screenshot driver appended `?t=<file mtime>` as a cache-buster. Correct for "the file changed" — useless for the *verification* case, where you re-shoot the same file to confirm a fix and the key is therefore constant. Two landed fixes were reported to the user as still outstanding, because the browser served the previous render.
- A coverage script reported "clean (16/17)" against a hard-coded list of screens that had never gained the two newest ones. From inside the tool, the list *is* the world, so the omission is not an error the tool can raise.
- An agent rebuilding a document died mid-run before anything reached disk. The file was present, well-formed, and looked exactly like the document it was supposed to be — because it was the previous version. Every exists-and-looks-right check passed. **The absence of new work looks identical to the presence of old work.**
- Across eight rumination passes, an agent stated "last edited" dates for wiki articles that no `git log` had produced. The dates were well-formed, in range, and often adjacent to something true. Three distinct error signatures appeared (a shared wrong value across a report, an exact one-month shift, a date borrowed from a neighbouring sentence) — which is what finally killed the "it's reading the wrong instrument" hypothesis. Three incompatible error shapes all yielding *plausible* values is the fingerprint of generation from context salience. There was no instrument to find.

Two properties make the family expensive out of proportion to its size. It is **fluent** — nothing about a confabulated date or a clean report invites suspicion. And it is **cheap to falsify, but only if you think to** — one `git log -1 --format=%cs -- <path>` per claim, which is exactly the check nobody runs against an assertion that doesn't look like a guess.

## Approach

Treat every self-report as a claim that must carry its evidence, and design each instrument so that *not running* produces a visibly different artifact from *running and passing*.

Four concrete moves, each aimed at one way the gap opens:

**1. Name the command, or omit the value.** Any date, version, count, or size about an artifact either cites the command that produced it *in the same pass*, or is left out. The omission clause is the load-bearing half — a rule that only says "use git for dates" still leaves fabrication as the fallback whenever the command is skipped.

Better still: make the evidence marker **mandatory on every value**, not optional. When one system's reports voluntarily annotated some dates "(git-confirmed)", that annotation became the only thing distinguishing a measured value from a generated one — and the measurement showed exactly one of three dates was real. Make the marker required and an unannotated value is *self-evidently* non-compliant instead of indistinguishable from a real one.

**2. Derive the scope; never declare it.** A coverage number computed over a hand-written list is not evidence. Enumerate from the filesystem, the registry, the database — whatever the ground truth is — and then **print what was covered, not how many**. A list is auditable at a glance; a ratio is not. `16/17` hides which 17; the names don't.

**3. Key cache-busters on the moment, not on the subject.** Anything keyed to the artifact's own identity or mtime works for "did it change" and fails for "re-measure the unchanged thing" — which is precisely the verification case. Key on the clock.

**4. Have every run state which mode it is in.** A guardrail that can be disabled must put its live mode in the report header, so "no violations" is always accompanied by "…while enforcing." Note that this cannot be fixed by an auto-correcting job: in the system above, the auto-away job only promoted *default* → *away*, so *off* was sticky — correctly, since it's a deliberate user setting. Nothing surfaced which mode a given run executed under, and that's the gap.

## Implementation

The portable check, applicable before writing any clean result:

> **About to report a clean result, a passing check, or an absence of problems → ask what would look different if the check had not run at all.**
>
> If the answer is "nothing", the result is not evidence, and the first thing to establish is that the instrument was live.

Its sibling, for any stated value:

> **About to state a date, version, count, or size about an artefact → name the command that produced it, or omit it.** A number recalled rather than read is a claim about the world dressed as an observation of it.

And the one for verification-by-existence:

> **After an agent failure, verify by expected content, not by existence.** Assert on a string the new output would contain. The tell in the case above was exactly one such string.

### Where the fix belongs

There are two enforcement surfaces and they are not interchangeable.

A **tool-boundary rule** (a hook, CLI validation, a gate) is right when the trigger is an action you want to *block* — a dangerous command form, an unguarded write. It fires everywhere, unconditionally.

A **prompt-layer constraint** is right when the trigger is a *legitimate* action done sloppily. "State a date" isn't blockable; no hook can distinguish a measured date from a fabricated one at the tool call. So the constraint goes where the action is *specified* — in the prompt that drives the run — rather than where it is issued. The tradeoff is coverage: a prompt-layer rule protects only the runs that consume that prompt, leaving every other session unguarded against the same mistake. Know which surface you've bought.

Both families above — "check `.gitignore` before concluding a path doesn't exist" and "cite the git command or omit the date" — graduated to the prompt layer for exactly this reason.

## Gotchas

- **A prompt fix is in force when the consuming run's checkout contains it, not when it's committed.** This is its own trap and has its own writeup — see [solutions/stale-prompt-delivery.md](../solutions/stale-prompt-delivery.md). It matters here because the recurrence of the exact failure a fix targets is *powerful* evidence the fix is inadequate — and if the run never received the fix, that evidence is entirely wrong, and acting on it means rewriting a rule that was fine.

- **When a count lives in more than one durable artefact, the count is the thing that will drift.** A recurring failure family was being tallied in two places — a pipeline's own thread head and a human-attended failure log. An instance recorded in one never reached the other, so the next session numbered its episode "the fourth" and re-derived a verdict the pipeline had reached the night before. Two records now each name a different "fourth instance"; the true count was five. Either give the family one home, or make each record name where the other lives.

- **Write claims about a moving family with their tense visible.** One wiki section asserting "all six instances stayed inside reports" was falsified by the same night's later stage. A second, written days later, said "the true count is five" and the sixth arrived during the commit that shipped it. Neither was wrong when written; both would have been fine as *"as of tonight"*.

- **A diagnostic the pipeline cannot execute in the mode the pipeline runs in will never be exercised.** One investigation bought itself a discriminating probe — a cheap command separating "the write path is broken right now" from "this operation was unlucky." It then couldn't be run at the moment it was wanted, because the command wasn't on the unattended-mode whitelist and the instrument that produces most of the instances runs unattended. When you add a probe for an unattended failure, add it to the unattended allowlist in the same change.

- **Close a watch with a falsifiable window and a named verdict**, not with a fix asserted to work or a watch left open forever. One long-running mystery was closed as: *four clean weeks convicts the suspect, a fourth instance acquits it and buys the deeper capture.* Both criteria fired within days and were honoured without deliberation — which is what writing them in advance buys. The existing instance-counting was the measurement apparatus, so the experiment ran with no added vigilance.

- **Two callers sharing one computation must be asking the same question.** A latency refactor made a service's capability check reuse its residency probe. *Residency* means "holding memory", so a healthy but **idle** backend is absent from it — and the status page reported "not answering" whenever the service was merely idle, which was nearly always, and precisely when someone was most likely to look at it. The two questions differed by exactly one word. The shared-computation optimisation is fine; skipping the check that both callers wanted the same answer is what broke it.

- **A probe timeout tuned for one call path is wrong on another.** The same service reported a busy backend as *down*: a 1.5 s health timeout, correct when probes ran on the request path where every second showed as UI lag, stayed put after the probes moved to a background refresher where a generous timeout costs callers nothing. A backend mid-load replies slowly but replies. Wrongly reporting a working service as down is the same class of error as a bypassed lock — the display looks authoritative and is wrong.

- **The instrument's own scope can be set outside its config.** A permissions audit read settings files only, so an environment variable exported by a launcher — one that removed deny-respecting tools from the session's surface — was invisible to it. The audit reported accurately over what it could see, and what it could see was the wrong set. Whenever a posture depends on both declared config and live environment, read both, and say which one each finding came from.

- **A behavioural note is not a mitigation.** Writing "remember to check X" into a log demonstrably does not install the habit; the same invented CLI flag recurred three times across seven weeks despite two logged lessons. What changed the outcome the third time was CLI validation that rejected flag-shaped arguments. The rule of thumb that emerged: *this is the second time I've logged "remember not to do X" — the third is coming unless I enforce it somewhere that doesn't depend on remembering.* Where no boundary can exist, the note is all you have, and you should be honest that the mitigation is weak.
