window.__ModuleLoader__.load({
	id: "dsh-liquid-glass",
	factory: (require) => {
		const React = require("react");
		const ReactDOM = require("react-dom");
		const { createElement: h, Fragment, useCallback, useEffect, useEffect: useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

		const SOURCE = "dsh-liquid-glass";
		const STORAGE_KEY = "dsh-liquid-glass.settings.v3";
		const LEGACY_STORAGE_KEYS = ["dsh-liquid-glass.settings.v2"];
		const API = "/liquid-glass";
		/** Bumped whenever the mapping or the settings contract changes; visible via /liquid-glass/state. */
		const CLIENT_BUILD = "v.26.11.21.004441";
		const LOAD_TAG = String((globalThis.__lgLoadCount = (globalThis.__lgLoadCount || 0) + 1));
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
			renderMode: "webgl",
			behind: true,
			ink: "auto",
			preset: "auto"
		});

		/**
		 * One cap for both backends: above 1.5x the wallpaper is blurred by the
		 * shader anyway, so the extra fragments are invisible but the GPU still
		 * pays DPR² of them. WebGL used to cap at 1 while WebGPU capped at 2,
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
		 * compositing) — never the wallpaper, the look or the capture cadence the
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
		 * the overlay and then *used it in the panel's scope* — a ReferenceError on
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
		const zh = {
			section: "液态玻璃",
			close: "关闭",
			title: "液态玻璃",
			look: "外观",
			renderGroup: "渲染与状态",
			intro: "把桌面壁纸同步为 DSH 的背景，并让界面变成一层会流动的液态玻璃：面板与文字像悬空在壁纸上。",
			enable: "启用液态玻璃",
			enableHint: "关闭后立即恢复 DSH 原本的外观，设置会保留。",
			wallpaper: "同步桌面壁纸",
			wallpaperHint: "抓取当前桌面（含 Wallpaper Engine 动态壁纸）；窗口后面压着别的应用时，会把那个应用被遮住的部分一起合成进来。",
			blur: "背景模糊",
			saturation: "背景饱和",
			tint: "玻璃着色",
			veil: "霜面浓度",
			veilHint: "越低越通透（接近裸玻璃），越高越像磨砂玻璃；文字在亮壁纸上对比不足时，把它调高一点。",
			dim: "壁纸压暗",
			refresh: "背景更新速度",
			flow: "液态流动",
			flowHint: "壁纸折射、色散与高光的流动强度。",
			sourceLabel: "背景来源",
			sourceHint: "「真实桌面」按屏幕坐标 1:1 映射桌面（含图标）；「壁纸本体」只取壁纸原图，不含图标。",
			sourceDesktop: "真实桌面（含图标）",
			sourceWallpaper: "壁纸本体（无图标）",
			refreshNow: "立即刷新",
			reset: "恢复默认",
			status: "壁纸状态",
			ready: "已同步",
			missing: "未找到壁纸",
			error: "读取失败",
			off: "已关闭",
			unknown: "—",
			sourceValue: "来源",
			size: "大小",
			version: "版本",
			moveHint: "桌面上移动鼠标，可以看到玻璃上的高光跟随。",
			perf: "性能保护",
			fps: "最大帧率",
			fpsHint: "核显建议 30；「无限制」只在独显台式机上使用。",
			autoScale: "自动降分辨率",
			renderMode: "渲染引擎",
			renderModeHint: "WebGL 兼容最好；WebGPU 需要显卡/浏览器支持。两种模式都由 Shader 完成高斯模糊。",
			renderWebgl: "WebGL（推荐）",
			renderWebgpu: "WebGPU（实验）",
			webgpuUnavailable: "此环境不支持 WebGPU，已自动切回 WebGL。",
			autoScaleHint: "帧时间过高时降低着色器分辨率保命，流畅后自动恢复。",
			unlimited: "无限制",
			staticMode: "显卡渲染异常：已切换为静态半透明遮罩兜底。冷却后点「重新尝试」恢复液态玻璃。",
			contextLost: "检测到显卡驱动重置，已切换为静态玻璃（保命模式）。",
			autoDisabled: "连续两次显卡异常，已自动关闭液态玻璃。确认机器冷却后再手动开启。",
			retry: "重新尝试",
			noticeClose: "知道了",
			renderer: "渲染模式",
			running: "流动中",
			idleState: "按需渲染",
			pausedState: "已暂停",
			frozen: "冻结（静态）",
			scale: "渲染分辨率",
			frames: "累计帧",
			hardware: "显卡",
			hardwareHint: "启动时静默读取（WEBGL_debug_renderer_info），只用于选择性能档位，不会上传到任何地方。",
			preset: "智能预设",
			presetHint: "按显卡自动选择性能档位；切换只改帧率/引擎/分辨率上限，不会动你的壁纸与观感设置。",
			presetAuto: "自动（跟随显卡）",
			presetIgpu: "核显保命档",
			presetBalanced: "独显均衡档",
			presetBeast: "火神狂暴档",
			tier_igpu: "核显",
			tier_balanced: "入门独显",
			tier_beast: "高端独显",
			tier_unknown: "未知显卡",
			igpuNotice: "检测到核显，已为你开启性能保护模式：30 帧、自动降分辨率。",
			balancedNotice: "检测到独立显卡，已启用均衡模式：60 帧 + 自动降分辨率。",
			beastNotice: "检测到高性能显卡，已启用狂暴模式：WebGPU + 高阶帧率。",
			presetClamped: "该档位超出显卡安全范围，已自动回落到保护配置。",
			fpsWarn: "核显超过 40 帧只会更烫，不会更顺滑。",
			behind: "合成被遮挡的窗口",
			behindHint: "开启后，窗口后面压着的应用会被一起拍进背景，玻璃里能透出它们（每次抓取多花 0.3–0.8 秒）；关掉只保留桌面底图。",
			ink: "文字颜色",
			inkHint: "按背景亮度自动切换黑/白文字；手动选择会被尊重，不再被改写",
			inkAuto: "自动（按背景亮度）",
			inkDark: "深色文字",
			inkLight: "浅色文字",
		};
		const en = {
			section: "Liquid Glass",
			close: "Close",
			title: "Liquid Glass",
			look: "Appearance",
			renderGroup: "Rendering & status",
			intro: "Mirror the desktop wallpaper behind DeepSeek Harness and turn every surface into flowing liquid glass, so panels and text appear to float on the wallpaper.",
			enable: "Enable Liquid Glass",
			enableHint: "Turning this off restores the stock look immediately; settings are kept.",
			wallpaper: "Sync desktop wallpaper",
			wallpaperHint: "Captures the live desktop (Wallpaper Engine included); when another app sits behind this window, the occluded part of that app is composited in too.",
			blur: "Background blur",
			saturation: "Background saturation",
			tint: "Glass tint",
			veil: "Frost density",
			veilHint: "Lower is clearer (bare glass), higher is more frosted; raise it a little when text is hard to read over a bright wallpaper.",
			dim: "Wallpaper dim",
			refresh: "Background refresh",
			flow: "Liquid flow",
			flowHint: "Strength of the refraction, dispersion and moving highlights.",
			sourceLabel: "Background source",
			sourceHint: "Real desktop maps the desktop 1:1 in screen space (icons included); Wallpaper only takes the icon-free wallpaper picture.",
			sourceDesktop: "Real desktop (icons)",
			sourceWallpaper: "Wallpaper only (no icons)",
			refreshNow: "Refresh now",
			reset: "Reset",
			status: "Wallpaper status",
			ready: "Synced",
			missing: "No wallpaper found",
			error: "Read failed",
			off: "Disabled",
			unknown: "—",
			sourceValue: "Source",
			size: "Size",
			version: "Version",
			moveHint: "Move the pointer over the window to see the glass highlights follow.",
			perf: "Performance guard",
			fps: "Max frame rate",
			fpsHint: "30 is the safe choice on integrated GPUs; use unlimited only on a discrete desktop GPU.",
			autoScale: "Dynamic resolution",
			renderMode: "Renderer",
			renderModeHint: "WebGL is the most compatible; WebGPU needs GPU/browser support. Both run their Gaussian blur in the shader.",
			renderWebgl: "WebGL (recommended)",
			renderWebgpu: "WebGPU (experimental)",
			webgpuUnavailable: "WebGPU is unavailable here; switched back to WebGL.",
			autoScaleHint: "Drops the shader resolution when frame times spike, and restores it when smooth again.",
			unlimited: "Unlimited",
			staticMode: "Graphics failure: switched to the static translucent fallback. When the machine cools down, press Retry to restore liquid glass.",
			contextLost: "The graphics driver reset; switched to static glass (fail-safe mode).",
			autoDisabled: "The GPU failed twice, so liquid glass was disabled automatically. Re-enable it after the machine cools down.",
			retry: "Retry",
			noticeClose: "Got it",
			renderer: "Renderer",
			running: "Flowing",
			idleState: "On demand",
			pausedState: "Paused",
			frozen: "Frozen (static)",
			scale: "Resolution",
			frames: "Frames",
			hardware: "GPU",
			hardwareHint: "Read silently at startup (WEBGL_debug_renderer_info) only to pick a performance profile; it never leaves the machine.",
			preset: "Smart preset",
			presetHint: "Picks a performance profile from the detected GPU; switching only touches frame rate, engine and resolution caps, not your wallpaper or look.",
			presetAuto: "Auto (follow GPU)",
			presetIgpu: "Integrated (safe)",
			presetBalanced: "Discrete (balanced)",
			presetBeast: "High-end (unleashed)",
			tier_igpu: "Integrated",
			tier_balanced: "Entry discrete",
			tier_beast: "High-end discrete",
			tier_unknown: "Unknown GPU",
			igpuNotice: "Integrated GPU detected. Performance guard enabled: 30 fps, dynamic resolution.",
			balancedNotice: "Discrete GPU detected. Balanced mode enabled: 60 fps with dynamic resolution.",
			beastNotice: "High-end GPU detected. Unleashed mode enabled: WebGPU with a high frame cap.",
			presetClamped: "That profile exceeds your GPU's safe range, so it was reset to the protective configuration.",
			fpsWarn: "Above 40 fps an integrated GPU only gets hotter, not smoother.",
			behind: "Composite occluded windows",
			behindHint: "When on, apps sitting behind the window are captured into the background too, so the glass shows them (+0.3–0.8 s per capture); off keeps only the desktop.",
			ink: "Text colour",
			inkHint: "Picks black or white text from the background; a manual choice is respected and never rewritten",
			inkAuto: "Auto (by background)",
			inkDark: "Dark text",
			inkLight: "Light text",
		};

		function dictFor(lang) {
			return String(lang || "").toLowerCase().startsWith("zh") ? zh : en;
		}

		function makeTranslate(lang) {
			const dict = dictFor(lang);
			return (key) => dict[key] ?? key;
		}
		function normalize(raw) {
			const source = raw && typeof raw === "object" ? raw : {};
			const num = (value, fallback, min, max) => {
				const parsed = typeof value === "number" ? value : Number.parseFloat(value);
				return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
			};
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
				source: source.source === "wallpaper" ? "wallpaper" : "desktop",
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
		function frameFromVideo(url) {
			return new Promise((resolve, reject) => {
				const video = document.createElement("video");
				video.muted = true;
				video.playsInline = true;
				video.preload = "auto";
				video.crossOrigin = "anonymous";
				let settled = false;
				const timer = setTimeout(() => fail(new Error("video frame timeout")), 20_000);
				function cleanup() {
					video.removeAttribute("src");
					try {
						video.load();
					} catch {
						// Detaching an already detached element is harmless.
					}
					video.remove();
				}
				function fail(error) {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					cleanup();
					reject(error instanceof Error ? error : new Error("video frame failed"));
				}
				video.addEventListener("error", () => fail(new Error("video decode failed")), { once: true });
				video.addEventListener(
					"loadedmetadata",
					() => {
						const duration = Number.isFinite(video.duration) ? video.duration : 0;
						const target = duration > 2 ? Math.min(duration - 0.4, Math.max(0.6, duration * 0.18)) : 0;
						video.addEventListener(
							"seeked",
							() => {
								try {
									const widest = Math.max(video.videoWidth, video.videoHeight);
									const scale = Math.min(1, 2048 / Math.max(1, widest));
									const snapshot = document.createElement("canvas");
									snapshot.width = Math.max(1, Math.round(video.videoWidth * scale));
									snapshot.height = Math.max(1, Math.round(video.videoHeight * scale));
									snapshot.getContext("2d").drawImage(video, 0, 0, snapshot.width, snapshot.height);
									if (settled) return;
									settled = true;
									clearTimeout(timer);
									cleanup();
									resolve(snapshot);
								} catch (error) {
									fail(error);
								}
							},
							{ once: true }
						);
						try {
							video.currentTime = target;
						} catch (error) {
							fail(error);
						}
					},
					{ once: true }
				);
				video.src = url;
				video.load();
			});
		}

		/**
		 * Average luminance of the wallpaper behind the window, plus how busy it
		 * is. Sampled from the same bitmap that becomes the texture, so it costs
		 * one 24x24 draw per wallpaper update and never touches the GPU loop.
		 * `content` measures the column where the chat text lives; `busy` is the
		 * standard deviation of the whole frame.
		 */
		function measureInk(source) {
			try {
				const size = 24;
				// The sidebar can be collapsed, icon-rail or expanded, so a fixed
				// 24% cut sampled the wrong pixels in two of those states. Measure
				// the real scrollport; fall back to the old 24% when it is hidden.
				const scrollport = document.querySelector("[data-sidebar-scrollport]");
				const sidebarWidth = scrollport?.getBoundingClientRect?.().width ?? 0;
				const viewport = window.innerWidth || 0;
				const contentStart =
					viewport > 0 && sidebarWidth > 0 ? Math.min(0.45, Math.max(0.16, sidebarWidth / viewport)) : 0.24;
				const probe = document.createElement("canvas");
				probe.width = size;
				probe.height = size;
				const ctx = probe.getContext("2d", { willReadFrequently: true });
				if (!ctx) return null;
				ctx.drawImage(source, 0, 0, size, size);
				const { data } = ctx.getImageData(0, 0, size, size);
				let sum = 0;
				let sum2 = 0;
				let contentSum = 0;
				let contentN = 0;
				for (let y = 0; y < size; y += 1) {
					for (let x = 0; x < size; x += 1) {
						const i = (y * size + x) * 4;
						const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
						sum += l;
						sum2 += l * l;
						if (x / size >= contentStart) {
							contentSum += l;
							contentN += 1;
						}
					}
				}
				const n = size * size;
				const mean = sum / n;
				return {
					lum: Number(mean.toFixed(3)),
					content: Number((contentSum / Math.max(1, contentN)).toFixed(3)),
					busy: Number(Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3))
				};
			} catch {
				return null;
			}
		}
		// Shared darkness thresholds. 06-guard rejects a frame that drops below
		// BLACK_LUM after a bright one; anything above RECOVER_LUM counts as a
		// real bright frame. Kept here so the guard and the ink sampler cannot
		// drift apart again (they used to disagree about what "black" means).
		const BLACK_LUM = 0.05;
		const RECOVER_LUM = 0.12;

		/** sRGB channel → linear light, per WCAG 2.1 relative luminance. */
		function linearize(channel) {
			const c = Math.min(1, Math.max(0, channel));
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		}

		/** Contrast ratio between two relative luminances (1 … 21). */
		function contrastRatio(a, b) {
			const hi = Math.max(a, b);
			const lo = Math.min(a, b);
			return (hi + 0.05) / (lo + 0.05);
		}

		/** WCAG relative luminance of a raw `r,g,b` triple in 0…255. */
		function relativeLum(r, g, b) {
			return 0.2126 * linearize(r / 255) + 0.7152 * linearize(g / 255) + 0.0722 * linearize(b / 255);
		}

		/** Inverse of `linearize`, so a required luminance can become an alpha. */
		function encodeLum(lum) {
			const value = Math.min(1, Math.max(0, lum));
			return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
		}

		/**
		 * Decides the ink colour *and* how dense the frost has to be.
		 *
		 * Picking black or white by WCAG contrast is not enough on a busy desktop:
		 * 5:1 white-on-grey still reads as a smudge when icons sit behind the text.
		 * So the column targets 7:1 — if the current frost cannot reach it, the
		 * frost is thickened just enough for the chosen ink. The slider keeps the
		 * user's own look as a floor; the auto value can only add density.
		 */
		function decideInk(contentLum, tint, veil, darkTheme) {
			const blackInk = relativeLum(12, 14, 20);
			const whiteInk = relativeLum(246, 248, 252);
			// Surface colour of the frost itself: white in light mode, near-black
			// in dark mode (matches --dsw-alias-bg-base for each theme).
			const surfaceEnc = darkTheme ? 0.1 : 1;
			const target = 7;
			const alphaFor = (inkLum, wantDarkInk) => {
				// Contrast against the black ink needs a bright backdrop; against the
				// white ink it needs a dark one.
				const needLum = wantDarkInk ? target * (inkLum + 0.05) - 0.05 : (inkLum + 0.05) / target - 0.05;
				const needEnc = encodeLum(needLum);
				if (!Number.isFinite(needEnc)) return 1;
				const span = surfaceEnc - contentLum;
				if (Math.abs(span) < 0.02) return 0.85;
				// The frost can only push the backdrop towards the surface colour:
				// white ink over a bright wallpaper is unreachable no matter how
				// dense the veil gets, so that option is reported as infeasible.
				if (wantDarkInk ? span < 0 : span > 0) return 1;
				return Math.min(0.9, Math.max(0, (needEnc - contentLum) / span));
			};
			const darkAlpha = alphaFor(blackInk, true);
			const lightAlpha = alphaFor(whiteInk, false);
			const useDark = darkAlpha <= lightAlpha;
			const ink = useDark ? "dark" : "light";
			const alpha = useDark ? darkAlpha : lightAlpha;
			// The tokens derive the column alpha as `(0.02 + 0.45 * veil) *
			// (0.9 + 0.2 * tint)`; invert that so the decision can name a veil.
			const tintLift = 0.9 + 0.2 * tint;
			const floor = darkTheme ? 0.05 : 0.02;
			const neededVeil = Math.min(1, Math.max(0, (alpha / tintLift - floor) / 0.45));
			return { ink, veil: Math.max(veil, neededVeil) };
		}
				/**
		 * Second line of defence behind the host luminance check. A capture can
		 * still land black (a compositor pause, a decoder hiccup, the PowerShell
		 * fallback): swapping such a frame in shows up as the whole glass blinking
		 * black, so a near-black frame is refused while a bright one is on screen
		 * and the previous texture stays.
		 *
		 * `accepted` records the last frame that was actually shown and is not
		 * updated for a refused frame — otherwise the next near-black frame would be
		 * compared against black and pass. After two refusals the third frame is
		 * believed, so switching to a dark wallpaper is not fought forever.
		 */
		const blackWatch = { accepted: -1, last: -1, skips: 0 };
		function isBlackSwap(sample) {
			const lum = Number(sample?.lum);
			if (!Number.isFinite(lum)) return false;
			blackWatch.last = lum;
			const previous = blackWatch.accepted;
			if (lum < BLACK_LUM && previous > RECOVER_LUM && blackWatch.skips < 2) {
				blackWatch.skips += 1;
				return true;
			}
			blackWatch.skips = 0;
			blackWatch.accepted = lum;
			return false;
		}

		function currentMode() {
			if (document.body?.hasAttribute("data-ds-dark-theme")) return "dark";
			return "light";
		}

		function formatBytes(bytes) {
			if (!bytes || bytes <= 0) return "—";
			const units = ["B", "KB", "MB", "GB"];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
		}

		let reportedAt = 0;

		/** Forward client-side failures to the host so they survive a reload.
		 * Returns false when the throttle swallowed the message, so callers that
		 * dedupe on a signature know to retry instead of losing the report. */
		function reportClientError(message, urgent = false) {
			try {
				const now = Date.now();
				if (!urgent && now - reportedAt < 1500) return false;
				reportedAt = now;
				const text = encodeURIComponent(String(message).slice(0, 3500));
				void fetch(`${API}/log?msg=${text}`, { credentials: "same-origin" }).catch(() => {});
				return true;
			} catch {
				// Diagnostics are best effort.
				return false;
			}
		}

		/** Keeps one failing overlay from deactivating the whole slot entry. */
		class Guard extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: String(error?.message ?? error) };
			}

			componentDidCatch(error) {
				reportClientError(`overlay: ${String(error?.stack ?? error)}`);
			}

			render() {
				return this.state.error ? null : this.props.children;
			}
		}
		const CSS = String.raw`
:root {
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
		const VERTEX_SHADER = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }";

		const FRAGMENT_SHADER = String.raw`
