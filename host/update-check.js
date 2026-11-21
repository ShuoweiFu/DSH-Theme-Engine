/**
 * Update checks for the three places this project is distributed from.
 *
 * The renderer should not talk to npm/GitHub itself: CORS, corporate proxies,
 * offline caches and GitHub rate limits all differ per machine, so the host
 * answers on its behalf and caches the result for a few minutes.
 *
 * Versions use the project's date-based scheme:
 *   package.json / npm  ->  "26.11.21-011937"
 *   git tag / UI        ->  "v.26.11.21.011937"
 * parseVersion() folds both spellings into one comparable tuple.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';

export const NPM_PACKAGE = 'dsh-theme-engine';
export const REPO = 'ShuoweiFu/DSH-Theme-Engine';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

// Windows machines often run a local TLS-intercepting proxy (GitHub
// accelerators, corporate middleboxes). Its root CA lives in the OS store, so
// Invoke-RestMethod trusts it while Node's bundled roots reject it with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Hand the system roots to Node before the
// first request; older runtimes keep their bundled list.
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    const bundled = tls.getCACertificates('bundled') ?? [];
    const system = tls.getCACertificates('system') ?? [];
    const seen = new Set(bundled);
    const merged = [...bundled, ...system.filter((certificate) => !seen.has(certificate))];
    if (merged.length) tls.setDefaultCACertificates(merged);
  }
} catch {
  // Fall back to the runtime defaults.
}

/** @typedef {{ latest: string | null, url: string, error: string | null, detail?: string }} ChannelResult */

const LINKS = {
  npm: `https://www.npmjs.com/package/${NPM_PACKAGE}`,
  git: `https://github.com/${REPO}`,
  github: `https://github.com/${REPO}/releases`,
};

/**
 * Fold "26.11.21-011937" / "v.26.11.21.011937" into [y, m, d, build].
 * @param {unknown} value
 * @returns {[number, number, number, number] | null}
 */
export function parseVersion(value) {
  const match = String(value ?? '').match(/(\d{2})\.(\d{1,2})\.(\d{1,2})[.\-](\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

/**
 * Compare two project versions; positive when a is newer than b.
 * @param {unknown} a
 * @param {unknown} b
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let index = 0; index < 4; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Canonical spelling used by package.json ("26.11.21-011937"). The build
 * segment keeps its leading zeros (01:19:37), so it cannot round-trip through
 * a number.
 * @param {unknown} value
 */
export function canonicalVersion(value) {
  const match = String(value ?? '').match(/(\d{2})\.(\d{1,2})\.(\d{1,2})[.\-](\d{1,6})/);
  if (!match) return String(value ?? '');
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}-${match[4].padStart(6, '0')}`;
}

function normalizeError(error) {
  const message = String(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  if (/HTTP 404/.test(message)) return 'not-found';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network/i.test(message)) return 'unreachable';
  return 'failed';
}

/**
 * @param {string} url
 * @param {Record<string, string>} [headers]
 */
async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': `${NPM_PACKAGE}-update-check`,
        ...headers,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<string[]>} */
function lsRemoteTags() {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['ls-remote', '--tags', '--refs', `https://github.com/${REPO}.git`],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const names = String(stdout)
          .split(/\r?\n/)
          .map((line) => line.split('refs/tags/')[1])
          .filter((name) => Boolean(name));
        resolve(names);
      }
    );
  });
}

/** Newest value by the project's version order. @param {string[]} values */
function newest(values) {
  let best = null;
  for (const value of values) {
    if (parseVersion(value) && (best === null || compareVersions(value, best) > 0)) best = value;
  }
  return best;
}

/** @returns {Promise<ChannelResult>} */
async function checkNpm() {
  try {
    const data = await fetchJson(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
    return { latest: canonicalVersion(data.version), url: LINKS.npm, error: null };
  } catch (error) {
    return { latest: null, url: LINKS.npm, error: normalizeError(error) };
  }
}

/** @returns {Promise<ChannelResult>} */
async function checkGit() {
  // Prefer the real tag list; fall back to package.json on the default branch
  // when git is unavailable (plain npm installs ship without a .git folder).
  try {
    const tag = newest(await lsRemoteTags());
    if (tag) return { latest: canonicalVersion(tag), url: LINKS.git, error: null };
  } catch {
    // Fall through to the raw manifest.
  }
  try {
    const data = await fetchJson(`https://raw.githubusercontent.com/${REPO}/main/package.json`);
    return { latest: canonicalVersion(data.version), url: LINKS.git, error: null };
  } catch (error) {
    return { latest: null, url: LINKS.git, error: normalizeError(error) };
  }
}

/** @returns {Promise<ChannelResult>} */
async function checkGithub() {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (release?.tag_name) return { latest: canonicalVersion(release.tag_name), url: LINKS.github, error: null };
  } catch (error) {
    // No published releases yet: read the tag page instead.
    if (normalizeError(error) !== 'not-found') {
      return { latest: null, url: LINKS.github, error: normalizeError(error) };
    }
  }
  try {
    const tags = await fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=100`);
    const tag = newest(Array.isArray(tags) ? tags.map((entry) => entry?.name) : []);
    if (tag) return { latest: canonicalVersion(tag), url: LINKS.github, error: null };
    return { latest: null, url: LINKS.github, error: 'not-found' };
  } catch (error) {
    return { latest: null, url: LINKS.github, error: normalizeError(error) };
  }
}

/** @type {{ at: number, value: any } | null} */
let cache = null;
/** @type {Promise<any> | null} */
let inFlight = null;

async function currentVersion() {
  try {
    const data = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return canonicalVersion(data.version);
  } catch {
    return '';
  }
}

async function collect() {
  const [npm, git, github, current] = await Promise.all([checkNpm(), checkGit(), checkGithub(), currentVersion()]);
  return {
    ok: true,
    current,
    checkedAt: Date.now(),
    channels: { npm, git, github },
  };
}

/**
 * Check all three channels, reusing a recent answer unless `force` is set.
 * @param {{ force?: boolean }} [options]
 */
export async function checkForUpdates(options = {}) {
  const now = Date.now();
  if (!options.force && cache && now - cache.at < CACHE_MS) return cache.value;
  if (inFlight) return inFlight;
  inFlight = collect()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
