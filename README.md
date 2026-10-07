# Freeze content on window resize

A plugin for the DeepSeek Harness (DSH) Web GUI that stops the conversation you are reading
from moving when the window is resized.

English | [中文](README.zh.md)

---

## Requirements

- DSH with its Web GUI — the desktop app's window, or `dsh web`.
- Developed and verified against **DSH desktop 0.2.0-rc.2** (win32). It keys off DSH's own
  data attributes rather than hashed class names, so newer builds should keep working.
- Nothing to install or build: no dependencies, no bundler, no compiler.

## The problem

Resize the window while reading a long answer and the text under your eyes changes: the
paragraph you were on is gone and you have to find your place again.

It is not an illusion, and it is not your scroll wheel. The transcript column is:

```css
/* the column's shipped class name in DSH 0.2.0-rc.2 — an internal name, not an API */
.xz4KEq_column {
  width: 100%;
  max-width: var(--dsh-chat-content-width);
  margin: 0 auto;
}
```

…inside a scrollport, while DSH derives that content width from the pane and republishes it
from a `ResizeObserver` on every resize:

| Stored width preference | Content width |
| --- | --- |
| none (a fresh install, or never dragged a width handle) | `clamp(680px, 0.64 × pane, 920px)` |
| a width you dragged before (`localStorage["dsh.conversation.contentWidth"]`) | `min(max(preference, 640px), max(640px, pane − 176px))` |

So with no stored preference the reading column **tracks the window** across the whole pane
range where that `clamp` is not saturated (roughly 1063–1438px): there is no threshold to
stay above, and every resize step re-wraps the text. With a stored preference the width is
fixed until the pane can no longer fit it, and only from there does it shrink with the window.

Meanwhile the browser keeps `scrollTop` in pixels — a number that no longer points at the
same text. The Chat view's own resize handler only re-follows the tail or re-probes the
active turn; it never restores the reader's anchor.

Measured: forcing the re-wrap a narrower window produces — a 140px narrower column — moved
the reading line **2417px** away from where it was, and the anchor compensation put it back
to a 0px offset. [How that is measured](docs/self-test.md) — you can run it yourself.

## What it does

| Mechanism | Effect |
| --- | --- |
| **Lock the content width** | Every mounted reading column is pinned to one pixel width (`width`, `min-width`, `max-width`, all `!important`), so how text wraps never depends on the window. A narrower window scrolls horizontally instead of re-flowing. |
| **Keep the reading position** | Each column keeps a live anchor — the row on the reading line (`data-chat-anchor-key`) plus its offset from the viewport top. After a resize or zoom, the anchor is re-aligned across two animation frames plus one delayed pass. |

While the view is pinned to the newest content (`[data-chat-following-tail]`, the "follow the
tail" state) the anchor compensation stands down and DSH's own auto-follow does its job; the
width lock still applies.

The column you are reading takes the width you configure. A transcript **embedded in a side
panel** keeps its own panel-derived width — that width never depended on the window in the
first place.

One consequence is worth knowing before you install: **once locked, widening the window no
longer widens the reading column.** Stock DSH does widen it whenever the `clamp` is not
saturated. That is the point of the lock — pick your width once and it stays — and the
**Width** setting or DSH's own drag handles are how you change it.

## Install

The profile name is the directory under `~/.dsh/profiles/`; this plugin was developed against
one called `desktop`. Substitute your own in the commands below.

Recommended — no manual clone:

```powershell
dsh plugin --profile desktop add github:nnnanann/freeze-content-on-window-resize
```

`dsh plugin add` forwards its argument to pnpm, so any spec pnpm accepts works. From a local
checkout instead:

```powershell
git clone https://github.com/nnnanann/freeze-content-on-window-resize
dsh plugin --profile desktop add link:<the cloned folder>
```

Either form adds a dependency to the profile's `package.json`, appends
`freeze-content-on-window-resize` to `dsh.profile.bundles`, and installs. The profile loads
the plugin live — an open GUI page picks it up without a restart. If a `github:` spec is
rejected by your DSH build, use the clone-and-`link:` form above.

There is **no build step**: `client/client.js` is committed as a hand-written DSH client
bundle (`window.__ModuleLoader__.load({ id, factory })`). Nothing needs compiling after a
clone, and editing that file hot-reloads it in an open page.

Uninstall:

```powershell
dsh plugin --profile desktop remove freeze-content-on-window-resize
```

## Use

A 26px, mostly transparent lock button sits in the window's bottom-right corner (fixed to the
window, so it can sit over the right sidebar when that is open — hide it from the panel if you
would rather). Its tooltip repeats the two shortcuts below. Click it for the settings panel:

