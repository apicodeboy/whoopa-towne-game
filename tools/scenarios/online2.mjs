// Step 3 in real browsers: two tabs, private lobby with invite code, ready-up, host starts, both see each other move.
export default async function ({ page, newClient, shot, wait, outDir }) {
  const A = page;
  const B = await newClient('B');
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa !== undefined', { timeout: 20000 });
  const clickText = async (p, sel, text) => {
    const h = await p.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t) && !b.closest('.hidden')), sel, text);
    const elh = h.asElement();
    if (!elh) throw new Error(`no element ${sel} containing "${text}"`);
    await elh.click();
  };
  const setName = async (p, name) => {
    await p.click('.menu-panel input.field');
    await p.evaluate(() => document.querySelector('.menu-panel input.field').select());
    await p.keyboard.type(name);
  };

  // --- A creates a private Turf War lobby ---
  await setName(A, 'Alpha');
  await clickText(A, '.menu-panel .seg', 'Gang Turf War');
  await clickText(A, '.menu-panel .btn', 'CREATE PRIVATE LOBBY');
  await A.waitForFunction('window.__whoopa.app.state === "lobby"', { timeout: 10000 });
  await wait(400);
  const code = await A.evaluate(() => document.querySelector('.invite-code').textContent);
  console.log('  invite code:', code);
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('bad invite code');

  // --- B joins with the code ---
  await setName(B, 'Bravo');
  await B.click('.menu-panel input.code');
  await B.keyboard.type(code.toLowerCase());
  await clickText(B, '.menu-panel .btn', 'JOIN WITH CODE');
  await B.waitForFunction('window.__whoopa.app.state === "lobby"', { timeout: 10000 });
  await wait(500);
  const lobbyB = await B.evaluate(() => ({
    title: document.querySelector('.lobby-title').textContent,
    rows: [...document.querySelectorAll('.prow:not(.empty)')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    hostBoxHidden: document.querySelector('.host-box').classList.contains('hidden'),
  }));
  console.log('  B lobby:', JSON.stringify(lobbyB));
  if (lobbyB.title !== 'GANG TURF WAR' || lobbyB.rows.length !== 2 || !lobbyB.hostBoxHidden) throw new Error('lobby view wrong for guest');
  await shot('o2-lobby-guest');

  // host cannot start until the guest is ready
  await wait(300);
  const startDisabled = await A.evaluate(() => [...document.querySelectorAll('.host-box .btn')].find((b) => b.textContent === 'START MATCH').disabled);
  if (!startDisabled) throw new Error('START should be disabled while a player is not ready');
  await clickText(B, '.lobby-panel .btn', 'READY UP');
  await A.waitForFunction(() => ![...document.querySelectorAll('.host-box .btn')].find((b) => b.textContent === 'START MATCH').disabled, { timeout: 5000 });
  await shot('o2-lobby-host');
  // turn bots off for a clean 1v1, then start
  await clickText(A, '.host-box .btn', 'FILL WITH BOTS');
  await wait(300);
  await clickText(A, '.host-box .btn', 'START MATCH');
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap', { timeout: 10000 });
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 15000 });
  const info = async (p) => p.evaluate(() => {
    const w = window.__whoopa;
    const other = [...w.game.remotes.values()][0];
    return {
      mode: w.session.mode, kind: w.session.kind, roster: w.session.roster.map((r) => `${r.name}:${r.team}`),
      me: [w.game.predictor.state.x, w.game.predictor.state.z].map((v) => +v.toFixed(1)),
      other: other ? [other.x, other.z].map((v) => +v.toFixed(1)) : null,
      fps: w.game.stats.fps, ping: Math.round(w.session.ping), corr: w.game.stats.corrections,
    };
  });
  const a0 = await info(A), b0 = await info(B);
  console.log('  A:', JSON.stringify(a0));
  console.log('  B:', JSON.stringify(b0));
  if (a0.kind !== 'online' || a0.mode !== 'turf' || a0.roster.length !== 2) throw new Error('match state wrong');

  // --- A runs forward; B must see A move (and vice versa nothing moves) ---
  await A.keyboard.down('KeyW');
  await wait(1500);
  await A.keyboard.up('KeyW');
  await wait(400);
  const a1 = await info(A), b1 = await info(B);
  const movedLocal = Math.hypot(a1.me[0] - a0.me[0], a1.me[1] - a0.me[1]);
  const movedSeen = Math.hypot(b1.other[0] - b0.other[0], b1.other[1] - b0.other[1]);
  console.log(`  A moved ${movedLocal.toFixed(1)}m locally; B saw A move ${movedSeen.toFixed(1)}m; A corrections ${a1.corr - a0.corr}; fps A ${a1.fps} B ${b1.fps}`);
  if (movedLocal < 4) throw new Error('A did not move');
  if (Math.abs(movedSeen - movedLocal) > 1.0) throw new Error('B does not see A where A is');
  if (a1.corr - a0.corr > 2) throw new Error('prediction corrections during plain movement');
  await shot('o2-match-A');
  await B.screenshot({ path: `${outDir}/o2-match-B.png` });
  // B turns to look at A's side of the map and takes a few steps; A must see it
  const bYaw0 = a1.other;
  await B.keyboard.down('KeyS');
  await wait(700);
  await B.keyboard.up('KeyS');
  await wait(400);
  const a15 = await info(A);
  const bSeen = Math.hypot(a15.other[0] - bYaw0[0], a15.other[1] - bYaw0[1]);
  console.log(`  A saw B back up ${bSeen.toFixed(1)}m; ping A ${a15.ping}ms`);
  if (bSeen < 1.5) throw new Error('A does not see B move');

  // --- B leaves: A is told and (bots off, alone) stays in the match ---
  await B.evaluate(() => window.__whoopa.app.lobby.leave());
  await wait(800);
  const a2 = await info(A);
  console.log('  after B left, A roster:', a2.roster.join(', '));
  if (a2.roster.length !== 1) throw new Error('roster should drop the leaver when bots are off');
}
