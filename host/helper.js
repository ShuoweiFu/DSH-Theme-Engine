/**
 * Resident native capture helper (`bin/lg-capture.exe`).
 *
 * The helper is spawned once with `--serve` and then answers newline-delimited
 * JSON commands on stdin: `probe` returns a cheap window-geometry fingerprint,
 * `<0|1> <out.jpg>` captures the desktop (1 = also composite the windows below
 * DSH). Publishing a capture goes through one brightness gate so a capture that
 * suddenly went dark is never renamed into place.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, CAPTURE_EXE, CAPTURE_IMAGE_PATH, COMPOSITE_SCRIPT_PATH, STAGE_IMAGE_PATH } from './paths.js';
import { CAPTURE_SCRIPT, COMPOSITE_SCRIPT } from './scripts.js';
import { run, runPowerShellFile } from './run.js';

/**
 * Last known capture state, surfaced through `/liquid-glass/state` for
 * diagnosis. Mutated by publishCapture(); read by index.js.
 */
export const captureStats = {
  error: '',
  info: null,
  engine: '',
  ms: 0,
  lum: -1,
  darkStreak: 0,
  /** True while the helper is pushing live frames (`stream` command). */
  streaming: false,
  /** Frames published by the live stream since it started. */
  frames: 0,
  /** True when the last live frame arrived less than a second ago. */
  live: false,
  /** What Windows said about the yellow capture border. */
  borderless: null,
  /** Requested live frame rate. */
  fps: 0,
};






/** Wall-clock cost of the last capture, in ms (the native helper is ~10x faster). */

/** Cached promise while the helper is being checked, so parallel polls do not race. */
let captureHelperPromise = null;

/**
 * Long-lived capture helper. Spawning the exe per capture costs ~450 ms (of
 * which ~150 ms is .NET start-up and one cold JPEG encoder); a resident process
 * answers in ~140 ms. A dead or wedged helper is killed and respawned.
 * @type {import('node:child_process').ChildProcess | null}
 */
let helperProcess = null;
let helperBuffer = '';
/** @type {{ resolve: (value: string|null) => void, timer: NodeJS.Timeout } | null} */
let helperPending = null;
/** Serialises helper requests: one line in, one line out. */
let helperChain = Promise.resolve();

/**
 * Where the resident helper actually runs from. Windows locks a running image,
 * so the bundle copy cannot be replaced while a helper is alive; spawning from
 * a cache copy means a rebuilt `bin/lg-capture.exe` only has to be picked up by
 * the next spawn. Each build gets its own file name: overwriting a copy that a
 * just-exited helper still holds open fails with EBUSY on some machines.
 */
let runCopyKey = '';
let runCopyPath = '';

/** Copy the bundle helper into the cache dir once per exe version. */
async function prepareRunCopy() {
  let info;
  try {
    info = await stat(CAPTURE_EXE);
  } catch {
    return null;
  }
  const key = `${info.size}-${Math.round(info.mtimeMs)}`;
  if (key === runCopyKey && runCopyPath) return runCopyPath;
  const target = join(CACHE_DIR, `lg-capture-${key}.exe`);
  try {
    // A copy of this exact build may already be running (a previous host
    // generation spawned it, so its image is locked and copyFile would fail
    // with EBUSY). Same size means same bytes: reuse it and spawn our own
    // process from it instead.
    const existing = await stat(target);
    if (existing.size === info.size) {
      runCopyKey = key;
      runCopyPath = target;
      return target;
    }
  } catch {
    // Not there yet.
  }
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await copyFile(CAPTURE_EXE, target);
    runCopyKey = key;
    runCopyPath = target;
    return target;
  } catch {
    return null;
  }
}

/**
 * Live stream bookkeeping. The helper pushes `{"event":"frame",...}` lines
 * whenever the composed picture changed; each event is published (stage file →
 * served JPEG) through the same brightness gate as an on-demand capture.
 */
let streamChain = Promise.resolve();
let streamDropped = 0;
let streamLastAt = 0;

