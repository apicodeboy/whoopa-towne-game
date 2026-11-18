import { CATALOG, GRAMS_PACKAGES, type GramsPackage, type StoreItem } from '@shared/config/economy';
import { defaultServerUrl } from './online';

const TOKEN_KEY = 'whoopa.session';

export interface AccountInfo {
  username: string;
  /** GRAMS balance in units (1 GRAM = 10). */
  balance: number;
  owned: string[];
  /** The look last equipped on this account (wire code). */
  look: string | null;
}

export interface Transaction {
  id: string;
  at: number;
  kind: 'credit' | 'debit';
  units: number;
  balanceAfter: number;
  reason: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * The player's account on the game server: sign in, GRAMS balance, owned items (TRAP) and the
 * equipped look. Everything that matters is decided by the server; this only asks and shows.
 */
export class AccountService {
  readonly base: string;
  account: AccountInfo | null = null;
  /** 'stripe' | 'dev' (test payments) | null (buying GRAMS not set up on this server). */
  provider: string | null = null;
  packages: readonly GramsPackage[] = GRAMS_PACKAGES;
  catalog: readonly StoreItem[] = CATALOG;
  private token: string | null = null;
  private listeners = new Set<() => void>();

  constructor(base = defaultServerUrl()) {
    this.base = base.replace(/\/$/, '');
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }

  get signedIn(): boolean {
    return !!this.account;
  }

  get session(): string | null {
    return this.account ? this.token : null;
  }

  owns(itemId: string): boolean {
    return !!this.account?.owned.includes(itemId);
  }

  /** Called whenever the account changes (sign in / out, balance, items). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('offline', 'Could not reach the game server.', 0);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401 && path !== '/api/account/login') this.dropSession();
      throw new ApiError(String(data.error ?? 'error'), String(data.message ?? 'Something went wrong.'), res.status);
    }
    return data as T;
  }

  private setToken(t: string | null): void {
    this.token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: the session lasts until the tab closes */
    }
  }

  private dropSession(): void {
    if (!this.account && !this.token) return;
    this.setToken(null);
    this.account = null;
    this.emit();
  }

  /** Loads the store config and, with a saved session, the account. */
  async init(): Promise<void> {
    try {
      const cfg = await this.call<{ provider: string | null; packages: GramsPackage[]; catalog: StoreItem[] }>('GET', '/api/economy');
      this.provider = cfg.provider;
      this.packages = cfg.packages;
      this.catalog = cfg.catalog;
    } catch {
      this.provider = null;
    }
    if (this.token) await this.refresh().catch(() => undefined);
    this.emit();
  }

  async refresh(): Promise<void> {
    if (!this.token) return; // signed out: nothing to ask the server
    const r = await this.call<{ account: AccountInfo }>('GET', '/api/account/me');
    this.account = r.account;
    this.emit();
  }

  async register(username: string, password: string): Promise<void> {
    const r = await this.call<{ token: string; account: AccountInfo }>('POST', '/api/account/register', { username, password });
    this.setToken(r.token);
    this.account = r.account;
    this.emit();
  }

  async login(username: string, password: string): Promise<void> {
    const r = await this.call<{ token: string; account: AccountInfo }>('POST', '/api/account/login', { username, password });
    this.setToken(r.token);
    this.account = r.account;
    this.emit();
  }

  async logout(): Promise<void> {
    await this.call('POST', '/api/account/logout').catch(() => undefined);
    this.dropSession();
  }

  /**
   * Starts a GRAMS checkout in a new tab and waits (polling the server) until the payment is
   * confirmed server-side. Resolves with the final order status.
   */
  async buyGrams(packageId: string, onOpened?: () => void, signal?: AbortSignal): Promise<'paid' | 'failed' | 'canceled' | 'pending'> {
    const tab = window.open('', '_blank');
    let r: { orderId: string; url: string };
    try {
      r = await this.call<{ orderId: string; url: string }>('POST', '/api/grams/checkout', { packageId, returnTo: location.origin });
    } catch (err) {
      tab?.close();
      throw err;
    }
    if (tab) tab.location.href = r.url;
    else window.location.href = r.url; // popup blocked: go there in this tab
    onOpened?.();
    const t0 = Date.now();
    while (!signal?.aborted && Date.now() - t0 < 30 * 60e3) {
      await new Promise((res) => setTimeout(res, 2500));
      const s = await this.call<{ order: { status: string }; account: AccountInfo }>('GET', `/api/grams/orders/${encodeURIComponent(r.orderId)}`).catch(() => null);
      if (!s) continue;
      if (s.order.status !== 'pending') {
        this.account = s.account;
        this.emit();
        return s.order.status as 'paid' | 'failed' | 'canceled';
      }
    }
    return 'pending';
  }

  /** Buys an item at AJ's (one request id per click, so a retry never charges twice). */
  async buy(itemId: string): Promise<void> {
    const requestId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const r = await this.call<{ account: AccountInfo }>('POST', '/api/store/buy', { itemId, requestId });
    this.account = r.account;
    this.emit();
  }

  /** Saves the equipped look on the account (the server checks every exclusive is owned). */
  async equip(lookCode: string): Promise<string> {
    const r = await this.call<{ look: string; account: AccountInfo }>('POST', '/api/trap/equip', { look: lookCode });
    this.account = r.account;
    this.emit();
    return r.look;
  }

  async transactions(): Promise<Transaction[]> {
    return (await this.call<{ transactions: Transaction[] }>('GET', '/api/account/transactions')).transactions;
  }
}
