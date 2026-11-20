// Smoke test for the live streaming mode of lg-capture.exe.
//
//   node tools/test-stream.mjs <exe> [seconds]
//
// Starts the helper in --serve mode, asks it to stream composed frames, and
// reports how many frames arrived, the frame latency, and the border flag.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2] ?? 'bin/lg-capture.exe';
const seconds = Number(process.argv[3] ?? 4);
const stage = join(tmpdir(), 'lg-stream-test.jpg');

const child = spawn(exe, ['--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const frames = [];
const responses = [];

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.log('unparsed:', line);
      continue;
    }
    if (parsed.event === 'frame') frames.push(parsed);
    else responses.push(parsed);
  }
});

const send = (line) => child.stdin.write(`${line}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await wait(200);
send('version');
send(`stream 10 1 1 ${stage}`);
await wait(seconds * 1000);
send('stop');
await wait(300);
send('quit');
await wait(200);

const ms = frames.map((f) => f.ms);
const lums = frames.map((f) => f.lum);
const summary = {
  responses,
  frames: frames.length,
  fps: frames.length ? +(frames.length / seconds).toFixed(2) : 0,
  ms: ms.length ? { min: Math.min(...ms), max: Math.max(...ms), avg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) } : null,
  lum: lums.length ? { min: Math.min(...lums), max: Math.max(...lums) } : null,
  borderless: [...new Set(frames.map((f) => f.borderless))],
  stage,
};
console.log(JSON.stringify(summary, null, 2));
child.stdin.end();
child.kill();
