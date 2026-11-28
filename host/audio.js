/**
 * System audio for audio-reactive web wallpapers.
 *
 * A wallpaper asks the engine for 128 spectrum values 16 times a second.
 * Wallpaper Engine itself reads the Windows loopback device. Electron can do
 * the same through getDisplayMedia, but only if the main process answers the
 * display-media request; otherwise Chromium opens a picker and may offer no
 * audio at all. This module installs that answer: video is a screen source
 * (Chromium insists on one), audio is the system loopback.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let installed = false;
let lastError = null;

export function hostFacts() {
  const facts = {
    type: process.type || null,
    electron: process.versions.electron || null,
    node: process.versions.node || null,
    argv0: process.argv0,
    execPath: process.execPath,
    requireType: typeof require,
    hasMainModule: Boolean(process.mainModule)
  };
  try {
    const api = createRequire(process.execPath)('electron');
    facts.native = api ? typeof api : 'null';
    facts.nativeSession = Boolean(api && api.session);
  } catch (error) {
    facts.native = 'err: ' + ((error && error.message) || error);
  }
  return facts;
}

function loadElectron() {
  const tried = [];
  const attempt = (label, factory) => {
    try {
      const api = factory();
      if (api && api.session) return api;
      tried.push(label + ': ' + (api === null || api === undefined ? String(api) : typeof api));
    } catch (error) {
      tried.push(label + ': ' + ((error && error.message) || String(error)));
    }
    return null;
  };
  // Electron hands main-process modules the builtin through its own loader.
  // A plugin host spawned as ELECTRON_RUN_AS_NODE has none of that, so every
  // route is tried and reported: the response alone says which process we are.
  const routes = [
    ['import.meta', () => createRequire(import.meta.url)('electron')],
    ['execPath', () => createRequire(process.execPath)('electron')],
    ['mainModule', () => process.mainModule && process.mainModule.require('electron')],
    ['global', () => globalThis.require && globalThis.require('electron')]
  ];
  for (const [label, factory] of routes) {
    const api = attempt(label, factory);
    if (api) return api;
  }
  throw new Error(
    tried.join(' | ') +
      ' | type=' + (process.type || 'none') +
      ' electron=' + (process.versions.electron || 'none') +
      ' argv0=' + process.argv0
  );
}

export async function installLoopback() {
  if (installed) return { ok: true, installed: true };
  let api = null;
  try {
    api = loadElectron();
  } catch (error) {
    lastError = 'electron import: ' + ((error && error.message) || error);
    return { ok: false, installed: false, error: lastError };
  }
  if (!api || !api.session || !api.session.defaultSession) {
    lastError = 'electron session unavailable';
    return { ok: false, installed: false, error: lastError };
  }
  try {
    api.session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = api.desktopCapturer ? await api.desktopCapturer.getSources({ types: ['screen'] }) : [];
        callback({ video: sources[0], audio: 'loopback' });
      } catch (error) {
        callback({});
      }
    }, { useSystemPicker: false });
    installed = true;
    lastError = null;
    return { ok: true, installed: true };
  } catch (error) {
    lastError = 'handler: ' + ((error && error.message) || error);
    return { ok: false, installed: false, error: lastError };
  }
}

export function loopbackStatus() {
  return { ok: true, installed, error: lastError };
}

// ---------------------------------------------------------------------------
// System loopback through bin/lg-audio.exe
//
// The plugin host is an Electron *utility* process (spawned with
// --expose-internals running dsh-desktop-host/lib/index.js), so the electron
// module is not there: no session, no display-media handler, and
// getDisplayMedia() in the page is refused. WASAPI is still reachable from an
// ordinary process, so the helper captures and analyses, printing 128 band
// levels per frame; this module keeps the newest line.
// ---------------------------------------------------------------------------

let spectrumChild = null;
const spectrum = { bins: null, at: 0, frames: 0, error: null };

function spectrumBinary() {
  return fileURLToPath(new URL('../bin/lg-audio.exe', import.meta.url));
}

function parseSpectrumLine(line) {
  const parts = line.split(',');
  if (parts.length !== 128) return null;
  const bins = new Float32Array(128);
  for (let i = 0; i < 128; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    bins[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }
  return bins;
}

export function startSpectrum() {
  if (spectrumChild && !spectrumChild.killed) return spectrumStatus();
  try {
    spectrumChild = spawn(spectrumBinary(), [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    spectrum.error = 'spawn: ' + ((error && error.message) || error);
    spectrumChild = null;
    return spectrumStatus();
  }
  spectrum.error = null;
  let pending = '';
  spectrumChild.stdout.setEncoding('utf8');
  spectrumChild.stdout.on('data', (chunk) => {
    pending += chunk;
    const cut = pending.lastIndexOf('\n');
    if (cut < 0) {
      if (pending.length > 4096) pending = '';
      return;
    }
    const rows = pending.slice(0, cut).split('\n').filter((row) => row.indexOf(',') > 0);
    pending = pending.slice(cut + 1);
    const line = rows.length ? rows[rows.length - 1].trim() : '';
    const bins = line ? parseSpectrumLine(line) : null;
    if (!bins) return;
    spectrum.bins = bins;
    spectrum.at = Date.now();
    spectrum.frames += 1;
  });
  spectrumChild.stderr.setEncoding('utf8');
  spectrumChild.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) spectrum.error = text.slice(0, 240);
  });
  spectrumChild.on('error', (error) => {
    spectrum.error = 'child: ' + ((error && error.message) || error);
    spectrumChild = null;
  });
  spectrumChild.on('exit', (code) => {
    if (code) spectrum.error = 'exit ' + code + (spectrum.error ? ': ' + spectrum.error : '');
    spectrum.bins = null;
    spectrumChild = null;
  });
  return spectrumStatus();
}

export function spectrumStatus() {
  const age = spectrum.at ? Date.now() - spectrum.at : -1;
  const live = Boolean(spectrum.bins) && age >= 0 && age < 800;
  return {
    ok: live,
    running: Boolean(spectrumChild && !spectrumChild.killed),
    ageMs: age,
    frames: spectrum.frames,
    error: spectrum.error,
    bins: spectrum.bins ? Array.from(spectrum.bins, (v) => Math.round(v * 1000) / 1000) : null
  };
}

export function stopSpectrum() {
  if (!spectrumChild) return { ok: true, running: false };
  try { spectrumChild.kill(); } catch (error) { /* already gone */ }
  spectrumChild = null;
  spectrum.bins = null;
  return { ok: true, running: false };
}
