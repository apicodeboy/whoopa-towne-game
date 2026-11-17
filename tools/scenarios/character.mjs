// Character Creator: categories and options update the 3D preview, locked options cannot be
// picked, KEEP CHARACTER saves (with a confirmation), leaving discards a draft, and practice
// matches use the kept look.
export default async function ({ page, shot, wait, evalGame, waitForGame }) {
  await waitForGame();
  await evalGame((w) => w.app.assetsReady);
  await wait(1500);
  const clickText = async (sel, text) => {
    const handle = await page.evaluateHandle(
      (s, t) => [...document.querySelectorAll(s)].find((b) => b.offsetParent !== null && b.textContent.trim().includes(t)),
      sel, text,
    );
    if (!handle.asElement()) throw new Error(`no "${text}" in ${sel}`);
    await handle.asElement().click();
  };
  const saved = () => evalGame(() => JSON.parse(localStorage.getItem('whoopa.profile.v1') ?? '{}').look ?? null);
  const pick = async (cat, item, option) => {
    await clickText('.cc-cat', cat);
    await wait(120);
    if (item) await clickText('.cc-item', item);
    await wait(120);
    await clickText('.cc-opt', option);
  };

  await clickText('.menu-panel .btn', 'CHARACTER');
  await wait(1000);
  await shot('character-open');

  // a few picks across categories
  await pick('Body', 'Body Type', 'Feminine');
  await pick('Hair', 'Hairstyle', 'Long Dreads');
  await page.click('.cc-pback');
  await clickText('.cc-item', 'Hair Color');
  await clickText('.cc-opt', 'Purple');
  await pick('Head Accessories', 'Glasses', 'Aviators');
  await pick('Jewelry', 'Necklaces', 'Thick Gold Chain');
  await pick('Shirts', 'Shirt Style', 'Crop Top');
  await page.click('.cc-pback');
  await clickText('.cc-item', 'Shirt Color');
  await clickText('.cc-opt', 'Yellow');
  await wait(1200);
  await shot('character-edited');

  // a locked option stays unpicked
  await pick('Shirts', 'Shirt Style', 'Jacket');
  await wait(200);
  const draftTop = await evalGame((w) => w.app.characterScreen.draft.top);
  if (draftTop !== 'crop') throw new Error(`locked option was picked (${draftTop})`);

  // expressions are previews only
  await clickText('.cc-cat', 'Expressions');
  await clickText('.cc-opt', 'Happy');
  await wait(700);
  await shot('character-happy');

  // nothing is saved before KEEP CHARACTER
  const before = await saved();
  if (before && before.hair === 'longdreads') throw new Error('look saved before keeping');
  await clickText('.cc-keep', 'KEEP CHARACTER');
  await wait(300);
  await shot('character-confirm');
  await clickText('.cc-confirm .btn', 'KEEP CHARACTER');
  await wait(300);
  const kept = await saved();
  console.log('  kept look:', JSON.stringify({ bodyType: kept.bodyType, hair: kept.hair, top: kept.top, glasses: kept.glasses }));
  if (kept.bodyType !== 'fem' || kept.hair !== 'longdreads' || kept.hairColor !== 'purple' || kept.top !== 'crop' || kept.topColor !== 'yellow' || kept.glasses !== 'aviators' || kept.necklace !== 'thickgold') {
    throw new Error('kept look not saved');
  }
  const open = await evalGame((w) => w.app.characterScreen.visible);
  if (open) throw new Error('creator still open after keeping');

  // a draft that is not kept is thrown away
  await clickText('.menu-panel .btn', 'CHARACTER');
  await wait(600);
  await pick('Hair', 'Hairstyle', 'Bald');
  await clickText('.cc-exit', 'BACK');
  await wait(200);
  await clickText('.cc-confirm .btn', 'LEAVE');
  await wait(200);
  if ((await saved()).hair !== 'longdreads') throw new Error('unkept draft was saved');

  // the practice match uses the kept look (the roster carries it as a code)
  await evalGame((w) => w.app.startPractice('tdm', 'easy'));
  await wait(2000);
  const me = await evalGame((w) => w.session.roster.find((r) => !r.bot));
  console.log('  my look code in match:', me.look);
  if (typeof me.look !== 'string' || !me.look.startsWith('L1')) throw new Error('match did not carry a look code');
  await shot('character-in-match');
}
