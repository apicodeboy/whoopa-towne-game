// Step 7a: controllers. A fake "standard" gamepad is injected through the Gamepad API so the real
// polling / detection / prompt code runs: DualSense + Xbox prompts, menu navigation, sticks, triggers,
// deadzones, aim assist slowdown, rumble, pause with Options/Start.
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

export async function before({ page }) {
  await page.evaluateOnNewDocument(() => {
    const pad = {
      id: '', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: { playEffect: () => { window.__rumbles = (window.__rumbles || 0) + 1; return Promise.resolve('complete'); } },
    };
    window.__pad = pad;
    window.__padOn = false;
    navigator.getGamepads = () => (window.__padOn ? [pad, null, null, null] : [null, null, null, null]);
    window.__plug = (id) => {
      pad.id = id;
      window.__padOn = true;
      window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
    };
  });
}

export default async function ({ page, shot, wait, evalGame, waitForGame }) {
  await waitForGame();
  await wait(600);
  const press = async (i, ms = 90) => {
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = true; window.__pad.buttons[b].value = 1; }, i);
    await wait(ms);
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = false; window.__pad.buttons[b].value = 0; }, i);
    await wait(70);
  };
  const axes = (a) => page.evaluate((v) => { window.__pad.axes = v; }, a);
  const focused = () => page.evaluate(() => document.querySelector('.nav-focus')?.textContent ?? null);

  // ---- plug in a DualSense: auto-detected ----
  await page.evaluate((id) => window.__plug(id), DUALSENSE);
  await wait(300);
  const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent);
  console.log('  toast:', toast);
  if (!/PlayStation controller connected/.test(toast ?? '')) throw new Error('controller connection not announced');

  // ---- menu navigation with the d-pad ----
  await press(13); // down: ring appears on the primary action
  let f = await focused();
  console.log('  first focus:', f);
  if (f !== 'QUICK PLAY') throw new Error(`focus should start on QUICK PLAY, got ${f}`);
  const dev = await evalGame((w) => w.input.device);
  if (dev !== 'playstation') throw new Error(`device should be playstation, got ${dev}`);
  for (let i = 0; i < 8 && f !== 'PRACTICE VS BOTS'; i++) {
    await press(13);
    f = await focused();
  }
  console.log('  navigated to:', f);
  if (f !== 'PRACTICE VS BOTS') throw new Error('could not reach PRACTICE VS BOTS with the d-pad');
  await shot('pad-menu-focus');
  await press(15); // right: difficulty buttons sit beside it
  const f2 = await focused();
  console.log('  right of practice:', f2);
  await press(14); // back left
  await press(0); // Cross = accept
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  await wait(400);

  // sound starts for controller-only players too (no click or key press happened on this page)
  const snd = await evalGame((w) => w.app.audio.running);
  console.log('  audio running after starting with the controller only:', snd);
  if (!snd) throw new Error('audio should be started by controller input');

  // ---- prompts follow the controller ----
  const legendPs = await page.evaluate(() => document.querySelector('.hud .legend').textContent);
  console.log('  PS legend:', legendPs.replace(/\s+/g, ' '));
  for (const g of ['R2', 'L2', '□', '✕', '○', '△', 'L1', 'R1', 'Options']) if (!legendPs.includes(g)) throw new Error(`PS legend missing ${g}`);
  const ctp = await page.evaluate(() => !document.querySelector('.click-to-play').classList.contains('hidden'));
  if (ctp) throw new Error('"click to play" should not show for controller players');
  await shot('pad-ps-hud');

  // isolate the test: freeze the bots somewhere out of the way
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    for (const p of sim.players) if (p && p !== me) { p.brain = null; p.isBot = false; p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0; }
    me.state.x = -18; me.state.y = 0.02; me.state.z = 30;
    w.game.view.yaw = 0; w.game.view.pitch = 0;
  });
  await wait(500);

  // ---- left stick: deadzone, then full forward ----
  const p0 = await evalGame((w) => w.game.predictor.state.z);
  await axes([0.1, -0.1, 0, 0]); // inside the 15% deadzone
  await wait(500);
  const p1 = await evalGame((w) => w.game.predictor.state.z);
  if (Math.abs(p1 - p0) > 0.05) throw new Error(`drift inside the deadzone: ${p1 - p0}`);
  await axes([0, -1, 0, 0]);
  await wait(1000);
  await axes([0, 0, 0, 0]);
  await wait(250);
  const p2 = await evalGame((w) => w.game.predictor.state.z);
  console.log(`  left stick forward 1s: moved ${(p1 - p2).toFixed(2)}m north`);
  if (p1 - p2 < 3.5) throw new Error('left stick did not move the player');

  // ---- right stick: turn right ----
  const y0 = await evalGame((w) => w.game.view.yaw);
  await axes([0, 0, 1, 0]);
  await wait(400);
  await axes([0, 0, 0, 0]);
  await wait(100);
  const y1 = await evalGame((w) => w.game.view.yaw);
  const turned = ((y0 - y1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  console.log(`  right stick 0.4s: turned ${turned.toFixed(2)} rad right`);
  if (turned < 1.0 || turned > 2.6) throw new Error('right stick turn speed out of range');

  // ---- R2 fires, L2 aims, rumble on shots ----
  await evalGame((w) => { w.game.view.yaw = 0; w.game.view.pitch = 0.6; });
  const shots0 = await evalGame((w) => w.game.predictor.state.shots);
  await page.evaluate(() => { window.__rumbles = 0; window.__pad.buttons[7].value = 1; window.__pad.buttons[7].pressed = true; window.__pad.buttons[6].value = 0.8; });
  await wait(500);
  const mid = await evalGame((w) => ({ shots: w.game.predictor.state.shots, aiming: w.game.predictor.state.aiming }));
  await page.evaluate(() => { window.__pad.buttons[7].value = 0; window.__pad.buttons[7].pressed = false; window.__pad.buttons[6].value = 0; });
  const rumbles = await page.evaluate(() => window.__rumbles);
  console.log(`  R2 held 0.5s: ${mid.shots - shots0} shots, aiming=${mid.aiming === 1}, ${rumbles} rumble pulses`);
  if (mid.shots - shots0 < 3 || mid.aiming !== 1) throw new Error('triggers not working');
  if (rumbles < 3) throw new Error('vibration not triggered by shots');

  // ---- aim assist: look speed drops while the reticle is near a visible enemy ----
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    const foe = sim.players.find((p) => p && p.team !== me.team);
    me.state.x = -18; me.state.z = 30; me.state.y = 0.02;
    foe.state.x = -18; foe.state.z = 14; foe.state.y = 0.02; foe.protectedUntil = 0; foe.alive = true; foe.health = 100;
    w.game.view.yaw = 0; w.game.view.pitch = -0.03;
  });
  await wait(600);
  const onTarget = await evalGame((w) => ({ scale: w.input.ctx.assistScale, onTarget: w.game.hudState.onTarget }));
  await evalGame((w) => { w.game.view.yaw = 0.6; });
  await wait(300);
  const offTarget = await evalGame((w) => w.input.ctx.assistScale);
  await evalGame((w) => { w.game.view.yaw = 0; w.settings.set('aimAssist', false); });
  await wait(300);
  const disabled = await evalGame((w) => w.input.ctx.assistScale);
  await evalGame((w) => w.settings.set('aimAssist', true));
  console.log(`  aim assist look-speed scale: on target ${onTarget.scale.toFixed(2)} (reticle on enemy: ${onTarget.onTarget}), off target ${offTarget.toFixed(2)}, disabled ${disabled.toFixed(2)}`);
  if (!(onTarget.scale < 0.7) || offTarget !== 1 || disabled !== 1) throw new Error('aim assist slowdown wrong');

  // ---- Options pauses; Circle goes back ----
  await press(9);
  await wait(250);
  const paused = await evalGame((w) => ({ paused: w.game.paused, legend: document.querySelector('.pause-legend').textContent.replace(/\s+/g, ' ') }));
  console.log('  paused via Options:', paused.paused, '|', paused.legend.slice(0, 60));
  if (!paused.paused || !paused.legend.includes('PLAYSTATION')) throw new Error('pause menu / legend wrong');
  await shot('pad-pause');
  await press(1); // Circle = back = resume
  await wait(250);
  if (await evalGame((w) => w.game.paused)) throw new Error('Circle should resume');

  // ---- swap the controller for an Xbox pad: prompts change ----
  await page.evaluate((id) => window.__plug(id), XBOX);
  await axes([0, -0.5, 0, 0]);
  await wait(300);
  await axes([0, 0, 0, 0]);
  await wait(200);
  const legendXb = await page.evaluate(() => document.querySelector('.hud .legend').textContent);
  const dev2 = await evalGame((w) => w.input.device);
  console.log('  Xbox legend:', legendXb.replace(/\s+/g, ' '));
  if (dev2 !== 'xbox') throw new Error(`device should be xbox, got ${dev2}`);
  for (const g of ['RT', 'LT', 'LB', 'RB', 'Menu', 'View']) if (!legendXb.includes(g)) throw new Error(`Xbox legend missing ${g}`);
  if (legendXb.includes('□') || legendXb.includes('R2')) throw new Error('PlayStation glyphs still showing for an Xbox pad');
  await shot('pad-xbox-hud');

  // ---- touching the keyboard switches prompts back ----
  await page.keyboard.down('KeyW');
  await wait(200);
  await page.keyboard.up('KeyW');
  const dev3 = await evalGame((w) => w.input.device);
  if (dev3 !== 'kbm') throw new Error('keyboard input should switch prompts back to keyboard + mouse');
  console.log('  keyboard takes over again:', dev3);
}