export function resetHelper(reason) {
  if (helperPending) {
    clearTimeout(helperPending.timer);
    helperPending.resolve(null);
    helperPending = null;
  }
  captureStats.streaming = false;
  captureStats.live = false;
  if (helperProcess) {
    try {
      helperProcess.kill();
    } catch {
      // Already gone.
    }
  }
  helperProcess = null;
  helperBuffer = '';
  if (reason) captureStats.error = `helper reset: ${reason}`;
}

/** Start the resident helper; resolves false when the exe cannot run at all. */
export async function startHelper() {
  if (helperProcess) return true;
  const runPath = await prepareRunCopy();
  if (!runPath) return false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let child;
    try {
      child = spawn(runPath, ['--serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      finish(false);
      return;
    }
    helperProcess = child;
    helperBuffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      helperBuffer += chunk;
      let index;
      while ((index = helperBuffer.indexOf('\n')) >= 0) {
        const line = helperBuffer.slice(0, index).trim();
        helperBuffer = helperBuffer.slice(index + 1);
        if (!line) continue;
        // Live frames arrive unsolicited, interleaved with command answers.
        if (line.includes('"event":"frame"')) {
          acceptStreamFrame(line);
          continue;
        }
        if (!helperPending) continue;
        const pending = helperPending;
        helperPending = null;
        clearTimeout(pending.timer);
        pending.resolve(line);
      }
    });
    child.on('exit', () => {
      if (helperProcess === child) resetHelper('');
    });
    child.on('error', () => {
      if (helperProcess === child) resetHelper('spawn error');
      finish(false);
    });
    // Resolve as soon as the process exists: the first command blocks on .NET
    // start-up inside the exe, which the per-command timeout covers.
    setTimeout(() => finish(true), 50);
  });
}

/**
 * Run one command on the resident helper. Commands are serialised: the helper
 * answers exactly one line per request, so a probe must never interleave with
 * a capture.
 * @param {string} payload
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
export function helperCommand(payload, timeoutMs = 6000) {
  const run = async () => {
    if (!helperProcess && !(await startHelper())) return null;
    if (!helperProcess) return null;
    if (helperPending) resetHelper('overlapping command');
    if (!helperProcess && !(await startHelper())) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resetHelper('timeout');
        resolve(null);
      }, timeoutMs);
      helperPending = { resolve, timer };
      try {
        helperProcess.stdin.write(payload);
      } catch {
        resetHelper('write failed');
        resolve(null);
      }
    });
  };
  const next = helperChain.then(run, run);
  helperChain = next.then(
    () => null,
    () => null
  );
  return next;
}

/**
 * Capture through the resident helper.
 * @param {string} outPath
 * @param {boolean} behind
 * @returns {Promise<string|null>}
 */
export async function captureViaHelper(outPath, behind) {
  return helperCommand(`${behind ? '1' : '0'} ${outPath}\n`);
}

/** True while a stream frame is being renamed into place; later frames drop. */
let streamBusy = false;

/**
 * Publish one unsolicited frame pushed by the helper's live engine. The helper
 * already wrote the JPEG to STAGE_IMAGE_PATH, so this is a rename plus the same
 * darkness gate an on-demand capture goes through.
 * @param {string} line raw JSON line from the helper
 */
