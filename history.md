# History

How Raven evolved from a research spike into a working personal AI assistant. This is the one document here that's about Raven specifically rather than generalizable patterns — it's the context for why the patterns and solutions exist.

## Origins (Feb 2026)

Raven began on February 2, 2026 as a research project asking what a personal AI assistant could be. The first commit was structure and notes — no code. The opening days went to surveying the landscape: existing agent frameworks, session-management patterns, the Anthropic Agent SDK, MCPorter, and the build-vs-extend question.

Two serious candidates were evaluated and set aside. A custom TypeScript agent framework would mean reimplementing tool use, editing, and context management that Claude Code already had and would keep improving. The Agent SDK required an API key and lacked official support for subscription-based auth. Both roads led back to the same realization.

## The Pivot (Feb 7)

Five days in, the project pivoted decisively: **extend Claude Code, don't replace it.** This is the most consequential decision in Raven's history. Instead of competing with the agent core, Raven would add capability through Claude Code's native extension points — skills, hooks, and context files — and let the engine improve underneath it for free.

The same day, the first skills appeared (`raven-status` for cross-project git overview, `raven-reflect` for session review), an archive directory was created for abandoned approaches, and an experimental standalone web terminal was folded into the project under a flat, component-per-directory architecture.

## The Web UI (Feb 7–15)

The web terminal outgrew its name fast. Within days it became a panel-based workspace: an app shell with `registerPanel()`, a message bus, and a panel lifecycle. Status and sessions panels landed the same week, then mobile support (touch scrolling, a shortcut bar, compose mode, voice input), terminal-level Claude detection, and an about page.

The organizing metaphor crystallized here and still holds: the server is the kernel, the browser is the window manager, panels are applications. New surfaces plug in without touching the core.

## The Memory Paper (Feb 8 onward)

A research thread ran alongside the tooling: how should AI agents handle persistent memory? It became a formal paper — *"I Know I Know This: Recognition First in Agent Memory"* — applying dual-process theory to agent retrieval, arguing that agents should use cheap recognition signals before paying for expensive retrieval.

A verification pass on the manuscript caught 22 hallucinated bibliography entries. That single incident shaped two later tools (`raven-verify`, then a citation-recall benchmark) and hardened the project's stance on reading and checking sources. A shorter version became the primary submission; the long paper was demoted to reference.

## Verification and Security (Feb 19–22)

`raven-verify` was built directly in response to the bibliography incident — a three-pass tool (extract claims, verify them, audit references) for prose documents. `raven-audit` followed, scanning Claude Code's permission configuration for stale rules and bypass vectors. Research into the "lethal trifecta" (tool access + untrusted input + an exfiltration channel) produced deny rules and tool guidance that still ship today.

## The Task System (Feb 27 onward)

A cross-project task system arrived: markdown files (one per project), a Python CLI parser, and web UI panels. The defining choice was CLI-as-API — Python owns all parsing and deadline logic, Node calls it with `--json` — so the rules live in one place instead of being reimplemented per consumer. It grew inline editing, an urgency-grouped overview across every tracked project, an inbox, and inline tags (`#next`, `#auto`, `#agent`) for working-set selection and autonomous-work marking.

## Sandboxed Work (Mar 1)

`raven-work` introduced spec-driven autonomous sessions with hook-enforced boundaries. Three profiles (dev, research, review) declare what the agent may touch; a PreToolUse hook checks every call against the profile — paths against worktree boundaries, commands against an allowlist. The governing rule: if you can run it, you can't write it.

*In retrospect: an abandoned approach.* The unattended-work need ended up being met by two lighter mechanisms — the guard's away mode for local runs (March) and cloud agent sessions for web-facing work (which arrive sandboxed by the provider). The spec-driven local sandbox fell out of use; its hook techniques (walk-up config discovery, fail-open policy loading, path containment checks) survive in the hook-system pattern, where they generalize beyond the workflow that spawned them.

## The Persistent Coordinator (Mar 14)

Munin — named for one of Odin's ravens, the one that stands for memory — arrived as a persistent Claude Code session that auto-launches with the web UI server and serves as the standing target for scheduled work. The same day, `raven-echo` was created to generate shareable knowledge extracts from the private repo (this repository is its output).

## Notifications and Scheduling (Mar 16–19)

