import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GramsPackage } from '../../../shared/src/config/economy.ts';
import type { OrderRec } from './store.ts';

/**
 * Payment providers for buying GRAMS with real money. The server never credits GRAMS because a
 * client says a payment went through: it either receives a signed webhook from the provider or
 * asks the provider itself (with the secret key) whether the checkout was paid, and checks the
 * amount and currency against the package before crediting.
 */

/** What the provider says about a checkout (looked up server-side). */
export interface VerifiedPayment {
  /** The provider's checkout id. */
  ref: string;
  /** Our order id, as attached to the checkout when it was created. */
  orderId: string | null;
  paid: boolean;
  /** The checkout ended without payment (expired, declined, canceled). */
  failed: boolean;
  amountCents: number;
  currency: string;
}

export interface PaymentProvider {
  readonly id: 'stripe' | 'dev';
  /** A hosted checkout page for the order; returns its URL and the provider's id for it. */
  createCheckout(order: OrderRec, pkg: GramsPackage, urls: { success: string; cancel: string }): Promise<{ url: string; ref: string }>;
  /** Asks the provider (server to server) how the checkout went. */
  lookup(ref: string): Promise<VerifiedPayment | null>;
}

// ------------------------------------------------------------------ Stripe
/**
 * Stripe Checkout through Stripe's REST API (no SDK needed). Needs STRIPE_SECRET_KEY, and for
 * webhooks STRIPE_WEBHOOK_SECRET (the endpoint's signing secret).
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  private key: string;
  private api: string;

  constructor(secretKey: string, apiBase = 'https://api.stripe.com') {
    this.key = secretKey;
    this.api = apiBase;
  }

  private async call(method: 'GET' | 'POST', path: string, form?: Record<string, string>, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(`${this.api}${path}`, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new Error(`Stripe: ${err}`);
    }
    return body;
  }

  async createCheckout(order: OrderRec, pkg: GramsPackage, urls: { success: string; cancel: string }): Promise<{ url: string; ref: string }> {
    const grams = (pkg.units / 10).toString();
    const s = await this.call('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': pkg.currency,
      'line_items[0][price_data][unit_amount]': String(pkg.priceCents),
      'line_items[0][price_data][product_data][name]': `${grams} GRAMS`,
      'line_items[0][price_data][product_data][description]': 'WHOOPA TOWNE premium currency. No cash value.',
      client_reference_id: order.id,
      'metadata[orderId]': order.id,
      'metadata[packageId]': pkg.id,
      'metadata[accountId]': order.accountId,
      success_url: urls.success,
      cancel_url: urls.cancel,
    }, `whoopa-order-${order.id}`);
    if (typeof s.id !== 'string' || typeof s.url !== 'string') throw new Error('Stripe: no checkout URL');
    return { url: s.url, ref: s.id };
  }

  async lookup(ref: string): Promise<VerifiedPayment | null> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(ref)) return null;
    const s = await this.call('GET', `/v1/checkout/sessions/${encodeURIComponent(ref)}`);
    return stripeSessionToPayment(s);
  }
}

/** Reads a Stripe Checkout Session object. */
export function stripeSessionToPayment(s: Record<string, unknown>): VerifiedPayment {
  const meta = (s.metadata ?? {}) as Record<string, string>;
  const status = s.status as string | undefined;
  return {
    ref: String(s.id ?? ''),
    orderId: (typeof s.client_reference_id === 'string' ? s.client_reference_id : null) ?? meta.orderId ?? null,
    paid: s.payment_status === 'paid',
    failed: status === 'expired',
    amountCents: Number(s.amount_total ?? 0),
    currency: String(s.currency ?? '').toLowerCase(),
  };
}

/**
 * Checks a Stripe webhook signature (header `Stripe-Signature: t=<time>,v1=<hmac>[,v1=...]`):
 * HMAC-SHA256 of "<time>.<raw body>" with the endpoint secret, within `toleranceSec` of now.
 */
export function verifyStripeSignature(rawBody: Buffer | string, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Date.now() / 1000): boolean {
  if (!header || !secret) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k?.trim() === 't') t = (v ?? '').trim();
    else if (k?.trim() === 'v1' && v) sigs.push(v.trim());
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || sigs.length === 0) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Signs a payload the way Stripe does (tests, and the docs' local webhook example). */
export function signStripePayload(rawBody: string, secret: string, timeSec = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${timeSec}.${rawBody}`).digest('hex');
  return `t=${timeSec},v1=${sig}`;
}

// ------------------------------------------------------------------ test payments (development only)
/**
 * A stand-in "payment provider" for local development and automated tests: its checkout page
 * (served by this server) has PAY and DECLINE buttons and no real money moves. The server
 * refuses to start it in production. The game shows TEST PAYMENTS whenever it is active.
 */
export class DevProvider implements PaymentProvider {
  readonly id = 'dev' as const;
  /** checkout id -> outcome */
  private checkouts = new Map<string, { orderId: string; amountCents: number; currency: string; status: 'open' | 'paid' | 'declined' }>();
  private base: string;

  constructor(publicBase: string) {
    this.base = publicBase;
  }

  async createCheckout(order: OrderRec, pkg: GramsPackage): Promise<{ url: string; ref: string }> {
    const ref = `dev_${order.id}`;
    this.checkouts.set(ref, { orderId: order.id, amountCents: pkg.priceCents, currency: pkg.currency, status: 'open' });
    return { url: `${this.base}/pay/test/${encodeURIComponent(order.id)}`, ref };
  }

  async lookup(ref: string): Promise<VerifiedPayment | null> {
    const c = this.checkouts.get(ref);
    if (!c) return null;
    return { ref, orderId: c.orderId, paid: c.status === 'paid', failed: c.status === 'declined', amountCents: c.amountCents, currency: c.currency };
  }

  /** The test checkout page's buttons. */
  complete(ref: string, outcome: 'paid' | 'declined'): boolean {
    const c = this.checkouts.get(ref);
    if (!c || c.status !== 'open') return false;
    c.status = outcome;
    return true;
  }
}
