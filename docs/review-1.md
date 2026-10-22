# 代码审查 · 第 1 轮（Arch）

> **⚠️ 本文件是「缺陷现场记录」，不是契约。** 下面的节点、行号、数值（如 `phase=shortBreak / remainingMs=300000 / 大字=05:00`）都是**修复前**的复现证据，用于证明缺陷真实存在，修复后已全部不成立。
> **行为契约以 `docs/architecture.md` §4 为准**：结束态为「刚结束的阶段 · `00:00` · 已结束 · 100% · `✓ <阶段>结束`」，点主按钮后才切下一阶段。引用前请先看契约，别把这里的旧数值当成要求。

- 审查对象：`index.html`、`assets/styles.css`、`assets/js/{app,timer,storage,ui}.js`，合计 1064 行
- 审查依据：`docs/architecture.md` §3/§4（计时模型、DOM 契约、存储契约、降级表）
- 审查方式：逐文件通读 + Node 直接跑 `timer.js`（它被设计为无 DOM 依赖，可单测）验证边界
- 结论：**打回**。4 个必须修的问题（1 high 白屏、1 high 语义矛盾、2 medium），修完自验后再交 QA

---

## 必须修（blocker / high）

### F-1 · 存储数据为 `null` 时整页白屏 —— high

- 位置：`assets/js/timer.js:33`（`normalizeSettings(input = {})`）、`timer.js:61-71`（`createState`）、`timer.js:179-181`（`restore` 里 `createState` 在 `try` **之外**）
- 证据（Node 实测）：

```
restore{settings:null} => THROW: TypeError Cannot read properties of null (reading 'focusMin')
normalizeSettings(null) => THROW: TypeError Cannot read properties of null (reading 'focusMin')
```

- 触发路径：`localStorage` 里存在 `{"schemaVersion":1,"settings":null,...}`（手工改过、旧版本写入、同步异常、或别的脚本污染）→ `storage.load()` 版本号校验能通过 → `restore()` 第一行 `createState(null)` 抛错 → `app.js:15` 未捕获 → **白屏**。
- 为什么算 high：违反 `docs/architecture.md` §4.4「坏数据自愈」与 PM `AC-09`（存储不可用时**不白屏**）。默认参数只在 `undefined` 时生效，`null` 会穿透——这是 JS 里最常见的一类漏项。
- 修复（两处都改，纵深防御）：
  1. `normalizeSettings` 里先归一：`const src = input && typeof input === 'object' ? input : {};`，后续全部读 `src`；
  2. `restore()` 里把 `const state = createState(settings, stats)` 移到 `try` 内，或改成 `createState(settings || {}, stats || {})`。

### F-2 · 阶段结束瞬间，大字时间与「已结束」互相矛盾 —— high

- 位置：`timer.js:75-83`（`remainingMs` 对 `finished` 落到了"按当前相位满时长"分支）
- 证据（Node 实测，跑完一个 25 分钟专注）：

```
结束后: status=finished phase=shortBreak remainingMs=300000 显示=05:00 progress=0
```

- 现象：结束那一刻 `advance()` 已把 `phase` 切到 `shortBreak`，但 `status` 是 `finished`，`remainingMs` 于是返回**下一阶段的满时长**。同屏出现：大字 `05:00`、阶段标签「短休息」、状态「已结束」、标题「✓ 专注结束」、进度条归零。用户看到的是"下个阶段还没开始却显示满时长，同时又说已结束"，结束提示失去了意义。
- 为什么算 high：PM 的"阶段结束要有视觉提示"与 Design §5「结束提示保持到下次操作」都依赖这一刻的显示。QA 按 AC 写断言时，`time-display` 在结束后应显示什么会直接卡住。
- 修复（最小改动，不动 UI 层与设计规范）：

```js
export function remainingMs(state, nowMs) {
  if (state.status === STATUS.finished) return 0;   // 本轮剩余必须是 0
  ...
}
```

  `progressPercent` 随之得 100；`start()` 不读 `remainingMs`（对 `finished` 走"新相位满时长"分支），不受影响。改完大字 `00:00` + 「已结束」+ 100% 进度 + 标题「✓ 专注结束」，语义自洽。

---

## 应该修（medium）

### F-3 · 运行中改时长，进度条被重置 —— medium

- 位置：`timer.js:218-224`（`progressPercent` 用实时 `phaseDurationMs`）、`app.js:117-123`（`onSettingChange`）
- 证据（Node 实测，25 分钟跑到第 10 分钟时把专注改成 10 分钟）：

```
进度 40 -> 改后 0    剩余仍为 15:00
```

