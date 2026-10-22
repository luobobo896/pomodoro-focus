# 番茄时钟 · 技术方案（Architecture）

- 项目路径：`/Users/hanson/work/个人文档/pomodoro-focus`
- 目标 URL：`https://hk.hsddns.com/pomodoro-focus`
- 现状：git 仓库仅 README；该 URL 当前 404（路径空闲，无冲突）；根路径 301 正常（线上 nginx 在跑）
- 本文档只定方案与契约，不含业务实现；服务器操作归 Ops

---

## 1. 选型：三个方案，推荐 A

| 方案 | 内容 | 成本 | 复杂度 | 可维护性 | 风险 | 结论 |
|---|---|---|---|---|---|---|
| **A. 零依赖原生单页** | 原生 HTML/CSS/ES Module，无构建、无包管理、无后端 | 最低 | 最低 | 高（3 个文件读懂全站） | 低 | **推荐** |
| B. Vite + React/Vue | 需构建产物、依赖链、CI | 中 | 中 | 中 | 中（构建产物/子路径 base 易错） | 不必要 |
| C. Next.js / 带后端 | SSR + 账号 + 云同步 | 高 | 高 | 低 | 高（要动服务器进程、端口、证书） | 超范围 |

**推荐 A，理由**（不是"够用就行"，是三条硬理由）：
1. **改坏现有站点的概率最低**：纯静态文件，不需要新进程、新端口、新证书、新依赖，nginx 最多加一个 location，甚至可以零改动（见 §5 方案 A）。
2. **子路径部署风险可控**：这个站最大的技术风险不是功能，是 `/pomodoro-focus/` 这个非根路径。构建型方案（B/C）的 `base`/`assetPrefix` 是经典踩坑点，零依赖方案只要守住"全部引用用相对路径"一条规则即可。
3. **长期免维护**：没有 node_modules、没有锁文件、没有构建链，半年后回来改一行 CSS 也不用装环境。

功能本身（计时器 + 本地统计）不需要后端。**明确非目标**：账号、云同步、跨设备统计、通知推送、PWA/离线（PWA 的 scope 与 manifest 在子路径下另有一套坑，v1 不做，见 §8）。

---

## 2. 目录结构与文件职责

```
pomodoro-focus/
├── index.html              # 唯一入口，内联少量关键 CSS 变量
├── assets/
│   ├── styles.css          # 全部样式（Design 给 token，Dev 落地）
│   ├── js/
│   │   ├── timer.js        # 纯计时核心：状态机 + 相位推进，无 DOM、无存储
│   │   ├── storage.js      # localStorage 读写与容错，无 DOM
│   │   ├── ui.js           # 只做渲染与事件绑定，不含计时逻辑
│   │   └── app.js          # 启动装配：把 timer/storage/ui 接起来
└── docs/                   # requirements.md / design.md / 本文件
```

**边界规则（Dev 必须遵守）**：
- `timer.js`、`storage.js` **不许 import DOM 或 window 之外的宿主 API**，保持可被 Node 直接单测。
- `ui.js` **不许写 `setInterval`**，只暴露 `render(state)` 与回调注册；计时唯一的 tick 来源在 `app.js`。
- 全部用 `<script type="module" src="./assets/js/app.js">` 加载；ES Module 支持度不成问题（现代浏览器），但**不要**用 importmap/CDN。

---

## 3. 计时模型（本方案最关键的技术决策）

**禁用"每秒 `remaining--`"的写法。** 后台标签页的 `setInterval` 会被浏览器节流到 1 次/分钟甚至暂停，导致计时漂移、切回前台后显示错误。

**规则：单一时间源，存 deadline 而不是存剩余秒。**

```
状态只保存 endsAt（epoch ms）与 pausedRemainingMs：
- 运行中：remaining = max(0, endsAt - now())
- 暂停中：remaining = pausedRemainingMs
- 未开始：remaining = 当前相位总时长
```

