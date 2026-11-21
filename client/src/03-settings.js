		function normalize(raw) {
			const source = raw && typeof raw === "object" ? raw : {};
			const num = (value, fallback, min, max) => {
				const parsed = typeof value === "number" ? value : Number.parseFloat(value);
				return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
			};
			const audioRaw = source.audio && typeof source.audio === "object" ? source.audio : {};
			const audioList = Array.isArray(audioRaw.list)
				? audioRaw.list.filter((entry) => typeof entry === "string" && entry.length > 0).slice(0, 200)
				: [];
			const colorMode = ["light", "dark", "custom", "intelligent"].includes(source.colorMode) ? source.colorMode : "auto";
			const legacyTint = num(source.tint, DEFAULT_SETTINGS.tint, 0, 1);
			const legacyVeil = num(source.veil, DEFAULT_SETTINGS.veil, 0, 1);
			const legacyDim = num(source.dim, DEFAULT_SETTINGS.dim, 0, 0.6);
			const legacyInk = source.ink === "dark" || source.ink === "light" ? source.ink : "auto";
			const legacyColor = /^#[0-9a-f]{6}$/i.test(source.customColor) ? source.customColor : DEFAULT_SETTINGS.customColor;
			// Each colour mode keeps its own appearance values. The top-level keys
			// stay the render truth and always mirror the active bucket; switching
			// modes loads the target bucket back into them (12-apply.js setSettings).
			//
			// Upgrade path: the first load after this shape grew has no modeValues,
			// so every bucket is seeded from the active values. Upgrading must never
			// repaint a look the user already signed off on.
			const rawBuckets = source.modeValues && typeof source.modeValues === "object" ? source.modeValues : null;
			const modeValues = {};
			for (const mode of MODE_IDS) {
				const rawBucket = rawBuckets && rawBuckets[mode] && typeof rawBuckets[mode] === "object" ? rawBuckets[mode] : null;
				const bucket = rawBucket || (rawBuckets ? DEFAULT_SETTINGS.modeValues[mode] : source);
				modeValues[mode] = {
					tint: num(bucket.tint, legacyTint, 0, 1),
					veil: num(bucket.veil, legacyVeil, 0, 1),
					dim: num(bucket.dim, legacyDim, 0, 0.6),
					ink: bucket.ink === "dark" || bucket.ink === "light" ? bucket.ink : legacyInk,
					customColor: /^#[0-9a-f]{6}$/i.test(bucket.customColor) ? bucket.customColor : legacyColor,
					autoInvert: bucket.autoInvert !== false
				};
			}
			const active = modeValues[colorMode];
			return {
				enabled: source.enabled !== false,
				wallpaper: source.wallpaper !== false,
				blur: Math.round(num(source.blur, DEFAULT_SETTINGS.blur, 0, 48)),
				saturation: num(source.saturation, DEFAULT_SETTINGS.saturation, 1, 2.4),
				tint: active.tint,
				veil: active.veil,
				dim: active.dim,
				refreshSec: Math.round(num(source.refreshSec, DEFAULT_SETTINGS.refreshSec, 1, 60)),
				flow: num(source.flow, DEFAULT_SETTINGS.flow, 0, 1.5),
				fps: Math.round(num(source.fps, DEFAULT_SETTINGS.fps, 0, 240)),
				autoScale: source.autoScale !== false,
				source: ["wallpaper", "we", "file"].includes(source.source) ? source.source : "desktop",
				wePath: typeof source.wePath === "string" ? source.wePath : "",
				weId: typeof source.weId === "string" ? source.weId : "",
				filePath: typeof source.filePath === "string" ? source.filePath : "",
				colorMode,
				customColor: active.customColor,
				autoInvert: active.autoInvert,
				modeValues,
				audio: {
					enabled: audioRaw.enabled === true,
					list: audioList,
					rate: Math.round(num(audioRaw.rate, 1, 0.5, 2) * 100) / 100,
					volume: num(audioRaw.volume, 0.6, 0, 1),
					reactive: audioRaw.reactive !== false
				},
				renderMode: source.renderMode === "webgpu" ? "webgpu" : "webgl",
				behind: source.behind !== false,
				ink: active.ink,
				preset: PRESET_IDS.includes(source.preset) ? source.preset : "auto",
				module: ["glass", "wallpaper", "elysia"].includes(source.module) ? source.module : "glass",
				island: source.island === true
			};
		}

		/**
		 * One-off settings repair. The 0.11 build let the hardware preset overwrite
		 * the user's own values (blur 3, saturation 1, flow 0.6, refreshSec 60,
		 * behind off) and persisted that mess into BOTH storage keys, so reading v2
		 * no longer recovers anything. These are the values that were actually in
		 * use before that rewrite, captured from the plugin's own diagnostic log.
		 * The flag makes the repair run exactly once.
		 */
		const RECOVERY_KEY = "dsh-liquid-glass.recovered-0.13";
		const RECOVERED_SETTINGS = Object.freeze({
			enabled: true,
			wallpaper: true,
			blur: 0,
			saturation: 1.4,
			tint: 1,
			// 0.13 brings the frost slider back; 1.0 is the same surface opacity the
			// 0.8 formula produced at tint 1 (see glassTokens), so restoring the old
			// values cannot repaint the glass the user just signed off on.
			veil: 1,
			dim: 0,
			refreshSec: 5,
			flow: 1.5,
			fps: 30,
			autoScale: true,
			source: "desktop",
			renderMode: "webgl",
			behind: true,
			ink: "auto",
			preset: "auto"
		});

		/**
		 * v3 is the live store; v2 is only a fallback for a profile this build has
		 * never touched. (0.11 wrote preset values into v2 as well, so treating v2
		 * as authoritative would keep resurrecting the clobbered look.)
		 */
		function readSettings() {
			try {
				// Only repair a profile that already had this plugin installed: a fresh
				// install must start from DEFAULT_SETTINGS, not from someone else's taste.
				const hadStored = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].some((key) => localStorage.getItem(key) !== null);
				if (hadStored && !localStorage.getItem(RECOVERY_KEY)) {
					const restored = normalize(RECOVERED_SETTINGS);
					persistSettings(restored);
					localStorage.setItem(LEGACY_STORAGE_KEYS[0], JSON.stringify(restored));
					localStorage.setItem(RECOVERY_KEY, "1");
					return restored;
				}
				const raw = localStorage.getItem(STORAGE_KEY);
				const current = raw ? JSON.parse(raw) : null;
				if (current) return normalize(current);
				const legacyRaw = LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
				const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
				if (legacy) {
					const merged = normalize({ ...DEFAULT_SETTINGS, ...stripUndefined(legacy) });
					persistSettings(merged);
					return merged;
				}
				return normalize(DEFAULT_SETTINGS);
			} catch {
				return normalize(DEFAULT_SETTINGS);
			}
		}

		function stripUndefined(object) {
			const out = {};
			for (const [key, value] of Object.entries(object)) if (value !== undefined) out[key] = value;
			return out;
		}

		function persistSettings(value) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
			} catch {
				// Private mode or a full quota: the panel still works for this page.
			}
		}

		function clampAlpha(value) {
			return Math.min(1, Math.max(0, Number(value.toFixed(3))));
		}

		/**
		 * Per-token glass values. `veil` is the frost density (0 = bare glass,
		 * 1 = heavy frosting) and is the only knob that raises surface opacity, so
		 * the tint slider can never reintroduce the milky fog. 0.13 keeps the 0.11
		 * contract (veil drives the frost) but maps the curve so veil = 1 lands on
		 * exactly the surface the 0.8 formula produced at tint 1 (0.47 * 1.1 ≈
		 * 0.52): the restored slider cannot repaint a look the user just approved.
		 *
		 * `ink` is the adaptive text colour: "dark" ink on a bright backdrop,
		 * "light" ink on a dark one. Both theme modes receive the same colour, so
		 * the switch happens live no matter which DSH theme the user picked.
		 */
		function hexRgb(hex) {
			const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
			if (!match) return null;
			const value = parseInt(match[1], 16);
			return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
		}

		function mixRgb(from, to, amount) {
			const t = Math.min(1, Math.max(0, amount));
			return [
				Math.round(from[0] + (to[0] - from[0]) * t),
				Math.round(from[1] + (to[1] - from[1]) * t),
				Math.round(from[2] + (to[2] - from[2]) * t)
			];
		}

		function rgbHex(rgb) {
			return "#" + rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
		}

		function rgba(rgb, alpha) {
			return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clampAlpha(alpha)})`;
		}

		/**
		 * Per-token glass values. `veil` is the frost density (0 = bare glass,
		 * 1 = heavy frosting) and is the only knob that raises surface opacity, so
		 * the tint slider can never reintroduce the milky fog. 0.13 keeps the 0.11
		 * contract (veil drives the frost) but maps the curve so veil = 1 lands on
		 * exactly the surface the 0.8 formula produced at tint 1 (0.47 * 1.1 ≈
		 * 0.52): the restored slider cannot repaint a look the user just approved.
		 *
		 * `ink` is the adaptive text colour: "dark" ink on a bright backdrop,
		 * "light" ink on a dark one. Both theme modes receive the same colour, so
		 * the switch happens live no matter which DSH theme the user picked.
		 *
		 * `options.force` pins both theme slots to the palette of one mode (the WE
		 * light/dark switch of tasks 12-13). `options.base` tints the glass from a
		 * custom colour or the wallpaper's dominant colour (tasks 14-15); the alpha
		 * curve is unchanged so the frost slider keeps its meaning.
		 */
		function glassTokens(tint, veil, ink, options = {}) {
			const t = Math.min(1, Math.max(0, tint));
			const v = Math.min(1, Math.max(0, veil == null ? DEFAULT_SETTINGS.veil : veil));
			const base = 0.02 + 0.45 * v;
			const lift = 0.02 + 0.05 * v;
			const tintLift = 0.9 + 0.2 * t;
			const force = options.force === "light" || options.force === "dark" ? options.force : "";
			const accent = hexRgb(options.base);
			const lightRgb = accent ? mixRgb(accent, [255, 255, 255], 0.68) : [255, 255, 255];
			const lightLayerRgb = accent ? mixRgb(accent, [252, 253, 255], 0.56) : [252, 253, 255];
			const lightOverlayRgb = accent ? mixRgb(accent, [251, 252, 255], 0.72) : [251, 252, 255];
			const darkRgb = accent ? mixRgb(accent, [9, 11, 16], 0.62) : [9, 11, 16];
			const darkLayerRgb = accent ? mixRgb(accent, [20, 25, 35], 0.55) : [20, 25, 35];
			const darkOverlayRgb = accent ? mixRgb(accent, [18, 22, 31], 0.6) : [18, 22, 31];
			const light = {
				"--dsw-alias-bg-base": rgba(lightRgb, base * tintLift),
				"--dsw-alias-bg-layer-1": rgba(lightRgb, (base + lift) * tintLift),
				"--dsw-alias-bg-layer-2": rgba(lightLayerRgb, (base + lift * 2.4) * tintLift),
				// The composer, menus and popovers paint with bg-overlay. It used to be
				// pinned at 0.5 white regardless of veil, so at "bare glass" the input
				// box stayed a solid white slab while every other surface dropped to
				// 0.02 — that white slab is what swallowed white placeholder text.
				// Overlay now rides the same frost curve (0.06 → 0.92) so it can only be
				// as dense as the rest of the glass.
				"--dsw-alias-bg-overlay": rgba(lightOverlayRgb, 0.06 + 0.86 * v),
				"--dsw-specific-sidebar-fill": rgba(lightRgb, (0.02 + 0.38 * v) * tintLift),
				"--dsw-alias-border-l1": "rgba(20,24,32,0.1)",
				"--dsw-alias-border-l2": "rgba(20,24,32,0.16)"
			};
			const dark = {
				"--dsw-alias-bg-base": rgba(darkRgb, (base + 0.03) * tintLift),
				"--dsw-alias-bg-layer-1": rgba(darkRgb, (base + lift + 0.03) * tintLift),
				"--dsw-alias-bg-layer-2": rgba(darkLayerRgb, (base + lift * 2.4 + 0.03) * tintLift),
				"--dsw-alias-bg-overlay": rgba(darkOverlayRgb, 0.1 + 0.85 * v),
				"--dsw-specific-sidebar-fill": rgba(darkRgb, (0.02 + 0.38 * v + 0.03) * tintLift),
				"--dsw-alias-border-l1": "rgba(255,255,255,0.1)",
				"--dsw-alias-border-l2": "rgba(255,255,255,0.16)"
			};
			const out = {};
			const lightMode = force === "dark" ? dark : light;
			const darkMode = force === "light" ? light : dark;
			for (const token of Object.keys(light)) out[token] = { light: lightMode[token], dark: darkMode[token] };
			if (ink === "dark" || ink === "light") {
				const primary = ink === "dark" ? "rgba(12,14,20,0.95)" : "rgba(246,248,252,0.96)";
				const secondary = ink === "dark" ? "rgba(12,14,20,0.68)" : "rgba(246,248,252,0.72)";
				out["--dsw-alias-label-primary"] = { light: primary, dark: primary };
				out["--dsw-alias-label-secondary"] = { light: secondary, dark: secondary };
			}
			return out;
		}

		/**
		 * Seek a hidden <video> to ~18% of its duration and snapshot one frame,
		 * capped at 2048 px. The host route supports Range, so only the head and
		 * the seek target are fetched. Used by the wallpaper texture upload.
		 */
