# One Door: Arbitrating a Single GPU Between Several Resident Services

## Problem

Self-hosting generative models is a success that creates its own failure. An image model lands on a machine's spare GPU; later a speech model joins it; later a local chat/embedding runtime joins them both. Each is load-on-demand, each holds roughly 20 GB while resident, and the card has 24 GB. **None of them knows the others exist.** Whichever loads second dies.

The concrete near-miss that forced the work: a ~100-minute multi-part speech render was queued, and any image request from any machine on the network would have OOM-ed it — with a *truncated render* as the only symptom, because the speech backend fails silently at its token limit and still returns HTTP 200. Nothing mediated this, and the failure would have been discovered days later by listening.

So the requirement isn't "make it faster" or "add a queue." It's: **never OOM, always answer, and make the answer honest** — including when the honest answer is "come back in four minutes."

## Approach

### Arbitration by topology, not by cooperation

The obvious first design is a lease service: `acquire` / `release`, and every backend asks before loading. It was rejected, and the reason generalizes past GPUs:

**A lease is arbitration by cooperation.** It works only if every loader asks, and anything that can still reach a backend's address directly walks straight past it. A bypassed lock is *worse* than no lock, because it looks like protection.

**A proxy is arbitration by chokepoint.** Front the backends and they are simply unreachable except through one process, so admission becomes a queue in one place instead of a distributed protocol. It requires **no changes to any backend** — which matters when one of them is unmodified upstream code you don't want to fork.

The corollary is a hard constraint, not a detail: **backends must bind localhost.** A publicly reachable backend voids the guarantee entirely. The whole design rests on unreachability.

There was also a "smaller, safer first step" argument for the lease, and it was wrong on its own terms: the lease would have required migrating clients off the direct addresses anyway — which *is* the proxy's premise. The cautious increment wasn't smaller; it was the same migration with weaker guarantees.

### A clean break beats a compatibility shim

The first plan was to take over the incumbent service's address and preserve its contract so no client would need changing. That lasted exactly as long as it took to read the callers: preserving it already required two compatibility hacks — proxying one endpoint in the old response shape, special-routing another — **before a single client had migrated.**

So the door listens on a *new* address, and old per-service addresses are retired rather than proxied. This is the surface-errors principle applied to protocols: a retired address gives **connection refused** — a loud failure — where a compatibility shim gives a client that keeps working while quietly meaning something different. Retired paths on the door itself return `404` with a hint and the live route list, so the error teaches the fix.

What the break bought, beyond simplicity: speech became an OpenAI-shaped endpoint matching what another machine's speech service already spoke, so **engine choice became an endpoint change rather than a client rewrite** — and a bespoke client-side branch that was about to be written never had to be.

### Admission rules

- **Admit by resource budget, not a binary mutex.** An 84 MB embedding model must never queue behind a 20 GB image model. Light routes are classified and admitted freely.
- **Never OOM; always answer.** A heavy request waits a short bounded time (~20 s), then gets `503` naming the current holder, with `Retry-After` when an ETA exists. The wait is short *on purpose*: a 100-minute render must not park a competing request on an open socket. The caller gets an answer and decides for itself.
- **Free memory is the veto.** Residency probes can miss a backend too busy to answer its own health endpoint; the OS-level measurement cannot lie. If the card is full and no known backend claims it, refuse rather than load into an OOM.
- **Path-prefix routing, bodies untouched.** Clients keep speaking each backend's native contract, so no translation layer can drift from upstream.

### Lifecycle: what actually frees the resource

The tenants are asymmetric, and the asymmetry is the whole lifecycle design. One self-unloads after 10 minutes idle. Another **never unloads** — once loaded it holds its ~20 GB until something kills it. Left alone, a single speech render locks image generation out for the rest of the day.

Three things free a tenant, and the door has to supply all three for the tenant that has none of its own:

1. **Idle reap** — a background loop stops the tenant after the same idle window the self-managing one uses, so both behave identically from a caller's point of view.
2. **Reclaim on demand** — another tenant needs the card and this one is idle.
3. **Lease expiry** — an explicit lease both excludes others *and* suspends the reap, so a tenant held through an iteration loop stays warm.

