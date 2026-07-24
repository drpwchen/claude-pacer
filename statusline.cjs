#!/usr/bin/env node
'use strict';
// claude-pacer statusline — usage / context / topic statusline for Claude Code.
// Shows: [topic] | context window % | 5h usage | 7d usage, as numbers or bars.
// Side effect: persists limits.json + limits-history.jsonl for budget-guard.cjs
// and usage_verdict.py.
//
// Config: <state-dir>/config.json (see config.example.json). CLI flags override.
// State dir: --dir <path> > $CLAUDE_PACER_DIR > ~/.claude/claude-pacer

const fs = require('fs');
const path = require('path');

// ---------- args / config ----------
const argv = process.argv.slice(2);
function hasFlag(f) { return argv.includes(f); }
function argValue(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }

const HOME = process.env.HOME || process.env.USERPROFILE;
const DIR = argValue('--dir') || process.env.CLAUDE_PACER_DIR || path.join(HOME, '.claude', 'claude-pacer');
const LIMITS_FILE = path.join(DIR, 'limits.json');
const HISTORY_FILE = path.join(DIR, 'limits-history.jsonl');
const TOPIC_CACHE = path.join(DIR, 'topics.json');

const DEFAULTS = {
  display: 'bar',      // 'bar' | 'number'
  topic: true,         // show conversation topic (session title / summary / first prompt)
  context: true,       // show context-window fullness
  labels: 'en',        // 'en' | 'zh'
  topic_chars: 24,
  bar_width: 8,
};
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fb; } }
const cfg = Object.assign({}, DEFAULTS, readJson(path.join(DIR, 'config.json'), {}));
if (hasFlag('--bar')) cfg.display = 'bar';
if (hasFlag('--number')) cfg.display = 'number';
if (hasFlag('--topic')) cfg.topic = true;
if (hasFlag('--no-topic')) cfg.topic = false;
if (hasFlag('--context')) cfg.context = true;
if (hasFlag('--no-context')) cfg.context = false;

