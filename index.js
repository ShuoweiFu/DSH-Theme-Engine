/**
 * DSH Theme Engine (liquid-glass) — host half.
 *
 * Resolves the desktop wallpaper and serves it over the DSH web server so the
 * client half can paint it behind the transparent UI. Only the `webServer`
 * service is required.
 *
 * Sources, best first:
 * 1. A Wallpaper Engine video wallpaper (icon-free, exact same picture as the
 *    desktop, served with HTTP range support so the renderer can seek to one
 *    frame without downloading 256 MB).
 * 2. A static wallpaper file (icon-free).
 * 3. A Windows.Graphics.Capture grab of the desktop (supports scene/web live
 *    wallpapers, but the captured picture also contains the desktop icons).
 *
 * The host also reports whether any application window sits *below* the DSH
 * window. The client uses that to only show glass when the only thing behind
 * the app really is the wallpaper.
 */
export const name = 'liquid-glass';
export const inject = ['webServer'];

/** @typedef {{ wallpaperPath?: string, bench?: number }} Config */

const DEFAULT_CONFIG = {
  wallpaperPath: '',
  // Diagnostic: >0 makes the client render N frames with gl.finish() and report
  // the closed-loop ms/frame. 0 disables it.
  bench: 0,
};
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { CAPTURE_IMAGE_PATH, STATE_TTL_MS } from './host/paths.js';
import {
  captureStats,
  captureDesktop,
  probeViaHelper,
  resetHelper,
  startStreaming,
  stopStreaming,
  streamDropCount,
  streamIsLive,
  helperAlive,
  setStreamFps,
} from './host/helper.js';
import { detectWallpaper, jsonResponse, kindOf, mimeOf, readWallpaperEngine, streamFile } from './host/wallpaper.js';
import { checkForUpdates } from './host/update-check.js';
import { elysiaEngineStatus, listDirectory, mediaFile, previewFor, weState } from './host/wallpaper-engine.js';
import { openWebRoot, serveWebFile, webLogs } from './host/web-frame.js';
import { runPowerShellFile } from './host/run.js';
import { GATE_SCRIPT } from './host/scripts.js';
import { CACHE_DIR, GATE_SCRIPT_PATH } from './host/paths.js';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Mount the wallpaper endpoints.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Config} [config]
 */
