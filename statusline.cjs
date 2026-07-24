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
  model: true,         // show model + reasoning effort (rightmost)
  topic_chars: 20,
  bar_width: 6,
  width: null,         // terminal columns; null = auto-detect
  tier: 'auto',        // 'auto' | 'full' | 'compact' | 'minimal' — force a layout
};
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fb; } }
const cfg = Object.assign({}, DEFAULTS, readJson(path.join(DIR, 'config.json'), {}));
if (hasFlag('--bar')) cfg.display = 'bar';
if (hasFlag('--number')) cfg.display = 'number';
if (hasFlag('--topic')) cfg.topic = true;
if (hasFlag('--no-topic')) cfg.topic = false;
if (hasFlag('--context')) cfg.context = true;
if (hasFlag('--no-context')) cfg.context = false;
if (argValue('--width')) cfg.width = parseInt(argValue('--width'), 10) || null;
if (argValue('--tier')) cfg.tier = argValue('--tier');

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

// Display width of a rendered string: ANSI codes are free, CJK chars count 2.
function plainWidth(s) {
  const p = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of p) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

// Usage bar with an optional elapsed-time marker (┃): if the filled part has
// passed the marker you are burning faster than the clock. The marker is
// INSERTED BETWEEN cells (bar becomes w+1 wide) so it never eats a fill cell
// and the filled proportion always reads true.
function bar(pct, timePct, w) {
  const filled = Math.max(0, Math.min(w, Math.round(pct / 100 * w)));
  const marker = typeof timePct === 'number'
    ? Math.max(0, Math.min(w, Math.round(timePct / 100 * w))) : -1;
  let out = '';
  for (let i = 0; i <= w; i++) {
    if (i === marker) out += '┃';                       // normal color, stands out on both zones
    if (i < w) out += i < filled ? `${pctColor(pct)}▓${RESET}` : `${DIM}░${RESET}`;
  }
  return out;
}

// level 0 = full, 1 = compact, 2 = minimal (auto-degrades until it fits)
function windowPart(label, win, windowMs, now, level) {
  if (!win || typeof win.used_percentage !== 'number') return level > 0 ? `${DIM}${label}–${RESET}` : `${DIM}${label} –${RESET}`;
  const pct = Math.round(win.used_percentage);
  const remainMs = win.resets_at * 1000 - now;
  const timePct = Math.max(0, Math.min(100, Math.round(100 * (1 - remainMs / windowMs))));
  const c = pctColor(pct);
  const sp = level > 0 ? '' : ' ';
  if (cfg.display === 'bar') {
    if (level >= 2) return `${BOLD}${label}${RESET}${c}${pct}%${RESET}`;
    // compact: the bar already shows usage — pair it with remaining time,
    // which the bar can't show (marker dropped: 4 cells too coarse for it)
    if (level === 1) return `${BOLD}${label}${RESET}${bar(pct, null, 4)}${DIM}${fmtDur(remainMs)}${RESET}`;
    const b = bar(pct, timePct, cfg.bar_width);
    return `${BOLD}${label}${RESET} ${b} ${c}${pct}%${RESET}${DIM}·${fmtDur(remainMs)}${RESET}`;
  }
  const zh = cfg.labels === 'zh';
  if (level >= 2) return `${BOLD}${label}${RESET}${c}${pct}%${RESET}`;
  if (level === 1) return `${BOLD}${label}${RESET}${c}${pct}%${RESET}${DIM}·${fmtDur(remainMs)}${RESET}`;
  const rem = zh ? `剩${fmtDur(remainMs)}` : `${fmtDur(remainMs)} left`;
  const t = zh ? `時${timePct}%` : `t${timePct}%`;
  return `${BOLD}${label}${RESET} ${c}${pct}%${RESET}${DIM}·${rem}·${t}${RESET}`;
}

function contextPart(cw, level) {
  let pct = cw && typeof cw.used_percentage === 'number' ? cw.used_percentage : null;
  if (pct === null && cw && cw.current_usage && cw.context_window_size) {
    const u = cw.current_usage;
    const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    pct = 100 * used / cw.context_window_size;
  }
  const label = level >= 2 ? 'C' : 'Ctx';
  if (pct === null) return `${DIM}${label}–${RESET}`;
  pct = Math.round(pct);
  if (cfg.display === 'bar' && level === 0) return `${BOLD}${label}${RESET} ${bar(pct, null, cfg.bar_width)} ${pctColor(pct)}${pct}%${RESET}`;
  return `${BOLD}${label}${RESET}${level === 0 ? ' ' : ''}${pctColor(pct)}${pct}%${RESET}`;
}