- 渲染 tick：`setInterval(render, 200)`，**只负责重绘**，不负责减计数；`now()` 单点注入，便于测试伪造时钟。
- `visibilitychange` 回到前台时立即重算一次并校正（兜住系统休眠）。
- 相位结束判定放在 tick 里用 `remaining <= 0` 触发，且**幂等**（一次结束只推进一格，防止 0 附近重复触发）。

**相位状态机**（`docs/requirements.md` 的功能口径以此实现）：

```
phase:   focus | shortBreak | longBreak
status:  idle | running | paused | finished

start   : idle|paused|finished -> running
pause   : running -> paused
resume  : paused -> running
reset   : any -> idle（当前相位时长重置，不清空统计）
skip    : any -> 直接推进到下一相位（计为 skipped，不计入完成数）

focus 结束   -> 完成数 +1；若完成数 % longBreakEvery == 0 则 longBreak 否则 shortBreak
shortBreak 结束 -> focus
longBreak 结束  -> focus
```

`autoStartNext`（默认 false）开启时，相位结束后自动 `start`；关闭时停在 `idle` 等用户点。

---

## 4. 接口契约（Dev 照此实现，QA 照此断言）

### 4.1 DOM 契约（data-testid，禁止改名）

| testid | 元素 | 内容/行为 |
|---|---|---|
| `time-display` | 文本 | `MM:SS`，剩余时间，**必须零填充**（`05:00` 不是 `5:0`） |
| `phase-label` | 文本 | `专注` / `短休息` / `长休息`。**结束时显示"刚结束的阶段"**（leader 裁决 2026-10-22，见 `docs/backlog.md` B-1），卡片强调色随之一起切，不许只改文案 |
| `status-label` | 文本 | `就绪` / `进行中` / `已暂停` / `已结束` |
| `round-count` | 文本 | `第 N 轮`，N 为已完成专注数 +1 |
| `pomo-count` | 文本 | `done / 4` 形式（如 `0 / 4`、`4 / 4`），本轮已完成专注数 / `longBreakEvery`。**leader 裁决 G1：AC-06 的"4 / 4"用它断言，不要用 `round-count`** |
| `btn-start` | button | status=running 时隐藏或 disabled |
| `btn-pause` | button | 仅 running 可用 |
| `btn-reset` | button | 始终可用 |
| `btn-skip` | button | 始终可用 |
| `btn-settings` | button | 打开设置面板 |
| `settings-panel` | 容器 | 关闭时不在 DOM 或 `hidden` |
| `setting-focus` | input[type=number] | 专注分钟，1-60 |
| `setting-short` | input[type=number] | 短休分钟，1-60 |
| `setting-long` | input[type=number] | 长休分钟，1-60 |
| `setting-reset` | button | 恢复默认；**面板内没有"保存"按钮，改值即存**（leader 裁决 G8，AC-17 已按此改措辞） |
| `progress` | 元素 | `aria-valuenow` = 当前相位已过百分比（0-100，整数） |
| `document.title` | 页面标题 | 运行中 = `MM:SS · 专注`（相位名：`专注`/`短休息`/`长休息`，与 Design §7 一致）；相位结束时 = `✓ 专注结束` 并保持到用户下一次操作（leader 决策 A4：不弹通知，靠标题提示）。**这是用户切到别的标签页时唯一的进度可见手段**，QA 必须断言 |

