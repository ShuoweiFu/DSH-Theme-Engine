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
			return {
				enabled: source.enabled !== false,
				wallpaper: source.wallpaper !== false,
				blur: Math.round(num(source.blur, DEFAULT_SETTINGS.blur, 0, 48)),
				saturation: num(source.saturation, DEFAULT_SETTINGS.saturation, 1, 2.4),
				tint: num(source.tint, DEFAULT_SETTINGS.tint, 0, 1),
				veil: num(source.veil, DEFAULT_SETTINGS.veil, 0, 1),
				dim: num(source.dim, DEFAULT_SETTINGS.dim, 0, 0.6),
				refreshSec: Math.round(num(source.refreshSec, DEFAULT_SETTINGS.refreshSec, 1, 60)),
				flow: num(source.flow, DEFAULT_SETTINGS.flow, 0, 1.5),
				fps: Math.round(num(source.fps, DEFAULT_SETTINGS.fps, 0, 240)),
				autoScale: source.autoScale !== false,
				source: ["wallpaper", "we", "file"].includes(source.source) ? source.source : "desktop",
				wePath: typeof source.wePath === "string" ? source.wePath : "",
				weId: typeof source.weId === "string" ? source.weId : "",
				filePath: typeof source.filePath === "string" ? source.filePath : "",
				colorMode: ["light", "dark", "custom", "intelligent"].includes(source.colorMode) ? source.colorMode : "auto",
				customColor: /^#[0-9a-f]{6}$/i.test(source.customColor) ? source.customColor : DEFAULT_SETTINGS.customColor,
				autoInvert: source.autoInvert !== false,
				audio: {
					enabled: audioRaw.enabled === true,
					list: audioList,
					rate: Math.round(num(audioRaw.rate, 1, 0.5, 2) * 100) / 100,
					volume: num(audioRaw.volume, 0.6, 0, 1),
					reactive: audioRaw.reactive !== false
				},
				renderMode: source.renderMode === "webgpu" ? "webgpu" : "webgl",
				behind: source.behind !== false,
				ink: source.ink === "dark" || source.ink === "light" ? source.ink : "auto",
				preset: PRESET_IDS.includes(source.preset) ? source.preset : "auto"
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
		function glassTokens(tint, veil, ink) {
			const t = Math.min(1, Math.max(0, tint));
			const v = Math.min(1, Math.max(0, veil == null ? DEFAULT_SETTINGS.veil : veil));
			const base = 0.02 + 0.45 * v;
			const lift = 0.02 + 0.05 * v;
			const tintLift = 0.9 + 0.2 * t;
			const light = {
				"--dsw-alias-bg-base": `rgba(255,255,255,${clampAlpha(base * tintLift)})`,
				"--dsw-alias-bg-layer-1": `rgba(255,255,255,${clampAlpha((base + lift) * tintLift)})`,
				"--dsw-alias-bg-layer-2": `rgba(252,253,255,${clampAlpha((base + lift * 2.4) * tintLift)})`,
				// The composer, menus and popovers paint with bg-overlay. It used to be
				// pinned at 0.5 white regardless of veil, so at "bare glass" the input
				// box stayed a solid white slab while every other surface dropped to
				// 0.02 — that white slab is what swallowed white placeholder text.
				// Overlay now rides the same frost curve (0.06 → 0.92) so it can only be
				// as dense as the rest of the glass.
				"--dsw-alias-bg-overlay": `rgba(251,252,255,${clampAlpha(0.06 + 0.86 * v)})`,
				"--dsw-specific-sidebar-fill": `rgba(255,255,255,${clampAlpha((0.02 + 0.38 * v) * tintLift)})`,
				"--dsw-alias-border-l1": "rgba(20,24,32,0.1)",
				"--dsw-alias-border-l2": "rgba(20,24,32,0.16)"
			};
			const dark = {
				"--dsw-alias-bg-base": `rgba(9,11,16,${clampAlpha((base + 0.03) * tintLift)})`,
				"--dsw-alias-bg-layer-1": `rgba(14,18,26,${clampAlpha((base + lift + 0.03) * tintLift)})`,
				"--dsw-alias-bg-layer-2": `rgba(20,25,35,${clampAlpha((base + lift * 2.4 + 0.03) * tintLift)})`,
				"--dsw-alias-bg-overlay": `rgba(18,22,31,${clampAlpha(0.1 + 0.85 * v)})`,
				"--dsw-specific-sidebar-fill": `rgba(11,14,21,${clampAlpha((0.02 + 0.38 * v + 0.03) * tintLift)})`,
				"--dsw-alias-border-l1": "rgba(255,255,255,0.1)",
				"--dsw-alias-border-l2": "rgba(255,255,255,0.16)"
			};
			const out = {};
			for (const token of Object.keys(light)) out[token] = { light: light[token], dark: dark[token] };
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
