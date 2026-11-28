		function apply(ctx) {
			// One-time cleanup of the stale marker a diagnostic build left behind.
			try {
				if (document.title.startsWith("LG-BUILD-")) document.title = "AI助手身份与版本询问 — DeepSeek Harness";
			} catch {
				/* the title is cosmetic */
			}
			if (typeof window !== "undefined") {
				window.addEventListener("error", (event) => {
					reportClientError(`window: ${String(event?.message ?? "error")} @ ${event?.filename ?? "?"}:${event?.lineno ?? 0}`);
				});
				window.addEventListener("unhandledrejection", (event) => {
					reportClientError(`promise: ${String(event?.reason?.stack ?? event?.reason ?? "rejection")}`);
				});
			}

			// Follow the DSH locale preference, not the browser's language list.
			const locale = (() => {
				try {
					return ctx.get("locale") ?? null;
				} catch {
					return null;
				}
			})();
			// Bind the method: the locale service implements subscribe with `this`,
			// so a detached reference throws instead of subscribing.
			const subscribeLocale = locale?.subscribe ? (listener) => locale.subscribe(listener) : () => () => {};
			const snapshotLocale = locale?.getSnapshot
				? () => locale.getSnapshot().active
				: () => String(navigator.language || "en");
			let activeLang = snapshotLocale();

			const useLang = () => {
				const lang = useSyncExternalStore(subscribeLocale, snapshotLocale, snapshotLocale);
				activeLang = lang;
				return lang;
			};

			const t = (key) => makeTranslate(activeLang)(key);

			let settings = readSettings();
			const settingsListeners = new Set();
			const getSettings = () => settings;
			const setSettings = (patch) => {
				const prev = settings;
				// Each module keeps its own appearance copy; clone before editing so a
				// rejected normalize can never leave two modules sharing a bucket.
				const moduleValues = {};
				for (const moduleId of MODULE_IDS) {
					const bucket = prev.moduleValues[moduleId];
					moduleValues[moduleId] = { ...bucket, modeValues: { ...bucket.modeValues } };
				}
				const current = moduleValues[prev.module];
				// The top-level keys are the render truth: write them back first.
				current.blur = prev.blur;
				current.saturation = prev.saturation;
				current.flow = prev.flow;
				current.colorMode = prev.colorMode;
				current.customColor = prev.customColor;
				current.autoInvert = prev.autoInvert;
				current.ink = prev.ink;
				current.modeValues = { ...prev.modeValues };
				// 1) A patch touching an appearance slider lands in the active module
				//    (and, for per-mode keys, in the active colour bucket).
				const touchedModes = MODE_KEYS.filter((key) => key in patch);
				if (touchedModes.length) {
					const bucket = { ...current.modeValues[prev.colorMode] };
					for (const key of touchedModes) bucket[key] = patch[key];
					current.modeValues[prev.colorMode] = bucket;
				}
				for (const key of APPEARANCE_SCALARS) {
					if (key in patch && !MODE_KEYS.includes(key)) current[key] = patch[key];
				}
				const next = { ...patch };
				// 2) Colour-mode switch inside a module: load that module's bucket.
				if (patch.colorMode && patch.colorMode !== prev.colorMode) {
					const target = current.modeValues[patch.colorMode] || DEFAULT_SETTINGS.modeValues[patch.colorMode];
					for (const key of MODE_KEYS) if (!(key in patch)) next[key] = target[key];
					current.colorMode = patch.colorMode;
				}
				// 3) Module switch: save the current copy, then load the target copy;
				//    keys explicitly present in the patch still win.
				const module = patch.module && MODULE_IDS.includes(patch.module) ? patch.module : prev.module;
				if (module !== prev.module) {
					const target = moduleValues[module];
					for (const key of APPEARANCE_SCALARS) if (!(key in patch)) next[key] = target[key];
					for (const key of MODE_KEYS) if (!(key in patch)) next[key] = target.modeValues[target.colorMode][key];
					if (!("source" in patch)) {
						next.source = module === "wallpaper" ? "we" : module === "glass" ? "desktop" : prev.source;
					}
				}
				settings = normalize({ ...prev, ...next, module, moduleValues });
				persistSettings(settings);
				for (const listener of settingsListeners) listener();
			};
						const subscribeSettings = (listener) => {
				settingsListeners.add(listener);
				return () => settingsListeners.delete(listener);
			};
			const useSettings = () => useSyncExternalStore(subscribeSettings, getSettings, getSettings);

			// ---- Intelligent-mode colour bridge --------------------------------
			// The sampler lives in GlassLayer, but the appearance panel also needs the
			// sampled colour (swatch + resample button), so the value sits in a tiny
			// external store that both sides subscribe to.
			let intelColor = "";
			let intelToken = 0;
			const intelListeners = new Set();
			const intelNotify = () => {
				for (const listener of intelListeners) listener();
			};
			const intelSubscribe = (listener) => {
				intelListeners.add(listener);
				return () => intelListeners.delete(listener);
			};
			const intelSnapshotColor = () => intelColor;
			const intelSnapshotToken = () => intelToken;
			const intelSetColor = (next) => {
				if (next === intelColor) return;
				intelColor = next;
				intelNotify();
			};
			const intelResample = () => {
				intelToken += 1;
				intelNotify();
			};
			const useIntelColor = () => useSyncExternalStore(intelSubscribe, intelSnapshotColor, intelSnapshotColor);
			const useIntelToken = () => useSyncExternalStore(intelSubscribe, intelSnapshotToken, intelSnapshotToken);

			// ---- Hardware adaptive presets --------------------------------------
			// The probe runs once per page load and only reads a renderer string; the
			// tier decides the startup profile and the ceiling the guard enforces.
			const hw = probeHardware();
			const tierPreset = PRESET_OF_TIER[hw.tier] ?? "igpu";
			const hasStoredSettings = (() => {
				try {
					return localStorage.getItem(STORAGE_KEY) !== null;
				} catch {
					return false;
				}
			})();
			let startupNotice = "";
			/** Apply a profile. `auto` resolves to whatever the detected tier maps to. */
			const applyPreset = (id) => {
				const chosen = !id || id === "auto" ? tierPreset : PRESETS[id] ? id : tierPreset;
				setSettings({ ...PRESETS[chosen], preset: !id || id === "auto" ? "auto" : chosen });
				return chosen;
			};
			/** Roll back to the protective profile for this machine. */
			const applySafePreset = () => {
				setSettings({ ...PRESETS[tierPreset], preset: tierPreset });
				return tierPreset;
			};
			if (!hasStoredSettings) {
				// First run: never start at full tilt on an unknown machine.
				const chosen = applyPreset("auto");
				startupNotice = chosen === "beast" ? "beastNotice" : chosen === "balanced" ? "balancedNotice" : "igpuNotice";
			}
			reportClientError(
				`hw: tier=${hw.tier} preset=${settings.preset} gpu="${hw.renderer || "unknown"}" webgpu=${hw.webgpu} firstRun=${!hasStoredSettings}`,
				true
			);

			let wallpaper = { status: "idle", url: "", kind: "image", name: "", mtime: 0, bytes: 0, error: "", appsBehind: false, bench: 0, elysia: { installed: false, name: "" } };
			const wallpaperListeners = new Set();
			const getWallpaper = () => wallpaper;
			const setWallpaper = (patch) => {
				wallpaper = { ...wallpaper, ...patch };
				for (const listener of wallpaperListeners) listener();
			};
			const subscribeWallpaper = (listener) => {
				wallpaperListeners.add(listener);
				return () => wallpaperListeners.delete(listener);
			};
			const useWallpaper = () => useSyncExternalStore(subscribeWallpaper, getWallpaper, getWallpaper);

			// The panel components (13-we.js) live outside this closure; hand them the
			// live store hooks so every surface reads the same settings object.
			panelHooks.useSettings = useSettings;
			panelHooks.setSettings = setSettings;
			panelHooks.useLang = useLang;
			panelHooks.useWallpaper = useWallpaper;
			panelHooks.useIntelColor = useIntelColor;
			panelHooks.resampleIntel = intelResample;

			// What sits behind the window is now part of the wallpaper picture:
			// the host composites the occluded app windows into the same capture, so
			// the glass keeps flowing and simply shows the real app behind it.

			let refreshNow = () => {};

			const theme = () => {
				try {
					return ctx.get("theme") ?? ctx.theme;
				} catch {
					return ctx.theme;
				}
			};

			// The renderer lives in the overlay layer; the settings panel reads this
			// registry so the guard state can be inspected without DevTools.
			let activeRenderer = null;

			function GlassLayer() {
				const value = useSettings();
				const state = useWallpaper();
				const lang = useLang();
				const [mode, setMode] = useState(currentMode);
				// Layer 5: 'webgl' → 'static' (translucent scrim, no black pane) →
				// 'off' (plugin disabled). There is no CSS wallpaper mode any more:
				// the shader is the only wallpaper renderer.
				const [degrade, setDegrade] = useState("webgl");
				const [webglEpoch, setWebglEpoch] = useState(0);
				const [notice, setNotice] = useState(() => (startupNotice ? makeTranslate(activeLang)(startupNotice) : ""));
				// Adaptive ink: null until the first wallpaper sample lands. `dark`
				// means "the wallpaper is bright, so write black text".
				//
				// The sample is quantised and compared against the previous one: a
				// live wallpaper changes `lum` on every capture, and letting that
				// flow into the token layer used to dispose/recreate the palette and
				// repaint the whole transcript once per poll (the flicker). Only a
				// sample that could change the decision is allowed through.
				const [inkInfo, setInkInfo] = useState(null);
				const intelColor = useIntelColor();
				const intelToken = useIntelToken();
				const inkRef = useRef(null);
				const onInk = useCallback((next) => {
					if (!next || typeof next.lum !== "number") return;
					const quantise = (value) => Math.round((Number(value) || 0) * 50) / 50;
					const sample = { lum: quantise(next.lum), content: quantise(next.content ?? next.lum), busy: quantise(next.busy) };
					const prev = inkRef.current;
					if (prev && prev.lum === sample.lum && prev.content === sample.content) return;
					inkRef.current = sample;
					inkProbe.sample = sample;
					setInkInfo(sample);
				}, []);
				const lossRef = useRef({ count: 0, at: 0 });
				const translate = makeTranslate(lang);
				const t = (key) => translate(key);
				// The host folds the occluded windows into the wallpaper capture, so
				// this is informational only — the glass never pauses for it.
				const appsBehind = state.appsBehind === true;

				// The palette selector lives on <body>; observe it so an OS theme flip
				// or a preference change recolors the glass without a reload.
				useEffect(() => {
					const api = theme();
					let dispose;
					if (api?.getTheme) {
						const sync = () => setMode(api.getTheme()?.active?.colorScheme === "dark" ? "dark" : "light");
						sync();
						if (typeof ctx.on === "function") dispose = ctx.on("theme/change", sync);
					}
					const observer = new MutationObserver(() => setMode(currentMode()));
					observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
					return () => {
						observer.disconnect();
						if (typeof dispose === "function") dispose();
					};
				}, []);

				// Colour modes (tasks 12-15): force light / dark, colour the glass from a
				// custom hex, or follow the wallpaper's own dominant colour. "auto" is the
				// system theme plus the optional auto-invert rule.
				const schemeRef = useRef("");
				const colorMode = value.colorMode || "auto";
				const autoInvert = value.autoInvert !== false;
				const glassBase = colorMode === "custom" ? value.customColor : colorMode === "intelligent" ? intelColor : "";
				let forcedMode = colorMode === "light" ? "light" : colorMode === "dark" ? "dark" : "";
				if (!forcedMode && autoInvert) {
					let lum = null;
					if (colorMode === "intelligent" && intelColor) lum = hexLuminance(intelColor);
					else if (colorMode === "auto" && inkInfo) lum = inkInfo.content ?? inkInfo.lum;
					if (lum != null) {
						// Bright wallpaper -> light glass, dark wallpaper -> dark glass.
						// 0.46 / 0.54 is hysteresis, not a dead band: a wallpaper hovering
						// around the middle keeps the scheme it already had instead of
						// flickering the whole UI each time a frame comes back brighter.
						const previous = schemeRef.current || (mode === "dark" ? "dark" : "light");
						if (lum >= 0.54) schemeRef.current = "light";
						else if (lum <= 0.46) schemeRef.current = "dark";
						else schemeRef.current = previous;
						forcedMode = schemeRef.current;
					}
				}
				const appliedMode = forcedMode || mode;

				// ---- Appearance transition -----------------------------------------
				// A mode switch can also change tint / veil / dim / base colour, because
				// every mode owns its own values. Ease those numbers over 240 ms so the
				// glass cross-fades instead of hard-cutting.
				const displayRef = useRef({ tint: value.tint, veil: value.veil, dim: value.dim, base: glassBase, force: forcedMode });
				const [display, setDisplay] = useState(displayRef.current);
				const transitionRef = useRef(0);
				const switchingRef = useRef(false);
				const targetDisplay = () => ({ tint: value.tint, veil: value.veil, dim: value.dim, base: glassBase, force: forcedMode });
				const applyDisplay = (next) => {
					displayRef.current = next;
					setDisplay(next);
				};
				useEffect(() => {
					const from = displayRef.current;
					const to = targetDisplay();
					if (from.tint === to.tint && from.veil === to.veil && from.dim === to.dim && from.base === to.base && from.force === to.force) return undefined;
					const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
					const fromRgb = hexRgb(from.base);
					const toRgb = hexRgb(to.base);
					// iGPU / reduced motion / hidden window / no base colour: snap. The
					// transition is a nicety and never a reason to miss a frame.
					if (!value.enabled || hw.tier === "igpu" || document.hidden || reduce || !fromRgb || !toRgb) {
						switchingRef.current = false;
						applyDisplay(to);
						return undefined;
					}
					switchingRef.current = true;
					const started = performance.now();
					const duration = 240;
					const step = (now) => {
						const progress = Math.min(1, (now - started) / duration);
						const eased = 1 - Math.pow(1 - progress, 3);
						applyDisplay({
							tint: from.tint + (to.tint - from.tint) * eased,
							veil: from.veil + (to.veil - from.veil) * eased,
							dim: from.dim + (to.dim - from.dim) * eased,
							base: rgbHex(mixRgb(fromRgb, toRgb, eased)),
							force: to.force
						});
						if (progress < 1) transitionRef.current = requestAnimationFrame(step);
						else switchingRef.current = false;
					};
					cancelAnimationFrame(transitionRef.current);
					transitionRef.current = requestAnimationFrame(step);
					return () => cancelAnimationFrame(transitionRef.current);
				}, [value.colorMode]);
				const modeSeenRef = useRef(value.colorMode);
				useEffect(() => {
					// The mode-switch render also changes tint/veil/dim; the transition above
					// owns that frame. Any later slider move wins immediately — an eased
					// catch-up would feel laggy while the user is watching their own drag.
					if (modeSeenRef.current !== value.colorMode) {
						modeSeenRef.current = value.colorMode;
						return;
					}
					cancelAnimationFrame(transitionRef.current);
					switchingRef.current = false;
					applyDisplay(targetDisplay());
				}, [value.enabled, value.tint, value.veil, value.dim, glassBase, forcedMode, value.colorMode]);
				useEffect(() => () => cancelAnimationFrame(transitionRef.current), []);

				useEffect(() => {
					const root = document.documentElement;
					root.dataset.lgEnabled = value.enabled ? "on" : "off";
					root.dataset.lgMode = appliedMode;
					root.dataset.lgScheme = appliedMode;
					root.style.setProperty("--lg-dim", String(display.dim));
					root.style.setProperty("--lg-fallback", appliedMode === "dark" ? "#0b0e14" : "#eef1f6");
					root.dataset.lgBehind = appsBehind ? "on" : "off";
				}, [value.enabled, display.dim, appliedMode, appsBehind]);

				// WebGL liquid wallpaper: owns its canvas under <body>.
				const liquidRef = useRef(null);
				const liquid = liquidRef.current;
				const wallpaperUrl = value.wallpaper && state.url ? state.url : "";
				const wallpaperKind = state.kind === "video" ? "video" : state.kind === "animation" ? "animation" : "image";

				// Intelligent mode needs one dominant colour per wallpaper. Image and
				// video sources are sampled client-side; scene/web wallpapers arrive as
				// the live desktop image, so the desktop capture is sampled instead.
				useEffect(() => {
					if (colorMode !== "intelligent" || !wallpaperUrl) {
						intelSetColor("");
						return undefined;
					}
					let alive = true;
					sampleWallpaperColor(wallpaperUrl, wallpaperKind).then((color) => {
						if (alive && color) intelSetColor(color);
					});
					return () => {
						alive = false;
					};
				}, [colorMode, wallpaperUrl, wallpaperKind, intelToken]);

				// Layer 1 + 2: a pointer move only wakes the renderer; it never starts
				// a second loop, and the highlight itself is throttled to one rAF.
				useEffect(() => {
					if (!value.enabled) return;
					const root = document.documentElement;
					let queued = 0;
					const onMove = (event) => {
						if (queued) return;
						queued = requestAnimationFrame(() => {
							queued = 0;
							root.style.setProperty("--lg-mx", `${event.clientX}px`);
							root.style.setProperty("--lg-my", `${event.clientY}px`);
							liquidRef.current?.setMouse(event.clientX, event.clientY);
							liquidRef.current?.wake();
						});
					};
					window.addEventListener("pointermove", onMove, { passive: true });
					return () => {
						if (queued) cancelAnimationFrame(queued);
						window.removeEventListener("pointermove", onMove);
					};
				}, [value.enabled]);

				// Layer 5: a lost context freezes WebGL and drops to the static scrim;
				// a second failure inside ten minutes turns the plugin off entirely.
				const onFault = (kind) => {
					if (kind === "restored") return;
					const now = Date.now();
					const record = lossRef.current;
					record.count = now - record.at < 10 * 60 * 1000 ? record.count + 1 : 1;
					record.at = now;
					reportClientError(`context: ${kind} count=${record.count}`, true);
					// Layer 3: whatever profile was running, the machine just proved it
					// cannot take it — roll back to the safe one before retrying.
					const rolled = applySafePreset();
					reportClientError(`preset: rollback -> ${rolled}`, true);
					if (record.count >= 2) {
						setDegrade("off");
						setNotice(translate("autoDisabled"));
						setSettings({ enabled: false });
						reportClientError("degrade: off", true);
					} else {
						// Fifth protection layer: keep the app legible, never a black
						// pane. A flat translucent scrim replaces the shader output.
						setDegrade("static");
						setNotice(translate("staticMode"));
						reportClientError("degrade: static", true);
					}
				};

				// Layer 3: a manual override that overheats the GPU is rolled back on
				// evidence — five consecutive seconds of over-budget frames or a driver
				// reset — instead of a guess based on the model name.
				const overBudgetRef = useRef(0);
				useEffect(() => {
					if (!value.enabled) return undefined;
					const ceiling = SAFE_FPS[hw.tier] ?? 30;
					const timer = setInterval(() => {
						try {
							const stats = activeRenderer?.stats();
							if (!stats || stats.mode !== "running") {
								overBudgetRef.current = 0;
								return;
							}
							const forced = value.fps === 0 || value.fps > ceiling;
							const budget = value.fps === 0 ? 26 : 1000 / Math.max(1, value.fps);
							const observed = stats.frameGap || stats.ms || 0;
							if (forced && observed > Math.max(30, budget * 1.4)) {
								overBudgetRef.current += 1;
							} else {
								overBudgetRef.current = Math.max(0, overBudgetRef.current - 1);
							}
							if (overBudgetRef.current >= 5) {
								overBudgetRef.current = 0;
								const rolled = applySafePreset();
								setNotice(translate("presetClamped"));
								reportClientError(`preset: clamp ${value.fps}fps@${Math.round(observed)}ms tier=${hw.tier} -> ${rolled}`, true);
							}
						} catch {
							/* the guard never throws into render */
						}
					}, 1000);
					return () => clearInterval(timer);
				}, [value.enabled, value.fps, value.autoScale, translate]);

				// When the wallpaper module runs with the liquid glass layer switched
				// off, the renderer still paints the wallpaper but with neutral glass
				// parameters (no extra blur, no saturation push, no flow).
				const glassParams = () => {
					const off = value.module === "wallpaper" && value.weGlass === false;
					const wp = value.wp && typeof value.wp === "object" ? value.wp : DEFAULT_SETTINGS.wp;
					return {
						sat: off ? 1 : value.saturation,
						dim: value.dim,
						flow: off ? 0 : value.flow,
						blur: off ? 0 : value.blur,
						// Wallpaper Engine properties: alignment, position, mirroring.
						fit: Math.max(0, FIT_IDS.indexOf(wp.fit)),
						pan: [wp.panX / 100, wp.panY / 100],
						flip: [wp.flipX ? 1 : 0, wp.flipY ? 1 : 0]
					};
				};
				useEffect(() => {
					const root = document.documentElement;
					if (!value.enabled) return;
					if (degrade !== "webgl") {
						// The stylesheet owns the static scrim; make sure a stale canvas
						// flag cannot keep the WebGL-only rules alive.
						root.dataset.lgWebgl = "static";
						return;
					}
					const mode = value.renderMode;
					// The high-end preset is also how the user asks for the discrete
					// GPU; everything else hints low-power so laptops stay on the iGPU.
					const powerPreference = preferredPower(value.preset, hw.tier);
					let cancelled = false;
					const liquid = mode === "webgpu" ? createWebGpuCanvas({ onFault, onInk, onBeat: audioBeat, powerPreference }) : createLiquidCanvas({ onFault, onInk, onBeat: audioBeat, powerPreference });
					if (!liquid) {
						reportClientError(`renderMode ${mode}: unavailable`, true);
						if (mode === "webgpu") {
							// WebGPU is the only mode with an alternative backend: fall
							// back to WebGL instead of degrading the whole plugin.
							setSettings({ renderMode: "webgl" });
							setNotice(translate("webgpuUnavailable"));
						} else {
							setDegrade("static");
							setNotice(translate("staticMode"));
						}
						return;
					}
					if (liquid.ready) {
						liquid.ready.then((ok) => {
							if (cancelled || ok) return;
							liquid.dispose();
							setSettings({ renderMode: "webgl" });
							setNotice(translate("webgpuUnavailable"));
						});
					}
					document.body.appendChild(liquid.canvas);
					liquidRef.current = liquid;
					activeRenderer = liquid;
					root.dataset.lgWebgl = mode === "webgpu" ? "gpu" : "on";
					liquid.setParams(glassParams());
					liquid.setTargetFps(value.fps);
					liquid.setAutoScale(value.autoScale);
					liquid.start();
					return () => {
						cancelled = true;
						liquid.dispose();
						liquidRef.current = null;
						if (activeRenderer === liquid) activeRenderer = null;
						if (root.dataset.lgWebgl !== "static") {
							root.dataset.lgWebgl = "off";
						}
					};
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, [value.enabled, degrade, webglEpoch, value.renderMode]);

				// Keep the renderer's own protection state (fps / DRS) in sync.
				useEffect(() => {
					liquidRef.current?.setTargetFps(value.fps);
				}, [value.fps]);

				useEffect(() => {
					liquidRef.current?.setAutoScale(value.autoScale);
				}, [value.autoScale]);

				// Layer 1: hidden window, blurred window, or lost focus stops the loop;
				// coming back waits 300 ms so rapid Alt+Tab cannot thrash the GPU.
				// Polled as well as event-driven: programmatic window raises do not
				// always emit focus events, and a stale "running" is the expensive bug.
				useEffect(() => {
					const sync = () => {
						const liquid = liquidRef.current;
						if (!liquid) return;
						const hidden = document.visibilityState === "hidden" || !document.hasFocus();
						liquid.setPaused("window", hidden);
						// A hidden window throttles video decode, so a video wallpaper can
						// still be missing when focus comes back: retry once it is shown.
						if (!hidden && wallpaperUrl && !liquid.hasTexture()) {
							liquid.setWallpaper(wallpaperUrl, wallpaperKind);
						}
					};
					document.addEventListener("visibilitychange", sync);
					window.addEventListener("blur", sync);
					window.addEventListener("focus", sync);
					const timer = setInterval(sync, 700);
					sync();
					return () => {
						clearInterval(timer);
						document.removeEventListener("visibilitychange", sync);
						window.removeEventListener("blur", sync);
						window.removeEventListener("focus", sync);
					};
				}, [value.enabled, degrade, wallpaperUrl, wallpaperKind]);

				// Layer 4: wake on any pointer activity so "flow = 0" is not a dead end.
				useEffect(() => {
					if (!value.enabled) return;
					const wake = () => liquidRef.current?.wake();
					window.addEventListener("pointerdown", wake, { passive: true });
					window.addEventListener("wheel", wake, { passive: true });
					return () => {
						window.removeEventListener("pointerdown", wake);
						window.removeEventListener("wheel", wake);
					};
				}, [value.enabled]);

				// Keep shader parameters in sync with the sliders. `blur` is part of the
				// dependency list: the prepass radius is computed inside setParams, so
				// without it the blur slider only takes effect on the next reload.
				useEffect(() => {
					liquidRef.current?.setParams(glassParams());
				}, [
					value.saturation, value.dim, value.flow, value.blur, value.module, value.weGlass,
					value.wp.fit, value.wp.panX, value.wp.panY, value.wp.flipX, value.wp.flipY
				]);

				// Playback speed, volume and mute belong to the property sheet, not to the
				// shader, so they travel through the capture module instead.
				useEffect(() => {
					setLivePrefs({ rate: value.wp.rate, volume: value.wp.volume, muted: value.wp.muted });
				}, [value.wp.rate, value.wp.volume, value.wp.muted]);

				// (Re)load the wallpaper texture whenever the fingerprint advances.
				useEffect(() => {
					if (!wallpaperUrl) return;
					liquidRef.current?.setWallpaper(wallpaperUrl, wallpaperKind);
				}, [wallpaperUrl, wallpaperKind]);

				// Token layering is the supported way to restyle shipped surfaces:
				// the theme service composes our layer above the active theme.
				//
				// The 0.11 ink feature is back, but the layer is only re-applied when
				// the *resolved* tokens actually change (signature guard on an
				// applied-layer ref). Rebuilding the palette on every wallpaper
				// sample was exactly what repainted the whole transcript every poll;
				// with the guard a moving wallpaper can at most swap one palette.
				const appliedRef = useRef(null);
				useEffect(
					() => () => {
						appliedRef.current?.dispose?.();
						appliedRef.current = null;
					},
					[]
				);
				useEffect(() => {
					const api = theme();
					if (!api?.overrideTokens) return;
					try {
						if (!value.enabled) {
							appliedRef.current?.dispose?.();
							appliedRef.current = null;
							delete document.documentElement.dataset.lgInk;
							return;
						}
						// Manual override wins, always: picking white text on a bright
						// wallpaper is the user's call, not ours. Only "auto" derives an
						// ink from the sample.
						let ink = value.ink;
						const veil = display.veil;
						if (ink !== "dark" && ink !== "light") {
							// The text sits on the glass, not on the wallpaper behind it. A forced
							// scheme flips the palette; without one the app theme paints the glass,
							// so the ink has to follow that theme. Pairing the ink to the wallpaper
							// sample instead was the white-on-white bug: a dark wallpaper derived
							// light ink while the app kept painting its light glass.
							ink = appliedMode === "dark" ? "light" : "dark";
						}
						// The composer is its own surface: the frosted card reads the overlay
						// token, which glassTokens() already tints toward the ink in use.
						// The caret must land on the far side of the ink, and the ink is a
						// token itself, so stamp the decision on <html> and let 07-styles.js
						// map it: dark ink -> light caret, light ink -> dark caret.
						if (ink === "dark" || ink === "light") document.documentElement.dataset.lgInk = ink;
						const next = glassTokens(display.tint, veil, ink, { force: display.force, base: display.base });
						const signature = JSON.stringify(next);
						if (appliedRef.current && appliedRef.current.signature === signature) return;
						appliedRef.current?.dispose?.();
						appliedRef.current = { signature, dispose: api.overrideTokens(SOURCE, next) };
						const readToken = (name) => { try { return getComputedStyle(document.body).getPropertyValue(name).trim(); } catch { return "?"; } };
						// What the bubble element actually paints, not just the token:
						// a stale token is invisible while a hard-coded plate is not.
						const bubbleCss = () => { try { const node = document.querySelector(".bubble, [class*=\"bubble\"]"); if (!node) return "none"; const s = getComputedStyle(node); return String(node.className).slice(0, 40) + " " + s.backgroundColor + "/" + s.color; } catch (error) { return "err"; } };
						webLog(`palette ink=${ink} scheme=${appliedMode} card=${readToken("--dsw-alias-card-fill")} layer2=${readToken("--dsw-alias-bg-layer-2")} overlay=${readToken("--dsw-alias-bg-overlay")} bubble=${readToken("--dsw-specific-bubble")} menu=${readToken("--dsw-menu-surface-fill")} bubbleCss=${bubbleCss()}`);
					} catch (error) {
						reportClientError(`overrideTokens: ${String(error?.stack ?? error)}`);
					}
				}, [value.enabled, display.tint, display.veil, display.base, display.force, value.ink, inkInfo, colorMode, value.customColor, appliedMode]);

				useEffect(() => {
					if (!value.enabled || !value.wallpaper || value.source === "web") {
						setWallpaper({
							status: value.enabled ? "missing" : "off",
							url: "",
							kind: "image",
							name: "",
							mtime: 0,
							bytes: 0,
							error: ""
						});
						return;
					}

				let alive = true;
				// The host pushes live frames while streaming, so the digest poll speeds up
				// with it instead of waiting out the idle cadence between captures.
				let fast = false;
				let timer = 0;
				let lastDigest = "";
				const idlePollMs = 1100;
				const fastPollMs = 220;

				const tick = async () => {
					if (!alive) return;
					try {
						// Source "we" pins one Wallpaper Engine project; source "file"
						// pins a local video/image. Sources "desktop"/"wallpaper" never
						// carry a path and always resolve from the live desktop.
						const pinned = value.source === "we" ? value.wePath : value.source === "file" ? value.filePath : "";
						const query = `source=${encodeURIComponent(value.source)}&behind=${value.behind ? 1 : 0}${pinned ? `&path=${encodeURIComponent(pinned)}` : ""}`;
						const response = await fetch(`${API}/state?${query}`, { cache: "no-store", credentials: "same-origin" });
						if (!alive) return;
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						const data = await response.json();
						if (!alive) return;
						const streaming = data?.streaming === true;
						if (streaming !== fast) {
							fast = streaming;
							clearInterval(timer);
							timer = setInterval(tick, fast ? fastPollMs : idlePollMs);
						}
						if (data?.available) {
							// Rev by content digest, not by mtime: a recapture that produced
							// an identical picture must not change the URL, otherwise the
							// texture is re-uploaded and the wallpaper jumps every second.
							const rev = data.digest || data.mtime || 0;
							if (rev !== lastDigest) {
								lastDigest = rev;
								setWallpaper({
									status: "ready",
									url: `${API}/wallpaper?rev=${encodeURIComponent(rev)}&${query}`,
									kind: data.kind === "video" ? "video" : data.kind === "animation" ? "animation" : "image",
									name: typeof data.name === "string" ? data.name : "",
									mtime: typeof data.mtime === "number" ? data.mtime : 0,
									bytes: typeof data.bytes === "number" ? data.bytes : 0,
									appsBehind: data.appsBehind === true,
									bench: Number(data.bench) || 0,
									...(data.elysia && typeof data.elysia === "object" ? { elysia: data.elysia } : {}),
									error: ""
								});
							}
						} else if (lastDigest !== "") {
							lastDigest = "";
							setWallpaper({ status: "missing", url: "", kind: "image", name: "", mtime: 0, bytes: 0, appsBehind: false, bench: 0, error: "" });
						}
					} catch (error) {
						if (!alive) return;
						setWallpaper({ status: "error", url: "", kind: "image", name: "", mtime: 0, bytes: 0, error: String(error?.message ?? error) });
					}
				};

				refreshNow = tick;
				// Idle cadence first, then the first tick: tick() switches the interval
				// to fastPollMs as soon as the host reports a live capture stream, and it
				// must not be racing an assignment that would overwrite that switch.
				timer = setInterval(tick, idlePollMs);
				tick();
				const onVisible = () => {
					if (document.visibilityState === "visible") tick();
				};
				const onFocus = () => tick();
				document.addEventListener("visibilitychange", onVisible);
				window.addEventListener("focus", onFocus);
				return () => {
					alive = false;
					refreshNow = () => {};
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
					window.removeEventListener("focus", onFocus);
				};
			}, [value.enabled, value.wallpaper, value.source, value.behind, value.wePath, value.filePath]);

				// --- Web wallpapers ---------------------------------------------------
				// A web wallpaper is HTML, so the only way to show it is to let the browser
				// render it. The frame is created with exactly "allow-scripts
				// allow-pointer-lock" and no allow-same-origin: that combination gives the
				// document an *opaque origin* — it cannot touch this window's DOM, cookies or
				// storage, cannot read the disk, cannot navigate us, and cannot even learn
				// which folder it came from. All it can do is paint, script itself and ask for
				// pointer lock, and everything it loads comes from the host's read-only mirror
				// of one workshop folder.
				// Everything the frame does is logged twice: into the page's own console via
				// the shim, and back to the host ring buffer, which is how a wallpaper that
				// fails inside an opaque origin can still explain itself.
				const webLog = (text) => {
					try {
						fetch(`${API}/web/__log?level=client&msg=${encodeURIComponent(String(text).slice(0, 300))}`, { cache: "no-store" }).catch(() => {});
					} catch {
						// Logging must never be the reason a wallpaper fails.
					}
				};

				const webActive = Boolean(value.enabled && value.wallpaper && value.source === "web" && value.webPath);
				useEffect(() => {
					document.documentElement.dataset.lgSource = value.source;
				}, [value.source]);

				useEffect(() => {
					if (!webActive) return;
					const root = document.documentElement;
					root.dataset.lgWeb = "on";
					webLog(`mount dir=${value.webPath}`);
					// The shader canvas is opaque and sits above the frame; here the frame *is*
					// the wallpaper, so the renderer steps aside and the glass comes from the CSS
					// backdrop-filter on the panels instead of from the shader.
					liquidRef.current?.setPaused("web", true);
					const frame = document.createElement("iframe");
					frame.className = "lg-web-frame";
					frame.dataset.lgWeb = "frame";
					// The whole security boundary is this one attribute.
					frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
					frame.setAttribute("referrerpolicy", "no-referrer");
					frame.setAttribute("tabindex", "-1");
					frame.setAttribute("aria-hidden", "true");
					document.body.appendChild(frame);
					// Opaque origin: postMessage is the only channel this page has.
					// Real system audio: Chromium loopback through getDisplayMedia, with
					// the host answering the request (otherwise a picker appears). The
					// shim keeps its synthetic sweep until the first bins arrive, so a
					// refused capture degrades instead of going flat.
					let loopback = null;
					const stopLoopback = () => {
						if (!loopback) return;
						clearInterval(loopback.timer);
						for (const track of loopback.stream.getTracks()) track.stop();
						if (loopback.ctx) loopback.ctx.close().catch(() => {});
						loopback = null;
						webLog("loopback: stopped");
					};
					const beginLoopback = async () => {
						if (loopback) return;
						try {
							const armed = await fetch(`${API}/audio/loopback`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
							webLog(`loopback: host ${armed && armed.ok ? (armed.installed ? "armed" : "answered") : "unavailable " + JSON.stringify((armed && armed.error) || "")}`);
							const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
							const tracks = stream.getAudioTracks();
							for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
							webLog(`loopback: tracks audio=${tracks.length}`);
							if (!tracks.length) { stream.getTracks().forEach((t) => t.stop()); return; }
							const AudioCtx = window.AudioContext || window.webkitAudioContext;
							const ctx = new AudioCtx();
							if (ctx.state === "suspended") await ctx.resume().catch(() => {});
							const source = ctx.createMediaStreamSource(new MediaStream(tracks));
							const analyser = ctx.createAnalyser();
							analyser.fftSize = 256;
							analyser.smoothingTimeConstant = 0.72;
							source.connect(analyser);
							const bins = new Uint8Array(analyser.frequencyBinCount);
							const payload = new Array(bins.length);
							const timer = setInterval(() => {
								const win = frame.contentWindow;
								if (!win) return;
								analyser.getByteFrequencyData(bins);
								for (let i = 0; i < bins.length; i += 1) payload[i] = bins[i] / 255;
								win.postMessage({ __lg: "audio", bins: payload }, "*");
							}, 16);
							loopback = { stream, ctx, timer };
							webLog(`loopback: streaming fft=256 bins=${bins.length}`);
						} catch (error) {
							webLog(`loopback failed: ${String((error && error.message) || error)}`);
						}
					};

					const onFrameMessage = (event) => {
						if (!frame.contentWindow || event.source !== frame.contentWindow) return;
						const data = event.data;
						if (!data || data.__lg !== "frame") return;
						webLog(`frame ${data.kind}: ${data.text}`);
						if (data.kind === "audio") beginLoopback();
					};
					window.addEventListener("message", onFrameMessage);
					
					const source = `${API}/web/index.html`;
					let disposed = false;
					let loaded = false;
					let paused = false;
					let watchdog = 0;
					const fail = (reason) => {
						if (disposed) return;
						const preview = value.webPreview;
						setSettings(preview ? { source: "file", filePath: preview, wallpaper: true } : { source: "desktop" });
						setNotice(translate("weWebFailed"));
						if (reason) reportClientError(`web wallpaper: ${reason}`);
						webLog(`fail: ${reason}`);
					};
					watchdog = setTimeout(() => { webLog("watchdog: no load event in 5 s"); if (!loaded) fail("no load event in 5 s"); }, 5000);
					frame.addEventListener("load", () => {
						webLog(`load event src=${frame.getAttribute("src") || ""}`);
						try {
							webLog(`frame location readable? ${frame.contentWindow.location.href}`);
						} catch (error) {
							// Expected: the frame is opaque-origin, so even reading this is refused.
							webLog(`opaque origin confirmed: ${String((error && error.message) || error)}`);
						}
						if (disposed) return;
						if (frame.getAttribute("src") === "about:blank") return;
						loaded = true;
						clearTimeout(watchdog);
					});
					fetch(`${API}/web/open?dir=${encodeURIComponent(value.webPath)}`, { cache: "no-store" })
						.then((response) => response.json())
						.then((data) => {
							webLog(`open ${data && data.ok === true ? "ok" : "refused"} ${JSON.stringify(data && (data.error || data.root || ""))}`);
							if (disposed) return;
							if (!data || data.ok !== true) {
								fail(String((data && data.error) || "open failed"));
								return;
							}
							frame.src = source;
						})
						.catch((error) => fail(String((error && error.message) || error)));
					
					// Same rule as the shader: a hidden or unfocused window must not leave an
					// animation running off-screen. Tearing the document down is cheaper than
					// pausing it, and it also stops any audio the page started on its own.
					const sync = () => {
						const hidden = document.visibilityState === "hidden" || !document.hasFocus();
						if (hidden === paused) return;
						paused = hidden;
						if (hidden) {
							frame.src = "about:blank";
							webLog("hidden: frame -> about:blank");
						} else if (loaded) {
							webLog("visible again: reloading the frame");
							frame.src = source;
						}
					};
					document.addEventListener("visibilitychange", sync);
					window.addEventListener("blur", sync);
					window.addEventListener("focus", sync);
					const timer = setInterval(sync, 900);
					sync();
					return () => {
						disposed = true;
						clearTimeout(watchdog);
						clearInterval(timer);
						document.removeEventListener("visibilitychange", sync);
						window.removeEventListener("blur", sync);
						window.removeEventListener("focus", sync);
						stopLoopback();
						window.removeEventListener("message", onFrameMessage);
						frame.remove();
						root.dataset.lgWeb = "off";
						liquidRef.current?.setPaused("web", false);
					};
				}, [webActive, value.webPath, value.webPreview]);

				// A web wallpaper renders in an opaque-origin frame, so neither the
				// shader nor this page can read a single pixel of it. The wallpaper's
				// own preview image is the only honest sample available, and it is
				// what the automatic ink decision gets whenever the source is a page.
				useEffect(() => {
					if (!value.enabled || !value.wallpaper || value.source !== "web") return undefined;
					const preview = String(value.webPreview || "");
					if (!preview) return undefined;
					let disposed = false;
					(async () => {
						try {
							const url = `${API}/wallpaper?source=file&path=${encodeURIComponent(preview)}`;
							const response = await fetch(url, { cache: "no-store" });
							if (!response.ok) throw new Error(`HTTP ${response.status}`);
							const bitmap = await createImageBitmap(await response.blob());
							if (disposed) {
								bitmap.close?.();
								return;
							}
							const sample = measureInk(bitmap);
							bitmap.close?.();
							if (sample && !isBlackSwap(sample)) onInk(sample);
							webLog(`ink sample <- preview ${sample ? Math.round(sample.lum * 100) : 0}%`);
						} catch (error) {
							webLog(`ink preview failed: ${String((error && error.message) || error)}`);
						}
					})();
					return () => {
						disposed = true;
					};
				}, [value.enabled, value.wallpaper, value.source, value.webPreview, onInk]);

				// The playlist lives in settings; the audio bus owns the <audio> element
				// so it keeps playing while the settings page is closed.
				useEffect(() => {
					audioSync(value.audio);
				}, [value.audio]);

				// Report guard-state transitions (mode/scale/fps/pause set) so the
				// host's lastClientError doubles as a live perf log during testing.
				useEffect(() => {
					let last = "";
					const timer = setInterval(() => {
						try {
							const stats = activeRenderer?.stats() ?? null;
							// The stored values (not the render-time snapshot) so a stale
							// or overridden setting can be spotted from the host log.
							const live = getSettings();
							// The token layer re-applies on the quantised sample, so report
							// the quantised one: a diagnostics reader then sees exactly
							// what drove the palette.
							const sample = inkRef.current;
							// The tokens actually applied, so readability problems can be
							// diagnosed from the host log instead of a DevTools session.
							const signature = JSON.stringify({
								degrade,
								stats,
								build: CLIENT_BUILD,
								ink: sample ? { c: sample.content, b: sample.busy } : null,
								label: getComputedStyle(document.body).getPropertyValue("--dsw-alias-label-primary").trim(),
								surface: getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base").trim(),
								veil: live.veil,
								tint: live.tint,
								mode: live.ink,
								capture: { lum: blackWatch.last, refused: blackWatch.skips },
								settings: {
									blur: live.blur,
									flow: live.flow,
									refreshSec: live.refreshSec,
									dim: live.dim,
									fps: live.fps,
									preset: live.preset,
									renderMode: live.renderMode
								}
							});
							if (signature === last) return;
							if (reportClientError(`perf: ${signature}`, true)) last = signature;
						} catch {
							/* ignore */
						}
					}, 1000);
					return () => clearInterval(timer);
				}, [degrade, value.tint]);

				useEffect(() => {
					// One small, local-only snapshot so the host can report whether the
					// glass actually mounted (and why not) without a DevTools session.
					try {
						const root = document.documentElement;
						const rootEl = document.getElementById("root");
						const rootStyle = rootEl ? getComputedStyle(rootEl) : null;
						const bodyBefore = getComputedStyle(document.body, "::before");
						reportClientError(`ready: ${CLIENT_BUILD} load=${LOAD_TAG} source=${value.source} surface=screen`, true);
						reportClientError(
							JSON.stringify({
								diag: 1,
								backend: value.renderMode,
								gpuApi: !!navigator.gpu,
								hw: { tier: hw.tier, renderer: hw.renderer, vendor: hw.vendor, webgpu: hw.webgpu },
								preset: value.preset,
								behind: value.behind,
								ink: value.ink,
								veil: value.veil,
								inkInfo: inkProbe.sample,
								enabled: root.dataset.lgEnabled ?? null,
								webgl: root.dataset.lgWebgl ?? null,
								suppressed: false,
								appsBehind: state.appsBehind === true,
								kind: state.kind ?? null,
								mode: root.dataset.lgMode ?? null,
								rootBackground: rootStyle?.backgroundColor ?? null,
								rootBackdrop: rootStyle?.backdropFilter || rootStyle?.webkitBackdropFilter || null,
								bodyBeforeImage: String(bodyBefore.backgroundImage || "").slice(0, 72),
								canvases: document.querySelectorAll("canvas").length,
								liquidCanvas: Boolean(document.querySelector("canvas[data-liquid-glass]")),
								viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
								lang: activeLang,
								sample: makeTranslate(activeLang)("section"),
								bodyToken: getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base").trim(),
								perf: (() => {
									try {
										return activeRenderer?.stats() ?? null;
									} catch {
										return null;
									}
								})(),
								settings: value
							}),
							true
						);
						// Host-triggered closed-loop benchmark (`bench: N` in the plugin
						// config). It reports ms/frame after gl.finish(), which is the only
						// number that survives a headless / occluded window.
					} catch (error) {
						reportClientError(`diag: ${String(error?.stack ?? error)}`);
					}
				}, []);



				// Kept out of the mount effect above so it reads the live wallpaper
				// state (the texture only exists once the first frame arrived).
				useEffect(() => {
					const frames = Number(state.bench) || 0;
					if (!frames) return undefined;
					let tries = 0;
					const timer = setInterval(() => {
						tries += 1;
						const renderer = activeRenderer;
						if (!renderer) return;
						if (!renderer.hasTexture()) {
							if (tries > 40) clearInterval(timer);
							return;
						}
						clearInterval(timer);
						try {
							Promise.resolve(renderer.benchmark?.(frames))
								.then((result) => {
									if (result) reportClientError(`bench: ${JSON.stringify(result)}`, true);
								})
								.catch((error) => reportClientError(`bench: failed ${String(error?.message ?? error)}`, true));
						} catch (error) {
							reportClientError(`bench: failed ${String(error?.message ?? error)}`, true);
						}
					}, 700);
					return () => clearInterval(timer);
				}, [state.bench]);

				return h(
					Fragment,
					null,
					h("style", { "data-liquid-glass": "true" }, CSS),
					value.enabled ? h("div", { className: "lg-light", "data-liquid-glass": "light" }) : null,
					notice || degrade !== "webgl"
						? h(
								"div",
								{ className: "lg-warn", "data-degrade": degrade, "data-liquid-glass": "warn" },
								h("span", { className: "lg-warn-text" }, notice || t("staticMode")),
								degrade !== "webgl"
									? h(
											"button",
											{
												type: "button",
												className: "lg-button",
												onClick: () => {
													setNotice("");
													setDegrade("webgl");
													setWebglEpoch((epoch) => epoch + 1);
													if (!value.enabled) setSettings({ enabled: true });
												}
											},
											t("retry")
										)
									: null,
								h(
									"button",
									{ type: "button", className: "lg-button", onClick: () => setNotice("") },
									t("noticeClose")
								)
							)
						: null
				);
			}

			function SettingsPanel() {
				const value = useSettings();
				const state = useWallpaper();
				const lang = useLang();
				const translate = makeTranslate(lang);
				const t = (key) => translate(key);
				const [perf, setPerf] = useState(null);
				const [update, setUpdate] = useState(null);
				const [tab, setTab] = useState(null);
				const checkUpdates = useCallback((force) => {
					setUpdate((prev) => ({ ...(prev ?? {}), loading: true, error: "" }));
					fetch(`${API}/update${force ? "?force=1" : ""}`)
						.then((response) => response.json())
						.then((data) =>
							setUpdate({ loading: false, data, error: data && data.ok === false ? String(data.error ?? "failed") : "" })
						)
						.catch((error) => setUpdate({ loading: false, data: null, error: String((error && error.message) || error) }));
				}, []);
				useEffect(() => {
					checkUpdates(false);
				}, [checkUpdates]);
				useEffect(() => {
					let timer = null;
					const stop = () => {
						if (timer !== null) {
							clearInterval(timer);
							timer = null;
						}
					};
					const read = () => {
						if (document.hidden) return;
						try {
							setPerf(activeRenderer?.stats() ?? null);
						} catch {
							setPerf(null);
						}
					};
					const start = () => {
						stop();
						if (document.hidden) return;
						read();
						timer = setInterval(read, 1000);
					};
					const onVisibility = () => {
						if (document.hidden) stop();
						else start();
					};
					start();
					document.addEventListener("visibilitychange", onVisibility);
					return () => {
						stop();
						document.removeEventListener("visibilitychange", onVisibility);
					};
				}, []);
				const modeText = perf
					? perf.mode === "running"
						? t("running")
						: perf.mode === "idle"
							? t("idleState")
							: perf.mode === "paused"
								? t("pausedState")
								: t("frozen")
					: t("frozen");
				const statusText =
					state.status === "ready" ? t("ready") : state.status === "off" ? t("off") : state.status === "error" ? t("error") : t("missing");
				const currentBuild = (update && update.data && update.data.current) || CLIENT_BUILD;
				const compareBuild = (left, right) => {
					const parse = (value) => {
						const match = String(value ?? "").match(/(\d{2})\.(\d{1,2})\.(\d{1,2})[.\-](\d+)/);
						return match ? match.slice(1).map(Number) : null;
					};
					const a = parse(left);
					const b = parse(right);
					if (!a || !b) return 0;
					for (let index = 0; index < 4; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
					return 0;
				};
				const channelState = (channel) => {
					const info = update && update.data && update.data.channels ? update.data.channels[channel] : null;
					if (!info) return t("checking");
					if (info.error) {
						if (info.error === "not-found") return t("updateNotPublished");
						if (info.error === "timeout") return t("updateTimeout");
						if (info.error === "unreachable") return t("updateUnreachable");
						return t("updateFailed");
					}
					return compareBuild(info.latest, currentBuild) > 0
						? `${t("updateAvailable")} · ${info.latest}`
						: `${t("updateUpToDate")} · ${info.latest}`;
				};
				const moduleValue = value.module ?? "glass";
				// `tab` is view-only: island and the plugin manager are not background
				// modules, so they must not overwrite settings.module.
				const tabValue = tab ?? moduleValue;
				const chooseTab = (next) => {
					setTab(next);
					if (next === "glass" || next === "wallpaper" || next === "elysia") {
						if (next === moduleValue) return;
						const patchValue = { module: next };
						// Only one background module may run at a time: switching modules
						// also points the wallpaper source at that module's engine.
						if (next === "wallpaper") patchValue.source = "we";
						if (next === "glass") patchValue.source = "desktop";
						setSettings(patchValue);
					}
				};

				// Both background modules expose the same appearance controls, but each
				// module owns its own stored copy (settings.moduleValues), so editing a
				// slider here never changes the other module's look.
				const renderAppearance = () => [
					h(
						"section",
						{ className: "lg-group", key: "appearance" },
						h("h2", { className: "lg-group-title" }, t("look")),
						h("p", { className: "lg-group-hint" }, t("appearanceSharedHint")),
						h(
							Row,
							{ label: t("wallpaper"), hint: t("wallpaperHint") },
							h(Switch, { on: value.wallpaper, onChange: (next) => setSettings({ wallpaper: next }), label: t("wallpaper") })
						),
						h(Slider, {
							label: t("blur"),
							value: value.blur,
							min: 0,
							max: 48,
							step: 1,
							display: value.blur + " px",
							onChange: (next) => setSettings({ blur: next })
						}),
						h(Slider, {
							label: t("saturation"),
							value: value.saturation,
							min: 1,
							max: 2.4,
							step: 0.05,
							display: value.saturation.toFixed(2),
							onChange: (next) => setSettings({ saturation: next })
						}),
						h(Slider, {
							label: t("tint"),
							value: value.tint,
							min: 0,
							max: 1,
							step: 0.01,
							display: Math.round(value.tint * 100) + "%",
							onChange: (next) => setSettings({ tint: next })
						}),
						h(Slider, {
							label: t("veil"),
							value: value.veil,
							min: 0,
							max: 1,
							step: 0.01,
							display: Math.round(value.veil * 100) + "%",
							onChange: (next) => setSettings({ veil: next })
						}),
						h("p", { className: "lg-group-hint" }, t("veilHint")),
						h(Slider, {
							label: t("dim"),
							value: value.dim,
							min: 0,
							max: 0.6,
							step: 0.01,
							display: Math.round(value.dim * 100) + "%",
							onChange: (next) => setSettings({ dim: next })
						}),
						h(Slider, {
							label: t("flow"),
							value: value.flow,
							min: 0,
							max: 1.5,
							step: 0.05,
							display: value.flow.toFixed(2),
							onChange: (next) => setSettings({ flow: next })
						}),
						h("p", { className: "lg-group-hint" }, t("flowHint")),
						h("p", { className: "lg-group-hint" }, t("moveHint"))
					),
					h(AppearanceModes, { key: "modes" })
				];

				return h(
					"section",
					{ className: "lg-page" },
					h(
						"header",
						{ className: "lg-page-head" },
						h(
							"div",
							{ className: "lg-page-heading", "data-window-drag": true },
							h("h1", { className: "lg-page-title" }, t("title")),
							h("p", { className: "lg-page-intro" }, t("intro"))
						),
						h(
							"div",
							{ className: "lg-page-actions" },
							h(
								"span",
								{ className: "lg-status-pill" },
								h("span", { className: "lg-dot", "data-state": state.status }),
								h("span", null, value.enabled ? statusText : t("off"))
							),
							h(Switch, {
								on: value.enabled,
								onChange: (next) => setSettings({ enabled: next }),
								label: t("enable")
							})
						)
					),
					h(
						"div",
						{ className: "lg-page-body" },
						h(
							"div",
							{ className: "lg-branch-tabs" },
							h(
								"button",
								{ type: "button", className: "lg-branch-tab", "data-on": tabValue === "glass" ? "on" : undefined, onClick: () => chooseTab("glass") },
								t("moduleGlass")
							),
							h(
								"button",
								{ type: "button", className: "lg-branch-tab", "data-on": tabValue === "wallpaper" ? "on" : undefined, onClick: () => chooseTab("wallpaper") },
								t("moduleWallpaper")
							),
							state.elysia && state.elysia.installed
								? h(
										"button",
										{ type: "button", className: "lg-branch-tab", "data-on": tabValue === "elysia" ? "on" : undefined, onClick: () => chooseTab("elysia") },
										t("moduleElysia")
									)
								: null,
							h(
								"button",
								{ type: "button", className: "lg-branch-tab", "data-on": tabValue === "island" ? "on" : undefined, onClick: () => chooseTab("island") },
								t("moduleIsland")
							),
							h(
								"button",
								{ type: "button", className: "lg-branch-tab", "data-on": tabValue === "plugin" ? "on" : undefined, onClick: () => chooseTab("plugin") },
								t("modulePlugin")
							),						),
						h("p", { className: "lg-group-hint" }, t("moduleHint")),
						tabValue === "glass"
							? h(
									"div",
									{ className: "lg-branch-body" },
renderAppearance(),
									h(
										"section",
										{ className: "lg-group" },
										h("h2", { className: "lg-group-title" }, t("renderGroup")),
										h(
											"div",
											{ className: "lg-row" },
											h(
												"div",
												{ className: "lg-label" },
												h("span", null, t("hardware")),
												h("span", { className: "lg-hint" }, `${hw.vendor || "—"} · ${hw.renderer || t("tier_unknown")}`)
											),
											h("b", { className: "lg-badge" }, t(`tier_${hw.tier}`))
										),
										h(
											"div",
											{ className: "lg-row" },
											h("div", { className: "lg-label" }, h("span", null, t("preset")), h("span", { className: "lg-hint" }, t("presetHint"))),
											h(
												"select",
												{
													className: "lg-select",
													value: value.preset ?? "auto",
													onChange: (event) => applyPreset(event.target.value)
												},
												h("option", { value: "auto" }, t("presetAuto")),
												h("option", { value: "igpu" }, t("presetIgpu")),
												h("option", { value: "balanced" }, t("presetBalanced")),
												h("option", { value: "beast" }, t("presetBeast"))
											)
										),
										(value.fps === 0 || value.fps > (SAFE_FPS[hw.tier] ?? 30)) && (hw.tier === "igpu" || hw.tier === "unknown")
											? h("p", { className: "lg-group-hint", "data-warn": "on" }, `⚠ ${t("fpsWarn")}`)
											: null,
										h(
											Row,
											{ label: t("renderMode"), hint: t("renderModeHint") },
											h(
												"select",
												{ className: "lg-select", value: value.renderMode, onChange: (event) => setSettings({ renderMode: event.target.value }) },
												h("option", { value: "webgl" }, t("renderWebgl")),
												h("option", { value: "webgpu" }, t("renderWebgpu"))
											)
										),
										h(
											"div",
											{ className: "lg-row" },
											h("div", { className: "lg-label" }, h("span", null, t("fps")), h("span", { className: "lg-hint" }, t("fpsHint"))),
											h(
												"select",
												{ className: "lg-select", value: String(value.fps), onChange: (event) => setSettings({ fps: Number(event.target.value) }) },
												[24, 30, 40, 48, 60, 90, 120, 144, 0].map((option) =>
													h("option", { key: option, value: String(option) }, option === 0 ? t("unlimited") : `${option} FPS`)
												)
											)
										),
										h(
											Row,
											{ label: t("autoScale"), hint: t("autoScaleHint") },
											h(Switch, { on: value.autoScale, onChange: (next) => setSettings({ autoScale: next }), label: t("autoScale") })
										),
										h(
											Row,
											{ label: t("behind"), hint: t("behindHint") },
											h(Switch, { on: value.behind, onChange: (next) => setSettings({ behind: next }), label: t("behind") })
										),
										h(
											"div",
											{ className: "lg-row" },
											h(
												"div",
												{ className: "lg-label" },
												h("span", null, t("ink")),
												h(
													"span",
													{ className: "lg-hint" },
													inkProbe.sample
														? `${t("inkHint")} · ${Math.round((inkProbe.sample.content ?? inkProbe.sample.lum) * 100)}%`
														: t("inkHint")
												)
											),
											h(
												"select",
												{ className: "lg-select", value: value.ink, onChange: (event) => setSettings({ ink: event.target.value }) },
												h("option", { value: "auto" }, t("inkAuto")),
												h("option", { value: "dark" }, t("inkDark")),
												h("option", { value: "light" }, t("inkLight"))
											)
										),
										h(
											"dl",
											{ className: "lg-facts" },
											h("div", { className: "lg-fact" }, h("dt", null, t("renderer")), h("dd", null, modeText)),
											h("div", { className: "lg-fact" }, h("dt", null, t("fps")), h("dd", null, perf ? (perf.fps === 0 ? "∞" : `${perf.fps}`) : "—")),
											h("div", { className: "lg-fact" }, h("dt", null, t("scale")), h("dd", null, perf ? `${Math.round(perf.scale * 100)}%` : "—")),
											h("div", { className: "lg-fact" }, h("dt", null, t("frames")), h("dd", null, perf ? `${perf.frames}` : "—")),
											h("div", { className: "lg-fact" }, h("dt", null, "ms"), h("dd", null, perf && typeof perf.ms === "number" ? `${perf.ms}` : "—")),
											h("div", { className: "lg-fact" }, h("dt", null, "gap"), h("dd", null, perf && typeof perf.frameGap === "number" ? `${perf.frameGap}` : "—")),
											h("div", { className: "lg-fact" }, h("dt", null, t("version")), h("dd", null, CLIENT_BUILD))
										)
									)
								)
							: null,
						tabValue === "wallpaper"
							? h(
									"div",
									{ className: "lg-branch-body" },
									h(WallpaperCenter, { key: "we" }),
									h(AudioPanel, { key: "audio" })
								)
							: null,

						tabValue === "elysia"
							? h(
									"div",
									{ className: "lg-branch-body" },
									h(
										"section",
										{ className: "lg-group" },
										h("h2", { className: "lg-group-title" }, t("moduleElysia")),
										h("p", { className: "lg-group-hint" }, t("moduleElysiaHint")),
										state.elysia && state.elysia.name ? h("p", { className: "lg-group-hint" }, `✓ ${state.elysia.name}`) : null,
										state.elysia && state.elysia.profile ? h("p", { className: "lg-group-hint" }, `${translate("elysiaProfile")} ${state.elysia.profile}`) : null,
										state.elysia && state.elysia.installed ? h("p", { className: "lg-group-hint" }, translate("elysiaRestart")) : null,
										state.elysia && !state.elysia.installed ? h("p", { className: "lg-group-hint" }, translate("elysiaMissing")) : null
									)
								)
							: null,
						tabValue === "island"
							? h(
									"div",
									{ className: "lg-branch-body" },
									h(
										"section",
										{ className: "lg-group" },
										h("h2", { className: "lg-group-title" }, t("moduleIsland")),
										h(
											Row,
											{ label: t("moduleIsland"), hint: t("moduleIslandHint") },
											h(Switch, { on: value.island, onChange: (next) => setSettings({ island: next }), label: t("moduleIsland") })
										),
										h("p", { className: "lg-group-hint" }, t("moduleIslandNote"))
									)
								)
							: null,
						tabValue === "plugin"
							? h(
									"div",
									{ className: "lg-branch-body" },
										h(
											"section",
											{ className: "lg-group" },
											h("h2", { className: "lg-group-title" }, t("modulePlugin")),
											h("p", { className: "lg-group-hint" }, t("pluginHint")),
											h(
												"div",
												{ className: "lg-row" },
												h("div", { className: "lg-label" }, h("span", null, t("version")), h("span", { className: "lg-hint" }, CLIENT_BUILD))
											),
											h(
												"div",
												{ className: "lg-row" },
												h("div", { className: "lg-label" }, h("span", null, "GitHub")),
												h(
													"a",
													{ className: "lg-button", href: "https://github.com/ShuoweiFu/DSH-Theme-Engine", target: "_blank", rel: "noreferrer" },
													t("download")
												)
											),
											h(
												"div",
												{ className: "lg-row" },
												h("div", { className: "lg-label" }, h("span", null, "npm")),
												h(
													"a",
													{ className: "lg-button", href: "https://www.npmjs.com/package/dsh-theme-engine", target: "_blank", rel: "noreferrer" },
													t("download")
												)
											)
										),
h(
							"section",
							{ className: "lg-group" },
							h("h2", { className: "lg-group-title" }, t("updateGroup")),
							h("p", { className: "lg-group-hint" }, t("updateHint")),
							h(
								"div",
								{ className: "lg-actions" },
								h(
									"button",
									{
										type: "button",
										className: "lg-button",
										disabled: Boolean(update && update.loading),
										onClick: () => checkUpdates(true),
									},
									update && update.loading ? t("checking") : t("checkUpdate")
								),
								h("span", { className: "lg-hint" }, `${t("updateCurrent")} ${currentBuild}`)
							),
							["npm", "git", "github"].map((channel) =>
								h(
									"div",
									{ className: "lg-row", key: channel },
									h(
										"div",
										{ className: "lg-label" },
										h("span", null, channel === "github" ? "GitHub" : channel),
										h("span", { className: "lg-hint" }, channelState(channel))
									),
									update && update.data && update.data.channels && update.data.channels[channel] && update.data.channels[channel].url
										? h(
												"a",
												{
													className: "lg-button",
													href: update.data.channels[channel].url,
													target: "_blank",
													rel: "noreferrer",
												},
												t("download")
											)
										: null
								)
							),
							h("p", { className: "lg-group-hint" }, t("updateInstallHint"))
						),
						h(
							"section",
							{ className: "lg-group" },
							h("h2", { className: "lg-group-title" }, t("status")),
							h(
								"div",
								{ className: "lg-status" },
								h("span", { className: "lg-dot", "data-state": state.status }),
								h(
									"div",
									null,
									h("b", null, statusText),
									state.name ? h("div", null, `${state.name} · ${formatBytes(state.bytes)}`) : null,
									state.error ? h("div", null, state.error) : null,
									!state.name && state.status === "missing"
										? h("div", null, lang.startsWith("zh") ? "在系统设置里设置桌面壁纸后，回到这里刷新。" : "Set a desktop wallpaper in the system settings, then refresh here.")
										: null
								)
							),
							h(
								"div",
								{ className: "lg-actions" },
								h(
									"button",
									{ type: "button", className: "lg-button", onClick: () => refreshNow() },
									t("refreshNow")
								),
								h(
									"button",
									{ type: "button", className: "lg-button", onClick: () => setSettings(DEFAULT_SETTINGS) },
									t("reset")
								)
							)
						)
							)
						: null,
					)
				);
			}

			// The sidebar row is a real panel entry: a `sidebar.panellist` id
			// addresses the keyed `main` slot, so clicking it switches the
			// right-hand work area to our page — exactly how the shipped Plugins
			// page works. Nothing is injected into the sidebar's <nav>, and no
			// settings form is rendered inline.
			const LG_PANEL_ID = "liquid-glass";

			function LiquidGlassIcon(props) {
				const size = Number(props?.size) || 16;
				return h(
					"svg",
					{
						width: size,
						height: size,
						viewBox: "0 0 16 16",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.4,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
						focusable: "false"
					},
					h("path", { d: "M8 2.4c2.1 2.4 3.4 4.3 3.4 6.1A3.4 3.4 0 0 1 8 11.9a3.4 3.4 0 0 1-3.4-3.4c0-1.8 1.3-3.7 3.4-6.1Z" }),
					h("path", { d: "M6.7 9.3a1.8 1.8 0 0 0 1.4 1.3" })
				);
			}

			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: "liquid-glass-backdrop", order: 10 }, GlassLayer)
			);

			ctx.slots.inject("main", () =>
				ctx.slots.register({ name: "main", key: LG_PANEL_ID }, () => h(Guard, null, h(SettingsPanel)))
			);

			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: LG_PANEL_ID,
						order: 20,
						label: () => makeTranslate(snapshotLocale())("section")
					},
					LiquidGlassIcon
				)
			);
		}
