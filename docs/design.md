# 番茄时钟 · 交互与视觉设计规范

> 范围：纯前端静态单页。本文档只定义用户流程、页面结构、视觉 token、组件状态和交互边界，不含业务逻辑实现。
> 部署子路径：`https://hk.hsddns.com/pomodoro-focus/`。所有资源引用必须用相对路径（`./assets/...`），禁止 `/` 开头绝对路径。
> 目标实现：原生 HTML/CSS/JS，零构建零依赖。

---

## 0. 设计结论（先看这一节）

- **单页单卡片**：一屏放下，不滚动（375×667 起）。手机竖屏优先，桌面上下居中、最大宽度 480px。
- **主角是计时器**：数字占视觉权重 ≥ 50%，其余元素全部退让为低对比度。
- **三态用色区分，不用文字硬解释**：专注=番茄红、短休=青绿、长休=靛蓝。状态色只作用于「计时环/数字/主按钮/背景微光」，不刷满整屏。
- **两种主题**：浅色为默认，`prefers-color-scheme: dark` 自动切深色。不提供手动切换（非目标，避免加状态）。
- **零弹窗**：全部状态在页面内呈现；唯一例外浏览器自身权限提示（而本项目不申请任何权限）。
- **计时数字用等宽数字**（`font-variant-numeric: tabular-nums`），否则每秒跳动会左右抖。

### 与需求文档的边界（避免被误当契约）

- **「设置」入口以 `docs/requirements.md` AC-17 为准**。本文档 §8 把「设置面板」列为非目标，指的是本期不做自定义时长/音量/自动开始这类**设置项**；页面上的「设置」入口属于需求范围，由 AC-17 定义，不因本文档 §8 而删。
- **已知视觉偏差（M1.1 修，不阻塞 M1）**：未完成进度点当前用 `--border`，对比度实测浅色 **1.26:1** / 深色 **1.5:1**，接近不可见。建议改为 `border: 1.5px solid var(--text-tertiary)`（浅色 2.52:1 / 深色 3.24:1）。信息有 `0 / 4` 文本兜底，故按「观感问题」处理，已记入 `backlog.md`，勿重复上报为缺陷。

### 视觉方向（推荐 A，B/C 备选，只做 A 即可，用户要换再改）

| 方向 | 一句话 | 适配度 |
|---|---|---|
| **A · 静谧专注（推荐）** | 大留白、单色强调、无插画，接近 Things/Bear 的克制感 | 移动端最稳、实现量最小、不易过时 |
| B · 深色沉浸 | 默认深色，数字带轻微发光 | 夜间好用，但白天长时间看易疲劳 |
| C · 圆润拟物 | 大圆角卡片 + 柔和阴影 + 番茄图标 | 亲切，但阴影/圆角调不好容易显廉价 |

以下全部数值按 **A** 写死；选 B/C 只需替换 `--color-accent-*` 与圆角/阴影 token，结构不动。

---

## 1. 用户流程

```
打开页面
  └─ 初始态（focus / 25:00 / 未开始）
       ├─ 点「开始」 ──► 运行中 ──► 点「暂停」 ──► 暂停态 ──► 点「继续」─┐
       │                   │                                         │
       │                   └─► 倒计时归零 ──► 结算（自动切下一态）──────┘
       │                          │
       │                          ├─ focus 结束 → 短休（第 4 个番茄 → 长休）
       │                          └─ 休息结束 → focus
       └─ 点「重置」 ──► 回到当前态的完整时长（运行中/暂停中均可）
```

**页面只有一个视图**，没有二级页面、没有弹窗、没有设置抽屉（设置项见 PM 需求文档；若确有设置，用底部内联面板，不做 modal）。

---

## 2. 页面结构（线框）

移动端（375 宽），从上到下 4 个区块，垂直居中分布：

