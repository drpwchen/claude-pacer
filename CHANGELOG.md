# Changelog

## Unreleased

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
