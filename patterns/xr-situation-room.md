# The Situation Room: A Spatial Surface for a Fleet of Agent Sessions

## Problem

Once agent work runs on several machines at once — a nightly pipeline here, a long build there, a research session on a third box — the flat UI stops fitting. Tabs are a list; the fleet is not a list. What you actually want to know is ambient: *is anything waiting for me, and where.* On a desktop that becomes tab-badge archaeology, and on a phone it doesn't fit at all.

A headset is an obvious substrate — unlimited screen area, spatial memory as navigation — and an equally obvious trap. The failure mode is building a workspace: recreating the desktop in VR, where every task is harder and the pixels are worse. The question that has to be answered before any of the rendering work is *what is this room for*, and the honest answer is narrow.

## Approach

**A watchtower with a seat, not a workspace.** Three verbs, and anything serving none of them is desktop work that stays on the desktop:

| Verb | Meaning | Organ |
|---|---|---|
| **Notice** | something changed somewhere in the fleet — peripheral, no interaction | halo pulse, rail pulse, spatial knock |
| **Turn to** | bring attention to it; spatial memory is the navigation | head turn, snap-rotate, focus |
| **Converse** | steer a session, not merely acknowledge it | keyboard, compose box, question buttons |

The third verb is the one worth arguing about. It started as "Answer", scoped to *the small act that unblocks* — approve a permission, dismiss a prompt. That was rejected on the project's own evidence: agent sessions are conversational, and a prompt-length reply steering a session is the **primary work of the seat**, not a small unblocking act. A filter whose spirit is "minimal ack buttons" builds a watchtower where you can only grunt. The consequence propagates: the compose box becomes the third verb's main organ, and speech is its eventual best form.

**The fleet is a room.** Every reachable machine holds a fixed angular slot with its own cluster of session panels. Selection never moves anything — you turn your head, so spatial memory is the navigation and an arrangement you made stays where you put it. The local machine and the selected peer are live; the rest stay visible, frozen at their last known state and stamped at freeze time (a deselected machine freezes at *that* moment rather than reverting to an older cache).

**Ownership is geometric, not textual.** A per-machine colour, a curved rail across that machine's arc of the ring, a connector from each panel up to its rail, and a colour strip on the panel's top edge. Nothing needs a label saying which machine a window belongs to; it hangs from that machine's rail.

**Reach peers with a verbatim same-origin pipe, not a relay.** `wss://<self>/fleet/<machine>` — the upgrade router resolves the name in the machine registry and hands the socket to the existing reverse proxy. The peer's protocol arrives unmodified, so output, input, and resize work identically to local, and **input works by construction**. The socket's lifetime *is* the subscription: no relay, no subscription registry, no fan-out.

That last clause is the interesting part, because the first design had all three. The collapsing question was *"why does this need new piping when switching machines already works on mobile?"* The answer names what's actually different about the headset:

- **Mobile navigates.** It loads the peer's port on the reverse proxy and then runs *the peer's own frontend* against the peer's server. Nothing local parses those messages.
- **The immersive client cannot navigate** — navigation ends the XR session, and it would mean running the peer's copy of the page, making one scene holding a switchable fleet impossible by construction.
- **And it cannot dial the peer's port directly**, purely because of the certificate: different origin, and a WebSocket gets no interstitial to click through. Same origin means the cert is already accepted.

Three constraints, one of them a TLS accident, and together they justify ~15 lines of server code. Without asking the question, they would have justified a relay.

## Implementation

### Rendering terminals legibly

The headset's ~25 pixels-per-degree is the binding constraint, and it's a *legibility* constraint, not an input or bandwidth one. Long small-text reading is the strain point, which is why compositor quad layers are load-bearing rather than a nicety.

The pipeline: real terminal-emulator parsers running in offscreen containers → 2D canvas → the focused panel as a **compositor quad layer**, unfocused panels as ordinary textured quads.

A discovery worth stealing: **the terminal emulator parses headless.** Every window had been constructing a DOM renderer to produce output nobody looks at. The whole API this client needs — write, resize, reset, scroll, cell reads — works with no renderer attached, and parsing is ~40% *faster* without one.

### Cues that survive the headset coming off

Two rules shaped the entire notification design:

**Derive cues from state, never from the event that announced them.** The client dozes every time the headset comes off, and an edge-triggered cue dies with the socket — a permission raised while it sat on the desk would be gone by the time you put it back on. The existing per-terminal *list* message is state, so every reconnect reconstructs every cue, which turns *putting the headset on* into the moment the room tells you what it has been holding.

**Peripheral vision is motion-sensitive and hue-blind.** Anything demanding attention must **pulse**; a colour change alone is invisible exactly when it matters. The pulse lives on a separate halo mesh *behind* each panel — not on the panel's own material, which the hover-highlight pass rewrites every frame and would silently stomp.

