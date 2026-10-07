# Freeze content on window resize

A [DSH](https://github.com/deepseek-ai) (DeepSeek Harness) Web GUI plugin that stops the
conversation you are reading from moving when the window is resized.

English | [中文](README.zh.md)

---

## The problem

Resize the window while reading a long answer and the text under your eyes changes: the
paragraph you were on is gone and you have to find your place again.

It is not an illusion, and it is not your scroll wheel. The transcript column is:

```css
.xz4KEq_column {
  width: 100%;
  max-width: var(--dsh-chat-content-width);
  margin: 0 auto;
}
```

…inside a scrollport. So the moment the window is narrower than that content width, the
column narrows with it and **every paragraph re-wraps**, while the browser keeps
`scrollTop` in pixels — a number that no longer points at the same text. The Chat view's
own resize handler only re-follows the tail or re-probes the active turn; it never
restores the reader's anchor.

Measured on a real session: narrowing a column from 884px to 744px (a window 140px
narrower) pushed the reading line **2417px** away from where it was.

## What it does

| Mechanism | Effect |
| --- | --- |
| **Lock the content width** | Every mounted reading column is pinned to one pixel width (`width`, `min-width`, `max-width`, all `!important`), so how text wraps never depends on the window. A narrower window scrolls horizontally instead of re-flowing. |
| **Keep the reading position** | Each column keeps a live anchor — the row on the reading line (`data-chat-anchor-key`) plus its offset from the viewport top. After a resize or zoom, the anchor is re-aligned across two animation frames plus one delayed pass. |

Following the tail (`[data-chat-following-tail]`, the "pin to newest" state) is left
entirely to DSH: while it is on, this plugin does not interfere.

The column you are reading takes the width you configure. A transcript **embedded in a
side panel** keeps its own panel-derived width — that width never depended on the window
in the first place.

## Install

```powershell
dsh plugin --profile desktop add link:<absolute path to this folder>
```

or, from a git checkout:

```powershell
dsh plugin --profile desktop add link:/path/to/freeze-content-on-window-resize
```

The command adds a `link:` dependency to the profile's `package.json`, appends
`freeze-content-on-window-resize` to `dsh.profile.bundles`, and installs. The profile
loads the plugin live — an open GUI page picks it up without a restart.

There is **no build step**: `client/client.js` is committed as a hand-written DSH client
bundle (`window.__ModuleLoader__.load({ id, factory })`). Nothing needs compiling after a
clone, and editing that file hot-reloads it in an open page.

Uninstall:

```powershell
dsh plugin --profile desktop remove freeze-content-on-window-resize
```

## Use

A 26px, mostly transparent lock button sits in the bottom-right corner. Click it for the
settings panel:

- **Lock content width** — the master switch. Turn it off for stock DSH behavior.
- **Width** — a number box, or the presets `620 / 680 / 748 / 820 / 920`. On first run it
  adopts DSH's own current content width, so nothing jumps when you install it.
- **Keep reading position** — the anchor compensation switch.
- **Show this control** — hides the button itself.
- **Reset** — back to the defaults.

Keyboard shortcuts (ignored while a text field has focus):

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+L` | Toggle the width lock |
| `Alt+Shift+W` | Cycle the preset widths |

DSH's own width drag handles keep working: pressing one (`cursor: col-resize`) releases
the lock, and releasing the pointer adopts the width you dragged to as the new locked
width.

Settings live in the page's `localStorage` under `freeze-content-on-window-resize:config`:

```json
{ "lockWidth": true, "width": 884, "keepPosition": true, "showControl": true }
```

## Diagnostics

In the page's DevTools console:

```js
__fcwr.status()
// { lockWidth, width, keepPosition, showControl,
//   columns: [ { primary, width, anchor }, ... ] }

__fcwr.realign()   // re-align to the current anchor right now
__fcwr.dispose()   // tear down this run without unloading the plugin
```

- `freeze-content-on-window-resize:boot` — a stamp written on every start: the build
  revision, the time, and every column's locked width and anchor.
- On boot the console logs one line:
  `[freeze-content-on-window-resize] 1.0.0 锁定列宽 …`

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
- **No dependencies.** Plain DOM: no React, no host services, no build tooling. The single
  shell registration is an invisible `shell.overlay` seat that renders `null`, which makes
  the bundle visible to the shell and to `cordis_inspect`.

## Known limitations

- **Browser zoom** (`Ctrl`+wheel) changes the font size, so text still re-flows; the
  reading-position anchor is what pulls the reading line back in that case.
- A window narrower than the locked width shows a **horizontal scrollbar** in the
  transcript. That is the price of never re-wrapping, and it is the behavior the lock is
  for — lower the width or turn the lock off if you would rather re-flow.
- Only the primary reading column follows the **Width** setting; embedded transcripts stay
  at their own panel-derived width.

## Repository layout

```
client/client.js      the browser half — everything this plugin actually does
lib/index.js          the host half — an empty Loader entry, on purpose
cordis.patch.yml      the bundle patch that inserts the Loader entry
package.json          declares dsh.bundle.patch and dsh.client
```

## License

[MIT](LICENSE)
