import express, { type Application, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { CATALOG, GRAMS_PACKAGES, formatGrams, formatUsd, gramsPackage } from '../../../shared/src/config/economy.ts';
import { DevProvider, stripeSessionToPayment, verifyStripeSignature } from './payments.ts';
import { Economy, EconomyError } from './service.ts';
import type { AccountRec } from './store.ts';

export interface EconomyApiOptions {
  /** Where people reach this server (used for the checkout's return pages). */
  publicUrl: string;
  /** Other origins the game may be served from (the Vite dev server, a CDN...). */
  allowedOrigins: string[];
  stripeWebhookSecret: string | null;
}

type Authed = Request & { account?: AccountRec; token?: string };

/** Small fixed-window limiter (per key) for logins and sign-ups. */
function limiter(max: number, windowMs: number): (key: string) => boolean {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= max;
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The GRAMS / AJ's / TRAP endpoints. */
export function mountEconomyApi(app: Application, eco: Economy, opts: EconomyApiOptions): void {
  const allowed = new Set(opts.allowedOrigins.map((o) => o.replace(/\/$/, '')));
  // cross-origin only for the listed origins (same-origin needs nothing)
  const cors: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const wrap = (fn: (req: Authed, res: Response) => Promise<unknown> | unknown): RequestHandler => (req, res, next: NextFunction) => {
    Promise.resolve(fn(req as Authed, res)).catch(next);
  };
  const auth: RequestHandler = (req, res, next) => {
    const h = String(req.headers.authorization ?? '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const acc = eco.accountFor(token);
    if (!acc) {
      res.status(401).json({ error: 'signed_out', message: 'Sign in first.' });
      return;
    }
    (req as Authed).account = acc;
    (req as Authed).token = token;
    next();
  };
  const fresh = (req: Authed): AccountRec => eco.store.state.accounts[req.account!.id];
  const signIns = limiter(12, 10 * 60e3);
  const ip = (req: Request) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();

  // ---- the Stripe webhook needs the raw body for its signature: mount it before the JSON parser
  app.post('/api/payments/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    const secret = opts.stripeWebhookSecret;
    if (!secret || !(req.body instanceof Buffer)) return res.status(400).json({ error: 'not_configured' });
    if (!verifyStripeSignature(req.body, req.headers['stripe-signature'] as string | undefined, secret)) {
      return res.status(400).json({ error: 'bad_signature' });
    }
    const event = JSON.parse(req.body.toString('utf8')) as Parameters<Economy['stripeEvent']>[0];
    const result = await eco.stripeEvent(event, stripeSessionToPayment);
    res.json({ received: true, result });
  }));

  app.use(['/api/economy', '/api/account', '/api/grams', '/api/store', '/api/trap'], cors, noStore, express.json({ limit: '20kb' }));

  app.get('/api/economy', (_req, res) => {
    res.json({ provider: eco.provider?.id ?? null, packages: GRAMS_PACKAGES, catalog: CATALOG });
  });

  // ---- accounts
  app.post('/api/account/register', wrap(async (req, res) => {
    if (!signIns(`r:${ip(req)}`)) return res.status(429).json({ error: 'slow_down', message: 'Too many tries. Wait a few minutes.' });
    const out = await eco.register(req.body?.username, req.body?.password);
    res.status(201).json(out);
  }));
  app.post('/api/account/login', wrap(async (req, res) => {
    const name = String(req.body?.username ?? '').toLowerCase();
    if (!signIns(`l:${ip(req)}`) || !signIns(`u:${name}`)) return res.status(429).json({ error: 'slow_down', message: 'Too many tries. Wait a few minutes.' });
    res.json(await eco.login(req.body?.username, req.body?.password));
  }));
  app.post('/api/account/logout', auth, wrap(async (req, res) => {
    await eco.logout(req.token!);
    res.json({ ok: true });
  }));
  app.get('/api/account/me', auth, (req, res) => {
    res.json({ account: eco.summary(fresh(req as Authed)) });
  });
  app.get('/api/account/transactions', auth, (req, res) => {
    res.json({ transactions: eco.transactions(fresh(req as Authed)) });
  });

  // ---- GRAMS
  const returnBase = (req: Request): string => {
    const want = typeof req.body?.returnTo === 'string' ? req.body.returnTo.replace(/\/$/, '') : '';
    return want && (allowed.has(want) || want === opts.publicUrl) ? want : opts.publicUrl;
  };
  app.post('/api/grams/checkout', auth, wrap(async (req, res) => {
    const base = opts.publicUrl;
    const back = encodeURIComponent(returnBase(req));
    const out = await eco.createOrder(fresh(req), req.body?.packageId, {
      success: (id) => `${base}/pay/done?order=${encodeURIComponent(id)}&back=${back}`,
      cancel: (id) => `${base}/pay/done?order=${encodeURIComponent(id)}&canceled=1&back=${back}`,
    });
    res.status(201).json(out);
  }));
  app.get('/api/grams/orders/:id', auth, wrap(async (req, res) => {
    let order = eco.order(fresh(req), req.params.id);
    if (!order) return res.status(404).json({ error: 'no_order' });
    // still open: ask the provider (server to server) whether it has been paid
    if (order.status === 'pending') order = (await eco.settle(order.id)) ?? order;
    res.json({ order: { id: order.id, status: order.status, units: order.units, packageId: order.packageId }, account: eco.summary(fresh(req)) });
  }));

  // ---- AJ's
  app.post('/api/store/buy', auth, wrap(async (req, res) => {
    const out = await eco.buy(fresh(req), req.body?.itemId, req.body?.requestId);
    res.json({ ok: true, ...out, account: eco.summary(fresh(req)) });
  }));

  // ---- TRAP
  app.post('/api/trap/equip', auth, wrap(async (req, res) => {
    const look = await eco.equip(fresh(req), req.body?.look);
    res.json({ ok: true, look, account: eco.summary(fresh(req)) });
  }));

  // ---- checkout return page (Stripe sends people back here)
  app.get('/pay/done', (req, res) => {
    const canceled = req.query.canceled === '1';
    const back = typeof req.query.back === 'string' && (allowed.has(req.query.back) || req.query.back === opts.publicUrl) ? req.query.back : opts.publicUrl;
    res.type('html').send(page(canceled ? 'Checkout canceled' : 'Payment received', canceled
      ? '<p>No GRAMS were bought and you were not charged.</p>'
      : '<p>Your GRAMS show up in the game as soon as the payment is confirmed (usually a few seconds).</p>', back, true));
  });

  // ---- test payments (development only)
  if (eco.provider instanceof DevProvider) {
    const dev = eco.provider;
    app.get('/pay/test/:orderId', (req, res) => {
      const o = eco.store.state.orders[String(req.params.orderId)];
      const pkg = o ? gramsPackage(o.packageId) : null;
      if (!o || !pkg) return void res.status(404).type('html').send(page('No such checkout', '', opts.publicUrl));
      const id = escapeHtml(o.id);
      res.type('html').send(page('TEST CHECKOUT', `
        <p class="warn">TEST PAYMENTS: no real money moves. This page only exists on development servers.</p>
        <p class="big">${formatGrams(pkg.units)} GRAMS · ${formatUsd(pkg.priceCents)}</p>
        <form method="post"><button name="outcome" value="paid">PAY (TEST)</button> <button name="outcome" value="declined" class="ghost">DECLINE</button></form>
        <p class="small">Order ${id} · ${o.status}</p>`, opts.publicUrl));
    });
    app.post('/pay/test/:orderId', express.urlencoded({ extended: false, limit: '2kb' }), wrap(async (req, res) => {
      const o = eco.store.state.orders[String(req.params.orderId)];
      if (!o || !o.providerRef) return res.status(404).send('no such order');
      const outcome = req.body?.outcome === 'paid' ? 'paid' : 'declined';
      dev.complete(o.providerRef, outcome);
      // settle the same way as for real: by asking the provider what happened
      await eco.settle(o.id);
      res.redirect(303, `/pay/done?order=${encodeURIComponent(o.id)}${outcome === 'paid' ? '' : '&canceled=1'}`);
    }));
  }

  // errors: our own come back with their code, anything else is logged and hidden
  app.use(['/api', '/pay'], (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof EconomyError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad_json' });
      return;
    }
    console.error('[economy]', err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was charged twice.' });
  });
}

function page(title: string, body: string, back: string, autoClose = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · WHOOPA TOWNE</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141416;color:#f4f2ec;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:440px;padding:32px;border-radius:24px;background:#1d1d21;box-shadow:0 20px 60px #0008;text-align:center}
h1{margin:0 0 12px;font-size:26px;letter-spacing:-.02em}.big{font-size:28px;font-weight:700;color:#f6b73c}.warn{color:#ffb4b4;font-weight:600}.small{color:#999;font-size:12px}
button,a.btn{display:inline-block;margin:6px;padding:12px 22px;border:0;border-radius:999px;background:#f6b73c;color:#141416;font:700 15px system-ui;cursor:pointer;text-decoration:none}
.ghost{background:#2c2c32;color:#f4f2ec}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}
<p><a class="btn ghost" href="${escapeHtml(back)}">Back to WHOOPA TOWNE</a></p>
<p class="small">You can close this tab. GRAMS have no cash value.</p></main>
${autoClose ? '<script>setTimeout(function(){try{window.close()}catch(e){}},4000);</script>' : ''}</body></html>`;
}
