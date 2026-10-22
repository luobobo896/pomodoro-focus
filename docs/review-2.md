# 代码审查 · 第 2 轮（复审）

> **⚠️ 本文件是「复审记录」，不是契约。** 文中引用的修复前现象（如 `phase=shortBreak`、`大字=05:00`、`进度=0`）是缺陷复现证据，现已全部修复。
> **当前行为契约见 `docs/architecture.md` §4**（结束态五项一致）；本轮修复后门禁结果见下方"第 3 轮实测快照"。

- 复审对象：`assets/js/timer.js`（16:00 版）、`assets/js/app.js`（15:58 版）、`assets/styles.css`（15:59 版）
- 上一轮：`docs/review-1.md`（F-1 ~ F-7）
- 复审方式：与第 1 轮同一套 Node 实测脚本，对当前文件重跑
- 结论：**F-1 ~ F-4 四项全部仍未修复**，实测输出一致。本轮 Dev 改的是 debug 时钟（`advance` 改推进 `endsAt`、持久化 `cycleFocus`）+ CSS 两个问题，方向正确，但不在这四项之内。

---

## 一、四项实测复现（当前代码）

```
F-1 restore{settings:null}     => THROW: Cannot read properties of null (reading 'focusMin')
F-2 结束后                     => status=finished phase=shortBreak 大字=05:00 进度=0
F-3 运行中改 25→10 分钟         => 进度 40 -> 0  剩余 15:00
F-4 异常 endsAt                => 剩余=150000000:00
```

---

## 二、修复补丁（可直接抄）

### F-1 · `null` 存储白屏（high）

`timer.js` 里两处：

```js
export function normalizeSettings(input = {}) {
  const src = input && typeof input === 'object' ? input : {};   // ← 加这一行
  return {
    focusMin: clampInt(src.focusMin, 1, 60, DEFAULTS.focusMin),
    shortBreakMin: clampInt(src.shortBreakMin, 1, 60, DEFAULTS.shortBreakMin),
    longBreakMin: clampInt(src.longBreakMin, 1, 60, DEFAULTS.longBreakMin),
    longBreakEvery: clampInt(src.longBreakEvery, 2, 8, DEFAULTS.longBreakEvery),
    autoStartNext: Boolean(src.autoStartNext),
    sound: src.sound === undefined ? DEFAULTS.sound : Boolean(src.sound),
  };
}
```

`restore()` 里把 `createState` 收进 `try`（现在它在 `try` 之外，异常会直接冒到 `app.js:15`）：

```js
export function restore({ settings, stats, session } = {}, nowMs) {
  try {
    const state = createState(settings || {}, stats || {});   // ← 挪进来
    ...
```

两处都改，纵深防御：一处兜住数据，一处兜住调用点。

### F-2 · 结束后大字与状态矛盾（high）

`timer.js` 的 `remainingMs` 第一行加：

```js
export function remainingMs(state, nowMs) {
  if (state.status === STATUS.finished) return 0;   // ← 加这一行
  ...
```

连带效果（不用再改）：`progressPercent` 自动得 100；`start()` 不读 `remainingMs`（对 `finished` 走"新相位满时长"分支），所以点「开始」仍能正常进入下一阶段。

### F-3 · 运行中改时长导致进度条跳变（medium）

三处：

```js
// createState：新增字段
phaseTotalMs: null,

// start()：快照本相位总时长（暂停续跑沿用旧快照）
const total = state.status === STATUS.paused && Number.isFinite(state.phaseTotalMs)
  ? state.phaseTotalMs
  : phaseDurationMs(state.settings, state.phase);
return { ...state, status: STATUS.running, endsAt: nowMs + remaining, pausedRemainingMs: null, finishedPhase: null, phaseTotalMs: total };

// progressPercent：运行/暂停用快照
const total = (state.status === STATUS.running || state.status === STATUS.paused) && Number.isFinite(state.phaseTotalMs)
  ? state.phaseTotalMs
  : phaseDurationMs(state.settings, state.phase);
```

可选：`toSession` 一并持久化 `phaseTotalMs`，否则"运行中改过时长 → 刷新"后进度条仍会按新设置重算一次。

### F-4 · 异常 `endsAt` 无上界（medium）

`restore()` 的 `running` 分支、接受 `endsAt` 之前：

```js
const maxMs = phaseDurationMs(state.settings, phase) + 5000;   // 5s 容差
if (endsAt > nowMs + maxMs) return { ...withCycle, phase };    // 丢弃脏数据，按满时长重置为 idle
```

---

## 三、本轮新发现

### N-1 · ~~CSS 注释与实现不符，跳过按钮独占半行~~ —— **本条是我的误判，撤回**

- 原判断：`grid-column: 1` 只写在 `@media (min-width: 472px)` 里，认为窄屏主按钮只占半宽。
- 复核结论：**错**。`assets/styles.css:239` 的 `.btn--primary` 基础规则里已经有 `grid-column: 1 / -1`，窄屏确实是主按钮独占一行、次按钮并排，与注释一致。我上一轮只 grep 了 `.controls` 段就下结论，没有读 `.btn--primary` 的完整规则块——这是我的读取范围不足，实现没有问题。
- 结论：CSS 无需改动，`[hidden]` 与网格两处都是对的。
- 教训（给我自己的检查脚本）：检查 CSS 命中要按**声明块归属**读，不能只按选择器片段 grep；已把该断言改成对 `.btn--primary{...grid-column: 1 / -1}` 的块内匹配（见 `docs/verify-fixes.mjs` S-5）。

