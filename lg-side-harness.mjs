
// The mount proof is deferred by 900 ms on purpose; give the timer a chance.
await new Promise((resolve) => setTimeout(resolve, 1200));
console.log('late log posts:', logs.map((u) => decodeURIComponent(u.split('msg=')[1] || '')).join(' || ') || '(none)');