// storage.js —— localStorage 读写与容错。无 DOM；存储不可用时静默降级为内存态。
// 契约：docs/architecture.md §4.3 / §4.4（唯一 key、schemaVersion、坏数据自愈、禁止 alert）。

export const KEY = 'pomodoro-focus:v1';
export const SCHEMA_VERSION = 1;

/**
 * 探测可用的 localStorage。隐私模式 / 被禁用时返回 null，调用方不得报错或提示。
 * @param {Window|null} win
 */
export function createStorage(win = typeof window !== 'undefined' ? window : null) {
  let backend = null;
  try {
    const ls = win && win.localStorage;
    if (ls) {
      const probe = '__pomodoro_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      backend = ls;
    }
  } catch {
    backend = null;
  }

  const available = Boolean(backend);

  /** @returns {{settings?:object, stats?:object, session?:object}|null} */
  function load() {
    if (!backend) return null;
    try {
      const raw = backend.getItem(KEY);
      if (!raw) return null;
      const doc = JSON.parse(raw);
      if (!doc || typeof doc !== 'object') return null;
      if (doc.schemaVersion !== SCHEMA_VERSION) return null;
      return { settings: doc.settings, stats: doc.stats, session: doc.session };
    } catch {
      // JSON 解析失败 / 结构不对：丢弃，按默认值启动
      return null;
    }
  }

  function save({ settings, stats, session }) {
    if (!backend) return false;
    try {
      backend.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, settings, stats, session }));
      return true;
    } catch {
      // quota / 写入被拒：静默忽略，功能继续
      return false;
    }
  }

  function reset() {
    if (!backend) return false;
    try {
      backend.removeItem(KEY);
      return true;
    } catch {
      return false;
    }
  }

  return { available, load, save, reset, key: KEY };
}
