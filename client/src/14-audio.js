/**
 * Audio bus.
 *
 * One shared <audio> element plays the user playlist (path served by
 * /liquid-glass/media, so Range and every local codec work), and an
 * AnalyserNode turns the signal into a single 0..1 "beat" value that the
 * renderer polls through options.onBeat. Two sources are supported:
 *
 * - the playlist itself (audible), routed element -> analyser -> destination;
 * - a system loopback capture (getDisplayMedia), routed stream -> analyser only
 *   so the desktop audio is measured but never played a second time.
 *
 * The element lives outside React on purpose: closing the settings page must
 * not stop the music, and the renderer keeps its beat callback.
 */

const audioBus = {
	level: 0,
	smooth: 0,
	lastAt: 0,
	el: null,
	ctx: null,
	analyser: null,
	elementSource: null,
	systemStream: null,
	systemSource: null,
	systemAnalyser: null,
	system: false,
	list: [],
	index: 0,
	loaded: "",
	enabled: false,
	reactive: false,
	rate: 1,
	volume: 0.6,
	error: "",
	freq: null
};

function audioSetError(message) {
	audioBus.error = message ? String(message) : "";
}

function audioName(file) {
	const path = typeof file === "string" ? file : "";
	return path.split(/[\\/]/).pop() || path;
}

function audioContext() {
	if (audioBus.ctx) return audioBus.ctx;
	const Ctor = window.AudioContext || window.webkitAudioContext;
	if (!Ctor) {
		audioSetError("当前环境不支持 Web Audio");
		return null;
	}
	try {
		audioBus.ctx = new Ctor();
	} catch (error) {
		audioSetError(error?.message);
		return null;
	}
	return audioBus.ctx;
}

function audioElement() {
	if (audioBus.el) return audioBus.el;
	const el = document.createElement("audio");
	el.preload = "auto";
	el.addEventListener("ended", () => audioNext());
	el.addEventListener("error", () => {
		if (audioBus.enabled) audioSetError("音频加载失败");
	});
	audioBus.el = el;
	return el;
}

function audioAnalyserElement() {
	if (audioBus.analyser) return audioBus.analyser;
	const ctx = audioContext();
	if (!ctx) return null;
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.75;
	audioBus.analyser = analyser;
	return analyser;
}

function audioRouteElement() {
	const el = audioElement();
	const ctx = audioContext();
	if (!ctx) return;
	if (audioBus.elementSource) return;
	try {
		const analyser = audioAnalyserElement();
		audioBus.elementSource = ctx.createMediaElementSource(el);
		audioBus.elementSource.connect(analyser);
		analyser.connect(ctx.destination);
	} catch (error) {
		// createMediaElementSource throws if the element was already routed.
		audioSetError(error?.message);
	}
}

/** Load/refresh the playlist element from the current bus state. */
function audioApply() {
	const el = audioElement();
	if (!audioBus.enabled || audioBus.list.length === 0) {
		if (!el.paused) el.pause();
		return;
	}
	if (audioBus.index >= audioBus.list.length) audioBus.index = 0;
	const src = `${API}/media?path=${encodeURIComponent(audioBus.list[audioBus.index])}`;
	if (audioBus.loaded !== src) {
		audioBus.loaded = src;
		el.src = src;
	}
	el.playbackRate = audioBus.rate;
	el.volume = audioBus.volume;
	audioRouteElement();
	if (audioBus.ctx?.state === "suspended") audioBus.ctx.resume().catch(() => {});
	const playing = el.play();
	if (playing && typeof playing.catch === "function") {
		playing.catch(() => {
			audioSetError("浏览器拦截了自动播放，点「试听」开始播放");
		});
	}
}