The notification system gave agents a way to push to the browser: persistent modals for things that must not be missed, ephemeral toasts for status. A CLI wrapper made it callable from any context. The server-side scheduler (node-cron over a hot-reloadable JSON config) connected cron expressions to terminal prompt injection — writing commands straight into a named terminal's PTY. First jobs: nightly memory consolidation and a morning briefing.

## The Guard System (Mar 20–22)

`raven-guard` reorganized tool gating into three modes: always-on guidance that catches permission-triggering command patterns, away-mode blocking for unattended runs, and off. The key insight was *guidance over blocking* in the default mode — teaching the agent to avoid problematic patterns rather than just refusing them. A sidebar toggle and API endpoint exposed the modes.

## The Overnight Pipeline (Mar 22–30)

Away mode plus the scheduler enabled a qualitative shift: unattended overnight automation. Local-only operation couldn't do web research, so the work split in two. A cloud-hosted Claude Code session (scheduled hourly) handles tasks needing web access — one task per run, committed incrementally to a shared branch. The local agent brackets the cloud run: a night-push commits safe work and pre-fetches JavaScript-rendered pages, a night-pull reviews the branch and merges to main as a quality gate.

The git repo became the coordination bus between agents — no direct agent-to-agent channel, just files in a repo. The cloud agent's undocumented time limit forced an incremental-commit habit and a continuation pattern (merge partial results, push, re-trigger with "continue from where you left off") that delivered a multi-run literature review across sequential cloud sessions.

## Threads as First-Class State (late Apr)

The reflect/continue pair had been stashing per-session working state to `in_progress/<label>.md`. In late April that crystallized into a named concept — a *thread*, the unit of work between a single task and a whole project — with its own skill (`raven-threads`) and web UI panel. The important wrinkle: sessions touching a thread are recorded in **per-machine sidecar files** (`in_progress/machines/<clone>/<label>.md`), so several machines cloning the same repo each log their own session history without git conflicts. Machine identity resolves through a hostname→friendly-name map.

## The Reading Principle (May 7)

The project's principle set had covered debugging, error handling, simplicity, critical reasoning, intellectual honesty, and synthesis. A seventh was added: **Read fully — directly or by proxy. Log the read.** It names the failure mode of routing source material through a summarizer and reasoning about the gist, and prescribes the careful-reader subagent as the cost-mitigation that preserves the read instead of discarding it. A per-conversation reading log (with provenance and verbatim excerpts) makes "I read it" auditable.

## Audio (May)

A text-to-speech pipeline turned documents into listenable audio: markdown → strip → chunk → TTS → a content-hashed cache → published audio files, surfaced in the web UI's reader panel. The headline lesson is a thesis the project still holds with appropriate humility — the *rewrite* step (turning prose into spoken form) matters more than the engine, and the hand-rewrite-vs-LLM-rewrite link is the part not yet validated.

## Cross-Project Knowledge (May 14)

The wiki had lived inside the Raven repo. An `rwiki` CLI made it readable and writable from *any* project's working directory, via a discovery sentinel and narrowly-scoped file allows, with an audit-side scanner enforcing the routing discipline. Knowledge stopped being trapped in one repo — a session in any tracked project can reach the shared store without switching context.

## Multi-Session Safety: The Commit-Lock (May 28)

Running more than one Claude Code session in a single shared clone exposed a real hazard: they share one working tree, index, and HEAD, so concurrent `git add` cross-contaminates the stage and a `git commit --amend` can rewrite the wrong commit. `raven-gitlock` added an advisory commit-lock — a session claims the stage→commit sequence; the guard hook blocks index/HEAD-mutating git unless the caller holds the lock; reads and `push` are never gated; the lock fails open so it can never brick the repo.

## The Desktop Shell (late May)

A small Wails app (Go + system WebView) wrapped the browser workspace as a native, multi-instance launcher: it spawns and stops *local* web-ui instances itself, connects to *remote* ones over a VPN, and embeds each in its own iframe so switching between Ravens preserves live session and terminal state. Several Windows GUI/environment gotchas (PATH for spawned processes, iframe clipboard delegation, an environment-variable leak that confused a config-walking tool) were worked out here.

## Going Cross-Platform (early Jun)