precision highp float;
uniform vec2 uRes;
uniform vec2 uScreen;
uniform vec2 uWin;
uniform float uScale;
uniform float uDpr;
uniform vec2 uTexRes;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uBlend;
uniform float uTime;
uniform float uSat;
uniform float uDim;
uniform float uFlow;
uniform float uRipple;
uniform vec2 uMouse;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

// Two octaves only: on an iGPU the third and fourth octave are invisible after
// the blur prepass but cost 2x the noise instructions per pixel.
float fbm(vec2 p) {
	float value = 0.5 * noise(p);
	value += 0.25 * noise(p * 2.03);
	return value;
}

void main() {
	vec2 frag = gl_FragCoord.xy;

	// Screen-space mapping: this fragment shows a real desktop pixel, so the
	// picture behind the window matches the wallpaper around it instead of
	// being stretched over the window rectangle. Everything is computed in CSS
	// pixels so dynamic resolution scaling cannot shift the picture.
	vec2 fragCss = frag / uScale;
	vec2 screenUv = (uWin + fragCss) / uScreen;
	vec2 screenDev = uScreen * uDpr;
	float cover = max(screenDev.x / uTexRes.x, screenDev.y / uTexRes.y);
	// gl_FragCoord counts upwards from the bottom; texture rows count from the
	// top, so flip V here instead of relying on UNPACK_FLIP_Y_WEBGL (which
	// Chromium ignores for ImageBitmap uploads).
	screenUv.y = 1.0 - screenUv.y;
	vec2 uv = (screenUv - 0.5) * (screenDev / (uTexRes * cover)) + 0.5;

	float t = uTime;
	vec2 p = uv * vec2(uTexRes.x / uTexRes.y, 1.0) * 2.0;

	// Liquid domain warp. This is the original 0.8 "liquid" amount: the picture
	// swims like water and icons bend slightly, which is the look the glass was
	// designed around. The sharper 1.2% variant read as flat glass.
	float n = fbm(p + vec2(t * 0.03, -t * 0.02));
	float n2 = fbm(p * 1.3 + vec2(-t * 0.025, t * 0.03) + n);
	vec2 warp = vec2(n - 0.5, n2 - 0.5) * 0.05 * uFlow;

	// Ripple around the pointer. uRipple is 0 whenever the cursor is parked, so
	// the sin/exp pair is skipped entirely (branch coherency: whole-screen skip).
	vec2 rippled = uv;
	if (uRipple > 0.001) {
		vec2 delta = uv - uMouse;
		float dist = length(delta) + 1e-4;
		float ripple = sin(dist * 26.0 - t * 2.2) * exp(-dist * 5.0) * 0.012 * uFlow * uRipple;
		rippled += (delta / dist) * ripple;
	}

	vec2 fuv = clamp(rippled + warp, 0.002, 0.998);

	// Chromatic dispersion: the "thick glass" look. The texture is already
	// blurred by the prepass, so this is one cheap tap per channel. At rest the
	// split collapses, which saves two dependent texture fetches per pixel.
	vec2 ca = (fuv - 0.5) * 0.004 * step(0.02, uFlow);
	vec3 color;
	color.r = texture2D(uTex, clamp(fuv + ca, 0.002, 0.998)).r;
	color.g = texture2D(uTex, fuv).g;
	color.b = texture2D(uTex, clamp(fuv - ca, 0.002, 0.998)).b;
	// Cross-fade after a wallpaper swap: a 1.1 s recapture otherwise lands as a
	// visible jump every time, even when only a caret moved on the desktop.
	if (uBlend < 0.999) {
		vec3 before = texture2D(uPrev, fuv).rgb;
		color = mix(before, color, uBlend);
	}

	// Slow caustics: two crossing sines read as slow water. This is the analytic
	// 0.11 form the user asked for by name; the *strength* stays at the 0.8 value
	// (0.22) because 0.11's 0.055 multiplied the water away.
	float caustic = 0.5 + 0.5 * sin(p.x * 1.7 + t * 0.9) * sin(p.y * 1.3 - t * 0.7);
	color *= 0.9 + caustic * 0.22 * uFlow + (1.0 - uFlow) * 0.05;

	// A slow specular band sweeping diagonally.
	float band = smoothstep(0.36, 0.56, abs(sin((uv.x + uv.y * 0.6) * 3.2 - t * 0.35)));
	color += band * 0.03 * uFlow;

	float luma = dot(color, vec3(0.299, 0.587, 0.114));
	color = mix(vec3(luma), color, uSat);
	color *= 1.0 - uDim * 0.85;

	gl_FragColor = vec4(color, 1.0);
}
`;

		// 13-tap poisson-disc Gaussian, normalised so repeated passes cannot
		// accumulate brightness (an unnormalised kernel used to gain ~19% per
		// pass). Offsets: centre, 4 axis at 1.41r, 4 diagonal at 1r, 4 axis at
		// 2.2r. The renderer runs this one kernel 1–4 times (ping-pong) so the
		// same 13 taps stay smooth all the way to a 48 px slider position.
		const BLUR_FRAGMENT_SHADER = String.raw`
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
	vec2 uv = gl_FragCoord.xy * uTexel;
	vec2 r = uTexel * uRadius;
	vec3 color = texture2D(uTex, uv).rgb * 0.1370;
	color += texture2D(uTex, uv + vec2(r.x * 1.41, 0.0)).rgb * 0.1044;
	color += texture2D(uTex, uv - vec2(r.x * 1.41, 0.0)).rgb * 0.1044;
	color += texture2D(uTex, uv + vec2(0.0, r.y * 1.41)).rgb * 0.1044;
	color += texture2D(uTex, uv - vec2(0.0, r.y * 1.41)).rgb * 0.1044;
	color += texture2D(uTex, uv + vec2(r.x, r.y)).rgb * 0.0820;
	color += texture2D(uTex, uv - vec2(r.x, r.y)).rgb * 0.0820;
	color += texture2D(uTex, uv + vec2(r.x, -r.y)).rgb * 0.0820;
	color += texture2D(uTex, uv - vec2(r.x, -r.y)).rgb * 0.0820;
	color += texture2D(uTex, uv + vec2(r.x * 2.2, 0.0)).rgb * 0.0294;
	color += texture2D(uTex, uv - vec2(r.x * 2.2, 0.0)).rgb * 0.0294;
	color += texture2D(uTex, uv + vec2(0.0, r.y * 2.2)).rgb * 0.0294;
	color += texture2D(uTex, uv - vec2(0.0, r.y * 2.2)).rgb * 0.0294;
	gl_FragColor = vec4(color, 1.0);
}
`;

		function compileShader(gl, type, source) {
			const shader = gl.createShader(type);
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				const info = gl.getShaderInfoLog(shader);
				gl.deleteShader(shader);
				throw new Error(`liquid-glass shader: ${info}`);
			}
			return shader;
		}
		/**
		 * Owns the WebGL canvas that paints the liquid wallpaper and its five
		 * protection layers: visibility/focus circuit breaker, frame-rate
		 * throttle, dynamic resolution, render-on-demand, and a context-lost
		 * escape hatch that drops to a static translucent scrim.
		 */
		// WebGPU backend: the same screen-space liquid pipeline, written in WGSL.
		// It keeps the WebGL renderer's contract (start/stop/pause/fps/DRS) so the
		// protection layers work unchanged; any setup failure returns null and the
		// caller degrades to a static translucent scrim.
		function createWebGpuCanvas(options = {}) {
			const onFault = typeof options.onFault === "function" ? options.onFault : () => {};
			const onInk = typeof options.onInk === "function" ? options.onInk : null;
			// Per preset: the caller passes high-performance for the high-end
			// profile and low-power for integrated/unknown hardware. Hard-coding
			// low-power made a discrete GPU run the glass on the iGPU.
			const powerPreference = options.powerPreference ?? "low-power";
			if (!navigator.gpu) return null;
			const canvas = document.createElement("canvas");
			canvas.setAttribute("aria-hidden", "true");
			canvas.dataset.liquidGlass = "gpu";
			Object.assign(canvas.style, {
				position: "fixed",
				inset: "0",
				width: "100%",
				height: "100%",
				zIndex: "-2",
				pointerEvents: "none",
				display: "block",
				opacity: "0",
				transition: "opacity 420ms ease"
			});
			const SCALES = [1, 0.8, 0.65, 0.5];
			let device = null;
			let context = null;
			let pipeline = null;
			let bindGroup = null;
			let uniformBuffer = null;
			let texture = null;
			let sampler = null;
			let textureVersion = 0;
			let blurPipeline = null;
			let blurUniformBuffer = null;
			let wallpaperView = null;
			let blurA = null;
			let blurB = null;
			let blurAView = null;
			let blurBView = null;
			let blurKey = "";
			const blurUniforms = new Float32Array(4);
			let running = false;
			let disposed = false;
			let shown = false;
			let frame = 0;
			let lastTick = 0;
			let lastRender = 0;
			let frames = 0;
			let slow = 0;
			let fast = 0;
			let scaleIndex = 1;
			let mouse = { x: 0.5, y: 0.5 };
			const params = { flow: 0.9, sat: 1.4, dim: 0.08, tint: 0.55, blur: 0 };
			const perf = { targetFps: 30, autoScale: true, idle: false, paused: new Set(), frames: 0, ms: 0 };
			const uniforms = new Float32Array(16);
			const vertexShader = `
