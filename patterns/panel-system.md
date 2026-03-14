# Panel System: A Minimal Web UI as Window Manager

## Problem

You need a browser-based interface for your agent system — terminal access, task management, status monitoring. But the UI shouldn't be monolithic. You want to add new surfaces without modifying existing code, and each panel should be independently developed.

## Approach

The web UI is structured as a window manager. A core app shell handles WebSocket connections, panel switching, and a message bus. Each panel registers itself and gets a lifecycle:

```javascript
Raven.registerPanel('my-panel', {
  icon: '📋',
  label: 'My Panel',
  init({ panelEl, toolbarEl }) {
    // Called once — set up DOM, register event listeners
    panelEl.innerHTML = '<div class="my-content">...</div>';
  },
  activate() {
    // Called each time the panel becomes visible
    // Fetch fresh data, start polling
  },
  deactivate() {
    // Called when the panel is hidden
    // Stop polling, release resources
  }
});
```

The core app shell (`app.js`) is ~220 lines. It provides:

- **WebSocket management** — connect, reconnect with exponential backoff, dispatch messages
- **Panel registration** — sidebar buttons, panel elements, lifecycle callbacks
- **Message bus** — `Raven.on(type, callback)` for server events, `Raven.dispatch(type, msg)` for local panel-to-panel communication
- **Panel alerts** — `Raven.setPanelAlert(panelId, status)` to show colored indicators on sidebar buttons

It contains no domain logic. It is literally a window manager.

## Implementation

Panels communicate through two channels:

1. **Server messages** via WebSocket — `Raven.send({ type: 'get-tasks', project: 'foo' })` goes to the server, response comes back as a dispatched message of the response type
2. **Local messages** via the bus — `Raven.dispatch('switch-project', { project: 'foo' })` notifies other panels without a server round-trip

The server side mirrors this: `broadcast()` sends a message to all connected WebSocket clients, individual responses go to the requesting client.

```
Browser (window manager)          Server (kernel)
┌──────────────────┐              ┌──────────────────┐
│  app.js (core)   │◄── ws ──►   │  server.js       │
│  ├─ terminal.js  │              │  ├─ terminals.js  │
│  ├─ tasks.js     │              │  ├─ tasks.js      │
│  ├─ overview.js  │              │  ├─ sessions.js   │
│  └─ ...          │              │  └─ ...           │
└──────────────────┘              └──────────────────┘
```

Theming uses CSS custom properties on `:root`, so adding a dark/light toggle means changing a handful of variables. No per-component style overrides needed.

## Gotchas

- **Don't set panel `display` inline.** The panel visibility toggle uses CSS classes (`.panel` is hidden, `.panel.active` is visible). If you set `display` inline via JavaScript, it overrides the CSS class and breaks the toggle. Use `classList.add/remove` instead.

- **First panel auto-activates.** The first panel to register becomes the active panel. Registration order in the HTML determines the default view.

- **Toolbar delegation.** Each panel receives a reference to the shared toolbar element during `init()`. The panel is responsible for showing/hiding its toolbar content during `activate()`/`deactivate()`. This keeps the toolbar flexible without the core needing to know what each panel wants.

- **Alert indicators.** `setPanelAlert()` accepts status strings (`alert-red`, `alert-yellow`, `alert-blue`, `alert-green`) and sets a CSS class on the sidebar button. Multiple panels can have alerts simultaneously. Use this for things like "overdue tasks" or "high memory usage" — persistent status that's visible even when the panel isn't active.
