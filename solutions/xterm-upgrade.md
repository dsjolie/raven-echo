# xterm.js 5.x to 6.x Migration

## Problem

Upgrading xterm.js from 5.x to 6.x broke an embedded terminal in three non-obvious ways:
the scrollbar didn't render, output appeared doubled on reconnect, and custom scroll-following
logic became redundant and conflicting. None of the failures were loud errors — they looked
like layout or rendering glitches, masking the real cause.

## Scrollbar: Defer Addon Init Until the Widget Has Real Dimensions

xterm.js 6.x replaced its built-in scrollbar with VS Code's `ScrollableElement`, which
initializes via a `ResizeObserver`. The observer needs to witness an actual dimension change
to fire. If `fit()` is called synchronously — immediately after `term.open()` — the terminal
still has its default 80x24 size; no dimension change has occurred from the browser's
perspective, the observer never fires, and the scrollbar silently no-ops.

**Fix:** Defer the first `fit()` call to a `requestAnimationFrame` callback. The browser's
layout pass runs before the frame fires, so the terminal has real pixel dimensions and the
`ResizeObserver` sees the change from default to actual size.

```javascript
// Must defer: scrollbar ResizeObserver needs a real layout pass first
requestAnimationFrame(() => {
  fitAddon.fit();
  sendResize(terminalId, inst);
});
```

`setTimeout(0)` is not equivalent — it runs before the layout pass. The rAF is the right
boundary.

**Generalization:** Any canvas or DOM widget that initializes internal observers synchronously
on `open()` or `mount()` will have this problem. If the widget is attached before dimensions
are resolved, defer the "start measuring" step until after layout.

## Double Output: Guard the Data Stream Against the Open Lifecycle

When a page reconnects to a terminal (e.g., after a server restart or WebSocket reconnect),
the server immediately replays buffered PTY output. If `term.write()` is called while the
terminal's internal rendering pipeline is still being set up — before `open()` has fully
settled — xterm.js 6.x processes the initial buffer differently from 5.x. The result is
output written once but rendered twice.

The order that prevents this:

1. Create the `Terminal` instance.
2. Load addons (`FitAddon`, renderer addons).
3. Call `term.open(wrapperEl)` — attaches to DOM.
4. *Then* run deferred fit.
5. *Then* allow incoming data (`output` messages) to call `term.write()`.

In practice with a WebSocket-based setup, the creation path and the first `output` message
arrive close together. The defense is to ensure the terminal instance is stored in the
registry (`instances.set(...)`) *only after* `term.open()` returns. Incoming `output`
handlers that guard with `instances.get(terminalId)` will then naturally discard any data
that arrives before the terminal is ready.

```javascript
// Create and open first, register after
const term = new Terminal({ ... });
term.loadAddon(fitAddon);
term.open(wrapperEl);          // DOM attachment is synchronous
instances.set(terminalId, { term, fitAddon, ... });  // only now is it reachable

// Incoming data handler — safe because registration happens after open()
Raven.on('output', (msg) => {
  const inst = instances.get(msg.terminalId);
  if (inst) inst.term.write(msg.data);  // inst is null until open() completes
});
```

**Generalization:** When a data stream and a widget lifecycle run concurrently, use
registration order as the gate. Don't attach the data handler early and buffer — just don't
register the widget as "ready" until it actually is.

## Scroll API: Remove Manual Following Logic

xterm.js 5.x required explicit scroll-following logic: track whether the viewport was at
the bottom, and on every new `onData` event, call `scrollToBottom()` if it was. The 6.x
terminal handles this natively — if `viewportY >= baseY` when output arrives, the viewport
stays pinned to the bottom automatically.

Keeping the old `onData` → `scrollToBottom()` logic in 6.x causes visible jitter:
the terminal autoscrolls, then the manual call rescrolls, producing a flicker on every
output event.

**Fix:** Remove the manual scroll-follow on data. Keep `isFollowing` state, but only
for UI decisions: showing or hiding a scroll-to-bottom button, controlling related UI
elements. Let the terminal engine own the actual scrolling.

```javascript
// isFollowing is a UI signal only — xterm.js handles the auto-scroll
function updateScrollBtn() {
  const buf = term.buffer.active;
  const atBottom = buf.viewportY >= buf.baseY;   // "at bottom" check
  inst.isFollowing = atBottom;
  scrollBtn.style.display = atBottom ? 'none' : 'flex';
}
term.onScroll(updateScrollBtn);

// On fit: restore position explicitly — fit() can shift the viewport
function safeFit(inst) {
  const savedY = inst.term.buffer.active.viewportY;
  const wasFollowing = inst.isFollowing;
  inst.fitAddon.fit();
  if (wasFollowing) {
    inst.term.scrollToBottom();   // re-pin after fit
  } else {
    inst.term.scrollToLine(savedY);  // restore user's scroll position
  }
}
```

The `safeFit` wrapper is still necessary because `fitAddon.fit()` can shift `viewportY`
to an unpredictable position when the column/row count changes. Without the explicit
restore, resizing the window or switching tabs sends the viewport to an arbitrary buffer
position.

## Alt Screen Transitions

When the terminal returns from the alternate screen buffer (after `less`, `vim`, or a
similar full-screen program exits), scroll position is not automatically restored. If
the user was following before entering alt screen, manually call `scrollToBottom()` on
the buffer-change event:

```javascript
term.buffer.onBufferChange(() => {
  const isNormal = term.buffer.active.type === 'normal';
  if (isNormal && inst.isFollowing) term.scrollToBottom();
});
```

## Key Takeaway

Major-version upgrades of terminal emulators (and canvas/DOM widgets generally) commonly
change two things: the initialization contract (what must happen before addons or data
can be safely used), and the scroll model (who owns auto-following). Check both
before assuming the old wiring still works.