```
┌─────────────────────────────┐
│                             │  ← 24px 安全边
│         专注                │  ← 状态标签 13px / 字重 500 / 状态色
│                             │  ← 8px
│        25:00                │  ← 主计时器 clamp(56,18vw,120)px / 700 / tabular
│                             │  ← 12px
│    ● ● ○ ○   第 2/4 个番茄   │  ← 进度点 8px + 说明 12px / 次要色
│                             │
│            (弹性留白)         │
│                             │
│   ┌───────────┐ ┌────────┐  │  ← 主按钮 56 高 / 次按钮 56 高
│   │   开始     │ │  重置  │  │
│   └───────────┘ └────────┘  │
│                             │  ← 16px
│        今日 4 个 · 专注 1h40m │  ← 统计 12px / 次要色（无数据时整个隐藏）
│                             │  ← 24px 安全边
└─────────────────────────────┘
```

- 主按钮宽度 ≥ 160px，次按钮固定 96px；两者同一行，`gap: 12px`。
- 进度点：4 个圆点代表一轮 4 个番茄，当前轮内已完成的实心、未完成空心。番茄数由业务逻辑给，设计只规定「4 个、8px、间距 6px」。
- 底部统计：无数据时**整行不渲染**（不要显示 `今日 0 个`，空态是留白不是零值）。
- 桌面（≥768）：同一张卡片，`max-width: 480px`，`padding: 40px`，水平垂直居中；不做左右分栏。

---

## 3. 设计 token（直接复制进 CSS）

```css
:root {
  /* ---- 中性色（浅色主题） ---- */
  --bg: #FAFAF9;            /* 页面底色 */
  --surface: #FFFFFF;       /* 卡片 */
  --border: #E7E5E4;        /* 分隔/描边 */
  --text-primary: #1C1917;  /* 主文字、计时数字 */
  --text-secondary: #78716C;/* 状态说明、统计 */
  --text-tertiary: #A8A29E; /* 占位、未启用 */

  /* ---- 状态强调色（三态切换 --color-accent 即可） ---- */
  --accent-focus: #D0453A;    /* 专注 · 番茄红（白底 4.57:1，勿再调亮） */
  --accent-focus-weak: #FDECEA;
  --accent-short: #12856A;    /* 短休 · 青绿 */
  --accent-short-weak: #E6F4F0;
  --accent-long: #3F6DA8;     /* 长休 · 靛蓝 */
  --accent-long-weak: #EAF0F8;

  --color-accent: var(--accent-focus);        /* 由 JS 按状态切换 */
  --color-accent-weak: var(--accent-focus-weak);

  /* ---- 字号层级 ---- */
  --font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
                 "Segoe UI", "Microsoft YaHei", sans-serif;
  --fs-timer: clamp(56px, 18vw, 120px); /* 主计时器，字重 700，行高 1 */
  --fs-title: 20px;                     /* 页面标题（极简，可只用 16px） */
  --fs-body: 15px;                      /* 按钮文字 */
  --fs-label: 13px;                     /* 状态标签 */
  --fs-caption: 12px;                   /* 统计、辅助说明 */
  --lh-tight: 1.1;
  --lh-body: 1.5;

  /* ---- 间距（4 的倍数） ---- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px;

  /* ---- 圆角 / 阴影 ---- */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-full: 999px;
  --shadow-card: 0 1px 2px rgba(28,25,23,.04), 0 8px 24px rgba(28,25,23,.06);
  --shadow-btn: 0 1px 2px rgba(28,25,23,.08);

  /* ---- 动效 ---- */
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --ease: cubic-bezier(.4, 0, .2, 1);

  /* ---- 触控 / 焦点 ---- */
  --tap-min: 44px;
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18181B;
    --surface: #232326;
    --border: #3F3F46;
    --text-primary: #FAFAFA;
    --text-secondary: #A1A1AA;
    --text-tertiary: #71717A;

    --accent-focus: #F2766A;      /* 深色下提亮，保证对比度 */
    --accent-focus-weak: #3A2422;
    --accent-short: #3DBFA0;
    --accent-short-weak: #1B3530;
    --accent-long: #7FA7DB;
    --accent-long-weak: #1E2A3A;

    --shadow-card: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
    --shadow-btn: 0 1px 2px rgba(0,0,0,.4);
  }
}
```

