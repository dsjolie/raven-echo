# Thread Routing: Messaging Long-Running Work

## Problem

Once an agent workspace has scheduled jobs, multiple machines, and long-running work threads, things need to *send messages to work*: a cron job wants to prompt tonight's pipeline session, a session on another machine wants to hand over a finding, a skill wants to nudge "whatever session is handling the deploy." But sessions are ephemeral and tabs churn — addressing "the session named X" breaks the moment the tab is renamed, closed, or hasn't been started yet. The stable thing is not the session; it's the *thread* — the durable unit of work (see [threads.md](threads.md)). Routing needs to target that.

## Approach

**Threads become the routing unit.** Terminal tabs carry a `thread` property; the scheduler targets threads rather than tab names (name-prefix matching survives only as a fallback); a `launch-thread` action starts a fresh session bound to a thread. One principle organizes the rest:

**Files carry content; injection carries doorbells.** Never push a payload into a session's prompt. An external event is appended to a durable per-thread log (`data/events/<thread>.jsonl`), and *if* a session is live on that thread, a short doorbell is injected: "you have an event, read the log at <absolute path>." The message survives whether or not anyone is home; the injection is merely a wake-up. This split also keeps the API tiny — no task-op endpoints, no payload schemas. Content rides git and files; the API rings doorbells.

The event endpoint is one route: `POST /api/event {thread, source, ...}` → append to the log, doorbell if live, respond `{ok, delivered}` so the sender knows whether anyone was woken or the event is waiting in the log. Cross-machine messaging is *the same endpoint* on the target machine's VPN address — no new protocol, no broker. Inside the VPN bind boundary there's no auth; the corollary is a hard rule that the endpoint must never be exposed through any public proxy.

**Injections are verified, not trusted.** Injecting text into a terminal is fire-and-forget — the session might be mid-tool-call, showing a permission prompt, or a bare shell. So the server checks, ~10 seconds later, whether the injected prompt actually appears in the prompt-submission log (whole-prompt match). Misses go to `data/routing-misses.jsonl` and a toast — *log, don't file tasks*: a routing miss is operational noise to review in the morning sweep, not a work item.

**Scheduled launches skip if live; manual launches don't.** A cron re-firing into a thread that already has a session would double-run the pipeline — skip and log. A human launching a second session on a thread is deliberate and wanted.

**Events are requests, not authorizations.** A thread that accepts events declares, in its thread file, how it handles them — and the receiving session verifies the event's claims and makes its own go/no-go before mutating anything real. An inbound "deploy is ready, restart the service" is input to a decision, not a command. This matters more as events start crossing machines: the sender's context and the receiver's reality can differ.

## Implementation

The sender-side verb is one CLI call, usable from any session on any machine:

```
raven-ui event --thread <label> --message "..." [--host <vpn-ip>] [--file <path>]
```

`--file` exists because long or quote-heavy payloads through shell quoting is a losing game — write the message to a file, point at it.

The nightly pipeline was the first consumer: a scheduled `launch-thread` opens a fresh session on the `nightly` thread each night, pipeline jobs target the thread, the session ends by writing its reflect state, and a separate manager session's morning check verifies from durable state and closes the tab. The manager *manages lifecycle*; it never relays messages — anyone who wants the nightly thread's attention events it directly. Routing removed the manager-as-switchboard role that had accreted by default.

## Gotchas

- **Doorbell paths must be absolute.** The first real cross-machine delivery to a session in a *different repo* failed softly: the doorbell said "read `data/events/<label>.jsonl`" — relative to the hub repo — and the recipient, whose working directory was elsewhere, concluded the event didn't exist. Any path in a message that leaves your process must be absolute; you don't control the reader's cwd.
- **No live session is the normal case, not the edge case.** Within one machine, events usually find a running session. Across machines they usually don't — the target is asleep, between sessions, or booted overnight. The durable log means nothing is lost, but *something* must drain it: a session launched on schedule that checks its event log on start (pull-on-wake), or event-triggered cold-start. Design that drain path early; "deliver if live" alone quietly becomes "deliver never" for cross-machine traffic.
- **Discoverability is the real adoption barrier.** An agent session that wanted to message a thread tried three wrong layers first — the agent-teammate messaging tool, a cloud-trigger mechanism, the wiki — before finding the event verb. When a platform grows several messaging-shaped facilities, each new one must be documented *at every place an agent might start looking*, and the others' docs should say what they're not for.
- **Verify injection, whole-prompt.** Substring matching against the submission log false-positives on coincidental text. Match the entire injected prompt byte-exact (mind em-dashes and encoding) within a short window.
- **The response's `delivered` flag is worth returning.** Senders behave differently when they know the event is sitting in a log versus already ringing in a live session — e.g. following up on another channel, or scheduling a retry at the target's known boot time.