A tenant mid-request is never reaped or reclaimed; competitors get `503 gpu_busy` instead. Exposing the countdown (`unload_in_s`) turns "come back later" into a number.

**Start and stop capabilities must be tracked separately.** Being able to start a tenant but not stop it is *worse than neither* — it takes the card on the first request and never gives it back. That's not hypothetical: the door may run in a context that can trigger one and not the other.

### Honest degradation beats unavailability

The door runs as a boot service so the fleet has generative capability without anyone signing in. In that context it **cannot** manage some tenants — they live in a per-user subsystem whose registration doesn't exist for the service account — but it can still *route* to them and still arbitrate the card.

The design decision was: **availability with honest degradation beats unavailability.** So `GET /health` carries per-capability `available` / `managed` / `detail`, each naming *its own* dependency — telling someone their chat backend is down "because of the speech subsystem" would send them debugging the wrong thing. A request needing an unavailable capability gets `503 capability_unavailable` **with the remedy**. Context is re-probed on a timer, so signing in makes management appear without a restart.

## Gotchas

- **Size a tenant from the OS, never from its own self-report.** One backend logs `GPU Memory used: 22.21 GB` — its own reserved-memory accounting — while the OS measures 20,076 MiB. Declaring 22 GB set the admission bar *above what the machine can ever offer* (the desktop holds ~2.7 GB, so free memory peaks near 21.9 GB), and the veto refused **every** speech request, forever, with a perfectly reasonable-looking error. Caught only by running it. General form: *when a component reports on its own resource use, that number is in its own units and for its own purposes — measure from outside.*

- **Never hold the admission lock across a slow operation.** Starting a tenant takes minutes; holding the lock through it makes callers *block* instead of getting the timely busy answer the component exists to give. Startup runs as a shared task that waiters await against their own deadlines. This bug was written **three times** during one build — initial start path, VRAM guard, and nearly again. If your component's value proposition is "answer quickly under contention," the lock-across-slow-work bug will keep trying to reappear.

- **An optimisation that shares a computation between two callers has to check they were asking the same question.** A latency refactor made the capability check reuse the residency probe. But *residency* means "holding memory," so a perfectly healthy **idle** backend is absent from it — and the dashboard reported "not answering" whenever the service was merely idle, which is nearly always, and precisely when someone is most likely to look. The two questions differed by exactly one word. Reachability (*who answered*) and residency (*who is holding*) are now tracked separately.

- **A too-tight health probe reports a busy service as a dead one.** A 1.5 s probe timeout was correct when probes ran on the request path, where every second showed as UI lag. Once probes moved to a background refresher, a generous timeout cost callers nothing — but the old value stayed, so a backend mid-load (replying slowly, but replying) was reported down. Wrongly reporting a working service as down is the same class of error as a bypassed lock: **the display looks authoritative and is wrong.** When you move a probe off the hot path, re-derive its timeout.

- **A health check that loads the model is not a health check.** The probe must be able to answer "is this alive" without provoking a 20 GB load.

- **Read the sibling service's launcher *and* its `main()` before writing yours.** Two boot failures, both silent, both already solved next door: the launcher invoked a bare tool name whose per-user install isn't on the service account's PATH, so the task died instantly *while the scheduler reported it as having run*; and once that was fixed, the boot trigger fired before the VPN interface existed, so binding the VPN address failed with *cannot assign requested address* — at **every** boot. The neighbouring service hardcoded its interpreter path and waited for the address to become bindable, and its README said so. The lesson is about reading, not about the platform: **the hard-won parts of a working sibling are exactly the bits that look like boilerplate.** (Also pin the dependency cache directory, or the service account resolves dependencies separately from every user-context run.)

- **`503` means busy, not broken** — and that has to be said out loud in the client contract, or every caller will treat back-pressure as an outage and retry wrong (or page someone). Publish the old-call → new-call table alongside it.

- **Exclusivity is only as good as the last unmigrated bind.** Until every backend is actually restarted onto its private address, one of them remains reachable behind the door's back and the guarantee is best-effort. Track that as a known gap rather than assuming the design's property holds the moment the design ships.

- **The arbiter is not the registry.** A separate service directory with liveness pings answers "what exists and is it up"; this answers "who gets the card right now." The arbiter should *register with* the directory, not replace it.
