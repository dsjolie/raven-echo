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
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE;
const DEBUG_LOG = path.join(HOME, '.claude', 'hook-debug.log');
function debugLog(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] notify-hook: ${msg}\n`);
  } catch {}
}

const event = process.argv[2];
if (!event) process.exit(0);

debugLog(`started, event=${event}, RAVEN_TERMINAL_ID=${process.env.RAVEN_TERMINAL_ID || 'UNSET'}`);

// Determine exit behavior for permission events BEFORE any early exit.
// When guard is away, use JSON deny decision (not exit 2 which CC may treat as hook error).
// This matches away-reject.js — both hooks output the same JSON deny.
let exitCode = 0;
let jsonDeny = null;
let skipNotification = false;
if (event === 'permission') {
  // Web-approve: if the tool is auto-approved, skip the notification entirely
  try {
    const waFile = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'web-approve.json');
    const wa = JSON.parse(fs.readFileSync(waFile, 'utf8'));
    if (wa.active && new Date(wa.expires_at) > new Date()) {
      // Read tool name from stdin peek — but stdin hasn't been consumed yet.
      // We can't read stdin here without blocking, so check a simpler signal:
      // if web-approve is active, suppress the permission notification.
      // away-reject.js handles the actual allow/deny decision.
      skipNotification = true;
    }
  } catch { /* no file — fall through */ }

  if (!skipNotification) {
    const modeFile = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'raven-guard');
    let mode = 'default';
    try { mode = fs.readFileSync(modeFile, 'utf8').trim() || 'default'; } catch {}
    if (mode === 'away') {
      jsonDeny = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'AWAY: auto-rejected by notify-hook' }
        }
      });
    } else {
      exitCode = 1; // non-away permission: fall through
    }
  }
}

debugLog(`computed exitCode=${exitCode} for event=${event}`);

// If web-approve handled this, exit silently — no notification, no deny
if (skipNotification) {
  debugLog(`web-approve active — skipping permission notification, exiting 0`);
  process.exit(0);
}

// If not in a Raven terminal, skip the notification but preserve the deny decision
// (important for permission events in away mode — must still deny).
const terminalId = process.env.RAVEN_TERMINAL_ID;
if (!terminalId) {
  if (jsonDeny) console.log(jsonDeny);
  debugLog(`no terminal ID — exiting ${exitCode}${jsonDeny ? ' (JSON deny)' : ''}`);
  process.exit(exitCode);
}

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
    if (jsonDeny) console.log(jsonDeny);
    debugLog(`http ok — exiting ${exitCode}${jsonDeny ? ' (JSON deny)' : ''}`);
    process.exit(exitCode);
  });

  req.on('error', (e) => { debugLog(`http error: ${e.message} — exiting ${exitCode}`); process.exit(exitCode); });
  req.on('timeout', () => { req.destroy(); debugLog(`http timeout — exiting ${exitCode}`); process.exit(exitCode); });
  req.write(body);
  req.end();
});
