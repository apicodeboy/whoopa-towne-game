// Combat in a local bot match: shooting, health, hit markers, kill feed, reload, damage direction,
// death + respawn, scoreboard, and prediction staying in sync. Run with ?auto=practice&nolock=1.
export default async function ({ page, shot, wait, down, up, evalGame, waitForGame, opt }) {
  await waitForGame();
  // wait for the warm-up to finish
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 15000 });
  await wait(500);
  const info = await evalGame((w) => ({
    roster: w.session.roster.length,
    remotes: w.game.remotes.size,
    hp: w.game.hudState.health,
    mag: w.game.hudState.mag,
    fps: w.game.stats.fps,
    mode: w.session.mode,
    team: w.game.hudState.myTeam,
  }));
  console.log('  match:', JSON.stringify(info));
  if (info.roster !== 8 || info.remotes !== 7) throw new Error('expected 8 players (7 remote)');
  if (info.hp !== 100) throw new Error('should start at 100 health');
  await shot('s2-hud');

  // --- prediction check: run around for 3 seconds, the server must agree with the prediction ---
  await page.focus('body');
  const c0 = await evalGame((w) => w.game.stats.corrections);
  await down('KeyW'); await down('ShiftLeft');
  await wait(1200);
  await down('Space'); await wait(100); await up('Space');
  await down('KeyD'); await wait(900); await up('KeyD');
  await up('ShiftLeft'); await up('KeyW');
  await wait(400);
  const c1 = await evalGame((w) => ({ c: w.game.stats.corrections, pend: w.game.predictor.pendingCount, x: w.game.predictor.state.x }));
  console.log(`  prediction: ${c1.c - c0} corrections while moving, ${c1.pend} inputs pending, x=${c1.x.toFixed(1)}`);
  if (c1.c - c0 > 3) throw new Error('prediction and server disagree while moving');

  // --- shooting: stand an enemy bot in front of us on the open strip and fire ---
  const setup = await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    const enemy = sim.players.find((p) => p && p.team !== me.team);
    for (const p of sim.players) {
      if (!p || p === me || p === enemy) continue;
      // park everyone else far away and keep them from interfering
      p.state.x = p.team === 0 ? -76 : 76; p.state.z = 0;
      p.brain = null; p.isBot = false;
    }
    me.state.x = -18; me.state.y = 0.02; me.state.z = 30; me.state.vx = 0; me.state.vz = 0;
    enemy.brain = null; enemy.isBot = false; // freeze it in place (no inputs => stands still)
    enemy.state.x = -18; enemy.state.y = 0.02; enemy.state.z = 23; enemy.state.vx = 0; enemy.state.vz = 0;
    enemy.protectedUntil = 0; me.protectedUntil = 0;
    enemy.health = 100;
    w.game.view.yaw = 0; w.game.view.pitch = -0.04;
    return { enemy: enemy.idx, name: enemy.name };
  });
  await wait(700);
  await shot('s2-target');
  const onTarget = await evalGame((w) => w.game.hudState.onTarget);
  console.log('  reticle on enemy:', onTarget);
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await wait(220);
  await page.mouse.up();
  await wait(250);
  const after = await evalGame((w, idx) => {
    const sim = w.session.sim;
    return { enemyHp: sim.players[idx].health, mag: w.game.hudState.mag, shots: w.game.predictor.state.shots, corr: w.game.stats.corrections };
  }, setup.enemy);
  console.log('  after a burst:', JSON.stringify(after));
  if (!(after.enemyHp < 100)) throw new Error('burst did not damage the enemy');
  if (!(after.mag < 30)) throw new Error('ammo did not go down');
  await shot('s2-firing');

  // finish the enemy: kill feed + kill marker
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await wait(100);
    if (await evalGame((w) => w.game.hudState.players.find((p) => p.me).kills) > 0) break;
  }
  await page.mouse.up();
  await wait(300);
  const kills = await evalGame((w) => ({
    kills: w.game.hudState.players.find((p) => p.me).kills, feed: document.querySelectorAll('.kf').length, score: w.game.hudState.scores,
    confirm: document.querySelector('.killconfirm:not(.hidden)')?.textContent ?? '',
  }));
  console.log('  kills:', JSON.stringify(kills));
  if (kills.kills < 1 || kills.feed < 1) throw new Error('kill not registered in the HUD');
  if (!kills.confirm.startsWith('ELIMINATED' + setup.name)) throw new Error(`kill confirmation missing (got "${kills.confirm}")`);
  await shot('s2-kill');

  // --- reload ---
  await page.keyboard.press('KeyR');
  await wait(300);
  const rel = await evalGame((w) => w.game.hudState.reload);
  console.log('  reloading:', rel >= 0);
  await wait(2400);
  const mag = await evalGame((w) => w.game.hudState.mag);
  if (mag !== 30) throw new Error(`reload should refill the AR magazine, got ${mag}`);

  // --- taking damage, dying and respawning ---
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    const foe = sim.players.find((p) => p && p.team !== me.team && p.alive) ?? sim.players.find((p) => p && p.team !== me.team);
    sim.damage(me, 60, foe.idx, 1, false, me.state.x + 5, me.state.z - 5);
  });
  await wait(200);
  const hurt = await evalGame((w) => ({ hp: w.game.hudState.health, arcs: document.querySelectorAll('.dmg-arcs .arc').length }));
  console.log('  after 60 damage:', JSON.stringify(hurt));
  if (hurt.hp !== 40 || hurt.arcs < 1) throw new Error('damage / direction indicator missing');
  await shot('s2-hurt');
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    const foe = sim.players.find((p) => p && p.team !== me.team);
    sim.damage(me, 100, foe.idx, 1, true, me.state.x, me.state.z - 8);
  });
  await wait(600);
  const dead = await evalGame((w) => ({ alive: w.game.hudState.alive, respawn: !document.querySelector('.respawn').classList.contains('hidden'), killer: w.game.hudState.killer }));
  console.log('  dead:', JSON.stringify(dead));
  if (dead.alive || !dead.respawn) throw new Error('death overlay missing');
  await shot('s2-dead');
  await wait(5200);
  const back = await evalGame((w) => ({ alive: w.game.hudState.alive, hp: w.game.hudState.health, x: w.game.predictor.state.x, shield: w.game.hudState.spawnProtected }));
  console.log('  respawned:', JSON.stringify(back));
  if (!back.alive || back.hp !== 100 || Math.abs(back.x) < 60) throw new Error('did not respawn at the base');

  // scoreboard
  await down('Tab');
  await wait(400);
  await shot('s2-scoreboard');
  await up('Tab');
  const fps = await evalGame((w) => ({ fps: w.game.stats.fps, calls: w.game.stats.drawCalls, tris: w.game.stats.triangles }));
  console.log('  perf:', JSON.stringify(fps));
}
