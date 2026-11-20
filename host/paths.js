/**
 * Filesystem layout and timing knobs shared by the host modules.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = join(tmpdir(), 'dsh-liquid-glass');

/**
 * How long a captured frame may be served before the next poll re-captures.
 * The native helper costs ~80–100 ms, so a 1.2 s budget keeps the wallpaper
 * within ~1.5 s of the desktop without burning a core.
 */
// A resident helper answers in ~145 ms, so the cache only has to absorb bursts of
// overlapping requests. Keeping it short is what makes the wallpaper feel live:
// client poll + cache + capture stays under the 1.5 s response budget.
export const STATE_TTL_MS = 700;
export const COMPOSITE_SCRIPT_PATH = join(CACHE_DIR, 'composite.ps1');
export const GATE_SCRIPT_PATH = join(CACHE_DIR, 'gate.ps1');
export const CAPTURE_IMAGE_PATH = join(CACHE_DIR, 'wallpaper.jpg');
// Captures are written here first and renamed into place afterwards, so a
// client that polls mid-capture can never read a half-written JPEG (that torn
// read decodes into a black band and looked like the wallpaper flashing).
export const STAGE_IMAGE_PATH = join(CACHE_DIR, 'wallpaper.stage.jpg');


/** Directory of this bundle (host/ is one level below the package root). */
export const BUNDLE_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Bundled native capture helper (source: tools/capture/lg-capture.cpp). */
export const CAPTURE_EXE = join(BUNDLE_ROOT, 'bin', 'lg-capture.exe');
