// timer.js —— 纯计时核心：状态机 + 相位推进。无 DOM、无存储、无定时器，可被 Node 直接单测。
// 设计依据：docs/architecture.md §3（只存 endsAt，不存"剩余秒数"）。

export const PHASE = Object.freeze({ focus: 'focus', shortBreak: 'shortBreak', longBreak: 'longBreak' });
export const STATUS = Object.freeze({ idle: 'idle', running: 'running', paused: 'paused', finished: 'finished' });

export const PHASE_LABEL = Object.freeze({ focus: '专注', shortBreak: '短休息', longBreak: '长休息' });
export const STATUS_LABEL = Object.freeze({ idle: '就绪', running: '进行中', paused: '已暂停', finished: '已结束' });

// 提示音按 leader 决策：P1、默认关闭（架构 §4.3 的 schema 示例写 true，以 leader 决策与 Design §8 为准）
export const DEFAULTS = Object.freeze({
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartNext: false,
  sound: false,
});

const MIN = 60 * 1000;

// B-2/B-3：存储里的 phaseTotalMs 只有落在“设置允许的 1-60 分钟”区间内才采信
const SNAP_MIN = 60 * 1000;
const SNAP_MAX = 60 * 60 * 1000;
const clampSnapshot = (v, fallback) =>
  (Number.isFinite(v) && v >= SNAP_MIN && v <= SNAP_MAX ? v : fallback);

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function normalizeSettings(input) {
  // 注意：默认参数只对 undefined 生效，null 会穿透；这里显式归一（F-1）
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    focusMin: clampInt(src.focusMin, 1, 60, DEFAULTS.focusMin),
    shortBreakMin: clampInt(src.shortBreakMin, 1, 60, DEFAULTS.shortBreakMin),
    longBreakMin: clampInt(src.longBreakMin, 1, 60, DEFAULTS.longBreakMin),
    longBreakEvery: clampInt(src.longBreakEvery, 2, 8, DEFAULTS.longBreakEvery),
    autoStartNext: Boolean(src.autoStartNext),
    sound: src.sound === undefined ? DEFAULTS.sound : Boolean(src.sound), // 预留：P1，当前无消费方
  };
}

export function normalizeStats(input, today = todayStr()) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const sameDay = src.date === today;
  return {
    date: today,
    completedFocus: sameDay ? clampInt(src.completedFocus, 0, 999, 0) : 0,
    completedBreaks: sameDay ? clampInt(src.completedBreaks, 0, 999, 0) : 0,
    totalFocusSec: sameDay ? clampInt(src.totalFocusSec, 0, 60 * 60 * 24, 0) : 0,
  };
}

export function phaseDurationMs(settings, phase) {
  const minutes = phase === PHASE.focus
    ? settings.focusMin
    : phase === PHASE.shortBreak ? settings.shortBreakMin : settings.longBreakMin;
  return Math.max(1, Math.round(minutes * MIN));
}

export function createState(settings = DEFAULTS, stats = {}) {
  return {
    phase: PHASE.focus,
    status: STATUS.idle,
    endsAt: null,
    pausedRemainingMs: null,
    finishedPhase: null,
    cycleFocus: 0,
    phaseTotalMs: null,   // 本相位总时长快照（运行中改设置时进度条不跳，F-3）
    settings: normalizeSettings(settings),
    stats: normalizeStats(stats),
  };
}

// 运行中靠时间戳算，暂停读快照，其余用当前相位满时长
export function remainingMs(state, nowMs) {
  // F-2：阶段结束瞬间剩余必须是 0，否则大字显示下一阶段满时长、与「已结束」自相矛盾
  if (state.status === STATUS.finished) return 0;
  if (state.status === STATUS.running && Number.isFinite(state.endsAt)) {
    return Math.max(0, state.endsAt - nowMs);
  }
  if (state.status === STATUS.paused) {
    return Math.max(0, Number.isFinite(state.pausedRemainingMs) ? state.pausedRemainingMs : 0);
  }
  return phaseDurationMs(state.settings, state.phase);
}

export function start(state, nowMs) {
  if (state.status === STATUS.running) return state;
  const resuming = state.status === STATUS.paused;
  const remaining = resuming
    ? Math.max(0, state.pausedRemainingMs ?? 0)
    : phaseDurationMs(state.settings, state.phase);
  // 续跑沿用旧快照；新开相位按当前设置快照（F-3）
  const phaseTotalMs = resuming && Number.isFinite(state.phaseTotalMs)
    ? state.phaseTotalMs
    : phaseDurationMs(state.settings, state.phase);
  return {
    ...state,
    status: STATUS.running,
    endsAt: nowMs + remaining,
    pausedRemainingMs: null,
    finishedPhase: null,
    phaseTotalMs,
  };
}

export function pause(state, nowMs) {
  if (state.status !== STATUS.running) return state;
  return {
    ...state,
    status: STATUS.paused,
    pausedRemainingMs: remainingMs(state, nowMs),
    endsAt: null,
    phaseTotalMs: Number.isFinite(state.phaseTotalMs) ? state.phaseTotalMs : phaseDurationMs(state.settings, state.phase),
  };
}

export function reset(state) {
  return {
    ...state,
    status: STATUS.idle,
    endsAt: null,
    pausedRemainingMs: null,
    finishedPhase: null,
    phaseTotalMs: null,
  };
}

