# Notification System

## Problem

An agent operating inside a terminal has no natural way to reach a human who isn't watching that terminal. Writing to stdout works while someone is present and attentive; it fails for out-of-band communication — morning briefings delivered by a cron job, error alerts from a hook firing mid-session, completion signals from long-running autonomous work. The signal either scrolls by unnoticed or never gets seen at all.

The requirement is one-way agent-initiated messaging: the agent speaks, the browser listens, and the human sees it whenever they look at the UI — whether that's 30 seconds or 8 hours later.

## Approach

A single HTTP endpoint accepts notification requests. Depending on the notification type, the server either persists the payload to disk and broadcasts it over WebSocket, or broadcasts only. Two distinct durability levels map to two distinct use cases:

- **Modals** — persistent. Stored to a JSON file on disk, held in memory, delivered to every browser that connects (now or later). Require explicit user dismissal. Suited to anything the human must eventually see: briefings, alerts, work summaries.
- **Toasts** — ephemeral. Broadcast over WebSocket and forgotten. Auto-dismiss after a few seconds. Suited to transient acknowledgements and status changes where the content is unimportant if missed.

A thin Bash CLI wraps the HTTP calls so any context — hooks, cron jobs, subagents, manual invocation — can push a notification with a single shell command. No library dependency, no Python environment required.

## Implementation

### Server: splitting paths early

The endpoint handler branches on `action` before doing anything else. Modals call `addNotification()`, which assigns an ID, timestamps the record, appends it to the in-memory array, and flushes the array to `web-ui/data/notifications.json`. Toasts skip `addNotification()` entirely — they get an ID and are broadcast immediately, with no write to disk.

```javascript
if (msg.action === 'modal') {
  const notif = addNotification(msg);   // assigns id, timestamps, persists
  broadcast({ type: 'ui-notify', ...notif });
} else if (msg.action === 'toast') {
  if (!msg.id) msg.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  broadcast({ type: 'ui-notify', ...msg });
}
```

The decision to split at the entry point rather than inside a shared function matters. A shared function with an internal `if (isModal) persist()` guard creates a single point of failure: any path that bypasses the guard (edge case, Dropbox sync restoring an older file, logic error) silently promotes a toast into permanent storage. Separating the paths means the invariant — toasts never touch disk — is structural, not conditional.

### Server: pending-on-reconnect

On each new WebSocket connection, after sending the current terminal list and guard state, the server iterates `_notifications` and sends every stored modal to the new client:

```javascript
// Send pending notifications (modals survive server restarts + reconnects)
for (const notif of _notifications) {
  ws.send(JSON.stringify({ type: 'ui-notify', ...notif }));
}
```

This means a modal created at 03:00 by a cron job is still visible when the browser opens at 09:00. The user never needs to be connected at the moment of delivery.

### Server: dismissal

A `dismiss` action removes the notification from `_notifications` by ID and broadcasts a `ui-dismiss` message so all connected clients can update their state. The in-memory array and the JSON file are kept in sync on every mutation.

### Client: rendering

The browser side (`web-ui/public/js/notify.js`) maintains a `pending` map of undismissed modal IDs. When a `ui-notify` message arrives:

- For a modal: deduplicate by ID, add to `pending`, show immediately if no other modal is currently displayed (otherwise the next one surfaces on dismiss of the current one — FIFO queue).
- For a toast: create a DOM element, append to a container, schedule removal after a timeout (default 5 s, overridable via `duration`).

Modal body content is passed through `marked.parse()` when `marked` is available, falling back to newline-to-`<br>` substitution. This lets agents write structured markdown — headers, bullet lists, code blocks — without the client needing to know anything special.

Dismissal sends a WebSocket message back to the server (`type: 'dismiss-notification'`), which triggers the server-side delete-and-broadcast. The client also listens for `ui-dismiss` from the server so that dismissal from one browser tab or device is reflected everywhere.

### CLI wrapper

The CLI script (`skills/raven-ui/scripts/raven-ui`) resolves the server port from `$RAVEN_UI_PORT` (defaulting to 3000), constructs JSON payloads via a small inline Python snippet (to handle quoting and file-reading correctly), and posts to `/api/ui` via curl:

```bash
raven-ui modal "Morning Briefing" "Research complete. See attached." --file docs/reports/today.md
raven-ui toast "Guard mode" "Now: away" --style info
raven-ui dismiss a3f9b2
```

The `--file` flag reads the body from a file, bypassing shell argument length limits for large markdown reports. The `--style` flag adds a CSS class (`notify-info`, `notify-warn`, `notify-error`) for color-coding. The return value includes the assigned notification ID, which the caller can capture for subsequent dismissal.

The script is installed globally via a junction, so it resolves correctly from any project working directory without activation or path manipulation.

## Gotchas

- **Markdown in shell arguments.** Backticks, double-quotes, and `$` all cause trouble when passed as Bash arguments. The `--file` option sidesteps this for larger content; inline bodies with special characters still need careful quoting or heredoc wrapping at the call site.

- **Modal accumulation.** Persistent storage means unchecked notifications pile up. An automated process running daily will produce one modal per day; a week offline yields seven queued modals. The design treats queuing as correct behavior — silent drops would be worse. If accumulation becomes a problem the right fix is a time-to-live field on the notification record, not a storage cap.

- **No targeted delivery.** Every connected browser client receives every notification. This is appropriate for a single-user personal assistant; a multi-user context would need per-session or per-user routing at the WebSocket layer.

- **Server must be running.** The CLI call fails cleanly (curl exit code + stderr message) if the web UI server isn't running, but the notification is lost — there's no local queue that drains when the server starts. For overnight autonomous work the server is assumed to be up; scheduled jobs that might precede server start need their own retry or the notification reaches the human only when the server next runs.
