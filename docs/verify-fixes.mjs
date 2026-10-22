#!/usr/bin/env node
// Arch 复审门禁：验证 docs/review-2.md 的 F-1 ~ F-4 是否真修好，并检查有没有引入新问题。
// 用法：node docs/verify-fixes.mjs
// 退出码：0 = 全部通过（可放行）；1 = 有失败项。
// 只读文件、不启动浏览器、不写任何东西。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const timer = await import(join(ROOT, 'assets/js/timer.js'));
const t = timer;

const now = 1_760_000_000_000;
const MIN = 60000;
const results = [];

function check(id, desc, fn) {
  try {
    const [ok, detail] = fn();
    results.push({ id, desc, ok: Boolean(ok), detail: String(detail ?? ''), blocking: true });
  } catch (e) {
    results.push({ id, desc, ok: false, detail: `THROW: ${e && e.message}`, blocking: true });
  }
}

// 建议项：不计入退出码，只提示。用于"已知可改进但不阻塞放行"的观察。
function advise(id, desc, fn) {
  try {
    const [ok, detail] = fn();
    results.push({ id, desc, ok: Boolean(ok), detail: String(detail ?? ''), blocking: false });
  } catch (e) {
    results.push({ id, desc, ok: false, detail: `THROW: ${e && e.message}`, blocking: false });
  }
}

// ---------- F-1 坏数据不白屏 ----------
check('F-1a', 'settings:null 不抛错且回落默认值', () => {
  const s = t.restore({ settings: null, stats: null, session: null }, now);
  return [s.settings.focusMin === 25 && s.status === 'idle', `focusMin=${s.settings.focusMin} status=${s.status}`];
});
check('F-1b', 'settings 为错误类型不抛错', () => {
  const s = t.restore({ settings: 'x', stats: 1, session: {} }, now);
  return [s.settings.focusMin === 25, `focusMin=${s.settings.focusMin}`];
});
check('F-1c', 'session 字段全为 null 不抛错', () => {
  const s = t.restore({ settings: {}, stats: {}, session: { phase: null, status: null, endsAt: null } }, now);
  return [s.status === 'idle', `status=${s.status}`];
});

// ---------- F-2 结束态四项一致 ----------
check('F-2', '结束后 remaining=0 / progress=100 / status=finished', () => {
  let s = t.start(t.createState({}), now);
  const at = now + t.remainingMs(s, now) + 1;
  s = t.tick(s, at).state;
  const rest = t.remainingMs(s, at);
  const pct = t.progressPercent(s, at);
  return [s.status === 'finished' && rest === 0 && pct === 100, `status=${s.status} remaining=${rest} progress=${pct} 大字=${t.formatMMSS(rest)}`];
});

// ---------- F-3 运行中改时长不跳进度 ----------
check('F-3', '运行中把 25 改成 10 分钟，进度与剩余都不变', () => {
  let g = t.start(t.createState({}), now);
  const at = now + 10 * MIN;
  const p1 = t.progressPercent(g, at);
  const r1 = t.remainingMs(g, at);
  g = { ...g, settings: t.normalizeSettings({ ...g.settings, focusMin: 10 }) };
  const p2 = t.progressPercent(g, at);
  const r2 = t.remainingMs(g, at);
  return [p1 === p2 && r1 === r2, `进度 ${p1} -> ${p2}，剩余 ${r1} -> ${r2}`];
});

// ---------- F-4 endsAt 上界 ----------
check('F-4', '异常远的 endsAt 被拒绝，剩余不超过满时长+5s', () => {
  const k = t.restore({
    settings: {}, stats: { date: t.todayStr() },
    session: { phase: 'focus', status: 'running', endsAt: now + 9e12, savedAt: now },
  }, now);
  const rest = t.remainingMs(k, now);
  return [rest <= 25 * MIN + 5000, `剩余=${rest}ms status=${k.status}`];
});