> **计数口径**：**16 个 DOM testid**（11 个基础 + `pomo-count` + 4 个 `setting-*`）+ 1 条 `document.title` 契约。Dev 落地为 16 个节点，全部必须存在且唯一（`node docs/verify-fixes.mjs` 的 S-1 会检查）。
>
> **主按钮定位规则（QA 必读，否则用例必挂）**：Design 要求「开始/暂停/继续是同一个按钮换文案」，Dev 落地成**两个 DOM 节点**、非当前态那个 `hidden + disabled`。因此**禁止**直接 `click('[data-testid=btn-start]')` —— 运行中它 `hidden`，无头浏览器会报 "element is not visible"。统一写法：
>
> ```js
> const primary = page.locator('[data-testid=btn-start]:not([hidden]), [data-testid=btn-pause]:not([hidden])');
> ```
>
> **阶段结束时的断言口径（五项，缺一不可）**：大字（`time-display`）= `00:00`、`progress` 的 `aria-valuenow` = `100`、`status-label` = `已结束`、`phase-label` = **刚结束的那个阶段**（不是下一阶段）、`document.title` = `✓ <阶段>结束`，且卡片强调色与 `phase-label` 一致。点主按钮之后才允许切成下一阶段（`phase-label` 变短休/长休、大字 `05:00`/`15:00`）。只断大字会漏掉状态矛盾类缺陷（见 `docs/review-1.md` F-2）；只断文案不管颜色，会出现「青绿底色 + 专注标签」（见 `docs/backlog.md` B-1）。
>
> **测试地址**：统一用**带斜杠**的 `?debug=1` 地址（`/pomodoro-focus/?debug=1`），不要用无斜杠地址——nginx 会先 301 一跳，测到的不是线上真实形态。

### 4.2 调试钩子（QA 必需，**仅 `?debug=1` 时挂载**）

25 分钟的专注无法在无头验证里真等，必须有受控时钟。`URLSearchParams` 含 `debug=1` 时才挂：

```js
window.__pf = {
  getState(),                     // 返回当前 state 快照（JSON 可序列化）
  advance(ms),                    // 逻辑时钟前移 ms（改 endsAt，不真等待）
  setDurations({focusMin, shortBreakMin, longBreakMin}),
  resetStorage()
};
```

非 debug 模式下 `window.__pf` 必须为 `undefined`（QA 要断言这一点，避免调试口泄露到线上）。

同时设置项允许把时长改到 **1 分钟**（范围 1-60），这是给人用的正常功能，也是 QA 的第二条快路径。

### 4.3 localStorage 契约

- 唯一 key：`pomodoro-focus:v1`（**必须带项目前缀**，hk 站点同域下还有别的应用，不能污染）
- 结构：

```json
{
  "schemaVersion": 1,
  "settings": {
    "focusMin": 25, "shortBreakMin": 5, "longBreakMin": 15,
    "longBreakEvery": 4, "autoStartNext": false, "sound": true
  },
  "stats": {
    "date": "2026-10-22",
    "completedFocus": 0, "completedBreaks": 0, "totalFocusSec": 0
  },
  "session": {
    "phase": "focus", "status": "running",
    "endsAt": 1761100000000, "pausedRemainingMs": null, "savedAt": 1761000000000
  }
}
```

- `stats.date` 与 `today()` 不等时，视为新的一天：`completedFocus/Breaks/totalFocusSec` 归零。**是否清零跨天数据由 PM 需求定**，这里的契约是"必须有 date 字段可判定跨天"。
- **运行态必须持久化**（PM `FR-08` 定为 P0，AC-08 要求刷新后仍在运行、误差 ≤2s）。`session` 段随状态变更写入（`status`/`phase`/`endsAt`/`pausedRemainingMs`），落盘节流 ≥1s/次，避免 tick 写爆。
- **恢复语义（`storage.js` 的 `restore()`，纯函数、可单测）**：

```
读 session：
  status == running 且 now() < endsAt <= now()+相位满时长+5s -> 恢复为 running，remaining = endsAt - now()
  status == running 且 endsAt 超出上述上界（时钟回拨/脏数据） -> 丢弃 session，按满时长重置为 idle
  status == running 且 endsAt <= now()     -> 按"期间已结束"结算：completedFocus +1（若 phase=focus），
                                              推进到下一相位后停在 idle（不自动跑，除非 autoStartNext）
  status == paused                         -> 恢复为 paused，remaining = pausedRemainingMs
  status == idle / 字段缺失 / 类型不符      -> focus + 默认时长 + idle
任何异常（含 settings 为 null、JSON 结构错） -> 用默认值，不抛错、不白屏
```

  这条"过期即结算"是刻意定的：否则用户关掉页面 3 小时再回来，会出现"专注 25 分钟还差 2 分钟"的荒谬状态。结算只加 1 次，不按经过时长叠加（无法区分真实专注与离开），这条写进 review 检查。

