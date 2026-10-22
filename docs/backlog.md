# 待办与登记（Arch）

> leader 口径（2026-10-22 第二次更新）：B-1、B-2、B-3 **全部提前到本轮终验前一次改完**，改完冻结代码、贴三个 md5，QA 只跑一次终验全量。改完这三项，本文件应只剩"M2 / 不做"两栏。

---

## 本轮改（终验前一次性完成，改完冻结）

### B-1 · 结束态的阶段标签必须显示"刚结束的阶段"

- 来源：PM 提出的口径问题 + leader 裁决
- 现状：`status=finished` 时内部 `phase` 已切到下一阶段 → 面板出现「短休息 · 00:00 · 已结束」，与标题「✓ 专注结束」对不上。
- 实现位置（**只有这一处**，别扩散）：

```js
// assets/js/app.js: buildView()
// ⚠️ 顺序陷阱：当前 :50 的 phaseLabel 在 :53 的 finished 之前。照抄下面这段直接替换
// 会撞 ReferenceError（const 的 TDZ），因为 finished 此刻还没定义。
// 正确做法：把 phaseLabel 这一行挪到 finished 定义之后，再算 displayPhase。
const running = state.status === timer.STATUS.running;
const paused = state.status === timer.STATUS.paused;
const finished = state.status === timer.STATUS.finished;
const locked = Date.now() < lockUntil;
// B-1：结束态展示“刚结束的阶段”。仅展示层映射，内部 state.phase 不动。
const displayPhase = finished && state.finishedPhase ? state.finishedPhase : state.phase;
const phaseLabel = timer.PHASE_LABEL[displayPhase];

// return 对象里（:72 附近，注意是 4 个空格缩进）
    phase: displayPhase,
    phaseLabel,
```

```js
// assets/js/ui.js:80 —— 不改。dataset.phase 继续取 view.phase，颜色自动跟随
els.card.dataset.phase = view.phase;
```

- **硬约束**：内部 `state.phase` 不许改。相位推进、`progressPercent`、恢复语义全依赖它；只改渲染层映射。
- **不改颜色会怎样**：只改文案 → 出现「青绿底色 + 专注标签」，正是 `design.md` §5 警告的强调色不成对切换。
- 门禁：`S-7`（阻断）

### B-2 + B-3 · 上界一律由"配置域"决定，不信存储里的数字

- 来源：`docs/review-2.md` 建议项 A-1 / A-2，leader 决定本轮一并修
- 两个缺陷：`session.phaseTotalMs` 为脏值会把 `endsAt` 上界重新撑大；`pausedRemainingMs` 分支**根本没有上界**。
- 实现位置：`assets/js/timer.js` 的 `restore()` 内，**两处共用一个上界计算**。

```js
// ① 放进 restore() 的 try 内、两个分支之前（或提到模块顶层）
const SNAP_MIN = 60 * 1000;
const SNAP_MAX = 60 * 60 * 1000;                       // 设置项上限就是 60 分钟
const clampSnapshot = (v, fallback) =>
  Number.isFinite(v) && v >= SNAP_MIN && v <= SNAP_MAX ? v : fallback;

// ② running 分支：替换现有的 currentTotal / sessionTotal / maxMs 三行
const curTotal = phaseDurationMs(state.settings, phase);
const snapTotal = clampSnapshot(session.phaseTotalMs, curTotal);
const bound = Math.max(curTotal, snapTotal) + 5000;
if (endsAt > nowMs + bound) return { ...withCycle, phase, status: STATUS.idle };
// 后续 restoredTotal 用 snapTotal（原逻辑：>0 时取快照，否则取当前设置）

// ③ paused 分支：同样先判上界，再接受
if (status === STATUS.paused && Number.isFinite(pausedRemainingMs)) {
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
```

- 关键点：**上界只从"设置允许的 1-60 分钟"里取**，存储里的 `phaseTotalMs` 只有落在 1-60 分钟区间内才被采信。这样"改短时长后刷新、剩余 15 分钟"仍然合法（快照 25 分钟在区间内），而 `9e12` 这种脏值一律不认。
- 门禁：`A-1`、`A-2`（阻断）

---

## 改完怎么验收（一条命令，自带 md5）

```bash
cd /Users/hanson/work/个人文档/pomodoro-focus
node docs/verify-fixes.mjs      # 退出码 0 = 24 项阻断全过，并打印三个文件的 md5
```

当前快照（改动前）：**阻断 24 项，通过 21，失败 3 —— A-1、A-2、S-7**，正好是本轮要改的这三处，其余全绿。改完这三项，应当 24/24。

**这套补丁已在沙盘预演过**（复制到 `/tmp/pf-preview` 应用后跑同一脚本）：`GATE: PASS (24/24) — 退出码 0`，预演得到的预期指纹：

```
index.html         2fd50b40…（不变）
assets/styles.css  907013e6…（不变）
assets/js/timer.js b4bbbe2b…
assets/js/ui.js    b0dfc293…（不变，B-1 不用改它）
assets/js/app.js   fe41e31a…
```

Dev 若与这三个预期值不同但门禁 24/24 通过，也认（说明实现路径不同但行为一致），不要求逐字节一致。

---

## 影响面口径（A-1/A-2 若被利用）

最大影响是"本机计时器失效、可自行恢复"：需有人手工往本机 `localStorage` 的 `pomodoro-focus:v1` 写脏数字；后果是页面显示 `150000000:00`、计时永不结束，清 key 或"恢复默认"即恢复。不泄露数据、不涉及他人、不波及同域其它站点（key 带项目前缀），无法通过链接或请求参数触发。

---

## 不做（M1 明确不含）

| 项 | 结论 |
|---|---|
| `sound` 提示音 | 仅预留字段、无消费方；PM 确认属 P1 未实现，报告不得写成已做 |
| 多标签页同步（`storage` 事件） | 非目标 |
| PWA / 离线 | 非目标；子路径下 scope 需单独评审 |
| 统计报表 / 云同步 / 账号 | 非目标 |

---

*维护人：Arch｜新增项请注明来源（PM 需求 / 审查发现 / 运维反馈）与所属里程碑*
