// Build client/client.js from the ordered sources in client/src.
//
// The DeepSeek Harness client module system serves a plugin's `exports["./client"]`
// file verbatim as one classic script (see docs/DETAIL.md, "客户端构建"). It cannot
// load ES modules or extra chunks, so the shipped artifact stays a single file. This
// script only concatenates the split sources back into that file, in a fixed order,
// without touching a single identifier.
//
//   node scripts/build-client.mjs           # write client/client.js
//   node scripts/build-client.mjs --check   # report only, do not write

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "client", "src");
const outFile = join(root, "client", "client.js");

// Order matters: the artifact is a single factory body, so every source file is a
// contiguous slice of it. Keep prologue first and epilogue last.
const PARTS = [
  "_prologue.js",
  "01-bootstrap.js",
  "02-locale.js",
  "03-settings.js",
  "04-capture.js",
  "05-ink.js",
  "06-guard.js",
  "07-styles.js",
  "08-shaders.js",
  "09-webgpu.js",
  "10-webgl.js",
  "11-ui.js",
  "12-apply.js",
  "13-we.js",
	"14-audio.js",
  "_epilogue.js",
];

const check = process.argv.includes("--check");
const HASH = createHash("sha256");
let total = 0;
const chunks = [];

for (const name of PARTS) {
  const raw = readFileSync(join(srcDir, name), "utf8").replace(/^\uFEFF/, "");
  const body = raw.replace(/[\r\n]+$/, "");
  const lines = body === "" ? 0 : body.split(/\r\n|\n/).length;
  chunks.push(body);
  total += lines;
  console.log(`${name.padEnd(18)} ${String(lines).padStart(5)} lines  ${String(Buffer.byteLength(body, "utf8")).padStart(6)} B`);
}

// The build stamp is the wall clock at build time, never a number someone typed.
// A hand written stamp silently drifts into the future, and then the version in
// the panel disagrees with the clock on the wall.
function buildStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return "v." + String(date.getFullYear()).slice(2) + "." + pad(date.getMonth() + 1) + "." + pad(date.getDate()) +
    "." + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

const STAMP_LINE = /const CLIENT_BUILD = "v[0-9.]+";/;
const stamp = buildStamp();
const joined = chunks.join("\r\n") + "\r\n";
if (!STAMP_LINE.test(joined)) {
  console.error("\nbuild stamp: CLIENT_BUILD literal not found");
  process.exit(1);
}
const text = joined.replace(STAMP_LINE, 'const CLIENT_BUILD = "' + stamp + '";');
console.log("\nstamp: " + stamp);
HASH.update(text);
console.log(`\ntotal: ${total} lines, ${Buffer.byteLength(text, "utf8")} B, sha256 ${HASH.digest("hex").slice(0, 16)}`);

// Every part shares one scope, so a duplicate `let`/`const` only appears once the
// pieces are joined. Parse the result before it reaches the devtools console.
try {
	new Script(text, { filename: outFile });
} catch (error) {
	console.error(`\nsyntax error in the concatenated bundle: ${error.message}`);
	process.exit(1);
}

if (check) {
  // The stamp changes every second, so compare the artifacts with it masked out.
  const shipped = readFileSync(outFile, "utf8").replace(/^\uFEFF/, "");
  const a = shipped.replace(STAMP_LINE, "");
  const b = text.replace(STAMP_LINE, "");
  const same = a === b;
  console.log(same ? "--check: in sync" : "--check: sources differ from client/client.js");
  if (!same) process.exit(1);
} else {
  writeFileSync(outFile, "\uFEFF" + text, "utf8");
  console.log(`wrote ${outFile}`);
}