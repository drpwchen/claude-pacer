#!/usr/bin/env python3
"""Tests for usage_verdict.py (+ budget-guard.cjs reset clocks, + the shim).

Run from the repo:  python3 test_usage_verdict.py     (`python` on Windows)
Stdlib only; the budget-guard test is skipped when node is not installed.

Deployed layout (real usage_verdict.py in ~/.claude/scripts/ next to this test,
budget-guard.cjs + the shim renamed usage_verdict.py in one hooks folder): set
PACER_TEST_GUARD_DIR=<that hooks folder> to test the installed guard and shim in
place instead of the repo's copies.
"""
import atexit, json, os, shutil, subprocess, sys, tempfile, unittest, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "usage_verdict.py")
GUARD_DIR = os.environ.get("PACER_TEST_GUARD_DIR")
RESETS = int(datetime.datetime(2026, 10, 5, 14, 0).timestamp())  # local 14:00 in any TZ; window 09:00-14:00
DAY = datetime.datetime.fromtimestamp(RESETS).date()
TMP = tempfile.mkdtemp(prefix="pacer-test-")
atexit.register(shutil.rmtree, TMP, True)

# real limits-history.jsonl samples from 2026-10-05 (HH:MM:SS, pct)
REAL = """09:01:59 0|09:05:19 0|09:56:41 0|09:58:49 1|10:00:50 3|10:03:48 5|10:05:48 7|10:07:54 8|
10:12:42 10|10:14:46 11|10:17:22 11|10:19:42 11|10:25:05 12|10:27:14 12|10:30:22 12|10:32:22 12|
10:34:24 13|10:36:49 13|10:38:59 14|10:41:07 14|10:44:30 15|10:46:30 15|11:03:25 15|11:05:45 15|
11:19:40 14|11:23:07 16|11:29:30 16|11:34:07 16|11:37:32 16|11:39:32 17|11:45:04 17|11:47:17 18|
11:55:01 18|11:57:03 19|11:59:10 22|12:03:13 26|12:06:01 30|12:08:08 31|12:10:08 33|12:13:04 35|
12:15:05 36|12:17:07 37|12:20:02 37|12:22:04 38"""


def at(hms):
    h, m, s = (list(map(int, hms.split(":"))) + [0])[:3]
    return datetime.datetime.combine(DAY, datetime.time(h, m, s)).timestamp()


REAL_PTS = [(at(x.split()[0]), int(x.split()[1])) for x in REAL.replace("\n", "").split("|")]


def shim_path():
    """The shim to test: installed in place (PACER_TEST_GUARD_DIR), else the repo's
    extras/usage_verdict_shim.py dropped into a throwaway <tmp>/hooks/x/ + <tmp>/scripts/ layout."""
    if GUARD_DIR:
        return os.path.join(GUARD_DIR, "usage_verdict.py")
    src = os.path.join(HERE, "extras", "usage_verdict_shim.py")
    if not os.path.isfile(src):
        return None
    root = tempfile.mkdtemp(dir=TMP)
    os.makedirs(os.path.join(root, "hooks", "x"))
    os.makedirs(os.path.join(root, "scripts"))
    shutil.copy(SCRIPT, os.path.join(root, "scripts", "usage_verdict.py"))
    dst = os.path.join(root, "hooks", "x", "usage_verdict.py")
    shutil.copy(src, dst)
    return dst


GUARD = os.path.join(GUARD_DIR or HERE, "budget-guard.cjs")


def run(now, pct, pts, resets=RESETS, sd_resets=None, script=SCRIPT):
    d = tempfile.mkdtemp(dir=TMP)
    with open(os.path.join(d, "limits.json"), "w") as f:
        json.dump({"five_hour": {"used_percentage": pct, "resets_at": resets},
                   "seven_day": {"used_percentage": 30, "resets_at": sd_resets or resets + 5 * 86400}}, f)
    with open(os.path.join(d, "limits-history.jsonl"), "w") as f:
        for t, p in pts:
            f.write(json.dumps({"ts": int(t * 1000), "pct": p, "resets_at": resets}) + "\n")
    env = dict(os.environ, USAGE_VERDICT_NOW=str(now))
    r = subprocess.run([sys.executable, script, "--dir", d, "--json"], capture_output=True, text=True,
                       encoding="utf-8", env=env)
    txt = subprocess.run([sys.executable, script, "--dir", d], capture_output=True, text=True,
                         encoding="utf-8", env=env).stdout
    out = json.loads(r.stdout)
    out["code"], out["text"] = r.returncode, txt
    return out


