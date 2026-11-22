// M0 test route (roadmap): device A signs up, gets GRAMS (test payments), buys an AJ'S item,
// edits the character, keeps it, signs out. Device B (a separate browser, empty storage) signs
// in and must see the same character and owned item, and the server must put that look on
// the player in an online match.
//
// Run against a throwaway server so no real dev data is touched:
//   PORT=2667 ECONOMY_DB=<scratch>/economy.json ECONOMY_TEST_PAYMENTS=1 node server/dist/index.js
//   node tools/play.mjs tools/scenarios/m0route.mjs --url="http://localhost:5173/?nolock=1&server=http://localhost:2667"
export default async function ({ page, wait, evalGame, errors, newClient, opt }) {
  const SERVER = 'http://localhost:2667';
  const user = opt.user ?? `Route${Math.floor(Math.random() * 9000 + 1000)}`;
  const pass = 'route-pass-123';
  const api = async (path, token, body, form) => {
    const r = await fetch(SERVER + path, {
      method: body || form ? 'POST' : 'GET',
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      redirect: 'manual',
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const report = [];
  const check = (ok, what) => {
    report.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  };

  // ---- device A
  await page.waitForFunction('window.__whoopa && window.__whoopa.app', { timeout: 30000 });
  await evalGame((w) => w.app.assetsReady);
  await evalGame((w, a) => w.app.account.register(a[0], a[1]), [user, pass]);
  const tokA = await evalGame((w) => w.app.account.session);
  check(!!tokA, `A signed up as ${user}`);
  // GRAMS through the test checkout, then an AJ'S item (server-side, as the game would)
  const order = await api('/api/grams/checkout', tokA, { packageId: 'grams-7' });
  await api(`/pay/test/${order.data.orderId}`, null, null, 'outcome=paid');
  const buy = await api('/api/store/buy', tokA, { itemId: 'top-tiedye-tee', requestId: `m0route${Date.now()}` });
  check(buy.status === 200 && buy.data.account?.owned?.includes('top-tiedye-tee'), 'A bought the tie-dye tee with test GRAMS');
  await evalGame((w) => w.app.account.refresh());
  // edit the character and keep it (the Character screen's own keep path)
  await evalGame((w) => {
    const cs = w.app.characterScreen;
    cs.show(true);
    Object.assign(cs.draft, { top: 'tee', topColor: 'tiedye', hairColor: 'blonde', shoes: 'boots' });
    cs.keep();
  });
  await wait(1500);
  const savedA = await evalGame((w) => ({ code: w.app.account.account?.look, top: w.app.profile.look.top, topColor: w.app.profile.look.topColor, hairColor: w.app.profile.look.hairColor }));
  check(!!savedA.code, `A's kept character reached the account (${savedA.code})`);
  await evalGame((w) => w.app.account.logout());
  check(!(await evalGame((w) => w.app.account.signedIn)), 'A signed out');

  // ---- device B: a separate browser, nothing in storage
  const b = await newClient('B');
  const evalB = (fn, arg) => b.evaluate(`(${fn.toString()})(window.__whoopa, ${JSON.stringify(arg ?? null)})`);
  console.log('  B at', b.url());
  try {
    await b.waitForFunction('window.__whoopa && window.__whoopa.app', { timeout: 30000 });
  } catch (e) {
    await b.screenshot({ path: 'tools/out/m0route-B-fail.png' });
    console.log('  B errors:', errors.filter((x) => x.startsWith('[B')).slice(0, 5).join(' | '));
    throw e;
  }
  await evalB((w) => w.app.assetsReady);
  const guest = await evalB((w) => ({ top: w.app.profile.look.top, topColor: w.app.profile.look.topColor }));
  check(guest.topColor !== 'tiedye', `B starts as a guest with its own look (${guest.top} / ${guest.topColor})`);
  await evalB((w, a) => w.app.account.login(a[0], a[1]), [user, pass]);
  await wait(1200);
  const onB = await evalB((w) => ({ code: w.app.account.account?.look, owned: w.app.account.account?.owned, top: w.app.profile.look.top, topColor: w.app.profile.look.topColor, hairColor: w.app.profile.look.hairColor }));
  check(onB.code === savedA.code, 'B sees the same saved character code');
  check(onB.top === 'tee' && onB.topColor === 'tiedye' && onB.hairColor === savedA.hairColor, `B is wearing it (${onB.top} / ${onB.topColor} / ${onB.hairColor})`);
  check(onB.owned?.includes('top-tiedye-tee'), 'B owns the tie-dye tee');

  // ---- B in an online match: the server applies the look (owned exclusive kept)
  await evalB((w) => w.app.connect('create', 'tdm'));
  await b.waitForFunction('window.__whoopa.app.state === "lobby"', { timeout: 20000 });
  await wait(800);
  await evalB((w) => w.app.lobby.configure({ fillBots: true }));
  await wait(600);
  await evalB((w) => w.app.lobby.start());
  await b.waitForFunction('window.__whoopa.app.state === "playing"', { timeout: 40000 });
  await wait(2500);
  const inMatch = await evalB((w) => {
    const g = w.game, me = g.roster.get(g.session.myIdx);
    return { name: me?.name, look: me?.look };
  });
  check(inMatch.name === user, `in the match B plays as the account (${inMatch.name})`);
  check(inMatch.look === savedA.code, 'the server put the saved look on B in the match, tie-dye tee included');
  await b.screenshot({ path: 'tools/out/m0route-B-match.png' });

  console.log(`\n  ${report.filter((r) => r.startsWith('PASS')).length}/${report.length} checks passed`);
  console.log('  errors:', errors.length, errors.slice(0, 3).join(' | '));
}
