# Changelog

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
