/**
 * Writes Brotli (.br) and gzip (.gz) copies next to every compressible file of the built
 * client. The game server serves them to browsers that accept them (see server/src/index.ts);
 * static hosts compress on their own and simply ignore the extra files.
 *
 *   node tools/precompress.mjs [dir]      (default: client/dist)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '../client/dist'));
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.glb', '.md', '.txt', '.map', '.wasm']);
let before = 0, after = 0, count = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!COMPRESSIBLE.has(extname(entry.name)) || statSync(full).size < 1024) continue;
    const data = readFileSync(full);
    const br = brotliCompressSync(data, {
      params: {
        // maximum effort for ordinary files; one notch down for the multi-megabyte physics chunk
        [constants.BROTLI_PARAM_QUALITY]: data.length > 1_500_000 ? 10 : 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    });
    const gz = gzipSync(data, { level: 9 });
    // only keep a copy when it actually saves something
    if (br.length < data.length * 0.95) writeFileSync(`${full}.br`, br);
    if (gz.length < data.length * 0.95) writeFileSync(`${full}.gz`, gz);
    before += data.length;
    after += Math.min(br.length, data.length);
    count++;
    console.log(`  ${relative(root, full).padEnd(44)} ${(data.length / 1024).toFixed(0).padStart(6)} kB -> br ${(br.length / 1024).toFixed(0).padStart(5)} kB, gz ${(gz.length / 1024).toFixed(0).padStart(5)} kB`);
  }
}

walk(root);
console.log(`precompressed ${count} files: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (brotli)`);
