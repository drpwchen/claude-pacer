#!/bin/sh
# schedule-resume.sh — macOS/Linux one-shot resume after the 5h rate-limit reset.
# Waits until resets_at (from limits.json) + 3 min, then runs headless `claude -p`
# driven by handoff.md. Survives the terminal closing (nohup), but not logout/
# reboot — for that, register the same command with `at`, cron, or launchd.
#
# Usage: ./schedule-resume.sh [/path/to/project-dir]
# Requires: handoff.md written in the state dir first; `claude` on PATH.
set -eu

DIR="${CLAUDE_PACER_DIR:-$HOME/.claude/claude-pacer}"
HANDOFF="$DIR/handoff.md"
LOG="$DIR/resume-log.txt"
WORKDIR="${1:-$PWD}"

[ -f "$HANDOFF" ] || { echo "Handoff file not found: $HANDOFF — write the resume instructions first." >&2; exit 1; }

# Node is already a hard dependency of the statusline; python3 is the fallback.
# Truncate to an integer either way — sh arithmetic below cannot take a float.
RESETS_AT=$(node -e "console.log(Math.floor(JSON.parse(require('fs').readFileSync('$DIR/limits.json','utf-8')).five_hour.resets_at))" 2>/dev/null) \
  || RESETS_AT=$(python3 -c "import json;print(int(json.load(open('$DIR/limits.json'))['five_hour']['resets_at']))" 2>/dev/null) \
  || RESETS_AT=""
case "$RESETS_AT" in
  ''|*[!0-9]*) echo "No usable five_hour.resets_at in $DIR/limits.json" >&2; exit 1 ;;
esac
NOW=$(date +%s)
DELAY=$(( RESETS_AT + 180 - NOW ))
[ "$DELAY" -lt 0 ] && DELAY=0

PROMPT="Read $HANDOFF and continue that work, following its instructions exactly. \
When finished (or blocked), append a '## Result' section with the current date to that same handoff file \
summarizing what was done and what remains."

nohup sh -c "
  sleep $DELAY
  cd '$WORKDIR'
  echo \"=== \$(date '+%Y-%m-%d %H:%M:%S') resume fired ===\" >> '$LOG'
  claude -p \"$PROMPT\" >> '$LOG' 2>&1
  echo \"=== exit code: \$? ===\" >> '$LOG'
" >/dev/null 2>&1 &

echo "OK: resume armed in $(( DELAY / 60 )) min (reset + 3 min), workdir $WORKDIR"
echo "Handoff: $HANDOFF"
echo "Log:     $LOG"