function acceptStreamFrame(line) {
  if (streamBusy) {
    streamDropped += 1;
    return;
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (event?.event !== 'frame') return;
  streamBusy = true;
  const startedAt = Date.now() - (Number(event.ms) || 0);
  const parsed = {
    width: Number(event.w) || Number(captureStats.info?.width) || 0,
    height: Number(event.h) || Number(captureStats.info?.height) || 0,
    appsBehind: (Number(event.apps) || 0) > 0,
    apps: [],
    lum: Number(event.lum),
  };
  streamChain = streamChain.then(async () => {
    try {
      if (await publishCapture(parsed, 'stream', startedAt)) {
        captureStats.frames += 1;
        streamLastAt = Date.now();
        captureStats.live = true;
        captureStats.borderless = event.borderless === true;
      }
    } catch (error) {
      captureStats.error = `stream publish failed: ${error instanceof Error ? error.message : error}`;
    } finally {
      streamBusy = false;
    }
  });
}

/**
 * Ask the helper to keep capturing in the background. Frames are pushed on
 * stdout as `{"event":"frame"}` lines and published here immediately, so the
 * served wallpaper stays at the capture frame rate instead of the poll rate.
 * @param {number} fps
 * @param {boolean} behind
 * @returns {Promise<boolean>}
 */
export async function startStreaming(fps = 8, behind = true) {
  if (process.platform !== 'win32') return false;
  if (!(await ensureCaptureHelper())) return false;
  await mkdir(CACHE_DIR, { recursive: true });
  const line = await helperCommand(`stream ${fps} ${behind ? '1' : '0'} 0 ${STAGE_IMAGE_PATH}\n`, 10_000);
  if (!line) return false;
  try {
    const parsed = JSON.parse(line);
    if (parsed?.ok !== true) {
      captureStats.error = `stream refused: ${JSON.stringify(parsed).slice(0, 200)}`;
      return false;
    }
  } catch {
    return false;
  }
  captureStats.streaming = true;
  captureStats.fps = fps;
  streamDropped = 0;
  streamLastAt = Date.now();
  return true;
}

/** Ask the helper to stop its capture loop. */
export async function stopStreaming() {
  captureStats.streaming = false;
  captureStats.live = false;
  return helperCommand('stop\n', 6000);
}

/** True when a live frame arrived within the last second. */
export function streamIsLive() {
  if (!captureStats.streaming) return false;
  return Date.now() - streamLastAt < 1200;
}

/**
 * Retune the running engine's capture rate in place. Rebuilding the session
 * would flash the capture border and drop frames, so the engine re-reads its
 * rate every tick instead.
 * @param {number} fps
 */
export function setStreamFps(fps) {
  if (!captureStats.streaming) return;
  const want = Math.max(1, Math.min(30, Math.round(Number(fps) || 0)));
  if (!want || want === captureStats.fps) return;
  captureStats.fps = want;
  void helperCommand(`fps ${want}\n`, 3000).catch(() => {});
}

/**
 * Whether a resident helper process is running right now. A live stream with no
 * process behind it is a dead stream: the engine cannot be "idle" in a way that
 * matters here because a still desktop simply publishes no frames.
 */
export function helperAlive() {
  return helperProcess !== null;
}

/** How many frames the host had to drop because a rename was still running. */
export function streamDropCount() {
  return streamDropped;
}

/**
 * Ask the helper whether the desktop changed. Costs an enumeration, not a
 * render: it can safely run every second.
 * @returns {Promise<{fingerprint:string,active:number,dsh:boolean}|null>}
 */
export async function probeViaHelper() {
  if (!(await ensureCaptureHelper())) return null;
  const line = await helperCommand('probe\n', 4000);
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed?.ok !== true) return null;
    return {
      fingerprint: String(parsed.fingerprint ?? ''),
      active: Number(parsed.active) || 0,
      dsh: parsed.dsh === true,
    };
  } catch {
    return null;
  }
}

/**
 * Check that the bundled capture helper is present. It ships prebuilt, so this
 * is a stat, not a compile. A missing binary is not fatal: the caller falls back
 * to the PowerShell script, which is slower but always present.
 * @returns {Promise<boolean>}
 */
export async function ensureCaptureHelper() {
  if (captureHelperPromise) return captureHelperPromise;
  captureHelperPromise = (async () => {
    try {
      const info = await stat(CAPTURE_EXE);
      if (info.size < 50_000) {
        captureStats.error = `capture helper looks truncated: ${CAPTURE_EXE}`;
        return false;
      }
      return true;
    } catch {
      captureStats.error = `capture helper missing: ${CAPTURE_EXE}`;
      return false;
    }
  })();
  const ok = await captureHelperPromise;
  if (!ok) captureHelperPromise = null; // retry on the next capture
  return ok;
}

