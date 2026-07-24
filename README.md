# claude-pacer

A statusline + budget guard + pacing verdict for Claude Code usage limits.

[繁體中文說明 → README.zh-TW.md](README.zh-TW.md)

```
Refactor auth middleware │ 5h ▓▓▓┃░░░ 42%·2h13m │ 7d ▓▓▓▓┃▓░ 71%·3d2h │ Ctx ▓▓░░░░ 34% │ Fable 5·high
Refactor a…│5h▓▓░░42%│7d▓▓▓░71%│Ctx34%│Fable5·hi      ← same line on a narrow terminal
```

There are many great Claude Code statuslines out there —
[ccusage](https://github.com/ccusage/ccusage),
[ccstatusline](https://github.com/sirmalloc/ccstatusline),
[CCometixLine](https://github.com/Haleclipse/CCometixLine),
[cc-statusline](https://github.com/chongdashu/cc-statusline),
[claude-powerline](https://github.com/Owloops/claude-powerline), … —
use whichever you like. This one exists
because a statusline alone never stopped an autonomous agent from blowing
through a rate limit at 2 AM. claude-pacer is three layers that share one data
file:

1. **`statusline.cjs`** — what *you* see: 5h / 7d usage, context-window
   fullness, optional conversation topic. Numbers or bars.
2. **`budget-guard.cjs`** — what *Claude* sees: a hook that injects wrap-up
   instructions into the model's context at 85% / 93% usage, so long
   autonomous runs wind down gracefully instead of dying mid-task.
3. **`usage_verdict.py`** — what *agents* should run instead of interpreting
   raw numbers: a one-line GO / PACE / STOP verdict that encodes the reset
   arithmetic agents keep getting wrong.

## Why this exists

It started with overnight runs dying mid-task: hand Claude Code a long
autonomous job, go to bed, and find it cut off at 2 AM by the 5-hour usage
window — context stranded, work half-done. The guard + verdict layers exist
so that never happens silently again: Claude winds down before the cap,
saves its state, and schedules its own resume after the window resets.

The statusline then fixes the small daily frictions of heavy multi-session
use:

- **"Which conversation is this again?"** — the topic segment names each
  session when you're juggling several at once.
- **"How much runway do I have?"** — usage bars with an elapsed-time marker
  show at a glance whether you're burning faster than the clock.
- **"Wait, which model am I on?"** — model + reasoning effort sit at the far
  right, so you notice *before* spending premium-model quota on a trivial
  task you forgot to switch back for.
- **"How close is compaction?"** — the context gauge warns you before a
  surprise compact eats your conversation state.

## Install

Works on Windows, macOS, and Linux. Requires Node.js (statusline + guard) and
Python 3 (verdict, optional).

```bash
git clone https://github.com/drpwchen/claude-pacer.git
```

In `~/.claude/settings.json`:

```jsonc
{
  "statusLine": {
    "command": "node /path/to/claude-pacer/statusline.cjs"
  },
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "node /path/to/claude-pacer/budget-guard.cjs" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command",
      "command": "node /path/to/claude-pacer/budget-guard.cjs" }] }]
  }
}
```

The statusline works on its own; add the hooks only if you want the guard.
Usage percentages come from Claude Code's `rate_limits` statusline data, which
exists on Pro/Max subscriptions (API-key billing has no such windows).

Preview both display modes without touching your config:

```bash
node statusline.cjs --demo
```

## Reading the statusline

| Segment | Meaning |
|---|---|
| `Ctx 34%` | Context window fullness (how close you are to compaction) |
| `5h 42%` | 5-hour usage window, percent used |
| `2h13m left` | Time until this window resets |
| `t58%` | Percent of the window's *time* already elapsed — if usage% > time%, you're burning faster than the clock |
| `7d …` | Same three readings for the 7-day window |
| `Fable 5·high` | Current model and reasoning effort |

In bar mode the `┃` marker is the elapsed-time position, inserted *between*
bar cells (it never eats a fill cell, so the filled proportion always reads
true): filled bar past the marker = burning faster than the clock. Compact
tiers drop the marker — a 4-cell bar is too coarse for it.

Colors: green < 70% ≤ yellow < 90% ≤ red.

The line is **responsive**: it renders full-width first, and if that doesn't
fit the terminal it degrades step by step — full with a shorter topic, then
compact (4-cell bars paired with *time remaining*, since the bar already
shows usage), then percentages only.
Terminal width comes from the `$COLUMNS` env var, which Claude Code sets for
the statusline process since v2.1.153 (fallbacks: `process.stdout.columns`,
then probing the attached console — `mode con` on Windows, `stty size
</dev/tty` elsewhere — cached 15 s). If width can't be determined the line
stays **full** — it never degrades on a guess. `"width"` in config.json overrides detection, and
`"tier"` (`"full"` / `"compact"` / `"minimal"`) pins a layout outright.

## Configuration

Settings live in `~/.claude/claude-pacer/config.json` (created by you; see
[config.example.json](config.example.json)). CLI flags override the file.

| Key | Default | Flag | Meaning |
|---|---|---|---|
| `display` | `"bar"` | `--bar` / `--number` | Bar gauges vs percent numbers |
| `topic` | `true` | `--topic` / `--no-topic` | Show conversation topic |
| `context` | `true` | `--context` / `--no-context` | Show context-window segment |
| `labels` | `"en"` | — | `"zh"` renders 剩/時 labels |
| `model` | `true` | — | Show model + reasoning effort (rightmost) |
| `topic_chars` | `20` | — | Topic truncation length |
| `bar_width` | `6` | — | Bar width in characters |
| `width` | `null` (auto) | `--width N` | Terminal columns for the responsive layout; unknown = stay full |
| `tier` | `"auto"` | `--tier T` | Pin a layout: `full` / `compact` / `minimal` |

State dir override (all three scripts): `--dir <path>` or `$CLAUDE_PACER_DIR`.

### Topic mode

On by default (`"topic": false` or `--no-topic` to hide it). The topic is
resolved in priority order:

1. **Session title** — Claude Code's own AI-generated/renamed session name
   (`/rename` or automatic), the most accurate description of the session;
2. **Transcript summary** — the summary Claude Code writes on compaction;
3. **First user prompt** — fallback for brand-new sessions.

CJK titles get their spaces stripped (they read fine without them and the
saved columns matter on narrow screens).

## budget-guard

A hook on `UserPromptSubmit` + `PostToolUse` (so it also fires mid-turn during
long autonomous runs). Reads `limits.json` written by the statusline.

- **soft (85%)**: tells Claude to finish in-flight work and start nothing big.
- **hard (93%)**: tells Claude to wrap up NOW, schedule a one-shot resume a few
  minutes after the window resets, report to the user, and end the turn.
- Warnings are **per-session and re-arm every 10 min**, so every concurrently
  running session/agent hears them — not just the first one.
- Silent when the window has already reset (stale-high data can't false-fire).
- **Pace mode (opt-in)**: create `<state-dir>/pace.json` with
  `{"on": true, "agents": 5}` to get a periodic usage line injected even below
  the thresholds — useful when a dispatcher is pacing a fleet of subagents.
  Delete the file when the run ends.

Thresholds and intervals are in the `guard` section of `config.json`.

## usage_verdict.py

```
$ python3 usage_verdict.py     # `python` on Windows
GO — 5h at 42%, 133 min left, projected ~61% at reset — headroom available, can dispatch more. [7d: 71% — not near cap, ignore] (...)
```

Exit codes: 0 = GO, 1 = PACE, 2 = STOP, 3 = no data. `--json` for machine use.

Why a script instead of just reading the numbers? Three mistakes agents (and
humans) make constantly:

1. **Reset arithmetic** — `limits.json` only refreshes when a statusline
   renders. After a reset it still shows the old 90-something %. If
   `now > resets_at`, usage is ~0%; no need to spend tokens "verifying".
2. **7d false alarms** — a high 7d % is meaningless when the 7d window resets
   *before* the current 5h window ends. The verdict ignores it for you.
3. **Burn projection** — linear projection from recent samples is a *lower
   bound* under bursty multi-agent dispatch, so the hard STOP threshold rules.

`--ratio` estimates your plan's 7d/5h cap ratio empirically from collected
history — useful for planning multi-day batch jobs (the two windows are
officially independent; no published conversion exists).

## Auto-resume after a hard cap (extras)

When the hard guard fires and the terminal must close, Claude writes a
`handoff.md` and schedules `claude -p` to continue the work a few minutes
after the window resets:

- **Windows** — `extras/windows/` registers a one-shot Scheduled Task
  (survives terminal exit and logout). Adapt the working-directory line
  before use.
- **macOS / Linux** — `extras/unix/schedule-resume.sh` arms a `nohup` timer
  (survives the terminal closing; for logout/reboot resilience register the
  same command with `at`, cron, or launchd instead).

## Files written

Everything lives in the state dir (default `~/.claude/claude-pacer/`):
`limits.json` (latest window snapshot), `limits-history.jsonl` (burn-rate
samples, ~2 min interval, auto-trimmed at 256 KB), `topics.json` (topic cache),
`guard-state.json`, and your `config.json` / `pace.json`. Nothing leaves your
machine; there are no network calls anywhere.

## License

MIT