struct Uniforms {
  time: f32, mx: f32, my: f32, scrW: f32,
  scrH: f32, winX: f32, winY: f32, texW: f32,
  texH: f32, flow: f32, sat: f32, dim: f32,
  tint: f32, dpr: f32, vpW: f32, vpH: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) frag: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.frag = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}
fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // CSS viewport, not texture size: the wallpaper is capped at 2048 px, so
  // deriving the CSS coordinate from res/cScale shifted and stretched the
  // desktop mapping whenever the texture and the canvas differed in size.
  let fragCss = in.frag * vec2<f32>(u.vpW, u.vpH);
  let screenUv = (vec2<f32>(u.winX, u.winY) + fragCss) / vec2<f32>(u.scrW, u.scrH);
  let screenDev = vec2<f32>(u.scrW, u.scrH) * u.dpr;
  let cover = max(screenDev.x / u.texW, screenDev.y / u.texH);
  var uv = (screenUv - vec2<f32>(0.5)) * (screenDev / (vec2<f32>(u.texW, u.texH) * cover)) + vec2<f32>(0.5);
  uv.y = 1.0 - uv.y;
  let t = u.time;
  let w1 = noise(uv * 3.1 + vec2<f32>(t * 0.05, t * 0.04));
  let w2 = noise(uv * 5.7 - vec2<f32>(t * 0.07, t * 0.03));
  let warp = (vec2<f32>(w1, w2) - vec2<f32>(0.5)) * 0.05 * u.flow;
  let m = vec2<f32>(u.mx - uv.x, u.my - uv.y);
  let d = length(m) + 0.0001;
  let ripple = sin(d * 34.0 - t * 2.4) * exp(-d * 9.0) * 0.012 * u.flow;
  uv += warp + (m / d) * ripple;
  let ca = (uv - vec2<f32>(0.5)) * 0.004;
  var col = vec3<f32>(
    textureSample(tex, samp, uv + ca).r,
    textureSample(tex, samp, uv).g,
    textureSample(tex, samp, uv - ca).b
  );
  let p = uv * vec2<f32>(u.texW / u.texH, 1.0) * 2.0;
  let caustic = 0.5 + 0.5 * sin(p.x * 1.7 + t * 0.9) * sin(p.y * 1.3 - t * 0.7);
  col *= 0.9 + caustic * 0.22 * u.flow + (1.0 - u.flow) * 0.05;
  let band = smoothstep(0.36, 0.56, abs(sin((uv.x + uv.y * 0.6) * 3.2 - t * 0.35)));
  col += vec3<f32>(band * 0.03 * u.flow);
  col = mix(col, vec3<f32>(0.98, 0.98, 1.0), u.tint * 0.06);
  col = (col - vec3<f32>(0.5)) * u.sat + vec3<f32>(0.5);
  col *= 1.0 - u.dim;
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}`;

			// 13-tap poisson-disc Gaussian for the WebGPU prepass, numerically the
			// same kernel as BLUR_FRAGMENT_SHADER in 08-shaders.js: centre 0.1370,
			// four axes at 1.41r 0.1044, four diagonals at 1r 0.0820, four axes at
			// 2.2r 0.0294 (sum 1.0002, so repeated passes cannot gain brightness).
			// The renderer ping-pongs this one kernel 1–4 times, which is what keeps
			// a 48 px slider smooth instead of a clamped, banded smear.
			const blurShader = `
