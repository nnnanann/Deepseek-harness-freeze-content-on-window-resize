/**
 * freeze-content-on-window-resize — browser half.
 *
 * Why the reading content moves on a window resize: the DSH transcript column
 * is `width:100%; max-width:var(--dsh-chat-content-width)` inside a scrollport,
 * so any window narrower than that content width re-wraps every paragraph, while
 * the browser keeps `scrollTop` in pixels. The Chat view's own resize handler
 * only re-follows the tail or re-probes the active turn; it never restores the
 * reader's anchor. The result is that the text under the reading line changes.
 *
 * This bundle fixes both halves:
 *   1. it freezes each reading column at one width, so wrapping never depends on
 *      the window size (a narrower window scrolls horizontally instead). The
 *      column the reader is in takes the configured width; a transcript embedded
 *      in a panel keeps its own panel-derived width, which the window never
 *      changes anyway;
 *   2. it keeps a live reading anchor per column and re-aligns it after every
 *      viewport resize or zoom, so the same paragraph stays on the reading line.
 *
 * Everything here is plain DOM work: no React, no host services, no build step.
 * The only shell registration is an invisible `shell.overlay` seat, so the
 * plugin is visible to the shell and to `cordis_inspect` when it is mounted.
 *
 * Configure it from the lock panel in the bottom-right corner, or from the page
 * global `__fcwr` (see README.md).
 */

