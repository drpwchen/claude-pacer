#!/usr/bin/env python3
"""usage_verdict.py — THE canonical way to interpret Claude Code usage limits.

Reads <state-dir>/limits.json (written by statusline.cjs) and prints a one-line
verdict: GO / PACE / STOP, with reasoning. Never interpret limits.json raw
numbers yourself — this script encodes the arithmetic that agents keep getting
wrong:

  1. Reset arithmetic: if now > resets_at the window HAS reset — usage is ~0%
     even though the file still shows the old high number (the file only updates
     when a statusline renders, i.e. after someone types).
  2. 7d false alarms: a high 7d% is IGNORED when the 7d window resets before the
     current 5h window ends — it cannot constrain anything you do now.
  3. Burn-rate projection (multi-agent aware): projects end-of-window usage from
     recent samples; bursty dispatch makes this a lower bound, so the hard STOP
     threshold still rules.

State dir: --dir <path> > $CLAUDE_PACER_DIR > ~/.claude/claude-pacer

Usage:  python usage_verdict.py [--json] [--dir <path>]
        python usage_verdict.py --ratio   # estimate 7d/5h cap ratio
Exit codes: 0=GO, 1=PACE, 2=STOP, 3=no data.

--ratio: empirically estimates cap_7d/cap_5h from limits-history.jsonl. Both
windows count the same (model-weighted) consumption C, so over an interval
with no resets: d5h = C/cap_5h, d7d = C/cap_7d -> ratio = sum(d5h)/sum(d7d),
summed across all clean intervals to beat integer-percentage quantization.
The ratio is plan-dependent and can change when Anthropic adjusts limits —
re-estimate periodically, never treat as a permanent constant.
"""
import json, os, sys, time, datetime

if "--dir" in sys.argv:
    DIR = sys.argv[sys.argv.index("--dir") + 1]
else:
    DIR = os.environ.get("CLAUDE_PACER_DIR") or os.path.expanduser("~/.claude/claude-pacer")
LIMITS = os.path.join(DIR, "limits.json")
HISTORY = os.path.join(DIR, "limits-history.jsonl")
CONFIG = os.path.join(DIR, "config.json")

SOFT, HARD = 85, 93
try:
    cfg = json.load(open(CONFIG))
    cfg = cfg.get("guard", cfg)
    SOFT = cfg.get("soft_pct", SOFT); HARD = cfg.get("hard_pct", HARD)
except Exception:
    pass


def clock(ts):
    return datetime.datetime.fromtimestamp(ts).strftime("%H:%M")


def estimate_ratio():
    """cap_7d/cap_5h from paired deltas in history; needs heavy-usage days to converge."""
    groups = {}  # (resets_at, sd_resets) -> [samples]
    try:
        with open(HISTORY) as f:
            for line in f:
                try:
                    s = json.loads(line)
                except Exception:
                    continue
                if s.get("pct") is None or s.get("sd_pct") is None:
                    continue
                groups.setdefault((s.get("resets_at"), s.get("sd_resets")), []).append(s)
    except FileNotFoundError:
        print("NO-DATA: no limits-history.jsonl yet.")
        return 3
    d5, d7, spans = 0.0, 0.0, 0
    for key, ss in groups.items():
        if None in key or len(ss) < 2:
            continue
        ss.sort(key=lambda s: s["ts"])
        a, b = ss[0], ss[-1]
        if b["pct"] >= a["pct"] and b["sd_pct"] >= a["sd_pct"]:
            d5 += b["pct"] - a["pct"]
            d7 += b["sd_pct"] - a["sd_pct"]
            spans += 1
    if d7 < 5:
        print("INSUFFICIENT DATA: accumulated 7d delta only %.0f%% across %d window-pairs "
              "(need >=5%% to beat integer rounding; total 5h delta so far %.0f%%). "
              "Keep collecting — heavy-usage days converge fastest." % (d7, spans, d5))
        return 3
    ratio = d5 / d7
    duty = ratio / 33.6  # 33.6 five-hour windows per week
    conf = "rough" if d7 < 15 else "decent" if d7 < 40 else "good"
    print("cap_7d/cap_5h ~= %.1f  (from sum d5h=%.0f%% / d7d=%.0f%% over %d window-pairs; confidence: %s)\n"
          "-> at sustained full burn, the weekly cap supports ~%.1f full 5h windows (~%.0f%% duty cycle).\n"
          "Plan-dependent snapshot — re-estimate after any Anthropic limit change."
          % (ratio, d5, d7, spans, conf, ratio, duty * 100))
    return 0


