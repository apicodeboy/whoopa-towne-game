import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import {
  CATALOG, DEFAULT_APPEARANCE, GRAMS_PACKAGES, GUN_SKIN_ITEMS, decodeAppearance, encodeAppearance, formatGrams, gunSkinItemId, sanitizeAppearance,
  stripUnowned, type GramsPackage,
} from '../../shared/src/index.ts';
import { assert, test } from '../../shared/test/harness.ts';
import { mountEconomyApi } from '../src/economy/api.ts';
import { DevProvider, signStripePayload, verifyStripeSignature, type PaymentProvider, type VerifiedPayment } from '../src/economy/payments.ts';
import { Economy, EconomyError } from '../src/economy/service.ts';
import { FileEconomyStore } from '../src/economy/store.ts';
import type { OrderRec } from '../src/economy/store.ts';

const urls = { success: (id: string) => `http://x/pay/done?order=${id}`, cancel: (id: string) => `http://x/pay/done?order=${id}&canceled=1` };
const reqId = () => `req_${Math.random().toString(36).slice(2, 12)}`;

async function account(eco: Economy, name = `p${Math.random().toString(36).slice(2, 9)}`) {
  const { token } = await eco.register(name, 'correct horse');
  return { token, acc: () => eco.accountFor(token)! };
}

/** Pays for a package through the test checkout, the way a player would. */
async function topUp(eco: Economy, dev: DevProvider, token: string, packageId: string): Promise<OrderRec> {
  const { orderId } = await eco.createOrder(eco.accountFor(token)!, packageId, urls);
  const o = eco.store.state.orders[orderId];
  dev.complete(o.providerRef!, 'paid');
  return (await eco.settle(orderId))!;
}

/** A stand-in for Stripe's API (the webhook tests sign events like Stripe does). */
class FakeStripe implements PaymentProvider {
  readonly id = 'stripe' as const;
  n = 0;
  async createCheckout(order: OrderRec, _pkg: GramsPackage) {
    return { url: `https://checkout.stripe.test/${order.id}`, ref: `cs_test_${++this.n}` };
  }
  async lookup(): Promise<VerifiedPayment | null> {
    return null;
  }
}

test('GRAMS: the four packages at exactly the official prices', async () => {
  const want = [[35, 1000], [70, 1500], [140, 2500], [280, 5000]];
  assert(GRAMS_PACKAGES.length === 4, 'four packages');
  GRAMS_PACKAGES.forEach((p, i) => {
    assert(p.units === want[i][0] && p.priceCents === want[i][1] && p.currency === 'usd', `${p.id}: ${p.units} units for ${p.priceCents}c`);
  });
  assert(formatGrams(35) === '3.5' && formatGrams(280) === '28' && formatGrams(5) === '0.5', 'decimal GRAMS display');
  // the starter catalog
  const count = (c: string) => CATALOG.filter((i) => i.category === c).length;
  assert(count('outfits') === 5 && count('tops') === 5 && count('sneakers') === 5 && count('weapons') === 5 && count('accessories') === 5 && count('backpacks') === 3, 'starter catalog sizes');
  assert(CATALOG.every((i) => Number.isInteger(i.price) && i.price > 0), 'prices are positive whole units');
  assert(new Set(CATALOG.map((i) => i.id)).size === CATALOG.length, 'item ids are unique');
});

