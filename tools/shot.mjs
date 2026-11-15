/**
 * Headless-Chrome screenshot helper (uses the locally installed Google Chrome).
 *   node tools/shot.mjs <url-or-file> <out.png> [width] [height] [waitMs]
 */
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const [, , target, out = 'shot.png', w = '1600', h = '1000', wait = '300'] = process.argv;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = existsSync(target) ? pathToFileURL(target).href : target;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
