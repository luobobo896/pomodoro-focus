# 番茄时钟 · QA 测试用例（18 条 AC + 6 条契约用例）

> 依据：`docs/requirements.md` §4（AC 唯一定义）与 `docs/architecture.md` §4（DOM/localStorage/debug 契约）。
> 状态：**只写不跑**（leader 指示）。等 Dev 交付、Arch 审查通过后一次性执行，全程无头，每轮写 `test-runs.log`。
> 用例文件：`qa/specs/*.json`；运行器：`qa/run-ac.sh`；静态检查：`qa/static-check.sh`。

## 0. 环境与约定

| 项 | 值 |
|---|---|
| 本地等价地址 | `http://127.0.0.1:8231/pomodoro-focus/`（在 `/Users/hanson/work/个人文档` 下起 `python3 -m http.server 8231`，与线上同子路径） |
| 线上地址 | `https://hk.hsddns.com/pomodoro-focus/`（仅 AC-16，上线后由 leader 放行再验） |
| 调试钩子 | URL 带 `?debug=1` 才挂 `window.__pf`；**非 debug 下必须 `undefined`**（C-02） |
| 受控时钟 | 25 分钟不做真等待，一律 `__pf.advance(ms)` 推进 `endsAt`；只有 AC-02/03 用真实 `waitMs` 验证"真的在走" |
| 通道 | 默认无头（`real-browser.sh` 无头模式）或 Orca 内嵌标签页；**不起有头窗口**；多轮在同一实例内跑完 |
| 断言口径 | `innerText`（可见文本）；`document.title`、`localStorage`、`scrollWidth`、计算样式必须走 `eval` |
| 证据 | 每例：json（绝对路径）+ 截图 + 快照文本；console/pageerror/http 任一非空即 fail（favicon 404 除外） |

## 1. 18 条 AC 用例

