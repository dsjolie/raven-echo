# Machine Fleet: One Hub, Many Machines

## Problem

The same agent hub — repo clone plus web UI server plus agent sessions — ends up running on several machines: an always-on desktop, a work laptop with forced overnight shutdown, a couple of Macs, a small edge VPS. Each is useful on its own, but the set raises fleet questions: which machines exist and what can each do, which are up right now, and how do you drive machine B's UI while sitting at machine A — without building a distributed system, and without the machine roster drifting apart across the three or four places that need it.

## Approach

Three ideas carry the design.

**1. A single git-tracked machine registry.** One JSON file at the repo root maps OS hostname to everything fleet-level: friendly name, platform, role (`hub` / `spoke` / `edge`), VPN address, availability (including a structured off-hours window for machines with forced shutdown schedules), capabilities (which services this machine hosts), and a reserved proxy port. Because it's git-tracked, edits propagate to every clone on the next pull — the registry *is* the roster, and everything that needs a roster (fleet status card, reverse proxies, the desktop launcher shell) reads this one file. Before unification, the desktop launcher kept its own machine list in a config file; the two drifted. One source, several readers.

Every reader falls back to the raw hostname when the registry is missing or unparseable. A brand-new machine works immediately; registering it is cleanup, not a prerequisite. And schema changes should be **additive** — readers consume the fields they know and ignore the rest, so adding `capabilities` or `offHours` to existing entries produces no symptom on machines running older code.

**2. Channels selected by what's moving.** For each piece of cross-machine state, ask: shared truth or per-machine? and how hot?

- **git** carries durable shared truth — the registry, thread files, docs. Eventual, versioned, conflict-managed.
- **Direct HTTP over the VPN** carries control — liveness pings, event doorbells, dispatch signals. Control wants to be *pushed*, not polled from an inbox; a build dispatch signal wants sub-second latency even though the build itself takes minutes. Don't conflate a task's duration with its dispatch signal's latency requirements.
- **A shared folder** carries bulk data only — build artifacts, binaries. Nothing that steers behavior.

The VPN bind is the trust boundary: every server binds loopback plus its own VPN address, nothing public, so there is no auth story to build until something leaves the VPN.

