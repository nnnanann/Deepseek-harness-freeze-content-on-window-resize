# 固定窗口缩放内容

DeepSeek Harness（DSH）Web GUI 插件：**缩放窗口时，正在阅读的内容不再发生变化。**

[English](README.md) | 中文

---

## 前提

- DSH 及其 Web GUI —— 桌面 App 的窗口，或 `dsh web`。
- 开发与验证环境：**DSH desktop 0.2.0-rc.2**（win32）。插件只依赖 DSH 自己的 `data-*` 属性、不使用哈希类名，所以更新的版本通常也能用。
- 无需安装依赖、无需构建：没有打包器、没有编译器。

## 问题是什么

读一段长回答时拉一下窗口，眼前的文字就变了：刚才那一段不见了，得重新找位置。

这不是错觉，也不是滚轮的问题。对话正文列的样式是：

```css
/* DSH 0.2.0-rc.2 里该列的打包类名——内部名字，不是 API */
.xz4KEq_column {
  width: 100%;
  max-width: var(--dsh-chat-content-width);
  margin: 0 auto;
}
```

它被放在一个滚动容器里；而那个「内容宽度」是 DSH 从面板宽度推导出来的，并且挂在 `ResizeObserver` 上**每次尺寸变化都重新发布**：

| 是否存过宽度偏好 | 内容宽度 |
| --- | --- |
| 没有（全新安装，或从没拖过宽度手柄） | `clamp(680px, 0.64 × 面板宽, 920px)` |
| 拖过（`localStorage["dsh.conversation.contentWidth"]`） | `min(max(偏好值, 640px), max(640px, 面板宽 − 176px))` |

所以在**没有偏好值**的情况下，正文列在整个未夹满的区间（面板宽约 1063–1438px）里是**跟着窗口连续变宽变窄的**——不存在「窗口宽于某个阈值就没事」，每拉一步都在重排。有偏好值时，宽度是固定的，只有当面板再也装不下它时才开始跟着窗口缩。

与此同时，浏览器只保留像素级的 `scrollTop`——这个数字已经不再指向同一段文字了。Chat 视图自己的尺寸变化处理只做两件事：跟随末尾、重算当前回合，**从不恢复读者的锚点**。

实测：制造一次「更窄的窗口会造成的那种重排」——把列宽缩小 140px——阅读行被推离原位 **2417px**，锚点补偿又把它拉回 **0px** 偏移。[这是怎么测的](docs/self-test.md)，你可以自己跑一遍。

## 它做了什么

| 机制 | 效果 |
| --- | --- |
| **锁定内容宽度** | 每个已挂载的阅读列都被固定成一个像素宽度（`width` / `min-width` / `max-width` 全部 `!important`），换行方式从此与窗口无关。窗口更窄时改为横向滚动，而不是重新排版。 |
| **保持阅读位置** | 每列维护一个实时锚点——阅读线上那一行（`data-chat-anchor-key`）及其相对视口顶部的偏移。尺寸或缩放变化后，跨两个动画帧对齐一次，另加一次延迟兜底。 |

视图处于「跟随末尾」（`[data-chat-following-tail]`，即追新状态）时，锚点补偿让位给 DSH 自己的自动跟随；**宽度锁定仍然生效**。

你正在读的那一列使用你配置的宽度；**内嵌在侧边面板里的对话列**保留它自己由面板推导出的宽度——那个宽度本来就不随窗口变化。

有一条副作用值得在安装前就知道：**锁定之后，把窗口拉宽不会再让正文列变宽。** 原生 DSH 在夹取区间内是会跟着变宽的。这正是锁定的目的——宽度定一次就固定下来；要改宽度，用面板里的「宽度」，或者用 DSH 原生的拖拽手柄。

## 安装

profile 名就是 `~/.dsh/profiles/` 下的目录名；本插件的开发环境里它叫 `desktop`。下面的命令请换成你自己的。

推荐（不需要手动 clone）：

```powershell
dsh plugin --profile desktop add github:nnnanann/freeze-content-on-window-resize
```

`dsh plugin add` 会把参数转发给 pnpm，所以 pnpm 支持的 spec 都能用。如果要用本地检出：

```powershell
git clone https://github.com/nnnanann/freeze-content-on-window-resize
dsh plugin --profile desktop add link:<clone 出来的目录>
```

两种写法都会往 profile 的 `package.json` 加一条依赖、把 `freeze-content-on-window-resize` 追加到 `dsh.profile.bundles`，然后安装。profile 是热加载的：已经打开的 GUI 页面无需重启即可生效。如果你的 DSH 版本不接受 `github:` 这种 spec，就用上面的 clone + `link:` 写法。

**没有构建步骤**：`client/client.js` 就是一个手写的 DSH 客户端 bundle（`window.__ModuleLoader__.load({ id, factory })`），clone 之后不需要编译；改这个文件会在已打开的页面里热重载。

卸载：

```powershell
dsh plugin --profile desktop remove freeze-content-on-window-resize
```

## 使用

界面**窗口**右下角有一个 26px、平时半透明的锁形按钮（固定在窗口上，所以右侧栏打开时可能压在它上面；不想看到可以在面板里关掉），它的悬浮提示里也写着下面两个快捷键。点开是设置面板：