What started Windows-only grew a second home on macOS. The skill-sync mechanism already handled symlinks alongside junctions; the June work filled in the smaller seams where portability actually breaks — BSD vs GNU `sed -i` flags, OS-conditional UI labels (Finder vs Explorer), and the multi-machine identity map that keeps per-clone state files from colliding.

## The Fleet Grows a Server (mid-Jun)

The mixed-OS fleet gained an always-on Linux node. The web UI became a user-level system service there, and an important security posture got nailed down: bind only to loopback and the machine's *own* auto-detected VPN address, never the public interface, so a shared instance is reachable across the fleet without being exposed to the internet. An earlier version had hardcoded one machine's VPN IP as a fleet-wide default — a small mistake that became a principle: machine-specific values must be auto-detected per host, never baked in as defaults. The fleet still coordinates purely through git push/pull; there is deliberately no machine-to-machine RPC.

## The Considerations Cockpit (Jun 26)

The overnight pipeline had been quietly creating a problem of its own. The nightly rumination pass files suggestions — drift fixes, citation checks, cleanups — at 3–4 a night, and they had accumulated until roughly 78% of the task list was agent-filed noise burying the dozen items the human actually owned. The fix was a two-part design, stress-tested by a multi-persona review panel before building: **separate the pile** (agent-filed items become *considerations*, computed as a distinct set and excluded from the human's triage count) and **route each by category to a handler** that does the actual work — a safe in-place edit, an adversarial citation verification, or "surface this to a person."

The load-bearing correction came during the build. The first cut said "verification is dangerous, always route it to a human." Proven wrong by running it: an adversarial verification handler resolved most flagged citations autonomously (confirming real papers, fixing one truncated title) and surfaced only the genuinely unsourced one — catching a confabulation. The real line isn't "don't act on uncertain categories," it's *do the verb with inspectable evidence, surface on doubt*. The review panel forced a second correction too: pending human decisions don't get buried behind a tab — a hidden decision is still a to-do you're lying to yourself about — so they sit as a callout in the primary view. The Tasks panel became a **Project Focus** cockpit: committed tasks, the considerations pile, and a review surface where every autonomous edit shows up with a one-command revert.

## Task Discussions (Jun 26)

The same day, a sibling feature addressed the *other* end of the backlog problem: items that rot because their context is forgotten, not because they're hard. A per-item "Discuss" button spawns a fresh agent session, primed to reconstruct — before the human types — when and why the item was filed, what it points at, and whether its premise still holds. It opens with a reorientation rather than a question, stays scoped to the one item, and lands on a concrete disposition. The session runs in a terminal-backed modal that can be *elevated* into a full terminal tab without losing state when a quick chat turns into real work — a clean move only because the modal was a real terminal all along, and the client event bus already fanned out to multiple subscribers.

## The System Writes Its Own Paper (Jun 27 – Jul 4)

Five months in, Raven drafted an academic paper about itself — an experience report with the human and the system as co-authors. The method was the reading principle applied reflexively: careful-reader subagents worked through the project's own design corpus and returned verbatim excerpts, so every quote in the paper traces to a logged read of the actual document. A second draft grounded every claim in measured repository statistics (over a thousand commits, hundreds of recorded sessions, dozens of daily narratives) rather than remembered impressions. An external review by an unrelated frontier model corroborated the paper's most self-critical section rather than its most flattering one.

The fourth draft delivered a genuine conceptual shift. The paper had opened as a defense of the founding bet — durable layers (memory, skills, discipline) over a commodity runtime. Writing honestly about five months of evidence forced a reframe: the runtime *absorbed* the layer's cleverest memory mechanism before it shipped, and even the memory data came to rest in the runtime's managed directory. What survives isn't any layer; it's the **synchronized environment** — the shared, file-based state that person, agent, and a moving runtime continuously calibrate against each other — and the durable work is the calibration itself. The paper keeps a standing section arguing *against* its own thesis where the evidence demands it.

This repo gained a `sources/` directory in the same stroke: verbatim, point-in-time snapshots of the private design documents the paper quotes, so its citations resolve publicly. Paper and echo now complement each other — the paper is the argued, versioned account; the echo is the living tour.

## Reports That Answer Back (Jul 8–14)

Agent-written HTML reports had always been one-way: read in the browser, feedback retyped into chat, context lost in transit. An interactivity layer closed the loop — choice widgets and comment affordances on the reports themselves, persisting to a sidecar file beside each artifact, with an explicit Submit bundling a review into a single consideration for the handler loop built in June. The design document for the feature was itself the first interactive artifact, and the first real review traveled the full pipeline: widgets → sidecar → consideration → applied edits. A second phase added **worklogs** — long tasks append JSONL events that a generic viewer renders live, and a finished worklog freezes into a report that inherits the comment layer. Server-side script injection plus auto-anchored headings made the entire report back-catalogue commentable without regenerating a single file.

## Threads Become Addresses (Jul 14–15)

Scheduled jobs had always targeted a terminal by name — brittle the moment tabs churned, and useless for work that hadn't started yet. A design round settled it: the *thread* (the durable work unit from April) becomes the routing target. Terminals carry a thread property, cron jobs launch fresh sessions on a thread (skipping if one is live), and a single event endpoint lets any process — or any machine — message a thread: append to a durable per-thread log, ring a doorbell if a session is live. The organizing principle: **files carry content, injection carries doorbells.** The nightly pipeline moved out of the standing coordinator into its own nightly thread; the coordinator's role narrowed to verifying the night's work each morning and closing the tab. Within days the event lane carried its first real cross-machine conversation — a debugging round trip between two machines — and field use hardened it: doorbell paths went absolute after a recipient in a different working directory concluded an event didn't exist, and a convention was written down that events are *requests, not authorizations*.

## The Fleet Becomes Real (Jul 15)

The machine roster graduated from a hostname-alias map to a full **registry** — platform, role, VPN address, availability windows, capabilities, and a reserved proxy port per machine — and backend switching shipped the same day: every server reverse-proxies every other machine's UI on that machine's globally unique port, so *port = machine, from anywhere*, and links compose correctly even through an already-switched view. Proxied clients get their mutations blocked server-side (an edit made while viewing another machine would land in the wrong working tree) and a badge naming the backend. The whole thing rolled out fleet-wide in one day, including switching from a phone. June's "deliberately no machine-to-machine RPC" posture ended here — narrowly: the fleet's control plane is doorbells and liveness pings over the VPN, while content still rides git.

## The System Draws Its Own Figures (Jul 15–19)

A second GPU service joined the self-hosted roster: an open-weight, caption-trained image model on a fleet machine's spare GPU, VPN-bound like the TTS server but **load-on-demand** — the host has a day job, so the model unloads after idle minutes, and a lease endpoint keeps it warm through iteration loops. Three days later a figure-generation skill turned it into a paper tool, collapsing a published multi-agent architecture into phases of one session with two lanes: SVG code for structural diagrams, structured JSON captions for pictorial figures — where the caption, not the image, is the artifact under iteration, and a fixed seed makes surgical caption edits approximately structure-preserving. Both lanes shipped real figures into real papers within a day of the skill existing. The service also produced this period's hardest-won lesson: an expired auth token killed cold loads despite fully cached weights, because the loader validated online before reading disk — serving is offline-first now.

## Memory Gets a Master Copy (Jul 23–26)

Persistent memory had lived where the runtime put it: a per-user directory on each machine, unsynced, invisible to every other clone. With four machines that had become untenable — a lesson learned on one box was unreachable from the next, shared facts drifted into three differently-worded versions, and machine-specific entries were tangled with fleet-wide ones so nothing could safely be copied.

The fix started with a decision that was about privacy rather than engineering: **git-track the memory directory itself**, accepting that topic files now travel wherever the repo travels. With that granted, the mechanism is small. The canonical index lives in the repo; the file the agent auto-loads is that index plus an optional per-machine local section below a marker line, whose entries never leave the machine. Machine-specific topic files sit in a per-machine subdirectory, still in git, pointed at only by that machine's local section.

The design's one deliberate asymmetry: blind copy runs only master → runtime. Promoting a local entry *into* the shared master is an agent's judgment call at nightly consolidation, because that's the single edge where a wrong move either leaks local detail into shared state or buries a shared lesson on one machine. Within a day of shipping, promotions were flowing from two machines at once and produced a push race — resolved as an ordinary text merge, which is the design working: git is the conflict surface, and no bespoke sync protocol was ever written. The remaining clones were onboarded over the following three days; the third surfaced real gaps, the fourth surfaced none, which is where the tooling's claim upgraded from "works on the machines we tried" to portable.

## The Fleet Becomes a Room (Jul 24–30)

A headset arrived in the loop and the fleet gained a third frontend. From thread-open to sharp text and no freeze in the headset took a single evening — with the human typing into the building session *from inside the headset* mid-build — and the next day the one-machine-at-a-time view was gone: every reachable machine in a fixed angular slot, its own cluster of session panels, ownership drawn as colour and geometry rather than labels, the selected peer fully live including keyboard input.

The organizing question was answered before the rendering work: this is a **watchtower with a seat**, not a workspace. Three verbs — notice, turn to, converse — and anything serving none of them stays on the desktop. The third verb was argued down from "answer" (small acts that unblock) to full conversation, on the project's own evidence that agent sessions are conversational; a filter whose spirit is "minimal acknowledgement buttons" would have built a watchtower where you can only grunt.

Two findings were cheaper than expected and one was much harder. Reaching peer machines needed no relay, no subscription registry, and no fan-out — just a same-origin websocket route piping the peer's protocol verbatim, about fifteen lines, arrived at by asking why the mobile client's existing machine-switching wasn't enough. Wake cues needed no new protocol either: the server had been broadcasting permission and completion events all along and the client was dropping them. The hard one was a judder that made the whole world swim on every terminal update; three successive causal models were falsified (frame-budget overrun, stale head pose, GPU-bound rendering), and what shipped was a perceptual mitigation — hold texture uploads while the head is turning, flush after a quarter-second of calm — recorded honestly in the thread head as *consistent with* the surviving model rather than a confirmation of it.

## Learning to Distrust Its Own Reports (Jul 28 – Aug 10)

The most consequential work of this period produced no feature. Running an autonomous pipeline long enough surfaced a failure family that ordinary bugs don't cover: **a check that didn't run is indistinguishable from one that passed.**

The instances arrived from every direction. A guardrail hook had been switched off for four days while two consecutive nightly reports recorded "zero guard bounces" as a property of the night. A coverage script reported clean against a hand-written list that had never gained the newest screens. A screenshot driver's cache-buster was keyed to file modification time — correct for "did it change", useless for the verification case where you re-shoot an unchanged file. An agent that died mid-write left a file that was present, well-formed, and the previous version, so every exists-and-looks-right check passed. And across a dozen nightly passes, the cloud agent stated article edit dates that did not match the local `git log`. They were fluent and in range, and on any one night the wrong ones shared a value.

That last one was first diagnosed as confabulation, and the diagnosis was wrong. Reading the error signatures together had seemed to rule out any single misread instrument. On 08-11 the gate measured the wrong values against something other than each other. The commit distance from each night's shared wrong date to that night's run was always about a hundred. The cloud checkout was a depth-100 shallow clone. In a shallow clone `git log` returns the graft boundary's date for every file older than the window. The agent had run the right command and copied its output faithfully all along. The instrument was git, standing on a truncated history. This echo went on repeating the original diagnosis until the September run caught it. That is its own small instance of the family. The lesson that outlived the episode: *before filing a recurring error against an agent's reliability, check what its tools stand on.*

The fixes are structural and mostly live at the prompt layer, because stating a date is a legitimate action no hook can gate: cite the command that produced a value *in the same pass* or omit it, with the omission clause doing the load-bearing work; derive a coverage scope from the filesystem and print what was covered rather than how many; key cache-busters on the clock rather than the subject. A companion trap surfaced in the same weeks — a prompt fix is in force when the consuming run's checkout contains it, not when it's committed, and a constraint that appears to have failed may simply never have been delivered.

## Three Tenants, One Card (Aug 10–11)

The self-hosted GPU services had each been a success on its own terms, and together they were a collision waiting to happen: an image model, a speech model, and a local chat/embedding runtime, each around 20 GB, all load-on-demand, all on one 24 GB card, none aware of the others. Whichever loaded second died. The near-miss that forced the work was a queued hundred-minute speech render that any image request from any machine would have killed — with a *truncated file* as the only symptom, because the speech backend fails silently and still returns success.

The first design was a lease service: backends ask before loading. It was argued down within the day, on a reason worth keeping: **a lease is arbitration by cooperation**, so anything that can still reach a backend directly walks past it, and a bypassed lock is worse than no lock because it looks like protection. A proxy makes arbitration a property of the **topology** — front the backends, bind them to localhost, and admission becomes a queue in one process, with no changes to any backend (one of them unmodified upstream code nobody wanted to fork). The "smaller, safer first step" turned out not to be smaller: the lease needed clients migrated off the direct addresses anyway, which is the proxy's whole premise.

The same instinct settled the migration. Preserving the incumbent service's contract at its old address had already forced two compatibility hacks before a single client had moved, so the old addresses were **retired rather than proxied** — connection refused is a loud failure; a shim is a client that keeps working while quietly meaning something else.

Everything after that was learned by running it. A backend's self-reported memory use (in its own units, for its own purposes) set the admission bar above what the machine could ever offer and vetoed every speech request forever. An optimisation that shared one probe between two callers silently changed the question from "who answered" to "who is holding", so an idle-but-healthy service was reported as not answering. A health-check timeout tuned for the request path reported a mid-load backend as down once probes moved to a background loop. And the boot task failed silently twice — a bare tool name absent from the service account's PATH, then a trigger firing before the VPN interface existed — both already solved in the sibling service next door, whose launcher and `main()` nobody had read.

## Guardrails That Know the Mode (Sep 5)

A disk-full incident forced one rule. An orphaned recursive search over a cloud drive that downloads files on first read walked hundreds of thousands of placeholders overnight and filled the system disk under the nightly pipeline. The guard now blocks recursive walkers aimed at hydrating roots, home roots and drive roots, and teaches a deliberate walk instead. The same day the guard learned to read the agent runtime's own permission mode. Rules that exist only to avoid permission prompts skip when the runtime auto-approves, and safety rules never skip. Before this, sessions in auto mode kept switching the whole guard off to get past pointless blocks, and that removed the safety rules along with them.

## Writing for Readers Outside (Sep 6–7)

The system drafts papers and chapters, and correct prose is not the same as readable prose. A clarity-pass skill made meaning the invariant: citations, cross-references, numbers and quotations are script-checked, and hedges, concessions and attribution are read-checked. The pass iterates to convergence with three different instruments, metrics aimed at a band, a full read-through, and a fresh-context reader. Its first trial ran six laps on a paper draft. A research pass on verifying writing quality followed, with a first voice meter built against a corpus of the author's own unassisted writing. The meter failed on measurement: it tracked register, not author, and its noise floor swallowed every edit it was meant to detect. That result set the rule that passes on a human's draft stay light. The same week, the eighth version of the system paper and the core of a second paper were committed after a week of held review.

## A Second Agent Runtime (Sep 8–9)

A second agent CLI was installed beside the first. An audit found the starting point worse than nothing: the instructions advertised tools that were not installed, and none of the guardrails applied outside the first runtime. The design that emerged transfers requirements, not mechanisms. The second runtime gets a generated context file from the same sources, registers its sessions through its own hook system (which turned out to use the same payload field names), and keeps its own memory, promoted at consolidation. A planned memory CLI was dropped once it became clear it would only be an instruction with extra steps. Threads became the cross-agent handoff unit, with session links tagged by agent.

## Joining a Managed Fleet (Sep 10–15)

Two organisation-managed, domain-joined Windows machines became fleet members, and each surfaced a class of problem the personal machines never had. Home resolved to a network share for one shell and to the local profile for everything else. A per-script patch compensating for it was shipped and then reverted, because it hid the best diagnostic the setup had. The VPN interface came up in a firewall profile with no allow rules. A runtime upgrade on another machine produced a dismissed firewall popup whose Block rule beat every port Allow, which looked like a tunnel fault because remote desktop kept working. A new clone ran without guardrails until its settings were written, and two setup sessions committed over each other in that window. An audit then found that the setup document's template deny set had drifted, and asked too late who had already copied it.

## Pull, Not Replay (Sep 10–11)

Cross-machine events had exposed the "nobody's home" case in July. In September it was settled by deciding not to build. An overnight experiment went unscored because the nightly session never learned it was a test night. The next night showed the working channel: the nightly read durable notes at launch and retired a stale ask on its own. Event replay was dropped for good. Threads that expect answers pull their own logs on wake, and senders treat `delivered: false` as a reason to escalate to a human. The same week a morning check reported 4 of 4 over a night whose final commit had died. Every check read files and none read git. A check that reads the file cannot see the commit.

## One Decision a Day (Sep 23–26)

The open pile of tasks and agent-filed considerations had reached nearly three hundred. A conversation about the system as an organisation diagnosed why it cost attention: four kinds of item in one list, asks arriving as histories instead of recommendations, silence with no meaning, and answers not reliably becoming action. Before restructuring anything, a two-week experiment started. A standing thread raises one prepared decision each evening, the human answers with a click that posts back to the thread, and a yes is executed and committed. The first three runs retired eighty-five items. One of them fixed, at the source, the shallow cloud checkout behind a long run of wrong dates. That family had been diagnosed as confabulation for its first twelve instances and as an infrastructure fault since mid-August.

## Current State (Sep 27, 2026)

Just under eight months from first commit. The system now has:

- **Two dozen skills** — status, reflection, continuity, threads, task and inbox management, claim/reference verification, security auditing, paper reading, figure generation, memory consolidation, knowledge wiki access, audio narration, knowledge-echo generation, tool guardrails, away mode, commit-locking, considerations-convergence, task discussions, a clarity pass for publication prose, and skill development itself.
- **A panel-based web UI** spanning terminal, a Project Focus cockpit (tasks, considerations, review), overview, sessions, status, memory, wiki, reader, and settings — usable from desktop, mobile, and a native desktop shell.
- **A considerations-and-handlers loop** that keeps the agent's own filed suggestions from drowning the human backlog — routing each to a handler that does the verb with inspectable evidence, or surfaces on doubt.
- **A decision desk** that turns the open pile into one prepared decision per evening, answered with a click that posts back to the thread and executed on yes.
- **A notification and scheduling system** plus a persistent coordinator session for proactive, scheduled agent behavior.
- **An overnight local-cloud pipeline** for unattended research, memory maintenance, and security auditing.
- **A wiki knowledge base** reachable from every tracked project, with nightly librarian-style consolidation and reflective daily narratives.
- **A mixed-OS fleet with a real control plane** — personal Windows and macOS clones, organisation-managed Windows machines, and an always-on Linux node; a git-tracked machine registry; backend switching to any machine's UI from anywhere; cross-machine thread events over the VPN; content still riding git.
- **Two agent runtimes in the same workspace**, sharing orientation, threads and session tracking, each with its own mechanisms.
- **A spatial client** — a WebXR page rendering the fleet as a room, riding the existing session and terminal protocols with one same-origin route added, used as a watchtower rather than a workspace.
- **Fleet-wide memory** — one git-mastered index projected into each machine's runtime, with a per-machine local section and agent-judged promotion in the one direction that needs judgment.
- **Self-hosted GPU services behind one arbiter** — text-to-speech, image generation, and a local chat/embedding runtime sharing single cards, with admission by memory budget, honest `503`s naming the holder, and lifecycle supplied for the tenant that has none of its own.
- **Interactive artifacts** — reports that collect their own review through choice widgets, heading comments and comments on any selected text, feeding the considerations loop; worklogs that render long tasks live and freeze into commentable reports.
- **Research papers** on agent memory, on assessment design, and — reflexively — on the system itself, all spun out of the day-to-day work.
- **This echo repo**, regenerated periodically from the private codebase, now carrying the paper's public source snapshots alongside the generated docs.
- **A verification regime for its own reports** — measured-or-omitted values, derived rather than declared scopes, the discipline of asking what a clean result would look like if the check had never run, and checking what a tool stands on before blaming the agent that ran it.

Active fronts include the decision desk's two-week review, a better voice instrument for the clarity pass, skill discovery for the second runtime, a boot-time start path for machines that need a login, and the assessment and system papers.

One long-running investigation deserves its own line, because its *shape* is the output: a transient write failure in the git object store, now twenty-four instances deep. Two explanatory hypotheses were proposed, tested and retired by their own evidence. A probe run at the moment of failure has returned the same verdict every time. A sync-pause test finally ran, and its seven clean nights suggest the sync client without establishing it, for reasons written down in advance. The error has since appeared once outside git, on a plain file write in the same synced folder. See [solutions/transient-git-einval.md](solutions/transient-git-einval.md).
