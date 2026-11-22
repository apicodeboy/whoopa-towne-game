// Where the frame time goes (uncapped): node tools/play.mjs tools/scenarios/lag.mjs --url="http://localhost:5173/?nolock=1&warmup=2" --uncapped=1 --dpr=2 --w=1440 --h=900
// the same with each feature switched off in turn. Uncapped (run with --uncapped --dpr=2).
// Also times the main-thread pieces (game update, minimap, billboards, particles, render).
export default async function ({ page, wait, evalGame, waitForGame, errors, opt }) {
  await waitForGame();
  await evalGame((w) => w.app.assetsReady);
  await wait(800);
  const menuMs = await frames(page, 120);
  await evalGame((w) => w.app.startPractice('porch', 'normal'));
  await page.waitForFunction(() => { const s = window.__whoopa.game?.session?.sim; return s && s.porch && Number.isFinite(s.porch.takeoff); }, { timeout: 90000 });
  await wait(1000);
  const put = (sec) => evalGame((w, a) => {
    const g = w.game, sim = g.session.sim, me = sim.players[g.session.myIdx];
    sim.porch.takeoff = sim.time - a[0] * 1000;
    if (sim.porch.steps) for (const s of sim.porch.steps) { s.start = Math.max(s.start, sim.time + 60000); s.end = Math.max(s.end, s.start + 1); }
    for (const st of [me.state, g.predictor.state]) { st.air = 0; st.x = 150; st.y = 0.05; st.z = 40; st.vx = st.vy = st.vz = 0; st.yaw = 0.3; st.grounded = 1; }
    g.view.yaw = 0.3; g.view.pitch = 0.05;
    me.protectedUntil = Infinity;
  }, [sec]);
  // main-thread timers around the per-frame pieces
  await evalGame((w) => {
    const g = w.game, T = (w.__t = {});
    const wrap = (obj, name, key) => {
      const f = obj[name].bind(obj);
      obj[name] = (...a) => { const t0 = performance.now(); const r = f(...a); T[key] = (T[key] ?? 0) + performance.now() - t0; return r; };
    };
    wrap(g.hud.minimap, 'draw', 'minimap');
    wrap(g.stage.world, 'update', 'world (billboards, sky, interiors)');
    wrap(g.effects, 'update', 'effects + particles');
    wrap(g.gfx, 'render', 'render (incl. post)');
    wrap(g.hud, 'update', 'hud');
    if (g.porchHud) wrap(g.porchHud, 'update', 'porch hud');
    wrap(g.session, 'update', 'sim (bots, local match)');
    for (const rp of g.remotes.values()) wrap(rp, 'update', 'other players (anim)');
    // all of the game's JavaScript in a frame (the rest of the frame time is the GPU / browser)
    const f = g.frame;
    g.frame = (now) => { const t0 = performance.now(); f(now); T['ALL JS'] = (T['ALL JS'] ?? 0) + performance.now() - t0; };
  });
  const measure = async (label, n = 150) => {
    await evalGame((w) => { for (const k of Object.keys(w.__t)) w.__t[k] = 0; });
    const ms = await frames(page, n);
    const parts = await evalGame((w, n) => Object.entries(w.__t).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(' · ') + ` · draws ${w.game.stats.drawCalls} · tris ${(w.game.stats.triangles / 1000).toFixed(0)}k · players ${w.game.remotes.size + 1}`, n);
    console.log(`  ${label.padEnd(34)} ${ms.toFixed(1)} ms/frame (${(1000 / ms).toFixed(0)} fps)   [${parts}]`);
    return ms;
  };
  const q = await evalGame((w) => ({ quality: w.settings.values.quality, post: w.app.stage.gfx.postFx, pr: w.app.stage.gfx.renderer.getPixelRatio().toFixed(2), dyn: w.settings.values.dynamicRes }));
  console.log('  settings', JSON.stringify(q), 'menu', menuMs.toFixed(1), 'ms/frame');
  const has = (k) => evalGame((w, k) => k in w.settings.values, k);
  const hasPost = await has('postFx');
  await evalGame((w) => w.settings.set('dynamicRes', false));
  for (const [sec, tag] of [[100, 'day'], [220, 'night']]) {
    await put(sec);
    await wait(1500);
    await measure(`${tag}: everything on`);
    if (hasPost) {
      await evalGame((w) => w.settings.set('postFx', false));
      await wait(800);
      await measure(`${tag}: post effects off`);
      await evalGame((w) => w.settings.set('postFx', true));
      await wait(800);
    }
  }
  await put(100);
  await wait(800);
  for (const [k, v] of [['quality', 'medium'], ['quality', 'low']]) {
    await evalGame((w, a) => w.settings.set(a[0], a[1]), [k, v]);
    await wait(1500);
    await measure(`day: quality ${v}`);
  }
  await evalGame((w) => { w.settings.set('quality', 'high'); w.settings.set('dynamicRes', true); });
  console.log('  errors:', errors.length, errors.slice(0, 3).join(' | '));
}

function frames(page, n) {
  return page.evaluate((n) => new Promise((res) => { let k = 0; const t0 = performance.now(); const f = () => { k++; if (k < n) requestAnimationFrame(f); else res((performance.now() - t0) / n); }; requestAnimationFrame(f); }), n);
}
