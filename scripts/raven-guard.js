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
    const safe =
      cmd.includes('raven-guard.sh') ||                        // toggle guard mode
      /\brtasks\b/.test(cmd) ||                                // raven-tasks CLI
      /skills\/raven-[^/]+\/scripts\//.test(cmd) ||            // any raven skill script
      /scripts\/raven-ui\b/.test(cmd) ||                       // raven-ui CLI
      /\bcurl\b.*\blocalhost\b/.test(cmd) ||                   // web UI API (localhost only)
      /\bcurl\b.*\b127\.0\.0\.1\b/.test(cmd);                 // web UI API (loopback)

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
  }

  // Block MCP tools
  if (toolName && toolName.startsWith('mcp__')) {
    block(
      'AWAY: MCP tools are blocked. ' +
      'Use built-in tools (Read, Write, Edit, Grep, Glob) instead. ' +
      'If no alternative exists, wait for the user to return.'
    );
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
