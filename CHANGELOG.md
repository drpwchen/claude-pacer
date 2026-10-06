# Changelog

## v0.1.8 — 2026-10-06

- **`usage_verdict.py` is pace-aware.** It now reports *pace* (used % ÷
  elapsed % of the 5h window; below 1 = behind pace) and projects from the
  larger of the whole-window average rate and the last 30 minutes' trend
  (least-squares, extrapolated only as far as it was sampled). A projected
  overrun alone triggers PACE only when pace ≥ 0.9, so a dispatch burst while
  you are behind pace is reported instead of halting work. `--json` gains
  `five_hour.pace` / `five_hour.elapsed_pct`, and `projected_at_reset` is
  present whenever the window has not reset yet (before, it needed 10+ min
  of history).
- **No PACE from projection in the first 20 minutes of a window.** 1% after
  one minute used to "project" 300% and say PACE; now only the soft threshold
  can trigger PACE that early. The GO line says the projection is not acted on
  yet.
- **Reset times carry the date when they are not today.** `usage_verdict.py`
  and `budget-guard.cjs` print `HH:MM` for a reset later today and
  `MM-DD HH:MM` otherwise, so a reset at 01:00 tomorrow no longer reads as
  01:00 today.
- Verdict line order is fixed: verdict → core reason → `[7d: …]` → optional
  detail → footer, so callers that truncate the line keep the 7d note.
- `USAGE_VERDICT_NOW=<epoch seconds>` pins the clock for both scripts (tests).
- New `test_usage_verdict.py` (stdlib `unittest`, timezone-independent;
  the budget-guard case is skipped without node).
- New `extras/usage_verdict_shim.py`: an optional thin wrapper for keeping one
  shared copy of the verdict in `~/.claude/scripts/` while `budget-guard.cjs`
  keeps pointing at the file next to it.

## v0.1.7 — 2026-09-28

- **Default reverted — `guard.builtin_auto_continue` is `false` again.** In
  real multi-session use, sessions that hit the 5h cap under the v0.1.6
  default were never resumed by Claude Code's built-in auto-continue — they
  sat idle past the reset until resumed by hand. The hard (93%) warning is
  back to: wrap up the current step, arm a one-shot CronCreate resume for a
  few minutes after the reset, end the turn. `true` is still available if
  the built-in option works in your setup.
- With no `resume_hint` set, the "terminal will close" fallback now points
  Claude at the bundled resume script for the current OS
  (`extras/windows/schedule-resume.ps1` on Windows,
  `extras/unix/schedule-resume.sh` on macOS/Linux) when it sits next to
  `budget-guard.cjs`; otherwise it still tells the user to restart after the
  reset.
- Docs: the guard only sees usage when a statusline renders (~every 2 min),
  so a fleet burning several %/min can jump from below 93% straight to the
  cap between samples — then no warning arrives in time and no resume gets
  armed. Pace such runs with `usage_verdict.py` / pace mode.

## v0.1.6 — 2026-09-12

- **Behaviour change — `guard.builtin_auto_continue` (default `true`)**: the
  guard now assumes Claude Code's own "Continue automatically at usage limit"
  (`/config`, on by default since v2.1.234) does the resuming. That feature
  only resumes a turn the limit *interrupted*, so the old hard warning ("wrap
  up, arm a one-shot resume, end the turn") actively defeated it. Now: soft
  (85%) is silent; hard (93%) and near-reset say keep working, save in-progress
  state, no CronCreate / `handoff.md`, and launch no new subagent waves
  (subagents do not auto-continue — they end as failed and must be resumed
  after the reset).
- Set `"builtin_auto_continue": false` to keep the previous CronCreate /
  `handoff.md` + resume-script path (Claude Code < v2.1.234, or the `/config`
  option turned off). `resume_hint` still applies only in that mode.

## v0.1.5 — 2026-08-11

- **Fix (macOS/Linux)**: the terminal-width probe leaked its child's stderr to
  the parent, so every probe without a controlling tty printed
  `/bin/sh: /dev/tty: Device not configured` into the terminal. Both probe
  branches now run with stderr discarded.
- `extras/unix/schedule-resume.sh`: is now executable in git (the README tells
  you to run `./schedule-resume.sh`); reads `resets_at` via Node — already a
  hard dependency — with `python3` only as a fallback; truncates it to an
  integer and validates it before the `sh` arithmetic, which a float would
  have broken.
- Docs: install section now covers the two things that actually bite on
  macOS/Linux — installing Node, and giving Claude Code an absolute `node`
  path when the GUI/launchd PATH doesn't include your package manager's bin
  directory.

## v0.1.4 — 2026-08-04

- **Near-reset exemption** (`guard.near_reset_min`, default 20): warnings now
  scale with time-to-reset, not just usage %. With ≤20 min left, hitting the
  cap only costs a brief pause — so the soft (85%) warning stays silent, the
  hard (93%) one downgrades to "work normally, arm a one-shot resume only if
  actually capped", and `usage_verdict.py` softens one level (STOP→PACE,
  PACE→GO) with an explanatory note.
- Docs: README (both languages) now links to the beginner series and to the
  post explaining why this tool exists. No runtime change.

## v0.1.3 — 2026-07-24

- Gentler responsive degrade: before dropping to the compact tier, retry the
  FULL layout with a shorter topic (8 chars) — a line that misses the terminal
  width by a few columns now keeps its bars, marker, and times.
- Diagnostics: every render writes `width-last.json` (width source, chosen
  tier, final line width) to the state dir — read it when the layout
  surprises you.
- `AGENTS.md` added — ground rules for AI coding agents working on this repo.

## v0.1.2 — 2026-07-24

- Compact tier now pairs the bar with **time remaining** instead of a usage
  percentage — the bar already shows usage; the time is what it can't show.
- Real terminal-width detection: `$COLUMNS` (set by Claude Code ≥2.1.153),
  then `stdout.columns`, then a cached console probe (`mode con` / `stty`).
  Unknown width now keeps the **full** layout instead of assuming 80 columns.
- New `"tier"` config / `--tier` flag to pin `full` / `compact` / `minimal`.

## v0.1.1 — 2026-07-24

- Fix: the elapsed-time marker used to REPLACE a bar cell, which inflated the
  apparent fill on narrow bars (63% could render as a full bar). It is now
  inserted between cells, and compact tiers drop it entirely.
- New: model + reasoning-effort segment at the far right of every tier
  (`Fable 5·high` → `Fable5·hi` → `F5·hi`), `"model"` config to hide.
- Slimmer full tier: default `bar_width` 8 → 6, `topic_chars` 24 → 20.

## v0.1.0 — 2026-07-24

Initial public release, extracted from a personal setup that has run in daily
multi-agent use since 2026-07-14.

- `statusline.cjs`: 5h/7d usage windows with time-remaining and elapsed-time
  comparison, context-window fullness, conversation topic
  (session title → transcript summary → first prompt), bar/number display
  modes (bar default), responsive 3-tier layout that degrades to fit the
  terminal width (context segment rightmost; CJK topics lose their spaces),
  `config.json` + CLI-flag configuration, `--demo` preview.
- `budget-guard.cjs`: soft/hard usage warnings injected into Claude's context;
  per-session dedup with re-arm; reset-arithmetic silence; opt-in pace mode
  for multi-agent runs.
- `usage_verdict.py`: canonical GO/PACE/STOP interpretation of the limit data,
  with burn-rate projection and `--ratio` (empirical 7d/5h cap ratio).
- `extras/windows/` + `extras/unix/`: one-shot auto-resume after a hard cap
  (Scheduled Task on Windows; nohup timer on macOS/Linux).
