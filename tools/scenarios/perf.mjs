// Performance probe: an 8-player bot match, measured from several spots on the map.
// Reports fps, CPU time per frame (JS only), draw calls and triangles.
//   desktop: node tools/play.mjs tools/scenarios/perf.mjs --url="http://localhost:5173/?auto=practice&nolock=1&warmup=1&seed=3"
//   phone:   add --mobile --w=844 --h=390 --throttle=4   (4x CPU slowdown, like a low-end phone)
const SPOTS = [
  { name: 'blue base', x: -60, z: 0, yaw: -Math.PI / 2 },
  { name: 'S-road', x: -40, z: -20, yaw: -1.2 },
  { name: 'court', x: -46, z: 30, yaw: -Math.PI / 2 },
  { name: 'strip, looking east', x: -14, z: -1, yaw: -Math.PI / 2 },
  { name: 'strip, looking west', x: 14, z: -1, yaw: Math.PI / 2 },
  { name: 'rail yard', x: 40, z: 26, yaw: Math.PI / 2 },
  { name: 'overpass top', x: 46, z: 40, yaw: 0.4 },
  { name: 'warehouse', x: 46, z: -34, yaw: Math.PI },
];

export default async function ({ page, wait, evalGame, waitForGame, opt, shot }) {
  await waitForGame();
  await page.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  if (opt.quality) await evalGame((w, q) => w.settings.set('quality', q), opt.quality);
  if (opt.perfmode !== undefined) await evalGame((w, on) => w.settings.set('performanceMode', on), opt.perfmode !== '0');
  await wait(1500); // let the models finish loading / shaders compile
  const throttle = +(opt.throttle ?? 1);
  if (throttle > 1) await page.emulateCPUThrottling(throttle);

  // measure the JS cost of each frame
  await evalGame((w) => {
    const g = w.game;
    const orig = g.update.bind(g);
    w.__perf = { ms: 0, frames: 0, worst: 0 };
    g.update = (dt) => {
      const t0 = performance.now();
      orig(dt);
      const d = performance.now() - t0;
      w.__perf.ms += d;
      w.__perf.frames++;
      if (d > w.__perf.worst) w.__perf.worst = d;
    };
  });

  const info = await evalGame((w) => ({
    quality: w.settings.values.quality, perf: w.settings.values.performanceMode,
    pr: w.app.stage.gfx.profile.pixelRatio, shadows: w.app.stage.gfx.profile.shadows,
    size: [w.app.stage.gfx.renderer.domElement.width, w.app.stage.gfx.renderer.domElement.height],
    characters: w.app.assets.characters.length,
  }));
  console.log(`  quality ${info.quality}${info.perf ? ' + performance mode' : ''}, canvas ${info.size.join('x')} (pixel ratio ${info.pr.toFixed(2)}), shadows ${info.shadows}, cpu throttle ${throttle}x`);

  const rows = [];
  for (const s of SPOTS) {
    await evalGame((w, s) => {
      const sim = w.session.sim;
      const me = sim.players[w.session.myIdx];
      me.state.x = s.x; me.state.z = s.z; me.state.y = s.y ?? 0.05;
      me.state.vx = 0; me.state.vz = 0; me.state.vy = 0;
      me.health = 100; me.protectedUntil = 1e9;
      w.game.view.yaw = s.yaw; w.game.view.pitch = -0.05;
      w.__perf.ms = 0; w.__perf.frames = 0; w.__perf.worst = 0;
    }, s);
    await wait(500);
    await evalGame((w) => { w.__perf.ms = 0; w.__perf.frames = 0; w.__perf.worst = 0; w.__perf.t0 = performance.now(); });
    await wait(2000);
    const r = await evalGame((w) => ({
      fps: w.__perf.frames / ((performance.now() - w.__perf.t0) / 1000),
      cpu: w.__perf.ms / Math.max(1, w.__perf.frames), worst: w.__perf.worst,
      calls: w.game.stats.drawCalls, tris: w.game.stats.triangles,
    }));
    rows.push({ ...s, ...r });
    console.log(`  ${s.name.padEnd(22)} ${r.fps.toFixed(0).padStart(3)} fps  cpu ${r.cpu.toFixed(2).padStart(5)} ms/frame (worst ${r.worst.toFixed(1)})  ${String(r.calls).padStart(4)} calls  ${(r.tris / 1000).toFixed(0).padStart(4)}k tris`);
    if (opt.shots) await shot(`perf-${s.name.replace(/[^a-z]+/gi, '-')}`);
  }
  const minFps = Math.min(...rows.map((r) => r.fps));
  const maxCpu = Math.max(...rows.map((r) => r.cpu));
  console.log(`  => lowest ${minFps.toFixed(0)} fps, highest average CPU ${maxCpu.toFixed(2)} ms/frame`);
  const target = +(opt.target ?? 0);
  if (target > 0 && minFps < target) throw new Error(`below the ${target} fps target`);
}