- 现象：剩余时间正确（`endsAt` 不变，符合 FR-07「运行中改时长不立即改变当前相位」），但进度条从 40% 跳回 0%，视觉上像被重置。
- 修复：`state` 增加 `phaseTotalMs`，在 `start()` 时快照（`paused` 续跑时沿用旧快照），`progressPercent` 用快照：

```js
const total = (state.status === STATUS.running || state.status === STATUS.paused) && Number.isFinite(state.phaseTotalMs)
  ? state.phaseTotalMs
  : phaseDurationMs(state.settings, state.phase);
```

  备选（更省事但体验差）：运行中把时长输入 `disabled`，提示"结束后可改"。

### F-4 · 异常的 `endsAt` 没有上界校验 —— medium

- 位置：`timer.js:187-197`（`restore` 接受任意未来 `endsAt`）
- 证据（Node 实测，注入 `endsAt = now + 9e12`）：

```
异常未来 endsAt: 剩余=150000000:00
```

- 现象：大字被撑破布局，且永远不结束（等于计时器死了）。来源可能是时钟回拨、手工改存储、或未来某版本写坏。
- 修复：接受 `running` 前加上界校验，超出即按满时长重置：

```js
const maxMs = phaseDurationMs(state.settings, phase) + 5000;   // 5s 容差
if (endsAt > nowMs + maxMs) return { ...state, phase, status: STATUS.idle };
```

---

## 小问题（low，顺手改，不必单独提交）

- **F-5** `ui.js:62-105`：`els.time.textContent` 等一律无空值保护，任一 `data-testid` 缺失就是 TypeError 白屏。`els.start?.addEventListener` 用了 `?.`，渲染路径却没用，不一致。建议渲染前一次性校验必需元素，缺了直接抛带名字的 `Error`（比 `Cannot read properties of null` 好定位）。
- **F-6** `timer.js:17`：`sound` 保留在 schema 里但既无 UI 也无任何使用点，属死配置。leader 已定"提示音 P1、默认关闭"，保留字段本身没问题，但请在注释里标明"预留、当前无消费方"，避免后面有人以为它生效。
- **F-7** `timer.js:226-228`：第 4 个专注结束进入长休时，`roundNumber` 返回"第 5 轮"、`dotsDone` = 4/4。功能上说得通，但 Design 的"第 N 轮"口径是否指"本轮内第几个"需要 QA 与 Design 对齐，别两边各写一套断言。

---

## 已核通过（不用改，避免 QA 重复排查）

| 项 | 结论 |
|---|---|
| 只存 `endsAt`、tick 只重绘 | 符合 §3；`setInterval` 仅在 `app.js:147`，`ui.js` 无定时器 |
| 相位推进幂等 | 实测连续 tick 只推进一格 |
| 4 个专注 → 长休 → 归零 | 实测序列 `short→focus→short→focus→short→focus→longBreak→focus`，计数正确 |
| 暂停/继续精度 | 暂停 10 分钟后剩余不变，继续后仍 1440000ms，一致 |
| 跳过不计数 | 实测 `completedFocus` 保持 0 |
| 过期即结算只加一次 | 连续两次"重启"不重复计数（`completed` 保持 1） |
| 未到期恢复 | `running` + 剩余 10:00 正确；`paused` 恢复 02:03 正确 |
| `autoStartNext` | 结束后自动进 `running`，短休显示 05:00 正确 |
| 相对路径 / 零外链 | 4 条 grep 全部无输出；11 个 `data-testid` 全部存在且唯一 |
| 存储 key / schemaVersion / 降级 | `pomodoro-focus:v1`，探测写入 + 全 try/catch，无 `alert` |
| `?debug=1` 钩子 | 仅 debug 挂载，`advance/setDurations/resetStorage` 齐备 |

---

## 给 QA 的一条口径（配合 F-2 一起看）

主按钮是**两个 DOM 节点**（`btn-start` / `btn-pause`），非当前态那个是 `hidden + disabled`（符合 Design"同一个按钮换文案"）。所以用例里**不要**直接 `click('[data-testid=btn-start]')` —— 运行中它 `hidden`，无头浏览器会报 "element is not visible"。统一用可定位选择器：

```js
const primary = page.locator('[data-testid=btn-start]:not([hidden]), [data-testid=btn-pause]:not([hidden])');
await primary.click();
```

同样，断言大字时用 `time-display`，断言结束提示用 `status-label` + `document.title`，别只断言大字（F-2 修好后大字是 `00:00`）。

---

*审查人：Arch｜依据 commit：工作区未提交版本（`git status` 干净时以当前文件为准）*