test('accounts: sign up, sign in, wrong passwords, sessions', async () => {
  const eco = new Economy(new FileEconomyStore(null), null);
  const { token } = await eco.register('AjFan1', 'correct horse');
  assert(eco.accountFor(token)?.username === 'AjFan1', 'session works');
  let err: unknown;
  try { await eco.register('ajfan1', 'another one'); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'taken', 'usernames are unique (any case)');
  for (const bad of ['a b', 'x', 'thirteenchars', 'bad!']) {
    err = null;
    try { await eco.register(bad, 'correct horse'); } catch (e) { err = e; }
    assert(err instanceof EconomyError && err.code === 'bad_username', `rejected username ${bad}`);
  }
  err = null;
  try { await eco.login('AjFan1', 'wrong password'); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'bad_login', 'wrong password refused');
  const again = await eco.login('ajfan1', 'correct horse');
  assert(eco.accountFor(again.token)?.username === 'AjFan1', 'sign in (case-insensitive name)');
  await eco.logout(again.token);
  assert(eco.accountFor(again.token) === null, 'signed out');
  assert(!JSON.stringify(eco.store.state).includes('correct horse'), 'no plain-text passwords stored');
});

test('buying GRAMS: a verified payment credits exactly once; declined or unverified never credit', async () => {
  const dev = new DevProvider('http://x');
  const eco = new Economy(new FileEconomyStore(null), dev);
  const { token, acc } = await account(eco);
  // nothing happens until the provider confirms
  const { orderId } = await eco.createOrder(acc(), 'grams-3.5', urls);
  await eco.settle(orderId);
  assert(acc().balance === 0 && eco.store.state.orders[orderId].status === 'pending', 'unpaid checkout credits nothing');
  // paid: 3.5 GRAMS, once, however many times it is settled
  dev.complete(eco.store.state.orders[orderId].providerRef!, 'paid');
  await Promise.all([eco.settle(orderId), eco.settle(orderId), eco.settle(orderId)]);
  assert(acc().balance === 35, `credited 3.5 GRAMS once (balance ${acc().balance})`);
  assert(eco.transactions(acc()).length === 1, 'one ledger entry');
  // declined
  const second = await eco.createOrder(acc(), 'grams-28', urls);
  dev.complete(eco.store.state.orders[second.orderId].providerRef!, 'declined');
  await eco.settle(second.orderId);
  assert(acc().balance === 35 && eco.store.state.orders[second.orderId].status === 'failed', 'declined payment never credits');
  // each package credits its own amount
  for (const p of GRAMS_PACKAGES) {
    const before = acc().balance;
    await topUp(eco, dev, token, p.id);
    assert(acc().balance - before === p.units, `${p.id} credits ${p.units} units`);
  }
});

