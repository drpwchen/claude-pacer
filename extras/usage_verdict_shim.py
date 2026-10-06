#!/usr/bin/env python3
"""Thin wrapper — runs the one real usage_verdict.py in ~/.claude/scripts/.

Optional. budget-guard.cjs tells agents to run the usage_verdict.py next to it.
If you also want the verdict at a shared path (other tools, dispatchers, a
second machine syncing ~/.claude), install the real file as
~/.claude/scripts/usage_verdict.py and copy THIS file next to budget-guard.cjs
as usage_verdict.py, with budget-guard in ~/.claude/hooks/<folder>/. The target
is resolved relative to this file (../../scripts/), so it works on every OS and
machine with that layout. Edit the real file, never this one. Same args,
output, exit code.
"""
import os, runpy, sys

CANON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "usage_verdict.py")
if not os.path.isfile(CANON):
    print("NO-DATA: canonical usage_verdict.py missing at %s — treat as unknown." % os.path.normpath(CANON))
    sys.exit(3)
runpy.run_path(CANON, run_name="__main__")
