		const CSS = String.raw`
:root {
	--lg-dim: 0.08;
	--lg-mx: 50%;
	--lg-my: 30%;
	--lg-fallback: #0b0e14;
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

/* ---- main panel page (native plugin-page chrome) ---- */
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
	gap: 10px;
	padding-top: 16px;
}

.lg-button {
	height: 34px;
	padding: 0 14px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-3);
	color: var(--dsw-alias-label-primary);
	font-size: 13px;
	line-height: 20px;
	cursor: pointer;
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
`;

		/**
		 * WebGL liquid wallpaper: the desktop picture is re-rendered every frame
		 * through a shader that warps it like a slow liquid, adds chromatic
		 * dispersion and moving caustics, and ripples around the pointer. CSS alone
		 * cannot do this — backdrop-filter only blurs, it cannot displace.
		 */
