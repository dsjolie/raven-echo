#!/usr/bin/env python3
"""PreToolUse hook for raven-work sandbox enforcement.

Reads JSON from stdin (CC hook protocol), loads config from .raven-work/config.json
in the working directory, and enforces permission boundaries.

Exit codes:
  0 — allowed (with permissionDecision in output)
  2 — denied (with permissionDecision and reason in output)
"""

import json
import sys
import os
import fnmatch
from pathlib import Path, PureWindowsPath


def load_config(cwd: str) -> dict:
    """Load sandbox config by walking up from cwd to find .raven-work/config.json."""
    current = Path(cwd).resolve()
    for _ in range(50):  # safety limit
        config_path = current / ".raven-work" / "config.json"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        parent = current.parent
        if parent == current:
            break
        current = parent
    return {}


def resolve_path(file_path: str, cwd: str) -> str:
    """Resolve a file path to absolute, normalized form."""
    p = Path(file_path)
    if not p.is_absolute():
        p = Path(cwd) / p
    # Resolve symlinks and .. components
    try:
        resolved = str(p.resolve())
    except OSError:
        resolved = str(p)
    return resolved.replace("\\", "/")


def is_under(path: str, root: str) -> bool:
    """Check if path is under root directory (normalized forward slashes)."""
    path_norm = path.replace("\\", "/").rstrip("/").lower()
    root_norm = root.replace("\\", "/").rstrip("/").lower()
    return path_norm == root_norm or path_norm.startswith(root_norm + "/")


def matches_protected(rel_path: str, patterns: list[str]) -> bool:
    """Check if a relative path matches any protected pattern.

    Uses fnmatch for glob-style matching. The rel_path should be relative
    to the worktree root, with forward slashes.
    """
    # Normalize to forward slashes
    rel_path = rel_path.replace("\\", "/")
    filename = os.path.basename(rel_path)

    for pattern in patterns:
        pattern = pattern.replace("\\", "/")
        # If pattern contains /, match against full relative path
        if "/" in pattern:
            if fnmatch.fnmatch(rel_path, pattern):
                return True
        else:
            # Match against filename only
            if fnmatch.fnmatch(filename, pattern):
                return True
    return False


def get_relative_path(abs_path: str, root: str) -> str:
    """Get path relative to worktree root."""
    abs_norm = abs_path.replace("\\", "/").rstrip("/")
    root_norm = root.replace("\\", "/").rstrip("/")
    if abs_norm.lower().startswith(root_norm.lower()):
        rel = abs_norm[len(root_norm):]
        return rel.lstrip("/")
    return abs_path


def allow():
    """Output allow decision and exit 0."""
    result = {"hookSpecificOutput": {"permissionDecision": "allow"}}
    print(json.dumps(result))
    sys.exit(0)


def deny(reason: str):
    """Output deny decision with reason and exit 2."""
    result = {
        "hookSpecificOutput": {
            "permissionDecision": "deny",
            "reason": f"raven-work sandbox: {reason}"
        }
    }
    print(json.dumps(result))
    sys.exit(2)


def check_file_read(tool_input: dict, config: dict, cwd: str):
    """Check Read/Glob/Grep tool access."""
    worktree_root = config.get("worktree_root", "")
    if not worktree_root:
        deny("no worktree_root configured")

    # Get the path from the tool input
    file_path = tool_input.get("file_path") or tool_input.get("path") or cwd
    resolved = resolve_path(file_path, cwd)

    if not is_under(resolved, worktree_root):
        deny(f"path outside worktree: {file_path}")

    allow()


def check_file_write(tool_input: dict, config: dict, cwd: str):
    """Check Write/Edit tool access."""
    worktree_root = config.get("worktree_root", "")
    if not worktree_root:
        deny("no worktree_root configured")

    file_path = tool_input.get("file_path", "")
    if not file_path:
        deny("no file_path in tool input")

    resolved = resolve_path(file_path, cwd)

    if not is_under(resolved, worktree_root):
        deny(f"path outside worktree: {file_path}")

    # read_only: true = deny all writes unless path is under a write_paths entry
    # read_only: false = write anywhere in worktree (still subject to anti-tamper)
    read_only = config.get("read_only", False)
    write_paths = config.get("write_paths", [])

    if read_only:
        if not write_paths:
            deny("profile is read-only")
        rel_path = get_relative_path(resolved, worktree_root)
        allowed = False
        for wp in write_paths:
            wp_norm = wp.replace("\\", "/").rstrip("/")
            if rel_path.startswith(wp_norm):
                allowed = True
                break
        if not allowed:
            deny(f"read-only profile — writes restricted to: {', '.join(write_paths)}")

    # Check anti-tamper protected patterns
    protected = config.get("protected_patterns", [])
    if protected:
        rel_path = get_relative_path(resolved, worktree_root)
        if matches_protected(rel_path, protected):
            deny(f"anti-tamper: protected file")

    allow()


def check_bash(tool_input: dict, config: dict):
    """Check Bash tool access against allowlist."""
    command = tool_input.get("command", "")
    # Strip leading whitespace
    command = command.lstrip()

    bash_allowlist = config.get("bash_allowlist", [])

    for prefix in bash_allowlist:
        if command.startswith(prefix):
            allow()

    deny(f"command not in allowlist: {command.split()[0] if command else '(empty)'}")


def check_web(config: dict):
    """Check WebSearch/WebFetch access."""
    if not config.get("web_enabled", False):
        deny("web access disabled")
    allow()


def main():
    # Read hook input from stdin
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as e:
        deny(f"failed to parse hook input: {e}")

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})
    cwd = hook_input.get("cwd", os.getcwd())

    # Load sandbox config — if not found, pass through silently.
    # Subagents may run from a cwd where the config walk-up can't reach
    # the worktree root, and the hook should not block them.
    config = load_config(cwd)
    if not config:
        allow()

    # Route by tool
    if tool_name in ("Write", "Edit"):
        check_file_write(tool_input, config, cwd)

    elif tool_name in ("Read", "Glob", "Grep"):
        check_file_read(tool_input, config, cwd)

    elif tool_name == "Bash":
        check_bash(tool_input, config)

    elif tool_name in ("WebSearch", "WebFetch"):
        check_web(config)

    elif tool_name == "Agent":
        allow()  # subagents inherit the same hooks

    else:
        deny(f"tool not allowed: {tool_name}")


if __name__ == "__main__":
    main()
