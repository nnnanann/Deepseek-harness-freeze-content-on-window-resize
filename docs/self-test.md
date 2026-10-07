# Self-test: how the 2417px number was measured

The README claims that forcing the re-wrap a narrower window produces moved the reading line
**2417px**, and that the anchor compensation put it back to a **0px** offset. This page is the
measurement, so you can reproduce or refute it yourself.

## What it does

It reads the reading anchor exactly the way the plugin does (the topmost visible row carrying
`data-chat-anchor-key`), records its offset from the top of the transcript scrollport, forces
the column 140px narrower — the re-wrap a narrower window produces — measures how far the
anchor moved, calls the plugin's realignment once, and measures again. Then it restores the
column and the scroll position.

Forcing the column width directly is deliberate: it isolates the re-wrap from everything else a
window resize does (composer height, scrollbar, observers), so the number describes the
re-wrapping alone.

## Requirements

- The plugin is installed and the page has loaded it (`__fcwr` exists in the console).
- **The width lock is on** (the panel's first switch). With it off there is no locked width to
  restore, but the snippet restores the column's original inline style either way.
- The view is **not** following the tail. Scroll up a little first: while the view is pinned to
  the newest content the plugin deliberately does not realign, and the test would report no
  correction.
- Do not scroll while it runs — a scroll within 140ms makes the plugin stand down by design.

## Run it

Paste this into the page's DevTools console:

```js
(() => {
  const col = document.querySelector('[data-chat-flow]');
  if (!col) return 'no transcript column on screen';
  const scroller = col.closest('[data-conversation-scroll]') ?? col.parentElement;
  const top = () => scroller.getBoundingClientRect().top;

  let row = null;
  for (const el of col.children) {
    if (!(el instanceof HTMLElement) || el.hidden) continue;
    if (el.dataset.chatAnchorKey === undefined) continue;
    if (el.getBoundingClientRect().bottom > top() + 0.5) { row = el; break; }
  }
  if (row === null) return 'no visible anchor row — scroll a little, then retry';
  if (typeof __fcwr === 'undefined') return 'the plugin is not loaded on this page';

  const offset = row.getBoundingClientRect().top - top();
  const scrollTop = scroller.scrollTop;
  const width = col.offsetWidth;
  const narrow = Math.max(420, width - 140);
  const originalStyle = col.getAttribute('style');

  for (const prop of ['width', 'min-width', 'max-width']) {
    col.style.setProperty(prop, narrow + 'px', 'important');
  }
  const drift = (row.getBoundingClientRect().top - top()) - offset;

  __fcwr.realign();                       // the plugin's own correction

  const after = (row.getBoundingClientRect().top - top()) - offset;
  const moved = scroller.scrollTop - scrollTop;

  if (originalStyle === null) col.removeAttribute('style');
  else col.setAttribute('style', originalStyle);
  scroller.scrollTop = scrollTop;

  return {
    lockedWidth: width,
    forcedWidth: narrow,
    driftPx: Math.round(drift),            // how far the reading line was pushed away
    afterPx: Math.round(after),            // where it sits after the correction
    scrollMovedPx: Math.round(moved)       // how much scroll the correction applied
  };
})()
```

## A recorded run

DSH desktop 0.2.0-rc.2, win32, one long session, the width lock at 884px:

```json
{ "lockedWidth": 884, "forcedWidth": 744, "driftPx": 2417, "afterPx": 0, "scrollMovedPx": 2417 }
```

`driftPx` is the size of the jump you would otherwise have to recover from by hand; `afterPx`
being 0 means the paragraph on the reading line ended up exactly where it started.

## Reading the numbers

- `driftPx` scales with the transcript above the anchor: the more long paragraphs above the
  reading line, the more each of them grows when the column narrows. A short session will
  report a small number, and a session that fits on one screen may report 0.
- `afterPx` should be 0 (or within a pixel of it). A large `afterPx` means the correction did
  not land — report it with the boot stamp from
  `localStorage["freeze-content-on-window-resize:boot"]`.
- `scrollMovedPx` is normally equal to `driftPx`, which is the correction being applied.

## A note on the window/column conversion

A 140px *column* change is not a 140px *window* change. DSH derives the content width from the
pane (`clamp(680px, 0.64 × pane, 920px)` with no stored preference,
`min(max(preference, 640px), max(640px, pane − 176px))` with one), so in the fluid range 140px
of column is roughly 219px of window; where the width is already clamped the two move 1:1.
That is why this document measures the column and never claims a window delta.
