/**
 * WHOOPA TOWNE ECONOMY — GRAMS (the premium currency), AJ's (the store) and TRAP (your
 * inventory). Shared by the server (which owns every balance and every purchase) and the
 * client (which only displays them).
 *
 * Money is integer units: 1 GRAM = 10 units, so 3.5 GRAMS is 35 units and no balance ever
 * goes through floating point.
 */

/** Units per GRAM. */
export const GRAM_UNITS = 10;

/** "3.5", "14", "0.5" — a unit amount shown as GRAMS. */
export function formatGrams(units: number): string {
  const whole = Math.trunc(units / GRAM_UNITS);
  const tenth = Math.abs(units % GRAM_UNITS);
  return tenth ? `${whole}.${tenth}` : String(whole);
}

/** GRAMS for sale, and what they cost (US cents). Prices are fixed here and checked by the server. */
export interface GramsPackage {
  id: string;
  units: number;
  priceCents: number;
  currency: 'usd';
  /** Shown on the package card. */
  badge?: string;
}

export const GRAMS_PACKAGES: readonly GramsPackage[] = [
  { id: 'grams-3.5', units: 35, priceCents: 1000, currency: 'usd' },
  { id: 'grams-7', units: 70, priceCents: 1500, currency: 'usd' },
  { id: 'grams-14', units: 140, priceCents: 2500, currency: 'usd', badge: 'Popular' },
  { id: 'grams-28', units: 280, priceCents: 5000, currency: 'usd', badge: 'Best value' },
];

