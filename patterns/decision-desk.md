# Decision Desk: One Prepared Decision a Day

> **Status as of 2026-09-27:** a two-week experiment, three runs in, review due around 2026-10-07. What would falsify it: the open pile not shrinking across the two weeks, or suggestions going unanswered. The numbers below are from the first three runs and should be read as such.

## Problem

An agent system that runs every day produces a backlog faster than a person drains it: human tasks, agent-filed suggestions ("considerations", see [considerations-and-handlers.md](considerations-and-handlers.md)), open questions left by past sessions, standing asks from the coordinator. After a few months the pile in this system stood at nearly three hundred open items. A diagnosis of why it cost so much attention found four causes:

1. One list holds four kinds of item.
2. Asks reach the human as histories ("here is what happened, what do you think?") rather than as finished recommendations.
3. Silence has no meaning. An unanswered ask might be a no, a not-now, or unseen.
4. Answers do not reliably come back as action.

Restructuring the task system would address the first cause and not the others. It is also expensive to undo.

## Approach

Before any structural change, run a cheap experiment: a standing thread whose only job is to turn the pile into **one well-prepared decision per evening**. The human answers with a click. If one finished recommendation a day drains the pile and gets answered, a structural change can follow the evidence. If not, the thread is easy to stop.

The suggestion is written as **completed staff work**. It says what happens on yes, why this is the recommendation, which items it retires, and whether it can be undone. The human should not need to open anything to decide. One suggestion may bundle many items of the same kind, provided a single yes settles all of them: "apply these 28 wiki-drift fixes", "verify these 21 claims and drop these 28 leads". The pile grows by about two items a night, so a suggestion that settles one item a day would never catch up. The desk prefers suggestions that retire a class.

There are three answers, and each can carry a comment:

- **Do it.** Execute the suggestion, adjusted by the comment. Then commit exactly the files that decision touched. The click is the go-ahead for that commit, and nothing is pushed.
- **Drop it.** Reject the *suggestion*. The items it bundled stay where they are. The framing goes on a *dropped framings* list and is never offered again in that form. A later suggestion may build on it, reframed or narrowed, and has to say what changed.
- **Close.** Not today. The suggestion may come back. By its third appearance it has to say that it is a repeat, because repeated non-acceptance is information about the suggestion.

Recommending that items be *abandoned* is a legitimate suggestion ("drop these 14 stale items", answered with Do it). This lets the record distinguish stopping something from finishing it. The task format previously had no way to express that ending.

Every so often the desk picks something that is the human's to shape, such as a design choice or a direction, instead of housekeeping. Otherwise the channel trains the human to expect only chores.

## Implementation

- **Two scheduled jobs.** One launches a fresh session on the desk thread just before the evening slot. The second prompts it to read the pile, re-check the premises of the items it is considering, write the suggestion to a dated markdown file, and raise a decision modal.
- **The decision modal** is the existing notification modal with a comment field and Do it / Drop it buttons. It is raised with a thread label and an id (the date). A click posts `{type: "desk-decision", id, choice, comment}` to the thread event endpoint (see [thread-routing.md](thread-routing.md)).
- **Durable first, delivery second.** The server appends the event to the thread's log before trying to deliver it. A click made after the evening session has ended is still in the log, and the next run handles it first. This is pull-on-wake, and it is why the desk needs no event replay.
- **Access later.** A tile on the hub panel opens the newest suggestion file and shows amber while today's is unanswered.
- **Authorization posture.** The event channel is unauthenticated inside the VPN. The thread therefore executes only a suggestion it made itself, matched by id, and only the action that suggestion described. An event with an unknown id, or one asking for anything beyond the suggestion, is logged and not acted on.
- **Measures, per run:** what was suggested, how many items it bundled, whether it was accepted, the comment, how long until the answer, and the size of the open pile.

## Results so far

Three runs, all accepted, all within a minute to three-quarters of an hour of the modal appearing, none with a comment. The pile went from 286 to 206 open items: 28 retired on the first night, 49 on the second, 8 on the third. The third was the first "yours to shape" suggestion, a two-option design choice with a recommendation, and it was answered as quickly as the housekeeping runs.

Parallel agents on disjoint file sets did the execution, with the orchestrating session owning any shared file. A 28-item bundle took about thirty minutes of agent time.

## Gotchas

- **Re-check every premise at execution time.** A suggestion filed weeks ago describes the world at filing time. In the first batch the executing agents found premise errors in about a quarter of the items: already satisfied, partly done, or claiming something was "named nowhere" when it existed. Verify-while-applying is part of the job, not overhead.
- **An existence check tells you little about a web-sourced claim.** The second run checked 21 claims that earlier agent passes had written into the wiki. Every cited source existed and no identifier was wrong. The errors were all in the *reading*: a mechanism stated backwards, a term the source never uses, a reversal reported as a null result, a single-authored paper written up as joint, anti-bot blocks recorded as paywalls, and the article's own argument credited to the paper. Only reading the source against the sentence found them.
- **Positional item numbers are not ids.** The task CLI has no stable identifiers, so "#n" means "nth open item at 19:00" and shifts as soon as anything closes. Execution matches by text instead (the shortest unique prefix of 40+ characters), which worked every time. The human, though, cannot use the numbers to look anything up.
- **A tool's success message is a claim.** The task CLI printed "Completed" and exited non-zero without persisting on 3 of 77 calls across the first two runs. On the third night the same write failed with a legible `Invalid argument` on the plain task file, in a folder managed by a sync client. Because one of the verbs is a toggle, a blind retry after a half-persisted write would re-open the item. The rule is to re-list, then retry only what is missing.
- **Shared files need partial staging.** The task file and the wiki index regularly hold other sessions' uncommitted lines. The desk stages only its own hunks by writing the intended blob with `git hash-object -w` and pointing the index at it with `update-index --cacheinfo`, leaving the working tree alone. Line endings bite here. With `core.autocrlf` on, the committed file is LF and the working tree is CRLF, so match lines with `\r` stripped. Copy each changed line from the working tree rather than reconstructing it, because the CLI's "done" also appends a marker a hand-built line would miss.
- **"Drop it" and "drop these items" are different verbs.** The first rejects the suggestion. The second is a suggestion to abandon items. Both are needed, and the interface has to keep them from being confused.
