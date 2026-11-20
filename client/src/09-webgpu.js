		/**
		 * Owns the WebGL canvas that paints the liquid wallpaper and its five
		 * protection layers: visibility/focus circuit breaker, frame-rate
		 * throttle, dynamic resolution, render-on-demand, and a context-lost
		 * escape hatch that drops to static CSS glass.
		 */
		// WebGPU backend: the same screen-space liquid pipeline, written in WGSL.
		// It keeps the WebGL renderer's contract (start/stop/pause/fps/DRS) so the
		// protection layers work unchanged; any setup failure returns null and the
		// caller degrades to CSS mode.
		function createWebGpuCanvas(options = {}) {
			const onFault = typeof options.onFault === "function" ? options.onFault : () => {};
			const onInk = typeof options.onInk === "function" ? options.onInk : null;
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
			const params = { flow: 0.9, sat: 1.4, dim: 0.08, tint: 0.55 };
			const perf = { targetFps: 30, autoScale: true, idle: false, paused: new Set(), frames: 0, ms: 0 };
			const uniforms = new Float32Array(20);
			const vertexShader = `
struct Uniforms {
  time: f32, mx: f32, my: f32, scrW: f32,
  scrH: f32, winX: f32, winY: f32, texW: f32,
  texH: f32, flow: f32, sat: f32, dim: f32,
  tint: f32, cScale: f32, dpr: f32, pad: f32,
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
  let res = vec2<f32>(textureDimensions(tex));
  let fragCss = in.frag * vec2<f32>(res.x / u.cScale, res.y / u.cScale);
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
				const ratio = Math.min(2, (window.devicePixelRatio || 1) * SCALES[scaleIndex]);
				const w = Math.max(2, Math.round(window.innerWidth * ratio));
				const h = Math.max(2, Math.round(window.innerHeight * ratio));
				if (canvas.width !== w || canvas.height !== h) {
					canvas.width = w;
					canvas.height = h;
				}
				return w / Math.max(1, window.innerWidth);
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
				if (!device || !context || !bindGroup) return;
				const g = geometry();
				const cScale = canvas.width / Math.max(1, window.innerWidth);
				uniforms[0] = (now || performance.now()) / 1000;
				uniforms[1] = mouse.x; uniforms[2] = mouse.y;
				uniforms[3] = g.scrW; uniforms[4] = g.scrH;
				uniforms[5] = g.winX; uniforms[6] = g.winY;
				uniforms[7] = texture ? texture.width : 1; uniforms[8] = texture ? texture.height : 1;
				uniforms[9] = params.flow; uniforms[10] = params.sat; uniforms[11] = params.dim;
				uniforms[12] = params.tint; uniforms[13] = cScale; uniforms[14] = g.dpr;
				device.queue.writeBuffer(uniformBuffer, 0, uniforms);
				const view = context.getCurrentTexture().createView();
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginRenderPass({
					colorAttachments: [{
						view,
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: "clear",
						storeOp: "store"
					}]
				});
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
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
					bindGroup = device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 0, resource: { buffer: uniformBuffer } },
							{ binding: 1, resource: sampler },
							{ binding: 2, resource: texture.createView() }
						]
					});
					draw(performance.now());
					return true;
				} catch (error) {
					reportClientError(`webgpu wallpaper: ${error?.message ?? error}`, true);
					return false;
				}
			}
			const ready = (async () => {
				try {
					const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
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
					try { device?.destroy(); } catch {}
					canvas.remove();
				},
				setParams(next = {}) {
					if (typeof next.flow === "number") params.flow = next.flow;
					if (typeof next.sat === "number") params.sat = next.sat;
					if (typeof next.dim === "number") params.dim = next.dim;
					if (typeof next.tint === "number") params.tint = next.tint;
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
						blur: null,
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
