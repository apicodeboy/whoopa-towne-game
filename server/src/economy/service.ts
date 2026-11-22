import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_APPEARANCE, decodeAppearance, encodeAppearance, isPremiumOption, stripUnowned, EXTRA_FIELD_KEYS, LOOK_FIELD_KEYS } from '../../../shared/src/config/appearance.ts';
import { CATALOG, catalogItem, gramsPackage, unlocksOf } from '../../../shared/src/config/economy.ts';
import type { PaymentProvider, VerifiedPayment } from './payments.ts';
import { normalizeCode, type PromoCode } from './promo.ts';
import type { AccountRec, EconomyState, EconomyStore, OrderRec, TxRec } from './store.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** Account usernames follow the player-name rules: letters and numbers, 3 to 12. */
export const USERNAME_RE = /^[A-Za-z0-9]{3,12}$/;
export const PASSWORD_MIN = 8;
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** An error a client may see (code + human text). */
export class EconomyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What the client gets to know about its own account. */
export interface AccountSummary {
  username: string;
  balance: number;
  owned: string[];
  look: string | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * GRAMS, AJ's and TRAP on the server: accounts and sessions, buying GRAMS (orders settled only
 * from verified payments), buying items (all-or-nothing, idempotent), equipping (ownership
 * checked) and the transaction history.
 */
export class Economy {
  readonly store: EconomyStore;
  readonly provider: PaymentProvider | null;
  /** Promo codes that work on this server (none unless set up: see setupEconomy). */
  private readonly promos: readonly PromoCode[];

  constructor(store: EconomyStore, provider: PaymentProvider | null, opts: { promoCodes?: readonly PromoCode[] } = {}) {
    this.store = store;
    this.provider = provider;
    this.promos = opts.promoCodes ?? [];
  }

  /** Whether any promo code works here (the store only shows the code box when one does). */
  get promosEnabled(): boolean {
    return this.promos.length > 0;
  }

