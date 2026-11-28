/**
 * Wallpaper Engine / Steam bridge.
 *
 * Reads the local Steam libraries and the Wallpaper Engine config so the
 * settings page can show the real wallpaper library instead of guessing. The
 * module is deliberately independent from the capture stack: every probe
 * returns `null` / empty data instead of throwing, so a machine without Steam
 * keeps a working settings page.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { run } from './run.js';

/** Steam app id of Wallpaper Engine. */
export const STEAM_APP_ID = '431960';
const WORKSHOP_DIR = join('steamapps', 'workshop', 'content', STEAM_APP_ID);
const WE_DIR = join('steamapps', 'common', 'wallpaper_engine');
const CACHE_MS = 20_000;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng', '.bmp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']);
const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus']);
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT]);

/** @type {{ at: number, value: any } | null} */
let cache = null;
/** @type {Promise<any> | null} */
let pending = null;

/** Strip quotes / control characters Windows hands back from the registry. */
function cleanPath(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    // Steam writes `D:\\Program Files\\Steam` inside libraryfolders.vdf, and the
    // registry value uses forward slashes: normalize both to normal paths.
    .replace(/\\\\/g, '\\')
    .replace(/\//g, '\\')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function normKey(value) {
  // Trailing separators must not create a second identity for one folder:
  // `D:\Steam` and `D:\Steam\` are the same library, and without this the
  // scan treats them as two roots and lists every wallpaper twice.
  return cleanPath(value).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function fileInfo(file) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

/**
 * Steam library roots, install drive first, then every entry of the
 * `libraryfolders.vdf` files (Steam stores extra libraries in there).
 * @returns {Promise<string[]>}
 */
export async function steamRoots() {
  /** @type {string[]} */
  const candidates = [];
  const raw = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], 4000);
  const match = /REG_SZ\s+(.+)/i.exec(raw);
  if (match) candidates.push(cleanPath(match[1]));
  candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'C:\\Steam');

  const seen = new Set();
  /** @type {string[]} */
  const roots = [];
  const add = (value) => {
    const path = cleanPath(value);
    const key = normKey(path);
    if (!path || seen.has(key)) return;
    seen.add(key);
    roots.push(path);
  };

  for (const root of candidates) {
    add(root);
    if (!(await exists(root))) continue;
    const vdf = await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
    for (const entry of vdf.matchAll(/"path"\s+"([^"]+)"/g)) add(entry[1]);
  }
  /** @type {string[]} */
  const existing = [];
  for (const root of roots) {
    if (!/^[a-z]:\\/i.test(root)) continue;
    if (await exists(root)) existing.push(root);
  }
  return existing;
}

/**
 * Wallpaper Engine install directory (`steamapps/common/wallpaper_engine`).
 * @param {readonly string[]} roots
 * @returns {Promise<string | null>}
 */
export async function weInstallRoot(roots) {
  for (const root of roots) {
    const dir = join(root, WE_DIR);
    if (await exists(join(dir, 'wallpaper64.exe'))) return dir;
    if (await exists(join(dir, 'wallpaper32.exe'))) return dir;
  }
  return null;
}

/**
 * Parse the Wallpaper Engine `config.json` into the bits we actually use.
 * @param {string} installRoot
 */
export async function readWeConfig(installRoot) {
  const file = join(installRoot, 'config.json');
  const text = await readFile(file, 'utf8').catch(() => '');
  if (!text) return null;
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  let userKey = '';
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('?') || !value || typeof value !== 'object') continue;
    if (/** @type {any} */ (value).general && typeof /** @type {any} */ (value).general === 'object') {
      userKey = key;
      break;
    }
  }
  if (!userKey) return null;

  const user = /** @type {any} */ (data[userKey]);
  const general = user.general ?? {};
  const selected = general.wallpaperconfig?.selectedwallpapers ?? {};
  const recent = general.wallpaperconfig?.wallpaperconfigrecent ?? [];
  const info = await fileInfo(file);
  return {
    file,
    userKey,
    general,
    user: general.user ?? {},
    selected: Object.entries(selected)
      .map(([monitor, entry]) => ({ monitor, file: cleanPath(/** @type {any} */ (entry)?.file ?? '') }))
      .filter((entry) => entry.file),
    recent: Array.isArray(recent) ? recent.map((title) => String(title)).slice(0, 16) : [],
    wproperties: user.wproperties ?? {},
    mtime: info?.mtimeMs ?? 0,
  };
}