| Panel item | 中文 | Meaning |
| --- | --- | --- |
| Lock content width | 锁定内容宽度 | The master switch. Off returns stock DSH behavior. |
| Width | 宽度 | A number box, or the presets `620 / 680 / 748 / 820 / 920`. On first run it adopts DSH's current content width, so nothing jumps when you install it. |
| Keep reading position | 保持阅读位置 | The anchor compensation switch. |
| Show this control | 显示此控件 | Hides the button itself. |
| Reset | 恢复默认 | Back to the defaults. |

The panel follows DSH's own UI language. It ships a Chinese and an English dictionary and
falls back to Chinese when DSH is in any other language. A grey line under the switches
restates the tradeoff: *"Locking stops the text from re-wrapping; a narrower window scrolls horizontally instead."*

Keyboard shortcuts (ignored while a text field has focus):

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+L` | Toggle the width lock |
| `Alt+Shift+W` | Cycle the preset widths |

DSH's own width drag handles keep working: pressing one (`cursor: col-resize`) releases the
lock, and releasing the pointer adopts the width you dragged to as the new locked width.

Settings live in the page's `localStorage` under `freeze-content-on-window-resize:config`
(`width: 0` means "adopt DSH's own width" — it is resolved and stored on first run):

```json
{ "lockWidth": true, "width": 748, "keepPosition": true, "showControl": true }
```

## Diagnostics

In the page's DevTools console:

```js
__fcwr.status()
// { lockWidth, width, keepPosition, showControl,
//   columns: [ { primary, width, anchor }, ... ] }
// columns[].width is the width that column is locked to; 0 means it is not locked.

__fcwr.realign()   // re-align to the current anchor right now
__fcwr.dispose()   // tear down this run without unloading the plugin
```

- `freeze-content-on-window-resize:boot` — a stamp rewritten on every start: `revision`, `at`,
  `href`, `locale`, `copy`, `copyState`, `lockWidth`, and every column's locked width and anchor.
- `copyState` explains the panel language: `bound` (the host locale service supplies the copy),
  `pending` (no answer yet), `no-service` (no locale service), `no-dictionary` (that language
  has none here), or an `error:` / `inject-failed:` message.
- On boot the console logs one line, in the active UI language:
  `[freeze-content-on-window-resize] 1.0.0 locked reading columns: 884px (primary) / …`
  — or `… width lock off` when the lock is disabled.

## How it works

- **No hashed class names.** Only DSH's stable data attributes are used:
  `[data-chat-flow]` (the column), `[data-conversation-scroll]` (the outer scrollport),
  `[data-composer-seat]` (the composer), `[data-chat-anchor-key]` (an anchor row),
  `[data-chat-following-tail]` (the pin-to-newest state).
- **The width variable is republished only to the element that holds both a column and
  its own composer** — the nearest common ancestor. That keeps wide markdown tables, the
  composer card and the width handles consistent with the locked column, without leaking
  one panel's width into another panel's subtree.
- **Per-column state.** Anchor, width, and scrollport overflow are tracked per column, and
  a `MutationObserver` plus a `ResizeObserver` re-adopt a column that React remounted.
- **Scroll handling is a capture-phase listener on `document`**, so one binding survives
  React remounts; only scrolls belonging to a transcript count as "the reader is
  scrolling".
- **Idempotent.** Nothing is written when the width, the lock state and the target
  elements are unchanged, so resizing never causes its own jitter.
- **No dependencies and no build tooling.** Plain DOM — no React, no bundle step. Its host
  touchpoints are all optional and guarded: an invisible `shell.overlay` seat that renders
  `null` (so the shell and `cordis_inspect` can see the bundle is mounted), a
  `freezeContentOnWindowResize` service face on `ctx.provide`, and the DSH locale service for
  the panel copy. Without any of them the plugin still works.

## Known limitations

- **Browser zoom** (`Ctrl`+wheel) changes the font size, so text still re-flows; the
  reading-position anchor is what pulls the reading line back in that case.
- A window narrower than the locked width shows a **horizontal scrollbar** in the
  transcript. That is the price of never re-wrapping, and it is the behavior the lock is
  for — lower the width or turn the lock off if you would rather re-flow.
- Only the primary reading column follows the **Width** setting; embedded transcripts stay
  at their own panel-derived width.
- DSH's internal names and the width formula above are implementation details of
  0.2.0-rc.2, not a stable API; a future build can change them.

## Repository layout

```
client/client.js      the browser half — everything this plugin actually does
lib/index.js          the host half — an empty Loader entry, on purpose
cordis.patch.yml      the bundle patch that inserts the Loader entry
package.json          declares dsh.bundle.patch and dsh.client
docs/self-test.md     the measurement behind this README, runnable from DevTools
```

## License

[MIT](LICENSE)
