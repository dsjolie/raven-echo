# Instrument Trust: Making an Agent's Own Checks Falsifiable

## Problem

A system that runs unattended reports on itself. The nightly pipeline says the merge was clean, the audit says settings are unchanged, the coverage script says 16 of 17 screens pass, the review says no problems found. Those reports are the only thing standing between an autonomous loop and silent drift — and they have a failure mode that ordinary bugs don't.

**A check that didn't run is indistinguishable from one that passed.** Both produce a clean report. Both look like evidence. Nothing in the output distinguishes "I verified this and it's fine" from "the instrument was dead, the scope was empty, or I never ran the command and wrote a plausible value instead."

This is not hypothetical hand-wringing. Over a few weeks of running one such pipeline, all of these landed:

- A guardrail hook had been switched **off** for four days. Two consecutive nightly reports recorded "zero guard bounces" as a property of the night. A third attributed a bounce to a whitelist that could not have been executing. The instrument's silence got written down as the instrument's verdict.
- A screenshot driver appended `?t=<file mtime>` as a cache-buster. Correct for "the file changed" — useless for the *verification* case, where you re-shoot the same file to confirm a fix and the key is therefore constant. Two landed fixes were reported to the user as still outstanding, because the browser served the previous render.
- A coverage script reported "clean (16/17)" against a hard-coded list of screens that had never gained the two newest ones. From inside the tool, the list *is* the world, so the omission is not an error the tool can raise.
- An agent rebuilding a document died mid-run before anything reached disk. The file was present, well-formed, and looked exactly like the document it was supposed to be — because it was the previous version. Every exists-and-looks-right check passed. **The absence of new work looks identical to the presence of old work.**
- Across a dozen nightly passes, a cloud agent stated "last edited" dates for wiki articles that did not match the local `git log`. The dates were well-formed and in range, and the wrong ones on a given night shared a single value. This was first diagnosed as confabulation: the error shapes looked incompatible with any one instrument, so the conclusion was that nothing had been measured. **That diagnosis was wrong, and this document repeated it for six weeks after it was reversed.** The reversal came from measuring the wrong values against something other than each other. The commit distance from each night's shared wrong date to that night's run date was always about a hundred. The cloud agent's checkout was a **depth-100 shallow clone**, and in a shallow clone `git log -1 -- <path>` returns the graft boundary's date for every file not touched inside the window. The agent ran the right command and copied its output faithfully every time. The instrument was git, standing on a truncated history. Correctly dated files were the recently edited ones inside the window. The shared wrong value was the boundary. Its drift between nights came from the clone being recreated. See the gotcha on substrates below.

Two properties make the family expensive out of proportion to its size. It is **fluent** — nothing about a wrong date or a clean report invites suspicion. And it is **cheap to falsify, but only if you think to** — one `git log -1 --format=%cs -- <path>` per claim, which is exactly the check nobody runs against an assertion that doesn't look like a guess. The shallow-clone case adds a condition: the falsifying command has to run somewhere whose history is complete.

## Approach

Treat every self-report as a claim that must carry its evidence, and design each instrument so that *not running* produces a visibly different artifact from *running and passing*.

Four concrete moves, each aimed at one way the gap opens:

**1. Name the command, or omit the value.** Any date, version, count, or size about an artifact either cites the command that produced it *in the same pass*, or is left out. The omission clause is the load-bearing half — a rule that only says "use git for dates" still leaves fabrication as the fallback whenever the command is skipped.

Better still: make the evidence marker **mandatory on every value**, not optional. When one system's reports voluntarily annotated some dates "(git-confirmed)", that annotation became the only thing distinguishing a measured value from a generated one — and the measurement showed exactly one of three dates was real. Make the marker required and an unannotated value is *self-evidently* non-compliant instead of indistinguishable from a real one.

Naming the command is necessary but not sufficient. In the shallow-clone case the command was named and run, and a planned escalation (require the pasted command output alongside each date) would have made things worse: the wrong dates would have carried stronger provenance. The marker shows that something was measured. Whether the measurement could be right depends on what it ran against.

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