function audioSync(audio) {
	const next = audio && typeof audio === "object" ? audio : {};
	const list = Array.isArray(next.list) ? next.list.filter((file) => typeof file === "string" && file) : [];
	const changed = list.join("\n") !== audioBus.list.join("\n");
	audioBus.list = list;
	audioBus.enabled = next.enabled === true;
	audioBus.reactive = next.reactive === true;
	audioBus.rate = Number.isFinite(next.rate) ? Math.min(2, Math.max(0.5, next.rate)) : 1;
	audioBus.volume = Number.isFinite(next.volume) ? Math.min(1, Math.max(0, next.volume)) : 0.6;
	if (changed) {
		audioBus.index = 0;
		audioBus.loaded = "";
	}
	audioApply();
}

/** User gesture hook: resume the context and start the current track. */
function audioKick() {
	const ctx = audioContext();
	if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
	audioApply();
}

function audioNext() {
	if (audioBus.list.length === 0) return;
	audioBus.index = (audioBus.index + 1) % audioBus.list.length;
	audioBus.loaded = "";
	audioApply();
}

function audioStartSystem() {
	const media = navigator.mediaDevices;
	if (!media?.getDisplayMedia) {
		audioSetError("当前环境不支持系统音频采集");
		return Promise.resolve(false);
	}
	return media
		.getDisplayMedia({ audio: true, video: true })
		.then((stream) => {
			const audioTracks = stream.getAudioTracks();
			if (audioTracks.length === 0) {
				for (const track of stream.getTracks()) track.stop();
				audioSetError("没有捕获到音频轨道，请勾选「分享系统音频」");
				return false;
			}
			for (const track of stream.getVideoTracks()) track.stop();
			const ctx = audioContext();
			if (!ctx) {
				for (const track of stream.getTracks()) track.stop();
				return false;
			}
			audioStopSystem();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			analyser.smoothingTimeConstant = 0.78;
			const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
			source.connect(analyser);
			audioBus.systemStream = stream;
			audioBus.systemSource = source;
			audioBus.systemAnalyser = analyser;
			audioBus.system = true;
			audioSetError("");
			return true;
		})
		.catch((error) => {
			audioSetError(error?.name === "NotAllowedError" ? "已取消系统音频授权" : String(error?.message ?? error));
			return false;
		});
}

function audioStopSystem() {
	const stream = audioBus.systemStream;
	audioBus.systemStream = null;
	audioBus.system = false;
	if (stream) {
		for (const track of stream.getTracks()) {
			try {
				track.stop();
			} catch {
				/* already stopped */
			}
		}
	}
	if (audioBus.systemSource) {
		try {
			audioBus.systemSource.disconnect();
		} catch {
			/* already disconnected */
		}
		audioBus.systemSource = null;
	}
	audioBus.systemAnalyser = null;
}

/** Energy of the active source, 0..1, with fast attack / slow release. */
function audioBeat() {
	const analyser = audioBus.systemStream ? audioBus.systemAnalyser : audioBus.analyser;
	if (!audioBus.reactive || !analyser) {
		audioBus.smooth *= 0.85;
		return 0;
	}
	const now = performance.now();
	const dt = Math.min(0.2, Math.max(0.001, (now - (audioBus.lastAt || now)) / 1000));
	audioBus.lastAt = now;
	if (!audioBus.freq || audioBus.freq.length !== analyser.frequencyBinCount) {
		audioBus.freq = new Uint8Array(analyser.frequencyBinCount);
	}
	analyser.getByteFrequencyData(audioBus.freq);
	const data = audioBus.freq;
	let sum = 0;
	for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
	const rms = Math.sqrt(sum / data.length) / 255;
	const edge = Math.max(1, Math.floor(data.length / 8));
	let low = 0;
	for (let i = 0; i < edge; i += 1) low += data[i];
	low /= edge * 255;
	const target = Math.min(1, rms * 2.1 + low * 0.95);
	const k = target > audioBus.smooth ? 1 - Math.exp(-dt / 0.02) : 1 - Math.exp(-dt / 0.3);
	audioBus.smooth += (target - audioBus.smooth) * k;
	return audioBus.smooth;
}
