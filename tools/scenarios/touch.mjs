// Step 7b: mobile browser. Emulated phone (touch + mobile UA): on-screen dual-stick controls, buttons,
// auto-fire, first-run performance defaults, landscape layout, rotate hint in portrait.
export default async function ({ page, shot, wait, evalGame, waitForGame }) {
  await waitForGame();
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  const vp = page.viewport();
  const W = vp.width, H = vp.height;
  const defaults = await evalGame((w) => ({ q: w.settings.values.quality, perf: w.settings.values.performanceMode, auto: w.settings.values.autoFire, ratio: w.app.stage.gfx.renderer.getPixelRatio(), shadows: w.app.stage.gfx.renderer.shadowMap.enabled }));
  console.log('  first-run mobile defaults:', JSON.stringify(defaults));
  if (defaults.q !== 'low' || !defaults.perf || !defaults.auto) throw new Error('phones should default to low quality + performance mode + auto-fire');
  if (defaults.shadows || defaults.ratio > 1.01) throw new Error('performance mode should disable shadows and cap resolution');

  // freeze bots out of the way; stand on the open strip
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    for (const p of sim.players) if (p && p !== me) { p.brain = null; p.isBot = false; p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0; }
    me.state.x = -18; me.state.y = 0.02; me.state.z = 30;
    w.game.view.yaw = 0; w.game.view.pitch = 0;
    w.settings.set('autoFire', false);
  });

  // ---- first touch switches the whole UI to touch ----
  const t0 = await page.touchscreen.touchStart(W * 0.75, H * 0.45);
  await wait(120);
  await t0.end();
  await wait(250);
  const ui = await evalGame((w) => ({
    device: w.input.device,
    controls: !document.querySelector('.touch').classList.contains('hidden'),
    buttons: [...document.querySelectorAll('.touch .tb')].map((b) => b.textContent),
    ctp: !document.querySelector('.click-to-play').classList.contains('hidden'),
    hudDevice: document.querySelector('.hud').dataset.device,
  }));
  console.log('  after first touch:', JSON.stringify(ui));
  if (ui.device !== 'touch' || !ui.controls || ui.ctp || ui.hudDevice !== 'touch') throw new Error('touch UI did not activate');
  for (const b of ['FIRE', 'AIM', 'JUMP', 'RELOAD', 'CROUCH', 'SWAP', 'THROW']) if (!ui.buttons.includes(b)) throw new Error(`missing touch button ${b}`);
  await wait(300);
  await evalGame((w) => { w.game.view.yaw = 0; w.game.view.pitch = 0; });

  // ---- left stick: push forward ----
  const z0 = await evalGame((w) => w.game.predictor.state.z);
  const stick = await page.touchscreen.touchStart(W * 0.18, H * 0.7);
  await wait(60);
  for (let i = 1; i <= 6; i++) { await stick.move(W * 0.18, H * 0.7 - i * 11); await wait(16); }
  await wait(250);
  const stickVisible = await page.evaluate(() => !document.querySelector('.t-stick').classList.contains('hidden'));
  await shot('touch-playing');
  await wait(750);
  // ---- right side drag while moving (multi-touch): turn right ----
  const y0 = await evalGame((w) => w.game.view.yaw);
  const look = await page.touchscreen.touchStart(W * 0.6, H * 0.4);
  for (let i = 1; i <= 10; i++) { await look.move(W * 0.6 + i * 12, H * 0.4); await wait(16); }
  await look.end();
  await wait(100);
  const y1 = await evalGame((w) => w.game.view.yaw);
  await stick.end();
  await wait(200);
  const z1 = await evalGame((w) => w.game.predictor.state.z);
  console.log(`  stick forward ~1.3s: moved ${(z0 - z1).toFixed(2)}m (stick shown: ${stickVisible}); 120px look drag turned ${(y0 - y1).toFixed(2)} rad`);
  if (z0 - z1 < 3) throw new Error('virtual stick did not move the player');
  if (Math.abs((y0 - y1) - 120 * 0.0052) > 0.08) throw new Error('look drag did not turn the camera as expected');
  if (!stickVisible) throw new Error('virtual stick should be visible while held');

  const center = async (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const tap = async (sel, ms = 90) => { const [x, y] = await center(sel); const t = await page.touchscreen.touchStart(x, y); await wait(ms); await t.end(); await wait(90); };

  // ---- FIRE (hold) + drag on the button keeps aiming ----
  await evalGame((w) => { w.game.view.yaw = 0; w.game.view.pitch = 0.5; });
  const s0 = await evalGame((w) => ({ shots: w.game.predictor.state.shots, yaw: w.game.view.yaw }));
  const [fx, fy] = await center('.tb.fire');
  const fire = await page.touchscreen.touchStart(fx, fy);
  for (let i = 1; i <= 8; i++) { await fire.move(fx - i * 6, fy); await wait(40); }
  await fire.end();
  await wait(150);
  const s1 = await evalGame((w) => ({ shots: w.game.predictor.state.shots, yaw: w.game.view.yaw }));
  console.log(`  FIRE held: ${s1.shots - s0.shots} shots, dragging on the button turned ${(s1.yaw - s0.yaw).toFixed(2)} rad left`);
  if (s1.shots - s0.shots < 2) throw new Error('fire button did not shoot');
  if (s1.yaw - s0.yaw < 0.15) throw new Error('dragging on the fire button should keep turning the view');

  // ---- AIM toggle, JUMP, CROUCH, SWAP, RELOAD, THROW ----
  await tap('.tb.aim');
  await wait(150);
  const aim = await evalGame((w) => w.game.predictor.state.aiming);
  await tap('.tb.aim');
  await tap('.tb.jump', 120);
  const air = await evalGame((w) => w.game.predictor.state.grounded);
  await wait(900);
  await tap('.tb.crouch');
  await wait(200);
  const crouch = await evalGame((w) => ({ c: w.game.predictor.state.crouching, lit: document.querySelector('.tb.crouch').classList.contains('on') }));
  await tap('.tb.crouch');
  await tap('.tb.swap');
  await wait(500);
  const slot = await evalGame((w) => w.game.predictor.state.slot);
  await tap('.tb.swap');
  await wait(500);
  await tap('.tb.reload');
  await wait(200);
  const rel = await evalGame((w) => w.game.predictor.state.reloadT > 0);
  const th0 = await evalGame((w) => w.game.predictor.state.throwables);
  await tap('.tb.throw');
  await wait(200);
  const th1 = await evalGame((w) => w.game.predictor.state.throwables);
  console.log(`  buttons: aim=${aim === 1} jump(airborne)=${air === 0} crouch=${crouch.c === 1}(lit ${crouch.lit}) swap->slot ${slot} reload=${rel} throw ${th0}->${th1}`);
  if (aim !== 1 || air !== 0 || crouch.c !== 1 || !crouch.lit || slot !== 1 || !rel || th1 !== th0 - 1) throw new Error('a touch button did not work');

  // ---- auto-fire: reticle resting on an enemy shoots by itself ----
  await wait(2600);
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    const foe = sim.players.find((p) => p && p.team !== me.team);
    me.state.x = -18; me.state.z = 30; me.state.y = 0.02;
    foe.state.x = -18; foe.state.z = 18; foe.state.y = 0.02; foe.protectedUntil = 0; foe.alive = true; foe.health = 100;
    w.game.view.yaw = 0; w.game.view.pitch = -0.04;
    w.settings.set('autoFire', true);
  });
  const a0 = await evalGame((w) => w.game.predictor.state.shots);
  await wait(900);
  const a1 = await evalGame((w) => ({ shots: w.game.predictor.state.shots, hp: w.session.sim.players.find((p) => p && p.team !== w.game.hudState.myTeam).health }));
  console.log(`  auto-fire: ${a1.shots - a0} shots without touching FIRE (enemy hp ${Math.round(a1.hp)})`);
  if (a1.shots - a0 < 2) throw new Error('auto-fire did not shoot at the enemy under the reticle');
  await evalGame((w) => w.settings.set('autoFire', false));

  // ---- pause button + resume by tap ----
  await tap('.tb.pause');
  await wait(250);
  const paused = await evalGame((w) => ({ p: w.game.paused, controlsHidden: document.querySelector('.touch').classList.contains('hidden') }));
  if (!paused.p || !paused.controlsHidden) throw new Error('pause button should open the menu and hide the controls');
  await shot('touch-paused');
  await tap('.pause .btn.primary');
  await wait(250);
  if (await evalGame((w) => w.game.paused)) throw new Error('RESUME tap did not resume');

  // ---- layout sanity: nothing important overlaps the thumbs' buttons ----
  const overlap = await page.evaluate(() => {
    const rect = (s) => document.querySelector(s).getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const out = [];
    for (const hud of ['.health', '.ammo', '.minimap-box', '.scorebar']) {
      for (const tb of document.querySelectorAll('.touch .tb')) if (hit(rect(hud), tb.getBoundingClientRect())) out.push(`${hud} x ${tb.textContent}`);
    }
    return out;
  });
  console.log('  HUD/touch overlaps:', overlap.length ? overlap.join(', ') : 'none');
  if (overlap.length) throw new Error('HUD panels overlap touch buttons');
  const perf = await evalGame((w) => ({ fps: w.game.stats.fps, calls: w.game.stats.drawCalls }));
  console.log('  perf (emulated phone viewport):', JSON.stringify(perf));

  // ---- portrait: ask the player to rotate ----
  await page.setViewport({ ...vp, width: H, height: W, isLandscape: false });
  await wait(400);
  const rot = await page.evaluate(() => getComputedStyle(document.querySelector('.rotate-hint')).display);
  console.log('  portrait rotate hint display:', rot);
  if (rot === 'none') throw new Error('rotate hint should show in portrait during a match');
  await shot('touch-portrait');
}