Both families above — "check `.gitignore` before concluding a path doesn't exist" and "cite the git command or omit the date" — graduated to the prompt layer for exactly this reason. The date family's actual fix also landed in the prompt, as a precondition rather than a constraint on the agent: the run checks `git rev-parse --is-shallow-repository`, fetches the full history if needed, and states no dates at all if the unshallow fails. It also stamps each commit message with the `origin/main` sha it ran against, so a later reader can tell which state of the repo the run saw.

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

- **Before filing a recurring error against an agent's reliability, check what its tools stand on.** A fabricated reading and a faithful copy of a lying instrument look the same in the output. Only a measurement *of the values themselves* separates them. In the shallow-clone case that measurement was the commit distance from each wrong date to its run. The substrate fault also did worse than produce wrong numbers. A graft boundary gives *one* date to every file outside the window, so any two old files look like they were edited together. One report reasoned from such a false co-edit ("this sibling article changed the same day and names what this one omits"). A wrong date can be caught by a check. A wrong inference built on it survives the date being corrected, because the argument no longer mentions a date. When a report reasons from two artefacts sharing a timestamp, check both timestamps: the sharing is the claim. A related detail: the shallow boundary was fixed when the clone was created and did not roll forward. A boundary that *moves* is therefore free evidence that the remote environment was rebuilt.

- **A check that reads the file cannot see the commit.** A morning health check asked whether last night's notes *contained* the night's increment. The notes contained it as soon as the reflect step wrote the file. One night the commit that should have followed died, leaving a zero-byte `index.lock`, and eight hours of finished work sat uncommitted while the check read 4 of 4. All four checks read artefacts and none read git. When the property you care about is "durably recorded", check the record (the commit, the push), not the thing that gets recorded. File mtimes helped with the cleanup: `git status` showed one undifferentiated pile, and the timestamps split the dead session's files from a live session's in a single call.

- **A field that is parsed must not be edited like prose.** A machine registry's `availability` field decides the fleet card's status through a regex (`/^intermittent/`) and an off-hours window, and the same text also renders as a tooltip. An entry that read like documentation matched the regex. For five days the card reported a machine as *expected-off* when it was down: an OS update had rebooted it into a logged-out desktop with nothing set to auto-start. The mistake was compounded during the investigation. A claim that "nothing alerted" was made from a line citation, without reading the function fourteen lines below it that decides what counts as an alarm, and a new alerting feature was proposed for a gap that did not exist. Before editing a structured field, find its readers. Before proposing an alarm, read the code that decides alarms.

- **An audit scoped to one machine will scope its conclusion to one machine.** A setup document's template deny-rule set had drifted to an older, weaker version. The audit found the problem, and it was fixed as a documentation bug: doc corrected, machine corrected, question closed. Nobody asked who had already copied the template, although the document itself offered it as the thing to copy, and at least one new clone had done so two days earlier. Fixing the source does not fix the copies. When a fix lands in a template, list its consumers.

- **Before trusting a zero, ask whether the search could have found the thing at all.** Three searches in two days returned zero for things that existed. A file-glob for a git log path came back empty because the walk does not enter hidden `.git` directories. A glob for an installed package returned nothing because the glob matches files and the pattern named a directory. The third nearly shipped inside a fix. Python's `Path.glob` swallows `OSError`, so a cloud-storage folder that hung on read enumerated as *empty* instead of raising. Wrapping the existing glob in a `try` would have produced a healthy-looking listing that silently left out a project. In the first two cases the search was a filter on the wrong thing. In the third it was a search that cannot report its own blindness. A known-positive control (run the same search on something you know is there) catches the first two. It cannot catch the third, because a control folder that reads fine says nothing about one that doesn't. Where absence is load-bearing in code, enumerate with a call that raises (`iterdir`, `scandir`). Where it matters in a search, name a concrete file inside the thing you are looking for.

- **A whole-file average cannot see drift over time.** A narrated video's mix was checked for integrated loudness and true peak, and both were fine. Two minutes in, the narration jumped about 12 dB and dropped back two seconds later. Any measurement that averages over the whole file is blind to *when* something happened. The build now measures each section of the final file and fails on spread. That moves the check out of the reviewer's ear and into the tool (see [narrated-video.md](narrated-video.md)). The same evening added a third instance to this family: camera moves were judged on a review sheet that showed one mid-shot frame, which could not show where a move ended. The sheet now shows the first and last frames.
