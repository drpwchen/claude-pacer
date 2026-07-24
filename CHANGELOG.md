# Changelog

## v0.1.0 — 2026-07-24

Initial public release, extracted from a personal setup that has run in daily
multi-agent use since 2026-07-14.

- `statusline.cjs`: 5h/7d usage windows with time-remaining and elapsed-time
  comparison, context-window fullness, optional conversation topic
  (session title → transcript summary → first prompt), number/bar display
  modes, `config.json` + CLI-flag configuration, `--demo` preview.
- `budget-guard.cjs`: soft/hard usage warnings injected into Claude's context;
  per-session dedup with re-arm; reset-arithmetic silence; opt-in pace mode
  for multi-agent runs.
- `usage_verdict.py`: canonical GO/PACE/STOP interpretation of the limit data,
  with burn-rate projection and `--ratio` (empirical 7d/5h cap ratio).
- `extras/windows/`: one-shot scheduled-task auto-resume after a hard cap.
