/**
 * Promo codes: a code typed next to an item at AJ'S (or a gun skin in the gun picker) gets that
 * item without spending GRAMS. Codes live only on the server: the browser sends what the player
 * typed and the server decides. Grants are all-or-nothing, logged (account, item, code, time)
 * and safe to retry, like purchases.
 */
export interface PromoCode {
  /** What the player types (matched case-insensitively). */
  code: string;
  /** Every item in the catalog, for free. */
  allItems: boolean;
}

/**
 * Codes for developers testing the store. Active only on a development economy (test payments
 * on, never under NODE_ENV=production): see setupEconomy.
 */
export const DEV_PROMO_CODES: readonly PromoCode[] = [{ code: 'FREEME', allItems: true }];

/** The typed text as a code ("freeme " -> "FREEME"), or null when it cannot be one. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{3,32}$/.test(c) ? c : null;
}
