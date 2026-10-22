# 番茄时钟（pomodoro-focus）M1 验收报告

- 报告人：PM
- 日期：2026-10-22
- 结论：**验收通过，已上线**
- 线上地址：<https://hk.hsddns.com/pomodoro-focus/>
- 验收依据：`docs/requirements.md` v1.3（18 条 AC）+ `docs/architecture.md` §4 契约 + `docs/qa-testcases.md`

## 1. 结论

M1 全部 P0 需求已在线上可用，冻结版通过 23 条验收用例，部署动作经 9 条 curl 断言与白名单校验，现有站点未受影响。

| 维度 | 结果 |
|---|---|
| 需求验收（P0） | **通过**：23 个 spec / 23 通过 / 0 失败 |
| 线上可用 | **通过**：`/pomodoro-focus/` 200，标题 `25:00 · 专注`，3431 字节 |
| 线上冒烟 | **通过**：9/9 步，console/page/http 错误 0 |
| 现有站点不受影响 | **通过**：`/` 仍 301→`/whtasapp/`，`/whtasapp/`、`/health` 等逐条与基线一致 |
| 源码与测试产物不暴露 | **通过**：`/qa/`、`/docs/`、`/.git/` 均 404 |
| 证据可追溯 | **通过**：跑前/跑后指纹 5/5 一致，代码已有回滚点 |

未计入 M1 的 P1/P2 项与遗留观察见第 5 节，**不影响本次验收结论**。

## 2. 版本

发布候选（冻结）时间：2026-10-22 16:19:54；终验跑前、跑后与线上落盘三处指纹一致（5/5）。

| 文件 | md5 | 行数 |
|---|---|---|
| `index.html` | `2fd50b40` | 76 |
| `assets/styles.css` | `907013e6` | 366 |
| `assets/js/timer.js` | `b900a26c` | 289 |
| `assets/js/ui.js` | `b0dfc293` | 131 |
| `assets/js/app.js` | `fe41e31a` | 221 |

- 代码回滚点：`git commit 8cea14f`「M1 首版冻结版（发布候选）」，45 个文件，`qa/out` 测试证据不入库；回滚命令 `git checkout 8cea14f`。
- 部署配置备份：`/etc/nginx/backups/pre-pomodoro-20261022-163144`（含 `nginx -T` 全量）。
- 服务器落盘仅 6 个文件（`index.html` + `assets/**`），`root:root`，目录 755 / 文件 644；白名单外内容（`qa/`、`docs/`、`ops/`、`.git`、`README.md`）均 404。

## 3. 验收结果（23 条）

终验执行：`CHANNEL=external ./qa/run-ac.sh`，无头 Edge 155（`--headless=new`），单次全量，跑前跑后各取一次指纹。

### 3.1 需求 AC（17 条）

| 用例 | 覆盖 | 结果 |
|---|---|---|
| ac01 | AC-01 首屏（`25:00`/专注/开始/0-4） | PASS |
| ac02 | AC-02 开始与倒计时 | PASS |
| ac03 | AC-03 暂停与继续 | PASS |
| ac04 | AC-04 重置 | PASS |
| ac05 | AC-05 结束态五项一致（含禁止「短休息+00:00」组合） | PASS |
| ac06-07 | AC-06/07 四轮流转、短休、第 4 轮长休、计数归零 | PASS |
| ac08 | AC-08 刷新后恢复（阶段/运行态/剩余/番茄数） | PASS |
| ac09 | AC-09 坏存储数据不白屏 | PASS |
| ac09b | AC-09 禁用 localStorage 降级 | PASS |
| ac10 | AC-10 跳过不计数 | PASS |
| ac11 | AC-11 后台 5 分钟不跑偏（误差 ≤2s） | PASS |
| ac12 | AC-12 离开期间到期，已结算且不乱跳 | PASS |
| ac13 | AC-13 360×640 无横向滚动、按钮 ≥44px | PASS |
| ac14 | AC-14 键盘 Space 起停、焦点可见 | PASS（Enter 路径未覆盖，见 5.2） |
| ac15 | AC-15 子路径资源不 404、无斜杠 301 | PASS |
| ac17 | AC-17 设置改值即存 + 恢复默认 + 不打断当前阶段 | PASS |
| ac18 | AC-18 标签页标题 `24:59 · 专注` | PASS |

### 3.2 技术契约与稳健性（6 条）

| 用例 | 覆盖 | 结果 |
|---|---|---|
| c01 | 11+ 必需 testid 齐全（实到 16） | PASS |
| c02 | `?debug=1` 之外的正常路径不依赖调试钩子 | PASS |
| c03 | localStorage 存储契约（schema/降级） | PASS |
| c05 | 过期会话即结算 | PASS |
| c08 | 运行中改时长，进度不跳变（40%→40%） | PASS |
| c09 | endsAt 上界三态（脏 endsAt / A-1 / A-2），不出现 `150000000:00` | PASS |

### 3.3 线上冒烟（上线后，只读）

`https://hk.hsddns.com/pomodoro-focus/`，9 步全过，耗时 1628ms，`consoleErrors/pageErrors/httpErrors` 全为 `[]`。

