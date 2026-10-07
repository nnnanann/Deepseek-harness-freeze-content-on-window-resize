# 固定窗口缩放内容

[DSH](https://github.com/deepseek-ai)（DeepSeek Harness）Web GUI 插件：**缩放窗口时，正在阅读的内容不再发生变化。**

[English](README.md) | 中文

---

## 问题是什么

读一段长回答时拉一下窗口，眼前的文字就变了：刚才那一段不见了，得重新找位置。

这不是错觉，也不是滚轮的问题。对话正文列的样式是：

```css
.xz4KEq_column {
  width: 100%;
  max-width: var(--dsh-chat-content-width);
  margin: 0 auto;
}
```

它被放在一个滚动容器里。于是窗口一旦窄于内容宽度，列宽就跟着变窄，**每一段文字重新换行**；而浏览器只保留像素级的 `scrollTop`——这个数字已经不再指向同一段文字了。Chat 视图自己的尺寸变化处理只做两件事：跟随末尾、重算当前回合，**从不恢复读者的锚点**。

在真实会话上实测：把一个列从 884px 缩到 744px（等于窗口拉窄 140px），阅读行被推离原位 **2417px**。

## 它做了什么

| 机制 | 效果 |
| --- | --- |
| **锁定内容宽度** | 每个已挂载的阅读列都被固定成一个像素宽度（`width` / `min-width` / `max-width` 全部 `!important`），换行方式从此与窗口无关。窗口更窄时改为横向滚动，而不是重新排版。 |
| **保持阅读位置** | 每列维护一个实时锚点——阅读线上那一行（`data-chat-anchor-key`）及其相对视口顶部的偏移。尺寸或缩放变化后，跨两个动画帧并对齐一次，另加一次延迟兜底。 |

「跟随末尾」（`[data-chat-following-tail]`，即追新状态）完全交给 DSH 自己处理：该状态开启期间本插件不介入。

你正在读的那一列使用你配置的宽度；**内嵌在侧边面板里的对话列**保留它自己由面板推导出的宽度——那个宽度本来就不随窗口变化。

## 安装

```powershell
dsh plugin --profile desktop add link:<本目录的绝对路径>
```

该命令会往 profile 的 `package.json` 加一条 `link:` 依赖，把
`freeze-content-on-window-resize` 追加到 `dsh.profile.bundles`，然后安装。profile 是热加载的：已经打开的 GUI 页面无需重启即可生效。

**没有构建步骤**：`client/client.js` 就是一个手写的 DSH 客户端 bundle
（`window.__ModuleLoader__.load({ id, factory })`），clone 之后不需要编译；改这个文件会在已打开的页面里热重载。

卸载：

```powershell
dsh plugin --profile desktop remove freeze-content-on-window-resize
```

## 使用

界面右下角有一个 26px、平时半透明的锁形按钮，点开是设置面板：

- **锁定内容宽度** —— 总开关，关掉即恢复 DSH 原生行为。
- **宽度** —— 数值框，或预设 `620 / 680 / 748 / 820 / 920`。首次运行会自动采用 DSH 当前的内容宽度，所以装上的瞬间画面不会跳。
- **保持阅读位置** —— 锚点补偿开关。
- **显示此控件** —— 关掉后按钮消失。
- **恢复默认** —— 回到默认值。

键盘快捷键（输入框获得焦点时不触发）：

| 快捷键 | 作用 |
| --- | --- |
| `Alt+Shift+L` | 切换宽度锁定 |
| `Alt+Shift+W` | 在预设宽度间循环 |

DSH 原生的宽度拖拽手柄仍然可用：按下（`cursor: col-resize`）时放开锁定，松手后把拖出来的宽度采纳为新的锁定值。

配置保存在页面 `localStorage` 的 `freeze-content-on-window-resize:config`：

```json
{ "lockWidth": true, "width": 884, "keepPosition": true, "showControl": true }
```

## 诊断

在页面 DevTools 控制台里：

```js
__fcwr.status()
// { lockWidth, width, keepPosition, showControl,
//   columns: [ { primary, width, anchor }, ... ] }

__fcwr.realign()   // 立即按当前锚点重新对齐
__fcwr.dispose()   // 卸载本次运行的全部效果（不卸载插件）
```

- `freeze-content-on-window-resize:boot` —— 每次启动写入的标记：构建版本、时间、各列锁定的宽度与锚点。
- 启动时控制台会打印一行：`[freeze-content-on-window-resize] 1.0.0 锁定列宽 …`

## 实现要点

- **不依赖哈希类名。** 只用 DSH 的稳定数据属性：`[data-chat-flow]`（正文列）、
  `[data-conversation-scroll]`（外层滚动容器）、`[data-composer-seat]`（输入框座位）、
  `[data-chat-anchor-key]`（锚点行）、`[data-chat-following-tail]`（追新状态）。
- **宽度变量只发布给「同时包含该正文列和它自己的输入框」的那个元素**（最近公共祖先）。这样宽表格、输入框卡片和宽度手柄都能跟上锁定宽度，又不会把某个面板的宽度泄漏到另一个面板的子树里。
- **按列维护状态**：锚点、宽度、滚动容器溢出都逐列记录；`MutationObserver` + `ResizeObserver` 会在 React 换掉元素后自动重新接管。
- **滚动监听挂在 `document` 的捕获阶段**，一次绑定即可扛住 React 反复重挂载；只有属于对话列的滚动才算「读者在滚动」。
- **幂等**：宽度、锁定状态与目标元素都没变时不做任何写入，因此拖拽改变窗口大小不会产生自身抖动。
- **零依赖**：纯 DOM 实现，不用 React、不用宿主服务、无需构建工具。唯一的宿主注册是一个渲染为 `null` 的 `shell.overlay` 占位，用来让外壳与 `cordis_inspect` 看到该 bundle 已挂载。

## 已知限制

- **浏览器缩放**（`Ctrl`+滚轮）会改变字号，文字仍会重排；那种情况下靠「保持阅读位置」把阅读行拉回原处，而不是靠宽度锁定。
- 窗口窄于锁定宽度时，正文区会出现**横向滚动条**。这是「永不重排」的代价，也正是锁定想要的行为——不想这样就把宽度调小或关掉锁定。
- 只有主阅读列跟随「宽度」设置；内嵌的对话列固定使用各自面板推导出的宽度。

## 仓库结构

```
client/client.js      浏览器半体——插件真正干的事都在这里
lib/index.js          宿主半体——刻意的空 Loader 条目
cordis.patch.yml      插入 Loader 条目的 bundle patch
package.json          声明 dsh.bundle.patch 与 dsh.client
```

## 许可

[MIT](LICENSE)