/** Normalize the Wallpaper Engine project type. */
function projectType(value) {
  const type = String(value ?? '').toLowerCase();
  if (type === 'video') return 'video';
  if (type === 'scene') return 'scene';
  if (type === 'web') return 'web';
  if (type === 'application') return 'app';
  return 'other';
}

/**
 * Read one workshop item.
 * @param {string} dir
 */
async function readProject(dir) {
  const text = await readFile(join(dir, 'project.json'), 'utf8').catch(() => '');
  if (!text) return null;
  /** @type {any} */
  let meta;
  try {
    meta = JSON.parse(text);
  } catch {
    return null;
  }
  const file = cleanPath(meta.file ?? '');
  if (!file) return null;
  let filePath = join(dir, file);
  let info = await fileInfo(filePath);
  if (!info?.isFile()) {
    // Scene projects name `scene.json` but ship the packed `scene.pkg`; the
    // json is generated at import time and is not always present on disk.
    const type = projectType(meta.type);
    const fallback = type === 'scene' ? join(dir, 'scene.pkg') : type === 'web' ? join(dir, 'index.html') : '';
    if (!fallback) return null;
    info = await fileInfo(fallback);
    if (!info?.isFile()) return null;
    filePath = fallback;
  }
  const preview = cleanPath(meta.preview ?? '');
  const previewPath = preview ? join(dir, preview) : '';
  const previewInfo = previewPath ? await fileInfo(previewPath) : null;
  const tags = String(meta.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    id: dir.split(/[\\/]/).pop(),
    dir,
    title: String(meta.title ?? 'Untitled'),
    type: projectType(meta.type),
    file: filePath.split(/[\\/]/).pop() ?? file,
    filePath,
    size: info.size,
    mtime: info.mtimeMs,
    preview: previewInfo?.isFile() ? previewPath : '',
    tags,
  };
}

/**
 * Scan every workshop item of every Steam library. ~270 items on a full WE
 * install; the result is cached because the page only needs it for the grid.
 * @param {readonly string[]} roots
 */
export async function elysiaEngineStatus() {
	const profile = process.env.DSH_PROFILE_DIR || '';
	if (!profile) return { installed: false, name: '' };
	try {
		const pkg = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
		const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
		for (const key of Object.keys(deps)) {
			if (key === 'dsh-theme-engine') continue;
			if (/wallpaper|elysia/i.test(key)) return { installed: true, name: key };
		}
	} catch {
		// A missing or unreadable profile just means "not detected".
	}
	try {
		const entries = await readdir(join(profile, 'node_modules'));
		for (const name of entries) {
			if (name === 'dsh-theme-engine' || name.startsWith('.')) continue;
			if (/wallpaper|elysia/i.test(name)) return { installed: true, name };
		}
	} catch {
		// No node_modules: fall through to not-detected.
	}
	return { installed: false, name: '' };
}

