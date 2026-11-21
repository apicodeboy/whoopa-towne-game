/**
 * Headless-Chrome driver for smoke-testing the client.
 *
 *   node tools/play.mjs <scenario.mjs> [--url=http://localhost:5173/] [--w=1280] [--h=720] [--mobile] [--headed]
 *
 * A scenario module default-exports `async (ctx) => {}` where ctx has:
 *   page, shot(name), wait(ms), key(code, ms), down(code), up(code), evalGame(fn, ...args), errors[]
 * Screenshots land in tools/out/.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const scenarioPath = args.find((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const body = a.slice(2);
  const eq = body.indexOf('=');
  return eq < 0 ? [body, true] : [body.slice(0, eq), body.slice(eq + 1)];
}));
const url = opt.url ?? 'http://localhost:5173/';
const width = +(opt.w ?? 1280), height = +(opt.h ?? 720);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = resolve(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });

const extraBrowsers = [];
function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: opt.headed ? false : true,
    args: [
      '--no-sandbox', '--hide-scrollbars', '--mute-audio',
      '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=metal',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      `--window-size=${width},${height}`,
    ],
  });
}
const browser = await launchBrowser();
const page = await browser.newPage();
if (opt.mobile) {
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: width > height });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
} else {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
}
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') errors.push(`[console.${t}] ${m.text()}`);
  if (opt.verbose) console.log(`[page ${t}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}${process.env.STACK ? '\n' + (e.stack ?? '') : ''}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const ctx = {
  page, errors, browser, url, opt, outDir,
  /** Opens a page in a brand-new browser process (so both pages animate at full speed at once). */
  newClient: async (label = 'B') => {
    const b2 = await launchBrowser();
    extraBrowsers.push(b2);
    const p2 = await b2.newPage();
    await p2.setViewport({ width, height, deviceScaleFactor: 1 });
    p2.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}`));
    p2.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label} console.error] ${m.text()}`); });
    await p2.goto(url, { waitUntil: 'load', timeout: 30000 });
    return p2;
  },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  shot: async (name) => {
    const file = resolve(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  screenshot ${file}`);
    return file;
  },
  down: (code) => page.keyboard.down(code),
  up: (code) => page.keyboard.up(code),
  key: async (code, ms = 100) => {
    await page.keyboard.down(code);
    await new Promise((r) => setTimeout(r, ms));
    await page.keyboard.up(code);
  },
  /** Evaluate a function in the page with window.__whoopa as first argument. */
  evalGame: (fn, ...a) => page.evaluate(`(${fn.toString()})(window.__whoopa, ...${JSON.stringify(a)})`),
  waitForGame: async (timeout = 20000) => {
    await page.waitForFunction('window.__whoopa !== undefined', { timeout });
  },
};

let failed = false;
try {
  const mod = scenarioPath ? await import(pathToFileURL(resolve(scenarioPath)).href) : null;
  // optional hook that runs before the page loads (e.g. to install fake devices)
  if (mod?.before) await mod.before(ctx);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  if (mod) {
    await mod.default(ctx);
  } else {
    await ctx.wait(1500);
    await ctx.shot('page');
  }
} catch (err) {
  failed = true;
  console.error('SCENARIO FAILED:', err.message);
  try { await ctx.shot('failure'); } catch {}
}
if (errors.length) {
  console.log(`\n${errors.length} page error(s)/warning(s):`);
  for (const e of errors.slice(0, 25)) console.log('  ' + e);
}
for (const b2 of extraBrowsers) await b2.close().catch(() => {});
await browser.close();
process.exit(failed ? 1 : 0);
