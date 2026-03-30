#!/usr/bin/env node
/**
 * Raven Guard — tool call guardrails with multiple modes.
 *
 * Installed as a PreToolUse hook (no matcher = all tools).
 * Reads mode from ~/.claude/raven-guard (default|away|off).
 * Missing file = "default".
 *
 * Modes:
 *   default — always-on guardrails that catch common permission-triggering patterns
 *   away    — default guardrails + blocks tools that require permission prompts
 *   off     — no checks (fast exit)
 */

const fs = require('fs');
const path = require('path');

const MODE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude',
  'raven-guard'
);

// Raven root — for scanning task files
const RAVEN_ROOT = path.resolve(__dirname, '..', '..');
const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

/** Extract all URLs from task files (tasks.md + tasks/*.md). Cached per invocation. */
let _taskUrls = null;
function getTaskUrls() {
  if (_taskUrls) return _taskUrls;
  _taskUrls = new Set();
  try {
    // Main tasks.md
    const main = path.join(RAVEN_ROOT, 'tasks.md');
    if (fs.existsSync(main)) {
      for (const m of fs.readFileSync(main, 'utf8').matchAll(URL_RE)) _taskUrls.add(m[0]);
    }
    // tasks/*.md
    const tasksDir = path.join(RAVEN_ROOT, 'tasks');
    if (fs.existsSync(tasksDir)) {
      for (const f of fs.readdirSync(tasksDir)) {
        if (!f.endsWith('.md')) continue;
        for (const m of fs.readFileSync(path.join(tasksDir, f), 'utf8').matchAll(URL_RE)) _taskUrls.add(m[0]);
      }
    }
  } catch { /* ignore read errors */ }
  return _taskUrls;
}

/** Check if a URL exactly matches one in the task files. */
function isTaskUrl(url) {
  if (!url) return false;
  const urls = getTaskUrls();
  // Exact match or match after stripping trailing slash
  return urls.has(url) || urls.has(url.replace(/\/+$/, ''));
}

// Read mode (default if file missing)
let mode = 'default';
try {
  mode = fs.readFileSync(MODE_FILE, 'utf8').trim() || 'default';
} catch {
  // file doesn't exist — default mode
}

// Off = no checks
if (mode === 'off') process.exit(0);

