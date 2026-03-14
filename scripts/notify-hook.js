#!/usr/bin/env node
/**
 * Raven unified hook — notifies the web UI about CC lifecycle events.
 *
 * Usage: node notify-hook.js <event-type>
 *   event-type: session-start | stop | permission
 *
 * Installed as CC hooks (SessionStart, Stop, PermissionRequest).
 * Sends structured data to the Raven web UI, then exits.
 *
 * Exit codes are event-dependent:
 *   - permission: exit 1 (fall through to normal permission dialog)
 *   - session-start, stop: exit 0 (success — exit 1 triggers a warning)
 *
 * Silently does nothing when:
 *   - Not running in a Raven web UI terminal ($RAVEN_TERMINAL_ID unset)
 *   - Web UI server is unreachable
 */

const http = require('http');

const terminalId = process.env.RAVEN_TERMINAL_ID;
if (!terminalId) process.exit(0);

const event = process.argv[2];
if (!event) process.exit(0);

// PermissionRequest hooks must exit 1 to fall through to the normal dialog.
// Other hooks (SessionStart, Stop) should exit 0 — exit 1 shows a warning.
const exitCode = event === 'permission' ? 1 : 0;

const PORT = process.env.RAVEN_PORT || 3000;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    data = {};
  }

  const body = JSON.stringify({ terminal: terminalId, event, data });

  const req = http.request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/hook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 5000,
  }, (res) => {
    res.resume();
    process.exit(exitCode); // fall through — let normal CC behavior continue
  });

  req.on('error', () => process.exit(exitCode));
  req.on('timeout', () => { req.destroy(); process.exit(exitCode); });
  req.write(body);
  req.end();
});