**3. Backend switching via port-per-machine reverse proxy.** To use machine B's UI from machine A, A's server reverse-proxies to B — and the port scheme does the routing: every machine gets a globally unique proxy port (say 3010–3014), and **every server binds every machine's port**, proxying to that machine's UI over the VPN. So `<any-host>:3012` always means "machine C", no matter which host you connect through. This uniformity has a compounding payoff: links compose through switched views. When you're viewing machine B through A's proxy and click machine C in B's fleet card, the link (`same-host:C's-port`) hits A's proxy to C — correct with no special-casing. A machine's *own* port answers with a 302 redirect to its canonical UI, so "switch to the machine you're already on" lands you back on the real origin (address bar, PWA scope, and all) rather than a pointless self-proxy.

The proxy serves the **spoke's own frontend**, deliberately. The alternative — local frontend talking to a remote data plane — reopens version skew (new client against old backend APIs) and demands backend-selection plumbing in every fetch and WebSocket. Whole-UI proxying keeps client and server versions paired by construction; the cost is that a stale spoke shows its stale UI, which is a feature: staleness becomes visible instead of latent.

**Proxied clients get an edit block.** A request arriving through the proxy is stamped with an `x-raven-proxied: <via-machine>` header (overriding any incoming value — clients can't spoof their way to local status). The backend tags those connections and rejects mutations whose writes would land in *its* working tree when the human is actually working in another machine's tree — the "edit lands in the wrong clone" trap. The client mirrors the block and shows a persistent "via <machine>" badge. Server-authoritative, client-cosmetic.

## Implementation

A registry entry:

```json
"HOSTNAME-STRING": {
  "name": "studio",
  "platform": "macos",
  "role": "spoke",
  "vpn": "10.0.0.n",
  "availability": "always-on",
  "capabilities": ["tts-server:8000"],
  "proxyPort": 3012
}
```

Fleet liveness is a HEAD ping of each machine's UI with a short timeout, folded with availability into a status: `up`, `down` (should be up but isn't — red), `scheduled-off` (inside its structured `offHours` window — grey, not alarming), `expected-off` (intermittent machines), `unknown` (no VPN address). The distinction matters: a machine that is off *on schedule* is not an incident, and rendering it red trains people to ignore red.

The proxy is plain HTTP piping plus manual WebSocket upgrade piping, TLS-terminated locally when certs exist (so it matches a PWA's HTTPS origin), plain HTTP upstream inside the VPN. Dead upstream → clean 502, not a hang.

## Gotchas

- **The scheme-describing field lies through a proxy.** The backend's API response said "my links are HTTP" (it had no certs) — but a switched view's links connect to the *proxying host's* TLS listeners, and plain HTTP against a TLS port returns nothing. Fields in a payload describe the backend; links must follow the connected host. Fix: the proxy stamps its own scheme on every relayed response (`x-raven-proxy-scheme`) and the client prefers that header. The general class: a backend-served UI reasoning about the host it's being viewed through will be wrong whenever the two differ.
- **Registry is read per request; proxy listeners bind at startup.** Adding a machine makes it appear in the fleet card immediately but its proxy port only binds on the next restart. Report the actually-bound set (`proxyLive`) and only render links for ports that are live, or you get click-throughs to nothing.
- **Firewall shape decides rollout cost.** A program-scoped allow rule for the server binary (any port, VPN-profile) means new proxy ports are reachable automatically; per-port rules mean every added machine is a firewall edit on every other machine. Check which shape each OS has before debugging "switching into machine X fails." **A program-scoped rule is keyed to the binary's path, and it breaks on a runtime upgrade.** A version-manager bump of the server runtime put `node.exe` at a new versioned path. Windows treated it as a new program and raised its "allow access?" popup. The popup was dismissed, and the resulting program *Block* rules beat every port Allow. Remote desktop kept working on its own built-in rule, so the outage looked like a VPN fault. The version manager's stable junction resolves to the versioned path and protects nothing. Two program rules for two runtime versions, one Allow and one Block, date the outage. The no-admin stopgap was to point the launcher at the old binary, which still has its Allow rule. Details in [solutions/cross-platform.md](../solutions/cross-platform.md).
- **Spokes take changes on pull + restart, not on pull.** Long-running servers use new code only after restart; CLIs pick it up on next invocation. Registry restructures degrade gracefully (hostname fallback — the symptom is a stray raw-hostname directory, the fix is a one-commit file move), which is why watching for a known symptom beats peppering guards everywhere.
- **Don't skip the availability model.** With machines that force-shutdown overnight, presence isn't an optimization — dispatch, retries, and status displays all consume it. A scheduled retry targeting the known boot time doubles as the liveness probe; no presence daemon needed.
- **The availability field is parsed, so edit it like code.** The status fold reads it with a regex (`/^intermittent/`) plus the off-hours window, and it also renders as tooltip text. An entry written as prose matched the regex, and the card reported a five-day outage as *expected-off*. The machine was up the whole time. An OS update had restarted it into a logged-out desktop, and nothing started the hub without a login. Keep the parsed field terse and put explanation in a separate `notes` field. A machine whose services need an interactive login also needs a boot-time start path, or every forced reboot silently takes it off the fleet.
- **Managed, domain-joined machines are a different platform.** Two university-managed spokes joined the fleet. On both, the VPN interface came up in the *Public* firewall profile while every existing rule for the runtime was scoped *Domain*, so VPN traffic met a profile with no allow rule. The working shape is a port-scoped rule pinned to the VPN subnet, all profiles, no program condition. Home-directory resolution also split (see [solutions/inherited-environment.md](../solutions/inherited-environment.md)). Profile *classification* decides which rules apply, not which cable or radio is in use. Campus wifi that authenticates to the domain lands in the Domain profile, straight into old program Blocks. A useful diagnostic order, one command per step: bind, then transport, then filter. If an outbound request from the unreachable box succeeds while peers get nothing, the problem is an inbound filter.
- **A runtime LAN bind for devices outside the VPN.** Headsets on a campus network cannot be VPN peers, and the hub has no authentication, so the bind list is its entire security model. A settings toggle binds one private-range LAN interface at runtime, with deliberate limits: RFC 1918 ranges only, virtual adapters filtered out, the request refused unless it comes from loopback or the VPN, and nothing persisted. Every start is back to loopback plus VPN. An interface list captured when the settings panel was built goes stale as soon as the machine joins another network, so the panel has a re-scan button. The quiet failure to watch for is the toggle reporting the interface bound and the server logging it while clients get nothing, because a firewall Block sits in that profile.
