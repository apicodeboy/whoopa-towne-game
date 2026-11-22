import { resolve } from 'node:path';
import type { Application } from 'express';
import { mountEconomyApi } from './api.ts';
import { DevProvider, StripeProvider, type PaymentProvider } from './payments.ts';
import { DEV_PROMO_CODES, type PromoCode } from './promo.ts';
import { Economy } from './service.ts';
import { FileEconomyStore } from './store.ts';

let current: Economy | null = null;

/** The running economy (match rooms read accounts and ownership from it). */
export function economy(): Economy | null {
  return current;
}

export interface EconomySetup {
  /** JSON file for accounts, balances and purchases; ":memory:" keeps it in memory (tests). */
  dbPath: string;
  publicUrl: string;
  allowedOrigins: string[];
}

/**
 * Builds the economy from the environment and mounts its HTTP API.
 *
 *  ECONOMY_DB              data file (default server/data/economy.json)
 *  PUBLIC_URL              how players reach the server (checkout return pages)
 *  ALLOWED_ORIGINS         extra origins the game is served from, comma separated
 *  STRIPE_SECRET_KEY       turns on buying GRAMS with Stripe Checkout
 *  STRIPE_WEBHOOK_SECRET   the Stripe webhook endpoint's signing secret
 *  ECONOMY_TEST_PAYMENTS=1 test checkout instead of Stripe, and the developers' promo code
 *                          (FREEME); both refused when NODE_ENV=production
 */
export function setupEconomy(app: Application, setup: EconomySetup): Economy {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  let provider: PaymentProvider | null = null;
  let promoCodes: readonly PromoCode[] = [];
  if (env.STRIPE_SECRET_KEY) {
    provider = new StripeProvider(env.STRIPE_SECRET_KEY);
    if (!env.STRIPE_WEBHOOK_SECRET) console.warn('[economy] STRIPE_WEBHOOK_SECRET is not set: payments are confirmed by polling Stripe only');
  } else if (env.ECONOMY_TEST_PAYMENTS === '1') {
    if (production) {
      console.error('[economy] ECONOMY_TEST_PAYMENTS is ignored in production: buying GRAMS is off until Stripe is configured');
    } else {
      provider = new DevProvider(setup.publicUrl);
      promoCodes = DEV_PROMO_CODES;
      console.warn('[economy] TEST PAYMENTS are on: GRAMS can be "bought" without real money, and the promo code FREEME gets any item free (development only)');
    }
  }
  const store = new FileEconomyStore(setup.dbPath === ':memory:' ? null : resolve(setup.dbPath));
  const eco = new Economy(store, provider, { promoCodes });
  mountEconomyApi(app, eco, {
    publicUrl: setup.publicUrl.replace(/\/$/, ''),
    allowedOrigins: setup.allowedOrigins,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
  });
  current = eco;
  return eco;
}
