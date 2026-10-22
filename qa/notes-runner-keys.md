# 执行器能力缺口 · 按键事件（QA → Dev）

发现于 `ac14-keyboard` 终验。**不是站点缺陷**，执行器是独立代码，补它不影响 5 个站点文件指纹。

## 实测事实

| 场景 | 结果 |
|---|---|
| 脚本 `el.focus()` 后 `key Enter` | **不触发**按钮默认行为，状态仍「就绪」 |
| 脚本 `el.focus()` 后 `key Space` | **不触发** |
| 真实点击拿到焦点后 `key Space` | **生效**（开始→暂停），事件 `isTrusted=true` |
| 真实 Tab×6 聚焦到主按钮后 `key Space` | **生效**（AC-14 用这条通过） |

`key` 事件确实发到了 document（探针捕获 `down:Enter:trusted=true`），说明不是“没发出去”，而是**缺少让浏览器执行默认激活行为所需的字段**。

## 需要补的能力（按优先级）

1. **`text` 字段透传**（阻断 AC-14 的 Enter 路径）
   - Space → `text: " "`
   - Enter → `text: "\r"`
   - 现状 `Input.dispatchKeyEvent` 只给了 `key/code/windowsVirtualKeyCode/nativeVirtualKeyCode`，没有 `text`，Chromium 对“非可信焦点路径”的默认激活不完整。
2. **keydown / keyup 分步控制**：`{op:"key", key:"Space", phase:"down"|"up"|"both"}`。Space 的激活行为发生在 keyup，Enter 在 keydown，合并发送时无法分辨。
3. **修饰键透传**：`{modifiers:["shift","ctrl","alt","meta"]}` → `modifiers` 位掩码。用于 Shift+Tab、Ctrl+R 之类用例。
4. **按住重复**：`{holdMs: 500}`（keydown → 等待 → keyup），用于长按行为。
5. **聚焦前置的真实性**：要么支持 `focus {selector}` 走 CDP `DOM.focus`（比 JS `focus()` 更接近真实），要么在 notes 里写明“脚本 focus 不算真实焦点，键盘用例必须先用 Tab 或点击获得焦点”。

## QA 当前处理

- `ac14-keyboard` 已改用 **Tab×6 → Space** 路径，通过。
- **Enter 路径未验证**，等上述第 1 项落地后补一条 spec（`ac14b-keyboard-enter`）。
- 本文件不是 M1 阻断项，不影响本次上线验收。