---

## 4. 组件规范

### 4.1 计时器（核心）

| 项 | 规范 |
|---|---|
| 字体 | `--font-family`，`font-weight: 700`，`letter-spacing: -0.02em` |
| 尺寸 | `font-size: var(--fs-timer)`；`line-height: 1` |
| 数字 | 必须 `font-variant-numeric: tabular-nums`，防抖动 |
| 颜色 | `var(--color-accent)`（跟随状态） |
| 对齐 | 居中；固定高度按「`88:88`」占位，不要因位数变化跳动 |
| 语义 | `<div role="timer" aria-live="off">25:00</div>`；**每秒不朗读** |

### 4.2 状态标签

- 文案：`专注` / `短休` / `长休`（禁止英文混排，禁止图标+文字混用）。
- 13px / 500 / `color: var(--color-accent)` / 字间距 `0.04em`。
- 切换态时给 `aria-live="polite"` 的容器播报一次（只播状态，不播秒数）。

### 4.3 按钮

主按钮（开始 / 暂停 / 继续）与次按钮（重置）共用几何，仅填充不同。

| 状态 | 主按钮 | 次按钮 |
|---|---|---|
| 默认 | 填充 `--color-accent`，白字 | 白底 + `--border` 边框，`--text-secondary` 字 |
| 悬停（hover，仅 hover 能力设备） | 亮度降 8%（`filter: brightness(.92)` 或 mixing） | 背景 `--bg` |
| 按下（active） | `transform: scale(.98)` + 亮度再降 | 同左 |
| 焦点（focus-visible） | `outline: 2px solid var(--color-accent); outline-offset: 2px` | 同左 |
| 禁用 | `opacity: .4`，`cursor: not-allowed`，不接收点击 | 同左 |
| 加载 | **不使用**（本页无异步操作） | — |

```css
.btn {
  min-height: 56px; min-width: var(--tap-min);
  border-radius: var(--radius-md);
  font-size: var(--fs-body); font-weight: 600;
  transition: filter var(--dur-fast) var(--ease),
              transform var(--dur-fast) var(--ease),
              background-color var(--dur-base) var(--ease);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.btn:active:not(:disabled) { transform: scale(.98); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
```

**主按钮文案随状态变化（同一按钮，不新增按钮）**：`开始` → `暂停` → `继续`。计时归零瞬间按钮禁用 300ms 过渡，避免连点重复结算。

### 4.4 进度点

- 4 个 8px 圆点，`gap: 6px`；已完成 `--color-accent`，未完成 `--border`。
- 纯装饰，`aria-hidden="true"`；语义信息放在统计文案里。

### 4.5 底部统计

- 12px / `--text-secondary`，格式：`今日 4 个 · 专注 1h40m`。
- 无数据整行不渲染；数字变化时不做动画，避免分心。

---

## 5. 边界状态（前端必须处理）

| 场景 | 表现 |
|---|---|
| 倒计时归零 | 主按钮短暂禁用（300ms）→ 状态色、标签、进度点一起切到下一态 → 数字重置为下一态满值。**不弹窗、不弹条、不发通知** |
| 切后台 / 息屏 | 回来必须显示**真实剩余时间**（用时间戳算，不能靠 setInterval 累加）。这是硬要求，见 PM 验收 |
| 刷新页面 | 读取 localStorage 恢复当前态与剩余秒数；恢复不出来就从 `focus / 25:00` 干净开始，**不报错、不提示** |
| localStorage 不可用（隐私模式/禁用） | 静默降级：功能全可用，只是刷新不恢复。**禁止**弹「存储不可用」 |
| 数据损坏（手改 localStorage） | 校验失败即丢弃，按初始态启动；不抛异常、不白屏 |
| 键盘操作 | `Space` = 开始/暂停/继续；`R` = 重置；`Enter` 同 Space。焦点不在输入框时不拦截浏览器行为以外的默认动作 |
| 极窄屏（320） | 计时器降到 56px 下限，主次按钮改为上下两行（重置变全宽次按钮） |
| 系统「减少动效」 | `@media (prefers-reduced-motion: reduce)` 下关闭缩放与颜色过渡（保留状态切换） |

