		const React = require("react");
		const { createElement: h, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } = React;

		const SOURCE = "dsh-liquid-glass";
		const STORAGE_KEY = "dsh-liquid-glass.settings.v3";
		const LEGACY_STORAGE_KEYS = ["dsh-liquid-glass.settings.v2"];
		const API = "/liquid-glass";
		/** Bumped whenever the mapping or the settings contract changes; visible via /liquid-glass/state. */
		const CLIENT_BUILD = "v.26.11.28.183000";
		const LOAD_TAG = String((globalThis.__lgLoadCount = (globalThis.__lgLoadCount || 0) + 1));
		/**
		 * Appearance values are archived per colour mode. These ids and keys are
		 * shared by the settings model, the panel and the transition code; do not
		 * rename them without migrating storage (see 03-settings.js).
		 */
		const MODE_IDS = Object.freeze(["auto", "light", "dark", "custom", "intelligent"]);
		const MODE_KEYS = Object.freeze(["tint", "veil", "dim", "ink", "customColor", "autoInvert"]);
		const MODE_DEFAULTS = Object.freeze({ tint: 0.55, veil: 0.34, dim: 0.08, ink: "auto", customColor: "#8ab4ff", autoInvert: true });

		/**
		 * The theme engine hosts independent background modules; each one keeps
		 * its own copy of the appearance knobs below so switching modules never
		 * inherits the other module's look.
		 */
		const MODULE_IDS = Object.freeze(["glass", "wallpaper", "elysia"]);
		/** Wallpaper Engine alignment ids, in the order the shader branches on. */
		const FIT_IDS = Object.freeze(["cover", "contain", "stretch", "pixel"]);
		const APPEARANCE_SCALARS = Object.freeze(["blur", "saturation", "flow", "colorMode", "customColor", "autoInvert", "ink"]);
		const DEFAULT_SETTINGS = Object.freeze({
			enabled: true,
			wallpaper: true,
			blur: 10,
			saturation: 1.4,
			tint: 0.55,
			veil: 0.34,
			dim: 0.08,
			refreshSec: 6,
			flow: 0.9,
			fps: 30,
			autoScale: true,
			source: "desktop",
			wePath: "",
			weId: "",
			filePath: "",
			// Web wallpapers: the host mirrors one workshop folder at a time, so the
			// folder is the thing we store; the URL is rebuilt every session.
			webPath: "",
			webTitle: "",
			webPreview: "",
			colorMode: "auto",
			customColor: "#8ab4ff",
			autoInvert: true,
			audio: { enabled: false, list: [], rate: 1, volume: 0.6, reactive: true },
			renderMode: "webgl",
			behind: true,
			ink: "auto",
			preset: "auto",
			module: "glass",
			island: false,
			weGlass: true,
			// Wallpaper property sheet: per-wallpaper playback and framing, the same
			// knobs Wallpaper Engine exposes in its own properties panel.
			wp: { fit: "cover", panX: 50, panY: 50, flipX: false, flipY: false, rate: 1, volume: 0, muted: true },
			wpPresets: [],
			modeValues: Object.fromEntries(MODE_IDS.map((id) => [id, { ...MODE_DEFAULTS }])),
			moduleValues: Object.fromEntries(
				MODULE_IDS.map((id) => [
					id,
					{
						blur: 10,
						saturation: 1.4,
						flow: 0.9,
						colorMode: "auto",
						customColor: "#8ab4ff",
						autoInvert: true,
						ink: "auto",
						modeValues: Object.fromEntries(MODE_IDS.map((mode) => [mode, { ...MODE_DEFAULTS }]))
					}
				])
			)
		});

		/**
		 * One cap for both backends: above 1.5x the wallpaper is blurred by the
		 * shader anyway, so the extra fragments are invisible but the GPU still
		 * pays DPR虏 of them. WebGL used to cap at 1 while WebGPU capped at 2,
		 * which made the two engines resolve noticeably differently on HiDPI.
		 */
		const DPR_CAP = 1.5;

		/** Power hint for the renderer: high-end presets ask for the dGPU. */
		function preferredPower(preset, tier) {
			return preset === "beast" || tier === "beast" ? "high-performance" : "low-power";
		}

		/**
		 * Hardware profiles. A preset only writes the knobs that keep the machine
		 * alive (engine, frame cap, dynamic resolution, occluded-window
		 * compositing) —never the wallpaper, the look or the capture cadence the
		 * user picked, so switching profile cannot repaint their glass.
		 */
		const PRESETS = Object.freeze({
			// Integrated GPU / unknown: 30 fps, DRS on.
			igpu: Object.freeze({ renderMode: "webgl", fps: 30, autoScale: true, behind: true }),
			// Entry discrete card: 60 fps, DRS on.
			balanced: Object.freeze({ renderMode: "webgl", fps: 60, autoScale: true, behind: true }),
			// High-end discrete card: WebGPU, uncapped-ish frame rate, no DRS.
			beast: Object.freeze({ renderMode: "webgpu", fps: 144, autoScale: false, behind: true })
		});
		const SAFE_FPS = Object.freeze({ igpu: 30, unknown: 30, balanced: 60, beast: 144 });
		const PRESET_OF_TIER = Object.freeze({ igpu: "igpu", unknown: "igpu", balanced: "balanced", beast: "beast" });
		const PRESET_IDS = Object.freeze(["auto", "igpu", "balanced", "beast"]);

		/**
		 * Latest quantised wallpaper sample, shared with the settings panel so it
		 * can show the measured brightness. 0.11 kept this in a useState scoped to
		 * the overlay and then *used it in the panel's scope* —a ReferenceError on
		 * every panel render. A plain object fixes that without adding a store.
		 */
		const inkProbe = { sample: null };

		/** Cached across reloads: the probe costs one throwaway GL context. */
		const HW = (globalThis.__lgHardware ??= { probed: false, renderer: "", vendor: "", tier: "unknown", webgpu: false });

		function classifyGpu(raw) {
			const text = String(raw || "");
			// Apple silicon is an integrated GPU sharing the CPU's package and power
			// budget: treat it as the protective profile, never the beast one.
			if (/apple\s*m\d|apple\s*gpu/i.test(text)) return "igpu";
			if (/rtx\s*(40|50)\d{2}|rtx\s*a\d{4}|rx\s*9\d{3}|arc\s*b\d{3}/i.test(text)) return "beast";
			if (/\brtx\b|\bgtx\b|rx\s*[5-7]\d{2}|radeon\s*rx|arc\s*a\d{3}/i.test(text)) return "balanced";
			if (/intel|iris|uhd|\bhd\s*graphics|radeon\s*(graphics|vega)|vega\s*\d|mali|adreno|powervr|swiftshader|llvmpipe|basic\s*render|microsoft\s*basic/i.test(text)) {
				return "igpu";
			}
			return "unknown";
		}

		function probeHardware() {
			if (HW.probed) return HW;
			HW.probed = true;
			try {
				const canvas = document.createElement("canvas");
				canvas.width = 1;
				canvas.height = 1;
				const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
				if (gl) {
					const debug = gl.getExtension("WEBGL_debug_renderer_info");
					HW.renderer = String((debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "").trim();
					HW.vendor = String((debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) || "").trim();
					// Free the probe context immediately: leaving it alive would cost a
					// second GPU context for the whole session.
					gl.getExtension("WEBGL_lose_context")?.loseContext();
				}
			} catch {
				// A blocked probe only means we stay on the protective profile.
			}
			try {
				HW.webgpu = Boolean(navigator.gpu);
			} catch {
				HW.webgpu = false;
			}
			HW.tier = classifyGpu(`${HW.vendor} ${HW.renderer}`);
			return HW;
		}
