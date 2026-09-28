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
- **The 5h and 7d windows are independent.** There is no official conversion
  and none may be derived (no `7d ÷ 7`, no linear mapping, never infer one %
  from the other). `usage_verdict.py --ratio` *measures* the plan's cap ratio
  from paired deltas in `limits-history.jsonl`; that is the only sanctioned
  number, and it is a snapshot — re-measure after any limit change.
- **`guard.builtin_auto_continue` defaults to `false`** (v0.1.7 revert):
  the guard arms its own resume (one-shot CronCreate / `handoff.md` + the
  per-OS `extras/` script). v0.1.6 defaulted to `true`, and on 2026-09-27
  several herdr sessions that hit the cap were never resumed by the built-in
  feature. Don't flip the default back without a verified end-to-end resume.
  When a user sets `true`, the guard must never tell Claude to stop — the
  built-in auto-continue only resumes a turn the limit *interrupted*. Soft is
  silent; hard says keep working, save state, start no new subagent waves.

## Release checklist

1. Update `CHANGELOG.md` (new version section, user-visible changes only).
2. Keep `README.md` and `README.zh-TW.md` in sync — every behavior/config
   change appears in BOTH.
3. Commit, tag `vX.Y.Z`, push master + tag.
4. Docs-only edits (README, this file) ride the next release tag; they are
   not tagged on their own.

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

## Maintainer notes (the author's own deployment — other users can ignore)

- This repo is the source of truth. The live copies Claude Code actually runs
  are `~/.claude/hooks/statusline-v2/{statusline,budget-guard}.cjs` (the
  folder name is historical; `settings.json` points there) and
  `usage_verdict.py` duplicated to `~/.claude/scripts/`. After every release,
  copy the three files to those locations — a release that is not synced
  changes nothing on the author's machine.
- State dir is `~/.claude/claude-pacer/` (`config.json`, `limits.json`,
  `limits-history.jsonl`, `width-last.json`, `handoff.md`). The old
  `~/.claude/statusline-v2/` state dir and `hooks/statusline-v2/bak-20260724/`
  are rollback only — any doc calling them live is stale; fix on sight.