const EFFORT_ABBR = { low: 'lo', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' };
function modelPart(input, level) {
  const name = input.model && (input.model.display_name || input.model.id);
  if (!name) return null;
  const eff = input.effort && input.effort.level;
  if (level >= 2) { // initials: "Fable 5" → F5, "Opus 4.8" → O4.8
    const short = name.split(/\s+/).map(w => (/^[\d.]/.test(w) ? w : w[0])).join('');
    return `${DIM}${short}${eff ? '·' + (EFFORT_ABBR[eff] || eff) : ''}${RESET}`;
  }
  const n = level === 1 ? name.replace(/ /g, '') : name;
  return `${DIM}${n}${eff ? '·' + (level === 1 ? (EFFORT_ABBR[eff] || eff) : eff) : ''}${RESET}`;
}

// ---------- topic ----------
// Priority: session_name (Claude Code's own AI-generated/renamed title)
//         > latest summary entry in the transcript (written on compaction)
//         > first real user prompt (fallback; re-checked every 5 min for upgrades)
function truncate(text, max) {
  max = max || cfg.topic_chars;
  let t = text.replace(/\s+/g, ' ').trim();
  // CJK titles don't need spaces — drop them all to save width
  if (/[　-鿿가-힣豈-﫿]/.test(t)) t = t.replace(/ /g, '');
  const chars = Array.from(t);
  return chars.slice(0, max).join('') + (chars.length > max ? '…' : '');
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
function buildLine(input, now, topic, level, topicMax) {
  const rl = input.rate_limits || {};
  const parts = [];
  if (topic) parts.push(`${CYAN}${truncate(topic, topicMax || (level > 0 ? 10 : cfg.topic_chars))}${RESET}`);
  parts.push(windowPart('5h', rl.five_hour, 5 * 3600 * 1000, now, level));
  parts.push(windowPart('7d', rl.seven_day, 7 * 24 * 3600 * 1000, now, level));
  if (cfg.context) parts.push(contextPart(input.context_window, level));
  if (cfg.model) { const m = modelPart(input, level); if (m) parts.push(m); } // rightmost
  return parts.join(level > 0 ? `${DIM}│${RESET}` : ` ${DIM}│${RESET} `);
}

// Terminal width. Claude Code ≥2.1.153 sets $COLUMNS for the statusline
// process (official path). Fallbacks: stdout.columns (if a TTY), then probing
// the attached console (mode con / stty via /dev/tty), cached 15 s.
// Unknown width → null → NO degradation (full layout).
function probeTerminal() {
  const cacheFile = path.join(DIR, 'width.json');
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (Date.now() - c.ts < 15000) return c.w; // may be null (probe known to fail)
  } catch {}
  let w = null;
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const out = execSync('mode con', { timeout: 1500, windowsHide: true }).toString();
      const nums = out.match(/\d+/g); // lines, columns, ... (locale-proof: order is fixed)
      if (nums && nums.length >= 2) w = parseInt(nums[1], 10) || null;
    } else {
      const out = execSync('stty size < /dev/tty', { timeout: 1500, shell: '/bin/sh' }).toString();
      const m = out.trim().split(/\s+/); // "rows cols"
      if (m.length === 2) w = parseInt(m[1], 10) || null;
    }
  } catch {}
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ w, ts: Date.now() })); } catch {}
  return w;
}

function detectWidth() {
  if (cfg.width) return cfg.width;
  const env = parseInt(process.env.COLUMNS, 10);
  if (env > 0) return env;
  if (process.stdout.columns) return process.stdout.columns;
  return probeTerminal();
}

const TIERS = { full: 0, compact: 1, minimal: 2 };

function render(input, opts) {
  const now = Date.now();
  if (!opts || !opts.demo) persist(input.rate_limits || {}, input.model, now);
  const topic = cfg.topic ? ((opts && opts.demo) ? input.session_name : getTopic(input)) : null;
  if (cfg.tier in TIERS) return buildLine(input, now, topic, TIERS[cfg.tier]);
  const width = (opts && opts.width) || detectWidth();
  // degrade gently: full → full with a shorter topic → compact → minimal
  const steps = [
    { level: 0, t: null }, { level: 0, t: 8 },
    { level: 1, t: 8 }, { level: 2, t: 8 },
  ];
  let step = 0;
  let line = buildLine(input, now, topic, 0, null);
  if (width) {
    while (step < steps.length - 1 && plainWidth(line) > width) {
      step++;
      line = buildLine(input, now, topic, steps[step].level, steps[step].t);
    }
  }
  const level = steps[step].level;
  if (!opts || !opts.demo) { // diagnostics: which width source won, which tier rendered
    try {
      fs.writeFileSync(path.join(DIR, 'width-last.json'), JSON.stringify({
        ts: now, used: width || null, level,
        cfg_width: cfg.width || null,
        COLUMNS: process.env.COLUMNS || null,
        stdout_columns: process.stdout.columns || null,
        line_width: plainWidth(line),
      }));
    } catch {}
  }
  return line;
}

function demo() {
  const now = Math.floor(Date.now() / 1000);
  const input = {
    session_name: 'Refactor auth middleware',
    model: { display_name: 'Fable 5' },
    effort: { level: 'high' },
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
  for (const display of ['bar', 'number']) {
    cfg.display = display;
    for (const [name, width] of [['wide  ', 999], ['medium', 60], ['narrow', 40]]) {
      console.log(`  ${display} ${name}  ${render(input, { demo: true, width })}`);
    }
  }
  cfg.display = 'bar';
  console.log('  near cap     ' + render(hot, { demo: true, width: 999 }));
}

function main() {
  if (hasFlag('--demo')) return demo();
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf-8')); } catch { return; }
  process.stdout.write(render(input));
}

try { main(); } catch {}