export function apply(ctx, config) {
  const options = { ...DEFAULT_CONFIG, ...(config ?? {}) };

  /** Live capture frame rate requested from the helper. */
  const STREAM_FPS = 8;
  /** Pending start of the live capture loop. */
  /** @type {Promise<boolean> | null} */
  let streamRequest = null;

  /** @type {{ at: number, value: any } | null} */
  let captureAt = 0;
  /** @type {Promise<boolean> | null} */
  let captureInFlight = null;
  /** Whether the last capture composited the occluded windows below DSH. */
  let captureBehind = null;
  /** @type {string} */
  let desktopFingerprint = '';
  /** When the last probe attempt failed (0 = never); throttles fallback captures. */
  let probeFailedAt = 0;
  let desktopActive = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let desktopWatcher = null;
  let lastClientError = '';
  /** Overlay render crashes are kept apart: perf reports would overwrite them. */
  let lastClientOverlay = '';
  let lastClientReady = '';
  let lastHardware = '';
  let lastClientBench = '';

  /** @type {{ at: number, value: any } | null} */
  let gateCache = null;
  /** @type {Promise<any> | null} */
  let gateInFlight = null;

  /** @type {{ at: number, value: any } | null} */
  let weCache = null;
  /** @type {Promise<any> | null} */
  let weInFlight = null;

  function captureOnce(behind = true) {
    if (!captureInFlight) {
      captureBehind = behind;
      captureInFlight = captureDesktop(behind).then((ok) => {
        captureAt = Date.now();
        captureInFlight = null;
        return ok;
      });
    }
    return captureInFlight;
  }

  /**
   * Start the helper's live capture loop once. While it runs, the helper keeps
   * pushing the newest composed frame instead of the host asking for one, which
   * is what makes the glass follow the desktop in real time.
   * @param {boolean} behind
   */
  async function ensureStreaming(behind) {
    // A dead helper leaves `streaming` set; only a running process can keep it.
    if (captureStats.streaming && !helperAlive()) captureStats.streaming = false;
    if (captureStats.streaming) return true;
    if (streamRequest) return streamRequest;
    streamRequest = (async () => {
      const ok = await startStreaming(STREAM_FPS, behind).catch(() => false);
      if (!ok) return false;
      // Wait for the first pushed frame so an on-demand capture never races the
      // engine for the staging file.
      for (let i = 0; i < 40; i++) {
        if (streamIsLive()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return captureStats.streaming;
    })();
    try {
      return await streamRequest;
    } finally {
      streamRequest = null;
    }
  }

  /**
   * Capture only when the desktop actually changed. `probe` hashes the window
   * geometry without asking any window to render, so an idle desktop (an
   * animated wallpaper scene included) costs nothing and never re-captures —
   * which is what made the wallpaper flash every poll.
   * @param {boolean} behind
   */
  async function captureIfChanged(behind) {
    if (captureStats.streaming && !helperAlive()) captureStats.streaming = false;
    // The resident engine owns the staging file for as long as it streams: an
    // on-demand capture would race it for the same path. Liveness only decides
    // whether the page sees a brand-new frame, not who captures.
    if (captureStats.streaming) return true;
    const fresh = captureBehind === behind && Date.now() - captureAt < STATE_TTL_MS;
    if (fresh) return true;
    const probe = await probeViaHelper().catch(() => null);
    if (!probe) {
      // Without a probe there is no way to tell whether the desktop moved, so
      // back off instead of capturing on every tick: one capture per 5 s keeps
      // the wallpaper usable while the helper is rebuilding.
      if (Date.now() - probeFailedAt < 5000) return Boolean(captureStats.info);
      probeFailedAt = Date.now();
      return captureOnce(behind);
    }
    const sameDesktop = probe.fingerprint !== '' && probe.fingerprint === desktopFingerprint;
    desktopFingerprint = probe.fingerprint;
    desktopActive = probe.active;
    if (sameDesktop && captureStats.info) return true; // serve the frame we already have
    return captureOnce(behind);
  }

  /** Poll the cheap fingerprint so a window switch is picked up within ~1 s. */
  function startDesktopWatch() {
    if (desktopWatcher) return;
    desktopWatcher = setInterval(() => {
      if (captureInFlight) return;
      void captureIfChanged(captureBehind ?? true).catch(() => {});
    }, 1100);
    desktopWatcher.unref?.();
  }

  function wallpaperEngine(force = false) {
    if (!force && weCache && Date.now() - weCache.at < 60_000) return Promise.resolve(weCache.value);
    if (!weInFlight) {
      weInFlight = readWallpaperEngine().then((value) => {
        weCache = { at: Date.now(), value };
        weInFlight = null;
        return value;
      });
    }
    return weInFlight;
  }

  /**
   * Content fingerprint so the client can skip a texture upload when the
   * desktop did not actually change. Recapturing every ~1 s otherwise
   * re-uploads a nearly identical bitmap and the wallpaper visibly jumps.
   * @type {Map<string, { mtime: number, bytes: number, digest: string }>}
   */
  const digestCache = new Map();

  async function digestOf(path, mtime, bytes) {
    const cached = digestCache.get(path);
    if (cached && cached.mtime === mtime && cached.bytes === bytes) return cached.digest;
    try {
      const data = await readFile(path);
      const digest = createHash('sha1').update(data).digest('hex').slice(0, 16);
      digestCache.set(path, { mtime, bytes, digest });
      return digest;
    } catch {
      return '';
    }
  }

  async function valueFor(resolved) {
    try {
      const info = await stat(resolved.path);
      if (!info.isFile()) return null;
      const mtime = Math.round(info.mtimeMs);
      return {
        available: true,
        path: resolved.path,
        name: resolved.source === 'desktop' ? 'desktop-wallpaper.jpg' : basename(resolved.path) || 'wallpaper',
        mtime,
        bytes: info.size,
        digest: await digestOf(resolved.path, mtime, info.size),
        source: resolved.source,
      };
    } catch {
      return null;
    }
  }

  /** @type {Map<string, { at: number, value: any }>} */
  const stateCache = new Map();

  async function state(force, mode = 'desktop', behind = true, custom = '') {
    const cacheKey = `${mode}:${behind ? 1 : 0}:${custom}`;
    const cached = stateCache.get(cacheKey);
    // While the helper streams, the served JPEG changes every ~125 ms, so the
    // state has to be re-read far more often than the idle TTL allows.
    const ttl = captureStats.live ? 120 : STATE_TTL_MS;
    if (!force && cached && Date.now() - cached.at < ttl) return cached.value;

    const configured = String(options.wallpaperPath ?? '').trim();
    /** @type {any} */
    let value = { available: false, path: '', name: '', mtime: 0, bytes: 0, source: 'none', kind: 'image' };

    // The settings page can pin an exact media file (a Wallpaper Engine video
    // project or a hand-picked image/video). Serve it directly instead of
    // capturing the desktop; hashing a multi-hundred-MB video is not worth it,
    // so the digest is derived from mtime and size.
    const pinned = custom ? await mediaFile(custom) : null;
    if (pinned) {
      value = {
        available: true,
        path: pinned.path,
        name: pinned.name,
        mtime: Math.round(pinned.mtime),
        bytes: pinned.size,
        digest: `m${Math.round(pinned.mtime)}-${pinned.size}`,
        source: 'file',
        kind: pinned.kind,
      };
    } else if (configured) {
      value = (await valueFor({ path: configured, source: 'config' })) ?? value;
      value.kind = kindOf(configured);
    } else if (process.platform === 'win32') {
      // "desktop" mode wants the real desktop behind the window, icons included.
      if (mode === 'desktop') {
        await ensureStreaming(behind);
        const captured = await captureIfChanged(behind);
        // A failed capture must not blank the glass: the previous frame is still
        // on disk, so keep serving it until a new one succeeds.
        if (captured || captureStats.info) {
          value = (await valueFor({ path: CAPTURE_IMAGE_PATH, source: 'desktop' })) ?? value;
        }
      }
      // 1) Wallpaper Engine video wallpaper: same picture as the desktop and
      //    free of icons, because it is the wallpaper's own asset.
      if (!value.available) {
        const we = await wallpaperEngine();
        if (we && we.kind === 'video') {
          value = { ...we, available: true };
        }
        // 2) Wallpaper Engine scene/web wallpaper: no file to read, capture the
        //    live desktop instead (the capture also contains the icons).
        if (!value.available && we && we.kind === 'scene') {
          const captured = await captureIfChanged(behind);
          if (captured || captureStats.info) {
            value = (await valueFor({ path: CAPTURE_IMAGE_PATH, source: 'desktop' })) ?? value;
          }
        }
      }
      // 3) No Wallpaper Engine: the configured static wallpaper file is exact
      //    and icon-free, so prefer it over a screen capture.
      if (!value.available) {
        const resolved = await detectWallpaper('');
        if (resolved) {
          value = (await valueFor(resolved)) ?? value;
          value.kind = 'image';
        }
      }
      // 4) Last resort: a live desktop capture (skipped in icon-free mode).
      if (!value.available && mode !== 'wallpaper') {
        const captured = await captureIfChanged(behind);
        if (captured || captureStats.info) {
          value = (await valueFor({ path: CAPTURE_IMAGE_PATH, source: 'desktop' })) ?? value;
        }
      }
    } else {
      const resolved = await detectWallpaper('');
      if (resolved) value = (await valueFor(resolved)) ?? value;
    }

    stateCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  function gate() {
    if (gateCache && Date.now() - gateCache.at < 2000) return Promise.resolve(gateCache.value);
    if (!gateInFlight) {
      gateInFlight = (async () => {
        try {
          await mkdir(CACHE_DIR, { recursive: true });
          await writeFile(GATE_SCRIPT_PATH, GATE_SCRIPT, 'utf8');
          const result = await runPowerShellFile(GATE_SCRIPT_PATH, null, 8000);
          const line = result.stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
          const parsed = line ? JSON.parse(line) : { found: false };
          gateCache = { at: Date.now(), value: parsed };
          return parsed;
        } catch {
          const fallback = { found: false };
          gateCache = { at: Date.now(), value: fallback };
          return fallback;
        } finally {
          gateInFlight = null;
        }
      })();
    }
    return gateInFlight;
  }

  /**
   * The page reports its renderer stats whenever they change. Use that as the
   * pressure signal for the capture engine: a hidden window or a renderer that
   * cannot hit its target rate does not need eight desktop frames per second,
   * and throttling the *capture* side is free — the engine keeps its session.
   */
  function tuneStreamFromPerf(body) {
    if (!captureStats.streaming) return;
    let perf = null;
    try {
      perf = JSON.parse(body);
    } catch {
      return;
    }
    const stats = perf?.stats ?? null;
    const target = Number(perf?.settings?.fps) || 30;
    const running = stats?.mode === 'running';
    const fps = Number(stats?.fps) || 0;
    const want = !running ? 2 : fps > 0 && fps < target * 0.6 ? 4 : STREAM_FPS;
    setStreamFps(want);
  }

  const disposers = [];

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/log',
    resource: async (request) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const text = String(url.searchParams.get('msg') ?? '').slice(0, 4000);
        if (text.startsWith('overlay:')) lastClientOverlay = text;
        else if (text.startsWith('ready:') || text.startsWith('build:')) lastClientReady = text;
        else if (text.startsWith('hw:')) lastHardware = text;
        else if (text.startsWith('bench:')) lastClientBench = text;
        else if (text) lastClientError = text;
        if (text.startsWith('perf: ')) tuneStreamFromPerf(text.slice(6));
      } catch {
        // A failed read only costs diagnostics.
      }
      return jsonResponse({ ok: true });
    },
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/state',
    resource: async (request) => {
      try {
        let mode = 'desktop';
        let behind = true;
        let custom = '';
        try {
          const params = new URL(request.url, 'http://127.0.0.1').searchParams;
          mode = params.get('source') === 'wallpaper' ? 'wallpaper' : 'desktop';
          behind = params.get('behind') !== '0';
          custom = params.get('path') ?? '';
        } catch {
          // Default mode wins when the query string is unreadable.
        }
        const value = await state(false, mode, behind, custom);
        return jsonResponse({
          ok: true,
          available: value.available,
          name: value.name,
          mtime: value.mtime,
          bytes: value.bytes,
          digest: value.digest ?? '',
          source: value.source,
          kind: value.kind,
          appsBehind: captureStats.info?.appsBehind === true,
          apps: captureStats.info?.apps ?? [],
          captureSize: captureStats.info ? [captureStats.info.width, captureStats.info.height] : null,
          captureBehind: captureBehind === null ? null : captureBehind,
          captureEngine: captureStats.engine,
          captureMs: captureStats.ms,
          stateTtlMs: STATE_TTL_MS,
          streaming: captureStats.streaming === true,
          live: streamIsLive(),
          streamFps: captureStats.fps || 0,
          streamFrames: captureStats.frames || 0,
          streamDropped: streamDropCount(),
          borderless: captureStats.borderless,
          captureError: captureStats.error,
          clientError: lastClientError,
          clientOverlayError: lastClientOverlay,
          clientReady: lastClientReady,
          clientHardware: lastHardware,
          bench: Number(options.bench) || 0,
          clientBench: lastClientBench,
          elysia: await elysiaEngineStatus(),
        });
      } catch (error) {
        return jsonResponse({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
      }
    },
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/gate',
    resource: async () => jsonResponse(await gate()),
  }));

  // Update checks for the three distribution channels (npm / git tags /
  // GitHub releases). Cached for ten minutes; ?force=1 bypasses the cache.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/update',
    resource: async (request) => {
      try {
        let force = false;
        try {
          force = new URL(request.url, 'http://127.0.0.1').searchParams.get('force') === '1';
        } catch {
          // Unreadable query string: use the cache.
        }
        return jsonResponse(await checkForUpdates({ force }));
      } catch (error) {
        return jsonResponse({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
      }
    },
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/wallpaper',
    resource: async (request) => {
      let mode = 'desktop';
      let behind = true;
      let custom = '';
      try {
        const params = new URL(request.url, 'http://127.0.0.1').searchParams;
        mode = params.get('source') === 'wallpaper' ? 'wallpaper' : 'desktop';
        behind = params.get('behind') !== '0';
        custom = params.get('path') ?? '';
      } catch {
        // Default mode wins when the query string is unreadable.
      }
      const value = await state(false, mode, behind, custom);
      if (!value.available) {
        return new Response('wallpaper unavailable', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      try {
        if (value.kind === 'video' || value.kind === 'animation') return streamFile(value.path, mimeOf(null, value.path), String(value.mtime), request);
        const data = await readFile(value.path);
        return new Response(new Uint8Array(data), {
          headers: {
            'content-type': mimeOf(data, value.path),
            'cache-control': 'no-store',
            'x-liquid-glass-mtime': String(value.mtime),
          },
        });
      } catch (error) {
        return new Response(`wallpaper read failed: ${String(error instanceof Error ? error.message : error)}`, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    },
  }));

  /**
   * Serve a local media file: range-capable for video/audio, whole-file for
   * images. Shared by the wallpaper, preview and generic media routes.
   * @param {{ path: string, kind: string, mtime: number }} media
   * @param {Request} request
   */
  async function serveMedia(media, request) {
    if (media.kind === 'video' || media.kind === 'audio' || media.kind === 'animation') {
      return streamFile(media.path, mimeOf(null, media.path), String(media.mtime), request);
    }
    const data = await readFile(media.path);
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': mimeOf(data, media.path),
        'cache-control': 'no-store',
        'x-liquid-glass-mtime': String(media.mtime),
      },
    });
  }

  // ---- Wallpaper Engine bridge + custom media -----------------------------
  // The settings page browses the real Wallpaper Engine library and can pin any
  // image / video / audio file, so the host exposes a small read-only bridge.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/we',
    resource: async (request) => {
      try {
        let force = false;
        try {
          force = new URL(request.url, 'http://127.0.0.1').searchParams.get('force') === '1';
        } catch {
          // Unreadable query string: use the cache.
        }
        return jsonResponse(await weState(force));
      } catch (error) {
        return jsonResponse({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
      }
    },
  }));
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/we/preview',

    resource: async (request) => {
      try {
        const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id') ?? '';
        const media = await previewFor(id);
        if (!media) {
          return new Response('preview unavailable', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        return serveMedia(media, request);
      } catch (error) {
        return new Response(`preview failed: ${String(error instanceof Error ? error.message : error)}`, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    },
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/fs',
    resource: async (request) => {
      try {
        const target = new URL(request.url, 'http://127.0.0.1').searchParams.get('path') ?? '';
        return jsonResponse(await listDirectory(target));
      } catch (error) {
        return jsonResponse({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
      }
    },
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/media',
    resource: async (request) => {
      try {
        const media = await mediaFile(new URL(request.url, 'http://127.0.0.1').searchParams.get('path') ?? '');
        if (!media) {
          return new Response('media unavailable', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        return serveMedia(media, request);
      } catch (error) {
        return new Response(`media failed: ${String(error instanceof Error ? error.message : error)}`, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    },
  }));
  // Web wallpapers: one workshop folder is mirrored at a time. The client opens
  // a folder with /web/open and then points a sandboxed iframe at /web/index.html;
  // relative asset URLs in that page resolve back into this same prefix route.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/web/open',

    resource: async (request) => {
      try {
        const dir = new URL(request.url, 'http://127.0.0.1').searchParams.get('dir') ?? '';
        return jsonResponse(await openWebRoot(dir));
      } catch (error) {
        return jsonResponse({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
      }
    },
  }));

  // What the sandboxed page reported, newest last. Handy in bug reports.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/liquid-glass/web-logs',

    resource: async () => jsonResponse({ ok: true, logs: webLogs() }),
  }));

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/liquid-glass/web',

    resource: async (request) => {
      try {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        const relative = pathname.slice('/liquid-glass/web'.length).replace(/^\/+/, '');
        return await serveWebFile(relative, new URL(request.url, 'http://127.0.0.1').searchParams);
      } catch (error) {
        return new Response(`web wallpaper failed: ${String(error instanceof Error ? error.message : error)}`, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    },
  }));
  // Event-driven capture: the watcher only asks for a new frame when the
  // window geometry changed, so an idle desktop is never re-captured.
  startDesktopWatch();

  ctx.effect(() => () => {
    if (desktopWatcher) clearInterval(desktopWatcher);
    desktopWatcher = null;
    for (const dispose of disposers) dispose();
    // Never leave the resident capture helper (or its capture loop) behind.
    void stopStreaming().catch(() => {});
    resetHelper('');
  });
}
