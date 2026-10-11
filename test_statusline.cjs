#!/usr/bin/env node
'use strict';
// Tests for statusline.cjs layout (responsive tiers + two-line wrap).
// Zero dependencies: node:assert + child_process. Run: node test_statusline.cjs
// Every case runs the real script as Claude Code does (JSON on stdin, $COLUMNS
// in the env) against a throwaway --dir, with the clock pinned via
// USAGE_VERDICT_NOW so the snapshots are timezone- and time-independent.

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'statusline.cjs');
const NOW = 1791720000; // epoch seconds; only differences from it matter

function input(over) {
  return Object.assign({
    session_name: 'vikunja-todo dispatch lead',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    effort: { level: 'medium' },
    context_window: { used_percentage: 18 },
    rate_limits: {
      five_hour: { used_percentage: 33, resets_at: NOW + 36 * 60 },
      seven_day: { used_percentage: 16, resets_at: NOW + (45 * 60 + 30) * 60 },
    },
  }, over || {});
}

let tmpRoot;
function freshDir(name) {
  const d = path.join(tmpRoot, name || `d${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function run({ columns, args = [], stdin, dir, config }) {
  dir = dir || freshDir();
  if (config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  // A fresh "probe failed" cache: an unknown width must stay unknown, even if
  // the test runner itself sits in a real console that `mode con` could read.
  fs.writeFileSync(path.join(dir, 'width.json'), JSON.stringify({ w: null, ts: Date.now() }));
  const env = Object.assign({}, process.env, { USAGE_VERDICT_NOW: String(NOW) });
  delete env.COLUMNS;
  delete env.CLAUDE_PACER_DIR;
  if (columns != null) env.COLUMNS = String(columns);
  const r = spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...args], {
    input: stdin !== undefined ? stdin : JSON.stringify(input()),
    env, encoding: 'utf-8', timeout: 10000,
  });
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.strictEqual(r.stderr, '', 'statusline must not write to stderr');
  return { out: r.stdout, plain: strip(r.stdout), dir };
}

function strip(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
// same column rule as statusline.cjs plainWidth(): CJK counts 2
function width(s) {
  let w = 0;
  for (const ch of strip(s)) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

// ---- snapshots (ANSI stripped) at the widths Claude Code actually hands us ----
const SNAPSHOTS = {
  200: [
    'vikunja-todo dispatc… │ 5h ▓▓░░░┃░ 33%·36m │ 7d ▓░░░┃░░ 16%·1d21h │ Ctx ▓░░░░░ 18% │ Opus 5.5·medium',
  ],
  120: [
    'vikunja-todo dispatc… │ 5h ▓▓░░░┃░ 33%·36m │ 7d ▓░░░┃░░ 16%·1d21h │ Ctx ▓░░░░░ 18% │ Opus 5.5·medium',
  ],
  80: [
    'vikunja-todo dispatc… │ 5h ▓▓░░░┃░ 33%·36m │ 7d ▓░░░┃░░ 16%·1d21h',
    'Ctx ▓░░░░░ 18% │ Opus 5.5·medium',
  ],
  60: [
    'vikunja-… │ 5h ▓▓░░░┃░ 33%·36m │ 7d ▓░░░┃░░ 16%·1d21h',
    'Ctx ▓░░░░░ 18% │ Opus 5.5·medium',
  ],
  40: [
    'vikunja-…│5h▓░░░36m│7d▓░░░1d21h',
    'Ctx ▓░░░░░ 18% │ Opus 5.5·medium',
  ],
};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

for (const [cols, expected] of Object.entries(SNAPSHOTS)) {
  test(`snapshot COLUMNS=${cols}`, () => {
    assert.deepStrictEqual(run({ columns: cols }).plain.split('\n'), expected);
  });
}

test('every line fits COLUMNS minus the 4-column reserve (30..200)', () => {
  for (let cols = 30; cols <= 200; cols += 2) {
    const { out } = run({ columns: cols });
    const lines = out.split('\n');
    assert.ok(lines.length <= 2, `COLUMNS=${cols}: ${lines.length} lines`);
    for (const l of lines) assert.ok(width(l) <= cols - 4, `COLUMNS=${cols}: "${strip(l)}" is ${width(l)} wide`);
  }
});

test('narrow widths keep Ctx and the full model name on line 2', () => {
  for (const cols of [40, 50, 60, 70, 80, 89]) {
    const lines = run({ columns: cols }).plain.split('\n');
    assert.strictEqual(lines.length, 2, `COLUMNS=${cols}`);
    assert.ok(/Ctx ▓░░░░░ 18%/.test(lines[1]), `COLUMNS=${cols}: ${lines[1]}`);
    assert.ok(lines[1].includes('Opus 5.5·medium'), `COLUMNS=${cols}: ${lines[1]}`);
  }
});

test('regression: 88-wide line in an 89-column pane no longer gets cut', () => {
  // herdr pane, 2026-10-11: Claude Code showed "… │ Opus 5.5·me…"
  const lines = run({ columns: 89 }).plain.split('\n');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].endsWith('Opus 5.5·medium'));
});

test('wide enough → single line, nothing dropped', () => {
  const { plain } = run({ columns: 120 });
  assert.ok(!plain.includes('\n'));
  for (const s of ['5h ', '7d ', 'Ctx ', 'Opus 5.5·medium']) assert.ok(plain.includes(s), s);
});

test('unknown width (no COLUMNS, piped stdout, probe fails) → full single line', () => {
  const { plain } = run({ columns: null });
  assert.strictEqual(plain, SNAPSHOTS[200][0]);
});

test('wrap: "never" in config.json keeps the old one-line degradation', () => {
  const { plain } = run({ columns: 40, config: { wrap: 'never' } });
  assert.ok(!plain.includes('\n'));
  assert.ok(width(plain) <= 36, plain);
});

test('--no-wrap flag = wrap never', () => {
  assert.ok(!run({ columns: 60, args: ['--no-wrap'] }).plain.includes('\n'));
});

test('reserve: 0 restores fitting to the full COLUMNS', () => {
  // 88 wide fits 89 columns when nothing is reserved
  assert.ok(!run({ columns: 89, config: { reserve: 0 } }).plain.includes('\n'));
  assert.ok(!run({ columns: 89, args: ['--reserve', '0'] }).plain.includes('\n'));
});

test('invalid reserve falls back to the default', () => {
  const lines = run({ columns: 89, config: { reserve: 'x' } }).plain.split('\n');
  assert.strictEqual(lines.length, 2);
});

test('pinned tier stays a single line', () => {
  const { plain } = run({ columns: 40, config: { tier: 'full' } });
  assert.strictEqual(plain, SNAPSHOTS[200][0]);
});

test('context + model hidden → 7d is what moves down', () => {
  const lines = run({ columns: 40, config: { context: false, model: false } }).plain.split('\n');
  assert.deepStrictEqual(lines, ['vikunja-… │ 5h ▓▓░░░┃░ 33%·36m', '7d ▓░░░┃░░ 16%·1d21h']);
});

test('5h + 7d only → split into two full lines rather than compacted', () => {
  const lines = run({ columns: 30, config: { topic: false, context: false, model: false } }).plain.split('\n');
  assert.deepStrictEqual(lines, ['5h ▓▓░░░┃░ 33%·36m', '7d ▓░░░┃░░ 16%·1d21h']);
});

test('number display wraps too (7d moves down when line 1 is still too wide)', () => {
  const lines = run({ columns: 60, args: ['--number'] }).plain.split('\n');
  assert.deepStrictEqual(lines, [
    'vikunja-todo dispatc… │ 5h 33%·36m left·t88%',
    '7d 16%·1d21h left·t73% │ Ctx 18% │ Opus 5.5·medium',
  ]);
});

test('missing data never crashes and still fits', () => {
  for (const stdin of ['', 'not json', '{}', JSON.stringify({ model: { display_name: 'Opus 5.5' } })]) {
    for (const cols of [null, 40, 120]) {
      const { out } = run({ columns: cols, stdin });
      for (const l of out.split('\n')) if (cols) assert.ok(width(l) <= cols - 4, `${stdin} @${cols}: ${strip(l)}`);
    }
  }
});

test('width-last.json records lines, reserve and budget', () => {
  const { dir } = run({ columns: 60 });
  const w = JSON.parse(fs.readFileSync(path.join(dir, 'width-last.json'), 'utf-8'));
  assert.strictEqual(w.used, 60);
  assert.strictEqual(w.reserve, 4);
  assert.strictEqual(w.budget, 56);
  assert.strictEqual(w.lines, 2);
});

test('state dir with spaces and non-ASCII characters (Windows/macOS paths)', () => {
  const dir = freshDir(path.join('with space', '中文 dir'));
  run({ columns: 80, dir });
  const limits = JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf-8'));
  assert.strictEqual(limits.five_hour.used_percentage, 33);
});

test('--demo renders every tier and both wrap modes without crashing', () => {
  const env = Object.assign({}, process.env, { CLAUDE_PACER_DIR: freshDir() });
  const r = spawnSync(process.execPath, [SCRIPT, '--demo'], { env, encoding: 'utf-8' });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('wrap=auto') && r.stdout.includes('wrap=never'));
});

// ---- runner ----
tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-test-'));
let failed = 0;
try {
  for (const t of tests) {
    try { t.fn(); console.log(`ok   ${t.name}`); }
    catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${String(e.message).split('\n').join('\n     ')}`); }
  }
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
