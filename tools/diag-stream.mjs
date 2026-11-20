// Diagnostic: stream frames for N seconds and print every frame's lum.
//
//   node tools/diag-stream.mjs <exe> <seconds> [fps]
//
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2] ?? 'bin/lg-capture.exe';
const seconds = Number(process.argv[3] ?? 6);
const fps = Number(process.argv[4] ?? 10);
const stage = join(tmpdir(), 'lg-diag-stream.jpg');

const child = spawn(exe, ['--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const frames = [];

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
      continue;
    }
    if (parsed.event === 'frame') {
      frames.push(parsed);
      console.log(
        `seq=${parsed.seq} lum=${Number(parsed.lum).toFixed(4)} dark=${Number(parsed.dark).toFixed(3)} ms=${parsed.ms} apps=${parsed.apps} w=${parsed.w} h=${parsed.h}`,
      );
    } else {
      console.log('response:', JSON.stringify(parsed));
    }
  }
});

const send = (line) => child.stdin.write(`${line}\n`);
await new Promise((resolve) => setTimeout(resolve, 300));
send(`stream ${fps} 1 1 ${stage}`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
send('stop');
await new Promise((resolve) => setTimeout(resolve, 500));
child.kill();

const lums = frames.map((f) => Number(f.lum));
const dark = lums.filter((l) => l < 0.06).length;
console.log(`\nframes=${frames.length} darkFrames=${dark} min=${Math.min(...lums).toFixed(4)} max=${Math.max(...lums).toFixed(4)}`);
