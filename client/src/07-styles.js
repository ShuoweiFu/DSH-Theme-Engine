		const CSS = String.raw`
:root {
	--lg-wallpaper: none;
	--lg-composer-bg: rgba(255, 255, 255, 0.06);
	--lg-blur: 10px;
	--lg-sat: 1.4;
	--lg-dim: 0.08;
	--lg-tint: 0.55;
	--lg-mx: 50%;
	--lg-my: 30%;
	--lg-fallback: #0b0e14;
}

html[data-lg-enabled="on"],
html[data-lg-enabled="on"] body {
	background: transparent !important;
}

/* CSS fallback wallpaper; the WebGL canvas takes over when it is running. */
html[data-lg-enabled="on"] body::before {
	content: "";
	position: fixed;
	inset: 0;
	z-index: -2;
	pointer-events: none;
	background-color: var(--lg-fallback);
	background-image: var(--lg-wallpaper, none);
	background-position: center;
	background-size: cover;
	background-repeat: no-repeat;
	opacity: calc(1 - var(--lg-dim));
}

/* The canvas owns the wallpaper in GPU modes: this element stays as the dark
   fallback colour only. It used to paint the same wallpaper underneath, but
   every recapture replaced that image with no transition, which read as the
   background flashing on each refresh. */
html[data-lg-enabled="on"][data-lg-webgl="on"] body::before,
html[data-lg-enabled="on"][data-lg-webgl="gpu"] body::before {
	background-image: none !important;
}

/* WebGPU has no CPU-side blur prepass; a canvas filter is the cheapest way to
   keep the glass soft without a second full-window compositor pass. */
html[data-lg-enabled="on"][data-lg-webgl="gpu"] canvas[data-liquid-glass] {
	filter: blur(calc(var(--lg-blur) * 0.6));
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

/* The glass pane: blur + saturation of everything behind the app.
   Only the pure-CSS backend keeps this: with WebGL/WebGPU the wallpaper is
   already blurred by the shader prepass, and a compositor backdrop-filter here
   would make Chromium blur the very same pixels a second time (double GPU
   cost for no visual gain). */
html[data-lg-enabled="on"][data-lg-webgl="off"] #root {
	background: transparent !important;
	-webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-sat));
	backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-sat));
}

html[data-lg-enabled="on"][data-lg-webgl="on"] #root,
html[data-lg-enabled="on"][data-lg-webgl="gpu"] #root {
	background: transparent !important;
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;
}

/* DSH's composer card ships as an opaque white slab (rgb(255,255,255)), which
   breaks the glass pane and piles a white background behind the input text —
   white placeholder/label text then has nothing to stand out against. Give it
   the same raised-surface token as every other nested panel, so it can only be
   as dense as the frost the user actually chose. Class names are CSS-module
   hashes ('GRgSLq_card'), so match the stable '_card' suffix plus the fact that
   the element contains the editor. Suppressed mode keeps the shipped slab. */
html[data-lg-enabled="on"]:not([data-lg-suppressed="on"]) [class*="_card"]:has([contenteditable="true"]),
html[data-lg-enabled="on"]:not([data-lg-suppressed="on"]) [class*="_card"]:has(textarea) {
	background: var(--lg-composer-bg, var(--dsw-alias-bg-layer-1)) !important;
}

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

/* ---- main panel page (native plugin-page chrome) ---- */
.lg-page {
	display: flex;
	flex-direction: column;
	flex: 1;
	width: 100%;
	height: 100%;
	min-height: 0;
	background: rgba(250, 251, 253, 0.97);
	color: var(--dsw-alias-label-primary);
}

html[data-lg-mode="dark"] .lg-page {
	background: rgba(12, 15, 22, 0.97);
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

.lg-group {
	display: flex;
	flex-direction: column;
	gap: 0;
	margin: 0 0 32px;
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
	gap: 10px;
	padding: 16px 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.lg-field-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
	font-size: 14px;
	line-height: 20px;
}

.lg-field-head b {
	font-size: 12px;
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: var(--dsw-alias-label-secondary);
}

.lg-range {
	width: 100%;
	height: 18px;
	margin: 0;
	appearance: none;
	-webkit-appearance: none;
	background: transparent;
	cursor: pointer;
}

.lg-range::-webkit-slider-runnable-track {
	height: 3px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--dsw-alias-label-secondary) 26%, transparent);
}

.lg-range::-webkit-slider-thumb {
	appearance: none;
	-webkit-appearance: none;
	width: 16px;
	height: 16px;
	margin-top: -6.5px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
	transition: transform 0.12s ease;
}

.lg-range:hover::-webkit-slider-thumb {
	transform: scale(1.08);
}

.lg-range:active::-webkit-slider-thumb {
	transform: scale(0.94);
}

.lg-range::-moz-range-track {
	height: 3px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--dsw-alias-label-secondary) 26%, transparent);
}

.lg-range::-moz-range-thumb {
	width: 15px;
	height: 15px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
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
