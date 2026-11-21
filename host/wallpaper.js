/**
 * Wallpaper discovery and HTTP helpers: resolve the configured wallpaper, ask
 * Wallpaper Engine what it is playing, and stream file responses.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { CACHE_DIR } from './paths.js';
import { CAPTURE_SCRIPT, MACOS_SCRIPT, POWERSHELL_SCRIPT } from './scripts.js';
import { run } from './run.js';

/**
 * @param {string} configured
 * @returns {Promise<{ path: string, source: string } | null>}
 */
export async function detectWallpaper(configured) {
  if (configured) return { path: configured, source: 'config' };

  if (process.platform === 'win32') {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      POWERSHELL_SCRIPT,
    ]);
    const firstLine = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return firstLine ? { path: firstLine, source: 'windows' } : null;
  }

  if (process.platform === 'darwin') {
    const output = await run('/usr/bin/osascript', ['-e', MACOS_SCRIPT]);
    return output ? { path: output, source: 'macos' } : null;
  }

  const output = await run('gsettings', ['get', 'org.gnome.desktop.background', 'picture-uri']);
  const quoted = output.replace(/^'(.*)'$/, '$1').replace(/^file:\/\//, '');
  return quoted ? { path: decodeURIComponent(quoted), source: 'linux' } : null;
}

export function mimeOf(data, file) {
  const bytes = data ?? Buffer.alloc(0);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    // HEIC/HEIF stills are common Wallpaper Engine poster frames; without this
    // they were served as image/jpeg and the browser refused to decode them.
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'mif1') return 'image/heic';
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'mp42' || brand === 'isom') return 'video/mp4';
  }
  const lower = String(file).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return 'image/jpeg';
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Read Wallpaper Engine's active wallpaper (video or scene/web). */
export async function readWallpaperEngine() {
  if (process.platform !== 'win32') return null;
  try {
    const exe = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='wallpaper64.exe' OR Name='wallpaper32.exe'\" | Sort-Object { $_.Name -eq 'wallpaper64.exe' } -Descending | Select-Object -First 1).ExecutablePath",
    ], 6000);
    const path = exe.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    if (!path) return null;
    const root = dirname(path);
    const configPath = join(root, 'config.json');
    let configInfo;
    try {
      configInfo = await stat(configPath);
    } catch {
      return null;
    }
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const users = config && typeof config === 'object' ? config : {};
    for (const key of Object.keys(users)) {
      const entry = users[key];
      const selected = entry?.general?.wallpaperconfig?.selectedwallpapers;
      if (!selected || typeof selected !== 'object') continue;
      for (const monitor of Object.keys(selected)) {
        const file = selected[monitor]?.file;
        if (typeof file !== 'string') continue;
        try {
          const info = await stat(file);
          if (!info.isFile()) continue;
          const video = /\.(mp4|webm)$/i.test(file);
          return {
            path: file,
            name: basename(file),
            mtime: Math.round(info.mtimeMs),
            bytes: info.size,
            kind: video ? 'video' : 'scene',
            source: 'wallpaper-engine',
            configMtime: Math.round(configInfo.mtimeMs),
          };
        } catch {
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serve a media file with HTTP range support (video seeking needs 206 replies).
 * @param {string} file
 * @param {string} type
 * @param {string} mtime
 * @param {Request} request
 */
export async function streamFile(file, type, mtime, request) {
  const total = (await stat(file)).size;
  const range = request?.headers?.get?.('range') ?? '';
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  const baseHeaders = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-liquid-glass-mtime': mtime,
  };
  if (match) {
    const hasStart = match[1] !== '';
    const hasEnd = match[2] !== '';
    let start = 0;
    let end = total - 1;
    if (!hasStart && hasEnd) {
      // Suffix range (`bytes=-500`): the last N bytes, not the first N.
      const suffix = Number(match[2]);
      start = Number.isFinite(suffix) ? Math.max(0, total - suffix) : total;
      end = total - 1;
    } else if (hasStart) {
      start = Number(match[1]);
      end = hasEnd ? Math.min(Number(match[2]), total - 1) : total - 1;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < total && start <= end) {
      const body = Readable.toWeb(createReadStream(file, { start, end }));
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${total}`,
          'content-length': String(end - start + 1),
        },
      });
    }
    // A range past EOF (or a zero-length suffix) must be 416, not the whole
    // file with a 200: the renderer would treat that as a successful seek.
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'content-range': `bytes */${total}` },
    });
  }
  const body = Readable.toWeb(createReadStream(file));
  return new Response(body, { status: 200, headers: { ...baseHeaders, 'content-length': String(total) } });
}

