# AGENTS.md — notes for AI coding agents

## What this is

Three cooperating scripts around Claude Code's usage limits. They share one
state dir (default `~/.claude/claude-pacer/`, override `--dir` /
`$CLAUDE_PACER_DIR`):

- `statusline.cjs` — renders the statusline AND persists `limits.json` +
  `limits-history.jsonl` (the data source for the other two). Responsive
  3-tier layout; see `render()`/`buildLine()`.
- `budget-guard.cjs` — UserPromptSubmit/PostToolUse hook; injects wrap-up
  instructions at soft/hard usage thresholds. Reads `limits.json`.
- `usage_verdict.py` — one-line GO/PACE/STOP verdict; the ONLY sanctioned way
  for agents to interpret the limit data (encodes reset arithmetic, 7d
  false-alarm logic, burn projection).

## Hard rules

- **Zero runtime dependencies.** Plain Node (CommonJS) + Python 3 stdlib.
  Do not add npm packages, package.json, or pip requirements.
- **Never crash the statusline.** Every entry point is wrapped in
  `try { main() } catch {}` — keep it that way; a broken statusline takes the
  user's whole prompt UI hostage. Same spirit inside: fail silent, render
  what you can (missing data renders as a dim `–`).
- **Cross-platform.** Windows + macOS + Linux. No bare `python` on Unix
  (use `python3`); no paths outside `path.join(HOME, ...)`; shell probes must
  be optional with silent fallback.
- **Config compatibility.** `config.json` keys are public API once released —
  add new keys with safe defaults, don't rename or repurpose existing ones.
- **Verify with `node statusline.cjs --demo`** (all tiers, both display
  modes) plus a synthetic-stdin render before committing. There is no test
  suite; the demo is the smoke test.

## Release checklist

1. Update `CHANGELOG.md` (new version section, user-visible changes only).
2. Keep `README.md` and `README.zh-TW.md` in sync — every behavior/config
   change appears in BOTH.
3. Commit, tag `vX.Y.Z`, push master + tag.

## Layout notes

- Width detection order: config `width` → `$COLUMNS` (Claude Code ≥2.1.153
  sets it) → `stdout.columns` → cached console probe. Unknown width must
  NEVER degrade the layout — full tier is the fallback.
- `plainWidth()` counts CJK as 2 columns; keep it in sync with any new glyphs.
- The elapsed-time marker `┃` is inserted BETWEEN bar cells (bar renders w+1
  wide) so the filled proportion always reads true. Never let it replace a
  cell again (v0.1.1 bug).
- `width-last.json` in the state dir records the last render's width sources
  and chosen tier — read it first when debugging layout complaints.