### N-2 · 已确认修好的两处

- `[hidden]` 被 `.settings{display:flex}` 覆盖 → 已加 `[hidden]{display:none!important}`，正确。
- `advance()` 改全局偏移导致刷新后凭空多 32 分钟 → 改成直接推进 `endsAt` 并持久化 `cycleFocus`，与 §3「单一时间源存 deadline」一致，正确。

---

## 四、同步审查：`ops/nginx/pomodoro-focus.conf`（架构侧，非上线批准）

**结论：片段本身通过，与我的方案 B 要求逐条对得上。**

- 两条 location、`^~` 前缀、`root /var/www` 显式写、无 `alias`、无 `try_files`、无 `autoindex`、不引用任何既有 location ✓
- 内嵌 `location ^~ /pomodoro-focus/assets/` 不新增对外路径，仍在外层前缀内 ✓
- 子块声明了 `add_header` → 不再继承父块的 `no-cache` → 实际只吐一条 `Cache-Control`，与 Ops 实测一致 ✓（这正是我方案里担心的双头问题，处理对了）

三条备注：

1. **`add_header` 的继承是"全有或全无"**：子块一旦声明 `add_header`，父块的**所有** `add_header` 都不再继承。目前子块重复了 `X-Content-Type-Options`，所以没问题；但以后父块若加任何安全头（`Referrer-Policy` 等），**必须同步加到子块**。建议把这条写进片段顶部注释，否则下一个人一定会踩。
2. `/pomodoro-focus` 无尾斜杠时走 `return 301`，QA 请统一用**带斜杠**的地址测（`/pomodoro-focus/?debug=1`），避免 301 一跳再引入 query 保留与否的不确定性，测出来的东西才是线上真实形态。
3. `assets` 只覆盖 `assets/` 目录，若将来加根级 `favicon.ico`/`manifest.json` 会吃 `no-cache`。当前用 `<link rel="icon" href="data:,">` 规避了，无影响，记录备查。

---

## 五、复审门禁

F-1、F-2 不修，QA 的 `AC-04`（重置/结束态）与存储降级类用例必挂；F-3、F-4 会让进度条与极端数据下的显示出错。四项一起修完，Dev 一次性报自查结果，我再复审。

### 可执行门禁（不用等我口头判断）

第 3 轮起，这四项的判定不靠读代码，直接跑脚本：

```bash
cd /Users/hanson/work/个人文档/pomodoro-focus
node docs/verify-fixes.mjs     # 退出码 0 = 四项已修好且无回归；1 = 不可放行
```

脚本内容：`F-1a~c`（坏数据不白屏）、`F-2`（结束态四项一致）、`F-3`（进度不跳变）、`F-4`（`endsAt` 上界）、`R-1~9`（主干回归：相位链路、暂停精度、跳过不计数、过期只结算一次、未到期恢复、autoStartNext、幂等、格式化）、`S-1~6`（静态契约：11 个 testid、零外链/无绝对路径、无 alert、`[hidden]` 兜底、主按钮网格、`ui.js` 无 `setInterval` 调用）。共 21 项。

**Dev 自验请直接跑它，贴输出即可；我复审也跑同一份。**

### 第 3 轮实测快照（2026-10-22 16:16，`timer.js` md5 `7bda4051` / 284 行）

```
阻断项 21 项：通过 21，失败 0
建议项 2 项未过：A-1, A-2
判定：可以放行
```

**F-1 ~ F-4 全部真修好**，主干回归（R-1~9）与静态契约（S-1~6，testid 已按 leader 裁决扩到 16 个）全绿。

### 建议项 A-1 / A-2：F-4 的上界可以由不可信数据推导（不阻塞放行）

Dev 修 F-4 时，为了保住「运行中把时长改短、刷新后剩余 15 分钟」这个合法场景，把上界改成了 `max(当前设置时长, session.phaseTotalMs) + 5000`。方向对，但 `phaseTotalMs` 本身来自 `localStorage`，同属不可信输入，于是上界又可以被脏数据撑大：

```
A-1  脏 phaseTotalMs(9e12) + 脏 endsAt  => status=running 剩余=9000000000000ms（150000000:00）
A-2  暂停态只有 pausedRemainingMs，完全没有上界 => status=paused 剩余=9000000000000ms
```

判断为**建议项而非阻断项**的理由：可达性要求手工改了 localStorage 里两个字段（A-1）或一个字段（A-2），不涉及网络攻击面；而 F-4 要防的"单个脏 `endsAt`"已经被挡住了。同时 A-2 是**暂停分支从一开始就没有上界**，不属于本轮引入。

**修复（2 处，约 6 行，Dev 顺手带上即可）**——把上界统一成"由配置域钳制"，而不是"由存储里的数字钳制"：

```js
const clampTotal = (v, fallback) => (Number.isFinite(v) && v >= 60000 && v <= 60 * 60000
  ? v : fallback);                                   // 1-60 分钟之外的快照一律不信
const curTotal = phaseDurationMs(state.settings, phase);
const maxMs = Math.max(curTotal, clampTotal(session.phaseTotalMs, curTotal)) + 5000;

// running / paused 两个分支都用 maxMs 判上限，超出即 { ...withCycle, phase, status: STATUS.idle }
```

---

*审查人：Arch｜第 2 轮｜上一轮：`docs/review-1.md`*
