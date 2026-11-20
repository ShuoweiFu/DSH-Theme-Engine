// Sustained-stability probe for the resident capture helper: sends repeated
// capture commands through one long-lived process (the way the plugin runs it)
// and reports latency plus the luminance the helper measured for each frame.
import { spawn } from 'node:child_process';

const exe = process.argv[2];
const rounds = Number(process.argv[3] ?? 30);
const out = process.argv[4];
const child = spawn(exe, ['--serve'], { windowsHide: true });
let buffer = '';
const lines = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) lines.push(line);
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => process.stderr.write(`[stderr] ${chunk}`));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function nextLine() {
  for (let attempt = 0; attempt < 600; attempt++) {
    const value = lines.shift();
    if (value) return value;
    await wait(10);
  }
  return '';
}

const results = [];
for (let i = 0; i < rounds; i++) {
  const started = Date.now();
  child.stdin.write(`1 ${out}\n`);
  const line = await nextLine();
  const elapsed = Date.now() - started;
  results.push(line);
  console.log(`${i + 1}\t${elapsed}ms\t${line}`);
  await wait(900);
}
child.kill();
const parsed = results.map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
});
const lums = parsed.filter(Boolean).map((entry) => Number(entry.lum ?? 0));
const times = parsed.filter(Boolean).map((entry) => Number(entry.ms?.apps ?? 0));
const bad = parsed.filter((entry) => !entry || entry.ok !== true).length;
console.log(
  `summary: rounds=${rounds} bad=${bad} engine=${[...new Set(parsed.filter(Boolean).map((e) => e.engine))].join(',')} ` +
    `lum min=${Math.min(...lums).toFixed(4)} max=${Math.max(...lums).toFixed(4)} ` +
    `appsMs avg=${(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)).toFixed(1)} max=${Math.max(...times)}`,
);