// 自然结束 / 跳过共用的相位推进；counted=true 才计数（跳过不计数）
function advance(state, { counted }) {
  const next = { ...state, stats: { ...state.stats } };
  const ended = state.phase;

  if (ended === PHASE.focus) {
    if (counted) {
      next.cycleFocus = state.cycleFocus + 1;
      next.stats.completedFocus += 1;
      next.stats.totalFocusSec += Math.round(phaseDurationMs(state.settings, PHASE.focus) / 1000);
    }
    const longBreakDue = counted && next.cycleFocus > 0 &&
      next.cycleFocus % state.settings.longBreakEvery === 0;
    next.phase = longBreakDue ? PHASE.longBreak : PHASE.shortBreak;
  } else if (ended === PHASE.shortBreak) {
    if (counted) next.stats.completedBreaks += 1;
    next.phase = PHASE.focus;
  } else {
    if (counted) next.stats.completedBreaks += 1;
    next.cycleFocus = 0;
    next.phase = PHASE.focus;
  }

  next.endsAt = null;
  next.pausedRemainingMs = null;
  next.finishedPhase = ended;
  next.phaseTotalMs = null;
  return next;
}

export function skip(state) {
  const next = advance(state, { counted: false });
  return { ...next, status: STATUS.idle, finishedPhase: null };
}

// tick：只判结束并推进一格，幂等（推进后 status=finished，不再重复触发）
export function tick(state, nowMs) {
  if (state.status !== STATUS.running) return { state, ended: false };
  if (remainingMs(state, nowMs) > 0) return { state, ended: false };

  let next = advance(state, { counted: true });
  next.status = STATUS.finished;
  if (state.settings.autoStartNext) {
    next = start({ ...next, status: STATUS.idle }, nowMs);
  }
  return { state: next, ended: true };
}

// 会话快照（写入 localStorage 的 session 段）
export function toSession(state, nowMs) {
  const persistedStatus = state.status === STATUS.finished ? STATUS.idle : state.status;
  return {
    phase: state.phase,
    status: persistedStatus,
    endsAt: persistedStatus === STATUS.running ? state.endsAt : null,
    pausedRemainingMs: persistedStatus === STATUS.paused ? state.pausedRemainingMs : null,
    // 契约 §4.3 的 session 段没有本轮位置；但 FR-08/AC-08 要求"番茄数"刷新后不变，
    // 所以额外持久化 cycleFocus（向后兼容：缺失时按今日完成数推导）。
    cycleFocus: state.cycleFocus,
    // F-3 可选：运行中改过时长后刷新，进度条按原快照重算，而不是被新设置重置
    phaseTotalMs: (persistedStatus === STATUS.running || persistedStatus === STATUS.paused)
      ? (Number.isFinite(state.phaseTotalMs) ? state.phaseTotalMs : null)
      : null,
    savedAt: nowMs,
  };
}

// 恢复语义（architecture §4.3）：过期即结算，只结算一格，不按经过时长叠加
export function restore(input, nowMs) {
  // F-1：任何异常（含 settings/stats 为 null）都只能走默认值，绝不白屏
  let state;
  try {
    const src = input && typeof input === 'object' ? input : {};
    state = createState(src.settings, src.stats);
    const session = src.session;
    if (!session || typeof session !== 'object') return state;
    const { phase, status, endsAt, pausedRemainingMs } = session;
    const cycleFocus = Number.isFinite(session.cycleFocus)
      ? Math.min(Math.max(0, Math.round(session.cycleFocus)), state.settings.longBreakEvery)
      : state.stats.completedFocus % state.settings.longBreakEvery;
    const withCycle = { ...state, cycleFocus };
    const phaseOk = Object.values(PHASE).includes(phase);
    if (!phaseOk) return state;

    if (status === STATUS.running && Number.isFinite(endsAt)) {
      // F-4 / B-2：脏 endsAt 丢弃；上界只从配置域取（快照须落在 1-60 分钟内）
      const curTotal = phaseDurationMs(state.settings, phase);
      const snapTotal = clampSnapshot(session.phaseTotalMs, curTotal);
      const bound = Math.max(curTotal, snapTotal) + 5000;
      if (endsAt > nowMs + bound) return { ...withCycle, phase, status: STATUS.idle };
      if (endsAt > nowMs) {
        return {
          ...withCycle, phase, status: STATUS.running, endsAt,
          phaseTotalMs: snapTotal,
        };
      }
      // 期间已结束：按结算推进一格，停在 idle（counted=true 只加一次）
      let settled = advance({ ...withCycle, phase }, { counted: true });
      settled = { ...settled, status: STATUS.idle, finishedPhase: null };
      if (state.settings.autoStartNext) {
        settled = start(settled, nowMs);
      }
      return settled;
    }
    if (status === STATUS.paused && Number.isFinite(pausedRemainingMs)) {
      // B-3：暂停分支也必须有上界（原来完全没有）
      const curTotal = phaseDurationMs(state.settings, phase);
      const snapTotal = clampSnapshot(session.phaseTotalMs, curTotal);
      if (pausedRemainingMs > Math.max(curTotal, snapTotal) + 5000) {
        return { ...withCycle, phase, status: STATUS.idle };
      }
      return {
        ...withCycle, phase, status: STATUS.paused,
        pausedRemainingMs: Math.max(0, pausedRemainingMs),
        phaseTotalMs: snapTotal,
      };
    }
    if (status === STATUS.idle || status === STATUS.finished) {
      return { ...withCycle, phase };
    }
    return state;
  } catch {
    return state;
  }
}

export function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function progressPercent(state, nowMs) {
  const active = state.status === STATUS.running || state.status === STATUS.paused;
  const total = active && Number.isFinite(state.phaseTotalMs)
    ? state.phaseTotalMs
    : phaseDurationMs(state.settings, state.phase);
  if (total <= 0) return 0;
  const rest = remainingMs(state, nowMs);
  const pct = Math.round(((total - rest) / total) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function roundNumber(state) {
  return state.cycleFocus + 1;
}

export function dotsDone(state) {
  return Math.max(0, Math.min(state.settings.longBreakEvery, state.cycleFocus));
}