The taxonomy is two cues and no legend: **needs answer** (amber ~1 Hz breath, the owning machine's whole rail pulsing, a directional double-knock repeating every 25 s) clears when *the server* says the session is unblocked; **finished** (decaying green glow, one soft chime) clears when *you look at it*. There is no dismiss button anywhere — clearing is either server truth or "you turned to it."

**Audio is the primary channel, not a fallback.** This is a room you sit in with your back to half of it, and a machine behind your head has no visual surface at all. Spatialised sound carries direction, which no visual can do from behind you. Synthesised in-page (no assets, so the page stays self-contained), anchored at each machine's slot, with the audio context created inside the user's entry click and resumed on visibility change — a doze-suspended context is the classic silent failure.

The surprise: **the cues cost almost nothing.** The server had been broadcasting permission and completion events all along, and the per-terminal list already carried pending-permission state — and because the peer pipe is verbatim, all of it arrives for remote machines too. The client had simply been dropping them. Wake cues were never a protocol project; they were a rendering project.

### Debugging with no devtools

There is no console behind a headset, and a thrown error is silence followed by a scene that stopped updating. Everything the client has to say — captured console errors and warnings, uncaught exceptions, unhandled rejections, socket transitions, every status change — tees into a ring buffer on a panel summoned where you're looking, with repeats collapsed to `×N` so one flapping socket can't push out the thing that started it. A frame meter lives in the focused panel's title bar.

The general form: **on a device without devtools, instrument before the first run.** Log before each async setup step, hook unhandled rejections, persist the log. An early probe's bare async flow died as an invisible rejection presenting as an infinite spinner.

### Measuring before optimising

The obvious want — every machine live, not just the selected one — got answered with numbers rather than intuition. A 60-second live subscription to the whole fleet moved **1.92 KB/s total**, essentially all of it from one active session, plus a 1.15 MB connect burst of scrollback. The parser handles 6–9 MB/s headless; 24 parsers × 16 KB took 46 ms.

So the two things everyone assumes are the blockers — bandwidth and parsing — are ~1000× from mattering. What actually costs: **texture memory** (~18 MB per full-resolution panel with mipmaps, so 24 live panels ≈ 430 MB, which is why an attention level-of-detail scheme is load-bearing rather than decorative), the connect burst repeating on every headset doff/don, and per-machine reconnect discipline.

## Gotchas

Platform lessons, each of which cost real time:

- **Create compositor layers at session start, never mid-session.** Creating one mid-session under a scene-graph library froze the app outright (the library-free sample works on the same OS build — the interop is the variable). Create one fixed-size layer up front, park it off-scene, retarget on focus.
- **Layers are swapchain-buffered.** A single dirty-upload writes one of several rotating backing textures — upload across ~4 consecutive frames per content change or panels show stale content. Corollary for cost: every redraw costs four uploads.
- **Never toggle raw GL state behind a caching wrapper.** Raw pixel-store toggling desynced the scene library's state cache, so every *other* canvas texture rendered upside-down — a symptom about as far from its cause as possible. Save and restore the *real* values by querying them, and call the wrapper's resync hook after any raw-GL block.
- **A layer's texture aspect is fixed at creation; its metres are not.** Set the metres from the bound panel — and compare against what you last *wrote*, never a read-back, since a runtime that quantises the float fails an equality test every frame and pins you to a full upload per frame.
- **Immutable texture storage rejects uploads after a resize.** When the canvas dimensions change, dispose the texture so it reallocates, or the panel freezes at its last content with no error.
- **Sharpness is display-limited, not texel-limited.** Bigger canvases just downscale in the blit. Growing the *panel* on focus is the lever that works.
- **A dropped frame makes the whole world swim while the compositor layer stays rock-solid** — and that asymmetry is a free diagnostic. On a missed frame the compositor re-composites a layer exactly, while everything else is last frame's render reprojected rotation-only.

And one epistemic gotcha worth more than any of them:

- **Numeric inspection tests the components you thought to query; the screenshot tests the claim.** The per-machine rails exist to answer exactly one question — which machine does this panel belong to? — and the first version answered it *wrong*, for precisely the hand-arranged layouts of daily use: a hand-placed panel sitting inside the neighbour's arc got a connector drawn at its raw bearing, so it visibly hung from the wrong machine's rail. It had been "verified" first: arc angles pulled from the geometry buffers and checked against each slot, connector draw ranges checked, colours checked. **Every number was right**, so verification came back clean and confident — a true negative to the wrong question. Two tells generalise well past XR: *about to declare a visual, spatial, or layout feature correct on the strength of numbers* → render it and look, headless if need be; and *a check whose test cases are all defaults* will miss the hand-arranged case, because defaults are what the code already agrees with.

- **Mitigation is not diagnosis, and saying so is the honest close.** A world-wide judder on every terminal update survived three falsified models: frame-budget overrun (killed when judder persisted with almost no long frames), stale viewer pose (counter read ~0 in the headset), and GPU-bound rendering (eye-buffer scale, MSAA, and mipmap toggles changed nothing). The surviving observation — pops only during larger head movements, one frame at the wrong position — fits GPU work missing the compositor deadline, which is invisible to every CPU-side metric available from script. What shipped was a **velocity gate**: uploads are held while the head turns faster than a threshold and flush only after a quarter-second of *continuous* calm (the settle delay matters because a smoothed velocity passes through zero at every direction reversal, so a bare threshold test can fire mid-shake at exactly the wrong moment). The reasoning is perceptual, not causal: pops are only visible during large head movements, and mid-turn the text is unreadable anyway — so the pop-causing work runs only when it cannot pop, payload-agnostic. Verdict in the headset: good enough. The thread head says plainly that this is a mitigation *consistent with* the reprojection model, not a confirmation of it. Also worth recording: the discriminating instrument (a frame meter) had been built two builds before the model it would have falsified, and never read.