// --- Parse tool input from stdin -------------------------------------------

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let toolName, toolInput;
  try {
    const data = JSON.parse(input);
    toolName = data.tool_name;
    toolInput = data.tool_input || {};
  } catch {
    process.exit(0); // can't parse — allow
  }

  // === TIER 1: Always-on guardrails (default + away) =======================

  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const cmd = toolInput.command;

    // raven-guard off/off — don't turn off guard without good reason
    if (/raven-guard\.sh\s+off/.test(cmd)) {
      block(
        'Don\'t turn off the guard. Try your command without disabling it first. ' +
        'If a guardrail is blocking something legitimate, explain why it\'s needed.'
      );
    }

    // activate_venv — venv is already active in Raven terminals
    if (/activate_venv/.test(cmd)) {
      block(
        'The Raven venv is already active in this terminal. ' +
        'Run the command directly without venv activation (e.g. just `python ...`).'
      );
    }

    // cd /path && command — triggers permission prompts
    if (/\bcd\s+\S+\s*&&/.test(cmd)) {
      block(
        'Compound cd commands (cd /path && ...) trigger permission prompts. ' +
        'Use relative paths, or run cd and the command as separate Bash calls.'
      );
    }

    // $() command substitution in arguments — triggers CC protection
    if (/\$\(/.test(cmd) && !/^\s*(echo|printf)\b/.test(cmd)) {
      block(
        'Command substitution $() in arguments triggers CC permission protection. ' +
        'Use direct values instead, or split into separate calls and capture output.'
      );
    }
  }

  // === TIER 2: Away mode (tool blocking) ===================================

  if (mode !== 'away') process.exit(0);

  // --- Bash whitelist for away mode ---
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const cmd = toolInput.command;
    // Safe git subcommands (no destructive ops like reset --hard, push --force, checkout .)
    const gitSafe =
      /^\s*git\s+(add|commit|push|pull|status|log|diff|branch|fetch)\b/.test(cmd) &&
      !/--force\b/.test(cmd) &&
      !/--hard\b/.test(cmd) &&
      !/\bcheckout\s+\./.test(cmd) &&
      !/\brestore\s+\./.test(cmd) &&
      !/\breset\b/.test(cmd) &&
      !/\bclean\b/.test(cmd) &&
      !/-D\b/.test(cmd);

    const safe =
      cmd.includes('raven-guard.sh') ||                        // toggle guard mode
      /\brtasks\b/.test(cmd) ||                                // raven-tasks CLI
      /skills\/raven-[^/]+\/scripts\//.test(cmd) ||            // any raven skill script
      /scripts\/raven-ui\b/.test(cmd) ||                       // raven-ui CLI
      /\bcurl\b.*\blocalhost\b/.test(cmd) ||                   // web UI API (localhost only)
      /\bcurl\b.*\b127\.0\.0\.1\b/.test(cmd) ||                // web UI API (loopback)
      gitSafe;                                                  // safe git operations

    if (safe) {
      // Block compound commands in away — they trigger permission prompts unattended
      if (/&&|;\s*\w/.test(cmd)) {
        block(
          'AWAY: Compound commands (&&, ;) trigger permission prompts. ' +
          'Split into separate Bash calls, one command each.'
        );
      }
      process.exit(0);
    }

    // Rodney (headless Chrome) — lifecycle commands always allowed, URLs must match tasks
    if (/\brodney\b/.test(cmd)) {
      // start/stop/screenshot/html/ax-tree — no URL needed, safe lifecycle/read ops
      if (/\brodney\s+(start|stop|screenshot|html|ax-tree)\b/.test(cmd)) {
        process.exit(0);
      }
      // open/js/text/click — allow if any URL in the command matches a task URL
      const urlMatch = cmd.match(URL_RE);
      const url = urlMatch ? urlMatch[0] : null;
      if (url && isTaskUrl(url)) {
        process.exit(0);
      }
      // No-URL rodney commands that aren't lifecycle (e.g. rodney js "...") — allow
      // These operate on whatever page is already open (loaded via a task URL)
      if (!url && /\brodney\s+(js|text|click)\b/.test(cmd)) {
        process.exit(0);
      }
      block(
        'AWAY: Rodney URLs must match a task URL. ' +
        'The URL in this command does not match any task URL.'
      );
    }
  }

  // Block MCP tools
  if (toolName && toolName.startsWith('mcp__')) {
    block(
      'AWAY: MCP tools are blocked. ' +
      'Use built-in tools (Read, Write, Edit, Grep, Glob) instead. ' +
      'If no alternative exists, wait for the user to return.'
    );
  }

  // WebFetch — allow if URL matches a task URL exactly
  if (toolName === 'WebFetch' && toolInput.url && isTaskUrl(toolInput.url)) {
    process.exit(0);
  }

  // Block permission-requiring tools
  const BLOCKED = new Set([
    'Bash', 'WebFetch', 'WebSearch', 'SendMessage', 'CronCreate', 'CronDelete',
  ]);

  if (toolName && BLOCKED.has(toolName)) {
    block(
      `AWAY: ${toolName} is blocked while the user is away. ` +
      'Use pre-allowed alternatives:\n' +
      '- File reading: Read tool\n' +
      '- File editing: Edit or Write tool\n' +
      '- Search files: Grep or Glob tool\n' +
      '- Explore code: Agent tool (subagent)\n' +
      '- Plan next steps: EnterPlanMode\n' +
      'If the task requires Bash or network access, stop and wait for the user.'
    );
  }

  process.exit(0); // tool not blocked — allow
});

function block(message) {
  process.stderr.write(message);
  process.exit(2);
}
