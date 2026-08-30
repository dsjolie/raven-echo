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

The instances arrived from every direction. A guardrail hook had been switched off for four days while two consecutive nightly reports recorded "zero guard bounces" as a property of the night. A coverage script reported clean against a hand-written list that had never gained the newest screens. A screenshot driver's cache-buster was keyed to file modification time — correct for "did it change", useless for the verification case where you re-shoot an unchanged file. An agent that died mid-write left a file that was present, well-formed, and the previous version, so every exists-and-looks-right check passed. And across eight nightly passes, an agent stated article edit dates that no `git log` had produced — fluent, in-range, often adjacent to something true.

That last one was diagnosed by reading its error *signatures* together rather than one at a time: a shared wrong value across a report, an exact one-month shift, a date borrowed from a neighbouring sentence. Three incompatible error shapes all yielding plausible values killed the working hypothesis that some wrong instrument was being misread. There was no instrument to find.

The fixes are structural and mostly live at the prompt layer, because stating a date is a legitimate action no hook can gate: cite the command that produced a value *in the same pass* or omit it, with the omission clause doing the load-bearing work; derive a coverage scope from the filesystem and print what was covered rather than how many; key cache-busters on the clock rather than the subject. A companion trap surfaced in the same weeks — a prompt fix is in force when the consuming run's checkout contains it, not when it's committed, and a constraint that appears to have failed may simply never have been delivered.

## Three Tenants, One Card (Aug 10–11)

The self-hosted GPU services had each been a success on its own terms, and together they were a collision waiting to happen: an image model, a speech model, and a local chat/embedding runtime, each around 20 GB, all load-on-demand, all on one 24 GB card, none aware of the others. Whichever loaded second died. The near-miss that forced the work was a queued hundred-minute speech render that any image request from any machine would have killed — with a *truncated file* as the only symptom, because the speech backend fails silently and still returns success.

The first design was a lease service: backends ask before loading. It was argued down within the day, on a reason worth keeping: **a lease is arbitration by cooperation**, so anything that can still reach a backend directly walks past it, and a bypassed lock is worse than no lock because it looks like protection. A proxy makes arbitration a property of the **topology** — front the backends, bind them to localhost, and admission becomes a queue in one process, with no changes to any backend (one of them unmodified upstream code nobody wanted to fork). The "smaller, safer first step" turned out not to be smaller: the lease needed clients migrated off the direct addresses anyway, which is the proxy's whole premise.

The same instinct settled the migration. Preserving the incumbent service's contract at its old address had already forced two compatibility hacks before a single client had moved, so the old addresses were **retired rather than proxied** — connection refused is a loud failure; a shim is a client that keeps working while quietly meaning something else.

Everything after that was learned by running it. A backend's self-reported memory use (in its own units, for its own purposes) set the admission bar above what the machine could ever offer and vetoed every speech request forever. An optimisation that shared one probe between two callers silently changed the question from "who answered" to "who is holding", so an idle-but-healthy service was reported as not answering. A health-check timeout tuned for the request path reported a mid-load backend as down once probes moved to a background loop. And the boot task failed silently twice — a bare tool name absent from the service account's PATH, then a trigger firing before the VPN interface existed — both already solved in the sibling service next door, whose launcher and `main()` nobody had read.

## Current State (Aug 29, 2026)

Just under seven months from first commit. The system now has:

- **Around two dozen skills** — status, reflection, continuity, threads, task and inbox management, claim/reference verification, security auditing, paper reading, figure generation, memory consolidation, knowledge wiki access, audio narration, knowledge-echo generation, tool guardrails, away mode, commit-locking, considerations-convergence, task discussions, and skill development itself.
- **A panel-based web UI** spanning terminal, a Project Focus cockpit (tasks, considerations, review), overview, sessions, status, memory, wiki, reader, and settings — usable from desktop, mobile, and a native desktop shell.
- **A considerations-and-handlers loop** that keeps the agent's own filed suggestions from drowning the human backlog — routing each to a handler that does the verb with inspectable evidence, or surfaces on doubt.
- **A notification and scheduling system** plus a persistent coordinator session for proactive, scheduled agent behavior.
- **An overnight local-cloud pipeline** for unattended research, memory maintenance, and security auditing.
- **A wiki knowledge base** reachable from every tracked project, with nightly librarian-style consolidation and reflective daily narratives.
- **A mixed-OS fleet with a real control plane** — Windows and macOS clones plus an always-on Linux node, a git-tracked machine registry, backend switching to any machine's UI from anywhere, cross-machine thread events over the VPN, and content still riding git.
- **A spatial client** — a WebXR page rendering the fleet as a room, riding the existing session and terminal protocols with one same-origin route added, used as a watchtower rather than a workspace.
- **Fleet-wide memory** — one git-mastered index projected into each machine's runtime, with a per-machine local section and agent-judged promotion in the one direction that needs judgment.
- **Self-hosted GPU services behind one arbiter** — text-to-speech, image generation, and a local chat/embedding runtime sharing single cards, with admission by memory budget, honest `503`s naming the holder, and lifecycle supplied for the tenant that has none of its own.
- **Interactive artifacts** — reports that collect their own review through choice widgets and comments, feeding the considerations loop; worklogs that render long tasks live and freeze into commentable reports.
- **Research papers** on agent memory, on assessment design, and — reflexively — on the system itself, all spun out of the day-to-day work.
- **This echo repo**, regenerated periodically from the private codebase, now carrying the paper's public source snapshots alongside the generated docs.

- **A verification regime for its own reports** — measured-or-omitted values, derived rather than declared scopes, and the discipline of asking what a clean result would look like if the check had never run.

Active fronts include the system paper's revision loop, cold-start delivery for cross-machine events (the "nobody's home" case turned out to be the normal one), the assessment and memory papers, verification of the spatial client's wake cues in a headset, and continued refinement of the overnight pipeline.

One long-running investigation deserves its own line, because its *shape* is the output: a transient git write failure now seventeen instances deep, with two successive explanatory hypotheses proposed, tested, and retired by their own evidence, a probe that runs at the moment of failure and has returned the same verdict seven times, and one cheap decisive test that needs a human and has gone unrun through seventeen asks. Nothing currently predicts an instance — which is a more informative state than a plausible story still standing, and only reachable because every instance was logged with its preceding activity rather than just its error text.