test('Stripe webhooks: signed events only, each credited once, wrong amounts refused', async () => {
  const secret = 'whsec_test_secret';
  const eco = new Economy(new FileEconomyStore(null), new FakeStripe());
  const app = express();
  mountEconomyApi(app, eco, { publicUrl: 'http://x', allowedOrigins: [], stripeWebhookSecret: secret });
  const http: HttpServer = createServer(app);
  await new Promise<void>((r) => http.listen(0, r));
  const base = `http://localhost:${(http.address() as { port: number }).port}`;
  const { acc } = await account(eco);
  const send = (event: unknown, sig?: string) => {
    const body = JSON.stringify(event);
    return fetch(`${base}/api/payments/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig ?? signStripePayload(body, secret) }, body });
  };
  const sessionEvent = (id: string, order: OrderRec, extra: Record<string, unknown> = {}) => ({
    id, type: 'checkout.session.completed',
    data: { object: { id: order.providerRef, client_reference_id: order.id, payment_status: 'paid', status: 'complete', amount_total: order.priceCents, currency: 'usd', ...extra } },
  });
  try {
    const { orderId } = await eco.createOrder(acc(), 'grams-14', urls);
    const order = eco.store.state.orders[orderId];
    // forged / unsigned / stale events are rejected
    let r = await send(sessionEvent('evt_1', order), 't=1,v1=deadbeef');
    assert(r.status === 400 && acc().balance === 0, 'bad signature rejected');
    const body = JSON.stringify(sessionEvent('evt_1', order));
    r = await send(sessionEvent('evt_1', order), signStripePayload(body, secret, Math.floor(Date.now() / 1000) - 3600));
    assert(r.status === 400 && acc().balance === 0, 'replayed (old) signature rejected');
    assert(!verifyStripeSignature(body, signStripePayload(body, 'whsec_other'), secret), 'other secret rejected');
    // the real thing, delivered twice (Stripe retries): credited once
    r = await send(sessionEvent('evt_1', order));
    assert(r.ok && acc().balance === 140, `14 GRAMS credited (${acc().balance})`);
    r = await send(sessionEvent('evt_1', order));
    assert(r.ok && acc().balance === 140, 'duplicate delivery ignored');
    r = await send(sessionEvent('evt_2', order));
    assert(r.ok && acc().balance === 140, 'a second event for a settled order credits nothing');
    // a paid amount that does not match the package is not credited
    const two = await eco.createOrder(acc(), 'grams-28', urls);
    const o2 = eco.store.state.orders[two.orderId];
    await send(sessionEvent('evt_3', o2, { amount_total: 100 }));
    assert(acc().balance === 140 && eco.store.state.orders[two.orderId].status === 'pending', 'underpaid checkout not credited');
    // expired checkout: failed, never credited
    await send({ id: 'evt_4', type: 'checkout.session.expired', data: { object: { id: o2.providerRef, client_reference_id: o2.id, payment_status: 'unpaid', status: 'expired', amount_total: o2.priceCents, currency: 'usd' } } });
    assert(acc().balance === 140 && eco.store.state.orders[two.orderId].status === 'failed', 'expired checkout failed without credit');
  } finally {
    http.close();
  }
});

test("AJ's: insufficient GRAMS refused, exact debit, item in TRAP, no double buys", async () => {
  const dev = new DevProvider('http://x');
  const eco = new Economy(new FileEconomyStore(null), dev);
  const { token, acc } = await account(eco);
  const hoodie = CATALOG.find((i) => i.id === 'top-camo-hoodie')!; // 2 GRAMS
  let err: unknown;
  try { await eco.buy(acc(), hoodie.id, reqId()); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'insufficient_funds' && err.message === 'Not enough GRAMS. Want to re-up?', 'broke: refused with the re-up message');
  assert(Object.keys(acc().owned).length === 0, 'nothing granted');
  await topUp(eco, dev, token, 'grams-3.5');
  const id = reqId();
  const out = await eco.buy(acc(), hoodie.id, id);
  assert(out.balance === 35 - hoodie.price && acc().balance === 15, `exactly 2 GRAMS deducted (left ${formatGrams(acc().balance)})`);
  assert(eco.summary(acc()).owned.includes(hoodie.id), 'hoodie in TRAP');
  // the same request again (a retry) does not charge again
  const retry = await eco.buy(acc(), hoodie.id, id);
  assert(retry.txId === out.txId && acc().balance === 15, 'retried request returns the first result');
  err = null;
  try { await eco.buy(acc(), hoodie.id, reqId()); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'already_owned' && acc().balance === 15, 'cannot buy it twice');
  err = null;
  try { await eco.buy(acc(), 'not-a-thing', reqId()); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'unknown_item', 'unknown items refused');
  const debits = eco.transactions(acc()).filter((t) => t.kind === 'debit');
  assert(debits.length === 1 && debits[0].units === 20 && debits[0].reason === `item:${hoodie.id}`, 'spending is in the history');
});

test('simultaneous purchases can never overspend or double-buy', async () => {
  const dev = new DevProvider('http://x');
  const eco = new Economy(new FileEconomyStore(null), dev);
  const { token, acc } = await account(eco);
  await topUp(eco, dev, token, 'grams-3.5'); // 35 units
  const ones = CATALOG.filter((i) => i.price === 10).slice(0, 5); // five 1-GRAM items
  assert(ones.length === 5, 'five 1-GRAM items in the catalog');
  const results = await Promise.allSettled(ones.map((i) => eco.buy(acc(), i.id, reqId())));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert(ok === 3 && acc().balance === 5, `3 of 5 bought with 3.5 GRAMS, 0.5 left (bought ${ok}, left ${acc().balance})`);
  assert(acc().balance >= 0, 'never negative');
  // the same item, many times at once
  await topUp(eco, dev, token, 'grams-28');
  const legend = CATALOG.find((i) => i.id === 'skin-gold')!;
  const before = acc().balance;
  const same = await Promise.allSettled(Array.from({ length: 6 }, () => eco.buy(acc(), legend.id, reqId())));
  assert(same.filter((r) => r.status === 'fulfilled').length === 1 && before - acc().balance === legend.price, 'bought once, charged once');
});

test('TRAP: equip only what you own; balance, items and look survive a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'whoopa-eco-'));
  const path = join(dir, 'economy.json');
  try {
    const dev = new DevProvider('http://x');
    const eco = new Economy(new FileEconomyStore(path), dev);
    const { token, acc } = await account(eco, 'Saver1');
    await topUp(eco, dev, token, 'grams-7');
    await eco.buy(acc(), 'top-gold-puffer', reqId());
    const look = { ...DEFAULT_APPEARANCE, top: 'puffer', topColor: 'gold' };
    const saved = await eco.equip(acc(), encodeAppearance(look));
    assert(decodeAppearance(saved).topColor === 'gold', 'owned item equipped');
    let err: unknown;
    try { await eco.equip(acc(), encodeAppearance({ ...look, weaponSkin: 'chrome' })); } catch (e) { err = e; }
    assert(err instanceof EconomyError && err.code === 'not_owned', 'unowned item refused');
    // a fresh process reading the same file
    const again = new Economy(new FileEconomyStore(path), dev);
    const back = again.accountFor(token)!;
    assert(back && back.balance === 70 - 35 && back.owned['top-gold-puffer'] && decodeAppearance(back.look!).topColor === 'gold', 'everything persisted');
    // what other players are allowed to see of a look
    const owned = again.ownedKeys(back);
    const worn = stripUnowned(sanitizeAppearance({ ...look, weaponSkin: 'chrome', backpack: 'designer' }), owned);
    assert(worn.topColor === 'gold' && worn.weaponSkin === 'none' && worn.backpack === 'none', 'unowned exclusives are stripped, owned ones kept');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gun skins: bought per gun with GRAMS, worn on that gun only, never without owning them', async () => {
  const dev = new DevProvider('http://x');
  const eco = new Economy(new FileEconomyStore(null), dev);
  const { token, acc } = await account(eco);
  // every gun has every skin for sale, cosmetic only (an appearance field, nothing in the weapon stats)
  assert(GUN_SKIN_ITEMS.length === 15 * 6 && GUN_SKIN_ITEMS.every((i) => Object.keys(i.equip).every((f) => f.startsWith('gs_'))), `${GUN_SKIN_ITEMS.length} gun skins, each only a look`);
  const gold = gunSkinItemId('draco', 'gold');
  let err: unknown;
  try { await eco.buy(acc(), gold, reqId()); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'insufficient_funds', 'no GRAMS: refused');
  await topUp(eco, dev, token, 'grams-3.5'); // 35 units
  const out = await eco.buy(acc(), gold, reqId());
  assert(out.balance === 35 - 20 && acc().owned[gold], `2 GRAMS for gold on the Draco (left ${formatGrams(acc().balance)})`);
  // wearing it on the Draco is fine; the same skin on another gun is not (it was bought for the Draco)
  const saved = await eco.equip(acc(), encodeAppearance({ ...DEFAULT_APPEARANCE, gs_draco: 'gold' }));
  assert(decodeAppearance(saved).gs_draco === 'gold', 'gold Draco on');
  err = null;
  try { await eco.equip(acc(), encodeAppearance({ ...DEFAULT_APPEARANCE, gs_draco: 'gold', gs_vector: 'gold' })); } catch (e) { err = e; }
  assert(err instanceof EconomyError && err.code === 'not_owned', 'a skin bought for one gun cannot go on another');
  // and what other players see is stripped the same way
  const worn = stripUnowned(sanitizeAppearance({ ...DEFAULT_APPEARANCE, gs_draco: 'gold', gs_vector: 'ice' }), eco.ownedKeys(acc()));
  assert(worn.gs_draco === 'gold' && worn.gs_vector === 'none', 'unowned gun skins are stripped');
  // looks saved before gun skins existed still decode, with every gun on its factory finish
  const old = encodeAppearance(DEFAULT_APPEARANCE).slice(0, -15);
  const back = decodeAppearance(old);
  assert(back.gs_draco === 'none' && back.gs_p90 === 'none', 'old looks: factory finish');
});

test('the HTTP API: sign up, test checkout, buy, equip, history', async () => {
  const dev = new DevProvider('http://placeholder');
  const eco = new Economy(new FileEconomyStore(null), dev);
  const app = express();
  const http: HttpServer = createServer(app);
  await new Promise<void>((r) => http.listen(0, r));
  const base = `http://localhost:${(http.address() as { port: number }).port}`;
  (dev as unknown as { base: string }).base = base;
  mountEconomyApi(app, eco, { publicUrl: base, allowedOrigins: [], stripeWebhookSecret: null });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
  };
  try {
    let r = await call('GET', '/api/economy');
    assert(r.body.provider === 'dev' && r.body.packages.length === 4 && r.body.catalog.length === CATALOG.length, 'config');
    r = await call('GET', '/api/account/me');
    assert(r.status === 401, 'signed out without a token');
    r = await call('POST', '/api/account/register', { username: 'HttpUser', password: 'correct horse' });
    assert(r.status === 201 && typeof r.body.token === 'string' && r.body.account.balance === 0, 'signed up');
    const token = r.body.token as string;
    r = await call('POST', '/api/store/buy', { itemId: 'acc-gloves', requestId: reqId() }, token);
    assert(r.status === 402 && r.body.message === 'Not enough GRAMS. Want to re-up?', 'broke');
    // a client claiming it paid gets nothing: there is no such endpoint, and orders settle from the provider only
    r = await call('POST', '/api/grams/checkout', { packageId: 'grams-7' }, token);
    assert(r.status === 201 && r.body.url.includes('/pay/test/'), 'test checkout URL');
    const orderId = r.body.orderId as string;
    r = await call('GET', `/api/grams/orders/${orderId}`, undefined, token);
    assert(r.body.order.status === 'pending' && r.body.account.balance === 0, 'pending until paid');
    const pay = await fetch(`${base}/pay/test/${orderId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'outcome=paid', redirect: 'manual' });
    assert(pay.status === 303, 'test checkout paid');
    r = await call('GET', `/api/grams/orders/${orderId}`, undefined, token);
    assert(r.body.order.status === 'paid' && r.body.account.balance === 70, '7 GRAMS credited');
    r = await call('POST', '/api/store/buy', { itemId: 'acc-gloves', requestId: reqId() }, token);
    assert(r.status === 200 && r.body.account.balance === 60 && r.body.account.owned.includes('acc-gloves'), 'bought gloves');
    const look = encodeAppearance({ ...DEFAULT_APPEARANCE, wrist: 'gloves' });
    r = await call('POST', '/api/trap/equip', { look }, token);
    assert(r.status === 200 && decodeAppearance(r.body.look).wrist === 'gloves', 'equipped');
    r = await call('GET', '/api/account/transactions', undefined, token);
    assert(r.body.transactions.length === 2 && r.body.transactions[0].kind === 'debit', 'history: newest first');
    // other people's orders are invisible
    const other = await call('POST', '/api/account/register', { username: 'Nosy1', password: 'correct horse' });
    r = await call('GET', `/api/grams/orders/${orderId}`, undefined, other.body.token);
    assert(r.status === 404, "can't see someone else's order");
  } finally {
    http.close();
  }
});
