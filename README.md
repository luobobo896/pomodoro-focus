# 番茄时钟（pomodoro-focus）

零依赖、零构建的原生单页番茄钟：三阶段倒计时（专注 25 / 短休 5 / 长休 15）、开始暂停继续重置跳过、自动流转、番茄计数、刷新恢复、移动优先、子路径部署。

- 功能与验收口径：`docs/requirements.md`
- 视觉与交互规范：`docs/design.md`
- 技术方案与接口契约：`docs/architecture.md`（§4 是 Dev/QA 共用的契约）

## 结构

```
index.html              唯一入口
assets/styles.css       全部样式（token 来自 docs/design.md §3）
assets/js/timer.js      纯计时核心（状态机 + 相位推进，无 DOM/存储）
assets/js/storage.js    localStorage 读写与容错（不可用时静默降级）
assets/js/ui.js         只做渲染与事件绑定（不持有 setInterval）
assets/js/app.js        启动装配、唯一 tick 来源、持久化节流、调试钩子
```

不引任何外部字体、图标库、CSS 框架或统计脚本；首屏只有 1 HTML + 1 CSS + 1 JS。

## 本地预览（必须走 http，且保留子路径）

本项目用 ES Module 加载 `./assets/js/*.js`。**`file://` 打不开**：Chrome / Edge 会以 CORS 策略拦截 `file://` 下的模块脚本（控制台报 `blocked by CORS policy`），这是浏览器安全限制，不是代码缺陷。本地验证请用 http，并保留 `/pomodoro-focus/` 子路径前缀，才能同时验证相对路径与 404 风险：

```bash
cd /Users/hanson/work/个人文档/pomodoro-focus
rm -rf /tmp/pf-serve && mkdir -p /tmp/pf-serve
ln -sfn "$PWD" /tmp/pf-serve/pomodoro-focus
python3 -m http.server 8124 --bind 127.0.0.1 --directory /tmp/pf-serve
# 打开 http://127.0.0.1:8124/pomodoro-focus/
```

## 调试钩子（仅测试用）

URL 带 `?debug=1` 时才会挂载 `window.__pf`（`getState()` / `advance(ms)` / `setDurations()` / `resetStorage()`）。它**只用于自动化测试**：`advance()` 直接推进 `endsAt`，不会真等 25 分钟；`setDurations()` 可把时长改到 1 分钟。

- 不带 `?debug=1` 时 `window.__pf` 必须是 `undefined`（线上不会暴露调试口）。
- 调试钩子不产生任何持久影响：刷新后仍以 URL 参数决定是否挂载。

## 快捷键

`Space` / `Enter` = 开始 / 暂停 / 继续；`R` = 重置（焦点在输入控件时不拦截）。

## 部署

静态文件放进现有站点 root 的一级子目录即可（nginx 零改动，见 `docs/architecture.md` §5）；部署与回滚由 Ops 执行，本仓库不含任何服务器配置。
