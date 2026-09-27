#!/usr/bin/env node
/**
 * Raven Codex hook — notifies the web UI about Codex lifecycle events.
 *
 * Usage: node codex-notify.js <event-type>
 *   event-type: session-start | stop | session-end
 *
 * Installed as Codex hooks (SessionStart, UserPromptSubmit, Stop, SessionEnd)
 * via ~/.codex/hooks.json — see skills/raven-dev/scripts/sync-codex-hooks.sh.
 *
 * This is the Codex counterpart of notify-hook.js and posts to the same
 * /api/hook endpoint with agent:'codex'. Codex delivers the same stdin field
 * names as Claude Code (session_id, transcript_path, cwd, hook_event_name),
 * so the server needs no separate payload shape.
 *
 * What it deliberately does NOT do: guard/away enforcement. raven-guard is a
 * Claude Code hook that decides permissions; Codex has its own sandbox and
 * approval policy and this hook has no say in them. Registration only.
 *
 * Always exits 0. A hook that fails must never interrupt the session, and
 * Codex adds a non-zero hook's stderr to the model's context as an error.
 *
 * Silently does nothing when:
 *   - Not running in a Raven web UI terminal ($RAVEN_TERMINAL_ID unset)
 *   - Web UI server is unreachable
 *
 * SessionEnd and Interrupt hooks are given 1 second by Codex (3s maximum), so
 * the request timeout is deliberately short.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const DEBUG_LOG = path.join(HOME, '.claude', 'hook-debug.log');
function debugLog(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] codex-notify: ${msg}\n`);
  } catch {}
}

const event = process.argv[2];
const terminalId = process.env.RAVEN_TERMINAL_ID;
if (!event || !terminalId) process.exit(0);

const PORT = process.env.RAVEN_PORT || 3000;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(input); } catch { data = {}; }

  // Codex fires SessionStart for `resume` too. Both mean "Codex owns this
  // terminal now", so no source filtering — the server converges on whichever
  // session id the latest event carries.
  const body = JSON.stringify({ terminal: terminalId, event, data, agent: 'codex' });

  const req = http.request({
    hostname: 'localhost', port: PORT, path: '/api/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 800,
  }, (res) => {
    res.resume();
    debugLog(`${event} sent: terminal=${terminalId} session=${data.session_id || '?'}`);
    process.exit(0);
  });

  req.on('error', (err) => { debugLog(`${event} failed: ${err.message}`); process.exit(0); });
  req.on('timeout', () => { req.destroy(); debugLog(`${event} timed out`); process.exit(0); });
  req.write(body);
  req.end();
});
