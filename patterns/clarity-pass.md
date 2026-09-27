# Clarity Pass: Revising Prose With Meaning Held Fixed

## Problem

An agent that drafts papers, book chapters and posts produces text that is correct and hard to read. The typical faults are known: sentences carrying three claims and a citation, terms used before they are defined, a paragraph's point arriving in its last line, and the mannered shapes that model prose falls into (aphoristic closers, "not X but Y" chains, fragments for effect). Asking the same agent to "make it clearer" fixes some of these and introduces a worse fault: the revision quietly changes what the text claims. A hedge disappears ("suggests" becomes "shows"), a concession is cut for flow, a number is rounded into "roughly half", or the paper's own argument ends up attributed to a cited author. A reviewer who catches one of these stops trusting the rest.

A second problem sits behind the first. A single revision pass does not produce finished prose. It produces text that is better on one axis and usually worse on another, and the agent that made the edits is the worst judge of whether they worked.

## Approach

Two decisions come before any editing.

**Meaning is an invariant, not a goal.** The pass changes how things are said, never what is said or how strongly. The invariants are written down as a list and split by how they can be checked:

- *Script-checked:* the set of citation keys, the set of cross-references, every number, every quoted string. A comparison script extracts these from both versions and reports any difference.
- *Read-checked:* claim strength (the modal and evidential verbs), concessions and scope markers, attribution of positions, argument structure (no claim added, removed, or moved to different support), and the exact wording of defined terms.

Anything that crosses the boundary is either reverted or listed for the author with a reason. When clarity and meaning conflict, meaning wins and the conflict goes in the report.

**Clarity is measured against a reader, not against the writer.** The target is a competent reader outside the project who has not seen the notes, the drafts or the sources. That reader has one pass and no access to the author.

With those fixed, the pass is a loop that runs until it converges, using a different instrument on each lap because each instrument sees different faults:

1. **Metrics, aimed at a band.** Word count at or below the original, sentence-length spread not collapsed, short sentences (under twelve words) under a quarter. These are pass conditions. The important word is *band*. A sweep that only reverses the previous sweep's fault overshoots: splitting long sentences produces a run of short declaratives, which is its own fault, and "fix the rhythm" then undoes the split.
2. **Full read-through.** The only instrument that catches paragraph-level faults: a point that arrives at the end, a mid-paragraph change of subject, a reference to something not yet introduced.
3. **Fresh reader.** A subagent on a judgment-tier model, in a fresh context, given the file path and nothing else, reads the text as a reviewer for the target venue would. It returns a ranked list of stumbles, each with the sentence quoted and a reason, plus a plain verdict on whether this is finished prose. The fresh reader is not allowed to rewrite. It finds problems, and the editing agent fixes them.

The loop stops when the metrics are in band, a read-through changes fewer than about one sentence in fifty, and the fresh reader's list has nothing damaging on it. Two laps is normal. Needing four is a sign of a structural problem that a clarity pass cannot fix, and that belongs in the report.

## Implementation

The workflow is a skill with a checklist the agent copies and works through:

```
- [ ] 1. Scope and target file
- [ ] 2. Full read, baseline metrics
- [ ] 3. Revise section by section, targeted edits
- [ ] 4. Invariant check (script) and self-review
- [ ] 4b. Iterate to convergence (band, read-through, fresh reader)
- [ ] 5. Render if the format has a build step
- [ ] 6. Report
```

Some details that carry weight:

- **Targeted edits, never a whole-file rewrite.** For each paragraph the agent first names what it claims and which citation supports which claim, then edits, then reads the new paragraph against the old one before moving on. Whole-file regeneration is how content goes missing unnoticed.
- **Subordinate before you split.** A long sentence's interpolation that qualifies or defines becomes a subordinate clause or a parenthesis. Only an interpolation that is its own claim with its own support gets its own sentence. Replacing every dash with a full stop flattens hierarchy and hands the reader the job of rebuilding it.
- **Sibling copy when the source is held.** If the author has uncommitted changes to the file, the pass writes to `<name>-clarity.<ext>` beside it. If the file is clean in git, it edits in place and the diff is the record.
- **Render as part of the pass.** A pass that breaks a citation or a cross-reference has failed, so manuscripts with a build step are rebuilt and checked.
- **The report is the deliverable.** It lists changes by kind with counts, the before/after metrics, five to ten verbatim before/after pairs, every judgment call where meaning might have shifted, and anything noticed but not changed because it is a content decision.
- **Review happens in a sentence-aligned diff.** A companion script renders the original and revised text side by side, aligned by sentence, with margin notes and a Keep / Revert / Discuss choice per change. The choices persist through the same review layer as other agent reports (see [interactive-artefacts.md](interactive-artefacts.md)).
- **Corrections become the editorial memory.** When the author overrules a pass, the correction goes into an anti-patterns file as a dated before/after pair. That file has turned out to be worth more than the general principles.

## Gotchas

- **Iteration destroys content if nothing checks for loss per lap.** Research on long delegated document workflows reports substantial content loss accumulating across edits. The invariant script catches the mechanical part (keys, numbers, quotes). Claim-level loss needs a claim inventory taken before the pass and checked after each lap. That gate is designed and not yet built.
- **Judges are weak at style when length and correctness are held equal.** Published benchmarks put zero-shot model preference on writing quality near chance, and preference-based ranking tends to select for collapsed argument. What helps is changing what is asked: reasoning before the verdict, a per-piece binary checklist alongside the prose critique, and at least one reader from a different model family. Asking the same question of more readers of the same kind helps less.
- **Voice is the invariant readers care about most, and nothing measures it yet.** A published sentence-embedding style model was tried as a voice meter against a corpus of the author's own unassisted writing. It turned out to measure register rather than author: the within-register author signal was moderate (AUC 0.79 on mail, 0.89 on academic text), and its noise floor, measured with shuffled and halved controls at about 0.3 standard deviations, swallowed every clarity edit class. A heavy LLM rewrite moved it only 0.5 standard deviations. It cannot serve as a per-lap gate. Until a better meter exists, passes on a human's draft stay at light-copyediting depth, and heavier passes are reserved for text the agent authored itself, where authorship is disclosed and git history is the provenance.
- **Detectors are never a target.** Removing model tells because they cost readers attention is editing. Removing them so a text passes as human-written is deception, and the skill does not do it.
- **Some rules do not transfer between writers.** A band on dash density looked reasonable until the author's own unassisted papers turned out to use almost none, so the rule touched no trait of theirs. Check a style rule against the writer's own corpus before encoding it.
- **Heavy local compute and a live agent session do not mix.** The embedding run for the voice corpus saturated the workstation it started on and stalled the machine's scheduled jobs. It ran in under two minutes on a GPU machine. Move batch compute off any machine that is also hosting live sessions.
