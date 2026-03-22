# Notification System

## Problem

An AI agent running in a terminal has no way to proactively communicate with the user through a visual interface. It can write to stdout, but that's lost in the scroll. When an agent completes a long-running task, composes a morning briefing, or encounters an error worth highlighting, there's no persistent channel to reach the user — especially if the user isn't watching that specific terminal.

## Approach

An HTTP endpoint (`/api/ui`) accepts notification requests and broadcasts them to all connected browser clients via WebSocket. Two notification types serve different needs:

- **Modals** — persistent, require explicit dismissal, survive server restarts. Used for anything the user shouldn't miss: daily briefings, error reports, important alerts.
- **Toasts** — ephemeral, fade after a timeout, not stored. Used for confirmations, progress updates, status changes.

Both support markdown rendering in the browser. A CLI wrapper script makes the endpoint callable from any context — hooks, cron jobs, other agent sessions, or manual invocation.

## Implementation

### Server side

Notifications are stored in a JSON file. Modals are persisted on creation and removed on dismissal. Toasts are broadcast only — never stored.

```javascript
function addNotification(notif) {
  notif.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  notif.createdAt = new Date().toISOString();
  _notifications.push(notif);
  if (notif.action === 'modal') saveNotifications();  // persist modals only
  return notif;
}
```

On WebSocket connect, the server sends all pending (undismissed) modals to the new client. This ensures nothing gets lost if the browser reconnects or if the notification arrived while no browser was open.

### Client side

The browser renders modals as overlay dialogs with a dismiss button. Toasts appear as temporary banners. Both render markdown content using a lightweight parser.

### CLI interface

A Bash script wraps curl calls to the API:

```bash
raven-ui modal "Build Complete" "All tests passed. Ready to deploy."
raven-ui toast "Status" "Guard mode set to away" --style info
raven-ui dismiss <notification-id>
```

This makes notifications composable. A cron job can compose a briefing and push it as a modal. A hook can send a toast when a session starts. An agent can notify about completed work.

### Typical flow

1. Agent (or cron job, or hook) calls `raven-ui modal "Title" "Body"`
2. CLI script POSTs JSON to `/api/ui`
3. Server assigns an ID, persists to `notifications.json`, broadcasts via WebSocket
4. Browser renders the modal overlay
5. User reads and dismisses → browser sends dismiss → server removes from storage

## Gotchas

- **Markdown in shell arguments.** Passing markdown with backticks and special characters through Bash requires careful quoting. The CLI tool handles this, but calling the API directly from `curl` needs attention.
- **Notification accumulation.** Modals persist until dismissed. If an automated job creates one daily and the user doesn't check for a week, seven modals queue up. The current design treats this as acceptable — better to show all of them than to silently drop some.
- **No notification routing.** All connected browsers receive all notifications. There's no concept of "send this to terminal 3 only." For a single-user system this is fine; it would need rethinking for multi-user.
