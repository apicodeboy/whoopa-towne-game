// Promo codes in AJ'S and the gun picker: a wrong code is refused, FREEME unlocks the item
// with no GRAMS spent, and it can be worn. Against the throwaway server (port 2667).
export default async function ({ page, wait, evalGame, waitForGame, shot, errors }) {
  await waitForGame();
  await evalGame((w) => w.app.assetsReady);
  await wait(800);
  await evalGame((w) => w.app.account.register(`Promo${Math.floor(Math.random() * 9000 + 1000)}`, 'promo-pass-1'));
  await wait(400);
  console.log('  promos on:', await evalGame((w) => w.app.account.promos), 'balance', await evalGame((w) => w.app.account.account.balance));
  // AJ'S, the first item
  await evalGame((w) => w.app.storeScreen.openAt('outfits'));
  await wait(1500);
  const item = await evalGame((w) => w.app.storeScreen.selected?.id);
  console.log('  selected:', item, '| promo box shown:', await page.evaluate(() => !!document.querySelector('.screen.eco.store:not(.hidden) .promo-row')));
  await shot('promo-0-store');
  await page.type('.screen.eco.store:not(.hidden) .promo-input', 'NOPE123');
  await page.keyboard.press('Enter');
  await wait(800);
  console.log('  wrong code:', await page.evaluate(() => document.querySelector('.screen.eco.store:not(.hidden) .promo-msg')?.textContent));
  await shot('promo-1-wrong');
  // (the refused code is selected: typing replaces it)
  await page.keyboard.type('freeme');
  console.log('  box holds:', await page.evaluate(() => document.querySelector('.screen.eco.store:not(.hidden) .promo-input')?.value));
  await page.click('.screen.eco.store:not(.hidden) .promo-apply');
  await wait(1200);
  const after = await evalGame((w, id) => ({ owned: w.app.account.owns(id), balance: w.app.account.account.balance }), item);
  console.log('  after FREEME:', JSON.stringify(after), '| message:', await page.evaluate(() => document.querySelector('.screen.eco.store:not(.hidden) .promo-msg')?.textContent));
  await shot('promo-2-unlocked');
  // equip from the dialog
  await page.evaluate(() => [...document.querySelectorAll('.eco-btn')].find((b) => b.textContent === 'Equip now')?.click());
  await wait(1500);
  console.log('  worn:', await evalGame((w) => w.app.account.account.look !== null));
  await evalGame((w) => w.app.storeScreen.show(false));
  // the gun picker: a skin
  await evalGame((w) => w.app.loadoutScreen.show(true));
  await wait(1500);
  const opened = await page.evaluate(() => {
    const skins = [...document.querySelectorAll('button.gp-skin')].filter((b) => !b.classList.contains('worn'));
    const b = skins[1] ?? skins[0];
    if (b) { b.click(); return b.title || b.textContent || 'a skin'; }
    return null;
  });
  await wait(600);
  console.log('  skin picked:', opened, '| promo box in gun picker:', await page.evaluate(() => !!document.querySelector('.gp-promo')));
  await shot('promo-3-gunpicker');
  if (await page.evaluate(() => !!document.querySelector('.gp-promo'))) {
    await page.type('.gp-promo .promo-input', 'FREEME');
    await page.keyboard.press('Enter');
    await wait(1500);
    console.log('  gun picker after FREEME:', await page.evaluate(() => document.querySelector('.gp-note')?.textContent));
    await shot('promo-4-skin');
  }
  console.log('  errors:', errors.length, errors.slice(0, 3).join(' | '));
}
