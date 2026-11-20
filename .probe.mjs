import { startStreaming, captureStats, helperAlive, streamIsLive } from './host/helper.js';
const ok = await startStreaming(8, true);
console.log('startStreaming ->', ok, 'alive=', helperAlive(), 'live=', streamIsLive(), 'err=', captureStats.error);
await new Promise((r) => setTimeout(r, 3000));
console.log('after 3s alive=', helperAlive(), 'live=', streamIsLive(), 'frames=', captureStats.frames, 'borderless=', captureStats.borderless);