export async function scanLibrary(roots) {
  /** @type {any[]} */
  const items = [];
  // One workshop id can exist in more than one Steam library (a moved or
  // re-downloaded install leaves the old copy behind), and two spellings of
  // one library path are the same library. Both used to produce a second
  // card for the same wallpaper, so seen ids and seen roots are skipped here
  // rather than deduplicated later in the client.
  const seen = new Set();
  const seenRoots = new Set();
  for (const root of roots) {
    const rootKey = normKey(root);
    if (!rootKey || seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);
    const base = join(root, WORKSHOP_DIR);
    const ids = await readdir(base).catch(() => []);
    for (const id of ids) {
      if (!/^\d+$/.test(id)) continue;
      if (seen.has(id)) continue;
      const item = await readProject(join(base, id));
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  items.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  return items;
}

/** True when a wallpaper_engine*.exe process is alive. */
async function isProcessAlive(name) {
  const text = await run('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], 5000);
  return text.toLowerCase().includes(name.toLowerCase());
}

/** Resolve the wallpaper currently selected in Wallpaper Engine. */
function currentWallpaper(config, items) {
  if (!config) return null;
  for (const selected of config.selected) {
    const key = normKey(selected.file);
    const match = items.find((item) => normKey(item.filePath) === key);
    if (match) return { ...match, monitor: selected.monitor };
  }
  return null;
}

/**
 * One snapshot for the wallpaper-center page: install state, current wallpaper,
 * the library and the Steam / WE process state.
 * @param {boolean} [force]
 */
export async function weState(force = false) {
  const at = Date.now();
  if (!force && cache && at - cache.at < CACHE_MS) return cache.value;
  if (pending) return pending;
  pending = (async () => {
    const roots = await steamRoots();
    const installRoot = await weInstallRoot(roots);
    const config = installRoot ? await readWeConfig(installRoot) : null;
    const items = roots.length ? await scanLibrary(roots) : [];
    const current = currentWallpaper(config, items);
    const [running, steamRunning] = await Promise.all([isProcessAlive('wallpaper64.exe'), isProcessAlive('steam.exe')]);
    return {
      ok: true,
      installed: Boolean(installRoot),
      installRoot: installRoot ?? '',
      roots,
      running: running || (await isProcessAlive('wallpaper32.exe')),
      steamRunning,
      current,
      items,
      monitors: config?.selected ?? [],
      recent: config?.recent ?? [],
      configMtime: config?.mtime ?? 0,
    };
  })();
  try {
    const value = await pending;
    cache = { at, value };
    return value;
  } finally {
    pending = null;
  }
}

/**
 * Resolve an item's preview image / animation.
 * @param {string} id
 */
export async function previewFor(id) {

  const state = await weState();
  const item = state.items.find((entry) => entry.id === String(id));
  if (!item?.preview) return null;
  return mediaFile(item.preview);
}

/**
 * Describe a local media file (image / video / audio) for the host routes.
 * @param {string} path
 */
export async function mediaFile(path) {
  const file = cleanPath(path);
  if (!file) return null;
  const info = await fileInfo(file);
  if (!info?.isFile()) return null;
  const ext = extname(file).toLowerCase();
  if (!MEDIA_EXT.has(ext)) return null;
  const kind = IMAGE_EXT.has(ext)
    ? ext === '.gif' || ext === '.apng'
      ? 'animation'
      : 'image'
    : VIDEO_EXT.has(ext)
      ? 'video'
      : 'audio';
  return { path: file, name: file.split(/[\\/]/).pop() ?? '', size: info.size, mtime: info.mtimeMs, ext, kind };
}

/**
 * File-system browser used by the "custom folder" picker. Without a target it
 * returns the drive roots.
 * @param {string} [target]
 */
export async function listDirectory(target) {
  const dir = cleanPath(target);
  if (!dir) {
    /** @type {string[]} */
    const roots = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (await exists(`${letter}:\\`)) roots.push(`${letter}:\\`);
    }
    return { ok: true, path: '', parent: null, roots, dirs: [], files: [] };
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  /** @type {any[]} */
  const dirs = [];
  /** @type {any[]} */
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, path: full });
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (!MEDIA_EXT.has(ext)) continue;
    if (files.length >= 400) break;
    const media = await mediaFile(full);
    if (media) files.push(media);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return { ok: true, path: dir, parent: join(dir, '..'), roots: [], dirs, files };
}

/** Force the next `weState()` to rescan the libraries. */
export function invalidate() {
  cache = null;
}
