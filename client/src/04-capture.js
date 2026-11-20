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