window.__ModuleLoader__.load({
	id: "freeze-content-on-window-resize",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region constants
		var NAME = "freeze-content-on-window-resize";
		/** `<package version>+<build>`; the boot stamp records which build the page runs. */
		var REVISION = "1.0.0+4";
		var STORE_KEY = "freeze-content-on-window-resize:config";
		/** The key the same setting used before this package was renamed. */
		var LEGACY_STORE_KEY = "dsh-stable-reading:config";
		var BOOT_KEY = "freeze-content-on-window-resize:boot";
		var STYLE_ID = "freeze-content-on-window-resize-style";
		var CONTROL_ID = "freeze-content-on-window-resize-control";

		/** A reading column (Chat's `.column`), one per mounted transcript. */
		var COLUMN_SELECTOR = "[data-chat-flow]";
		/** The transcript scrollport when the frame owns it (conversation composition). */
		var SCROLL_SELECTOR = "[data-conversation-scroll]";
		/** The composer seat: its nearest common ancestor with a column owns the width variable. */
		var COMPOSER_SELECTOR = "[data-composer-seat]";
		/** Chat root marker for "this view is pinned to the newest content". */
		var FOLLOW_SELECTOR = "[data-chat-following-tail]";
		/** The inherited width variable the transcript, its wide tables and the composer read. */
		var WIDTH_VAR = "--dsh-chat-content-width";

		var MIN_WIDTH = 420;
		var MAX_WIDTH = 1600;
		var FALLBACK_WIDTH = 680;
		var PRESETS = [620, 680, 748, 820, 920];
		/** A resize within this window of real reader scrolling belongs to the reader. */
		var READER_SCROLL_GRACE_MS = 140;

		var DEFAULTS = {
			lockWidth: true,
			/** 0 means "adopt the app's own content width on first run". */
			width: 0,
			keepPosition: true,
			showControl: true
		};

		/** Locale namespace this plugin's panel copy registers under. */
		var NS = NAME;
		/** Page-scoped marker: this page session has already registered the namespace. */
		var LOCALE_FLAG = "__freezeContentOnWindowResizeLocale";
		/** Copy for both shipped languages; Chinese is also the built-in fallback. */
		var DICTIONARIES = {
			zh: {
				title: "固定窗口缩放内容",
				pill: "固定窗口缩放内容设置（Alt+Shift+L 切换锁定，Alt+Shift+W 换宽度）",
				lock: "锁定内容宽度",
				width: "宽度",
				keep: "保持阅读位置",
				show: "显示此控件",
				reset: "恢复默认",
				hint: "锁定后换行不再随窗口变化；窗口更窄时改为横向滚动。",
				boot: "已锁定阅读列",
				bootOff: "宽度锁定已关闭"
			},
			en: {
				title: "Freeze content on window resize",
				pill: "Freeze content on window resize — settings (Alt+Shift+L toggles the lock, Alt+Shift+W cycles widths)",
				lock: "Lock content width",
				width: "Width",
				keep: "Keep reading position",
				show: "Show this control",
				reset: "Reset",
				hint: "Locking stops the text from re-wrapping; a narrower window scrolls horizontally instead.",
				boot: "locked reading columns",
				bootOff: "width lock off"
			}
		};

		/**
		 * The active copy. The host's locale service, when the host has one, replaces
		 * the built-in dictionary through `bind`; without it — or when that language
		 * has no dictionary here — the panel stays Chinese and nothing else changes.
		 */
		var copy = {
			id: null,
			bound: false,
			translate: null,
			/** Why the panel copy is what it is; recorded in the boot stamp. */
			state: "pending",
			t: function (key) {
				if (copy.translate !== null) {
					var translated = copy.translate(key);
					if (typeof translated === "string" && translated !== "" && translated !== key) return translated;
				}
				var fallback = DICTIONARIES.zh[key];
				return typeof fallback === "string" ? fallback : key;
			},
			bind: function (locale) {
				var snapshot = null;
				try {
					snapshot = locale.getSnapshot();
				} catch (error) {
					snapshot = null;
				}
				var id = snapshot !== null && typeof snapshot.active === "string" ? snapshot.active : null;
				var translate = null;
				try {
					translate = locale.bind(NS);
				} catch (error) {
					translate = null;
				}
				var probe = typeof translate === "function" ? translate("title") : null;
				copy.id = id;
				// A passthrough of the key means this language has no dictionary: keep
				// the built-in copy rather than showing raw keys in the panel.
				if (typeof probe !== "string" || probe === "" || probe === "title") {
					copy.translate = null;
					copy.bound = false;
					copy.state = "no-dictionary";
					return;
				}
				copy.translate = translate;
				copy.bound = true;
				copy.state = "bound";
			}
		};
		//#endregion

		//#region small utilities
		function clamp(value, low, high) {
			return value < low ? low : value > high ? high : value;
		}

		function now() {
			return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
		}

		function readJson(key) {
			try {
				var raw = window.localStorage.getItem(key);
				if (raw === null) return {};
				var parsed = JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch (error) {
				return {};
			}
		}

		function writeJson(key, value) {
			try {
				window.localStorage.setItem(key, JSON.stringify(value));
			} catch (error) {
				/* a disabled or full store must not break the page */
			}
		}

		function bool(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}

		function px(value) {
			var n = parseFloat(value);
			return Number.isFinite(n) ? n : NaN;
		}
		//#endregion

		//#region runtime
		/**
		 * One page-lifetime runtime owning config, the per-column state, the
		 * injected furniture and every listener the plugin installs.
		 */
		function createRuntime() {
			var config = readConfig();
			/** One entry per mounted reading column. */
			var states = [];
			var styleEl = null;
			var controlEl = null;
			var panelEl = null;
			var pillEl = null;
			var resizeObserver = null;
			var observed = [];
			var bodyObserver = null;
			var applyFrame = 0;
			var disposed = false;

			var captureFrame = 0;
			var restoreFrames = [];
			var settleTimer = 0;
			var ownScroll = false;
			var ownScrollFrame = 0;
			var lastReaderScroll = -Infinity;
			var dragReleased = false;

			function readConfig() {
				var stored = readJson(STORE_KEY);
				if (Object.keys(stored).length === 0) {
					// Adopt the configuration written by the pre-rename package name.
					var legacy = readJson(LEGACY_STORE_KEY);
					if (Object.keys(legacy).length > 0) {
						stored = legacy;
						writeJson(STORE_KEY, legacy);
						try {
							window.localStorage.removeItem(LEGACY_STORE_KEY);
						} catch (error) {
							/* a disabled store keeps the legacy key; harmless */
						}
					}
				}
				var width = Math.round(px(stored.width));
				if (!Number.isFinite(width)) width = 0;
				return {
					lockWidth: bool(stored.lockWidth, DEFAULTS.lockWidth),
					width: width > 0 ? clamp(width, MIN_WIDTH, MAX_WIDTH) : 0,
					keepPosition: bool(stored.keepPosition, DEFAULTS.keepPosition),
					showControl: bool(stored.showControl, DEFAULTS.showControl)
				};
			}

			function persist() {
				writeJson(STORE_KEY, {
					lockWidth: config.lockWidth,
					width: config.width,
					keepPosition: config.keepPosition,
					showControl: config.showControl
				});
			}

			//#region DOM discovery
			/**
			 * Every mounted transcript, in DOM order, each with its own anchor, its own
			 * overridden ancestors and its own locked width. React remounts replace
			 * elements, so disconnected states are dropped and new columns adopted on
			 * each call.
			 */
			function columns() {
				var live = [];
				for (var i = 0; i < states.length; i++) {
					if (states[i].col.isConnected) live.push(states[i]);
				}
				states = live;
				var found = document.querySelectorAll(COLUMN_SELECTOR);
				for (var j = 0; j < found.length; j++) {
					var el = found[j];
					var known = false;
					for (var k = 0; k < states.length; k++) {
						if (states[k].col === el) {
							known = true;
							break;
						}
					}
					if (!known) {
						states.push({
							col: el,
							anchor: null,
							primary: false,
							lockedWidth: 0,
							appliedWidth: -1,
							varTarget: null
						});
					}
				}
				return states;
			}

			/** The element that actually scrolls one transcript, whichever frame owns it. */
			function scrollerOf(col) {
				if (col === null) return null;
				var outer = col.closest(SCROLL_SELECTOR);
				return outer !== null ? outer : col.parentElement;
			}

			/** Per column: is this view pinned to the newest content? */
			function followingTail(col) {
				return col.closest(FOLLOW_SELECTOR) !== null;
			}

			/** A column's intended content width, read before this plugin overrides anything. */
			function appContentWidth(col) {
				var declared = "";
				try {
					declared = window.getComputedStyle(col).maxWidth;
				} catch (error) {
					declared = "";
				}
				var fromCss = px(declared);
				if (Number.isFinite(fromCss) && fromCss >= MIN_WIDTH && fromCss <= MAX_WIDTH) return Math.round(fromCss);
				var measured = col.getBoundingClientRect().width;
				if (Number.isFinite(measured) && measured >= MIN_WIDTH) return Math.round(measured);
				return FALLBACK_WIDTH;
			}
			//#endregion

			//#region width lock
			/**
			 * The column the reader is in: the largest rendered transcript, chosen once
			 * and held for the page lifetime so the choice cannot flap as panels resize.
			 */
			function ensurePrimary() {
				var all = columns();
				for (var i = 0; i < all.length; i++) {
					if (all[i].primary && all[i].col.isConnected) return all[i];
				}
				var best = null;
				var bestArea = -1;
				for (var j = 0; j < all.length; j++) {
					all[j].primary = false;
					var rect = all[j].col.getBoundingClientRect();
					var area = rect.width * rect.height;
					if (area > bestArea) {
						bestArea = area;
						best = all[j];
					}
				}
				if (best !== null) best.primary = true;
				return best;
			}

			/** This column's locked width: the configured one for the primary, its own otherwise. */
			function columnWidth(state) {
				var declared = appContentWidth(state.col);
				if (!state.primary || config.width <= 0) return clamp(declared, MIN_WIDTH, MAX_WIDTH);
				return clamp(config.width, MIN_WIDTH, MAX_WIDTH);
			}

			/** The width the control panel shows and the config stores. */
			function effectiveWidth() {
				var primary = ensurePrimary();
				if (primary === null) {
					if (config.width <= 0) {
						config.width = FALLBACK_WIDTH;
						persist();
					}
					return clamp(config.width, MIN_WIDTH, MAX_WIDTH);
				}
				if (config.width <= 0) {
					config.width = appContentWidth(primary.col);
					persist();
				}
				return clamp(config.width, MIN_WIDTH, MAX_WIDTH);
			}

			/** Only the control's own CSS: column widths are inline, so they stay per column. */
			function ensureStyle() {
				if (styleEl === null || !styleEl.isConnected) {
					var found = document.getElementById(STYLE_ID);
					if (found !== null) {
						styleEl = found;
					} else {
						styleEl = document.createElement("style");
						styleEl.id = STYLE_ID;
						var head = document.head !== null ? document.head : document.documentElement;
						head.appendChild(styleEl);
					}
				}
				var text = controlCss();
				if (styleEl.textContent !== text) styleEl.textContent = text;
			}

			function lockColumn(state, width) {
				if (state.lockedWidth === width) return;
				var el = state.col;
				el.style.setProperty("width", width + "px", "important");
				el.style.setProperty("min-width", width + "px", "important");
				el.style.setProperty("max-width", width + "px", "important");
				el.style.setProperty("flex", "0 0 auto", "important");
				state.lockedWidth = width;
			}

			function unlockColumn(state) {
				if (state.lockedWidth === 0) return;
				var el = state.col;
				el.style.removeProperty("width");
				el.style.removeProperty("min-width");
				el.style.removeProperty("max-width");
				el.style.removeProperty("flex");
				state.lockedWidth = 0;
			}

			/**
			 * The element that holds both a transcript and its composer — the one that
			 * defines the width variable for that frame. Publishing the locked width
			 * there makes wide tables, the composer card and the width handles agree
			 * with the column, without leaking the value into another panel's subtree.
			 */
			function widthScope(col) {
				var seats = document.querySelectorAll(COMPOSER_SELECTOR);
				for (var i = 0; i < seats.length; i++) {
					var node = col;
					while (node !== null && node !== document.body) {
						if (node.contains(seats[i])) return node;
						node = node.parentElement;
					}
				}
				return col;
			}

			function applyVarOverride(state, width) {
				var scope = widthScope(state.col);
				if (state.varTarget !== null && state.varTarget !== scope && state.varTarget.isConnected) {
					state.varTarget.style.removeProperty(WIDTH_VAR);
				}
				scope.style.setProperty(WIDTH_VAR, width + "px");
				state.varTarget = scope;
			}

			function clearVarOverride(state) {
				if (state.varTarget !== null && state.varTarget.isConnected) state.varTarget.style.removeProperty(WIDTH_VAR);
				state.varTarget = null;
			}

			/** Give the scrollport horizontal room, so a narrow window scrolls instead of re-wrapping. */
			function setScrollerOverflow(col, on) {
				var targets = [col.parentElement, col.closest(SCROLL_SELECTOR)];
				for (var i = 0; i < targets.length; i++) {
					var el = targets[i];
					if (el === null || el === undefined) continue;
					var want = on ? "auto" : "";
					if (el.style.overflowX !== want) el.style.overflowX = want;
				}
			}

			/** Idempotent: a column is rewritten only when its width, the lock or the elements changed. */
			function applyWidth(force) {
				ensurePrimary();
				ensureStyle();
				var all = columns();
				for (var i = 0; i < all.length; i++) {
					var state = all[i];
					if (!config.lockWidth) {
						unlockColumn(state);
						clearVarOverride(state);
						setScrollerOverflow(state.col, false);
						state.appliedWidth = -1;
						continue;
					}
					var width = columnWidth(state);
					var settled = state.appliedWidth === width &&
						state.lockedWidth === width &&
						state.col.isConnected &&
						state.varTarget !== null &&
						state.varTarget.isConnected;
					if (force !== true && settled) {
						setScrollerOverflow(state.col, true);
						continue;
					}
					state.appliedWidth = width;
					lockColumn(state, width);
					applyVarOverride(state, width);
					setScrollerOverflow(state.col, true);
				}
			}

			/** Re-attach observation after React replaced a column or its scrollport. */
			function refresh() {
				var all = columns();
				for (var i = 0; i < all.length; i++) observeGeometry(all[i]);
			}

			function scheduleApply() {
				if (applyFrame !== 0) return;
				applyFrame = window.requestAnimationFrame(function () {
					applyFrame = 0;
					if (disposed) return;
					applyWidth(false);
					refresh();
				});
			}
			//#endregion

			//#region reading anchor
			/** Snapshot the row on one column's reading line, with its offset from the viewport top. */
			function capturePosition(state) {
				var scroller = scrollerOf(state.col);
				if (scroller === null) return null;
				var viewportTop = scroller.getBoundingClientRect().top;
				var rows = state.col.children;
				var last = null;
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i];
					if (!(row instanceof HTMLElement) || row.hidden) continue;
					if (row.dataset.chatAnchorKey === undefined) continue;
					var rect = row.getBoundingClientRect();
					if (rect.width === 0 && rect.height === 0) continue;
					last = row;
					if (rect.bottom <= viewportTop + 0.5) continue;
					return snapshot(pickAnchor(row, viewportTop), viewportTop, scroller);
				}
				if (last === null) {
					return { key: null, offset: 0, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
				}
				return snapshot(pickAnchor(last, viewportTop), viewportTop, scroller);
			}

			/**
			 * Resolve the anchor inside one row: a grouped row re-anchors to its first
			 * visible part, exactly as the Chat view's own capture does.
			 */
			function pickAnchor(row, viewportTop) {
				if (row.dataset.chatGroupKey === undefined) return row;
				var parts = row.querySelectorAll("[data-chat-anchor-key]");
				for (var i = 0; i < parts.length; i++) {
					if (parts[i].getBoundingClientRect().bottom > viewportTop + 0.5) return parts[i];
				}
				return row;
			}

			function snapshot(el, viewportTop, scroller) {
				var key = el.dataset.chatAnchorKey;
				if (key === undefined) return null;
				return {
					key: key,
					offset: el.getBoundingClientRect().top - viewportTop,
					scrollTop: scroller.scrollTop,
					scrollHeight: scroller.scrollHeight
				};
			}

			function rowByKey(col, key) {
				var rows = col.querySelectorAll("[data-chat-anchor-key]");
				for (var i = 0; i < rows.length; i++) {
					if (rows[i].dataset.chatAnchorKey === key) return rows[i];
				}
				return null;
			}

			function writeScroll(scroller, value) {
				ownScroll = true;
				scroller.scrollTop = value;
				if (ownScrollFrame !== 0) return;
				ownScrollFrame = window.requestAnimationFrame(function () {
					ownScrollFrame = 0;
					ownScroll = false;
				});
			}

			/** Put one column's remembered anchor back on its reading line. */
			function restorePosition(state) {
				if (disposed || !config.keepPosition) return;
				var snap = state.anchor;
				if (snap === null) return;
				if (followingTail(state.col)) return;
				if (now() - lastReaderScroll < READER_SCROLL_GRACE_MS) return;
				if (!state.col.isConnected) return;
				var scroller = scrollerOf(state.col);
				if (scroller === null) return;
				var row = snap.key === null ? null : rowByKey(state.col, snap.key);
				if (row !== null) {
					var viewportTop = scroller.getBoundingClientRect().top;
					var delta = (row.getBoundingClientRect().top - viewportTop) - snap.offset;
					if (Math.abs(delta) > 0.5) writeScroll(scroller, scroller.scrollTop + delta);
					return;
				}
				// The anchor row is gone (a re-render dropped it): keep the relative place.
				if (snap.scrollHeight > 0 && scroller.scrollHeight > 0) {
					writeScroll(scroller, (snap.scrollTop / snap.scrollHeight) * scroller.scrollHeight);
				}
			}

			function captureAll() {
				var all = columns();
				for (var i = 0; i < all.length; i++) {
					var next = capturePosition(all[i]);
					if (next !== null) all[i].anchor = next;
				}
			}

			function scheduleCapture() {
				if (captureFrame !== 0) return;
				captureFrame = window.requestAnimationFrame(function () {
					captureFrame = 0;
					captureAll();
				});
			}

			function restoreAll() {
				for (var i = 0; i < states.length; i++) restorePosition(states[i]);
			}

			/**
			 * Re-align over the next two frames (layout, then our own correction's
			 * layout) plus one delayed pass for the composer and scrollbar settling.
			 */
			function scheduleRestore() {
				if (disposed || !config.keepPosition) return;
				if (restoreFrames.length > 0) return;
				restoreFrames.push(window.requestAnimationFrame(function () {
					restoreFrames = [];
					restoreAll();
					restoreFrames.push(window.requestAnimationFrame(function () {
						restoreFrames = [];
						restoreAll();
					}));
				}));
				if (settleTimer !== 0) window.clearTimeout(settleTimer);
				settleTimer = window.setTimeout(function () {
					settleTimer = 0;
					restoreAll();
				}, 120);
			}

			/** Is this scroll one of our transcripts'? Other panels must not count as reading. */
			function isTranscriptScroll(event) {
				if (event === undefined || event.target === undefined) return false;
				for (var i = 0; i < states.length; i++) {
					if (event.target === scrollerOf(states[i].col)) return true;
				}
				return false;
			}

			/** Capture-phase on the document: one binding survives every React remount. */
			function onScroll(event) {
				if (ownScroll || !isTranscriptScroll(event)) return;
				lastReaderScroll = now();
				scheduleCapture();
			}

			function onScrollEnd(event) {
				if (ownScroll || !isTranscriptScroll(event)) return;
				lastReaderScroll = now();
				captureAll();
			}

			function onResize() {
				if (disposed) return;
				applyWidth(true);
				columns();
				for (var i = 0; i < states.length; i++) {
					if (states[i].anchor === null) {
						scheduleCapture();
						break;
					}
				}
				scheduleRestore();
			}
			//#endregion

			//#region listeners
			/**
			 * React to viewport changes only. A column that merely grew taller while
			 * text streamed in must not trigger a realignment.
			 */
			function observeGeometry(state) {
				if (typeof window.ResizeObserver !== "function") return;
				var scroller = scrollerOf(state.col);
				if (resizeObserver === null) {
					resizeObserver = new window.ResizeObserver(function (entries) {
						if (disposed) return;
						refresh();
						for (var i = 0; i < entries.length; i++) {
							var entry = entries[i];
							if (entry.target.__dsrScroller !== true) continue;
							var box = entry.contentRect.width + "x" + entry.contentRect.height;
							if (entry.target.__dsrBox === box) continue;
							entry.target.__dsrBox = box;
							scheduleRestore();
						}
					});
				}
				var targets = [state.col, scroller];
				for (var i = 0; i < targets.length; i++) {
					var target = targets[i];
					if (target === null || target === undefined) continue;
					if (observed.indexOf(target) !== -1) continue;
					if (target === scroller) target.__dsrScroller = true;
					resizeObserver.observe(target);
					observed.push(target);
				}
			}

			/** Adopt a column React just mounted, including one opened in another panel. */
			function onMutations(records) {
				for (var i = 0; i < records.length; i++) {
					var added = records[i].addedNodes;
					for (var j = 0; j < added.length; j++) {
						var node = added[j];
						if (!(node instanceof Element)) continue;
						if (node.matches(COLUMN_SELECTOR) || node.querySelector(COLUMN_SELECTOR) !== null) {
							scheduleApply();
							return;
						}
					}
				}
			}

			function bind() {
				document.addEventListener("scroll", onScroll, { passive: true, capture: true });
				document.addEventListener("scrollend", onScrollEnd, { passive: true, capture: true });
				window.addEventListener("resize", onResize, { passive: true });
				if (window.visualViewport !== undefined && window.visualViewport !== null) {
					window.visualViewport.addEventListener("resize", onResize, { passive: true });
				}
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("pointerup", onPointerUp, true);
				document.addEventListener("pointercancel", onPointerUp, true);
				document.addEventListener("keydown", onKeyDown, true);
				if (typeof window.MutationObserver === "function" && document.body !== null) {
					bodyObserver = new window.MutationObserver(onMutations);
					bodyObserver.observe(document.body, { childList: true, subtree: true });
				}
			}

			/** Keep the frame's own width handles usable: release the lock while one is dragged. */
			function onPointerDown(event) {
				if (!config.lockWidth) return;
				var el = event.target;
				if (!(el instanceof Element)) return;
				var cursor = "";
				try {
					cursor = window.getComputedStyle(el).cursor;
				} catch (error) {
					cursor = "";
				}
				if (cursor !== "col-resize") return;
				dragReleased = true;
				columns();
				for (var i = 0; i < states.length; i++) {
					clearVarOverride(states[i]);
					unlockColumn(states[i]);
					setScrollerOverflow(states[i].col, false);
					states[i].appliedWidth = -1;
				}
			}

			function onPointerUp() {
				if (!dragReleased) return;
				dragReleased = false;
				var primary = ensurePrimary();
				// Adopt whatever width the drag produced, then lock at it.
				if (primary !== null) {
					var declared = "";
					try {
						declared = window.getComputedStyle(primary.col).maxWidth;
					} catch (error) {
						declared = "";
					}
					var dragged = px(declared);
					if (Number.isFinite(dragged) && dragged >= MIN_WIDTH && dragged <= MAX_WIDTH) config.width = Math.round(dragged);
				}
				persist();
				applyWidth(true);
				syncControl();
				scheduleRestore();
			}

			function onKeyDown(event) {
				if (!event.altKey || !event.shiftKey) return;
				var el = event.target;
				if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
				if (event.code === "KeyL") {
					event.preventDefault();
					config.lockWidth = !config.lockWidth;
					persist();
					applyWidth(true);
					syncControl();
					return;
				}
				if (event.code === "KeyW") {
					event.preventDefault();
					cycleWidth(1);
				}
			}
			//#endregion

			//#region control panel
			function controlCss() {
				return "#" + CONTROL_ID + "{position:fixed;right:10px;bottom:14px;z-index:2147483000;font:12px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--dsw-alias-label-primary,#e8e8ea)}" +
					"#" + CONTROL_ID + " *{box-sizing:border-box}" +
					"#" + CONTROL_ID + " .fcwr-pill{width:26px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l3,#3a3a40);border-radius:13px;background:var(--dsw-alias-bg-base,#17171a);color:inherit;cursor:pointer;opacity:.4;transition:opacity .12s}" +
					"#" + CONTROL_ID + " .fcwr-pill:hover,#" + CONTROL_ID + " .fcwr-pill[aria-expanded=true]{opacity:1}" +
					"#" + CONTROL_ID + " .fcwr-panel{position:absolute;right:0;bottom:34px;width:242px;padding:12px;border:1px solid var(--dsw-alias-border-l3,#3a3a40);border-radius:10px;background:var(--dsw-alias-bg-base,#17171a);box-shadow:0 12px 32px rgba(0,0,0,.36)}" +
					"#" + CONTROL_ID + " .fcwr-title{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#b9b9c0)}" +
					"#" + CONTROL_ID + " .fcwr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0}" +
					"#" + CONTROL_ID + " .fcwr-row label{cursor:pointer}" +
					"#" + CONTROL_ID + " input[type=checkbox]{accent-color:var(--dsw-alias-state-business-primary,#4d6bfe);cursor:pointer}" +
					"#" + CONTROL_ID + " .fcwr-width{display:flex;align-items:center;gap:6px;padding:3px 0}" +
					"#" + CONTROL_ID + " input[type=number]{width:66px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l3,#3a3a40);border-radius:6px;background:transparent;color:inherit;font:inherit}" +
					"#" + CONTROL_ID + " .fcwr-presets{display:flex;flex-wrap:wrap;gap:4px;padding-top:4px}" +
					"#" + CONTROL_ID + " .fcwr-preset,#" + CONTROL_ID + " .fcwr-reset{padding:2px 7px;border:1px solid var(--dsw-alias-border-l3,#3a3a40);border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b93);font:inherit;cursor:pointer}" +
					"#" + CONTROL_ID + " .fcwr-preset[data-active=true]{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-label-primary,#e8e8ea)}" +
					"#" + CONTROL_ID + " .fcwr-actions{display:flex;justify-content:flex-end;padding-top:8px}" +
					"#" + CONTROL_ID + " .fcwr-hint{padding-top:8px;font-size:11px;color:var(--dsw-alias-label-caption,#6f6f77)}";
			}

			function buildControl() {
				if (controlEl !== null && controlEl.isConnected) return;
				var stale = document.getElementById(CONTROL_ID);
				if (stale !== null) stale.remove();
				controlEl = document.createElement("div");
				controlEl.id = CONTROL_ID;
				controlEl.setAttribute("data-freeze-content-on-window-resize", "control");
				controlEl.innerHTML =
					'<button type="button" class="fcwr-pill" aria-expanded="false" title="' + copy.t("pill") + '">🔒</button>' +
					'<div class="fcwr-panel" role="dialog" aria-label="' + copy.t("title") + '" hidden>' +
					'<p class="fcwr-title">' + copy.t("title") + '</p>' +
					'<div class="fcwr-row"><label for="fcwr-lock">' + copy.t("lock") + '</label><input id="fcwr-lock" type="checkbox"></div>' +
					'<div class="fcwr-width"><label for="fcwr-width">' + copy.t("width") + '</label><input id="fcwr-width" type="number" min="' + MIN_WIDTH + '" max="' + MAX_WIDTH + '" step="1"> px</div>' +
					'<div class="fcwr-presets">' + PRESETS.map(function (value) {
						return '<button type="button" class="fcwr-preset" data-width="' + value + '">' + value + '</button>';
					}).join("") + '</div>' +
					'<div class="fcwr-row"><label for="fcwr-keep">' + copy.t("keep") + '</label><input id="fcwr-keep" type="checkbox"></div>' +
					'<div class="fcwr-row"><label for="fcwr-show">' + copy.t("show") + '</label><input id="fcwr-show" type="checkbox"></div>' +
					'<div class="fcwr-actions"><button type="button" class="fcwr-reset">' + copy.t("reset") + '</button></div>' +
					'<div class="fcwr-hint">' + copy.t("hint") + '</div>' +
					'</div>';
				document.body.appendChild(controlEl);

				pillEl = controlEl.querySelector(".fcwr-pill");
				panelEl = controlEl.querySelector(".fcwr-panel");
				pillEl.addEventListener("click", function () {
					var open = panelEl.hidden;
					panelEl.hidden = !open;
					pillEl.setAttribute("aria-expanded", open ? "true" : "false");
				});
				controlEl.querySelector("#fcwr-lock").addEventListener("change", function (event) {
					config.lockWidth = event.target.checked;
					persist();
					applyWidth(true);
					syncControl();
				});
				controlEl.querySelector("#fcwr-keep").addEventListener("change", function (event) {
					config.keepPosition = event.target.checked;
					persist();
					if (config.keepPosition) scheduleRestore();
				});
				controlEl.querySelector("#fcwr-show").addEventListener("change", function (event) {
					config.showControl = event.target.checked;
					persist();
					syncControl();
				});
				controlEl.querySelector("#fcwr-width").addEventListener("change", function (event) {
					var value = px(event.target.value);
					if (!Number.isFinite(value)) {
						syncControl();
						return;
					}
					config.width = clamp(Math.round(value), MIN_WIDTH, MAX_WIDTH);
					persist();
					applyWidth(true);
					syncControl();
				});
				var presetButtons = controlEl.querySelectorAll(".fcwr-preset");
				for (var i = 0; i < presetButtons.length; i++) {
					presetButtons[i].addEventListener("click", function (event) {
						var value = px(event.currentTarget.dataset.width);
						if (!Number.isFinite(value)) return;
						config.width = clamp(Math.round(value), MIN_WIDTH, MAX_WIDTH);
						config.lockWidth = true;
						persist();
						applyWidth(true);
						syncControl();
					});
				}
				controlEl.querySelector(".fcwr-reset").addEventListener("click", function () {
					config = {
						lockWidth: DEFAULTS.lockWidth,
						width: 0,
						keepPosition: DEFAULTS.keepPosition,
						showControl: DEFAULTS.showControl
					};
					persist();
					applyWidth(true);
					syncControl();
				});
			}

			function cycleWidth(step) {
				var index = PRESETS.indexOf(clamp(config.width, MIN_WIDTH, MAX_WIDTH));
				var next = index === -1 ? PRESETS[0] : PRESETS[(index + step + PRESETS.length) % PRESETS.length];
				config.width = next;
				config.lockWidth = true;
				persist();
				applyWidth(true);
				syncControl();
			}

			/** Reflect config into the control, and show or hide it. */
			function syncControl() {
				if (!config.showControl) {
					if (controlEl !== null) controlEl.remove();
					controlEl = null;
					panelEl = null;
					pillEl = null;
					return;
				}
				buildControl();
				controlEl.querySelector("#fcwr-lock").checked = config.lockWidth;
				controlEl.querySelector("#fcwr-keep").checked = config.keepPosition;
				controlEl.querySelector("#fcwr-show").checked = config.showControl;
				controlEl.querySelector("#fcwr-width").value = String(effectiveWidth());
				var presetButtons = controlEl.querySelectorAll(".fcwr-preset");
				for (var i = 0; i < presetButtons.length; i++) {
					presetButtons[i].dataset.active = String(px(presetButtons[i].dataset.width) === config.width);
				}
			}

			/** Rebuild the panel in the newly active language, keeping it open if it was. */
			function relabel() {
				if (controlEl === null || !controlEl.isConnected) return;
				var wasOpen = panelEl !== null && panelEl.hidden === false;
				controlEl.remove();
				controlEl = null;
				panelEl = null;
				pillEl = null;
				syncControl();
				if (wasOpen && panelEl !== null && pillEl !== null) {
					panelEl.hidden = false;
					pillEl.setAttribute("aria-expanded", "true");
				}
			}
			//#endregion

			function start() {
				applyWidth(true);
				syncControl();
				bind();
				refresh();
				captureAll();
			}

			function releaseAll() {
				for (var i = 0; i < states.length; i++) {
					clearVarOverride(states[i]);
					unlockColumn(states[i]);
					if (states[i].col.isConnected) setScrollerOverflow(states[i].col, false);
				}
			}

			function dispose() {
				disposed = true;
				document.removeEventListener("scroll", onScroll, { capture: true });
				document.removeEventListener("scrollend", onScrollEnd, { capture: true });
				window.removeEventListener("resize", onResize);
				if (window.visualViewport !== undefined && window.visualViewport !== null) {
					window.visualViewport.removeEventListener("resize", onResize);
				}
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("pointerup", onPointerUp, true);
				document.removeEventListener("pointercancel", onPointerUp, true);
				document.removeEventListener("keydown", onKeyDown, true);
				if (resizeObserver !== null) resizeObserver.disconnect();
				if (bodyObserver !== null) bodyObserver.disconnect();
				observed = [];
				if (applyFrame !== 0) window.cancelAnimationFrame(applyFrame);
				if (captureFrame !== 0) window.cancelAnimationFrame(captureFrame);
				for (var i = 0; i < restoreFrames.length; i++) window.cancelAnimationFrame(restoreFrames[i]);
				if (settleTimer !== 0) window.clearTimeout(settleTimer);
				releaseAll();
				var sheet = document.getElementById(STYLE_ID);
				if (sheet !== null) sheet.remove();
				if (controlEl !== null) controlEl.remove();
			}

			return {
				start: start,
				dispose: dispose,
				status: function () {
					return {
						lockWidth: config.lockWidth,
						width: effectiveWidth(),
						keepPosition: config.keepPosition,
						showControl: config.showControl,
						columns: states.map(function (state) {
							return {
								primary: state.primary,
								/** The width this column is locked to; 0 means it is not locked. */
								width: state.lockedWidth,
								anchor: state.anchor === null ? null : state.anchor.key
							};
						})
					};
				},
				realign: function () {
					columns();
					restoreAll();
				},
				relabel: relabel
			};
		}
		//#endregion

		//#region plugin
		var runtime = null;

		function apply(ctx) {
			runtime = createRuntime();

			function boot() {
				runtime.start();
				var status = runtime.status();
				var surface = {
					version: 1,
					status: function () {
						return runtime === null ? null : runtime.status();
					},
					realign: function () {
						if (runtime !== null) runtime.realign();
					},
					dispose: function () {
						if (runtime !== null) runtime.dispose();
					}
				};
				// A page global for DevTools diagnostics: `__fcwr.status()`.
				try {
					window.__fcwr = surface;
				} catch (error) {
					/* a frozen window object loses the global, not the plugin */
				}
				// A boot stamp: which build this page is running, what it locked, and
				// which copy the panel uses. Rewritten once the locale service answers.
				function stamp() {
					writeJson(BOOT_KEY, {
						revision: REVISION,
						at: new Date().toISOString(),
						href: String(window.location.href),
						locale: copy.id,
						copy: copy.bound ? "locale" : "builtin",
						copyState: copy.state,
						lockWidth: runtime === null ? null : runtime.status().lockWidth,
						columns: runtime === null ? [] : runtime.status().columns
					});
				}

				stamp();
				try {
					var summary = status.columns.map(function (column) {
						// A non-positive width is "this column is not locked".
						return (column.width > 0 ? column.width + "px" : "off") + (column.primary ? " (primary)" : "");
					}).join(" / ");
					window.console.info("[" + NAME + "] " + REVISION + " " + (status.lockWidth ? copy.t("boot") + ": " + summary : copy.t("bootOff")));
				} catch (error) {
					/* no console is not a failure */
				}
				if (ctx === undefined || ctx === null || typeof ctx.provide !== "function") return;
				try {
					ctx.provide("freezeContentOnWindowResize", surface);
				} catch (error) {
					/* a host without `provide` loses the surface, not the plugin */
				}

				// Optional: the host's locale service supplies the panel copy. Absent or
				// without a dictionary for the active language, the built-in copy stays.
				if (typeof ctx.inject !== "function") return;
				try {
					ctx.inject(["locale"], function (scoped) {
						try {
							if (scoped === undefined || scoped === null || scoped.locale === undefined || typeof scoped.locale.register !== "function") {
								copy.state = "no-service";
								stamp();
								return;
							}
							// A page session keeps the namespaces it has already registered and
							// rejects a second registration of the same one. A reload of this
							// bundle (hot reload, enable/disable) therefore skips the dictionary
							// and binds what the page already holds; changed copy needs a page
							// reload, which is what a real install or update does anyway.
							if (window[LOCALE_FLAG] !== NS) {
								try {
									scoped.locale.register(NS, DICTIONARIES);
								} catch (error) {
									/* already registered in this page session */
								}
								window[LOCALE_FLAG] = NS;
							}
							copy.state = "registered";
							copy.bind(scoped.locale);
							if (runtime !== null) runtime.relabel();
							stamp();
							var unsubscribe = scoped.locale.subscribe(function () {
								copy.bind(scoped.locale);
								if (runtime !== null) runtime.relabel();
								stamp();
							});
							if (typeof ctx.effect === "function") {
								ctx.effect(function () {
									return function () {
										if (typeof unsubscribe === "function") unsubscribe();
									};
								}, "freeze-content-on-window-resize: locale subscription");
							}
						} catch (error) {
							copy.state = "error: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error);
							stamp();
						}
					});
				} catch (error) {
					copy.state = "inject-failed: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error);
					stamp();
				}
			}

			if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
			else boot();

			// The only shell registration: an invisible overlay seat that makes this
			// bundle visible to the shell and to cordis_inspect.
			if (ctx !== undefined && ctx !== null && typeof ctx.inject === "function") {
				try {
					ctx.inject(["slots"], function (scoped) {
						scoped.slots.inject("shell.overlay", function () {
							return scoped.slots.register({
								name: "shell.overlay",
								id: NAME,
								order: 90,
								label: function () {
									return copy.t("title");
								}
							}, function () {
								return null;
							});
						});
					});
				} catch (error) {
					/* the seat is diagnostics only */
				}
			}

			if (ctx !== undefined && ctx !== null && typeof ctx.effect === "function") {
				ctx.effect(function () {
					return function () {
						if (runtime !== null) runtime.dispose();
						runtime = null;
						try {
							if (window.__fcwr !== undefined) delete window.__fcwr;
						} catch (error) {
							/* best effort */
						}
					};
				}, "freeze-content-on-window-resize: reading column lock and reading anchor");
			}
		}
		//#endregion

		exports.name = NAME;
		exports.apply = apply;
		return module.exports;
	}
});