### 4.4 错误与降级约定（fail-safe，不抛白屏）

| 场景 | 行为 |
|---|---|
| localStorage 不可用（隐私模式/禁用） | `try/catch` 包裹，降级为内存态，**静默不提示**（Design 明确禁止弹提示），功能不中断，仅刷新不回恢复 |
| 存储内容 JSON 解析失败 / schemaVersion 不匹配 | 丢弃并重置为默认值，不报错、不阻断 |
| 写入失败（quota） | 静默忽略，功能继续 |
| 页面不存在资源（缓存旧版） | 必须能自愈：HTML 带 `no-cache`（见 §5 缓存） |

**禁止**：任何 `alert()`；任何会导致首屏白屏的顶层 `throw`；任何阻塞渲染的同步 XHR / 外部字体阻塞加载。

---

## 5. 部署方案：子路径是本项目最大风险点

> **事实备查（防止误用据）**：本地 `个人文档/ALL.conf` **不是 nginx 配置**，内容是 Surge 代理规则（`[General]` / `loglevel` / `internet-test-url` 等），与本站部署无关。nginx 结构**只存在于 hk 服务器上**（leader 已核实）。因此本文件不引用任何本地配置作为依据，nginx 侧一切以 Ops 的**只读核查**为准；这也是本方案坚持"只新增、不改动原有 location"的原因。

### 5.1 硬规则（Dev 侧，违反即部署 404）

1. **所有资源引用必须是相对路径**：`./assets/styles.css`、`./assets/js/app.js`。**禁止** `/assets/...`（会解析到域名根，404）。
2. **禁止 `<base href="/">`**。任何形式的绝对 base 都会让相对路径失效。
3. CSS 里的 `url()` 同样相对当前 CSS 文件（`../images/x.png`），别写 `/...`。
4. 不引入 SPA 路由（不用 `history.pushState`），因此**不需要** `try_files` 回退，也不需要重写规则 —— 这是刻意设计，直接消掉一整类 nginx 配置风险。
5. 落盘前自查（给 Dev 的命令，任意命中即修）：

```bash
cd /Users/hanson/work/个人文档/pomodoro-focus
# 必须无输出：
grep -rnE '(src|href)="/' index.html
grep -rnE 'url\(/' assets/
grep -rn 'base href' index.html
# 必须无输出：零外链（CDN / 字体 / 图标库 / 统计脚本）
grep -rnE '<(script|link)[^>]+(src|href)="https?://' index.html
grep -rn 'fonts.googleapis\|cdn.jsdelivr\|unpkg\|cdnjs' index.html assets/
```

6. **零外链**（Design §7 同步要求）：不引外部字体、图标库、CSS 框架、统计脚本。字体用 `-apple-system, BlinkMacSystemFont, "PingFang SC", ...` 系统栈；图标用内联 SVG 或纯 CSS。理由不只是子路径易错，还因为外链会让"不影响现有站点/不依赖外网"这条硬约束失效（hk 服务器所在网络的出网行为不可控）。
7. 首屏依赖控制在 **1 HTML + 1 CSS + 1 JS**（Design §7 已定），请求数少也降低了子路径下出错的概率面。

### 5.2 推荐：nginx 零改动（方案 A）

把静态文件直接放进**现有站点的 document root** 下的一级子目录：

```
<现有站点 root>/pomodoro-focus/{index.html, assets/...}
```