| 用例 | AC | P | 可执行步骤（我脚本里的实际动作） | 断言（可判定） | 依赖 |
|---|---|---|---|---|---|
| `ac01-firstpaint` | AC-01 | P0 | `goto ?debug=1` | `time-display`=`25:00`、`phase-label`=专注、`status-label`=就绪、`round-count`=第 1 轮；title=`25:00 · 专注`；console/pageerror/http 全 0；`settings-panel` 不可见 | eval |
| `ac02-start` | AC-02 | P0 | `click 开始` → `waitMs 3200` | `status-label`=进行中；`btn-start` 隐藏或禁用、`btn-pause` 可用；`time-display` 换算秒 ∈ [24:56, 24:58] | eval |
| `ac03-pause-resume` | AC-03 | P0 | `click 开始` → `waitMs 1500` → `click 暂停` → `waitMs 3000` → `click 继续` → `waitMs 1500` | 暂停期间 `remainingMs` 三次读数完全相等；继续后 `remainingMs` 严格小于暂停值且 > 暂停值−5s（不回退到整点）；状态回到进行中 | eval |
| `ac04-reset` | AC-04 | P0 | `click 开始` → `waitMs 2000` → `click 重置` | `time-display`=`25:00`、`status-label`=就绪、`btn-start` 可见、`round-count` 仍为第 1 轮（已完成数不变） | eval |
| `ac05-focus-to-short` | AC-05 | P0 | `click 开始` → `eval advance(focusMin*60000-2000)` → `waitMs 2500` → 断结束态 → `click 开始` | 结束瞬间**四项一起断**：`status-label`=已结束、`time-display`=`00:00`、`progress.aria-valuenow`=100、`title`=`✓ 专注结束`，且 `phase-label`=短休息、`round-count`=第 2 轮；点开始后才断 `05:00`/进行中（见 §2.2） | eval |
| `ac06-07-cycle` | AC-06/07 | P0 | 4 轮：开始→advance(满时长−2s)→等 2.5s→跳过→开始；第 4 次结束断四项→开始长休→再 advance 到结束 | 第 4 个专注结束：长休息 + 第 5 轮 + 已结束/`00:00`；点开始后 `15:00`；长休结束：专注 + 第 1 轮 + 已结束/`00:00`；再开始 `25:00` | eval |
| `ac08-reload` | AC-08 | P0 | `click 开始` → `waitMs 1200` → 把 `remainingMs` 写进 `sessionStorage` → `goto` 同 URL（刷新） | 刷新后：`phase-label`=专注、`status-label`=进行中、`round-count` 不变、`remainingMs` 与刷新前差 ≤2000ms | eval |
| `ac09-bad-storage` | AC-09 | P0（部分） | (a) `eval` 把 key 写成 `not-json{{{` → `goto` 同 URL → 断言 25:00 且 `__pf` 可用、无白屏 | **完全禁用 localStorage** 需在页面加载前注入覆盖脚本（runner 需 `--init-script`），当前**未覆盖**，见 §3 缺口 G5 | eval +（G5 待补） |
| `ac10-skip` | AC-10 | P0 | `click 跳过`（专注任意状态）→ 再 `click 开始` → `click 跳过` | `phase-label`=短休息、`round-count` 不增加（仍第 1 轮） | eval |
| `ac11-clock-accuracy` | AC-11 | P0 | `click 开始` → `eval advance(300000)`（模拟离开 5 分钟） | 剩余 = 20:00 且误差 ≤2s；阶段仍为专注、未误跳；不出现负值 | eval |
| `ac12-expired-while-away` | AC-12 | P0 | `click 开始` → `eval advance(focusMin*60000-10000)` → `eval advance(30000)`（离开 30s，期间已到期）→ `waitMs 1500` | 已进短休息、`round-count`=第 2 轮；剩余 ∈ [04:30, 05:00]；再等 1.5s 仍是短休息、计数不再增加（不重复跳） | eval |
| `ac13-mobile` | AC-13 | P0 | `viewport 360x640` → `goto ?debug=1` | `documentElement.scrollWidth ≤ 360`；`btn-start/reset/skip/settings` 全部 `rect` 在视口内且可点；`time-display` 字号 ≥ body 字号 ×2；截图 360×640 | eval |
| `ac14-keyboard` | AC-14 | P0 | `focus btn-start` → `press Enter` → `press Space` | 计时开始、焦点框可见（`outline`/`box-shadow` 非 none） | **阻断：runner 缺按键步 G4** |
| `ac15-subpath` | AC-15 | P0 | `goto /pomodoro-focus/`；再 `goto /pomodoro-focus`（无尾斜杠） | 无尾斜杠 301→200 最终可用；`httpErrors` 空（无 404/5xx）；`performance` 资源条目全部非 4xx；源码无 `/assets/` 绝对路径（`static-check.sh`） | eval + 静态 |
| `ac16-existing-site` | AC-16 | P0 | 上线后只读：`curl -sI` 比对上线的基线（`/`→301 `/whtasapp/`、`/whtasapp/`、`/health`、`/api/`） | 状态码与 Location 与基线逐条一致；`nginx -t` 通过 | **生产，需 leader 放行，不在此本地跑** |
| `ac17-settings` | AC-17 | P1 | `click 设置` → 填专注时长 `1` → 保存 → `click 开始` → 断言 `01:00` → `goto` 刷新 → 仍 `01:00` → 设置里点「恢复默认」 | 开始即 `01:00`；刷新后仍 1 分钟；恢复默认后 `25:00` | **G2：设置面板内部缺少 testid**，暂按可见文本定位 |
| `ac18-title` | AC-18 | P1 | `click 开始` → `waitMs 1500` → 取 `document.title`；再 `waitMs 1500` 再取；`advance` 到结束后再取 | 运行中匹配 `^\d{2}:\d{2} · 专注$` 且两次读数不同；阶段结束为 `✓ 专注结束` 并保持 | eval |

## 2. 契约用例（AC 之外，P0 门禁，不过不给上线）

| 用例 | 内容 | 断言 |
|---|---|---|
| `c01-testids` | §4.1 的 11 个 + leader 新增 5 个（`pomo-count`、`setting-*`）= 16 个 | 逐个非空，缺一个即红 |
| `c02-nondebug` | 非 `?debug=1` 时调试口不泄露 | `typeof window.__pf === 'undefined'` |
| `c03-storage` | localStorage 契约 | key=`pomodoro-focus:v1`；`schemaVersion`=1；`settings` 6 字段；`stats.date` 为 `YYYY-MM-DD`；运行中有 `session.endsAt`（number） |
| `c04-static` | 子路径/外链硬规则（Arch §5.1） | 源码无 `/assets/` 开头、无 `http(s)://` 外链资源、无 CDN 字体；nginx 片段无 `alias`/`try_files`/`autoindex` |
| `c05-expired-settle` | 「过期即结算」只加 1 次（Arch §4.3，review 检查项） | 构造 `endsAt = now-3h` → 启动后 `stats.completedFocus` **恰好 +1**（不是 +N），阶段=短休息、状态=就绪 |
| `c06-no-js-error` | 全程零 JS 报错 | 以上每个 spec 的 `consoleErrors`/`pageErrors` 均为 0 |

