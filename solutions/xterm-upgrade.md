# xterm.js 5.x to 6.x Migration

## Problem

Upgrading xterm.js from 5.5 to 6.1 broke three things: the scrollbar didn't render, output appeared duplicated, and custom scroll handling conflicted with the new built-in behavior.

## Scrollbar Initialization

xterm.js 6.x replaced its scrollbar implementation with VS Code's `ScrollableElement`. This component uses a `ResizeObserver` internally — it needs to see a real dimension change to initialize properly. If the terminal starts at the default 80x24 size and is immediately fitted to the container, the scrollbar may not render because the observer hasn't fired yet.

**Fix:** Defer the first `fit()` call to `requestAnimationFrame`. This ensures the terminal has been laid out by the browser before fitting, giving the `ResizeObserver` something to observe.

```javascript
// Deferred fit — scrollbar needs to see a dimension change
requestAnimationFrame(() => {
  safeFit(inst, 'deferredInit');
  sendResize(terminalId, inst);
});
```

## Double Output

Terminal output appeared duplicated — every line printed twice. This happened because the PTY data handler was wired up before the terminal was attached to the DOM, and xterm.js 6.x processes the initial buffer differently from 5.x.

**Fix:** Ensure the terminal is open and fitted before connecting the data stream. The order matters: create terminal → open in DOM → fit → then connect PTY data.

## Scroll Handling Simplification

xterm.js 5.x required manual scroll-to-bottom logic — tracking whether the user had scrolled up, and programmatically scrolling to bottom on new output. In 6.x, the terminal handles this natively: if the viewport is at the bottom when new output arrives, it stays at the bottom.

**Fix:** Remove the manual scroll-following logic. Track `isFollowing` only for UI purposes (showing/hiding a scroll-to-bottom button, controlling speed dial visibility). Let xterm.js handle the actual auto-scroll.

```javascript
// Simple at-bottom tracking — xterm.js 6.x handles auto-scroll natively
function updateScrollBtn() {
  const buf = term.buffer.active;
  const atBottom = buf.viewportY >= buf.baseY;
  inst.isFollowing = atBottom;
  scrollBtn.style.display = atBottom ? 'none' : 'flex';
}
term.onScroll(updateScrollBtn);
```

## Gotchas

- **`viewport` vs `buffer` API.** In 5.x, scroll position was accessed through `term.buffer.active.viewportY`. This still works in 6.x, but the relationship between `viewportY` and `baseY` changed subtly. Always use `viewportY >= baseY` for "is at bottom" checks.
- **Alt screen transitions.** When returning from alt screen (e.g., after `less` or `vim` exits), explicitly scroll to bottom if the user was following. xterm.js doesn't always restore the scroll position correctly on buffer switch.
- **ResizeObserver timing.** The deferred fit approach (requestAnimationFrame) works reliably, but `setTimeout(0)` does not — the frame callback ensures the layout has actually been computed.
