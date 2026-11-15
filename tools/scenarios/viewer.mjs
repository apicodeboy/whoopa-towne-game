// Screenshots the developer asset viewer. Usage: play.mjs viewer.mjs --url="...?debug=assets&view=guns" --name=guns
export default async function ({ page, shot, wait, opt, errors }) {
  await page.waitForFunction('window.__viewer !== undefined', { timeout: 30000 });
  await wait(Number(opt.wait ?? 900));
  const info = await page.evaluate(() => window.__viewer);
  if (opt.info) console.log('  ' + JSON.stringify(info));
  else console.log('  failed to load:', JSON.stringify(info.failed));
  await shot(opt.name ?? 'viewer');
}