def main():
    if "--ratio" in sys.argv:
        return estimate_ratio()
    as_json = "--json" in sys.argv
    now = time.time()
    try:
        d = json.load(open(LIMITS))
    except Exception:
        print("NO-DATA: limits.json unreadable — no statusline has rendered yet. "
              "Treat as unknown; do NOT invent numbers.")
        return 3

    out = {"now": clock(now)}
    fh = d.get("five_hour") or {}
    pct, resets = fh.get("used_percentage"), fh.get("resets_at")

    # ---- 5h window ----
    if pct is None or not resets:
        print("NO-DATA: limits.json has no five_hour block.")
        return 3
    if now >= resets:
        out["five_hour"] = {"state": "RESET", "note": "window reset at %s; stale file still shows %d%%" % (clock(resets), pct)}
        out["verdict"] = "GO"
        line = ("GO — 5h window ALREADY RESET at %s (the %d%% in limits.json is stale pre-reset data; "
                "actual usage ~0%%). Fresh numbers appear after the next interactive turn. Full window available."
                % (clock(resets), pct))
        print(json.dumps(out) if as_json else line)
        return 0

    remain_min = int((resets - now) / 60)
    out["five_hour"] = {"pct": pct, "resets_at": clock(resets), "remain_min": remain_min}

    # ---- 7d window ----
    sd = d.get("seven_day") or {}
    sd_pct, sd_resets = sd.get("used_percentage"), sd.get("resets_at")
    sd_note = None
    sd_binding = False
    if sd_pct is not None and sd_resets:
        if now >= sd_resets:
            sd_note = "7d window already reset (%s) — stale number, ignore" % clock(sd_resets)
        elif sd_resets <= resets:
            sd_note = ("7d %d%% but it resets at %s, BEFORE the current 5h window ends (%s) — "
                       "NOT a constraint, IGNORE it" % (sd_pct, clock(sd_resets), clock(resets)))
        else:
            sd_binding = sd_pct >= 95
            sd_note = "7d %d%% (resets %s)%s" % (
                sd_pct, clock(sd_resets),
                " — BINDING, near cap" if sd_binding else " — not near cap, ignore")
    out["seven_day"] = {"note": sd_note, "binding": sd_binding}

    # ---- burn-rate projection from history (last 30 min inside this window) ----
    projected = None
    try:
        window_start = resets - 5 * 3600
        samples = []
        with open(HISTORY) as f:
            for line in f:
                try:
                    s = json.loads(line)
                except Exception:
                    continue
                if s.get("ts", 0) / 1000 >= max(window_start, now - 1800) and s.get("pct") is not None:
                    samples.append(s)
        if len(samples) >= 2:
            t0, p0 = samples[0]["ts"] / 1000, samples[0]["pct"]
            t1, p1 = samples[-1]["ts"] / 1000, samples[-1]["pct"]
            if t1 - t0 >= 600 and p1 >= p0:
                slope = (p1 - p0) / ((t1 - t0) / 60)  # %/min
                projected = round(pct + slope * remain_min)
                out["projected_at_reset"] = projected
    except Exception:
        pass

    # ---- verdict ----
    if pct >= HARD:
        verdict, code = "STOP", 2
        why = "5h at %d%% ≥ hard %d%% — wrap up now, schedule one-shot resume after %s" % (pct, HARD, clock(resets))
    elif pct >= SOFT or (projected is not None and projected >= 100):
        verdict, code = "PACE", 1
        why = "5h at %d%%" % pct
        if pct < SOFT:
            why += " but projected ~%d%% at reset" % projected
        why += " — finish in-flight work, dispatch new waves cautiously"
    else:
        verdict, code = "GO", 0
        why = "5h at %d%%, %d min left" % (pct, remain_min)
        if projected is not None:
            why += ", projected ~%d%% at reset" % projected
            if projected < 90:
                why += " — headroom available, can dispatch more"
        else:
            why += " — headroom available"
    if sd_binding:
        why += ". CAUTION: 7d is binding (%s)" % sd_note

    out["verdict"] = verdict
    line = "%s — %s. [7d: %s] (projection is a lower bound under bursty multi-agent dispatch; %d%% STOP still rules)" % (
        verdict, why, sd_note or "no data", HARD)
    print(json.dumps(out) if as_json else line)
    return code


if __name__ == "__main__":
    sys.exit(main())