因为现有 `location /`（静态 root）已经能服务它，**nginx 一行都不用加**。附带白拿两个好处：
- 访问 `/pomodoro-focus`（无尾斜杠）时，nginx 对真实存在的目录会自动 301 到 `/pomodoro-focus/`，相对路径直接正确；
- 现有根路径 301 与其它 location 完全不受影响，回滚 = `rm -rf` 那个子目录。

**前置条件（Ops 必须先确认，不确认不许上新 location）**：
1. 现有站点确实由 `root` + `location /` 直接服务静态文件（不是反代到上游应用、不是 Node/Go 进程兜底）。
2. document root 路径与写权限。
3. 没有 `location ~* \.(css|js)$` 之类的正则拦截把它挡掉，也没有 `try_files` 通配到 404。
4. 如果现有 `location /` 本身就是反代（proxy_pass），**禁用方案 A**，直接走 5.3 方案 B。

### 5.3 备选：显式 location（方案 B，仅在方案 A 不可行时）

```nginx
# 1) 补尾斜杠，否则相对路径全会解析错
location = /pomodoro-focus {
    return 301 /pomodoro-focus/;
}

# 2) ^~ 前缀匹配，优先级高于正则 location，且不改动任何已有配置块
location ^~ /pomodoro-focus/ {
    alias /var/www/pomodoro-focus/;   # 路径由 Ops 按实际 root 填，反向核对
    index index.html;
    # 这里刻意不写 try_files：没有 SPA 路由，不需要回退
    add_header Cache-Control "no-cache" always;
}
```

**注意**：`alias` + `try_files` 是 nginx 的经典坑（`alias` 不会被嵌套 location 正确继承，容易出现路径拼接错误）。本方案**不使用 try_files、不嵌套 location**，就是为了避开它。若 Ops 出于缓存需要嵌套，改用 `root` + 同构目录结构，不要硬套 `alias`。

### 5.4 缓存策略（零构建项目没有 hash 文件名，必须靠响应头）

- `index.html`：`Cache-Control: no-cache`（允许缓存但每次校验，保证更新立即生效）
- `assets/*`：`Cache-Control: public, max-age=300`（5 分钟，够用且改动后不会长期粘旧版）
- 不做 `immutable` —— 没有内容哈希文件名就上长缓存，是"改完线上还是旧的"这类故障的标准成因。

### 5.5 回滚点（Ops 交证据时逐条给）

| 层 | 回滚动作 |
|---|---|
| 代码 | git：部署的 commit 记到部署清单；服务器保留 `pomodoro-focus.bak-<YYYYmmdd-HHMMSS>` 上一版目录 |
| 文件 | 恢复 = 删新目录 + 把 `.bak-*` 改回原名 |
| nginx | **改前**备份：`cp -a <nginx conf 目录> <备份目录>`（含 `nginx.conf` 与 `sites-enabled/` 下全部），记 `nginx -T > pre-pomodoro-<ts>.conf` |
| nginx 回滚 | 用备份覆盖 → `nginx -t` → `nginx -s reload` |
| 方案 A（零改动） | 无 nginx 可回滚，风险面直接消失 |

**放行门禁**：任何 nginx 改动必须 `nginx -t` 通过才 reload；reload 后立刻复验根路径 301 与其它已存在 location 仍正常（Ops 交 curl 证据）。

---

## 6. 技术债与风险预警（按优先级）

