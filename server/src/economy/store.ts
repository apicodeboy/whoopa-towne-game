import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Economy storage: accounts, sessions, GRAMS balances, the transaction ledger, payment orders
 * and owned items.
 *
 * This implementation keeps the data in one JSON file, which is right for a single game-server
 * process (the way WHOOPA TOWNE runs today). Every change is a transaction: it is made on a
 * copy of the data, written to disk (a temp file renamed over the old one, so a crash never
 * leaves half a file), and only then becomes the live state. Transactions run one at a time,
 * so two purchases can never read the same balance. If the server is ever scaled out to more
 * than one process, implement `EconomyStore` on a real database (Postgres etc.) with the same
 * all-or-nothing semantics; see docs/ECONOMY.md.
 */

export interface OwnedRec {
  /** When it was bought / granted (ms). */
  at: number;
  /** How it was obtained: "purchase", "grant" ... */
  via: string;
  /** Temporary items stop counting after this (ms). Unset = permanent. */
  expiresAt?: number;
}

export interface AccountRec {
  id: string;
  username: string;
  /** scrypt hash and salt (hex). */
  pass: string;
  salt: string;
  createdAt: number;
  /** GRAMS balance in units (1 GRAM = 10). Never negative. */
  balance: number;
  owned: Record<string, OwnedRec>;
  /** The look the player last equipped (appearance wire code). */
  look: string | null;
}

export interface SessionRec {
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'canceled';

/** A GRAMS purchase with real money. */
export interface OrderRec {
  id: string;
  accountId: string;
  packageId: string;
  units: number;
  priceCents: number;
  currency: string;
  provider: string;
  /** The payment provider's id for it (Stripe checkout session id). */
  providerRef: string | null;
  status: OrderStatus;
  createdAt: number;
  settledAt?: number;
  /** Ledger entry that credited it. */
  txId?: string;
}

/** An item given for a promo code (no GRAMS moved). */
export interface RedemptionRec {
  id: string;
  accountId: string;
  itemId: string;
  code: string;
  at: number;
}

/** One movement of GRAMS (the transaction history). */
export interface TxRec {
  id: string;
  accountId: string;
  at: number;
  kind: 'credit' | 'debit';
  units: number;
  balanceAfter: number;
  /** "grams:<package>" for purchases with money, "item:<id>" for spending. */
  reason: string;
  ref?: string;
}

export interface EconomyState {
  version: 1;
  accounts: Record<string, AccountRec>;
  /** lower-cased username -> account id */
  byName: Record<string, string>;
  /** sha256(session token) -> session */
  sessions: Record<string, SessionRec>;
  orders: Record<string, OrderRec>;
  ledger: TxRec[];
  /** Payment-provider events already handled (id -> when), so a webhook delivered twice counts once. */
  events: Record<string, number>;
  /** Purchase requests already handled ("account:request" -> result), so a retried click buys once. */
  requests: Record<string, { at: number; result: unknown }>;
  /** Items given for promo codes (the log). */
  redemptions: RedemptionRec[];
}

export function emptyState(): EconomyState {
  return { version: 1, accounts: {}, byName: {}, sessions: {}, orders: {}, ledger: [], events: {}, requests: {}, redemptions: [] };
}

export interface EconomyStore {
  /** The committed state, read-only (never mutate it). */
  readonly state: Readonly<EconomyState>;
  /**
   * Runs `fn` on a private copy of the data and commits it only if `fn` returns without
   * throwing and the copy is saved. Transactions run strictly one after another.
   */
  tx<T>(fn: (draft: EconomyState) => T): Promise<T>;
}

/** JSON-file store (or memory only, with no path: tests). */
export class FileEconomyStore implements EconomyStore {
  private current: EconomyState;
  private queue: Promise<unknown> = Promise.resolve();
  private path: string | null;

  constructor(path: string | null) {
    this.path = path;
    this.current = emptyState();
    if (path && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<EconomyState>;
      this.current = { ...emptyState(), ...raw, version: 1 };
    } else if (path) {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  get state(): Readonly<EconomyState> {
    return this.current;
  }

  tx<T>(fn: (draft: EconomyState) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = structuredClone(this.current);
      const result = fn(draft);
      if (this.path) {
        const tmp = `${this.path}.tmp-${process.pid}`;
        await writeFile(tmp, JSON.stringify(draft), { encoding: 'utf8', flush: true });
        await rename(tmp, this.path);
      }
      this.current = draft;
      return result;
    };
    const p = this.queue.then(run, run);
    // keep the chain going whether this one failed or not
    this.queue = p.catch(() => undefined);
    return p;
  }
}