**页面标题（`document.title`）随倒计时更新**：`25:00 · 专注`。这是用户在别的标签页也能看到剩余时间的唯一手段，必须做。

---

## 6. 可访问性（最低要求，验收会查）

1. **对比度（已实测，见下表）**：正文/数字对背景 ≥ 4.5:1。三态强调色对白底/卡片底均 ≥ 4.5:1，可直接用于 13px 状态标签。
   **硬约束：任何文字都不要放在 `--color-accent-weak` 弱底色上**——实测只有 4.0–4.2:1。弱底色只用于无文字的装饰层（微光、底衬）。
2. **焦点可见**：所有可交互元素 `:focus-visible` 有 2px 轮廓 + 2px 偏移，禁止 `outline: none` 无替代。
3. **语义标签**：计时区用 `role="timer"`；状态播报容器 `aria-live="polite"` 只放状态文案；按钮用真实 `<button>`，不用 div 模拟。
4. **触控目标**：≥ 44×44。主/次按钮 56 高满足。
5. **不依赖颜色单独传意**：三态除颜色外，必须有状态文字同时呈现。
6. **减少动效**：支持 `prefers-reduced-motion`。

### 对比度实测值（白底 #FFFFFF / 页面底 #FAFAF9）

| 组合 | 比值 | 判定 |
|---|---|---|
| 主文字 `#1C1917` on `#FAFAF9` | 16.74 | 通过 |
| 次要文字 `#78716C` on `#FAFAF9` | 4.59 | 通过（12px 可用） |
| 专注 `#D0453A` on 白 | 4.57 | 通过 |
| 短休 `#12856A` on 白 | 4.58 | 通过 |
| 长休 `#3F6DA8` on 白 | 5.30 | 通过 |
| 白字 on 专注/短休/长休实心按钮 | 4.57 / 4.58 / 5.30 | 通过 |
| 三态强调色 on 各自弱底色 | 4.00–4.62 | **不用于文字** |
| `#A8A29E` 三级色 on 白 | ≈2.6 | 仅限禁用态（豁免项） |
| 深色主题三态 on `#18181B` | 6.39 / 7.73 / 7.13 | 通过 |

> 数值由 WCAG 相对亮度公式实测得出，Dev 若调整任一色值必须重算，不能凭眼感。


---

## 7. 交付给 Dev 的清单

1. 本文档 §3 的 token 整段复制进 CSS 的 `:root` 与深色媒体查询，不要改写数值。
2. 结构按 §2 四区块；资源路径一律 `./assets/...` 相对路径（子路径部署）。
3. 主按钮是**同一个** `<button>`，文案随状态变；不要为「暂停/继续」建两个按钮。
4. §5 每一行都是验收项，其中「切后台回前台时间必须准」和「刷新不报错」是重点。
5. 不需要引入任何字体文件、图标库、CSS 框架；系统字体即可。**首屏 ≤ 1 个 HTML + 1 个 CSS + 1 个 JS**，无外链资源（子路径下外链最容易出错）。

---

## 8. 非目标（本期不做）

- 设置面板（自定义时长、音量、自动开始下一轮）
- 任务清单 / 标签 / 项目归类
- 声音（如需，仅一个极短的合成音，不引入音频文件；本期默认关）
- 浏览器通知、PWA、离线缓存、多端同步
- 手动切换主题、多语言
- 统计图表、历史明细页

> 以上若后续要做，走新一轮需求，不塞进本期实现。
