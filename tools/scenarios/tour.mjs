// Art tour: screenshots of the dressed world from a handful of vantage points (practice match, bots parked).
export default async function ({ page, shot, wait, evalGame, waitForGame, opt }) {
  await waitForGame();
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 30000 });
  const go = async (x, z, yaw, pitch = -0.05) => {
    await evalGame((w, x, z, yaw, pitch) => {
      const sim = w.session.sim;
      const me = sim.players[w.session.myIdx];
      me.state.x = x; me.state.y = 0.02; me.state.z = z; me.state.vx = 0; me.state.vz = 0;
      me.protectedUntil = 1e12;
      w.game.view.yaw = yaw; w.game.view.pitch = pitch;
    }, x, z, yaw, pitch);
    await wait(700);
  };
  await evalGame((w) => {
    const sim = w.session.sim;
    const me = sim.players[w.session.myIdx];
    let k = 0;
    for (const p of sim.players) if (p && p !== me) { p.brain = null; p.isBot = false; p.protectedUntil = 1e12; p.state.x = -14 + (k++) * 1.6; p.state.z = 2.5 + (k % 2) * 1.2; p.state.yaw = Math.PI; }
  });
  const spots = (opt.spots ?? 'store,sroad,court,yard,crossing,alley,park,base').split(',');
  const views = {
    store: [0, 4.6, 0, -0.02],
    sroad: [-50, 12, -1.1, -0.04],
    court: [-46, 36, 0.15, -0.08],
    yard: [36.5, 27.5, -1.75, -0.03],
    crossing: [31, -1.5, -1.57, -0.02],
    alley: [-10.5, 22.5, -1.57, -0.02],
    park: [-12, -24, -2.3, -0.05],
    base: [-78, 6, -1.2, 0.02],
    liquor: [-24, -6, 1.2, -0.02],
    warehouse: [40, -35, -1.57, 0.0],
    roof: [-48, 44, 0, -0.25],
  };
  for (const name of spots) {
    const v = views[name];
    if (!v) continue;
    if (name === 'roof') await evalGame((w) => { w.session.sim.players[w.session.myIdx].state.y = 5.6; });
    await go(...v);
    if (name === 'roof') await evalGame((w) => { w.session.sim.players[w.session.myIdx].state.y = 5.6; });
    await shot(`tour-${name}`);
  }
  const perf = await evalGame((w) => ({ fps: w.game.stats.fps, calls: w.game.stats.drawCalls, tris: w.game.stats.triangles, failed: w.app.assets.failed, chars: w.app.assets.characters.length }));
  console.log('  perf:', JSON.stringify(perf));
}