  // ------------------------------------------------------------------ accounts
  async register(username: unknown, password: unknown): Promise<{ token: string; account: AccountSummary }> {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new EconomyError('bad_username', 'Usernames are 3 to 12 letters and numbers.');
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > 200) {
      throw new EconomyError('bad_password', `Passwords need at least ${PASSWORD_MIN} characters.`);
    }
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64, SCRYPT);
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const now = Date.now();
    await this.store.tx((s) => {
      const key = username.toLowerCase();
      if (s.byName[key]) throw new EconomyError('taken', 'That username is taken.', 409);
      s.accounts[id] = { id, username, pass: hash.toString('hex'), salt: salt.toString('hex'), createdAt: now, balance: 0, owned: {}, look: null };
      s.byName[key] = id;
      s.sessions[sha256(token)] = { accountId: id, createdAt: now, expiresAt: now + SESSION_DAYS * 86400e3 };
    });
    return { token, account: this.summary(this.store.state.accounts[id]) };
  }

  async login(username: unknown, password: unknown): Promise<{ token: string; account: AccountSummary }> {
    const fail = new EconomyError('bad_login', 'Wrong username or password.', 401);
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) throw fail;
    const id = this.store.state.byName[username.toLowerCase()];
    const acc = id ? this.store.state.accounts[id] : null;
    // hash anyway when there is no such account, so timing does not tell who exists
    const salt = acc ? Buffer.from(acc.salt, 'hex') : randomBytes(16);
    const got = await scrypt(password, salt, 64, SCRYPT);
    if (!acc || !timingSafeEqual(got, Buffer.from(acc.pass, 'hex'))) throw fail;
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.store.tx((s) => {
      s.sessions[sha256(token)] = { accountId: acc.id, createdAt: now, expiresAt: now + SESSION_DAYS * 86400e3 };
      // tidy expired sessions while we are here
      for (const [k, v] of Object.entries(s.sessions)) if (v.expiresAt < now) delete s.sessions[k];
    });
    return { token, account: this.summary(this.store.state.accounts[acc.id]) };
  }

  async logout(token: string): Promise<void> {
    const key = sha256(token);
    if (!this.store.state.sessions[key]) return;
    await this.store.tx((s) => {
      delete s.sessions[key];
    });
  }

  /** The account a session token belongs to (null when unknown or expired). Synchronous. */
  accountFor(token: unknown): AccountRec | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const sess = this.store.state.sessions[sha256(token)];
    if (!sess || sess.expiresAt < Date.now()) return null;
    return this.store.state.accounts[sess.accountId] ?? null;
  }

  summary(acc: AccountRec): AccountSummary {
    const now = Date.now();
    return {
      username: acc.username,
      balance: acc.balance,
      owned: Object.entries(acc.owned).filter(([, o]) => !o.expiresAt || o.expiresAt > now).map(([id]) => id),
      look: acc.look,
    };
  }

  /** "field:option" keys of the AJ's exclusives this account may wear. */
  ownedKeys(acc: AccountRec | null): Set<string> {
    if (!acc) return new Set();
    return unlocksOf(this.summary(acc).owned, isPremiumOption);
  }

  transactions(acc: AccountRec, limit = 100): TxRec[] {
    return this.store.state.ledger.filter((t) => t.accountId === acc.id).slice(-limit).reverse();
  }

  // ------------------------------------------------------------------ GRAMS with real money
  /** Starts a checkout for a GRAMS package. Nothing is credited here. */
  async createOrder(acc: AccountRec, packageId: unknown, urls: { success: (orderId: string) => string; cancel: (orderId: string) => string }): Promise<{ orderId: string; url: string }> {
    if (!this.provider) throw new EconomyError('payments_off', 'Buying GRAMS is not set up on this server yet.', 503);
    const pkg = gramsPackage(packageId);
    if (!pkg) throw new EconomyError('bad_package', 'Unknown GRAMS package.');
    const order: OrderRec = {
      id: randomUUID(), accountId: acc.id, packageId: pkg.id, units: pkg.units, priceCents: pkg.priceCents, currency: pkg.currency,
      provider: this.provider.id, providerRef: null, status: 'pending', createdAt: Date.now(),
    };
    const checkout = await this.provider.createCheckout(order, pkg, { success: urls.success(order.id), cancel: urls.cancel(order.id) });
    order.providerRef = checkout.ref;
    await this.store.tx((s) => {
      s.orders[order.id] = order;
    });
    return { orderId: order.id, url: checkout.url };
  }

  order(acc: AccountRec, orderId: unknown): OrderRec | null {
    const o = typeof orderId === 'string' ? this.store.state.orders[orderId] : undefined;
    return o && o.accountId === acc.id ? o : null;
  }

  /**
   * Settles an order from what the payment provider itself reports (looked up server-side).
   * Credits exactly once, and only when the provider says it was paid in full, in the
   * package's currency.
   */
  async settle(orderId: string, verified?: VerifiedPayment | null): Promise<OrderRec | null> {
    const order = this.store.state.orders[orderId];
    if (!order || order.status !== 'pending' || !this.provider || !order.providerRef) return order ?? null;
    const pay = verified ?? (await this.provider.lookup(order.providerRef));
    if (!pay || pay.ref !== order.providerRef || (pay.orderId && pay.orderId !== order.id)) return order;
    if (pay.paid) {
      const pkg = gramsPackage(order.packageId);
      if (!pkg || pay.amountCents !== pkg.priceCents || pay.currency !== pkg.currency) {
        console.error(`[economy] order ${order.id}: paid amount ${pay.amountCents} ${pay.currency} does not match ${order.packageId}; not credited`);
        return order;
      }
      await this.store.tx((s) => {
        const o = s.orders[orderId];
        if (!o || o.status !== 'pending') return; // settled meanwhile (webhook and poll raced)
        const acc = s.accounts[o.accountId];
        if (!acc) return;
        acc.balance += o.units;
        const tx = ledger(s, acc, 'credit', o.units, `grams:${o.packageId}`, o.id);
        o.status = 'paid';
        o.settledAt = Date.now();
        o.txId = tx.id;
      });
    } else if (pay.failed) {
      await this.store.tx((s) => {
        const o = s.orders[orderId];
        if (o && o.status === 'pending') {
          o.status = 'failed';
          o.settledAt = Date.now();
        }
      });
    }
    return this.store.state.orders[orderId];
  }

  /**
   * A verified Stripe event (signature already checked). Each event id is handled once; the
   * checkout is re-read from the event itself and settled with the same checks as a poll.
   */
  async stripeEvent(event: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } }, toPayment: (o: Record<string, unknown>) => VerifiedPayment): Promise<'ok' | 'duplicate' | 'ignored'> {
    const id = typeof event.id === 'string' ? event.id : '';
    if (!id) return 'ignored';
    if (this.store.state.events[id]) return 'duplicate';
    const type = String(event.type ?? '');
    const obj = event.data?.object;
    if (obj && /^checkout\.session\.(completed|async_payment_succeeded|async_payment_failed|expired)$/.test(type)) {
      const pay = toPayment(obj);
      const failed = type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired';
      const orderId = pay.orderId ?? Object.values(this.store.state.orders).find((o) => o.providerRef === pay.ref)?.id;
      if (orderId) await this.settle(orderId, { ...pay, failed: pay.failed || failed, paid: pay.paid && !failed });
    }
    await this.store.tx((s) => {
      s.events[id] = Date.now();
    });
    return 'ok';
  }

  // ------------------------------------------------------------------ AJ's
  /**
   * Buys an item: the balance check, the debit, the ledger entry and the ownership all happen
   * in one transaction (all or nothing). `requestId` makes retries safe: the same request
   * returns the first answer instead of buying twice.
   */
  async buy(acc: AccountRec, itemId: unknown, requestId: unknown): Promise<{ balance: number; owned: string[]; txId: string }> {
    const item = catalogItem(itemId);
    if (!item) throw new EconomyError('unknown_item', 'That item is not sold here.', 404);
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new EconomyError('bad_request', 'Missing purchase request id.');
    const reqKey = `${acc.id}:${requestId}`;
    return this.store.tx((s) => {
      // a retried request (double click, flaky network) gets the first answer, not a second purchase
      const prev = s.requests[reqKey];
      if (prev) return prev.result as { balance: number; owned: string[]; txId: string };
      const a = s.accounts[acc.id];
      const owned = a.owned[item.id];
      if (owned && (!owned.expiresAt || owned.expiresAt > Date.now())) throw new EconomyError('already_owned', 'You already own that.', 409);
      if (a.balance < item.price) throw new EconomyError('insufficient_funds', 'Not enough GRAMS. Want to re-up?', 402);
      a.balance -= item.price;
      const tx = ledger(s, a, 'debit', item.price, `item:${item.id}`, requestId);
      a.owned[item.id] = { at: Date.now(), via: 'purchase', ...(item.temporaryDays ? { expiresAt: Date.now() + item.temporaryDays * 86400e3 } : {}) };
      const result = { balance: a.balance, owned: Object.keys(a.owned), txId: tx.id };
      s.requests[reqKey] = { at: Date.now(), result };
      // keep the retry table from growing without end
      const keys = Object.keys(s.requests);
      if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 4000)) delete s.requests[k];
      return result;
    });
  }

  /**
   * Gets an item with a promo code instead of GRAMS: the code check, the ownership and the log
   * entry happen in one transaction; a retried request gets the first answer.
   */
  async redeem(acc: AccountRec, itemId: unknown, rawCode: unknown, requestId: unknown): Promise<{ owned: string[]; redemptionId: string }> {
    const item = catalogItem(itemId);
    if (!item) throw new EconomyError('unknown_item', 'That item is not sold here.', 404);
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new EconomyError('bad_request', 'Missing request id.');
    const code = normalizeCode(rawCode);
    const promo = code ? this.promos.find((p) => p.code === code) : undefined;
    if (!promo || !promo.allItems) throw new EconomyError('bad_code', "That code doesn't work.", 400);
    const reqKey = `${acc.id}:promo:${requestId}`;
    return this.store.tx((s) => {
      const prev = s.requests[reqKey];
      if (prev) return prev.result as { owned: string[]; redemptionId: string };
      const a = s.accounts[acc.id];
      const owned = a.owned[item.id];
      if (owned && (!owned.expiresAt || owned.expiresAt > Date.now())) throw new EconomyError('already_owned', 'You already own that.', 409);
      const now = Date.now();
      a.owned[item.id] = { at: now, via: `promo:${promo.code}`, ...(item.temporaryDays ? { expiresAt: now + item.temporaryDays * 86400e3 } : {}) };
      const redemptionId = randomUUID();
      s.redemptions.push({ id: redemptionId, accountId: a.id, itemId: item.id, code: promo.code, at: now });
      const result = { owned: Object.keys(a.owned), redemptionId };
      s.requests[reqKey] = { at: now, result };
      return result;
    });
  }

  // ------------------------------------------------------------------ TRAP
  /** Saves the look the player wears, refusing any AJ's exclusive they do not own. */
  async equip(acc: AccountRec, code: unknown): Promise<string> {
    if (typeof code !== 'string') throw new EconomyError('bad_look', 'Bad look.');
    const look = decodeAppearance(code, DEFAULT_APPEARANCE);
    const owned = this.ownedKeys(this.store.state.accounts[acc.id]);
    const missing: string[] = [];
    for (const f of [...LOOK_FIELD_KEYS, ...EXTRA_FIELD_KEYS] as string[]) {
      const v = (look as unknown as Record<string, string>)[f];
      if (isPremiumOption(f, v) && !owned.has(`${f}:${v}`)) missing.push(`${f}:${v}`);
    }
    if (missing.length) throw new EconomyError('not_owned', 'You do not own everything in that look.', 403);
    const clean = encodeAppearance(stripUnowned(look, owned));
    await this.store.tx((s) => {
      s.accounts[acc.id].look = clean;
    });
    return clean;
  }

  /** Every item in the catalog (prices come from here, never from a request). */
  catalog() {
    return CATALOG;
  }
}

function ledger(s: EconomyState, acc: AccountRec, kind: 'credit' | 'debit', units: number, reason: string, ref?: string): TxRec {
  if (!Number.isInteger(units) || units <= 0) throw new EconomyError('bad_amount', 'Bad amount.', 500);
  if (acc.balance < 0) throw new EconomyError('negative', 'Balance cannot go negative.', 500);
  const tx: TxRec = { id: randomUUID(), accountId: acc.id, at: Date.now(), kind, units, balanceAfter: acc.balance, reason, ref };
  s.ledger.push(tx);
  return tx;
}
