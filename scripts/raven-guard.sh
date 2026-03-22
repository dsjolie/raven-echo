#!/bin/bash
# Raven Guard — mode switcher for tool call guardrails.
#
# Modes:
#   default  Always-on guardrails (cd&&, $() etc.)
#   away     Guardrails + blocks permission-requiring tools
#   off      No checks
#
# Usage:
#   raven-guard.sh [default|away|off|status]
#   raven-guard.sh                  (cycle: default → away → off → default)

MODE_FILE="$HOME/.claude/raven-guard"

current_mode() {
  if [ -f "$MODE_FILE" ]; then
    cat "$MODE_FILE"
  else
    echo "default"
  fi
}

set_mode() {
  local mode="$1"
  if [ "$mode" = "default" ]; then
    rm -f "$MODE_FILE"
  else
    echo "$mode" > "$MODE_FILE"
  fi
}

case "${1:-cycle}" in
  default)
    set_mode "default"
    echo "Guard: DEFAULT — always-on guardrails active"
    ;;
  away)
    set_mode "away"
    echo "Guard: AWAY — guardrails + tool blocking active"
    ;;
  off)
    set_mode "off"
    echo "Guard: OFF — no checks"
    ;;
  status)
    echo "Guard mode: $(current_mode)"
    ;;
  cycle)
    cur=$(current_mode)
    case "$cur" in
      default) set_mode "away";   echo "Guard: AWAY — guardrails + tool blocking active" ;;
      away)    set_mode "off";    echo "Guard: OFF — no checks" ;;
      off)     set_mode "default"; echo "Guard: DEFAULT — always-on guardrails active" ;;
    esac
    ;;
  *)
    echo "Usage: raven-guard.sh [default|away|off|status]"
    exit 1
    ;;
esac
