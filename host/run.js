/**
 * Thin process helpers: one-shot runs that never throw, so callers only deal
 * with stdout / `{ ok, stdout, error }`.
 */
import { execFile } from 'node:child_process';

/**
 * Run a short-lived helper process and return its trimmed stdout, or '' when it
 * fails.
 * @param {string} file
 * @param {readonly string[]} args
 * @param {number} timeoutMs
 * @param {Record<string, string>} [env]
 * @returns {Promise<string>}
 */
export function run(file, args, timeoutMs = 8000, env) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, env: env ? { ...process.env, ...env } : undefined },
      (error, stdout) => {
        resolve(error ? '' : String(stdout ?? '').trim());
      },
    );
  });
}

export function runPowerShellFile(file, env, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...(env ?? {}) } },
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || error).trim().slice(0, 600);
          resolve({ ok: false, stdout: String(stdout ?? ''), error: message });
          return;
        }
        resolve({ ok: true, stdout: String(stdout ?? ''), error: '' });
      },
    );
  });
}

