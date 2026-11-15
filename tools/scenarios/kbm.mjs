// Desktop controls: WASD, sprint, jump, crouch, mouse look, right-click aim (camera zoom), shoulder swap,
// weapon keys, reload, throw, scoreboard, and the camera staying out of walls.
// Run with ?auto=practice&nolock=1 so headless Chrome can feed mouse deltas without pointer lock.
export default async function ({ page, shot, wait, down, up, evalGame, waitForGame }) {
  await waitForGame();
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  const place = (x, z, yaw) => evalGame((w, x, z, yaw) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    for (const p of sim.players) if (p && p !== me) { p.brain = null; p.isBot = false; p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0; }
    me.state.x = x; me.state.y = 0.02; me.state.z = z; me.state.vx = 0; me.state.vz = 0;
    w.game.view.yaw = yaw; w.game.view.pitch = 0;
  }, x, z, yaw);
  const st = () => evalGame((w) => ({ ...w.game.predictor.state, viewYaw: w.game.view.yaw, viewPitch: w.game.view.pitch, fov: w.game.rig.camera.fov, boom: w.game.rig.dist, side: w.game.rig.side, camX: w.game.rig.camera.position.x }));
  await page.focus('body');
  await place(-18, 30, 0);
  await wait(500);

  // WASD
  const a = await st();
  await down('KeyW'); await wait(1000); await up('KeyW');
  const b = await st();
  await down('KeyD'); await wait(600); await up('KeyD');
  const c = await st();
  await down('KeyS'); await wait(500); await up('KeyS');
  await down('KeyA'); await wait(500); await up('KeyA');
  await wait(200);
  const d = await st();
  console.log(`  W: ${(a.z - b.z).toFixed(1)}m north | D: ${(c.x - b.x).toFixed(1)}m east | S+A: back ${(d.z - c.z).toFixed(1)}m, left ${(c.x - d.x).toFixed(1)}m`);
  if (a.z - b.z < 3.5 || c.x - b.x < 1.5 || d.z - c.z < 1 || c.x - d.x < 1) throw new Error('WASD movement wrong');

  // sprint is faster than walking; jump leaves the ground; C toggles crouch
  await place(-18, 30, 0);
  await wait(300);
  await down('ShiftLeft'); await down('KeyW'); await wait(1000);
  const sprinting = (await st()).sprinting;
  await down('Space'); await wait(120); await up('Space'); await wait(150);
  const air = (await st()).grounded;
  await up('KeyW'); await up('ShiftLeft');
  const e = await st();
  await wait(700);
  await page.keyboard.press('KeyC'); await wait(350);
  const crouched = (await st()).crouching;
  await page.keyboard.press('KeyC'); await wait(350);
  const stood = (await st()).crouching;
  console.log(`  sprint=${sprinting === 1} (${(30 - e.z).toFixed(1)}m in ~1.3s) jump airborne=${air === 0} crouch toggle=${crouched === 1}/${stood === 0}`);
  if (sprinting !== 1 || air !== 0 || crouched !== 1 || stood !== 0 || 30 - e.z < 6.5) throw new Error('sprint / jump / crouch wrong');

  // mouse look
  await place(-18, 30, 0);
  await page.mouse.move(400, 300);
  await wait(200);
  const m0 = await st();
  await page.mouse.move(600, 250, { steps: 10 });
  await wait(200);
  const m1 = await st();
  console.log(`  mouse 200px right / 50px up: yaw ${(m1.viewYaw - m0.viewYaw).toFixed(3)}, pitch ${(m1.viewPitch - m0.viewPitch).toFixed(3)}`);
  if (Math.abs(m1.viewYaw - m0.viewYaw + 200 * 0.0023) > 0.03 || Math.abs(m1.viewPitch - m0.viewPitch - 50 * 0.0023) > 0.03) throw new Error('mouse look scale wrong');

  // right-click aim zooms in, release zooms out; Q swaps shoulder
  await page.mouse.down({ button: 'right' });
  await wait(600);
  const aim = await st();
  await shot('kbm-aim');
  await page.mouse.up({ button: 'right' });
  await wait(500);
  const hip = await st();
  await page.keyboard.press('KeyQ'); await wait(500);
  const swapped = await st();
  await page.keyboard.press('KeyQ'); await wait(300);
  console.log(`  aim: fov ${hip.fov.toFixed(1)} -> ${aim.fov.toFixed(1)}, boom ${hip.boom.toFixed(2)} -> ${aim.boom.toFixed(2)}; shoulder ${hip.side} -> ${swapped.side}`);
  if (aim.aiming !== 1 || aim.fov > hip.fov - 5 || aim.boom > 1.7 || hip.boom < 2.8 || swapped.side !== -hip.side) throw new Error('aim zoom / shoulder swap wrong');

  // weapon keys 1-3, reload, throw
  await page.keyboard.press('Digit2'); await wait(450);
  const s2 = (await st()).slot;
  await page.keyboard.press('Digit3'); await wait(450);
  const s3 = (await st()).slot;
  await page.keyboard.press('Digit1'); await wait(550);
  const s1 = (await st()).slot;
  await evalGame((w) => { w.game.view.pitch = 0.7; });
  await page.mouse.down(); await wait(300); await page.mouse.up();
  await page.keyboard.press('KeyR'); await wait(200);
  const reloading = (await st()).reloadT > 0;
  await page.keyboard.press('KeyG'); await wait(250);
  const thr = (await st()).throwables;
  console.log(`  slots 2/3/1 -> ${s2}/${s3}/${s1}; reload started=${reloading}; throwables left ${thr}`);
  if (s2 !== 1 || s3 !== 2 || s1 !== 0 || !reloading || thr !== 1) throw new Error('weapon keys / reload / throw wrong');

  // Tab holds the scoreboard open
  await down('Tab'); await wait(300);
  const board = await page.evaluate(() => !document.querySelector('.scoreboard').classList.contains('hidden'));
  await up('Tab'); await wait(200);
  const boardOff = await page.evaluate(() => document.querySelector('.scoreboard').classList.contains('hidden'));
  if (!board || !boardOff) throw new Error('Tab scoreboard wrong');

  // camera collision: back against the S-Curve base wall, the camera must stay on our side of it
  await place(-66.0, -5, -Math.PI / 2);
  await wait(700);
  const cam = await st();
  console.log(`  back to a wall at x=-66.7: camera x=${cam.camX.toFixed(2)}, boom ${cam.boom.toFixed(2)}`);
  if (cam.camX < -66.7 || cam.boom > 0.8) throw new Error('camera clipped into the wall');
  await place(-18, 30, 0);
  await wait(900);
  const free = await st();
  if (free.boom < 2.8) throw new Error('camera should ease back out when clear');
  console.log('  ok');
}
