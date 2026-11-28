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
import { createRequire } from 'node:module';

const nativeRequire = createRequire(process.execPath);
let installed = false;
let lastError = null;

function loadElectron() {
  const tried = [];
  const note = (label, error) => tried.push(label + ': ' + ((error && error.message) || String(error)));
  // Inside Electron's main process the builtin wins, but a plain Node
  // resolution of 'electron' returns the path shim (a string). Resolve from
  // the executable first, then fall back to the bare import.
  try {
    const api = nativeRequire('electron');
    if (api && api.session) return api;
    tried.push('native: ' + (typeof api));
  } catch (error) {
    note('native', error);
  }
  try {
    const api = require('electron');
    if (api && api.session) return api;
    tried.push('require: ' + (typeof api));
  } catch (error) {
    note('require', error);
  }
  throw new Error(tried.join(' | ') + ' | electron=' + (process.versions.electron || 'none'));
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

