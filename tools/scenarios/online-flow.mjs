// Step 6 online flows in real browsers: Quick Play matchmaking, loadout sync in the lobby, host migration,
// invite deep link, bots filling a 4v4, host ending the match and everyone returning to the lobby.
export default async function ({ page, newClient, shot, wait, outDir, url }) {
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
  const inLobby = (p) => p.waitForFunction('window.__whoopa.app.state === "lobby"', { timeout: 10000 });
  const lobbyInfo = (p) => p.evaluate(() => ({
    code: document.querySelector('.invite-code').textContent,
    kind: document.querySelector('.lobby-kind').textContent,
    rows: [...document.querySelectorAll('.prow:not(.empty)')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    host: !document.querySelector('.host-box').classList.contains('hidden'),
  }));

  // ---- 1. Quick Play puts both players in the same public lobby ----
  await setName(A, 'Alpha');
  await setName(B, 'Bravo');
  await clickText(A, '.menu-panel .btn', 'QUICK PLAY');
  await inLobby(A);
  await clickText(B, '.menu-panel .btn', 'QUICK PLAY');
  await inLobby(B);
  await wait(500);
  const la = await lobbyInfo(A), lb = await lobbyInfo(B);
  console.log('  quick play: A', la.code, '| B', lb.code, '|', la.kind);
  if (la.code !== lb.code) throw new Error('Quick Play should match both players into one lobby');
  if (!/PUBLIC/.test(la.kind) || !la.host || lb.host) throw new Error('public lobby / host flags wrong');

  // ---- 2. loadout picked in the lobby is saved and shown to everyone ----
  await clickText(B, '.lobby-panel .btn', 'LOADOUT');
  await wait(200);
  await clickText(B, '.loadout .card', 'Stinger SMG');
  await clickText(B, '.loadout .btn', 'DONE');
  await A.waitForFunction(() => [...document.querySelectorAll('.prow')].some((r) => r.textContent.includes('Bravo') && r.textContent.includes('Stinger SMG')), { timeout: 5000 });
  console.log('  A sees Bravo with the Stinger SMG');

  // ---- 3. host leaves: the other player becomes host ----
  await clickText(A, '.lobby-panel .btn', 'LEAVE');
  await A.waitForFunction('window.__whoopa.app.state === "menu"', { timeout: 5000 });
  await B.waitForFunction(() => !document.querySelector('.host-box').classList.contains('hidden'), { timeout: 5000 });
  console.log('  host migrated to Bravo');
  await clickText(B, '.lobby-panel .btn', 'LEAVE');
  await B.waitForFunction('window.__whoopa.app.state === "menu"', { timeout: 5000 });

  // ---- 4. private lobby + invite deep link ----
  await clickText(A, '.menu-panel .btn', 'CREATE PRIVATE LOBBY');
  await inLobby(A);
  await wait(300);
  const code = (await lobbyInfo(A)).code;
  await B.goto(`${url.split('?')[0]}?join=${code}`, { waitUntil: 'load' });
  await B.waitForFunction('window.__whoopa !== undefined', { timeout: 20000 });
  await wait(600);
  const prefilled = await B.evaluate(() => document.querySelector('.menu-panel input.code').value);
  if (prefilled !== code) throw new Error(`invite link should prefill the code, got "${prefilled}"`);
  await clickText(B, '.menu-panel .btn', 'JOIN WITH CODE');
  await inLobby(B);
  console.log('  joined via invite link', code);
  await clickText(B, '.lobby-panel .btn', 'READY UP');
  await A.waitForFunction(() => ![...document.querySelectorAll('.host-box .btn')].find((b) => b.textContent === 'START MATCH').disabled, { timeout: 5000 });
  await clickText(A, '.host-box .btn', 'START MATCH');
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap && window.__whoopa.game.snap.phase === 1', { timeout: 20000 });
  const m = await A.evaluate(() => ({ roster: window.__whoopa.session.roster.length, bots: window.__whoopa.session.roster.filter((r) => r.bot).length, primaryB: window.__whoopa.game.loadout.primary }));
  const bLoad = await B.evaluate(() => window.__whoopa.game.loadout.primary);
  console.log(`  match: ${m.roster} players (${m.bots} bots), Bravo spawned with ${bLoad}`);
  if (m.roster !== 8 || m.bots !== 6) throw new Error('bots should fill to 4v4');
  if (bLoad !== 'smg') throw new Error('saved loadout should carry into the match');
  await wait(2500);
  await shot('flow-match-A');

  // ---- 5. host ends the match from the pause menu; both return to the lobby ----
  await A.keyboard.press('Escape');
  await wait(300);
  await clickText(A, '.pause .btn', 'END MATCH FOR EVERYONE');
  await clickText(A, '.pause .btn', 'REALLY END IT?');
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa.game && window.__whoopa.game.snap.phase === 2', { timeout: 6000 });
  await wait(500);
  const res = await B.evaluate(() => ({ results: !document.querySelector('.results-bar').classList.contains('hidden'), text: document.querySelector('.results-text').textContent, board: !document.querySelector('.scoreboard').classList.contains('hidden') }));
  console.log('  B end screen:', JSON.stringify(res));
  if (!res.results || !res.board) throw new Error('end-of-match screen missing online');
  await B.screenshot({ path: `${outDir}/flow-final-B.png` });
  for (const p of [A, B]) await p.waitForFunction('window.__whoopa.app.state === "lobby" && !window.__whoopa.app.game', { timeout: 20000 });
  await wait(400);
  const after = await lobbyInfo(A);
  console.log('  back in lobby:', JSON.stringify(after.rows));
  if (after.rows.length !== 2 || after.rows.some((r) => /READY$/.test(r) && !/NOT READY$/.test(r))) throw new Error('lobby should have both players with ready reset');
  await shot('flow-lobby-after');
}
