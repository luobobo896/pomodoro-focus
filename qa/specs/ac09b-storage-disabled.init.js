// QA 前置：在页面任何脚本执行前把 localStorage/sessionStorage 变成不可用（隐私模式等价）
(() => {
  const boom = () => { throw new DOMException('storage disabled by QA init-script', 'SecurityError'); };
  for (const k of ['localStorage', 'sessionStorage']) {
    try { Object.defineProperty(window, k, { configurable: true, get: boom }); } catch (e) {}
  }
})();
