		const CSS = String.raw`
:root {
	--lg-dim: 0.08;
	--lg-mx: 50%;
	--lg-my: 30%;
	--lg-fallback: #0b0e14;
	/* Fallback until the first ink decision lands: follow the text colour. */
	--lg-caret: currentColor;
}

/*
 * The caret is the INVERSE of the ink, not the ink itself: dark glyphs get a
 * light caret, light glyphs get a dark one, so the insertion point never
 * vanishes inside a run of text. 12-apply.js stamps data-lg-ink from the ink
 * it just decided; these two rules are the whole mapping.
 */
html[data-lg-ink="dark"] {
	--lg-caret: #f6f8fc;
}

html[data-lg-ink="light"] {
	--lg-caret: #0c0e14;
}

html[data-lg-enabled="on"],
html[data-lg-enabled="on"] body {
	background: transparent !important;
}

/* Startup scrim: a flat themed base behind the app until the shader's first
   frame arrives. The shader canvas covers it completely once running; when the
   fifth protection layer trips, this same layer becomes the static translucent
   fallback (see [data-lg-webgl="static"] below), so a dead GPU can never show a
   black pane. */
html[data-lg-enabled="on"] body::before {
	content: "";
	position: fixed;
	inset: 0;
	z-index: -2;
	pointer-events: none;
	background-color: var(--lg-fallback);
	opacity: calc(1 - var(--lg-dim));
	transition: opacity 240ms ease;
}

/* Static fallback: half-transparent scrim over the desktop, no wallpaper image,
   no shader, no backdrop-filter. Text keeps its themed ink and stays legible. */
html[data-lg-enabled="on"][data-lg-webgl="static"] body::before {
	opacity: 0.62;
}

/* Soft moving sheen + depth over the wallpaper. */
html[data-lg-enabled="on"] body::after {
	content: "";
	position: fixed;
	inset: 0;
	z-index: -1;
	pointer-events: none;
	background:
		radial-gradient(140% 90% at 78% -20%, rgba(255, 255, 255, 0.16), transparent 58%),
		radial-gradient(120% 70% at 12% 110%, rgba(255, 255, 255, 0.07), transparent 55%),
		linear-gradient(160deg, rgba(255, 255, 255, 0.05), transparent 42%, rgba(0, 0, 0, 0.12));
}

html[data-lg-enabled="on"][data-lg-mode="light"] body::after {
	background:
		radial-gradient(140% 90% at 78% -20%, rgba(255, 255, 255, 0.3), transparent 60%),
		radial-gradient(120% 70% at 12% 110%, rgba(255, 255, 255, 0.18), transparent 55%),
		linear-gradient(160deg, rgba(255, 255, 255, 0.12), transparent 45%, rgba(12, 16, 24, 0.04));
}

/* Gate: an application window really sits behind DSH, so nothing may show
   through. Hide every glass layer and let the shipped opaque theme win. */
html[data-lg-suppressed="on"] body::before,
html[data-lg-suppressed="on"] body::after,
html[data-lg-suppressed="on"] canvas[data-liquid-glass],
html[data-lg-suppressed="on"] #root::after,
html[data-lg-suppressed="on"] .lg-light {
	display: none !important;
}

html[data-lg-suppressed="on"] #root {
	background: transparent !important;
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;

/* Web wallpaper mode. The frame is an opaque-origin iframe, so no shader can
   sample it: here the frame *is* the backdrop and the compositor has to do the
   glass. This is the only mode where #root carries a backdrop-filter. */
html[data-lg-web="on"] .lg-web-frame {
	position: fixed;
	inset: 0;
	width: 100%;
	height: 100%;
	z-index: -3;
	border: 0;
	background: transparent;
	pointer-events: none;
}

/* The scrim would paint straight over the frame (it sits at z-index -2 and is
   almost opaque). The sheen stays: it is what keeps the pane looking like
   glass rather than a screenshot. */
html[data-lg-web="on"] body::before {
	display: none !important;
}

html[data-lg-web="on"] canvas[data-liquid-glass] {
	opacity: 0 !important;
	pointer-events: none !important;
}

html[data-lg-web="on"][data-lg-enabled="on"] #root {
	-webkit-backdrop-filter: blur(18px) saturate(1.2);
	backdrop-filter: blur(18px) saturate(1.2);
}
}

/* The glass pane. Every GPU backend blurs the wallpaper in its own shader
   prepass, so the compositor must never run a second backdrop blur over the
   canvas. The static fallback deliberately has none either: it is a flat
   translucent scrim, which is exactly what "no GPU" can guarantee. */
html[data-lg-enabled="on"][data-lg-webgl="on"] #root,
html[data-lg-enabled="on"][data-lg-webgl="gpu"] #root,
html[data-lg-enabled="on"][data-lg-webgl="static"] #root,
html[data-lg-enabled="on"][data-lg-webgl="off"] #root {
	background: transparent !important;
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;
}

/* DSH's composer card ships as an opaque white slab (rgb(255,255,255)), which
   breaks the glass pane. It carries the stable data-composer-card attribute, so
   the frosted treatment below targets it directly (no CSS-module hash games). */

/* Edge bevel: reads as a thick pane with an inner lens ring. */
html[data-lg-enabled="on"] #root::after {
	content: "";
	position: fixed;
	inset: 0;
	z-index: 2147483000;
	pointer-events: none;
	border-radius: 16px;
	background:
		radial-gradient(520px 420px at var(--lg-mx) var(--lg-my), rgba(255, 255, 255, 0.12), transparent 62%),
		linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 12%, transparent 88%, rgba(0, 0, 0, 0.08));
	box-shadow:
		inset 0 0 0 1px rgba(255, 255, 255, 0.18),
		inset 0 1px 0 rgba(255, 255, 255, 0.5),
		inset 0 -1px 0 rgba(0, 0, 0, 0.22),
		inset 0 32px 48px -40px rgba(255, 255, 255, 0.28),
		inset 0 -48px 72px -56px rgba(0, 0, 0, 0.28);
}

/* Pointer-tracked highlight + a slow light sweep, above the whole app. */
.lg-light {
	position: fixed;
	inset: 0;
	z-index: 3;
	pointer-events: none;
	overflow: hidden;
	border-radius: 16px;
}

.lg-light::before {
	content: "";
	position: absolute;
	inset: 0;
	background: radial-gradient(
		420px 340px at var(--lg-mx) var(--lg-my),
		rgba(255, 255, 255, 0.2),
		rgba(255, 255, 255, 0.06) 38%,
		transparent 68%
	);
	mix-blend-mode: screen;
	opacity: 0.55;
	transition: opacity 0.4s ease;
}

.lg-light::after {
	content: "";
	position: absolute;
	inset: -30% -10%;
	background: linear-gradient(
		115deg,
		transparent 32%,
		rgba(255, 255, 255, 0.14) 46%,
		rgba(255, 255, 255, 0.03) 52%,
		transparent 64%
	);
	mix-blend-mode: overlay;
	animation: lg-sweep 16s ease-in-out infinite;
}

@keyframes lg-sweep {
	0% { transform: translate3d(-26%, -4%, 0) rotate(-2deg); }
	50% { transform: translate3d(26%, 4%, 0) rotate(2deg); }
	100% { transform: translate3d(-26%, -4%, 0) rotate(-2deg); }
}

@media (prefers-reduced-motion: reduce) {
	.lg-light::after { animation: none; }
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
	html[data-lg-enabled="on"] #root {
		background: color-mix(in srgb, var(--lg-fallback) 88%, transparent) !important;
	}
}

/* ---- native message composer: frosted glass ---- */
/*
 * The conversation's input card is the one native surface the user stares at
 * all day, so it gets the same treatment as the settings cards: a translucent
 * wash of the overlay token plus a real backdrop blur, a hairline ring and a
 * top-edge highlight.  The wallpaper and the transcript behind it stay visible
 * (frosted), instead of the opaque input slab DSH ships by default.
 */
div[data-composer-card] {
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, transparent);
	-webkit-backdrop-filter: blur(26px) saturate(1.28);
	backdrop-filter: blur(26px) saturate(1.28);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.3),
		inset 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent),
		0 12px 32px rgba(8, 12, 20, 0.12);
}

html[data-lg-mode="dark"] div[data-composer-card] {
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.08),
		inset 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent),
		0 14px 36px rgba(0, 0, 0, 0.42);
}

/*
 * The insertion caret is the one thing the frosted composer still breaks.
 * DSH paints no caret-color, so it stays currentColor, and the ink the
 * token layer picks is already inverted against the wallpaper (05-ink.js
 * decides "dark" or "light" ink from the sampled luminance).  Reusing that
 * same token alone would paint the caret IN the ink colour, which is exactly
 * where it hides; the caret reads data-lg-ink instead and lands on the far
 * side of the ink, while the ring below keeps the ink tint.
 * caret-color is the only caret property CSS exposes, so the width stays
 * 1px and the rest of the contrast comes from the sheet -- :focus-within
 * lifts the ring and the top highlight while you type.
 */
div[data-composer-card] textarea,
div[data-composer-card] [contenteditable]:not([contenteditable="false"]) {
	caret-color: var(--lg-caret);
}

div[data-composer-card]:focus-within {
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.55),
		inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 45%, transparent),
		0 12px 32px rgba(8, 12, 20, 0.16);
}

html[data-lg-mode="dark"] div[data-composer-card]:focus-within {
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.14),
		inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 45%, transparent),
		0 14px 36px rgba(0, 0, 0, 0.46);
}

div[data-composer-card] textarea::selection,
div[data-composer-card] [contenteditable]:not([contenteditable="false"])::selection {
	background: color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
	color: var(--dsw-alias-label-primary);
}

html[data-lg-mode="dark"] div[data-composer-card] textarea::selection,
html[data-lg-mode="dark"] div[data-composer-card] [contenteditable]:not([contenteditable="false"])::selection {
	background: color-mix(in srgb, var(--dsw-alias-label-primary) 32%, transparent);
}

/*
 * The "edited N files" turn summary is another floating surface on the
 * transcript, so it gets the same frosted treatment as the composer instead of
 * DSH's filled header slab.  The data-changed-files attribute on the card root
 * (ChangedFiles.tsx) is stable; the module class names are hashed.  The
 * header/list inherit --changes-fill / --changes-hover, so overriding the
 * tokens is enough to keep hover and focus states readable.
 */
div[data-changed-files] {
	--changes-fill: color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent);
	--changes-hover: color-mix(in srgb, var(--dsw-alias-bg-overlay) 92%, transparent);
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 76%, transparent);
	border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent);
	-webkit-backdrop-filter: blur(26px) saturate(1.28);
	backdrop-filter: blur(26px) saturate(1.28);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.3),
		0 12px 32px rgba(8, 12, 20, 0.12);
}

html[data-lg-mode="dark"] div[data-changed-files] {
	--changes-fill: color-mix(in srgb, var(--dsw-alias-bg-overlay) 72%, transparent);
	--changes-hover: color-mix(in srgb, var(--dsw-alias-bg-overlay) 86%, transparent);
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 70%, transparent);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.08),
		0 14px 36px rgba(0, 0, 0, 0.42);
}

/*
 * DSH's native settings sheet is the last filled slab in the UI: SettingsRoot
 * paints its 800x800 panel with --dsw-alias-bg-layer-2 and no backdrop blur, so
 * it hides the wallpaper behind a milky card.  The panel root carries the
 * stable data-shortcut-modal="settings" attribute (SettingsRoot.tsx); the
 * module class names next to it are hashed.  Same recipe as the composer and
 * the edited-files card: a translucent wash, a real blur, a hairline ring and
 * a top-edge highlight, so the sheet reads as frosted glass without dimming
 * the section text.
 */
div[data-shortcut-modal="settings"] {
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 78%, transparent);
	-webkit-backdrop-filter: blur(28px) saturate(1.3);
	backdrop-filter: blur(28px) saturate(1.3);
	box-shadow:
		var(--dsw-elevation-prominent),
		inset 0 1px 0 rgba(255, 255, 255, 0.3),
		inset 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-border-l2) 75%, transparent);
}

html[data-lg-mode="dark"] div[data-shortcut-modal="settings"] {
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 72%, transparent);
	box-shadow:
		var(--dsw-elevation-prominent),
		inset 0 1px 0 rgba(255, 255, 255, 0.07),
		inset 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-border-l2) 75%, transparent);
}

/* ---- main panel page (native plugin-page chrome) ---- */
/*
 * DSH 不给插件页面套全局 box-sizing reset：页头/页身是 width:100% +
 * max-width:960px + 左右 padding(clamp 24~48px) 的组合，默认 content-box
 * 下外框会比 960 多出两倍内边距（≈96px），整列就会溢出到窗口右缘之外——
 * 非最大化时右上角「已同步」开关正是被窗口边框切掉的那一截。
 * 改成 border-box 后 960 才是外框宽度，标题、状态开关与下方卡片重新对齐。
 */
.lg-page,
.lg-page-head,
.lg-page-body {
	box-sizing: border-box;
}

/*
 * The page itself is bare glass: the wallpaper, the liquid shader and the
 * frosted app backdrop must all stay visible through this column.  Clarity is
 * bought locally — every settings group is its own translucent floating card —
 * never by painting an opaque sheet over the whole workspace.
 */
.lg-page {
	display: flex;
	flex-direction: column;
	flex: 1;
	width: 100%;
	height: 100%;
	min-height: 0;
	background: transparent;
	color: var(--dsw-alias-label-primary);
}

.lg-page-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 24px;
	width: 100%;
	max-width: 960px;
	margin: 0 auto;
	padding: 28px clamp(24px, 4vw, 48px) 20px;
}

.lg-page-heading {
	min-width: 0;
}

.lg-page-title {
	margin: 0;
	font-size: 20px;
	line-height: 28px;
	font-weight: 500;
	letter-spacing: -0.01em;
}

.lg-page-intro {
	margin: 6px 0 0;
	font-size: 13px;
	line-height: 20px;
	color: var(--dsw-alias-label-secondary);
}

.lg-page-actions {
	display: flex;
	align-items: center;
	gap: 12px;
	flex: none;
	padding-top: 4px;
}

.lg-status-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-label-secondary);
	white-space: nowrap;
}

.lg-status-pill .lg-dot {
	margin-top: 0;
}

.lg-page-body {
	flex: 1;
	min-height: 0;
	width: 100%;
	max-width: 960px;
	margin: 0 auto;
	padding: 0 clamp(24px, 4vw, 48px) 48px;
	overflow-y: auto;
	overscroll-behavior: contain;
}

/*
 * One floating glass card per group: a faint wash of the theme's own layer-2
 * token plus a backdrop blur.  The card, not the page, is what keeps labels
 * legible over a busy wallpaper; the gaps between cards stay fully transparent
 * so the liquid background reads through.
 */
.lg-group {
	display: flex;
	flex-direction: column;
	gap: 0;
	margin: 0 0 24px;
	padding: 6px 18px;
	border: 0.5px solid var(--dsw-alias-border-l1);
	border-radius: 14px;
	background: var(--dsw-alias-bg-layer-2);
	-webkit-backdrop-filter: blur(24px) saturate(1.18);
	backdrop-filter: blur(24px) saturate(1.18);
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.lg-group:last-child {
	margin-bottom: 0;
}

.lg-group-title {
	margin: 0 0 6px;
	font-size: 14px;
	line-height: 22px;
	font-weight: 500;
	color: var(--dsw-alias-label-primary);
}

.lg-group-hint {
	margin: 10px 0 0;
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-label-secondary);
}

.lg-group-hint[data-warn="on"] {
	color: var(--dsw-alias-state-warn-primary);
}

.lg-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 24px;
	padding: 16px 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.lg-group > .lg-row:last-child,
.lg-group > .lg-field:last-child {
	border-bottom-color: transparent;
}

.lg-label {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.lg-label > span:first-child {
	font-size: 14px;
	line-height: 20px;
}

.lg-hint {
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-label-secondary);
}

.lg-hint[data-warn="on"] {
	color: var(--dsw-alias-state-warn-primary);
}

.lg-badge {
	display: inline-flex;
	align-items: center;
	flex: none;
	height: 18px;
	padding: 0 6px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 4px;
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
	font-size: 10px;
	font-weight: 500;
	line-height: 16px;
	letter-spacing: 0.02em;
	white-space: nowrap;
}

.lg-select {
	height: 34px;
	min-width: 148px;
	max-width: 240px;
	padding: 0 10px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-3);
	color: var(--dsw-alias-label-primary);
	font-size: 13px;
	line-height: 20px;
	cursor: pointer;
}

.lg-select:hover {
	background: var(--dsw-alias-interactive-bg-hover);
}

.lg-select:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 2px;
}

.lg-switch {
	position: relative;
	flex: none;
	width: 36px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: 999px;
	background: var(--dsw-alias-bg-layer-3);
	cursor: pointer;
	transition: background-color 0.18s ease;
}

.lg-switch:hover {
	background: var(--dsw-alias-interactive-bg-hover);
}

.lg-switch[data-on="true"] {
	background: var(--dsw-alias-brand-primary);
}

.lg-switch[data-on="true"]:hover {
	filter: brightness(1.05);
}

.lg-switch i {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
	transition: transform 0.18s ease;
}

.lg-switch[data-on="true"] i {
	transform: translateX(16px);
}

.lg-switch:focus-visible {
	outline: 0;
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
}

.lg-switch:disabled {
	opacity: 0.5;
	cursor: default;
}

.lg-field {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.lg-field-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
	min-width: 0;
	font-size: 14px;
	line-height: 20px;
}

.lg-field-head span {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.lg-field-head b {
	flex: none;
	font-size: 12px;
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: var(--dsw-alias-label-secondary);
}

/*
 * Apple-style damped glass slider. The track is a 4px hairline of the theme's
 * own secondary ink at 20%; the travelled part is a barely-there brand wash,
 * painted by a JS-fed custom property so every value change animates the fill
 * without re-rendering anything but the input.
 */
.lg-range {
	--lg-fill: 0%;
	--lg-track: color-mix(in srgb, var(--dsw-alias-label-secondary) 20%, transparent);
	--lg-fill-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
	width: 100%;
	height: 20px;
	margin: 0;
	padding: 0;
	appearance: none;
	-webkit-appearance: none;
	background: transparent;
	cursor: pointer;
}

.lg-range::-webkit-slider-runnable-track {
	height: 4px;
	border-radius: 999px;
	background: linear-gradient(
		to right,
		var(--lg-fill-color) 0,
		var(--lg-fill-color) var(--lg-fill),
		var(--lg-track) var(--lg-fill),
		var(--lg-track) 100%
	);
}

.lg-range::-webkit-slider-thumb {
	appearance: none;
	-webkit-appearance: none;
	width: 16px;
	height: 16px;
	margin-top: -6px;
	border: 0;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
	transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.16s ease;
	will-change: transform;
}

.lg-range:hover::-webkit-slider-thumb {
	transform: scale(1.15);
	box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);
}

.lg-range:active::-webkit-slider-thumb {
	transform: scale(0.95);
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
}

.lg-range::-moz-range-track {
	height: 4px;
	border-radius: 999px;
	background: var(--lg-track);
}

.lg-range::-moz-range-progress {
	height: 4px;
	border-radius: 999px;
	background: var(--lg-fill-color);
}

.lg-range::-moz-range-thumb {
	width: 16px;
	height: 16px;
	border: 0;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
	transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

.lg-range:hover::-moz-range-thumb {
	transform: scale(1.15);
}

.lg-range:active::-moz-range-thumb {
	transform: scale(0.95);
}

.lg-range:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 4px;
	border-radius: 999px;
}

.lg-status {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 16px 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-label-secondary);
}

.lg-status b {
	font-weight: 500;
	color: var(--dsw-alias-label-primary);
}

.lg-dot {
	flex: none;
	width: 8px;
	height: 8px;
	margin-top: 5px;
	border-radius: 50%;
	background: var(--dsw-alias-state-idle-primary);
}

.lg-dot[data-state="ready"] {
	background: var(--dsw-alias-state-success-primary);
}

.lg-dot[data-state="error"],
.lg-dot[data-state="missing"] {
	background: var(--dsw-alias-state-error-primary);
}

.lg-facts {
	display: flex;
	flex-direction: column;
	margin: 8px 0 0;
	padding: 0;
}

.lg-fact {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 24px;
	min-height: 44px;
	padding: 8px 0;
	margin: 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.lg-fact:last-child {
	border-bottom: 0;
}

.lg-fact dt {
	margin: 0;
	font-size: 13px;
	line-height: 20px;
	color: var(--dsw-alias-label-secondary);
}

.lg-fact dd {
	margin: 0;
	font-size: 13px;
	line-height: 20px;
	font-variant-numeric: tabular-nums;
	color: var(--dsw-alias-label-primary);
}

.lg-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	padding-top: 16px;
}

.lg-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	height: 34px;
	padding: 0 14px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-3);
	color: var(--dsw-alias-label-primary);
	font-size: 13px;
	line-height: 20px;
	text-decoration: none;
	cursor: pointer;
}

.lg-button[disabled] {
	opacity: 0.55;
	cursor: default;
}

.lg-button:hover {
	background: var(--dsw-alias-interactive-bg-hover);
}

.lg-button:active {
	background: var(--dsw-alias-interactive-bg-active);
}

.lg-button:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 2px;
}

@media (max-width: 720px) {
	.lg-page-head {
		flex-direction: column;
		gap: 12px;
	}

	.lg-page-actions {
		width: 100%;
		justify-content: space-between;
		padding-top: 0;
	}
}

.lg-warn {
	position: fixed;
	left: 50%;
	bottom: 22px;
	z-index: 2147483000;
	display: flex;
	align-items: center;
	gap: 10px;
	max-width: min(720px, calc(100vw - 40px));
	padding: 10px 14px;
	border: 1px solid var(--dsw-alias-state-warn-primary);
	border-radius: 12px;
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, #000 18%);
	color: var(--dsw-alias-label-primary);
	font-size: 12.5px;
	line-height: 1.45;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
	transform: translateX(-50%);
	pointer-events: auto;
	backdrop-filter: blur(10px);
}

.lg-warn[data-degrade="off"] {
	border-color: var(--dsw-alias-state-error-primary);
}

.lg-warn-text {
	flex: 1;
}

/* ---- Wallpaper Engine centre / file browser ---------------------------- */

.lg-we-status {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	padding: 12px 0 0;
	font-size: 13px;
	line-height: 20px;
	color: var(--dsw-alias-label-primary);
}

.lg-we-tools {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-top: 12px;
}

.lg-input {
	height: 34px;
	padding: 0 10px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-3);
	color: var(--dsw-alias-label-primary);
	font-size: 13px;
	line-height: 20px;
}

.lg-input:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 1px;
}

.lg-we-search {
	max-width: 340px;
}

.lg-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.lg-chip {
	height: 26px;
	padding: 0 10px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 999px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 24px;
	cursor: pointer;
}

.lg-chip[data-on] {
	border-color: transparent;
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
	color: var(--dsw-alias-label-primary);
}

.lg-chip:hover {
	color: var(--dsw-alias-label-primary);
}

.lg-we-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 12px;
	max-height: 440px;
	overflow-y: auto;
	padding: 4px 2px 8px;
	margin-top: 12px;
}

.lg-we-card {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 6px;
	border: 0.5px solid var(--dsw-alias-border-l1);
	border-radius: 12px;
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
	text-align: left;
	cursor: pointer;
}

.lg-we-card:hover {
	border-color: var(--dsw-alias-brand-primary);
}

.lg-we-card[data-active="on"] {
	border-color: var(--dsw-alias-brand-primary);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent);
}

.lg-we-gold {
	display: inline-flex;
	align-items: center;
	height: 18px;
	padding: 0 6px;
	border-radius: 6px;
	font-size: 10px;
	font-weight: 600;
	line-height: 18px;
	letter-spacing: 0.04em;
	color: #3a2a00;
	background: linear-gradient(135deg, #ffe9a8, #e8b64a 55%, #c78d1f);
	box-shadow: 0 1px 2px rgba(120, 80, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.55);
	flex: none;
}

.lg-we-gold-inline {
	margin-right: 2px;
}

.lg-we-thumb {
	display: flex;
	align-items: center;
	justify-content: center;
	aspect-ratio: 16 / 10;
	border-radius: 8px;
	overflow: hidden;
	background: var(--dsw-alias-bg-layer-3);
}

.lg-we-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.lg-we-fallback {
	font-size: 11px;
	letter-spacing: 0.12em;
	color: var(--dsw-alias-label-secondary);
}

.lg-we-name {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	font-size: 12.5px;
	line-height: 17px;
}

.lg-we-meta {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	line-height: 16px;
	color: var(--dsw-alias-label-secondary);
}

/* A scene is a compiled package we cannot decode, so the card says so instead
   of offering a click that quietly does nothing. */
.lg-we-flag {
	height: 18px;
	padding: 0 6px;
	border-radius: 6px;
	background: color-mix(in srgb, #d4a017 22%, transparent);
	color: #a9770a;
	font-size: 10px;
	line-height: 18px;
	letter-spacing: 0.02em;
	white-space: nowrap;
}

html[data-lg-mode="dark"] .lg-we-flag {
	background: color-mix(in srgb, #f0c04a 26%, transparent);
	color: #f3cf7c;
}

.lg-we-card[data-blocked="on"] {
	cursor: default;
}

.lg-we-card[data-blocked="on"] .lg-we-thumb img {
	filter: grayscale(0.7);
	opacity: 0.6;
}

.lg-we-type {
	height: 18px;
	padding: 0 6px;
	border-radius: 6px;
	background: var(--dsw-alias-bg-layer-3);
	font-size: 10px;
	line-height: 18px;
	letter-spacing: 0.02em;
}

.lg-wp-sheet {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px 16px;
	border-radius: 14px;
	background: var(--lg-surface, rgba(255, 255, 255, 0.05));
	border: 1px solid var(--lg-border, var(--dsw-alias-border-l2));
}

.lg-wp-saverow {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}

.lg-wp-saverow .lg-input {
	flex: 1 1 160px;
	min-width: 0;
}

.lg-textarea {
	width: 100%;
	box-sizing: border-box;
	resize: vertical;
	font: inherit;
	font-size: 12px;
	line-height: 1.5;
	padding: 8px 10px;
	border-radius: 10px;
	color: inherit;
	background: var(--lg-field, rgba(127, 127, 127, 0.12));
	border: 1px solid var(--lg-border, var(--dsw-alias-border-l2));
}

.lg-wp-presets {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.lg-wp-preset {
	display: flex;
	gap: 8px;
	align-items: center;
}

.lg-wp-preset-name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
}

.lg-browser {

	margin-top: 12px;
	padding: 10px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 12px;
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 72%, transparent);
}

.lg-browser-bar {
	display: flex;
	align-items: center;
	gap: 8px;
}

.lg-browser-path {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	color: var(--dsw-alias-label-secondary);
}

.lg-browser-list {
	display: flex;
	flex-direction: column;
	max-height: 260px;
	overflow-y: auto;
	margin-top: 8px;
}

.lg-browser-row {
	padding: 7px 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-primary);
	font-size: 12.5px;
	line-height: 19px;
	text-align: left;
	cursor: pointer;
}

.lg-browser-row:hover {
	background: var(--dsw-alias-interactive-bg-hover);
}

.lg-audio-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 4px 0 8px;
}

.lg-audio-row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 10px;
	border: 0.5px solid var(--dsw-alias-border-l1);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-1);
}

.lg-audio-name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12.5px;
	color: var(--dsw-alias-label-primary);
}

.lg-audio-remove {
	width: 22px;
	height: 22px;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font-size: 15px;
	line-height: 22px;
	cursor: pointer;
}

.lg-audio-remove:hover {
	background: var(--dsw-alias-interactive-bg-hover);
	color: var(--dsw-alias-label-primary);
}

.lg-warn-inline {
	margin: 6px 0 0;
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-state-warn-primary);
}

.lg-modes {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	margin-top: 10px;
}

.lg-mode {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 12px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 12px;
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	text-align: left;
	cursor: pointer;
}

.lg-mode[data-on] {
	border-color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1));
}

.lg-mode strong {
	font-size: 13px;
	font-weight: 500;
	line-height: 20px;
}

.lg-mode span {
	font-size: 11.5px;
	line-height: 16px;
	color: var(--dsw-alias-label-secondary);
}

.lg-mode-panel {
	margin-top: 4px;
}

.lg-mode-panel > div > * {
	animation: lg-panel-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes lg-panel-in {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.lg-mode-panel > div > * {
		animation: none;
	}
}

.lg-color-value {
	font-size: 12px;
	color: var(--dsw-alias-label-secondary);
	font-variant-numeric: tabular-nums;
}

.lg-swatch {
	width: 18px;
	height: 18px;
	border-radius: 6px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-overlay);
}

.lg-color {
	width: 46px;
	height: 30px;
	padding: 0;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 8px;
	background: transparent;
	cursor: pointer;
}

@media (max-width: 720px) {
	.lg-modes {
		grid-template-columns: 1fr;
	}

	.lg-we-grid {
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	}
}

/*
 * The composer's thinking-effort label ("High") ships in DSH as
 * <span class="_9r0rkG_triggerEffort">, painted with --dsw-alias-label-caption,
 * so it reads as idle grey right beside the model name.  The user asked for
 * blue: the effort value gets a hue of its own instead.  Matching on the
 * suffixed local name keeps working when DSH rebuilds and the CSS-module hash
 * in front of the underscore changes.
 */
[class*="_triggerEffort"] {
	color: #4d6bfe !important;
}

html[data-lg-mode="dark"] [class*="_triggerEffort"] {
	color: #93a7ff !important;
}

/* ---- background module chooser ---- */
.lg-group-subtitle {
	margin: 14px 0 8px;
	font-size: 12px;
	font-weight: 500;
	letter-spacing: 0.02em;
	color: var(--dsw-alias-label-secondary);
}

.lg-branch-tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
	margin: 0 0 14px;
}

.lg-branch-tab {
	height: 32px;
	padding: 0 14px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 10px;
	background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 70%, transparent);
	color: var(--dsw-alias-label-secondary);
	font-size: 13px;
	cursor: pointer;
}

.lg-branch-tab:hover {
	color: var(--dsw-alias-label-primary);
}

.lg-branch-tab[data-on="on"] {
	color: var(--dsw-alias-label-primary);
	border-color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}

.lg-island {
	margin-left: auto;
}

.lg-branch-body {
	display: block;
}

.lg-module-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	margin: 0 0 10px;
}

.lg-module {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 14px 16px;
	text-align: left;
	border-radius: 12px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent);
	color: inherit;
	cursor: pointer;
	transition:
		border-color 0.16s ease,
		background 0.16s ease,
		transform 0.16s ease;
}

.lg-module:hover {
	border-color: var(--dsw-alias-border-l4);
}

.lg-module:active {
	transform: scale(0.99);
}

.lg-module[data-on="on"] {
	border-color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}

.lg-module-name {
	font-size: 14px;
	font-weight: 500;
}

.lg-module-hint {
	font-size: 12px;
	line-height: 18px;
	color: var(--dsw-alias-label-secondary);
	padding-right: 14px;
}

.lg-module-dot {
	position: absolute;
	top: 14px;
	right: 14px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--dsw-alias-border-l4);
}

.lg-module[data-on="on"] .lg-module-dot {
	background: var(--dsw-alias-brand-primary);
}

@media (max-width: 720px) {
	.lg-module-grid {
		grid-template-columns: 1fr;
	}
}

/* ---- Wallpaper Engine style settings panel ---- */
.lg-we-app {
	border: 0.5px solid var(--dsw-alias-border-l2);
	border-radius: 16px;
	overflow: hidden;
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 42%, transparent);
	-webkit-backdrop-filter: blur(22px) saturate(1.22);
	backdrop-filter: blur(22px) saturate(1.22);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 14px 34px rgba(8, 12, 20, 0.1);
}

html[data-lg-mode="dark"] .lg-we-app {
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 38%, transparent);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 16px 38px rgba(0, 0, 0, 0.4);
}

.lg-we-topbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 52%, transparent);
	-webkit-backdrop-filter: blur(18px) saturate(1.2);
	backdrop-filter: blur(18px) saturate(1.2);
}

.lg-we-tabs {
	display: flex;
	align-items: center;
	gap: 4px;
}

.lg-we-tab {
	padding: 6px 12px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font-size: 13px;
	cursor: pointer;
}

.lg-we-tab:hover:not(:disabled) {
	color: var(--dsw-alias-label-primary);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-3) 60%, transparent);
}

.lg-we-tab[data-on="on"] {
	color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
	font-weight: 500;
}

.lg-we-tab:disabled {
	opacity: 0.42;
	cursor: default;
}

.lg-we-toolbar {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1;
	min-width: 220px;
}

.lg-we-search {
	flex: 1;
	min-width: 120px;
	height: 30px;
}

.lg-we-toolcount {
	font-size: 12px;
	color: var(--dsw-alias-label-secondary);
	white-space: nowrap;
}

.lg-we-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 8px;
	border: 0.5px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-3) 58%, transparent);
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	text-decoration: none;
	cursor: pointer;
}

.lg-we-icon:hover {
	color: var(--dsw-alias-label-primary);
	border-color: var(--dsw-alias-border-l4);
}

.lg-we-current {
	margin-left: auto;
	max-width: 46%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	color: var(--dsw-alias-label-secondary);
}

.lg-we-body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 268px;
	min-height: 320px;
}

.lg-we-left {
	padding: 12px;
	overflow-y: auto;
	max-height: 520px;
}

.lg-we-grid-lg {
	grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
	gap: 8px;
	max-height: none;
	padding: 0;
}

.lg-we-card[data-applied="on"] {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: -1px;
}

.lg-we-side {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border-left: 0.5px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 48%, transparent);
	-webkit-backdrop-filter: blur(20px) saturate(1.2);
	backdrop-filter: blur(20px) saturate(1.2);
	overflow-y: auto;
	max-height: 520px;
}

.lg-we-side-empty {
	justify-content: center;
	align-items: center;
	text-align: center;
}

.lg-we-side-hero {
	display: flex;
	gap: 10px;
	align-items: center;
}

.lg-we-side-thumb {
	position: relative;
	width: 76px;
	height: 48px;
	flex: none;
	border-radius: 8px;
	overflow: hidden;
	background: var(--dsw-alias-bg-layer-3);
}

.lg-we-side-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.lg-we-side-title {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.lg-we-side-title strong {
	font-size: 13px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.lg-we-side-section {
	margin-top: 4px;
	padding-top: 8px;
	border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.lg-we-side-section h3 {
	margin: 0 0 6px;
	font-size: 12px;
	font-weight: 500;
	color: var(--dsw-alias-label-secondary);
}

.lg-we-prop {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 5px 0;
}

.lg-we-prop-label {
	font-size: 12px;
	color: var(--dsw-alias-label-secondary);
	white-space: nowrap;
}

.lg-we-prop-control {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex: 1;
	min-width: 0;
}

.lg-we-prop-control .lg-range {
	width: 120px;
}

.lg-we-prop-control .lg-input {
	height: 26px;
	max-width: 118px;
	font-size: 12px;
}

.lg-we-prop-value {
	font-size: 12px;
	color: var(--dsw-alias-label-primary);
}

.lg-we-side-actions {
	margin-top: 6px;
}

.lg-we-footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border-top: 0.5px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 56%, transparent);
	-webkit-backdrop-filter: blur(18px) saturate(1.2);
	backdrop-filter: blur(18px) saturate(1.2);
}

.lg-we-footer-group {
	display: flex;
	align-items: center;
	gap: 4px;
}

.lg-we-footer-group:last-child {
	margin-left: auto;
}

.lg-we-foot {
	padding: 5px 8px;
	border: 0;
	border-radius: 7px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	cursor: pointer;
}

.lg-we-foot:hover {
	color: var(--dsw-alias-label-primary);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-3) 60%, transparent);
}

.lg-we-sep {
	width: 0.5px;
	height: 14px;
	background: var(--dsw-alias-border-l2);
	margin: 0 2px;
}

.lg-we-primary {
	color: var(--dsw-alias-on-brand, #fff);
	background: var(--dsw-alias-brand-primary);
	border-color: transparent;
}

.lg-we-primary[disabled] {
	opacity: 0.5;
	cursor: default;
}

@media (max-width: 860px) {
	.lg-we-body {
		grid-template-columns: 1fr;
	}
	.lg-we-side {
		border-left: 0;
		border-top: 0.5px solid var(--dsw-alias-border-l2);
		max-height: 360px;
	}
}

`;

		/**
		 * WebGL liquid wallpaper: the desktop picture is re-rendered every frame
		 * through a shader that warps it like a slow liquid, adds chromatic
		 * dispersion and moving caustics, and ripples around the pointer. CSS alone
		 * cannot do this — backdrop-filter only blurs, it cannot displace.
		 */
