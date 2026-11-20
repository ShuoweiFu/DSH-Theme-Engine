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
				settings = normalize({ ...settings, ...patch });
				persistSettings(settings);
				for (const listener of settingsListeners) listener();
			};
			const subscribeSettings = (listener) => {
				settingsListeners.add(listener);
				return () => settingsListeners.delete(listener);
			};
			const useSettings = () => useSyncExternalStore(subscribeSettings, getSettings, getSettings);

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

			let wallpaper = { status: "idle", url: "", kind: "image", name: "", mtime: 0, bytes: 0, error: "", appsBehind: false, bench: 0 };
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
				// Layer 5: 'webgl' → 'css' (static glass) → 'off' (plugin disabled).
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

				useEffect(() => {
					const root = document.documentElement;
					root.dataset.lgEnabled = value.enabled ? "on" : "off";
					root.dataset.lgMode = mode;
					root.style.setProperty(
						"--lg-wallpaper",
						value.wallpaper && state.url && state.kind !== "video" ? `url("${state.url}")` : "none"
					);
					root.style.setProperty("--lg-blur", `${value.blur}px`);
					root.style.setProperty("--lg-sat", String(value.saturation));
					root.style.setProperty("--lg-dim", String(value.dim));
					root.style.setProperty("--lg-tint", String(value.tint));
					root.style.setProperty("--lg-fallback", mode === "dark" ? "#0b0e14" : "#eef1f6");
					root.dataset.lgBehind = appsBehind ? "on" : "off";
				}, [value, state.url, state.kind, mode, appsBehind]);

				// WebGL liquid wallpaper: owns its canvas under <body>.
				const liquidRef = useRef(null);
				const liquid = liquidRef.current;
				const wallpaperUrl = value.wallpaper && state.url ? state.url : "";
				const wallpaperKind = state.kind === "video" ? "video" : "image";

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

				// Layer 5: a lost context freezes WebGL and drops to static CSS glass;
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
						setDegrade("css");
						setNotice(translate("cssMode"));
						reportClientError("degrade: css", true);
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

				useEffect(() => {
					if (!value.enabled || degrade !== "webgl") return;
					const mode = value.renderMode;
					// CSS backend: no canvas at all; the stylesheet paints the wallpaper
					// behind a frosted #root (blur + tint, zero GPU shading). The flag has
					// to be flipped here too: a first load straight into CSS would
					// otherwise keep whatever the previous renderer left behind.
					if (mode === "css") {
						document.documentElement.dataset.lgWebgl = "off";
						return;
					}
					let cancelled = false;
					const liquid = mode === "webgpu" ? createWebGpuCanvas({ onFault, onInk }) : createLiquidCanvas({ onFault, onInk });
					if (!liquid) {
						reportClientError(`renderMode ${mode}: unavailable`, true);
						setSettings({ renderMode: "css" });
						setNotice(translate(mode === "webgpu" ? "webgpuUnavailable" : "cssMode"));
						return;
					}
					if (liquid.ready) {
						liquid.ready.then((ok) => {
							if (cancelled || ok) return;
							liquid.dispose();
							setSettings({ renderMode: "css" });
							setNotice(translate("webgpuUnavailable"));
						});
					}
					document.body.appendChild(liquid.canvas);
					liquidRef.current = liquid;
					activeRenderer = liquid;
					document.documentElement.dataset.lgWebgl = mode === "webgpu" ? "gpu" : "on";
					liquid.setParams({ sat: value.saturation, dim: value.dim, flow: value.flow, blur: value.blur });
					liquid.setTargetFps(value.fps);
					liquid.setAutoScale(value.autoScale);
					liquid.start();
					return () => {
						cancelled = true;
						liquid.dispose();
						liquidRef.current = null;
						if (activeRenderer === liquid) activeRenderer = null;
						if (document.documentElement.dataset.lgWebgl !== "off") {
							document.documentElement.dataset.lgWebgl = "off";
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
					liquidRef.current?.setParams({ sat: value.saturation, dim: value.dim, flow: value.flow, blur: value.blur });
				}, [value.saturation, value.dim, value.flow, value.blur]);

				// (Re)load the wallpaper texture whenever the fingerprint advances.
				useEffect(() => {
					if (!wallpaperUrl) return;
					liquidRef.current?.setWallpaper(wallpaperUrl, wallpaperKind);
				}, [wallpaperUrl, wallpaperKind]);

				// CSS mode has no renderer to report ink, so sample the same bitmap
				// here; the fetch is an ImageBitmap decode, not a GPU upload.
				useEffect(() => {
					if (value.renderMode !== "css" || degrade === "off" || !wallpaperUrl) return;
					let cancelled = false;
					(async () => {
						try {
							let source;
							if (wallpaperKind === "video") {
								source = await frameFromVideo(wallpaperUrl);
							} else {
								const response = await fetch(wallpaperUrl, { cache: "no-store" });
								if (!response.ok) return;
								source = await createImageBitmap(await response.blob());
							}
							if (!source || cancelled) return;
							onInk(measureInk(source));
							source.close?.();
						} catch {
							// Ink stays on the theme default.
						}
					})();
					return () => {
						cancelled = true;
					};
				}, [value.renderMode, degrade, wallpaperUrl, wallpaperKind, onInk]);

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
							return;
						}
						// Manual override wins, always: picking white text on a bright
						// wallpaper is the user's call, not ours. Only "auto" derives an
						// ink from the sample.
						let ink = value.ink;
						let veil = value.veil;
						if (ink !== "dark" && ink !== "light" && inkInfo) {
							const decided = decideInk(inkInfo.content ?? inkInfo.lum, value.tint, value.veil, currentMode() === "dark");
							ink = decided.ink;
							veil = decided.veil;
						}
						// The composer is its own surface: give it a ground that matches the
						// ink actually in use, so white text sits on dark glass and dark text
						// on light glass instead of both fighting the wallpaper.
						document.documentElement.style.setProperty(
							"--lg-composer-bg",
							ink === "light"
								? `rgba(12,14,20,${(0.42 + 0.33 * veil).toFixed(3)})`
								: `rgba(255,255,255,${(0.06 + 0.5 * veil).toFixed(3)})`
						);
						const next = glassTokens(value.tint, veil, ink);
						const signature = JSON.stringify(next);
						if (appliedRef.current && appliedRef.current.signature === signature) return;
						appliedRef.current?.dispose?.();
						appliedRef.current = { signature, dispose: api.overrideTokens(SOURCE, next) };
					} catch (error) {
						reportClientError(`overrideTokens: ${String(error?.stack ?? error)}`);
					}
				}, [value.enabled, value.tint, value.veil, value.ink, inkInfo]);

				useEffect(() => {
					if (!value.enabled || !value.wallpaper) {
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
						const query = `source=${encodeURIComponent(value.source)}&behind=${value.behind ? 1 : 0}`;
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
									kind: data.kind === "video" ? "video" : "image",
									name: typeof data.name === "string" ? data.name : "",
									mtime: typeof data.mtime === "number" ? data.mtime : 0,
									bytes: typeof data.bytes === "number" ? data.bytes : 0,
									appsBehind: data.appsBehind === true,
									bench: Number(data.bench) || 0,
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
			}, [value.enabled, value.wallpaper, value.source, value.behind]);

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
								blur: root.style.getPropertyValue("--lg-blur"),
								wallpaper: root.style.getPropertyValue("--lg-wallpaper").slice(0, 72),
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
								h("span", { className: "lg-warn-text" }, notice || t("cssMode")),
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
							"section",
							{ className: "lg-group" },
							h("h2", { className: "lg-group-title" }, t("perf")),
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
										onChange: (event) => {
											applyPreset(event.target.value);
										}
									},
									h("option", { value: "auto" }, t("presetAuto")),
									h("option", { value: "igpu" }, t("presetIgpu")),
									h("option", { value: "balanced" }, t("presetBalanced")),
									h("option", { value: "beast" }, t("presetBeast"))
								)
							),
							h("p", { className: "lg-group-hint" }, t("hardwareHint")),
							(value.fps === 0 || value.fps > (SAFE_FPS[hw.tier] ?? 30)) && (hw.tier === "igpu" || hw.tier === "unknown")
								? h("p", { className: "lg-group-hint", "data-warn": "on" }, `⚠ ${t("fpsWarn")}`)
								: null
						),
						h(
							"section",
							{ className: "lg-group" },
							h("h2", { className: "lg-group-title" }, t("look")),
							h(
								Row,
								{ label: t("wallpaper"), hint: t("wallpaperHint") },
								h(Switch, { on: value.wallpaper, onChange: (next) => setSettings({ wallpaper: next }), label: t("wallpaper") })
							),
							h(
								"div",
								{ className: "lg-row" },
								h("div", { className: "lg-label" }, h("span", null, t("source")), h("span", { className: "lg-hint" }, t("sourceHint"))),
								h(
									"select",
									{ className: "lg-select", value: value.source, onChange: (event) => setSettings({ source: event.target.value }) },
									h("option", { value: "desktop" }, t("sourceDesktop")),
									h("option", { value: "wallpaper" }, t("sourceWallpaper"))
								)
							),
							h(Slider, {
								label: t("blur"),
								value: value.blur,
								min: 0,
								max: 48,
								step: 1,
								display: `${value.blur} px`,
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
								display: `${Math.round(value.tint * 100)}%`,
								onChange: (next) => setSettings({ tint: next })
							}),
							h(Slider, {
								label: t("veil"),
								value: value.veil,
								min: 0,
								max: 1,
								step: 0.01,
								display: `${Math.round(value.veil * 100)}%`,
								onChange: (next) => setSettings({ veil: next })
							}),
							h("p", { className: "lg-group-hint" }, t("veilHint")),
							h(Slider, {
								label: t("dim"),
								value: value.dim,
								min: 0,
								max: 0.6,
								step: 0.01,
								display: `${Math.round(value.dim * 100)}%`,
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
						h(
							"section",
							{ className: "lg-group" },
							h("h2", { className: "lg-group-title" }, t("renderGroup")),
							h(
								Row,
								{ label: t("renderMode"), hint: t("renderModeHint") },
								h(
									"select",
									{ className: "lg-select", value: value.renderMode, onChange: (event) => setSettings({ renderMode: event.target.value }) },
									h("option", { value: "webgl" }, t("renderWebgl")),
									h("option", { value: "webgpu" }, t("renderWebgpu")),
									h("option", { value: "css" }, t("renderCss"))
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
								h("div", { className: "lg-fact" }, h("dt", null, "gap"), h("dd", null, perf && typeof perf.frameGap === "number" ? `${perf.frameGap}` : "—"))
							)
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
