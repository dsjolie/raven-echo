#!/usr/bin/env node
/**
 * gitlock-nudge — PostToolUse reminder to release the raven-gitlock commit-lock.
 *
 * After a `git commit` or `git push`, if this session still holds the commit-lock,
 * inject a non-blocking reminder (additionalContext) to release it when done — so a
 * forgotten lock doesn't block other sessions. Not every session pushes, so commit
 * is covered too.
 *
 * PostToolUse (not PreToolUse) on purpose: it runs *after* the command, so it never
 * short-circuits the guard's PreToolUse checks (a PreToolUse allow-decision would
 * bypass them — notably the $() check on commit messages). Fails silent.
 *
 * Identity = CLAUDE_CODE_SESSION_ID; lock at <repo-root>/.git/raven-commit.lock
 * (repo root found by walking up from the session cwd, matching raven-gitlock.py
 * and raven-guard.js).
 */
const fs = require('fs');
const path = require('path');

const RELEASE_CMD = 'python ~/.claude/skills/raven-gitlock/scripts/raven-gitlock.py release';

function findRepoRoot(start) {
  try {
    let d = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(d, '.git'))) return d;
      const parent = path.dirname(d);
      if (parent === d) return null;
      d = parent;
    }
  } catch {
    return null;
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') process.exit(0);
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!/^\s*git\s+(commit|push)\b/.test(cmd)) process.exit(0);

    const myId = process.env.CLAUDE_CODE_SESSION_ID || '';
    if (!myId) process.exit(0);
    const root = findRepoRoot(data.cwd || process.cwd());
    if (!root) process.exit(0);

    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(path.join(root, '.git', 'raven-commit.lock'), 'utf8'));
    } catch { process.exit(0); }
    if (!lock || lock.owner !== myId) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'raven-gitlock: you still hold the commit-lock. If you\'re finished committing, ' +
          'release it so other sessions aren\'t blocked:\n  ' + RELEASE_CMD,
      },
    }));
  } catch {
    /* fail silent — a reminder must never disrupt the tool flow */
  }
  process.exit(0);
});
