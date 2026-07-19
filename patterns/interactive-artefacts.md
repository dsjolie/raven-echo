# Interactive Artefacts: Reports That Collect Their Own Review

## Problem

An agent that writes HTML reports — design docs, research summaries, comparison pages — creates a review problem: the human reads the report in a browser, forms decisions and objections, and then has to *transcribe* them into a chat message or a task, detached from the places in the document they refer to. Feedback arrives lossy, late, or not at all. And a long-running agent task has the mirror problem: while it works for an hour, the human has no window into progress except asking.

## Approach

Two mechanisms, one philosophy: the artifact itself is the interface, and everything persists to plain files beside it.

**Annotation layer.** Reports carry small declarative markup at decision points — `data-choice="key" data-options="A|B"` renders as a clickable choice widget; headings get anchors (explicit `data-anchor`, plus auto-anchored `h2`/`h3` from slugified text); a single script tag (relative URL, last in body) activates widgets and adds comment affordances to anchored sections. Every choice click and comment saves immediately to a sidecar file next to the artifact — `<stem>.annotations.json`, a latest-state document, not an event log. An explicit **Submit review** bundles everything unsent into *one* work item routed into the agent's consideration queue (see [considerations-and-handlers.md](considerations-and-handlers.md)) with an apply-feedback handler: choices are recorded decisions to propagate; comments are edits to make or questions to surface.

Ownership follows the filesystem: the sidecar lives with the artifact, and the owning project is resolved by longest-prefix match of the artifact's path against registered project roots — the same trust anchor used everywhere else. Feedback about a document lands in the project that generated it, not in the hub.

Because anchoring is derived (auto-anchored headings) and the script is injected server-side when serving any registered HTML document, the **entire back catalogue becomes commentable without regenerating anything**. Old reports written before the mechanism existed grow comment affordances the next time they're opened.

**Worklogs.** A long task appends events to a JSONL file (`docs/worklogs/<slug>.jsonl`) via a CLI — locally, no server required to emit. Events are `{ts, type: meta|step|note|result|error|final, title, md, img}`. A generic viewer polls the file every couple of seconds and renders a live timeline, screenshots included. When the task ends, a finalize step renders the log into a static HTML report with per-step anchors and the annotation script tag — so a finished worklog *is* an interactive artifact and inherits the whole review layer for free. The rule that keeps this clean: **the log is JSONL events plus a generic renderer, never append-to-HTML.** HTML is a render target, not a data format.

## Implementation

The authoring contract is deliberately tiny — a report author (usually the agent itself, via a skill convention) writes:

```html
<h2>Storage layout</h2>            <!-- auto-anchored from slug -->
<div data-choice="storage" data-options="sidecar|central-db"></div>
...
<script src="/artefact.js"></script>  <!-- relative URL, never a host -->
```

Server side is three small routes (state / annotate / submit) plus the worklog routes (parse, list by scan, serve assets, finalize). The sidecar write is atomic-rename with a bounded retry on permission errors, because sync clients (Dropbox et al.) briefly lock freshly-written files.

Submission files **one** consideration per review, not one per annotation. The agent's queue gets "a review of report X arrived: 2 decisions, 5 comments," and the handler works through the sidecar. Per-annotation filing would spam the queue and lose the review's coherence as a unit.

## Gotchas

- **Same-origin by construction, relative URLs only.** The reader serves artifacts through a document route on the same origin, so the annotation script can call the API with relative URLs — which also makes it work unchanged over the VPN from other machines. Opened as `file://`, the script simply isn't reachable and the report degrades to static HTML. Hardcoding a host anywhere in the script breaks exactly the remote case you want.
- **Sidecar is latest-state, not an event log.** The consumer is an agent session reading "what does the reviewer currently want" — history of clicks is noise. Removing a comment removes it; changing a choice overwrites it.
- **Pull, don't ping.** Submitting a review files the consideration and stops. The agent's queue-draining cadence picks it up. The synchronous "discuss this now" case is a different mechanism (a context-primed conversation), not a faster version of this one.
- **Polling beats WebSocket for worklog viewing.** The viewer is a static page reading an append-only file through a parse endpoint; a 2-second poll that stops on the `final` event is simpler than connection management and plenty live for a human watching a build.
- **The convention only proves out in anger.** The first real use of a worklog on a genuine long task, and the first real review traveling widgets → sidecar → consideration → applied edits, both surfaced adjustments no amount of design review found. Ship the minimal loop and run something real through it before adding surface.
