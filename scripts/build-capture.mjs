// Builds bin/lg-capture.exe from tools/capture/lg-capture.cpp.
//
// The plugin ships the binary, so end users never need a compiler. This script
// is for maintainers: it looks for the MSYS2 UCRT64 clang++ first, then a plain
// clang++/g++ on PATH, and uses whatever a normal `cl` would need otherwise.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'tools', 'capture', 'lg-capture.cpp');
const output = join(root, 'bin', 'lg-capture.exe');
const linkLibraries = [
  '-ld3d11',
  '-ldxgi',
  '-lole32',
  '-luuid',
  '-lruntimeobject',
  '-lgdiplus',
  '-lgdi32',
  '-luser32',
  '-lshell32',
];

function findCompiler() {
  const explicit = process.env.LG_CLANG;
  const candidates = [
    explicit,
    'D:\\msys64\\ucrt64\\bin\\clang++.exe',
    'C:\\msys64\\ucrt64\\bin\\clang++.exe',
    'clang++',
    'g++',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return '';
}

if (!existsSync(source)) {
  console.error(`missing source: ${source}`);
  process.exit(1);
}
const compiler = findCompiler();
if (!compiler) {
  console.error('no C++ compiler found; set LG_CLANG to the clang++/g++ binary');
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });
const args = ['-std=c++20', '-O2', '-o', output, source, ...linkLibraries];
console.log(`${compiler} ${args.join(' ')}`);
execFileSync(compiler, args, { stdio: 'inherit' });
const { size } = statSync(output);
console.log(`built ${output} (${size.toLocaleString('en-US')} bytes)`);
