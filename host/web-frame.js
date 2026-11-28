/* Web wallpaper mirror.
 *
 * A web wallpaper is a folder with an index.html and its assets. The client
 * cannot load that folder directly (dsh-app:// cannot read the disk), so the
 * host exposes exactly one folder at a time under /liquid-glass/web/ and the
 * client points an opaque-origin iframe at it.
 *
 * Two rules keep this narrow:
 *   - the folder must be a Wallpaper Engine workshop project that really has
 *     an index.html, so the route is not a general-purpose file server;
 *   - a request may only resolve inside the folder that was opened last, so
 *     `..` and absolute paths cannot escape it.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

import { STEAM_APP_ID, steamRoots } from './wallpaper-engine.js';

const WORKSHOP_DIR = join('steamapps', 'workshop', 'content', STEAM_APP_ID);
const MAX_BYTES = 96 * 1024 * 1024;

/** Types a web wallpaper is allowed to be made of. Anything else is refused. */
const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm'
}));

/** @type {{ root: string, name: string, openedAt: number }} */
let current = { root: '', name: '', openedAt: 0 };

function key(value) {
  return String(value ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Point the mirror at one workshop folder. Returns the URL the iframe should use.
 * @param {string} dir absolute folder holding index.html
 */
export async function openWebRoot(dir) {
  const target = resolve(String(dir ?? ''));
  const rootInfo = await stat(target).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory()) return { ok: false, error: 'not-a-folder' };
  const index = await stat(join(target, 'index.html')).catch(() => null);
  if (!index || !index.isFile()) return { ok: false, error: 'no-index' };
  // Only folders that live inside a Steam library's workshop content qualify.
  const roots = await steamRoots();
  const allowed = roots.some((root) => key(target).startsWith(`${key(join(root, WORKSHOP_DIR))}${sep}`));
  if (!allowed) return { ok: false, error: 'outside-library' };
  current = { root: target, name: basename(target), openedAt: Date.now() };
  return { ok: true, root: target, name: current.name, url: '/liquid-glass/web/index.html' };
}

export function webRoot() {
  return { root: current.root, name: current.name };
}

function refuse(status, message) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Answer one request under /liquid-glass/web/. Relative asset URLs in the page
 * resolve against their own path, which is why this has to be a prefix route
 * and not a ?file= query.
 * @param {string} relative pathname below the mirrored root, may be empty
 */
export async function serveWebFile(relative) {
  if (!current.root) return refuse(404, 'no web wallpaper is open');
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(relative ?? ''));
  } catch {
    return refuse(400, 'bad path');
  }
  if (!decoded || decoded.endsWith('/')) decoded += 'index.html';
  const rootPrefix = current.root.endsWith(sep) ? current.root : current.root + sep;
  // resolve() collapses `..` before the prefix test, so neither `../..` nor a
  // drive-letter absolute path can step outside the opened folder.
  const target = resolve(current.root, `.${sep}${decoded.replace(/^[\\/]+/, '')}`);
  if (!target.startsWith(rootPrefix)) return refuse(403, 'outside the web wallpaper');
  const type = MIME.get(extname(target).toLowerCase());
  if (!type) return refuse(415, 'unsupported file type');
  const info = await stat(target).catch(() => null);
  if (!info || !info.isFile()) return refuse(404, 'not found');
  if (info.size > MAX_BYTES) return refuse(413, 'too large');
  const body = await readFile(target);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      // The iframe has an opaque origin; these headers only stop the mirrored
      // page from being *navigated* by anything but itself.
      'x-content-type-options': 'nosniff',
    },
  });
}