// ---------- A-1 / A-2：F-4 的上界不能由不可信数据推导（leader 决定本轮修，已升级为阻断项）----------
// 背景：Dev 修 F-4 时把上界改成 max(当前设置时长, session.phaseTotalMs)+5s，以保住
// 「改短时长后刷新」的合法剩余。但 phaseTotalMs 本身来自 localStorage，同属不可信输入，
// 脏快照会把上界重新撑大；暂停分支则完全没有上界。两项都只是"再一次脏数据"才可达，故列建议项。
check('A-1', '脏 phaseTotalMs 不得撑大 endsAt 上界', () => {
  const a = t.restore({ settings: {}, stats: { date: t.todayStr() },
    session: { phase: 'focus', status: 'running', endsAt: now + 9e12, phaseTotalMs: 9e12 } }, now);
  const rest = t.remainingMs(a, now);
  return [rest <= 60 * MIN + 5000, `status=${a.status} 剩余=${rest}ms`];
});
check('A-2', '暂停态剩余同样要有上界', () => {
  const a = t.restore({ settings: {}, stats: { date: t.todayStr() },
    session: { phase: 'focus', status: 'paused', pausedRemainingMs: 9e12, phaseTotalMs: 9e12 } }, now);
  const rest = t.remainingMs(a, now);
  return [rest <= 60 * MIN + 5000, `status=${a.status} 剩余=${rest}ms`];
});

// ---------- 回归：不能为了修 4 项而弄坏主干 ----------
check('R-1', '一次性正常跑完 focus 仍进短休并计数', () => {
  let s = t.start(t.createState({}), now);
  s = t.tick(s, now + t.remainingMs(s, now) + 1).state;
  return [s.phase === 'shortBreak' && s.stats.completedFocus === 1, `phase=${s.phase} done=${s.stats.completedFocus}`];
});
check('R-2', '4 个专注后进入长休，之后归零', () => {
  let s = t.createState({});
  const seq = [];
  for (let i = 0; i < 8; i++) {
    s = t.start(s, now);
    s = t.tick(s, now + t.remainingMs(s, now) + 1).state;
    seq.push(s.phase);
    s = { ...s, status: 'idle' };
  }
  const ok = seq[6] === 'longBreak' && s.cycleFocus === 0;
  return [ok, seq.join('>')];
});
check('R-3', '暂停 10 分钟后继续，剩余不漂移', () => {
  let c = t.start(t.createState({}), now);
  c = t.pause(c, now + MIN);
  const restPaused = t.remainingMs(c, now + 11 * MIN);
  c = t.start(c, now + 11 * MIN);
  const restResumed = t.remainingMs(c, now + 11 * MIN);
  return [restPaused === restResumed, `${restPaused} vs ${restResumed}`];
});
check('R-4', '跳过不计数', () => {
  let d = t.start(t.createState({}), now);
  d = t.skip(d);
  return [d.stats.completedFocus === 0 && d.status === 'idle', `done=${d.stats.completedFocus} status=${d.status}`];
});
check('R-5', '过期恢复只结算一次（连按两次不重复 +1）', () => {
  const session = { phase: 'focus', status: 'running', endsAt: now - 3600e3, savedAt: now - 3600e3 };
  const once = t.restore({ settings: {}, stats: { date: t.todayStr() }, session }, now);
  const twice = t.restore({ settings: {}, stats: once.stats, session: t.toSession(once, now) }, now);
  return [once.stats.completedFocus === 1 && twice.stats.completedFocus === 1, `${once.stats.completedFocus}/${twice.stats.completedFocus}`];
});
check('R-6', '未到期恢复为 running 且剩余正确', () => {
  const h = t.restore({ settings: {}, stats: { date: t.todayStr() },
    session: { phase: 'focus', status: 'running', endsAt: now + 10 * MIN, savedAt: now } }, now);
  return [h.status === 'running' && t.remainingMs(h, now) === 10 * MIN, `status=${h.status} rest=${t.remainingMs(h, now)}`];
});
check('R-7', 'autoStartNext 结束后自动进入短休 05:00', () => {
  let e = t.start(t.createState({ autoStartNext: true }), now);
  const at = now + t.remainingMs(e, now) + 1;
  e = t.tick(e, at).state;
  return [e.status === 'running' && t.formatMMSS(t.remainingMs(e, at)) === '05:00', `status=${e.status} 大字=${t.formatMMSS(t.remainingMs(e, at))}`];
});
check('R-8', '相位推进幂等（连续 tick 只推一格）', () => {
  let s = t.start(t.createState({}), now);
  const at = now + t.remainingMs(s, now) + 1;
  s = t.tick(s, at).state;
  const done1 = s.stats.completedFocus;
  s = t.tick(s, at).state;
  s = t.tick(s, at).state;
  return [s.stats.completedFocus === done1, `done=${s.stats.completedFocus}`];
});
check('R-9', '格式零填充与边界', () => {
  const got = [1500e3, 599e3, 1e3, 0].map((ms) => t.formatMMSS(ms)).join(',');
  return [got === '25:00,09:59,00:01,00:00', got];
});

