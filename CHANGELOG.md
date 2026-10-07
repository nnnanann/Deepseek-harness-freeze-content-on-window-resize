# Changelog

All notable changes to this plugin are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-07

First public release.

### Added

- **Content-width lock.** Every mounted transcript column is pinned to one pixel width
  (`width` / `min-width` / `max-width`, `!important`), so re-wrapping no longer follows the
  window size. A narrower window scrolls the transcript horizontally instead.
- **Reading-position anchor.** Each column keeps a live anchor (the row on the reading
  line plus its offset) and re-aligns it after a viewport resize or zoom, across two
  animation frames plus one delayed pass.
- **Per-column state.** The primary reading column uses the configured width; a transcript
  embedded in a side panel keeps its own panel-derived width. `MutationObserver` and
  `ResizeObserver` re-adopt columns that React remounts.
- **Settings panel** behind a corner lock button: width lock, width (number box plus
  presets), reading-position lock, hide-the-control, reset.
- **Keyboard shortcuts**: `Alt+Shift+L` toggles the lock, `Alt+Shift+W` cycles widths.
- **Native width handles keep working** — the lock is released while a handle is dragged,
  and the dragged width is adopted as the new locked width.
- **Diagnostics**: the `__fcwr` page global (`status()` / `realign()` / `dispose()`), a
  `freeze-content-on-window-resize:boot` stamp in `localStorage`, and one console line per
  boot carrying the build revision.
- **Config migration**: a configuration written under the pre-rename key
  `dsh-stable-reading:config` is adopted once and then removed.

### Notes

- No build step. `client/client.js` is a hand-written DSH client bundle and is committed
  as-is; editing it hot-reloads the plugin in an open GUI page.
- Verified against DSH desktop `0.2.0-rc.2`. On a live session the lock resolved to the
  app's own content width (884px) and a forced 140px re-wrap — which used to drag the
  reading line 2417px away — was compensated back to a 0px offset.

### Known limitations

- Browser zoom still re-flows text (the anchor pulls the reading line back).
- A window narrower than the locked width gains a horizontal scrollbar in the transcript.
- Only the primary column follows the configured width.
