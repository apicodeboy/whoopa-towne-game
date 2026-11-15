// Main menu renders over the live backdrop; loadout + settings overlays open; practice starts from the menu.
export default async function ({ page, shot, wait, evalGame, waitForGame }) {
  await waitForGame();
  await wait(1200);
  await shot('menu-main');
  const texts = await page.$$eval('.menu-panel .btn', (els) => els.map((e) => e.textContent));
  console.log('  menu buttons:', texts.join(' | '));
  for (const want of ['QUICK PLAY', 'CREATE PRIVATE LOBBY', 'JOIN WITH CODE', 'PRACTICE VS BOTS', 'LOADOUT', 'SETTINGS']) {
    if (!texts.includes(want)) throw new Error(`missing menu button ${want}`);
  }
  // name is editable and saved
  await page.click('.menu-panel input.field');
  await page.evaluate(() => document.querySelector('.menu-panel input.field').select());
  await page.keyboard.type('Big Mike <3');
  await page.keyboard.press('Tab');
  const name = await evalGame((w) => w.app.profile.name);
  console.log('  saved name:', name);
  if (name !== 'Big Mike 3') throw new Error(`name not sanitized/saved: ${name}`);

  // loadout
  const clickText = async (sel, text) => {
    const handle = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t)), sel, text);
    await handle.asElement().click();
  };
  await clickText('.menu-panel .btn', 'LOADOUT');
  await wait(300);
  await shot('menu-loadout');
  await clickText('.loadout .card', 'Block Sweeper');
  await clickText('.loadout .card', 'Smoke');
  const lo = await evalGame((w) => JSON.parse(localStorage.getItem('whoopa.profile.v1')).loadout);
  console.log('  saved loadout:', JSON.stringify(lo));
  if (lo.primary !== 'shotgun' || lo.throwable !== 'smoke') throw new Error('loadout not saved locally');
  await clickText('.loadout .btn', 'DONE');

  // settings
  await clickText('.menu-panel .btn', 'SETTINGS');
  await wait(300);
  await shot('menu-settings');
  const labels = await page.$$eval('.settings .slabel', (els) => els.map((e) => e.firstChild.textContent));
  for (const want of ['Mouse sensitivity', 'Invert Y axis', 'Field of view', 'Graphics quality', 'Master volume']) {
    if (!labels.includes(want)) throw new Error(`missing setting ${want}`);
  }
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.settings .srow')].find((r) => r.textContent.startsWith('Invert Y'));
    row.querySelector('.toggle').click();
  });
  const inv = await evalGame((w) => w.settings.values.invertY);
  if (!inv) throw new Error('invert Y toggle did not apply');
  await clickText('.settings .btn', 'RESET TO DEFAULTS');
  await clickText('.settings .btn', 'DONE');

  // practice from the menu, with the shotgun loadout
  await clickText('.menu-panel .btn', 'PRACTICE VS BOTS');
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap', { timeout: 10000 });
  await wait(1500);
  const st = await evalGame((w) => ({ state: w.app.state, weapon: w.game.loadout.primary, name: w.session.roster.find((r) => r.idx === w.session.myIdx).name, ctp: !document.querySelector('.click-to-play').classList.contains('hidden') }));
  console.log('  in match:', JSON.stringify(st));
  if (st.state !== 'playing' || st.weapon !== 'shotgun' || st.name !== 'Big Mike 3') throw new Error('practice did not start with the saved profile');
  await shot('menu-ingame');
}