// ---------- 静态契约：新增问题 / 已交付约定 ----------
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'assets/styles.css'), 'utf8');
const jsFiles = ['app', 'timer', 'storage', 'ui'].map((n) => readFileSync(join(ROOT, `assets/js/${n}.js`), 'utf8'));

check('S-1', '16 个 data-testid 齐备且唯一（含 leader 裁决的 pomo-count 与 setting-*）', () => {
  const ids = ['time-display', 'phase-label', 'status-label', 'round-count', 'pomo-count', 'btn-start', 'btn-pause',
    'btn-reset', 'btn-skip', 'btn-settings', 'settings-panel', 'progress',
    'setting-focus', 'setting-short', 'setting-long', 'setting-reset'];
  const bad = ids.filter((id) => (html.match(new RegExp(`data-testid="${id}"`, 'g')) || []).length !== 1);
  return [bad.length === 0, bad.join(',') || 'ok'];
});
check('S-2', '无水印式绝对路径 / 零外链', () => {
  const bad = [/(src|href)="\//, /url\(\//, /<script[^>]+src="https?:/, /fonts\.googleapis|cdn\.jsdelivr|unpkg|cdnjs/]
    .filter((re) => re.test(html) || re.test(css));
  return [bad.length === 0, bad.map(String).join(' | ') || 'ok'];
});
check('S-3', '无 alert / 无阻塞渲染外链', () => {
  const bad = jsFiles.some((s) => /[^.\w]alert\s*\(/.test(s)) || /<script[^>]+defer?[^>]*src="https?:/.test(html);
  return [!bad, bad ? 'found' : 'ok'];
});
check('S-4', '[hidden] 强制 display:none（设置面板不能默认展开）', () => {
  return [/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css), 'styles.css'];
});
check('S-5', 'N-1 主按钮窄屏独占一行（grid-column: 1 / -1）', () => {
  return [/\.btn--primary[^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css), 'styles.css'];
});
check('S-7', 'B-1 结束态标签不直接取内部 state.phase（须走 finishedPhase）', () => {
  const app = jsFiles[0];
  const stillNaive = /PHASE_LABEL\[state\.phase\]/.test(app);
  const usesFinished = /finishedPhase/.test(app);
  return [!stillNaive && usesFinished, stillNaive ? '仍用 PHASE_LABEL[state.phase]' : 'ok'];
});

check('S-6', 'ui.js 不含 setInterval 调用（唯一 tick 在 app.js）', () => {
  // 注意：只匹配真实调用，别被注释里的 "不持有 setInterval" 误判
  return [/[^.\w]setInterval\s*\(/.test(jsFiles[3]) === false, 'ui.js'];
});

// ---------- 输出 ----------
// 约定：最后一行永远是可 grep 的门禁结论，退出码与结论严格一致。
// 注意：不要用 `node ... | tail` 判断通过与否——管道的 $? 是 tail 的，会假绿。
const pad = (s, n) => String(s).padEnd(n, ' ');
const blocking = results.filter((r) => r.blocking);
const failed = blocking.filter((r) => !r.ok);
const warns = results.filter((r) => !r.ok && !r.blocking);
const passCount = blocking.length - failed.length;

console.log('Arch 复审门禁 · review-2.md F-1~F-4 + A-1/A-2/B-1 + 回归 + 静态契约\n');
for (const r of results) {
  const tag = r.ok ? 'PASS' : (r.blocking ? 'FAIL' : 'WARN');
  console.log(`${tag}  ${pad(r.id, 5)} ${r.desc}${r.detail ? `  [${r.detail}]` : ''}`);
}

console.log('');
console.log(`阻断项：${blocking.length} 项，通过 ${passCount}，失败 ${failed.length}`);
if (warns.length) console.log(`建议项：${warns.length} 项未过（${warns.map((w) => w.id).join(', ')}），不计入退出码`);

if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.id).join(', '));
  console.log(`GATE: FAIL (${passCount}/${blocking.length}) — 退出码 1`);
  // 兜底：即便上面的流程被动过，也要保证失败时退出码非 0
  process.exitCode = 1;
  process.exit(1);
}

const { createHash } = await import('node:crypto');
console.log('\n冻结指纹（贴上即可）：');
for (const f of ['index.html', 'assets/styles.css', 'assets/js/timer.js', 'assets/js/ui.js', 'assets/js/app.js']) {
  const h = createHash('md5').update(readFileSync(join(ROOT, f))).digest('hex');
  console.log(`  ${f.padEnd(22)} ${h}`);
}
console.log('');
console.log(`GATE: PASS (${passCount}/${blocking.length}) — 退出码 0`);
process.exit(0);