// ---------- rendering helpers ----------
const RESET = '\x1b[0m', DIM = '\x1b[2m', BOLD = '\x1b[1m';
const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31;1m', CYAN = '\x1b[36m';

function pctColor(p) { return p >= 90 ? RED : p >= 70 ? YELLOW : GREEN; }

function fmtDur(ms) {
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(mm).padStart(2, '0')}m`;
  return `${mm}m`;
}

// Usage bar with an optional elapsed-time marker (┃): if the filled part has
// passed the marker you are burning faster than the clock.
function bar(pct, timePct) {
  const w = cfg.bar_width;
  const filled = Math.max(0, Math.min(w, Math.round(pct / 100 * w)));
  const marker = typeof timePct === 'number'
    ? Math.max(0, Math.min(w - 1, Math.floor(timePct / 100 * w))) : -1;
  let out = '';
  for (let i = 0; i < w; i++) {
    if (i === marker) out += '┃';                       // normal color, stands out on both zones
    else if (i < filled) out += `${pctColor(pct)}▓${RESET}`;
    else out += `${DIM}░${RESET}`;
  }
  return out;
}

function windowPart(label, win, windowMs, now) {
  if (!win || typeof win.used_percentage !== 'number') return `${DIM}${label} –${RESET}`;
  const pct = Math.round(win.used_percentage);
  const remainMs = win.resets_at * 1000 - now;
  const timePct = Math.max(0, Math.min(100, Math.round(100 * (1 - remainMs / windowMs))));
  const c = pctColor(pct);
  if (cfg.display === 'bar') {
    return `${BOLD}${label}${RESET} ${bar(pct, timePct)} ${c}${pct}%${RESET}${DIM}·${fmtDur(remainMs)}${RESET}`;
  }
  const zh = cfg.labels === 'zh';
  const rem = zh ? `剩${fmtDur(remainMs)}` : `${fmtDur(remainMs)} left`;
  const t = zh ? `時${timePct}%` : `t${timePct}%`;
  return `${BOLD}${label}${RESET} ${c}${pct}%${RESET}${DIM}·${rem}·${t}${RESET}`;
}

function contextPart(cw) {
  let pct = cw && typeof cw.used_percentage === 'number' ? cw.used_percentage : null;
  if (pct === null && cw && cw.current_usage && cw.context_window_size) {
    const u = cw.current_usage;
    const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    pct = 100 * used / cw.context_window_size;
  }
  if (pct === null) return `${DIM}Ctx –${RESET}`;
  pct = Math.round(pct);
  if (cfg.display === 'bar') return `${BOLD}Ctx${RESET} ${bar(pct, null)} ${pctColor(pct)}${pct}%${RESET}`;
  return `${BOLD}Ctx${RESET} ${pctColor(pct)}${pct}%${RESET}`;
}

// ---------- topic ----------
// Priority: session_name (Claude Code's own AI-generated/renamed title)
//         > latest summary entry in the transcript (written on compaction)
//         > first real user prompt (fallback; re-checked every 5 min for upgrades)
function truncate(text) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.slice(0, cfg.topic_chars).join('') + (chars.length > cfg.topic_chars ? '…' : '');
}

function extractFromTranscript(transcriptPath) {
  let head = '', tail = '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    head = buf.toString('utf-8', 0, n);
    if (size > buf.length) {
      const n2 = fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
      tail = buf.toString('utf-8', 0, n2);
    }
    fs.closeSync(fd);
  } catch { return null; }
  let summary = null, firstPrompt = null;
  for (const chunk of [head, tail]) {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'summary' && typeof obj.summary === 'string' && obj.summary.trim()) {
        summary = obj.summary; // keep the last one seen
        continue;
      }
      if (firstPrompt || obj.type !== 'user' || obj.isMeta) continue;
      const c = obj.message && obj.message.content;
      let text = null;
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        const t = c.find(p => p.type === 'text' && typeof p.text === 'string');
        if (t) text = t.text;
      }
      if (!text) continue;
      if (/<command-name>|<local-command|<system-reminder|^Caveat:/m.test(text)) continue;
      if (!text.trim()) continue;
      firstPrompt = text;
    }
  }
  if (summary) return { topic: truncate(summary), src: 'summary' };
  if (firstPrompt) return { topic: truncate(firstPrompt), src: 'prompt' };
  return null;
}

function getTopic(input) {
  if (typeof input.session_name === 'string' && input.session_name.trim()) {
    return truncate(input.session_name);
  }
  const sid = input.session_id;
  if (!sid || !input.transcript_path) return null;
  const cache = readJson(TOPIC_CACHE, {});
  const hit = cache[sid];
  // summary topics are final; prompt-derived ones re-check every 5 min for a summary upgrade
  if (hit && hit.topic && (hit.src === 'summary' || Date.now() - hit.ts < 5 * 60 * 1000)) return hit.topic;
  const found = extractFromTranscript(input.transcript_path);
  if (found) {
    cache[sid] = { topic: found.topic, src: found.src, ts: Date.now() };
    const cutoff = Date.now() - 48 * 3600 * 1000;
    for (const k of Object.keys(cache)) if (cache[k].ts < cutoff) delete cache[k];
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(TOPIC_CACHE, JSON.stringify(cache)); } catch {}
    return found.topic;
  }
  return hit && hit.topic || null;
}

// ---------- persistence for budget-guard / usage_verdict ----------
function persist(rl, model, now) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const data = JSON.stringify({ ts: now, five_hour: rl.five_hour || null, seven_day: rl.seven_day || null });
    const tmp = path.join(DIR, `limits.${process.pid}.tmp`);
    fs.writeFileSync(tmp, data);
    try { fs.renameSync(tmp, LIMITS_FILE); }
    catch { // Windows rename-over-locked-file can fail — write direct, drop the tmp
      try { fs.writeFileSync(LIMITS_FILE, data); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
    }
  } catch {}
  try { // burn-rate sample, throttled to ~1 per 2 min, auto-trimmed
    if (!rl.five_hour || typeof rl.five_hour.used_percentage !== 'number') return;
    let stale = true;
    try { stale = now - fs.statSync(HISTORY_FILE).mtimeMs > 120000; } catch {}
    if (!stale) return;
    try {
      if (fs.statSync(HISTORY_FILE).size > 256 * 1024) {
        const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');
        fs.writeFileSync(HISTORY_FILE, lines.slice(Math.floor(lines.length / 2)).join('\n'));
      }
    } catch {}
    const sample = { ts: now, pct: rl.five_hour.used_percentage, resets_at: rl.five_hour.resets_at };
    if (model && model.id) sample.model = model.id; // this session's model only — burn may come from other sessions
    if (rl.seven_day && typeof rl.seven_day.used_percentage === 'number') {
      sample.sd_pct = rl.seven_day.used_percentage;
      sample.sd_resets = rl.seven_day.resets_at;
    }
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(sample) + '\n');
  } catch {}
}

// ---------- main ----------
function render(input, opts) {
  const now = Date.now();
  const rl = input.rate_limits || {};
  if (!opts || !opts.demo) persist(rl, input.model, now);
  const parts = [];
  if (cfg.topic) {
    const topic = (opts && opts.demo) ? input.session_name : getTopic(input);
    if (topic) parts.push(`${CYAN}${truncate(topic)}${RESET}`);
  }
  if (cfg.context) parts.push(contextPart(input.context_window));
  parts.push(windowPart('5h', rl.five_hour, 5 * 3600 * 1000, now));
  parts.push(windowPart('7d', rl.seven_day, 7 * 24 * 3600 * 1000, now));
  return parts.join(` ${DIM}│${RESET} `);
}

function demo() {
  const now = Math.floor(Date.now() / 1000);
  const input = {
    session_name: 'Refactor auth middleware',
    context_window: { used_percentage: 34 },
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: now + 2.9 * 3600 },
      seven_day: { used_percentage: 71, resets_at: now + 3.2 * 24 * 3600 },
    },
  };
  const hot = JSON.parse(JSON.stringify(input));
  hot.context_window.used_percentage = 82;
  hot.rate_limits.five_hour.used_percentage = 91;
  hot.rate_limits.five_hour.resets_at = now + 0.7 * 3600;
  for (const display of ['number', 'bar']) {
    cfg.display = display;
    for (const topic of [false, true]) {
      cfg.topic = topic;
      console.log(`  ${display}${topic ? ' +topic' : '        '}  ${render(input, { demo: true })}`);
    }
  }
  console.log('  near cap  ' + render(hot, { demo: true }));
}

function main() {
  if (hasFlag('--demo')) return demo();
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf-8')); } catch { return; }
  process.stdout.write(render(input));
}

try { main(); } catch {}