| # | 风险 | 级别 | 触发概率 | 处置 |
|---|---|---|---|---|
| 1 | 部署走方案 B 且用 `alias`+`try_files` 拼错路径，整站 500/404 | **high** | 中 | 优先方案 A；必须 B 时禁用 try_files，`nginx -t` + 上线前 curl 校验三条（`/`、`/pomodoro-focus`、`/pomodoro-focus/assets/js/app.js`） |
| 2 | 资源写成绝对路径 `/assets/...`，本地 `file://` 能跑、上线 404 | **high** | 高（最常见） | §5.1 的 grep 自查 + QA 在子路径下无头验 |
| 3 | 后台标签页计时漂移 | **high** | 高（若用 setInterval 减计数） | §3 的 endsAt 方案，写进 review checklist |
| 4 | 无 hash 文件名 + 长缓存 → 更新不生效 | medium | 中 | §5.4 的 max-age=300 + html no-cache |
| 5 | 同域 localStorage 键名冲突（hk 站还有别的应用） | medium | 中 | 强制 `pomodoro-focus:` 前缀 |
| 6 | 移动端 100vh 在 Safari 地址栏下跳动 | medium | 高 | 用 `100dvh` + `min-height: 100vh` 兜底；QA 视口 390×844 验 |
| 7 | 音频提醒需用户手势后才可播放（自动播放策略） | low | 高 | 首次点击时解锁 `AudioContext`；`sound` 默认 true 但不强求 |
| 8 | 未来加 PWA：manifest/service worker 在子路径下 scope 错误导致接管全站 | medium（未来） | — | **v1 明确不做**；要做时 scope 必须写成相对 `./`，且单独评审 |

---

## 7. 给 Dev 的落地清单（MUST）

1. 目录/模块边界按 §2；`<script type="module" src="./assets/js/app.js">`。
2. 计时按 §3：只存 `endsAt`，200ms 重绘 tick，`now()` 可注入，相位推进幂等。
3. 所有 §4.1 的 `data-testid` 一个不少、名字一致。
4. `?debug=1` 才挂 `window.__pf`；线上非 debug 下为 `undefined`。
5. `localStorage` key = `pomodoro-focus:v1`，全程 try/catch，坏数据自愈；`session` 段按 §4.3 写入并在启动时 `restore()`（含"过期即结算"）。
6. 相对路径（`./` 开头），不写 `<base>`，不用 history 路由。
7. 无 `alert()`，无阻塞渲染的外部资源；`prefers-reduced-motion` 时关动画。
8. 首屏在无 JS 时至少显示标题与说明（渐进增强），不要白屏。

## 8. 非目标（v1 不做，别顺手加）

账号体系、云同步、跨设备统计、PWA/离线缓存、通知推送、多标签页同步（`storage` 事件）、图表报表、i18n、深色/浅色双主题切换之外的皮肤系统。

## 9. 待确认（阻塞项/或有默认值，不阻塞）

| 项 | 默认取值 | 需要谁定 |
|---|---|---|
| 统计是否跨天清零 | 跨天清零（保留 `date` 字段） | PM |
| 完成后是否自动进入下一相位 | 否，需用户点（PM 已定为产品决策） | 已定 |
| 深色模式 | 仅 `prefers-color-scheme` 自动跟随，不做手动切换（Design 已定） | 已定 |
| 现有站点 root 路径与 `location /` 形态 | 未知 | **Ops 部署前必须确认**（决定方案 A/B） |

---

## 10. 与 PM / Design 文档的对齐（已核，无遗留冲突）

| # | 来源 | 结论 |
|---|---|---|
| 1 | PM `FR-08` / `AC-08`：刷新后恢复、误差 ≤2s | **已按 P0 落地**：`session` 段持久化 + §4.3 恢复语义；初稿曾列为非目标，已修正 |
| 2 | PM：新阶段不自动开始 | 与本方案状态机一致（结束推进相位 → 停 `idle`，`autoStartNext` 默认关） |
| 3 | Design：存储不可用时"禁止弹提示" | 与本方案 fail-safe 一致，§4.4 已改为静默降级 |
| 4 | Design：`prefers-color-scheme` 自动深色、不提供手动切换 | 属 CSS 变量范畴，不引入状态，不与技术契约冲突 |
| 5 | Design：`data-testid` 未定义 | **以本文件 §4.1 为准**，Dev 与 QA 共用同一套命名，不许各写一套 |

---

*本文件由 Arch 起草，作为 Dev 实现与 QA 断言的技术基线；契约变更需同步本文档并通知 Dev/QA。*
