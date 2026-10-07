# Changelog

All notable changes to this plugin are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The `REVISION` constant in
`client/client.js` is `<package version>+<build>` and the boot stamp records it, so a page can
always say which build it is running.

## [1.0.0] — 2026-10-07

First release.

### Added

- **Content-width lock.** Every mounted transcript column is pinned to one pixel width
  (`width` / `min-width` / `max-width`, `!important`), so re-wrapping no longer follows the
  window size. A narrower window scrolls the transcript horizontally instead.
- **Reading-position anchor.** Each column keeps a live anchor (the row on the reading line
  plus its offset) and re-aligns it after a viewport resize or zoom, across two animation
  frames plus one delayed pass. While the view is pinned to the newest content
  (`[data-chat-following-tail]`) the compensation stands down and DSH's auto-follow keeps the
  tail; the width lock still applies.
- **Per-column state.** The primary reading column uses the configured width; a transcript
  embedded in a side panel keeps its own panel-derived width. A `MutationObserver` and a
  `ResizeObserver` re-adopt columns React remounts.
- **Settings panel** behind a corner lock button: width lock, width (number box plus presets),
  reading-position lock, hide-the-control, reset.
- **Bilingual panel.** Chinese and English dictionaries registered through DSH's client locale
  service, so the panel follows DSH's own UI language; any other language falls back to
  Chinese. Registration is once per page session, so hot reloads and enable/disable cycles do
  not trip the locale service's duplicate-namespace guard.
- **Keyboard shortcuts**: `Alt+Shift+L` toggles the lock, `Alt+Shift+W` cycles widths.
- **Native width handles keep working** — the lock is released while a handle is dragged, and
  the dragged width is adopted as the new locked width.
- **Diagnostics**: the `__fcwr` page global (`status()` / `realign()` / `dispose()`), a
  `freeze-content-on-window-resize:boot` stamp in `localStorage` (revision, time, locale,
  copy source, lock state, per-column locked width and anchor), and one console line per boot
  in the active UI language.
- **Config migration**: a configuration written under the pre-rename key
  `dsh-stable-reading:config` is adopted once and then removed.
- **[docs/self-test.md](docs/self-test.md)** — the measurement behind the README, paste-able
  into DevTools.

### Notes

- No build step. `client/client.js` is a hand-written DSH client bundle (`window.__ModuleLoader__.load`),
  committed as-is; editing it hot-reloads the plugin in an open GUI page.
- `columns[].width` in `status()` and in the boot stamp is the width a column is locked to;
  `0` means "not locked" rather than an internal sentinel.
- The panel's copy changes need a page reload when the dictionary itself changes, because a
  page session keeps the first registration of a locale namespace.

### Verification

What was checked, and how:

| Claim | Evidence |
| --- | --- |
| The host loads the plugin | `plugin_manager` lists `include:freeze-content-on-window-resize` as enabled/active |
| The browser half actually runs in the GUI | the bundle's `shell.overlay` seat appears under `cordis_inspect` → client `Slots`, registrant `freeze-content-on-window-resize` |
| The reading column is locked | boot stamp: columns at `884px (primary)` / `879px` / `879px`, later `920px`, matching DSH's own `dsh.conversation.contentWidth` |
| The anchor compensation works | [docs/self-test.md](docs/self-test.md) — a forced 140px re-wrap moved the reading line 2417px; the correction returned it to a 0px offset |
| The panel copy is served by the locale service | boot stamp `locale: "zh"`, `copy: "locale"`, `copyState: "bound"` |
| A git-spec install resolves and packs correctly | `pnpm add git+file:///…` into a scratch project installed `freeze-content-on-window-resize@1.0.0` containing `client/client.js`, `cordis.patch.yml` and the `dsh` manifest field |
| `link:` install works end to end through DSH | `dsh plugin --profile desktop add link:…` added the dependency, appended the bundle name, and the running GUI picked it up without a restart |

Developed and verified against DSH desktop 0.2.0-rc.2 (win32). The build was never published
to a registry; the `github:` install form was verified at the pnpm resolution layer only, as
noted above.

### Known limitations

- Browser zoom (`Ctrl`+wheel) still re-flows text; the anchor pulls the reading line back.
- A window narrower than the locked width gains a horizontal scrollbar in the transcript.
- Only the primary reading column follows the configured width.
- Once the lock is on, widening the window no longer widens the reading column — expected, and
  the reason the Width setting and the native drag handles exist.
- DSH's internal attribute names and its content-width formula are implementation details of
  0.2.0-rc.2, not a stable API.
