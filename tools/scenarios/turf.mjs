// Steps 4+5 in the browser: Turf War zones (capture, HUD chips, score ticks), pause menu, match end -> results -> menu.
export default async function ({ page, shot, wait, evalGame, waitForGame }) {
  await waitForGame();
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  const hud0 = await evalGame((w) => ({ mode: w.game.hudState.mode, chips: document.querySelectorAll('.zones .zone').length, markers: w.app.stage.world.zones.filter((z) => z.group.visible).length }));
  console.log('  turf HUD:', JSON.stringify(hud0));
  if (hud0.mode !== 'turf' || hud0.chips !== 3 || hud0.markers !== 3) throw new Error('zone UI missing');

  // stand in zone A (The Court) alone: keep the bots out of the way so the capture is clean
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    for (const p of sim.players) if (p && p !== me) { p.brain = null; p.isBot = false; p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0; }
    const z = sim.map.zones[0];
    me.state.x = z.x; me.state.z = z.z + 2; me.state.y = 0.02;
  });
  await wait(2500);
  const mid = await evalGame((w) => ({ z: w.game.snap.zones[0], chipW: document.querySelector('.zones .zone i').style.width }));
  console.log('  capturing:', JSON.stringify(mid));
  if (!(mid.z.capTeam === 0 && mid.z.progress > 0.2)) throw new Error('capture progress not showing');
  const banner = await page.evaluate(() => {
    const o = document.querySelector('.objective');
    return { shown: !o.classList.contains('hidden'), text: o.querySelector('.what').textContent, bar: o.querySelector('.bar i').style.width };
  });
  console.log('  objective banner:', JSON.stringify(banner));
  if (!banner.shown || banner.text !== 'CAPTURING A' || !(parseInt(banner.bar) > 15)) throw new Error('objective banner should say CAPTURING A');
  await shot('turf-capturing');
  await wait(4500);
  const cap = await evalGame((w) => ({ z: w.game.snap.zones[0], owner: document.querySelector('.zones .zone').dataset.owner, scores: w.game.snap.scores, caps: w.game.hudState.players.find((p) => p.me).score }));
  console.log('  captured:', JSON.stringify(cap));
  if (cap.z.owner !== 0 || cap.owner !== '0' || cap.caps !== 1) throw new Error('zone A should be ours');
  const held = await page.evaluate(() => document.querySelector('.objective .what').textContent);
  if (held !== 'HOLDING A') throw new Error(`objective banner should say HOLDING A, got ${held}`);
  await wait(3500);
  const pts = await evalGame((w) => w.game.snap.scores[0]);
  console.log('  points after holding:', pts);
  if (pts < 1) throw new Error('holding a zone should pay points');
  await shot('turf-held');

  // pause menu via Esc (pointer not locked in headless, so the key reaches the page)
  await page.keyboard.press('Escape');
  await wait(300);
  const paused = await evalGame((w) => ({ paused: w.game.paused, menu: !document.querySelector('.overlay-panel.pause').closest('.screen').classList.contains('hidden') }));
  console.log('  paused:', JSON.stringify(paused));
  if (!paused.paused || !paused.menu) throw new Error('pause menu did not open');
  await shot('turf-paused');
  const resume = await page.evaluateHandle(() => [...document.querySelectorAll('.pause .btn')].find((b) => b.textContent === 'RESUME'));
  await resume.asElement().click();
  await wait(200);
  if (await evalGame((w) => w.game.paused)) throw new Error('resume did not unpause');

  // drive the match to its end: 199 points, the next payout wins it
  await evalGame((w) => { w.session.sim.scores[0] = 199; });
  await page.waitForFunction('window.__whoopa.game.snap.phase === 2', { timeout: 8000 });
  await wait(700);
  const end = await evalGame((w) => ({
    scores: w.game.snap.scores,
    announce: document.querySelector('.announce').textContent,
    board: !document.querySelector('.scoreboard').classList.contains('hidden'),
    title: document.querySelector('.board-body .title')?.textContent,
    sub: document.querySelector('.board-body .subtitle')?.textContent,
    results: !document.querySelector('.results-bar').classList.contains('hidden'),
  }));
  console.log('  match over:', JSON.stringify(end));
  if (end.scores[0] !== 200 || !end.board || !end.results || end.title !== 'VICTORY' || !/S-CURVE WINS 200/i.test(end.sub)) throw new Error('end-of-match UI wrong');
  await shot('turf-final');
  const menuBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.results-bar .btn')].find((b) => b.textContent === 'MAIN MENU'));
  await menuBtn.asElement().click();
  await wait(500);
  const back = await evalGame((w) => ({ state: w.app.state, game: !!w.app.game, hud: document.querySelectorAll('.hud').length }));
  console.log('  back to menu:', JSON.stringify(back));
  if (back.state !== 'menu' || back.game || back.hud !== 0) throw new Error('did not return to the menu cleanly');
}