/** Capture the live desktop plus the windows hidden behind DSH into a JPEG. */
export async function captureDesktop(behind = true) {
  if (process.platform !== 'win32') return false;
  const startedAt = Date.now();
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // Fastest path: the resident helper answers in ~80 ms once warm.
    if (await ensureCaptureHelper()) {
      const served = await captureViaHelper(STAGE_IMAGE_PATH, behind);
      const parsedServed = parseCaptureLine(served ?? '');
      if (parsedServed) return publishCapture(parsedServed, 'helper', startedAt);
      // Cold path: a one-shot helper process (~150 ms), then the PowerShell script.
      const stdout = await run(CAPTURE_EXE, [STAGE_IMAGE_PATH, behind ? '1' : '0'], 20_000);
      const parsed = parseCaptureLine(stdout);
      if (parsed) return publishCapture(parsed, 'native', startedAt);
      captureStats.error = `native capture failed${stdout ? `: ${stdout.slice(0, 200)}` : ''}`;
    }
    // Fallback: the PowerShell script (250–600 ms of interpreter start-up).
    await writeFile(COMPOSITE_SCRIPT_PATH, COMPOSITE_SCRIPT, 'utf8');
    const result = await runPowerShellFile(COMPOSITE_SCRIPT_PATH, { LG_OUT: STAGE_IMAGE_PATH, LG_BEHIND: behind ? '1' : '0' }, 25_000);
    if (!result.ok) {
      captureStats.error = result.error;
      return false;
    }
    const parsed = parseCaptureLine(result.stdout);
    if (!parsed) return false;
    return publishCapture(parsed, 'powershell', startedAt);
  } catch (error) {
    captureStats.error = String(error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * @param {string} stdout
 * @returns {{width:number,height:number,appsBehind:boolean,apps:unknown[]}|null}
 */
export function parseCaptureLine(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('{'));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed?.ok !== true) {
      captureStats.error = `capture reported ${JSON.stringify(parsed).slice(0, 300)}`;
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Publish a capture atomically: the bytes land in STAGE_IMAGE_PATH first, then
 * a rename replaces the served JPEG in one step.
 * @param {{width:number,height:number,appsBehind:boolean,apps:unknown[]}} parsed
 * @param {'helper'|'native'|'powershell'} engine
 * @param {number} startedAt
 */
export async function publishCapture(parsed, engine, startedAt) {
  // The helper measures the luminance of the frame it just composed. A frame
  // that suddenly turns dark is the "wallpaper blinks black" symptom, and the
  // client cannot tell it apart from a genuinely dark desktop, so it is refused
  // here and the previous picture keeps being served. Two refusals in a row are
  // tolerated, the third is believed: switching to a dark wallpaper still works.
  const lum = Number(parsed?.lum);
  if (Number.isFinite(lum) && lum >= 0 && captureStats.lum > 0.12) {
    if (lum < Math.min(0.05, captureStats.lum * 0.35) && captureStats.darkStreak < 2) {
      captureStats.darkStreak += 1;
      captureStats.error = `discarded a dark capture (lum ${lum.toFixed(3)} after ${captureStats.lum.toFixed(3)})`;
      return false;
    }
  }
  try {
    // The live stream publishes several times a second while the renderer keeps
    // fetching /wallpaper, and Windows refuses to replace a file that a reader is
    // still holding (EPERM/EACCES/EBUSY). A short retry covers the fetch window;
    // a copy is the last resort because it can overwrite an open reader.
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rename(STAGE_IMAGE_PATH, CAPTURE_IMAGE_PATH);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 30 + attempt * 20));
      }
    }
    if (lastError) {
      await copyFile(STAGE_IMAGE_PATH, CAPTURE_IMAGE_PATH);
      lastError = null;
    }
  } catch (error) {
    // Keep the previous JPEG rather than serving a partial one.
    captureStats.error = `staging rename failed: ${error instanceof Error ? error.message : error}`;
    return false;
  }
  captureStats.darkStreak = 0;
  if (Number.isFinite(lum) && lum >= 0) captureStats.lum = lum;
  return applyCapture(parsed, engine, startedAt);
}

/**
 * @param {{width:number,height:number,appsBehind:boolean,apps:unknown[]}} parsed
 * @param {'helper'|'native'|'powershell'} engine
 * @param {number} startedAt
 */
export function applyCapture(parsed, engine, startedAt) {
  captureStats.info = {
    width: Number(parsed.width) || 0,
    height: Number(parsed.height) || 0,
    appsBehind: parsed.appsBehind === true,
    apps: Array.isArray(parsed.apps) ? parsed.apps : [],
  };
  captureStats.engine = engine;
  captureStats.ms = Date.now() - startedAt;
  captureStats.error = '';
  return true;
}