def linear(start, end, p0, p1, step=120):
    n = int((end - start) // step)
    return [(start + i * step, round(p0 + (p1 - p0) * i / n)) for i in range(n + 1)]


class T(unittest.TestCase):
    def replay(self, hms):
        now = at(hms)
        pts = [x for x in REAL_PTS if x[0] <= now]
        return run(now, pts[-1][1], pts)

    def test_1_replay_1005(self):
        res = {h: self.replay(h) for h in ("12:16", "12:18", "12:21")}
        projs = []
        for h, o in res.items():
            self.assertEqual(o["verdict"], "GO", (h, o))
            p = o["projected_at_reset"]; projs.append(p)
            self.assertTrue(60 <= p <= 85, (h, p))
        self.assertLessEqual(max(projs) - min(projs), 10, projs)
        o = res["12:18"]
        self.assertLess(o["projected_at_reset"], 90)
        self.assertAlmostEqual(o["five_hour"]["pace"], 0.56, delta=0.02)
        print("\nreplay 12:16/12:18/12:21 projected =", projs)

    def test_2_steady_ahead(self):
        start = RESETS - 300 * 60; now = start + 150 * 60
        o = run(now, 60, linear(start, now, 0, 60))
        self.assertEqual(o["verdict"], "PACE")
        self.assertAlmostEqual(o["five_hour"]["pace"], 1.2, delta=0.02)
        self.assertAlmostEqual(o["projected_at_reset"], 120, delta=3)

    def _burst(self, pct):
        start = RESETS - 300 * 60; now = start + 120 * 60
        pts = linear(start, now - 1800, 0, pct - 45) + linear(now - 1800, now, pct - 45, pct)[1:]
        return run(now, pct, pts)

    def test_3_behind_but_burning(self):
        o = self._burst(35)  # pace 0.875
        self.assertEqual(o["verdict"], "GO", o)
        self.assertGreaterEqual(o["projected_at_reset"], 100)
        self.assertIn("recent burst", o["text"])
        o = self._burst(37)  # pace 0.925
        self.assertEqual(o["verdict"], "PACE", o)

    def test_4_hard_stop(self):
        o = run(RESETS - 3600, 94, [])
        self.assertEqual((o["verdict"], o["code"]), ("STOP", 2))

    def test_5_hard_near_reset(self):
        o = run(RESETS - 600, 94, [])
        self.assertEqual((o["verdict"], o["code"]), ("PACE", 1))

    def test_soft_pace(self):
        o = run(RESETS - 3600, 86, [])
        self.assertEqual(o["verdict"], "PACE")

    def test_6_already_reset(self):
        o = run(RESETS + 60, 80, [])
        self.assertEqual((o["verdict"], o["code"]), ("GO", 0))

    def test_7_too_few_samples(self):
        start = RESETS - 300 * 60; now = start + 120 * 60
        avg = round(30 + 30 / 120 * 180)
        o = run(now, 30, [(now - 300, 20), (now, 30)])  # 2 samples
        self.assertEqual(o["projected_at_reset"], avg)
        o = run(now, 30, [(now - 480, 10), (now - 300, 20), (now - 120, 25), (now, 30)])  # span 8 min
        self.assertEqual(o["projected_at_reset"], avg)

    def test_8_uneven_gap(self):
        now = at("12:17:30")
        pts = [x for x in REAL_PTS if x[0] <= now]
        a = run(now, 37, pts)["projected_at_reset"]
        b = run(now, 37, [x for x in pts if x[0] != at("11:47:17")])["projected_at_reset"]
        self.assertLessEqual(abs(a - b), 5, (a, b))

    def test_9_early_window_no_pace(self):
        # 1%/1 min would project 300% — the first 20 min must not PACE on projection alone
        start = RESETS - 300 * 60
        for pct, mins in ((1, 1), (2, 5), (4, 10)):
            now = start + mins * 60
            o = run(now, pct, linear(start, now, 0, pct, step=30) if mins > 1 else [(now, pct)])
            self.assertEqual((o["verdict"], o["code"]), ("GO", 0), (pct, mins, o))
            self.assertGreaterEqual(o["projected_at_reset"], 100, (pct, mins))
            self.assertIn("not acted on yet", o["text"])
        o = run(start + 10 * 60, 86, [])  # soft threshold still rules early
        self.assertEqual(o["verdict"], "PACE")
        o = run(start + 25 * 60, 10, [])  # past 20 min the projection counts again
        self.assertEqual(o["verdict"], "PACE", o)

    def test_10_clock_date(self):
        # same day as now -> HH:MM; other day -> MM-DD HH:MM (5h and 7d alike)
        o = run(RESETS - 3600, 30, [])
        self.assertEqual(o["five_hour"]["resets_at"], "14:00")
        self.assertIn("(resets 10-10 14:00)", o["text"])
        self.assertIn("(resets 10-10 14:00)", o["seven_day"]["note"])
        late = RESETS + 11 * 3600  # 01:00 next day; now = 23:00 on 10-05
        o = run(late - 2 * 3600, 30, [], resets=late, sd_resets=late + 86400)
        self.assertEqual(o["five_hour"]["resets_at"], "10-06 01:00")
        self.assertIn("(resets 10-07 01:00)", o["text"])
        o = run(RESETS - 3600, 30, [], sd_resets=RESETS + 6 * 3600)  # 7d at 20:00 the same day
        self.assertIn("(resets 20:00)", o["text"])

    def test_11_7d_survives_200_char_cut(self):
        # callers that keep only line[:200] must still get the dated 7d note
        o = self._burst(35)
        self.assertIn("recent burst", o["text"])
        self.assertIn("[7d: 7d 30% (resets 10-10 14:00)", o["text"][:200])

    def test_12_shim_same_as_canonical(self):
        shim = shim_path()
        if not shim:
            self.skipTest("extras/usage_verdict_shim.py not found")
        start = RESETS - 300 * 60; now = start + 150 * 60
        pts = linear(start, now, 0, 60)
        a, b = run(now, 60, pts), run(now, 60, pts, script=shim)
        self.assertEqual((a["code"], a["text"]), (b["code"], b["text"]))
        if not GUARD_DIR:  # target missing -> NO-DATA + exit 3, never a traceback
            root = os.path.dirname(os.path.dirname(os.path.dirname(shim)))
            os.remove(os.path.join(root, "scripts", "usage_verdict.py"))
            r = subprocess.run([sys.executable, shim], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 3)
            self.assertTrue(r.stdout.startswith("NO-DATA"), r.stdout)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_13_budget_guard_dated_clock(self):
        # budget-guard.cjs: 5h/7d reset clocks get MM-DD when not on the same day as now
        if not os.path.isfile(GUARD):
            self.skipTest("budget-guard.cjs not found")

        def guard_msg(now, pct, resets, sd_resets):
            d = tempfile.mkdtemp(dir=TMP)
            with open(os.path.join(d, "limits.json"), "w") as f:
                json.dump({"ts": int(now * 1000), "five_hour": {"used_percentage": pct, "resets_at": resets},
                           "seven_day": {"used_percentage": 96, "resets_at": sd_resets}}, f)
            r = subprocess.run(["node", GUARD, "--dir", d], input='{"session_id":"t"}', capture_output=True,
                               text=True, encoding="utf-8", env=dict(os.environ, USAGE_VERDICT_NOW=str(now)))
            return json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]

        late = RESETS + 11 * 3600  # 10-06 01:00; now = 10-05 22:30
        m = guard_msg(late - 150 * 60, 86, late, late + 3 * 86400)  # soft
        self.assertIn("at 10-06 01:00)", m)
        self.assertIn("7d 96% (resets 10-09 01:00)", m)
        m = guard_msg(late - 150 * 60, 94, late, late + 3 * 86400)  # hard wrap-up
        self.assertIn("resets in 150min, at 10-06 01:00)", m)
        self.assertIn("a few minutes AFTER 10-06 01:00", m)
        m = guard_msg(RESETS - 3600, 86, RESETS, RESETS + 6 * 3600)  # 13:00 -> 14:00 / 20:00 same day
        self.assertIn("at 14:00)", m)
        self.assertIn("7d 96% (resets 20:00)", m)


if __name__ == "__main__":
    unittest.main(verbosity=2)
