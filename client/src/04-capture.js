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
		// One persistent probe canvas: a fresh canvas + 2D context for every video
		// frame (30-60 a second) cost more than the measurement itself.
		let inkProbe = null;
		function measureInk(source, sizeHint = 24) {
			try {
				const size = Math.max(4, Math.min(64, Math.round(sizeHint) || 24));
				// The sidebar can be collapsed, icon-rail or expanded, so a fixed
				// 24% cut sampled the wrong pixels in two of those states. Measure
				// the real scrollport; fall back to the old 24% when it is hidden.
				const scrollport = document.querySelector("[data-sidebar-scrollport]");
				const sidebarWidth = scrollport?.getBoundingClientRect?.().width ?? 0;
				const viewport = window.innerWidth || 0;
				const contentStart =
					viewport > 0 && sidebarWidth > 0 ? Math.min(0.45, Math.max(0.16, sidebarWidth / viewport)) : 0.24;
				const probe = inkProbe || (inkProbe = document.createElement("canvas"));
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


		/* Average colour of a wallpaper frame. Used by the intelligent mode. */
		function colorFromCanvas(canvas) {
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return "";
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			let r = 0;
			let g = 0;
			let b = 0;
			let n = 0;
			let ar = 0;
			let ag = 0;
			let ab = 0;
			let an = 0;
			for (let i = 0; i < data.length; i += 4) {
				const rr = data[i];
				const gg = data[i + 1];
				const bb = data[i + 2];
				const max = Math.max(rr, gg, bb);
				const min = Math.min(rr, gg, bb);
				const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
				const sat = max === 0 ? 0 : (max - min) / max;
				ar += rr;
				ag += gg;
				ab += bb;
				an += 1;
				if (lum > 0.06 && lum < 0.94 && sat > 0.12) {
					r += rr;
					g += gg;
					b += bb;
					n += 1;
				}
			}
			if (an === 0) return "";
			const pick = n >= an * 0.08 ? [r / n, g / n, b / n] : [ar / an, ag / an, ab / an];
			return "#" + pick.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("");
		}

		function probeCanvas(width, height) {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			return canvas;
		}

		function hexLuminance(color) {
			const match = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
			if (!match) return null;
			const value = parseInt(match[1], 16);
			const r = (value >> 16) & 255;
			const g = (value >> 8) & 255;
			const b = value & 255;
			return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		}

		async function sampleImageColor(url) {
			const response = await fetch(url, { cache: "no-store" });
			if (!response.ok) return "";
			const blob = await response.blob();
			const bitmap = await createImageBitmap(blob);
			const canvas = probeCanvas(28, 18);
			canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close?.();
			return colorFromCanvas(canvas);
		}

		async function sampleVideoColor(url) {
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "metadata";
			video.src = url;
			const ready = await new Promise((resolve) => {
				let done = false;
				const finish = (ok) => {
					if (done) return;
					done = true;
					resolve(ok);
				};
				video.addEventListener("loadeddata", () => finish(true), { once: true });
				video.addEventListener("error", () => finish(false), { once: true });
				setTimeout(() => finish(false), 5000);
			});
			if (!ready) {
				video.removeAttribute("src");
				return "";
			}
			try {
				video.currentTime = Number.isFinite(video.duration) && video.duration > 1 ? Math.min(3, video.duration * 0.3) : 0;
			} catch {
				/* seek not ready */
			}
			await new Promise((resolve) => {
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					resolve();
				};
				video.addEventListener("seeked", finish, { once: true });
				setTimeout(finish, 2500);
			});
			const canvas = probeCanvas(28, 18);
			let color = "";
			try {
				canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
				color = colorFromCanvas(canvas);
			} catch {
				color = "";
			}
			video.removeAttribute("src");
			video.load();
			return color;
		}

		async function sampleWallpaperColor(url, kind) {
			try {
				if (!url) return "";
				return kind === "video" ? await sampleVideoColor(url) : await sampleImageColor(url);
			} catch {
				return "";
			}
		}

		/**
		 * Playback properties of the wallpaper video: the "playback speed",
		 * "volume" and "mute" rows of the property sheet. Applied to every live
		 * element, including ones created before the user touched a slider.
		 */
		const livePrefs = { rate: 1, volume: 0, muted: true };
		const liveElements = new Set();

		function applyLivePrefs(element) {
			if (!element || !("playbackRate" in element)) return;
			const rate = Math.min(2, Math.max(0.25, Number(livePrefs.rate) || 1));
			const volume = Math.min(1, Math.max(0, Number(livePrefs.volume) || 0));
			element.playbackRate = rate;
			element.volume = volume;
			// Muted by default: a wallpaper that talks over the user is worse than
			// a silent one, so audio has to be switched on explicitly.
			element.muted = livePrefs.muted !== false || volume === 0;
		}

		function setLivePrefs(next) {
			if (!next) return;
			if (typeof next.rate === "number") livePrefs.rate = next.rate;
			if (typeof next.volume === "number") livePrefs.volume = next.volume;
			if (typeof next.muted === "boolean") livePrefs.muted = next.muted;
			for (const element of liveElements) applyLivePrefs(element);
		}

		/**
		 * Task 8: a live wallpaper source. Local videos decode off-screen and
		 * animated images are drawn from a hidden <img>; both feed the shared
		 * canvas returned by liveWallpaperFrame() on a short timer.
		 */
		function createLiveWallpaper(url, kind) {
			const animated = kind === "animation";
			const element = document.createElement(animated ? "img" : "video");
			element.setAttribute("aria-hidden", "true");
			element.style.cssText = "position:fixed;left:-20000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
			if (animated) {
				element.decoding = "async";
			} else {
				element.muted = true;
				element.loop = true;
				element.playsInline = true;
				element.preload = "auto";
				liveElements.add(element);
				applyLivePrefs(element);
			}
			const ready = new Promise((resolve) => {
				let settled = false;
				const finish = (ok) => {
					if (settled) return;
					settled = true;
					resolve(ok);
				};
				const check = () => {
					if (animated) {
						finish(element.naturalWidth > 0);
					} else if (element.readyState >= 2) {
						element.play().catch(() => {});
						finish(true);
					}
				};
				element.addEventListener(animated ? "load" : "loadeddata", check, { once: true });
				element.addEventListener("error", () => finish(false), { once: true });
				setTimeout(check, 4000);
			});
			// Frame cadence: requestVideoFrameCallback fires once per decoded video frame,
			// so the texture follows the video instead of a fixed 110 ms timer (~9 fps),
			// which is exactly what made video wallpapers look like a slideshow.
			let frameHandle = 0;
			let frameCallback = null;
			let frameStopped = false;
			const pump = () => {
				frameHandle = 0;
				if (frameStopped || !frameCallback) return;
				frameCallback();
				if (frameStopped || !frameCallback) return;
				frameHandle = element.requestVideoFrameCallback(pump);
			};
			element.src = url;
			document.body.appendChild(element);
			return {
				kind,
				element,
				ready,
				/** True when the element can drive uploads off its own frame clock. */
				onFrame(callback) {
					if (animated || typeof element.requestVideoFrameCallback !== "function") return false;
					frameCallback = callback;
					frameStopped = false;
					if (!frameHandle) frameHandle = element.requestVideoFrameCallback(pump);
					return true;
				},
				stopFrames() {
					frameStopped = true;
					frameCallback = null;
					if (frameHandle && typeof element.cancelVideoFrameCallback === "function") {
						element.cancelVideoFrameCallback(frameHandle);
					}
					frameHandle = 0;
				},
				dispose() {
					frameStopped = true;
					frameCallback = null;
					try {
						element.pause?.();
					liveElements.delete(element);
						element.removeAttribute("src");
						element.remove();
					} catch {
						/* best effort */
					}
				}
			};
		}

		/**
		 * Paint the current frame of a live source into `canvas` (≤1600 px edge).
		 * Returns null while the element still has no decoded frame.
		 */
		function liveWallpaperFrame(source, canvas) {
			const element = source && source.element;
			if (!element) return null;
			const naturalWidth = element.videoWidth || element.naturalWidth || 0;
			const naturalHeight = element.videoHeight || element.naturalHeight || 0;
			if (!naturalWidth || !naturalHeight) return null;
			const ratio = Math.min(1, 1600 / Math.max(naturalWidth, naturalHeight));
			const width = Math.max(1, Math.round(naturalWidth * ratio));
			const height = Math.max(1, Math.round(naturalHeight * ratio));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			try {
				const context = canvas.getContext("2d", { alpha: false });
				context.drawImage(element, 0, 0, width, height);
			} catch {
				return null;
			}
			return canvas;
		}
