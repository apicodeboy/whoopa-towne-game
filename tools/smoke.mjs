/**
 * Runs every browser scenario against a running game and prints a pass / fail summary.
 * Needs Google Chrome (set CHROME_PATH if it is not in the default macOS location).
 *
 *   npm run dev                      # in one terminal (client on :5173, server on :2567)
 *   npm run test:browser             # in another
 *
 *   npm run build && npm start       # or test the production build:
 *   npm run test:browser -- --base=http://localhost:2567
 *
 *   npm run test:browser -- --only=combat,touch     # just some of them
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const eq = a.indexOf('=');
  return eq < 0 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
}));
const base = String(args.base ?? 'http://localhost:5173').replace(/\/$/, '');
const only = typeof args.only === 'string' ? args.only.split(',') : null;
const dir = import.meta.dirname;

const MATCH = 'auto=practice&nolock=1&warmup=1&seed=3';
/** name, scenario file, query string, extra driver flags */
const RUNS = [
  ['menu', 'menu.mjs', 'nolock=1&warmup=1&seed=3', []],
  ['kbm', 'kbm.mjs', MATCH, []],
  ['combat', 'combat.mjs', MATCH, []],
  ['combat (80 ms lag)', 'combat.mjs', `${MATCH}&latency=80`, []],
  ['turf', 'turf.mjs', `${MATCH}&mode=turf`, []],
  ['gamepad', 'gamepad.mjs', 'nolock=1&warmup=1&seed=3', []],
  ['touch', 'touch.mjs', 'auto=practice&warmup=1&seed=4', ['--mobile', '--w=844', '--h=390']],
  ['audio', 'audio.mjs', 'nolock=1&warmup=1&seed=3', []],
  ['online: 2 players', 'online2.mjs', 'nolock=1', []],
  ['online: lobby flow', 'online-flow.mjs', 'nolock=1', []],
  ['perf: desktop', 'perf.mjs', MATCH, ['--target=55']],
  ['perf: phone', 'perf.mjs', 'auto=practice&warmup=1&seed=3', ['--mobile', '--w=844', '--h=390', '--throttle=4', '--target=30']],
];

function run(name, file, query, flags) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(dir, 'play.mjs'), resolve(dir, 'scenarios', file), `--url=${base}/?${query}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ name, ok: code === 0, out }));
  });
}

const results = [];
for (const [name, file, query, flags] of RUNS) {
  if (only && !only.some((o) => name.includes(o))) continue;
  const t0 = Date.now();
  const r = await run(name, file, query, flags);
  results.push(r);
  console.log(`${r.ok ? '✓' : '✗'} ${name}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (!r.ok || args.verbose) console.log(r.out.split('\n').filter((l) => !l.includes('screenshot')).map((l) => `    ${l}`).join('\n'));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} browser scenarios passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
