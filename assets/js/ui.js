// ui.js —— 只做渲染与事件绑定，不含计时逻辑、不持有 setInterval。
// DOM 契约：docs/architecture.md §4.1（data-testid 名字不可改）。

export function createUI(handlers = {}, doc = document) {
  const byId = (id) => doc.querySelector(`[data-testid="${id}"]`);
  const els = {
    card: doc.querySelector('.card'),
    time: byId('time-display'),
    phase: byId('phase-label'),
    status: byId('status-label'),
    round: byId('round-count'),
    start: byId('btn-start'),
    pause: byId('btn-pause'),
    reset: byId('btn-reset'),
    skip: byId('btn-skip'),
    settingsBtn: byId('btn-settings'),
    panel: byId('settings-panel'),
    progress: byId('progress'),
    bar: doc.querySelector('.progress__fill'),
    dots: doc.querySelector('.dots'),
    dotCaption: doc.querySelector('.dot-caption'),
    stats: doc.querySelector('.stats'),
    hint: doc.querySelector('.settings__hint'),
    restoreBtn: doc.querySelector('[data-action="restore-defaults"]'),
    fields: {
      focusMin: doc.getElementById('set-focus'),
      shortBreakMin: doc.getElementById('set-short'),
      longBreakMin: doc.getElementById('set-long'),
      longBreakEvery: doc.getElementById('set-every'),
    },
  };

  // F-5：渲染前一次性校验必需元素，缺了直接抛带名字的 Error，而不是 Cannot read properties of null
  const REQUIRED = [
    'time-display', 'phase-label', 'status-label', 'round-count',
    'btn-start', 'btn-pause', 'btn-reset', 'btn-skip',
    'btn-settings', 'settings-panel', 'progress',
  ];
  const missing = REQUIRED.filter((id) => !els[{
    'time-display': 'time', 'phase-label': 'phase', 'status-label': 'status',
    'round-count': 'round', 'btn-start': 'start', 'btn-pause': 'pause',
    'btn-reset': 'reset', 'btn-skip': 'skip', 'btn-settings': 'settingsBtn',
    'settings-panel': 'panel', progress: 'progress',
  }[id]]);
  if (missing.length) throw new Error(`缺少必需元素: ${missing.join(', ')}`);

  let flashTimer = 0;

  els.start?.addEventListener('click', () => handlers.onPrimary?.());
  els.pause?.addEventListener('click', () => handlers.onPrimary?.());
  els.reset?.addEventListener('click', () => handlers.onReset?.());
  els.skip?.addEventListener('click', () => handlers.onSkip?.());
  els.settingsBtn?.addEventListener('click', () => handlers.onToggleSettings?.());
  els.restoreBtn?.addEventListener('click', () => handlers.onRestoreDefaults?.());

  for (const [name, input] of Object.entries(els.fields)) {
    if (!input) continue;
    input.addEventListener('change', () => handlers.onSettingChange?.(name, input.value));
  }

  function renderDots(done, total) {
    if (!els.dots) return;
    if (els.dots.children.length !== total) {
      els.dots.replaceChildren(...Array.from({ length: total }, () => {
        const dot = doc.createElement('i');
        dot.className = 'dot';
        return dot;
      }));
    }
    Array.from(els.dots.children).forEach((dot, i) => {
      dot.dataset.done = i < done ? '1' : '0';
    });
  }

  function render(view) {
    els.time.textContent = view.timeText;
    els.phase.textContent = view.phaseLabel;
    els.status.textContent = view.statusLabel;
    els.round.textContent = view.roundText;
    els.card.dataset.phase = view.phase;

    els.progress.setAttribute('aria-valuenow', String(view.progress));
    els.bar.style.width = `${view.progress}%`;

    renderDots(view.dotsDone, view.dotsTotal);
    els.dotCaption.textContent = `${view.dotsDone} / ${view.dotsTotal}`;

    // 主按钮契约：btn-start 与 btn-pause 都必须存在于 DOM，非当前态的一个隐藏且禁用
    if (view.primary.usePause) {
      els.start.hidden = true;
      els.start.disabled = true;
      els.pause.hidden = false;
      els.pause.disabled = view.primary.disabled;
      els.pause.textContent = view.primary.label;
    } else {
      els.pause.hidden = true;
      els.pause.disabled = true;
      els.start.hidden = false;
      els.start.disabled = view.primary.disabled;
      els.start.textContent = view.primary.label;
    }

    if (view.statsText) {
      els.stats.hidden = false;
      els.stats.textContent = view.statsText;
    } else {
      els.stats.hidden = true;
      els.stats.textContent = '';
    }

    doc.title = view.title;

    els.panel.hidden = !view.settingsOpen;
    els.settingsBtn.setAttribute('aria-expanded', view.settingsOpen ? 'true' : 'false');

    for (const [name, input] of Object.entries(els.fields)) {
      if (input && doc.activeElement !== input) input.value = String(view.settings[name]);
    }
    els.hint.textContent = view.hint || '';
  }

  // 阶段结束的短暂高亮（Design FR-06a：不弹窗、不弹条）
  function flash() {
    if (!els.card) return;
    els.card.classList.add('is-ended');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => els.card.classList.remove('is-ended'), 1300);
  }

  return { render, flash, els };
}