PM 独立复核（只读 GET）：

| 路径 | 结果 |
|---|---|
| `/pomodoro-focus/` | 200，`<title>25:00 · 专注</title>`，3431 字节 |
| `/pomodoro-focus` | 301 → `/pomodoro-focus/` |
| `/pomodoro-focus/assets/js/app.js` | 200 |
| `/pomodoro-focus/qa/`、`/docs/`、`/.git/` | 404 / 404 / 404 |
| `/` | 301 → `/whtasapp/`（与上线前一致） |

AC-16（现有站点不受影响）由 Ops 9 条 curl 与 leader 独立复核共同确认：`/` 301、`/whtasapp/` 200、`/health` 200、`/json/` 200、`/asset/` 200、`/frostfall/` 200，`/api/` 仍 404；`nginx -t` 在部署前与 reload 前各通过一次；443 上的 master 进程 `1472885` 未变，`1648` 未触碰。

### 3.4 补充走查（不计数，不阻断）

浅色主题（`prefers-color-scheme: light`，只读无头）：首屏、360×640 两屏 `PASS`，五项文案可见，计时器对比度 4.57:1。终态屏浅色证据缺失，见 5.3。

## 4. 证据位置

| 内容 | 路径 |
|---|---|
| 冻结版终验 23 份 json + 230 张 png | `qa/out/<spec>/` |
| 线上冒烟 json + 9 张截图 | `qa/out/prod-smoke/` |
| 浅色走查 | `qa/out/light-firstpaint/`、`qa/out/light-mobile/` |
| 逐轮测试日志（每轮一行） | `~/.dsh/bot/workspace/test-runs.log`（313 行，含本次 23 行终验） |

> 注：`test-runs.log` 落在团队工作区、**不在本项目仓库内**（未纳入 git）。项目内的证据以 `qa/out/` 为准；若需长期归档，建议后续把它复制进 `qa/` 或明确不随代码发布。
| 用例与口径 | `docs/qa-testcases.md`、`docs/requirements.md` v1.3 |
| 发布记录与回滚命令 | `docs/deploy.md` |
| 未做项与遗留 | `docs/backlog.md` |

## 5. 未覆盖与遗留（均不阻断 M1）

### 5.1 P1 未实现，不计入本次验收

- **FR-06b 提示音：未实现**。代码中 `sound` 仅为预留字段、无消费方，默认 `false`。按 leader 口径，M1 验收与对外说明均不得写成「已做」。
- FR-09 的「减少动效」、FR-13 统计、FR-14 PWA/通知：均按 P2/M2 未做。

### 5.2 键盘 Enter 路径未验证

AC-14 走的是 Space 路径（已过）。执行器缺少按键 `text` 能力，Enter 触发按钮默认行为未验证，缺口清单见 `qa/notes-runner-keys.md`；执行器补齐后补 `ac14b` 一条。

### 5.3 浅色终态屏缺证据

浅色仅覆盖首屏与移动两屏，`00:00 / 已结束` 终态在浅色下无截图（Dev 曾产出，目录已不存在）。建议补一屏只读复测。

### 5.4 浅色对比度断言存在一次非确定性失败

同一份用例、同一份代码，16:32:16 一轮 `FAIL`（计时器对比度）、16:32:48 一轮 `PASS`，阈值未放宽（仍为 ≥4.5）。QA 归因为断言基准取错（用 body 底色而非白色卡片）并已修正；因首轮原始截图不可追溯，**该断言稳定性待 QA 书面说明**，不影响 23/23 终验结论（终验不含浅色用例）。

## 6. 已知问题 → M1.1（不重开 M1）

| 编号 | 问题 | 影响 | 处理 |
|---|---|---|---|
| K1 | 进度点在浅色下对比度 1.26:1、深色 1.5:1，几乎不可见 | 观感，信息有 `0 / 4` 文本兜底 | 记 `docs/backlog.md`，M1.1 改 `1.5px solid var(--text-tertiary)`，只重跑相关用例 |
| K2 | 强调红 `#D0453A` 对白卡 4.57:1，仅比 AA 高 0.07 | 任何调色都可能跌破 4.5 | 建议 Design 在 `design.md` 固定该色值与余量，禁止随手调 |
| K3 | 发布曾因目录 700 返回 403 并自动回滚一次 | 已修复：打包 755/644、reload 前 `www-data` 逐文件可读校验 | 已写入 `docs/deploy.md`「已知坑」，重跑后成功 |

## 7. 验收签署

| 角色 | 内容 |
|---|---|
| QA | 23/23 通过，跑前跑后指纹 5/5 一致，残留 0 进程 / 0 临时目录 |
| Ops | 9 条 curl 断言全过，白名单 6 文件，`nginx -t` 通过，回滚命令就绪 |
| Arch | 门禁 24/24（RC=0）跑在冻结版上；两份 review 已标注「缺陷现场记录，非契约」 |
| PM | 18 条 AC 全部覆盖，口径与实现一致（`requirements.md` v1.3），**验收通过** |