### 2.1 Arch 复审新增的回归用例（F-1/F-3/F-4）

| 用例 | 对应问题 | 断言 |
|---|---|---|
| `ac09-bad-storage`（下半段） | F-1 存储为 `null` 时白屏（high） | 写入 `{settings:null,stats:null,session:null}` 后刷新：仍 `25:00`、正文非空、无 pageerror |
| `c08-running-duration-change` | F-3 运行中改时长导致进度回零（medium） | 运行到 60% 后把 `focusMin` 改 50：`progress` 变化 ≤2，不回 0 |
| `c09-endsat-upper-bound` | F-4 `endsAt` 无上界（medium） | 注入 `endsAt=now+1e12` 后：时间形如 `MM:SS/MMM:SS` 且 ≤ 24h，不出现 `150000000:00` |

### 2.2 断言口径修正（Arch 复审同步，Dev/QA 必须一致）

1. **主按钮是两个节点**：非当前态带 `hidden+disabled`。定位一律用 `btn-start:not([hidden])` / `btn-pause:not([hidden])`，断言"两者恰好一个可见且可用"，不直接点 `btn-start`。
2. **阶段结束必须四项一起断**：大字 `00:00` + 进度 100 + `已结束` + 标题 `✓ 专注结束`。只断大字会漏掉 F-2（结束时停在下一相位满时长）。

### 2.3 leader 裁决落地（本轮生效）

| 缺口 | 裁决 | 我的落地 |
|---|---|---|
| G1 | `round-count` 保持「第 N 轮」，**新增 `pomo-count` = `done/4`** | `ac01` 断 0/4、`ac05` 断 1/4、`ac06-07` 断 4/4；解析用 eval 容错空白 |
| G2 | 补 `setting-focus/short/long/reset` 四个 testid | `c01` 纳入合计 16 个 testid，`ac17` 校验这四个存在且 `setting-focus` 值为 1 |
| G4 | Dev 补 `key` 步 | **AC-14 挂待办**，spec 未写，等 key 步落地再补 |
| G5 | Dev 补 `--init-script` | AC-09 现只覆盖「坏数据/`null` 自愈」，**完全禁用 localStorage 挂待办** |
| G7 | Dev 本轮必须落地 `eval` | 全部 21 个 spec 依赖它：`expr` 为 `true` 才算过 |
| G8 | 交互不改（改值即存），PM 改 AC 措辞 | `ac17` 按「改值即存 + 恢复默认」写，不找保存按钮 |
| 结束态 | 按 Arch F-2 四项：`00:00` + 进度 100 + 「已结束」+ `✓ 专注结束` | `ac05`、`ac06-07` 已按四项断，点开始后才断 `05:00`/`15:00` |
| AC 唯一源 | `requirements.md` 的 AC 是唯一验收源，契约只能细化 | 未来冲突我按 AC 报 G 卡，不自行解释 |

### 2.4 实测补充（首轮跑出的第三条语义，需补进契约）

结束瞬间实测：`phase-label` **仍是刚结束的相位（专注）**，不是「短休息」；四项为「专注 · 00:00 · 已结束 · 进度 100」，标题 `✓ 专注结束`，`pomo-count` 已 +1、`round-count` 已递进。点主按钮之后才变成「短休息 · 05:00 · 进行中」。

这比 Arch 书面描述的「phase=shortBreak、remaining=300000」更自洽（否则会出现“短休息却 00:00”的矛盾），也与 leader 的四项一致裁决相符。但 **Arch §4、PM 的 AC-05/AC-06 需要照这个写**，否则后续按文档写的用例会误判。我的 `ac05`/`ac06-07`/`ac12` 已按实测语义执行。

### 2.5 首轮 4 红的分诊记录（透明留痕）

