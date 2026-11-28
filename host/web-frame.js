/* Web wallpaper mirror.
 *
 * A web wallpaper is a folder with an index.html and its assets. The client
 * cannot load that folder directly (dsh-app:// cannot read the disk), so the
 * host exposes exactly one folder at a time under /liquid-glass/web/ and the
 * client points an opaque-origin iframe at it.
 *
 * Three rules keep this narrow:
 *   - the folder must be a Wallpaper Engine workshop project that really has
 *     an index.html, so the route is not a general-purpose file server;
 *   - a request may only resolve inside the folder that was opened last, so
 *     `..` and absolute paths cannot escape it;
 *   - nothing is ever written: the page can read its own folder and post log
 *     lines, and that is the whole API.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

import { STEAM_APP_ID, steamRoots } from './wallpaper-engine.js';

const WORKSHOP_DIR = join('steamapps', 'workshop', 'content', STEAM_APP_ID);
const MAX_BYTES = 96 * 1024 * 1024;
const SHIM_PATH = '__shim.js';
const LOG_PATH = '__log';
const MAX_LOGS = 160;

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
  '.wasm': 'application/wasm',
}));

/** @type {{ root: string, name: string, openedAt: number }} */
let current = { root: '', name: '', openedAt: 0 };

/** @type {{ at: number, level: string, message: string, path: string }[]} */
const logs = [];

/**
 * What the sandboxed page itself reported. Kept in memory: the settings page
 * shows it, and `GET /liquid-glass/web/log` hands it back for bug reports.
 */
export function webLogs() {
  return logs.slice();
}

function recordLog(level, message, path) {
  logs.push({
    at: Date.now(),
    level: String(level || 'info').slice(0, 16),
    message: String(message || '').slice(0, 500),
    path: String(path || '').slice(0, 240),
  });
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

/*
 * The sandbox gives the page an opaque origin, so `localStorage` throws a
 * SecurityError the moment a wallpaper touches it — and most of them do, on
 * the first line of their boot script. This shim runs before anything else in
 * the page and gives it a memory-backed storage that behaves the same way for
 * the lifetime of the frame. It also forwards errors to the host, which is how
 * we get a real stack out of a window that has no devtools.
 */
const SHIM = String.raw`(function () {
  function makeStore() {
    var map = new Map();
    return {
      getItem: function (k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem: function (k, v) { map.set(String(k), String(v)); },
      removeItem: function (k) { map.delete(String(k)); },
      clear: function () { map.clear(); },
      key: function (i) { var keys = Array.from(map.keys()); return i < keys.length ? keys[i] : null; },
      get length() { return map.size; }
    };
  }
  var local = makeStore();
  var session = makeStore();
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } });
  } catch (e) {}
  try {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } });
  } catch (e) {}
  function send(level, text) {
    try {
      var url = '__log?level=' + encodeURIComponent(level) + '&path=' + encodeURIComponent(location.pathname) + '&msg=' + encodeURIComponent(String(text).slice(0, 400));
      new Image().src = url;
    } catch (e) {}
  }
  window.addEventListener('error', function (event) {
    send('error', (event && event.message) + ' @ ' + (event && event.filename) + ':' + (event && event.lineno));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    send('reject', (reason && (reason.stack || reason.message)) || reason);
  });
  var original = console.error;
  console.error = function () {
    send('console', Array.prototype.map.call(arguments, function (v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return String(v); } }).join(' '));
    return original.apply(console, arguments);
  };
  window.__lgSandbox = { storage: 'memory', origin: location.origin };
  send('boot', 'shim ready, origin=' + location.origin);
})();`;

const SHIM_TAG = `<script src="${SHIM_PATH}"></script>`;

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
  recordLog('open', target, '/');
  return { ok: true, root: target, name: current.name, url: '/liquid-glass/web/index.html' };
}

export function webRoot() {
  return { root: current.root, name: current.name };
}

function plain(status, message) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

const CORS = {
  // The page has an opaque origin, so every request it makes is cross-origin.
  // Its own folder is a read-only mirror, so allowing it costs nothing.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'cross-origin-resource-policy': 'cross-origin',
};

function injectShim(html) {
  const text = html.toString('utf8');
  const head = text.search(/<head[^>]*>/i);
  if (head >= 0) {
    const end = text.indexOf('>', head) + 1;
    return text.slice(0, end) + SHIM_TAG + text.slice(end);
  }
  const doc = text.search(/<html[^>]*>/i);
  if (doc >= 0) {
    const end = text.indexOf('>', doc) + 1;
    return text.slice(0, end) + SHIM_TAG + text.slice(end);
  }
  return SHIM_TAG + text;
}

/**
 * Answer one request under /liquid-glass/web/. Relative asset URLs in the page
 * resolve against their own path, which is why this has to be a prefix route
 * and not a ?file= query.
 * @param {string} relative pathname below the mirrored root, may be empty
 * @param {URLSearchParams} [query]
 */
export async function serveWebFile(relative, query) {
  if (relative === LOG_PATH) {
    recordLog(query?.get('level') ?? 'page', query?.get('msg') ?? '', query?.get('path') ?? '');
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...CORS } });
  }
  if (relative === SHIM_PATH) {
    return new Response(SHIM, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...CORS,
      },
    });
  }
  if (!current.root) return plain(404, 'no web wallpaper is open');
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(relative ?? ''));
  } catch {
    return plain(400, 'bad path');
  }
  if (!decoded || decoded.endsWith('/')) decoded += 'index.html';
  const rootPrefix = current.root.endsWith(sep) ? current.root : current.root + sep;
  // resolve() collapses `..` before the prefix test, so neither `../..` nor a
  // drive-letter absolute path can step outside the opened folder.
  const target = resolve(current.root, `.${sep}${decoded.replace(/^[\\/]+/, '')}`);
  if (!target.startsWith(rootPrefix)) {
    recordLog('blocked', decoded, '/liquid-glass/web');
    return plain(403, 'outside the web wallpaper');
  }
  const ext = extname(target).toLowerCase();
  const type = MIME.get(ext);
  if (!type) return plain(415, 'unsupported file type');
  const info = await stat(target).catch(() => null);
  if (!info || !info.isFile()) {
    recordLog('404', decoded, '/liquid-glass/web');
    return plain(404, 'not found');
  }
  if (info.size > MAX_BYTES) return plain(413, 'too large');
  const raw = await readFile(target);
  const body = ext === '.html' || ext === '.htm' ? Buffer.from(injectShim(raw), 'utf8') : raw;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...CORS,
    },
  });
}
