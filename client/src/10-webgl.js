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
				powerPreference: "high-performance"
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
			// The wallpaper is blurred by the prepass anyway, so rendering above CSS
			// pixel density buys nothing visible but costs DPR² twice the fragments
			// (1.5x DPR = 2.25x pixels on this machine).
			const dpr = () => Math.min(1, window.devicePixelRatio || 1);

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
					for (const target of [blurTarget, blurTargetB]) {
						if (!target) continue;
						gl.deleteFramebuffer(target.fbo);
						gl.deleteTexture(target.tex);
					}
					blurTarget = null;
					blurTargetB = null;
					return;
				}
				const width = texture.width;
				const height = texture.height;
				// Keep the previous blurred frame for the cross-fade before the
				// targets are reused.
				if (blurTarget) copyToPrev(blurTarget);
				blurTarget = makeTarget(blurTarget, width, height);
				blurTargetB = makeTarget(blurTargetB, width, height);
				const pixelScale = width / Math.max(1, window.innerWidth || width);
				const targetRadius = Math.min(36, Math.max(1.2, params.blur * pixelScale * 0.9));
				const passes = Math.max(1, Math.min(4, Math.ceil(targetRadius / 9)));
				const radius = Math.max(1.2, Math.min(10, targetRadius / passes));
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
						gl.deleteFramebuffer(blurTarget.fbo);
						gl.deleteTexture(blurTarget.tex);
						blurTarget = null;
					}
					if (blurTargetB) {
						gl.deleteFramebuffer(blurTargetB.fbo);
						gl.deleteTexture(blurTargetB.tex);
						blurTargetB = null;
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