| 用例 | 首轮现象 | 分诊 | 处理 |
|---|---|---|---|
| `ac14-keyboard` | 脚本 `focus()` 后按 Enter 不启动 | 执行器 `key` 事件不带 `text`，Enter 不触发按钮默认行为；真实点击后按 Space 能暂停（`trusted=true`） | 改用 AC 允许的 Space；**Enter 路径仍未验证**，记观察项 |
| `ac13-mobile` | eval 返回 `{}` | 我的表达式 `every(...)()` 多写了一对括号 | 修表达式后过 |
| `ac12` | 期望短休息 05:00 | 我按 G9 前旧口径写，实测为结束态四项 | 改断言后过 |
| `ac17-settings` | 存储里没保存 | `ui.js:58` 监听 `change`，`type` 后未 blur 不触发 | 补 `blur()`；恢复默认后补「重置」再断 25:00 |

另有 1 次 `ac06-07-cycle` 报 `CDP 连接已关闭`（16s）——重跑不复现，记为偶发观察项。

### 2.6 与 PM 原文的口径冲突（G9，已由 leader 裁决）

PM 的 AC-05/AC-06 写的是"倒计时到 0 → 计时器显示 `05:00` / `15:00`"，而 Arch 的复审契约是"结束瞬间显示 `00:00` + 已结束 + 进度 100 + `✓ 专注结束`，保持到用户下一次操作"。两者在同一时刻不可能同时成立。
**已定口径（leader 裁决）**：结束瞬间按四项断（F-2 回归点），点主按钮后才断 `05:00`/`15:00`；PM 同步 AC-05/06 措辞。

## 3. 契约缺口（需要 leader/Arch 裁决，否则用例无法稳定执行）

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| G1 | AC-06 要求「番茄计数显示 4 / 4」，但 §4.1 只有 `round-count`=「第 N 轮」，没有 x/4 | 断言口径不一致，用例只能断「第 5 轮」 | Arch 补 testid（如 `focus-count`）或 PM 改 AC 措辞，二者取一 |
| G2 | `settings-panel` 内部字段（专注分钟输入框、保存、恢复默认）没有 testid 契约 | AC-17 只能按可见文本点，脆弱 | 补 `settings-focus-min` / `settings-save` / `settings-restore` |
| G3 | AC-13 的「无横向滚动/字号明显更大」不是 `assertText` 能断的 | 需 eval 计算样式 | 已用 eval 写进 `ac13`，确认 runner 支持 |
| G4 | 两个 runner 都没有按键步（Enter/Space） | AC-14 无法执行 | runner 加 `key {key:"Enter"}` 步 |
| G5 | 无法在页面加载前禁用 localStorage | AC-09 只覆盖「坏数据自愈」，不覆盖「完全不可用」 | runner 加 `--init-script <file>`（CDP `Page.addScriptToEvaluateOnNewDocument`） |
| G6 | `json.title` 只在启动时取一次，之后不更新 | AC-18 无法只靠 json 断言 | 走 eval；或 runner 每步刷新 `title` |
| G7 | runner 的 `eval` 步尚未在最终版落地（Dev 进行中） | 所有带 eval 的用例暂不可跑 | eval 语义定为：`expr` 求值为 `true` 才 pass，其它值 fail |
| G8 | AC-17 写「改完点保存」，但当前 `settings-panel` 里没有保存按钮（只有「恢复默认」），实现看起来是改值即存 | 用例无法按 PM 原文执行 | 我按「改值后自动保存」写 `ac17-settings`；请 PM 确认 AC 措辞或 Dev 补保存按钮，二者取一 |

## 4. 执行方式（Dev 交付后）

```bash
# 本地起子路径服务（在项目父目录）
cd "/Users/hanson/work/个人文档" && python3 -m http.server 8231 &

# 静态门禁（不启浏览器）
./qa/static-check.sh

# 逐条跑（默认无头，自动写 test-runs.log）
./qa/run-ac.sh            # 全量
./qa/run-ac.sh ac05       # 单条
```

产物：`qa/out/<case>/`（json + 截图 + 快照）、`test-runs.log` 每行 `时间 | 通道 | URL | 目的 | 耗时 | 结果`。

## 5. 判定口径

- **P0 全绿 = 可交付**；P1（AC-17/18）红不阻塞 M1，但要记录。
- 任一 AC 红 → 给最小复现（URL、操作序列、期望、实际、json 路径、截图）交回 Dev，不自行改代码。
- 每轮跑完必须残留检查：无浏览器进程、无临时 profile 目录、Orca 无遗留 tab。
