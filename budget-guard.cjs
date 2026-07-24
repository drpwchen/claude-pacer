#!/usr/bin/env node
'use strict';
// claude-pacer budget-guard — injects wrap-up instructions into Claude's context
// when the 5h rate-limit window is nearly exhausted. Register on UserPromptSubmit
// and PostToolUse (so it also fires mid-turn during long autonomous runs).
// Data source: limits.json written by statusline.cjs.
//
// Design notes:
//  - dedup is per-session + re-arms every rearm_min, so EVERY concurrently
//    running session/agent hears the warning, not just the first one
//  - reset arithmetic: past resets_at → window is fresh, stay silent
//  - opt-in pace mode (pace.json) injects a periodic status line even below
//    the soft threshold; absent = only the soft/hard safety net fires

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
function argValue(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }

const HOME = process.env.HOME || process.env.USERPROFILE;
const DIR = argValue('--dir') || process.env.CLAUDE_PACER_DIR || path.join(HOME, '.claude', 'claude-pacer');
const LIMITS_FILE = path.join(DIR, 'limits.json');
const STATE_FILE = path.join(DIR, 'guard-state.json');
const CONFIG_FILE = path.join(DIR, 'config.json');
const PACE_FILE = path.join(DIR, 'pace.json');

const DEFAULTS = { soft_pct: 85, hard_pct: 93, stale_min: 15, rearm_min: 10, pace_interval_min: 15, resume_hint: null };
// usage_verdict.py ships next to this file; macOS/Linux usually have no bare `python`
const PY = process.platform === 'win32' ? 'python' : 'python3';
const VERDICT_CMD = `${PY} "${path.join(__dirname, 'usage_verdict.py')}"`;

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fallback; }
}

function emit(input, msg) {
  const event = input.hook_event_name || 'UserPromptSubmit';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: msg }
  }));
}

function sevenDayNote(limits, fiveResets, now) {
  const sd = limits.seven_day;
  if (!sd || typeof sd.used_percentage !== 'number' || !sd.resets_at) return null;
  const pct = Math.round(sd.used_percentage);
  const clock = new Date(sd.resets_at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (now / 1000 >= sd.resets_at) return `7d already reset — ignore`;
  if (sd.resets_at <= fiveResets) return `7d ${pct}% but resets ${clock}, before this 5h window ends — IGNORE, not a constraint`;
  if (pct >= 95) return `7d ${pct}% (resets ${clock}) — binding, near cap`;
  return `7d ${pct}% — not near cap, ignore`;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf-8')); } catch { return; }
  const fileCfg = readJson(CONFIG_FILE, {});
  const cfg = Object.assign({}, DEFAULTS, fileCfg.guard || fileCfg);
  const limits = readJson(LIMITS_FILE, null);
  if (!limits || !limits.five_hour) return;
  const now = Date.now();
  if (now - limits.ts > cfg.stale_min * 60 * 1000) return; // stale data, stay silent

  const pct = limits.five_hour.used_percentage;
  const resetsAt = limits.five_hour.resets_at;
  if (typeof pct !== 'number' || !resetsAt) return;
  if (now >= resetsAt * 1000) return; // window already reset — old % is meaningless

  const sid = input.session_id || 'unknown';
  const state = readJson(STATE_FILE, {});
  if (state.resets_at !== resetsAt) { state.resets_at = resetsAt; state.sessions = {}; }
  state.sessions = state.sessions || {};
  const ss = state.sessions[sid] = state.sessions[sid] || {};

  const remainMin = Math.max(0, Math.round((resetsAt * 1000 - now) / 60000));
  const resetClock = new Date(resetsAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sdNote = sevenDayNote(limits, resetsAt, now);

  let level = null;
  if (pct >= cfg.hard_pct) level = 'hard';
  else if (pct >= cfg.soft_pct) level = 'soft';

  // ---- pace mode: periodic status line even below thresholds (opt-in) ----
  const pace = readJson(PACE_FILE, null);
  if (!level && pace && pace.on) {
    if (ss.pace_ts && now - ss.pace_ts < cfg.pace_interval_min * 60 * 1000) return;
    ss.pace_ts = now;
    save(state);
    const agents = pace.agents ? ` ~${pace.agents} concurrent agents share this pool (global % moves that much faster than any one of you).` : '';
    emit(input, `[pace] 5h ${Math.round(pct)}% · ${remainMin}min left (resets ${resetClock}). [${sdNote || '7d: no data'}]${agents} ` +
      `Pacing is the DISPATCHER's job: workers finish their assigned unit at full quality and do NOT self-throttle. ` +
      `Dispatcher: between waves run \`${VERDICT_CMD}\` (GO/PACE/STOP) — never interpret limits.json yourself.`);
    return;
  }
  if (!level) return;

  // ---- soft/hard safety net: per-session, re-arms every rearm_min ----
  ss.warned = ss.warned || {};
  if (ss.warned[level] && now - ss.warned[level] < cfg.rearm_min * 60 * 1000) return;
  ss.warned[level] = now;
  save(state);

  let msg;
  if (level === 'soft') {
    msg = `[budget-guard] 5h usage at ${Math.round(pct)}% (resets in ${remainMin}min, at ${resetClock}). [${sdNote || ''}] ` +
      `Start winding down: finish in-flight work, avoid starting new large/token-heavy work in this window. ` +
      `If you are a subagent/worker: complete your assigned unit at full quality — pacing is the dispatcher's decision, not yours. ` +
      `Dispatcher: run \`${VERDICT_CMD}\` before dispatching another wave. Briefly tell the user usage is at ${Math.round(pct)}%.`;
  } else {
    const headlessFallback = cfg.resume_hint
      ? `(3) ONLY if the terminal will close: write remaining tasks + resume instructions to ${path.join(DIR, 'handoff.md')}, then run ${cfg.resume_hint}. `
      : `(3) ONLY if the terminal will close: write remaining tasks + resume instructions to ${path.join(DIR, 'handoff.md')} and tell the user to restart after ${resetClock}. `;
    msg = `[budget-guard] 5h usage at ${Math.round(pct)}% — WRAP UP NOW (resets in ${remainMin}min, at ${resetClock}). ` +
      `(1) Minimal completion of the current step (commit/save state), start nothing new. ` +
      `(2) Session staying open (default): schedule a ONE-SHOT reminder/cron for a few minutes AFTER ${resetClock} ` +
      `(in Claude Code: CronCreate via ToolSearch "select:CronCreate", recurring:false), prompt: ` +
      `"The 5h limit window reset at ${resetClock} — treat usage as fresh (~0%), do NOT spend tokens re-verifying limits (limits.json will look stale-high until the next statusline render), continue the task from this session's context." ` +
      `No handoff file needed when the session stays open. ` +
      headlessFallback +
      `(4) Tell the user: usage %, reset time, which resume layer is armed. Then END THE TURN. Do NOT keep working past this point.`;
  }
  emit(input, msg);
}

function save(state) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

try { main(); } catch {}