struct BlurU { texel: vec2<f32>, radius: f32, pad: f32 };
@group(0) @binding(0) var<uniform> b: BlurU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}
fn tap(uv: vec2<f32>, off: vec2<f32>) -> vec3<f32> {
  return textureSample(src, samp, uv + off * b.texel * b.radius).rgb;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  var col = tap(uv, vec2<f32>(0.0, 0.0)) * 0.1370;
  col += tap(uv, vec2<f32>(1.41, 0.0)) * 0.1044;
  col += tap(uv, vec2<f32>(-1.41, 0.0)) * 0.1044;
  col += tap(uv, vec2<f32>(0.0, 1.41)) * 0.1044;
  col += tap(uv, vec2<f32>(0.0, -1.41)) * 0.1044;
  col += tap(uv, vec2<f32>(1.0, 1.0)) * 0.0820;
  col += tap(uv, vec2<f32>(-1.0, -1.0)) * 0.0820;
  col += tap(uv, vec2<f32>(1.0, -1.0)) * 0.0820;
  col += tap(uv, vec2<f32>(-1.0, 1.0)) * 0.0820;
  col += tap(uv, vec2<f32>(2.2, 0.0)) * 0.0294;
  col += tap(uv, vec2<f32>(-2.2, 0.0)) * 0.0294;
  col += tap(uv, vec2<f32>(0.0, 2.2)) * 0.0294;
  col += tap(uv, vec2<f32>(0.0, -2.2)) * 0.0294;
  return vec4<f32>(col, 1.0);
}
`;

			function geometry() {
				const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
				const frameY = Math.max(0, window.outerHeight - window.innerHeight);
				const screenH = window.screen.height || window.innerHeight;
				return {
					winX: window.screenX + frameX,
					winY: Math.max(0, screenH - (window.screenY + frameY + window.innerHeight)),
					scrW: window.screen.width || window.innerWidth,
					scrH: screenH,
					dpr: window.devicePixelRatio || 1
				};
			}
			function resize() {
				const ratio = Math.min(DPR_CAP, (window.devicePixelRatio || 1) * SCALES[scaleIndex]);
				const w = Math.max(2, Math.round(window.innerWidth * ratio));
				const h = Math.max(2, Math.round(window.innerHeight * ratio));
				if (canvas.width !== w || canvas.height !== h) {
					canvas.width = w;
					canvas.height = h;
				}
				return w / Math.max(1, window.innerWidth);
			}
			function makeBlurTargets(width, height) {
				if (blurA && blurA.width === width && blurA.height === height) return;
				for (const tex of [blurA, blurB]) {
					try { tex?.destroy(); } catch { /* already gone */ }
				}
				const make = () =>
					device.createTexture({
						size: [width, height],
						format: "rgba8unorm",
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
					});
				blurA = make();
				blurB = make();
				blurAView = blurA.createView();
				blurBView = blurB.createView();
				blurKey = "";
			}
			function blurBindGroup(view) {
				return device.createBindGroup({
					layout: blurPipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: blurUniformBuffer } },
						{ binding: 1, resource: sampler },
						{ binding: 2, resource: view }
					]
				});
			}
			/**
			 * Encode the blur prepass and return the view the main pass samples.
			 * Same mapping as the WebGL renderer: the slider is in CSS pixels, the
			 * target radius is in wallpaper texels, and the pass count grows with
			 * it so every individual 13-tap pass keeps its radius inside the
			 * kernel's well-sampled range.
			 */
			function runBlur(encoder) {
				if (!blurPipeline || !blurUniformBuffer || !texture) return null;
				if (params.blur <= 0.5) return wallpaperView;
				const width = texture.width;
				const height = texture.height;
				makeBlurTargets(width, height);
				const pixelScale = width / Math.max(1, window.innerWidth);
				const targetRadius = Math.min(36, Math.max(1.2, params.blur * pixelScale * 0.9));
				const passes = Math.max(1, Math.min(4, Math.ceil(targetRadius / 9)));
				const radius = Math.max(1.2, Math.min(10, targetRadius / passes));
				blurUniforms[0] = 1 / width;
				blurUniforms[1] = 1 / height;
				blurUniforms[2] = radius;
				blurUniforms[3] = 0;
				device.queue.writeBuffer(blurUniformBuffer, 0, blurUniforms);
				let source = wallpaperView;
				for (let pass = 0; pass < passes; pass++) {
					const dest = pass % 2 === 0 ? blurAView : blurBView;
					const command = encoder.beginRenderPass({
						colorAttachments: [{
							view: dest,
							clearValue: { r: 0, g: 0, b: 0, a: 1 },
							loadOp: "clear",
							storeOp: "store"
						}]
					});
					command.setPipeline(blurPipeline);
					command.setBindGroup(0, blurBindGroup(source));
					command.draw(3);
					command.end();
					source = dest;
				}
				return source;
			}
			function bindDisplay(view) {
				bindGroup = device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: sampler },
						{ binding: 2, resource: view }
					]
				});
			}
			function frameInterval() {
				return perf.targetFps > 0 ? 1000 / perf.targetFps : 0;
			}
			function paused() {
				return perf.paused.size > 0 || perf.idle || disposed;
			}
			function stopFrames() {
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
			}
			function schedule() {
				if (paused() || !running || frame) return;
				frame = requestAnimationFrame(tick);
			}
			function adapt(gap) {
				if (!perf.autoScale || !document.hasFocus() || document.visibilityState !== "visible" || gap > 1000) return;
				if (gap > 34) {
					slow += 1; fast = 0;
					if (slow >= 10 && scaleIndex < SCALES.length - 1) { scaleIndex += 1; slow = 0; }
				} else if (gap < 22) {
					fast += 1; slow = 0;
					// At 40 fps or below, full resolution buys nothing visible but
					// doubles the fragment count, so 0.8 is the ceiling there.
					const topIndex = perf.targetFps > 0 && perf.targetFps <= 40 ? 1 : 0;
					if (fast >= 300 && scaleIndex > topIndex) { scaleIndex -= 1; fast = 0; }
				}
			}
			function draw(now) {
				if (!device || !context || !pipeline) return;
				const g = geometry();
				uniforms[0] = (now || performance.now()) / 1000;
				uniforms[1] = mouse.x; uniforms[2] = mouse.y;
				uniforms[3] = g.scrW; uniforms[4] = g.scrH;
				uniforms[5] = g.winX; uniforms[6] = g.winY;
				uniforms[7] = texture ? texture.width : 1; uniforms[8] = texture ? texture.height : 1;
				uniforms[9] = params.flow; uniforms[10] = params.sat; uniforms[11] = params.dim;
				uniforms[12] = params.tint; uniforms[13] = g.dpr;
				uniforms[14] = window.innerWidth; uniforms[15] = window.innerHeight;
				device.queue.writeBuffer(uniformBuffer, 0, uniforms);
				const encoder = device.createCommandEncoder();
				if (texture) {
					// Wallpaper uploads and blur-slider moves invalidate the prepass;
					// ordinary frames reuse the last blurred view.
					const key = `${textureVersion}:${texture.width}x${texture.height}:${window.innerWidth}:${params.blur}`;
					if (key !== blurKey || !bindGroup) {
						const source = runBlur(encoder);
						if (!source) return;
						bindDisplay(source);
						blurKey = key;
					}
				}
				const view = context.getCurrentTexture().createView();
				const pass = encoder.beginRenderPass({
					colorAttachments: [{
						view,
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: "clear",
						storeOp: "store"
					}]
				});
				if (bindGroup) {
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
				}
				pass.end();
				device.queue.submit([encoder.finish()]);
				if (!shown && texture) {
					shown = true;
					canvas.style.opacity = "1";
				}
			}
			function tick(now) {
				frame = 0;
				if (paused() || !running) return;
				const interval = frameInterval();
				if (interval && now - lastRender < interval - 0.5) { schedule(); return; }
				const gap = lastTick ? now - lastTick : 16;
				lastTick = now;
				lastRender = now;
				adapt(gap);
				resize();
				// Measure the render itself, not the rAF gap: at a 30 fps cap the gap is
				// always ≈33 ms, so a gap-based number would look like a stall that
				// isn't there and trip the fallback guard.
				const startedAt = performance.now();
				draw(now);
				const cost = performance.now() - startedAt;
				if (cost >= 0 && cost < 500) perf.ms = perf.ms ? perf.ms * 0.85 + cost * 0.15 : cost;
				// Pacing is the only end-to-end signal available without stalling the
				// pipeline: at a capped fps the gap equals the interval when the GPU
				// keeps up, and grows past it when it does not.
				if (gap > 0 && gap < 500) perf.frameGap = perf.frameGap ? perf.frameGap * 0.85 + gap * 0.15 : gap;
				perf.frames += 1;
				frames += 1;
				schedule();
			}
			function start() {
				if (running || disposed) return;
				running = true;
				perf.paused.delete("init");
				schedule();
			}
			function stop() {
				running = false;
				stopFrames();
			}
			async function setWallpaper(url, kind = "image") {
				if (!device || !url) return false;
				try {
					let source = null;
					if (kind === "video") {
						source = await frameFromVideo(url);
					} else {
						const blob = await (await fetch(url, { cache: "no-store" })).blob();
						source = await createImageBitmap(blob);
					}
					if (!source) return false;
					// Adaptive ink: sample the same bitmap that becomes the texture,
					// before it is closed (a closed ImageBitmap reports 0x0).
					const sample = measureInk(source);
					if (isBlackSwap(sample)) {
						source.close?.();
						reportClientError(`blackframe: refused a capture that measured ${sample.lum}`);
						return false;
					}
					onInk?.(sample);
					const MAX = 2048;
					const ratio = Math.min(1, MAX / Math.max(source.width, source.height));
					const w = Math.max(1, Math.round(source.width * ratio));
					const h = Math.max(1, Math.round(source.height * ratio));
					textureVersion += 1;
					if (texture) texture.destroy();
					texture = device.createTexture({
						size: [w, h],
						format: "rgba8unorm",
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
					});
					device.queue.copyExternalImageToTexture({ source }, { texture }, [w, h]);
					source.close?.();
					wallpaperView = texture.createView();
					bindGroup = null;
					blurKey = "";
					draw(performance.now());
					return true;
				} catch (error) {
					reportClientError(`webgpu wallpaper: ${error?.message ?? error}`, true);
					return false;
				}
			}
			const ready = (async () => {
				try {
					const adapter = await navigator.gpu.requestAdapter({ powerPreference });
					if (!adapter) throw new Error("no adapter");
					device = await adapter.requestDevice();
					device.lost?.then((info) => {
						if (disposed) return;
						stop();
						onFault("lost");
						reportClientError(`webgpu lost: ${info?.message ?? ""}`, true);
					});
					context = canvas.getContext("webgpu");
					if (!context) throw new Error("no context");
					const format = navigator.gpu.getPreferredCanvasFormat();
					context.configure({ device, format, alphaMode: "premultiplied" });
					uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
					sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
					pipeline = device.createRenderPipeline({
						layout: "auto",
						vertex: { module: device.createShaderModule({ code: vertexShader }), entryPoint: "vs" },
						fragment: { module: device.createShaderModule({ code: vertexShader }), entryPoint: "fs", targets: [{ format }] },
						primitive: { topology: "triangle-list" }
					});
					blurUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
					blurPipeline = device.createRenderPipeline({
						layout: "auto",
						vertex: { module: device.createShaderModule({ code: blurShader }), entryPoint: "vs" },
						fragment: { module: device.createShaderModule({ code: blurShader }), entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
						primitive: { topology: "triangle-list" }
					});
					return true;
				} catch (error) {
					reportClientError(`webgpu init: ${error?.message ?? error}`, true);
					return false;
				}
			})();
			return {
				canvas,
				ready,
				start,
				stop,
				dispose() {
					disposed = true;
					stop();
					try { texture?.destroy(); } catch {}
					for (const tex of [blurA, blurB]) {
						try { tex?.destroy(); } catch {}
					}
					blurA = null;
					blurB = null;
					blurAView = null;
					blurBView = null;
					wallpaperView = null;
					bindGroup = null;
					try { blurUniformBuffer?.destroy(); } catch {}
					try { device?.destroy(); } catch {}
					canvas.remove();
				},
				setParams(next = {}) {
					if (typeof next.flow === "number") params.flow = next.flow;
					if (typeof next.sat === "number") params.sat = next.sat;
					if (typeof next.dim === "number") params.dim = next.dim;
					if (typeof next.tint === "number") params.tint = next.tint;
					if (typeof next.blur === "number" && next.blur !== params.blur) {
						params.blur = next.blur;
						blurKey = "";
						if (device && texture) draw(performance.now());
					}
				},
				setMouse(x, y) { mouse.x = x; mouse.y = y; },
				setTargetFps(v) { perf.targetFps = v > 0 ? Math.min(240, v) : 0; },
				setAutoScale(v) { perf.autoScale = !!v; },
				setPaused(reason, value) {
					if (value) perf.paused.add(reason);
					else perf.paused.delete(reason);
					if (paused()) stopFrames();
					else schedule();
				},
				wake() { if (perf.idle) { perf.idle = false; schedule(); } },
				hasTexture: () => !!texture,
				setWallpaper,
				/** Closed-loop GPU cost of one frame, measured after the queue drains. */
				async benchmark(count = 120) {
					if (!device || !texture) return null;
					const frames = Math.max(10, Math.min(400, Math.round(count)));
					const started = performance.now();
					for (let i = 0; i < frames; i++) draw(started + i * 16.7);
					await device.queue.onSubmittedWorkDone();
					const elapsed = performance.now() - started;
					return {
						frames,
						msPerFrame: Number((elapsed / frames).toFixed(3)),
						canvas: [canvas.width, canvas.height],
						tex: [texture.width, texture.height],
						blur: params.blur > 0.5 ? [texture.width, texture.height] : null,
						scale: SCALES[scaleIndex],
						backend: "webgpu"
					};
				},
				stats() {
					const g = geometry();
					return {
						mode: perf.idle ? "idle" : paused() ? "paused" : running ? "running" : "stopped",
						scale: SCALES[scaleIndex],
						fps: perf.targetFps,
						frames,
						paused: [...perf.paused],
						focus: document.hasFocus(),
						vis: document.visibilityState,
						vp: [window.innerWidth, window.innerHeight],
						geo: { scr: [g.scrW, g.scrH], dpr: g.dpr, pos: [window.screenX, window.screenY], canvas: [canvas.width, canvas.height], scale: canvas.width / Math.max(1, window.innerWidth) },
						tex: texture ? [texture.width, texture.height] : null,
						texErr: null,
						backend: "webgpu",
						ms: Math.round((perf.ms || 0) * 10) / 10,
						frameGap: Math.round((perf.frameGap || 0) * 10) / 10,
						texVersion: textureVersion
					};
				}
			};
		}
		function createLiquidCanvas(options = {}) {
			const onFault = typeof options.onFault === "function" ? options.onFault : () => {};
			const onInk = typeof options.onInk === "function" ? options.onInk : null;
			const canvas = document.createElement("canvas");
			canvas.setAttribute("aria-hidden", "true");
			canvas.dataset.liquidGlass = "canvas";
			Object.assign(canvas.style, {
				position: "fixed",
				inset: "0",
				width: "100%",
				height: "100%",
				zIndex: "-2",
				pointerEvents: "none",
				display: "block",
				// Hidden until the first real frame: an empty WebGL canvas is
				// opaque black and would flash a black window during startup.
				opacity: "0",
				transition: "opacity 420ms ease"
			});

			const gl = canvas.getContext("webgl", {
				antialias: false,
				alpha: false,
				depth: false,
				stencil: false,
				premultipliedAlpha: false,
				// Keep the last frame on screen when the guard freezes the loop;
				// otherwise a paused WebGL canvas can composite as transparent/black.
				preserveDrawingBuffer: true,
				powerPreference: options.powerPreference ?? "high-performance"
			});
			if (!gl) return null;

			let contextLost = false;
			// Our own dispose() loses the context on purpose; that event is not a fault.
			let disposed = false;
			// The canvas stays transparent until the first wallpaper frame is on
			// screen, so startup never flashes a black pane.
			let shown = false;
			let running = false;
			let frame = 0;
			let lastRenderAt = 0;
			let lastTickAt = 0;
			let slowTicks = 0;
			let fastTicks = 0;
			let scaleIndex = 1;
			let idleTimer = 0;
			let resumeTimer = 0;
			const SCALES = [1, 0.8, 0.65, 0.5];
			const perf = {
				targetFps: 30,
				autoScale: true,
				idle: false,
				frames: 0,
				ms: 0,
				paused: new Set()
			};
			const frameInterval = () => (perf.targetFps > 0 ? 1000 / perf.targetFps : 0);

			let program;
			try {
				program = gl.createProgram();
				gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
				gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
				gl.linkProgram(program);
				if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
					throw new Error(`liquid-glass link: ${gl.getProgramInfoLog(program)}`);
				}
			} catch (error) {
				console.warn("[liquid-glass]", error);
				return null;
			}

			gl.useProgram(program);

			const buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
			const aPos = gl.getAttribLocation(program, "aPos");
			gl.enableVertexAttribArray(aPos);
			gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

			const uniforms = {
				res: gl.getUniformLocation(program, "uRes"),
				screen: gl.getUniformLocation(program, "uScreen"),
				win: gl.getUniformLocation(program, "uWin"),
				scale: gl.getUniformLocation(program, "uScale"),
				dpr: gl.getUniformLocation(program, "uDpr"),
				texRes: gl.getUniformLocation(program, "uTexRes"),
				tex: gl.getUniformLocation(program, "uTex"),
				prev: gl.getUniformLocation(program, "uPrev"),
				blend: gl.getUniformLocation(program, "uBlend"),
				time: gl.getUniformLocation(program, "uTime"),
				sat: gl.getUniformLocation(program, "uSat"),
				dim: gl.getUniformLocation(program, "uDim"),
				flow: gl.getUniformLocation(program, "uFlow"),
				ripple: gl.getUniformLocation(program, "uRipple"),
				mouse: gl.getUniformLocation(program, "uMouse")
			};

			// Blur prepass program: the whole point is that the compositor never
			// runs `backdrop-filter` on top of the animated canvas. One blur pass
			// per wallpaper change, then the animated pass samples the result.
			let blurProgram = null;
			const blurUniforms = {};
			try {
				blurProgram = gl.createProgram();
				gl.attachShader(blurProgram, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
				gl.attachShader(blurProgram, compileShader(gl, gl.FRAGMENT_SHADER, BLUR_FRAGMENT_SHADER));
				gl.linkProgram(blurProgram);
				if (!gl.getProgramParameter(blurProgram, gl.LINK_STATUS)) {
					gl.deleteProgram(blurProgram);
					blurProgram = null;
				}
			} catch {
				blurProgram = null;
			}
			if (blurProgram) {
				blurUniforms.tex = gl.getUniformLocation(blurProgram, "uTex");
				blurUniforms.texel = gl.getUniformLocation(blurProgram, "uTexel");
				blurUniforms.radius = gl.getUniformLocation(blurProgram, "uRadius");
				blurUniforms.aPos = gl.getAttribLocation(blurProgram, "aPos");
			}

			let texture = null;
			/** Blurred copy of the wallpaper: { tex, fbo, width, height }. */
			let blurTarget = null;
			/** Ping-pong partner for multi-pass blur; always a scratch buffer. */
			let blurTargetB = null;
			/** Snapshot of the previous blurred frame, used for the swap cross-fade. */
			let prevBlur = null;
			/** Scratch FBO used to copy a texture into the snapshot. */
			let copyFbo = null;
			let blendStart = 0;
			let textureError = "";
			let textureRequest = 0;
			const clock = { start: performance.now() };
			const mouse = { x: 0, y: 0 };
			let lastMouseAt = 0;
			const params = { sat: 1.6, dim: 0.08, flow: 0.85, blur: 10 };
			// The wallpaper is blurred by the prepass anyway, so above DPR_CAP
			// rendering costs DPR² fragments that cannot be seen. Both backends
			// share the same cap so switching engines never changes sharpness.
			const dpr = () => Math.min(DPR_CAP, window.devicePixelRatio || 1);

			function setScale(next) {
				const index = Math.max(0, Math.min(SCALES.length - 1, next));
				if (index === scaleIndex) return;
				scaleIndex = index;
				if (running && !perf.idle) schedule(true);
			}

			function resize() {
				const ratio = dpr() * SCALES[scaleIndex];
				const width = Math.max(1, Math.round(window.innerWidth * ratio));
				const height = Math.max(1, Math.round(window.innerHeight * ratio));
				if (canvas.width !== width || canvas.height !== height) {
					canvas.width = width;
					canvas.height = height;
				}
				gl.viewport(0, 0, width, height);
				return ratio;
			}

			/** Copy the current blur target into the fade snapshot (no shader needed). */
			function copyToPrev(source) {				if (!source) return;
				if (!prevBlur || prevBlur.width !== source.width || prevBlur.height !== source.height) {
					if (prevBlur) gl.deleteTexture(prevBlur.tex);
					const tex = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, tex);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					prevBlur = { tex, width: source.width, height: source.height };
				}
				gl.bindFramebuffer(gl.FRAMEBUFFER, source.fbo);
				gl.bindTexture(gl.TEXTURE_2D, prevBlur.tex);
				gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, source.width, source.height);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			}

			/**
			 * Copy any uploaded texture (the sharp wallpaper has no prepass) into the
			 * fade snapshot. Without this, blur = 0 skipped the cross-fade entirely and
			 * every recapture replaced the picture in one frame — the background
			 * "jumping" on each refresh.
			 */
			function snapshotTexture(source, width, height) {
				if (!source || !width || !height) return false;
				if (!prevBlur || prevBlur.width !== width || prevBlur.height !== height) {
					if (prevBlur) gl.deleteTexture(prevBlur.tex);
					const tex = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, tex);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					prevBlur = { tex, width, height };
				}
				if (!copyFbo) copyFbo = gl.createFramebuffer();
				gl.bindFramebuffer(gl.FRAMEBUFFER, copyFbo);
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source, 0);
				gl.bindTexture(gl.TEXTURE_2D, prevBlur.tex);
				gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
				// Detach before the caller frees the source texture.
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				return true;
			}

			/** Free one blur target (idempotent). */
			function freeTarget(target) {
				if (!target) return null;
				gl.deleteFramebuffer(target.fbo);
				gl.deleteTexture(target.tex);
				return null;
			}

			/** (Re)allocate one full-resolution blur target, freeing the old one. */
			function makeTarget(current, width, height) {
				if (current && current.width === width && current.height === height) return current;
				if (current) {
					gl.deleteFramebuffer(current.fbo);
					gl.deleteTexture(current.tex);
				}
				const tex = gl.createTexture();
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				const fbo = gl.createFramebuffer();
				gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				return { tex, fbo, width, height };
			}

			/**
			 * One-shot blur of the current wallpaper into an FBO. Runs on upload and
			 * when the blur slider moves — never per frame.
			 *
			 * Full resolution on purpose: a half-size target lets the bilinear
			 * upscale do part of the blurring, which smears icons and text into
			 * astigmatism. Only the 13-tap poisson kernel blurs, and blur = 0 skips
			 * the pass entirely so the wallpaper stays pixel-sharp.
			 *
			 * One 13-tap pass bands visibly past ~10 texels, so the same kernel is
			 * ping-ponged 1–4 times: the slider maps to a target radius in texture
			 * texels, the pass count grows with it, and every pass keeps its radius
			 * inside the kernel's well-sampled range. That is what makes 100% soft
			 * instead of a clamped, undersampled smear.
			 */
			function renderBlur() {
				if (!blurProgram || !texture) return;
				if (params.blur <= 0.5) {
					// Sharp mode: sample the wallpaper directly, zero extra GPU memory.
					blurTarget = freeTarget(blurTarget);
					blurTargetB = freeTarget(blurTargetB);
					return;
				}
				const width = texture.width;
				const height = texture.height;
				// Keep the previous blurred frame for the cross-fade before the
				// targets are reused.
				if (blurTarget) copyToPrev(blurTarget);
				const pixelScale = width / Math.max(1, window.innerWidth || width);
				const targetRadius = Math.min(36, Math.max(1.2, params.blur * pixelScale * 0.9));
				const passes = Math.max(1, Math.min(4, Math.ceil(targetRadius / 9)));
				const radius = Math.max(1.2, Math.min(10, targetRadius / passes));
				blurTarget = makeTarget(blurTarget, width, height);
				// Single-pass blurs read the source straight into blurTarget, so the
				// scratch buffer (another full-resolution texture) is pure waste.
				blurTargetB = passes > 1 ? makeTarget(blurTargetB, width, height) : freeTarget(blurTargetB);
				gl.useProgram(blurProgram);
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				if (blurUniforms.aPos >= 0) {
					gl.enableVertexAttribArray(blurUniforms.aPos);
					gl.vertexAttribPointer(blurUniforms.aPos, 2, gl.FLOAT, false, 0, 0);
				}
				gl.uniform1i(blurUniforms.tex, 0);
				gl.uniform2f(blurUniforms.texel, 1 / width, 1 / height);
				gl.uniform1f(blurUniforms.radius, radius);
				let source = texture.handle;
				let finalIsB = false;
				for (let pass = 0; pass < passes; pass++) {
					const dest = pass % 2 === 0 ? blurTarget : blurTargetB;
					gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
					gl.viewport(0, 0, width, height);
					gl.activeTexture(gl.TEXTURE0);
					gl.bindTexture(gl.TEXTURE_2D, source);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					source = dest.tex;
					finalIsB = pass % 2 === 1;
				}
				// The main pass always samples blurTarget: swap the pair when the
				// final pass landed in the scratch buffer.
				if (finalIsB) {
					const swap = blurTarget;
					blurTarget = blurTargetB;
					blurTargetB = swap;
				}
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				// Start the 420 ms cross-fade from the snapshot to the fresh blur.
				blendStart = prevBlur ? performance.now() : 0;
				gl.useProgram(program);
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				gl.enableVertexAttribArray(aPos);
				gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
			}

			/** Where the window sits on screen, in CSS pixels (plus canvas scale). */
			function geometry() {
				const dpr = window.devicePixelRatio || 1;
				const screenW = window.screen?.width || window.innerWidth;
				const screenH = window.screen?.height || window.innerHeight;
				const frameX = Math.max(0, ((window.outerWidth || window.innerWidth) - window.innerWidth) / 2);
				const frameY = Math.max(0, (window.outerHeight || window.innerHeight) - window.innerHeight);
				const left = (window.screenX || 0) + frameX;
				const top = (window.screenY || 0) + frameY;
				const scale = canvas.width / Math.max(1, window.innerWidth);
				return { dpr, screenW, screenH, left, scale, winBottom: screenH - (top + window.innerHeight) };
			}

			function render(now) {
				const ratio = resize();
				gl.uniform2f(uniforms.res, canvas.width, canvas.height);
				gl.uniform1f(uniforms.time, (now - clock.start) / 1000);
				gl.uniform1f(uniforms.sat, params.sat);
				gl.uniform1f(uniforms.dim, params.dim);
				gl.uniform1f(uniforms.flow, params.flow);
				// Ripple only while the pointer is actually moving: a parked cursor
				// skips the sin/exp pair for the whole screen.
				gl.uniform1f(uniforms.ripple, performance.now() - lastMouseAt < 2500 ? 1 : 0);
				const geo = geometry();
				gl.uniform2f(uniforms.screen, geo.screenW, geo.screenH);
				gl.uniform2f(uniforms.win, geo.left, geo.winBottom);
				gl.uniform1f(uniforms.scale, geo.scale);
				gl.uniform1f(uniforms.dpr, geo.dpr);
				gl.uniform2f(
					uniforms.mouse,
					(geo.left + mouse.x) / geo.screenW,
					1 - (geo.winBottom + (window.innerHeight - mouse.y)) / geo.screenH
				);
				// The blurred prepass is the display source, so the shader samples it
				// instead of the raw wallpaper — no compositor blur on top.
				const source = blurTarget || texture;
				if (source) {
					gl.activeTexture(gl.TEXTURE0);
					gl.bindTexture(gl.TEXTURE_2D, blurTarget ? blurTarget.tex : texture.handle);
					gl.uniform1i(uniforms.tex, 0);
					gl.uniform2f(uniforms.texRes, blurTarget ? blurTarget.width : texture.width, blurTarget ? blurTarget.height : texture.height);
					const blend = blendStart ? Math.min(1, (performance.now() - blendStart) / 420) : 1;
					if (blend >= 1) blendStart = 0;
					gl.uniform1f(uniforms.blend, blend);
					if (prevBlur && blend < 1) {
						gl.activeTexture(gl.TEXTURE1);
						gl.bindTexture(gl.TEXTURE_2D, prevBlur.tex);
						gl.uniform1i(uniforms.prev, 1);
					} else if (uniforms.prev) {
						// Bind the current frame so the shader never samples an empty unit.
						gl.activeTexture(gl.TEXTURE1);
						gl.bindTexture(gl.TEXTURE_2D, blurTarget ? blurTarget.tex : texture.handle);
						gl.uniform1i(uniforms.prev, 1);
					}
					gl.activeTexture(gl.TEXTURE0);
				}
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				if (!shown && source) {
					shown = true;
					canvas.style.opacity = "1";
				}
				perf.frames += 1;
				lastRenderAt = now;
			}

			/** Adapt the resolution from the rAF cadence: only a real stall downsamples. */
			function adapt(gap) {
				if (!perf.autoScale) return;
				// Never adapt from throttled background frames: Chromium stretches
				// rAF gaps to seconds for occluded windows, which is not a real stall.
				if (!document.hasFocus() || document.visibilityState !== "visible") return;
				if (gap > 1000) return;
				const target = 1000 / 60;
				if (gap > Math.max(34, target * 1.6)) {
					slowTicks += 1;
					fastTicks = 0;
				} else if (gap < target * 1.35) {
					fastTicks += 1;
					slowTicks = 0;
				} else {
					slowTicks = 0;
					fastTicks = 0;
				}
				if (slowTicks >= 10) {
					setScale(scaleIndex + 1);
					slowTicks = 0;
				} else if (fastTicks >= 300) {
					setScale(scaleIndex - 1);
					fastTicks = 0;
				}
			}

			function tick(now) {
				frame = 0;
				if (!running || contextLost) return;
				// A paused (unfocused / hidden) window must not keep a rAF alive:
				// the loop stays fully parked until focus returns.
				if (perf.paused.size) return;
				if (perf.idle) return; // Fully suspended until wake().
				const gap = lastTickAt ? now - lastTickAt : 16.7;
				lastTickAt = now;
				const interval = frameInterval();
				const due = !interval || now - lastRenderAt >= interval - 0.5;
				if (due) {
					// Same rule as the WebGL renderer: the guard needs the render cost,
					// not the rAF gap, which is pinned to the fps cap.
					const startedAt = performance.now();
					render(now);
					const cost = performance.now() - startedAt;
					if (cost >= 0 && cost < 500) perf.ms = perf.ms ? perf.ms * 0.85 + cost * 0.15 : cost;
					if (gap > 0 && gap < 500) perf.frameGap = perf.frameGap ? perf.frameGap * 0.85 + gap * 0.15 : gap;
					lastRenderAt = now;
					adapt(gap);
				}
				schedule();
			}

			function schedule(force) {
				if (!running || perf.idle || perf.paused.size || contextLost) return;
				if (frame && !force) return;
				if (frame) cancelAnimationFrame(frame);
				frame = requestAnimationFrame(tick);
			}

			function stopFrames() {
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
				lastTickAt = 0;
			}

			function stop() {
				running = false;
				clearTimeout(idleTimer);
				clearTimeout(resumeTimer);
				stopFrames();
			}

			function start() {
				if (running) return;
				running = true;
				perf.idle = false;
				// A window that was hidden when the canvas was created keeps the
				// default 300x150 backing store unless it re-measures here.
				resize();
				lastRenderAt = 0;
				lastTickAt = 0;
				schedule();
			}

			/** Layer 4: nothing changes visually, so stop asking the GPU for frames. */
			function armIdle() {
				clearTimeout(idleTimer);
				if (!running || perf.paused.size) return;
				if (params.flow > 0.02) return;
				idleTimer = setTimeout(() => {
					if (!running || perf.paused.size) return;
					if (params.flow > 0.02) return;
					perf.idle = true;
					stopFrames();
				}, 1500);
			}

			function wake() {
				if (!running || contextLost) return;
				perf.idle = false;
				resize();
				lastRenderAt = 0;
				schedule(true);
			}

			canvas.addEventListener(
				"webglcontextlost",
				(event) => {
					event.preventDefault();
					if (disposed) return;
					contextLost = true;
					stop();
					onFault("lost");
				},
				false
			);
			canvas.addEventListener("webglcontextrestored", () => onFault("restored"), false);

			// The canvas must re-measure when the window is restored or resized,
			// otherwise it keeps the 300x150 default and the whole shader runs at
			// that resolution while CSS stretches the result.
			const onWindowResize = () => {
				if (!running) return;
				resize();
				lastRenderAt = 0;
				schedule(true);
			};
			window.addEventListener("resize", onWindowResize, { passive: true });

			/**
			 * Pull a single frame out of a video wallpaper. Range support on the
			 * host route means only the beginning + the seek target are fetched.
			 */
			async function setWallpaper(url, kind = "image") {
				const request = ++textureRequest;
				try {
					// Cap every texture so a 4K wallpaper cannot blow up VRAM on an iGPU.
					const MAX_TEX = 2048;
					/** @type {TexImageSource} */
					let source;
					if (kind === "video") {
						source = await frameFromVideo(url);
						if (request !== textureRequest) return;
					} else {
						const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						const blob = await response.blob();
						let bitmap = await createImageBitmap(blob);
						if (request !== textureRequest) {
							bitmap.close?.();
							return;
						}
						const widest = Math.max(bitmap.width, bitmap.height);
						if (widest > MAX_TEX) {
							const factor = MAX_TEX / widest;
							const scaled = await createImageBitmap(blob, {
								resizeWidth: Math.round(bitmap.width * factor),
								resizeHeight: Math.round(bitmap.height * factor),
								resizeQuality: "high"
							});
							bitmap.close?.();
							bitmap = scaled;
						}
						source = bitmap;
					}
					// Read the dimensions before close(): a closed ImageBitmap reports 0x0.
					const sourceWidth = source.width;
					const sourceHeight = source.height;
					const sample = measureInk(source);
					if (isBlackSwap(sample)) {
						source.close?.();
						reportClientError(`blackframe: refused a capture that measured ${sample.lum}`);
						return false;
					}
					onInk?.(sample);
					const handle = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, handle);
					// Rows are uploaded top-down; the shader flips V explicitly.
					gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					source.close?.();
					// Sharp mode draws the raw texture, so the old one has to be kept for
					// one cross-fade before it is freed; otherwise the swap is a hard cut.
					if (params.blur <= 0.5 && texture && snapshotTexture(texture.handle, texture.width, texture.height)) {
						blendStart = performance.now();
					}
					if (texture) gl.deleteTexture(texture.handle);
					texture = { handle, width: sourceWidth, height: sourceHeight };
					textureError = "";
					renderBlur();
					if (running) {
						lastRenderAt = 0;
						schedule(true);
					}
				} catch (error) {
					textureError = String(error?.message ?? error);
					console.warn("[liquid-glass] wallpaper texture failed", error);
				}
			}

			return {
				canvas,
				setWallpaper,
				setParams(next) {
					if (typeof next.sat === "number") params.sat = next.sat;
					if (typeof next.dim === "number") params.dim = next.dim;
					if (typeof next.flow === "number") params.flow = next.flow;
					if (typeof next.blur === "number" && next.blur !== params.blur) {
						params.blur = next.blur;
						renderBlur();
					}
					armIdle();
				},
				setMouse(x, y) {
					mouse.x = x;
					mouse.y = y;
					lastMouseAt = performance.now();
				},
				setTargetFps(value) {
					const next = Number.isFinite(value) ? Math.max(0, Math.min(240, value)) : 30;
					if (next === perf.targetFps) return;
					perf.targetFps = next;
					lastRenderAt = 0;
					schedule(true);
				},
				setAutoScale(value) {
					perf.autoScale = Boolean(value);
					if (!perf.autoScale) setScale(0);
				},
				setPaused(reason, paused) {
					const key = String(reason || "manual");
					if (paused) {
						perf.paused.add(key);
						stopFrames();
					} else {
						perf.paused.delete(key);
						if (!perf.paused.size) {
							clearTimeout(resumeTimer);
							resumeTimer = setTimeout(() => {
								if (!running || perf.paused.size || perf.idle) return;
								lastRenderAt = 0;
								lastTickAt = 0;
								schedule(true);
							}, 300);
						}
					}
				},
				wake,
				hasTexture() {
					return Boolean(texture);
				},
				/**
				 * Closed-loop GPU cost of one full frame: render + gl.finish() so the
				 * timer stops only after the driver retired the draw calls.
				 */
				benchmark(count = 120) {
					if (!texture) return null;
					const frames = Math.max(10, Math.min(600, Math.round(count)));
					const probe = new Uint8Array(4);
					const started = performance.now();
					for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
						render(started + frameIndex * 16.7);
						// gl.finish() alone still lets ANGLE batch; a 1px readback is the
						// only call that cannot return before the GPU retired the frame.
						gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
					}
					const elapsed = performance.now() - started;
					return {
						frames,
						msPerFrame: Number((elapsed / frames).toFixed(3)),
						canvas: [canvas.width, canvas.height],
						tex: [texture.width, texture.height],
						blur: blurTarget ? [blurTarget.width, blurTarget.height] : null,
						scale: SCALES[scaleIndex]
					};
				},
				stats() {
					return {
						mode: contextLost
							? "lost"
							: perf.idle
								? "idle"
								: perf.paused.size
									? "paused"
									: "running",
						scale: SCALES[scaleIndex],
						fps: perf.targetFps,
						frames: perf.frames,
						paused: Array.from(perf.paused),
						focus: document.hasFocus(),
						vis: document.visibilityState,
						vp: [window.innerWidth, window.innerHeight],
						geo: {
							scr: [screen.width, screen.height],
							dpr: window.devicePixelRatio,
							pos: [window.screenX, window.screenY],
							canvas: [canvas.width, canvas.height],
							scale: canvas.width / Math.max(1, window.innerWidth)
						},
						tex: texture ? [texture.width, texture.height] : null,
						blur: blurTarget ? [blurTarget.width, blurTarget.height] : null,
						canvas: [canvas.width, canvas.height],
						ms: Math.round((perf.ms || 0) * 10) / 10,
						frameGap: Math.round((perf.frameGap || 0) * 10) / 10,
						texErr: textureError || null,
						canvases: document.querySelectorAll("canvas").length
					};
				},
				start,
				stop,
				dispose() {
					disposed = true;
					stop();
					textureRequest += 1;
					if (texture) gl.deleteTexture(texture.handle);
					if (blurTarget) {
						blurTarget = freeTarget(blurTarget);
					}
					if (blurTargetB) {
						blurTargetB = freeTarget(blurTargetB);
					}
					if (prevBlur) {
						gl.deleteTexture(prevBlur.tex);
						prevBlur = null;
					}
					// copyFbo is created lazily by snapshotTexture() and survives every
					// other reset; without this it leaks one framebuffer per renderer
					// rebuild (every backend / degrade / webglEpoch change).
					if (copyFbo) gl.deleteFramebuffer(copyFbo);
					copyFbo = null;
					if (blurProgram) gl.deleteProgram(blurProgram);
					gl.deleteProgram(program);
					gl.deleteBuffer(buffer);
					window.removeEventListener("resize", onWindowResize);
					const lose = gl.getExtension("WEBGL_lose_context");
					if (lose) lose.loseContext();
					canvas.remove();
				}
			};
		}
		function Switch({ on, onChange, label }) {
			return h(
				"button",
				{
					type: "button",
					className: "lg-switch",
					role: "switch",
					"aria-checked": on,
					"aria-label": label,
					"data-on": on ? "true" : "false",
					onClick: () => onChange(!on)
				},
				h("i")
			);
		}

		function Slider({ label, value, min, max, step, display, onChange }) {
			const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
			return h(
				"label",
				{ className: "lg-field" },
				h("div", { className: "lg-field-head" }, h("span", null, label), h("b", null, display)),
				h("input", {
					type: "range",
					className: "lg-range",
					min,
					max,
					step,
					value,
					style: { "--lg-fill": `${pct}%` },
					onChange: (event) => onChange(Number(event.target.value))
				})
			);
		}

		function Row({ label, hint, children }) {
			return h(
				"div",
				{ className: "lg-row" },
				h("div", { className: "lg-label" }, h("span", null, label), hint ? h("span", { className: "lg-hint" }, hint) : null),
				children
			);
		}
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
					root.style.setProperty("--lg-dim", String(value.dim));
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
					const liquid = mode === "webgpu" ? createWebGpuCanvas({ onFault, onInk, powerPreference }) : createLiquidCanvas({ onFault, onInk, powerPreference });
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
					liquid.setParams({ sat: value.saturation, dim: value.dim, flow: value.flow, blur: value.blur });
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
					liquidRef.current?.setParams({ sat: value.saturation, dim: value.dim, flow: value.flow, blur: value.blur });
				}, [value.saturation, value.dim, value.flow, value.blur]);

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
						// The composer is its own surface: the frosted card reads the overlay
						// token, which glassTokens() already tints toward the ink in use.
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
								h("div", { className: "lg-label" }, h("span", null, t("sourceLabel")), h("span", { className: "lg-hint" }, t("sourceHint"))),
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
		return { name: "liquid-glass", inject: ["slots", "theme", "locale"], apply };
	}
});