export function gramsPackage(id: unknown): GramsPackage | null {
  return GRAMS_PACKAGES.find((p) => p.id === id) ?? null;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ------------------------------------------------------------------ the catalog

export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly ItemRarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLORS: Record<ItemRarity, string> = { common: '#b8bec8', rare: '#4da3ff', epic: '#b06bff', legendary: '#f6b73c' };

/** AJ's aisles. */
export type StoreCategory = 'outfits' | 'tops' | 'sneakers' | 'weapons' | 'accessories' | 'backpacks';
export const STORE_CATEGORIES: ReadonlyArray<{ id: StoreCategory; name: string }> = [
  { id: 'outfits', name: 'Full Fits' },
  { id: 'tops', name: 'Hoodies & Tops' },
  { id: 'sneakers', name: 'Sneakers' },
  { id: 'weapons', name: 'Weapon Skins' },
  { id: 'accessories', name: 'Accessories' },
  { id: 'backpacks', name: 'Backpacks' },
];

/** TRAP shelves (an item shows on its own shelf, and under Special Items when it is limited). */
export type TrapCategory = 'characters' | 'clothing' | 'sneakers' | 'accessories' | 'weapons' | 'backpacks' | 'special';
export const TRAP_CATEGORIES: ReadonlyArray<{ id: TrapCategory; name: string }> = [
  { id: 'characters', name: 'Characters' },
  { id: 'clothing', name: 'Clothing' },
  { id: 'sneakers', name: 'Sneakers' },
  { id: 'accessories', name: 'Accessories' },
  { id: 'weapons', name: 'Weapon Skins' },
  { id: 'backpacks', name: 'Backpacks' },
  { id: 'special', name: 'Special Items' },
];
const TRAP_OF: Record<StoreCategory, TrapCategory> = {
  outfits: 'characters', tops: 'clothing', sneakers: 'sneakers', weapons: 'weapons', accessories: 'accessories', backpacks: 'backpacks',
};

/** Appearance fields a store item can set (see appearance.ts). */
export type CosmeticField =
  | 'top' | 'topColor' | 'bottom' | 'bottomColor' | 'shoes' | 'shoeColor' | 'hat' | 'glasses'
  | 'necklace' | 'wrist' | 'earrings' | 'weaponSkin' | 'backpack';

export interface StoreItem {
  id: string;
  name: string;
  category: StoreCategory;
  rarity: ItemRarity;
  /** Price in units (1 GRAM = 10). */
  price: number;
  /** What equipping it puts on (appearance field -> option id). */
  equip: Partial<Record<CosmeticField, string>>;
  blurb: string;
  /** Collection it belongs to (seasonal / limited drops). */
  collection?: string;
  /** Limited edition: also listed under Special Items in TRAP. */
  limited?: boolean;
  /** Bought for a set time only (none in the starter catalog; ownership is permanent otherwise). */
  temporaryDays?: number;
  /** The art is a placeholder (procedural) until final assets land. */
  placeholder: boolean;
}

const G = (grams: number) => Math.round(grams * GRAM_UNITS);

/**
 * The starter catalog. Prices are configurable here (in GRAMS); the server only ever reads
 * prices from this list, never from a request.
 */
export const CATALOG: readonly StoreItem[] = [
  // ---- full fits (characters) ----
  {
    id: 'fit-gold-rush', name: 'Gold Rush', category: 'outfits', rarity: 'legendary', price: G(6), placeholder: true, limited: true, collection: 'AJ\'s Originals',
    blurb: 'Gold puffer, black stacks, 24K kicks and a Cuban link. Loud on purpose.',
    equip: { top: 'puffer', topColor: 'gold', bottom: 'baggyjeans', bottomColor: 'black', shoes: 'chunky', shoeColor: 'gold24k', hat: 'beanie', necklace: 'cuban' },
  },
  {
    id: 'fit-camo-season', name: 'Camo Season', category: 'outfits', rarity: 'epic', price: G(4), placeholder: true,
    blurb: 'Woodland camo top to bottom, boots laced, mask up.',
    equip: { top: 'hoodie', topColor: 'camo', bottom: 'cargo', bottomColor: 'camo', shoes: 'boots', shoeColor: 'black', hat: 'skimask' },
  },
  {
    id: 'fit-ice-cold', name: 'Ice Cold', category: 'outfits', rarity: 'epic', price: G(4), placeholder: true,
    blurb: 'Pearl-white puffer, light stacks, icy kicks and an iced pendant.',
    equip: { top: 'puffer', topColor: 'ice', bottom: 'baggyjeans', bottomColor: 'white', shoes: 'chunky', shoeColor: 'icy', necklace: 'wtpendant' },
  },
  {
    id: 'fit-night-shift', name: 'Night Shift', category: 'outfits', rarity: 'rare', price: G(2.5), placeholder: true,
    blurb: 'Midnight sheen hoodie, hood up, all black everything.',
    equip: { top: 'hoodie', topColor: 'midnight', bottom: 'cargo', bottomColor: 'black', shoes: 'chunky', shoeColor: 'black', hat: 'hoodup', glasses: 'sunglasses' },
  },
  {
    id: 'fit-block-party', name: 'Block Party', category: 'outfits', rarity: 'rare', price: G(2), placeholder: true,
    blurb: 'Tie-dye tee, shorts, volt runners and a bucket hat. Summer on the block.',
    equip: { top: 'tee', topColor: 'tiedye', bottom: 'shorts', bottomColor: 'beige', shoes: 'running', shoeColor: 'volt', hat: 'bucket' },
  },

  // ---- hoodies & tops ----
  { id: 'top-camo-hoodie', name: 'Woodland Camo Hoodie', category: 'tops', rarity: 'rare', price: G(2), placeholder: true, blurb: 'Classic woodland camo.', equip: { top: 'hoodie', topColor: 'camo' } },
  { id: 'top-tiedye-tee', name: 'Tie-Dye Tee', category: 'tops', rarity: 'common', price: G(1), placeholder: true, blurb: 'Every one comes out different. (This one does not.)', equip: { top: 'tee', topColor: 'tiedye' } },
  { id: 'top-flame-hoodie', name: 'Flame Hoodie', category: 'tops', rarity: 'epic', price: G(3), placeholder: true, blurb: 'Flames licking up from the hem.', equip: { top: 'hoodie', topColor: 'flames' } },
  { id: 'top-gold-puffer', name: 'Gold Foil Puffer', category: 'tops', rarity: 'legendary', price: G(3.5), placeholder: true, limited: true, collection: 'AJ\'s Originals', blurb: 'Metallic gold quilting. Seen from the blimp.', equip: { top: 'puffer', topColor: 'gold' } },
  { id: 'top-ice-puffer', name: 'Pearl Puffer', category: 'tops', rarity: 'epic', price: G(2.5), placeholder: true, blurb: 'Pearl-white with a soft sheen.', equip: { top: 'puffer', topColor: 'ice' } },

  // ---- sneakers ----
  { id: 'kicks-gold', name: 'Chunky 1s "24K"', category: 'sneakers', rarity: 'legendary', price: G(3), placeholder: true, blurb: 'Gold-plated uppers.', equip: { shoes: 'chunky', shoeColor: 'gold24k' } },
  { id: 'kicks-bred', name: 'Chunky 1s "Bred"', category: 'sneakers', rarity: 'epic', price: G(2), placeholder: true, blurb: 'Black and red, the way they came.', equip: { shoes: 'chunky', shoeColor: 'bred' } },
  { id: 'kicks-icy', name: 'Chunky 1s "Icy"', category: 'sneakers', rarity: 'rare', price: G(1.5), placeholder: true, blurb: 'Glacier blue with a gloss.', equip: { shoes: 'chunky', shoeColor: 'icy' } },
  { id: 'kicks-volt', name: 'Runners "Volt"', category: 'sneakers', rarity: 'common', price: G(1), placeholder: true, blurb: 'Neon you can hear.', equip: { shoes: 'running', shoeColor: 'volt' } },
  { id: 'kicks-galaxy', name: 'Chunky 1s "Galaxy"', category: 'sneakers', rarity: 'epic', price: G(2.5), placeholder: true, blurb: 'A night sky on each foot.', equip: { shoes: 'chunky', shoeColor: 'galaxy' } },

  // ---- weapon skins (cosmetic only: no effect on any weapon) ----
  { id: 'skin-gold', name: '24K Gold Wrap', category: 'weapons', rarity: 'legendary', price: G(3.5), placeholder: true, blurb: 'Every gun you hold, solid gold.', equip: { weaponSkin: 'gold' } },
  { id: 'skin-camo', name: 'Woodland Wrap', category: 'weapons', rarity: 'common', price: G(1), placeholder: true, blurb: 'Green and brown camo.', equip: { weaponSkin: 'camo' } },
  { id: 'skin-neon', name: 'Neon Stripe', category: 'weapons', rarity: 'rare', price: G(1.5), placeholder: true, blurb: 'Glowing green and pink stripes.', equip: { weaponSkin: 'neon' } },
  { id: 'skin-chrome', name: 'Mirror Chrome', category: 'weapons', rarity: 'epic', price: G(2.5), placeholder: true, blurb: 'Polished like a rim.', equip: { weaponSkin: 'chrome' } },
  { id: 'skin-graffiti', name: 'Graffiti Wrap', category: 'weapons', rarity: 'epic', price: G(2.5), placeholder: true, blurb: 'Tagged up in every color.', equip: { weaponSkin: 'graffiti' } },

  // ---- accessories ----
  { id: 'acc-cuban', name: 'Cuban Link Chain', category: 'accessories', rarity: 'epic', price: G(2), placeholder: true, blurb: 'Heavy gold links.', equip: { necklace: 'cuban' } },
  { id: 'acc-wt-pendant', name: 'Iced WT Pendant', category: 'accessories', rarity: 'legendary', price: G(3), placeholder: true, limited: true, collection: 'WHOOPA TOWNE Merch', blurb: 'The Towne on your chest, iced out.', equip: { necklace: 'wtpendant' } },
  { id: 'acc-iced-watch', name: 'Iced-Out Watch', category: 'accessories', rarity: 'epic', price: G(2), placeholder: true, blurb: 'Bust-down bezel.', equip: { wrist: 'icedwatch' } },
  { id: 'acc-diamond-hoops', name: 'Diamond Hoops', category: 'accessories', rarity: 'rare', price: G(1.5), placeholder: true, blurb: 'Hoops that catch the light.', equip: { earrings: 'diamondhoops' } },
  { id: 'acc-gloves', name: 'Shooter Gloves', category: 'accessories', rarity: 'common', price: G(1), placeholder: true, blurb: 'Black leather gloves.', equip: { wrist: 'gloves' } },

  // ---- backpacks ----
  { id: 'bag-school', name: 'Black School Pack', category: 'backpacks', rarity: 'common', price: G(1), placeholder: true, blurb: 'The one everybody had.', equip: { backpack: 'schoolbag' } },
  { id: 'bag-designer', name: 'Monogram Pack', category: 'backpacks', rarity: 'legendary', price: G(3.5), placeholder: true, limited: true, collection: 'AJ\'s Originals', blurb: 'Brown and gold monogram leather.', equip: { backpack: 'designer' } },
  { id: 'bag-camo', name: 'Camo Pack', category: 'backpacks', rarity: 'rare', price: G(1.5), placeholder: true, blurb: 'Woodland camo, padded straps.', equip: { backpack: 'camopack' } },
];

export function catalogItem(id: unknown): StoreItem | null {
  return CATALOG.find((i) => i.id === id) ?? null;
}

/** TRAP shelf of an item (limited items also count as Special Items). */
export function trapCategory(item: StoreItem): TrapCategory {
  return TRAP_OF[item.category];
}

/**
 * Premium look options an owned item lets you wear: "field:option" keys. The option lists in
 * appearance.ts mark these options premium; the server strips any premium option a player
 * does not own before anyone sees it.
 */
export function unlocksOf(items: Iterable<string>, isPremium: (field: string, option: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const id of items) {
    const it = catalogItem(id);
    if (!it) continue;
    for (const [field, option] of Object.entries(it.equip)) if (option && isPremium(field, option)) out.add(`${field}:${option}`);
  }
  return out;
}
