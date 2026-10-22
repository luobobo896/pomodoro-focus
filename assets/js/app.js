// app.js —— 启动装配：唯一 tick 来源（200ms 只负责重绘）、持久化节流、?debug=1 钩子。
// 契约：docs/architecture.md §3 / §4.2 / §4.3。

import * as timer from './timer.js';
import { createStorage } from './storage.js';
import { createUI } from './ui.js';

// ---- 逻辑时钟：debug.advance() 直接推进 endsAt / pausedRemainingMs，不真等待。
// 不能只加全局偏移：偏移不持久化，刷新后 endsAt 会被算成"未来很久"，恢复语义就错了。
const now = () => Date.now();

const storage = createStorage();
const saved = storage.load();

let state = timer.restore(
  { settings: saved?.settings, stats: saved?.stats, session: saved?.session },
  now(),
);

let settingsOpen = false;
let hint = '';
let lockUntil = 0;
let lastSaveAt = 0;

function persist(force = false) {
  const t = Date.now();
  if (!force && t - lastSaveAt < 1000) return;   // 落盘节流 ≥1s/次，避免 tick 写爆
  lastSaveAt = t;
  storage.save({
    settings: state.settings,
    stats: state.stats,
    session: timer.toSession(state, now()),
  });
}

function formatFocus(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h}h${String(m).padStart(2, '0')}m`;
  }
  return `${Math.max(1, Math.round(s / 60))}m`;
}

function buildView() {
  const nowMs = now();
  const remaining = timer.remainingMs(state, nowMs);
  const timeText = timer.formatMMSS(remaining);
  const running = state.status === timer.STATUS.running;
  const paused = state.status === timer.STATUS.paused;
  const finished = state.status === timer.STATUS.finished;
  const locked = Date.now() < lockUntil;
  // B-1：结束态展示“刚结束的阶段”。仅展示层映射，内部 state.phase 不动。
  const displayPhase = finished && state.finishedPhase ? state.finishedPhase : state.phase;
  const phaseLabel = timer.PHASE_LABEL[displayPhase];

  const title = finished && state.finishedPhase
    ? `✓ ${timer.PHASE_LABEL[state.finishedPhase]}结束`
    : `${timeText} · ${phaseLabel}`;

  const primary = running
    ? { usePause: true, label: '暂停', disabled: locked }
    : { usePause: false, label: paused ? '继续' : '开始', disabled: locked };

  const focusCount = state.stats.completedFocus;
  const statsText = focusCount > 0
    ? `今日 ${focusCount} 个 · 专注 ${formatFocus(state.stats.totalFocusSec)}`
    : null;

  return {
    timeText,
    title,
    phase: displayPhase,
    phaseLabel,
    statusLabel: timer.STATUS_LABEL[state.status],
    roundText: `第 ${timer.roundNumber(state)} 轮`,
    dotsDone: timer.dotsDone(state),
    dotsTotal: state.settings.longBreakEvery,
    progress: timer.progressPercent(state, nowMs),
    primary,
    statsText,
    settingsOpen,
    settings: state.settings,
    hint: settingsOpen ? hint : '',
  };
}

const handlers = {
  onPrimary() {
    if (Date.now() < lockUntil) return;
    state = state.status === timer.STATUS.running
      ? timer.pause(state, now())
      : timer.start(state, now());
    persist(true);
    render();
  },
  onReset() {
    state = timer.reset(state);
    persist(true);
    render();
  },
  onSkip() {
    state = timer.skip(state);
    persist(true);
    render();
  },
  onToggleSettings() {
    settingsOpen = !settingsOpen;
    hint = '';
    render();
  },
  onRestoreDefaults() {
    state = { ...state, settings: { ...timer.DEFAULTS } };
    hint = '';
    persist(true);
    render();
  },
  onSettingChange(name, raw) {
    state = { ...state, settings: timer.normalizeSettings({ ...state.settings, [name]: raw }) };
    // FR-07：运行中改时长不立即改变当前相位，但必须给提示
    hint = state.status === timer.STATUS.running ? '时长将在下一阶段生效' : '';
    persist(true);
    render();
  },
};

const ui = createUI(handlers);

function render() {
  ui.render(buildView());
}

// 唯一 tick 来源：只重绘 + 判结束（相位推进只做一格，幂等）
function tickOnce() {
  const result = timer.tick(state, now());
  state = result.state;
  if (result.ended) {
    lockUntil = Date.now() + 300;   // 防连点重复结算
    ui.flash();
    persist(true);
    // 锁定到期时补一次重绘：否则 disabled 要等下一个 200ms tick 才解除，
    // 用户在 300~500ms 之间点「开始」会被静默吞掉。
    setTimeout(render, 320);
  }
  render();
  persist();
}

render();
tickOnce();
setInterval(tickOnce, 200);

// 切回前台立即按真实时间校正（兜住系统休眠 / 后台节流）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tickOnce();
});

// 键盘：Space/Enter = 开始/暂停/继续；R = 重置（焦点在输入控件时不拦截）
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
  if (event.code === 'Space' || event.key === 'Enter') {
    event.preventDefault();
    handlers.onPrimary();
  } else if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    handlers.onReset();
  }
});

// ---- 调试钩子：只有 ?debug=1 才挂载，线上非 debug 下 window.__pf 必须为 undefined ----
const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';

if (isDebug) {
  const snapshot = () => ({
    phase: state.phase,
    status: state.status,
    remainingMs: timer.remainingMs(state, now()),
    timeText: timer.formatMMSS(timer.remainingMs(state, now())),
    endsAt: state.endsAt,
    pausedRemainingMs: state.pausedRemainingMs,
    cycleFocus: state.cycleFocus,
    round: timer.roundNumber(state),
    settings: { ...state.settings },
    stats: { ...state.stats },
    title: document.title,
    storageAvailable: storage.available,
  });

  window.__pf = {
    getState: snapshot,
    advance(ms) {
      const delta = Number(ms);
      if (Number.isFinite(delta) && delta > 0) {
        if (state.status === timer.STATUS.running && Number.isFinite(state.endsAt)) {
          state = { ...state, endsAt: state.endsAt - delta };
        } else if (state.status === timer.STATUS.paused) {
          state = { ...state, pausedRemainingMs: Math.max(0, (state.pausedRemainingMs ?? 0) - delta) };
        }
      }
      tickOnce();
      return snapshot();
    },
    setDurations({ focusMin, shortBreakMin, longBreakMin } = {}) {
      const patch = {};
      if (focusMin !== undefined) patch.focusMin = focusMin;
      if (shortBreakMin !== undefined) patch.shortBreakMin = shortBreakMin;
      if (longBreakMin !== undefined) patch.longBreakMin = longBreakMin;
      state = { ...state, settings: timer.normalizeSettings({ ...state.settings, ...patch }) };
      persist(true);
      render();
      return { ...state.settings };
    },
    resetStorage() {
      storage.reset();
      return storage.available;
    },
  };
}
