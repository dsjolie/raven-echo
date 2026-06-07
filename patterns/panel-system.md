# Panel System: Browser UI as a Window Manager

## Problem

A local-agent web UI needs to host heterogeneous surfaces — a terminal emulator, a task list, a status overview, a knowledge viewer — without turning into an unmanageable monolith. The surfaces have nothing in common structurally: some multiplex sub-instances (terminal tabs), some poll the server, some are purely reactive to push events. You want to add, remove, or rewrite one surface without touching any other.

The naive path is a single-page app that accumulates feature flags, shared state, and cross-cutting display logic in one place. That path has a high ongoing tax: every new feature needs the author to understand the whole.

## Approach

Treat the browser client as a window manager. The core shell (`app.js`) manages exactly three things: the WebSocket connection, a panel registry with lifecycle dispatch, and a message bus. It contains no domain knowledge. Each surface ("panel") is an independent JS file that registers itself and gets a lifecycle:

```javascript
Raven.registerPanel('my-panel', {
  icon: '⊞',
  label: 'My Panel',
  init({ panelEl, toolbarEl }) {
    // Called once at registration — build DOM, attach event listeners.
  },
  activate() {
    // Called each time the panel becomes the active surface.
    // Start polls, request fresh data, restore focus.
  },
  deactivate() {
    // Called when the user switches away.
    // Stop polls, release ephemeral resources.
  }
});
```

Adding a new panel means writing one file and loading it in the HTML. No changes to the shell, no changes to any other panel.

The message bus decouples panels from each other and from the server:

- **`Raven.on(type, callback)`** — subscribe to a message type (server-pushed or locally dispatched)
- **`Raven.dispatch(type, msg)`** — broadcast a local message to all subscribers of that type
- **`Raven.send(msg)`** — send a JSON message to the server over WebSocket

Server-pushed messages and local messages travel through the same bus. A panel does not need to know whether a message originated on the server or from a sibling panel; it just registers a handler for the type it cares about. This also makes server reconnect clean: on `_connected`, panels request fresh state; on `_disconnected`, they tear down ephemeral UI without any cross-panel coordination.

## Implementation

**Shell size.** The window manager is roughly 220 lines (connect, reconnect with exponential backoff, panel registration, message bus, alert indicator management). Everything else is a panel file.

**Panel visibility.** CSS handles the panel show/hide exclusively:

```css
.panel        { position: absolute; inset: 0; display: none; }
.panel.active { display: flex; flex-direction: column; }
```

The shell adds and removes the `active` class on the panel's `div` when switching. Panels must never set `display` inline — it overrides the class rule and breaks switching silently.

**Toolbar delegation.** There is one shared toolbar element. Each panel receives a reference to it during `init()` and is responsible for populating, showing, and hiding its own toolbar content during `activate()` and `deactivate()`. This keeps the toolbar flexible without the shell needing to know what any panel wants to put there. A panel that wants tabs, a panel that wants a search box, and a panel that wants nothing at all — all work the same way.

**First-registered panel auto-activates.** Registration order in the HTML determines the default view with no explicit configuration.

**Alert indicators.** Any panel can mark its sidebar button with a status dot:

```javascript
Raven.setPanelAlert('tasks', 'alert-red');    // flashing red — overdue
Raven.setPanelAlert('tasks', 'alert-yellow'); // steady yellow — due today
Raven.setPanelAlert('tasks', false);          // clear
```

The CSS renders the dot as a pseudo-element on the sidebar button. This gives persistent at-a-glance status for any panel — visible even when the panel is not active. Multiple panels can have alerts simultaneously; they are independent.

**Theming.** All colors, dimensions, and font choices are CSS custom properties on `:root`. Terminal emulator instances read these values at creation time to match the surrounding UI. A complete theme change (dark to light, or a different accent) requires editing one block of `:root` declarations. No component has hard-coded color values.

```css
:root {
  --bg-primary:   #1e1e1e;
  --fg-primary:   #d4d4d4;
  --accent:       #4ec9b0;
  --status-error: #f14c4c;
  --sidebar-width: 48px;
  --toolbar-height: 36px;
}
```

**A complex panel as a worked example.** The terminal panel illustrates how far the pattern scales. It manages multiple xterm.js instances (each with its own PTY on the server), a tab bar in the shared toolbar, touch-scroll momentum on mobile, context-sensitive mobile key bars (shell mode / CC running / permission pending / AskUserQuestion), WebGL renderer with canvas fallback, and scroll position preservation across `fitAddon.fit()` calls. None of this complexity bleeds into the shell. The panel's `init()` builds all of its DOM; `activate()` refits the active terminal and sends a resize to the server; `deactivate()` hides the toolbar fit button. The shell sees only that lifecycle boundary.

Server messages flow directly from the bus to the terminal panel's handlers:

```
Raven.on('output',           (msg) => term.write(msg.data));
Raven.on('terminal-created', (msg) => createTerminalUI(msg.terminalId, msg.name));
Raven.on('claude-status',    (msg) => updateTabLabel(instances.get(msg.terminalId)));
Raven.on('_disconnected',    ()    => clearAllTerminals());
```

The panel registers for `_disconnected` — an internal bus event dispatched by the shell when the WebSocket closes — to tear down its own state. No panel-specific teardown logic lives in the shell.

## Gotchas

**Never set panel `display` inline.** If any code sets `panelEl.style.display = 'block'`, the CSS class toggle stops working. The panel becomes permanently visible or permanently hidden depending on timing. The fix is `classList` only — never inline style for visibility.

**Toolbar content persists across panel switches.** Each panel appends to the toolbar during `init()` and should show/hide its elements in `activate()`/`deactivate()`. If a panel neglects to hide its toolbar content on deactivate, it leaks into every other panel's toolbar view.

**Reconnect floods panels with events.** On reconnect the server sends a `terminal-list`, `task-list`, guard state, etc. in quick succession. The terminal panel handles this by calling `clearAllTerminals()` before rebuilding from the list. A panel that appends without clearing first will accumulate duplicates across reconnect cycles.

**Mobile and desktop fight over PTY dimensions.** When both a mobile client and a desktop client are connected simultaneously, each fires resize events on visibility change. Sending a resize from a hidden tab overrides the visible one. The fix: check `document.hidden` before sending resize, and only send if dimensions actually changed after a fit.

**`safeFit` must preserve scroll position.** `fitAddon.fit()` in xterm.js 6.x resets the viewport position as a side effect of recalculating dimensions. A scroll-position save/restore wrapper around every fit call is required, or the terminal jumps to an arbitrary buffer position on every panel switch, window resize, or font size change.

**Alert indicator `true` is a backward-compat alias.** Early callers used `setPanelAlert(id, true)`. The implementation normalizes `true` to `'alert-red'`. New code should pass an explicit status string.