| 面板项 | English | 含义 |
| --- | --- | --- |
| 锁定内容宽度 | Lock content width | 总开关。关掉即恢复 DSH 原生行为。 |
| 宽度 | Width | 数值框，或预设 `620 / 680 / 748 / 820 / 920`。首次运行会自动采用 DSH 当前的内容宽度，所以装上的瞬间画面不会跳。 |
| 保持阅读位置 | Keep reading position | 锚点补偿开关。 |
| 显示此控件 | Show this control | 关掉后按钮消失。 |
| 恢复默认 | Reset | 回到默认值。 |

面板文案跟随 DSH 自己的界面语言：内置中文与英文两套词典；DSH 处于其它语言时回退到中文。开关下方有一行灰色提示，重申这个取舍：*「锁定后换行不再随窗口变化；窗口更窄时改为横向滚动。」*

键盘快捷键（输入框获得焦点时不触发）：

| 快捷键 | 作用 |
| --- | --- |
| `Alt+Shift+L` | 切换宽度锁定 |
| `Alt+Shift+W` | 在预设宽度间循环 |

DSH 原生的宽度拖拽手柄仍然可用：按下（`cursor: col-resize`）时放开锁定，松手后把拖出来的宽度采纳为新的锁定值。

配置保存在页面 `localStorage` 的 `freeze-content-on-window-resize:config`（`width: 0` 表示「采用 DSH 自己的宽度」，首次运行时会解析成具体数值并写回）：

```json
{ "lockWidth": true, "width": 748, "keepPosition": true, "showControl": true }
```

## 诊断

在页面 DevTools 控制台里：

```js
__fcwr.status()
// { lockWidth, width, keepPosition, showControl,
//   columns: [ { primary, width, anchor }, ... ] }
// columns[].width 是该列当前锁定的宽度；0 表示未锁定。

__fcwr.realign()   // 立即按当前锚点重新对齐
__fcwr.dispose()   // 卸载本次运行的全部效果（不卸载插件）
```

- `freeze-content-on-window-resize:boot` —— 每次启动都会重写的标记：`revision`、`at`、`href`、`locale`、`copy`、`copyState`、`lockWidth`，以及各列锁定的宽度与锚点。
- `copyState` 说明面板文案的来源：`bound`（由宿主 locale 服务提供）、`pending`（还没拿到应答）、`no-service`（没有 locale 服务）、`no-dictionary`（该语言没有词典）、或 `error:` / `inject-failed:` 开头的一条错误信息。
- 启动时控制台会按当前界面语言打印一行：
  `[freeze-content-on-window-resize] 1.0.0 已锁定阅读列: 884px (primary) / …`
  —— 锁定关闭时打印 `… 宽度锁定已关闭`。

## 实现要点

- **不依赖哈希类名。** 只用 DSH 的稳定数据属性：`[data-chat-flow]`（正文列）、`[data-conversation-scroll]`（外层滚动容器）、`[data-composer-seat]`（输入框座位）、`[data-chat-anchor-key]`（锚点行）、`[data-chat-following-tail]`（追新状态）。
- **宽度变量只发布给「同时包含该正文列和它自己的输入框」的那个元素**（最近公共祖先）。这样宽表格、输入框卡片和宽度手柄都能跟上锁定宽度，又不会把某个面板的宽度泄漏到另一个面板的子树里。
- **按列维护状态**：锚点、宽度、滚动容器溢出都逐列记录；`MutationObserver` + `ResizeObserver` 会在 React 换掉元素后自动重新接管。
- **滚动监听挂在 `document` 的捕获阶段**，一次绑定即可扛住 React 反复重挂载；只有属于对话列的滚动才算「读者在滚动」。
- **幂等**：宽度、锁定状态与目标元素都没变时不做任何写入，因此拖拽改变窗口大小不会产生自身抖动。
- **零依赖、零构建**：纯 DOM 实现，不用 React、不需要打包。三个宿主接触点全部可选且有 guard：一个渲染为 `null` 的 `shell.overlay` 占位（让外壳与 `cordis_inspect` 看到该 bundle 已挂载）、`ctx.provide` 上的 `freezeContentOnWindowResize` 服务面、以及用于面板文案的 DSH locale 服务。缺任何一个插件照常工作。

## 已知限制

- **浏览器缩放**（`Ctrl`+滚轮）会改变字号，文字仍会重排；那种情况下靠「保持阅读位置」把阅读行拉回原处，而不是靠宽度锁定。
- 窗口窄于锁定宽度时，正文区会出现**横向滚动条**。这是「永不重排」的代价，也正是锁定想要的行为——不想这样就把宽度调小或关掉锁定。
- 只有主阅读列跟随「宽度」设置；内嵌的对话列固定使用各自面板推导出的宽度。
- 上面提到的 DSH 内部名字与宽度公式是 0.2.0-rc.2 的实现细节，不是稳定 API，未来版本可能改变。

## 仓库结构

```
client/client.js      浏览器半体——插件真正干的事都在这里
lib/index.js          宿主半体——刻意的空 Loader 条目
cordis.patch.yml      插入 Loader 条目的 bundle patch
package.json          声明 dsh.bundle.patch 与 dsh.client
docs/self-test.md     本 README 里那组数字的测法，可在 DevTools 里直接跑
```

## 许可

[MIT](LICENSE)
