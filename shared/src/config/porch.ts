/**
 * JUMP OFF THE PORCH — battle royale tunables. Everything about the mode that someone might
 * want to change lives here: lobby size, the transport and balloons, the riot's phases and
 * damage, inventory limits, healing items and the bookbag loot tables. Shared by the server
 * (which runs the rules) and the client (HUD, prediction).
 */

export type SquadMode = 'solo' | 'duos' | 'squads';

export const SQUAD_MODES: Record<SquadMode, { name: string; size: number; blurb: string }> = {
  solo: { name: 'Solo', size: 1, blurb: 'Everybody for themselves.' },
  duos: { name: 'Duos', size: 2, blurb: 'Teams of 2.' },
  squads: { name: 'Squads', size: 4, blurb: 'Teams of 4.' },
};
export const SQUAD_MODE_IDS: readonly SquadMode[] = ['solo', 'duos', 'squads'];

export function sanitizeSquadMode(raw: unknown): SquadMode {
  return SQUAD_MODE_IDS.includes(raw as SquadMode) ? (raw as SquadMode) : 'solo';
}

export const PORCH = {
  name: 'JUMP OFF THE PORCH',
  tagline: 'Everybody gotta jump off the porch someday. Only one makes it out.',

  // ---- lobby -----------------------------------------------------------------
  /** Players per match (humans first, bots fill the rest). The sim supports up to `maxPlayers`. */
  lobbySize: 20,
  maxPlayers: 100,
  /** Public lobbies start counting down once this many humans are waiting. */
  minHumansToStart: 1,
  /** Seconds of countdown before a public lobby launches (more players can still join). */
  startCountdown: 30,
  /** Seconds on the transport before it takes off (look around, get ready). */
  pregame: 6,

  // ---- the transport (a party blimp flying a straight line over the town) ------------
  transport: {
    altitude: 100,
    /** Meters per second. */
    speed: 9,
    /** How far beyond the map edge the route starts and ends. */
    overshoot: 30,
    /** Seconds after take-off before anyone may jump. */
    doorsOpen: 2,
  },

  // ---- skydiving (straight out of the blimp, before the balloons go up) ------------------
  skydive: {
    gravity: 15,
    /** Top fall speed (m/s) normally, and while holding crouch to dive. */
    fallSpeed: 24,
    diveSpeed: 34,
    /** Top horizontal speed (m/s) and how quickly steering responds. */
    steerSpeed: 14,
    steerAccel: 10,
    /** The balloons go up on their own this far (m) above whatever is below you... */
    deployHeight: 30,
    /** ...or sooner when you press jump, once you have fallen for this long (s). */
    minFreefall: 0.8,
  },

  // ---- balloon descent ---------------------------------------------------------
  balloon: {
    /** Sink rate (m/s) normally, and while holding crouch to drop faster. */
    fallSpeed: 4.4,
    diveSpeed: 11,
    /** Top horizontal steering speed (m/s) and how quickly it responds. */
    steerSpeed: 8,
    steerAccel: 7,
    /** Strongest wind (m/s); each match picks a random breeze up to this. */
    windMax: 1.8,
  },

  // ---- match stages (seconds) ----------------------------------------------------
  /**
   * After the pregame: deployment (fly + land), early game (loot in peace), then riot
   * phases. In a riot phase the crowd first gathers (`warn`) and then spreads inward
   * (`shrink`) until the safe area has `radius` (fraction of the starting area) left.
   * `dps` is the damage per second for anyone caught in the riot during that phase.
   */
  deploySeconds: 60,
  earlySeconds: 60,
  riotPhases: [
    { name: 'RIOT PHASE 1', warn: 40, shrink: 60, radius: 0.6, dps: 2 },
    { name: 'RIOT PHASE 2', warn: 35, shrink: 50, radius: 0.36, dps: 4 },
    { name: 'RIOT PHASE 3', warn: 30, shrink: 45, radius: 0.18, dps: 7 },
    { name: 'FINAL RIOT', warn: 20, shrink: 50, radius: 0, dps: 12 },
  ],
  /** Movement speed multiplier while caught in the riot. */
  riotSlow: 0.62,
  /** Seconds the winners' screen stays up before everyone goes back to the lobby. */
  endedSeconds: 14,

  // ---- player ------------------------------------------------------------------------
  maxArmor: 100,
  /** Carry limits. */
  carry: {
    ammo: { light: 240, medium: 180, shells: 40, heavy: 30 },
    bandage: 10,
    medkit: 3,
    drink: 4,
    throwables: 4,
  },
  /** Healing items: seconds to use, health given, and the health they can heal up to. */
  heals: {
    bandage: { name: 'Bandage', time: 2.5, amount: 15, cap: 75 },
    medkit: { name: 'First-Aid Kit', time: 6, amount: 100, cap: 100 },
    drink: { name: 'Corner Store Drink', time: 2, amount: 25, cap: 100 },
  },
  /** Movement speed multiplier while using a healing item. */
  healSlow: 0.5,
  /** How close (meters) you must be to search a bookbag or pick something up. */
  reach: 2.3,

  // ---- bookbags --------------------------------------------------------------------
  /** Bookbags: whichever is most of per player, per hectare of map, or a fixed minimum. */
  bagsPerPlayer: 3.2,
  bagsPerHectare: 9,
  minBags: 24,
  /** Share of the bags that go to the map's loot spots (inside shops and houses, on roofs). */
  bagsAtLootSpots: 0.45,
} as const;

export type HealKind = keyof typeof PORCH.heals;
/** Wire codes for healing items. */
export const HEAL_KINDS: readonly HealKind[] = ['bandage', 'medkit', 'drink'];

// ---- items -------------------------------------------------------------------------------
/** What a bookbag or the ground can hold. `code` meaning depends on the kind. */
export const ITEM = {
  /** code = weapon index (WEAPON_IDS), count = rounds in its magazine */
  WEAPON: 1,
  /** code = ammo type index (AMMO_TYPES), count = rounds */
  AMMO: 2,
  /** code = heal kind index (HEAL_KINDS), count = how many */
  HEAL: 3,
  /** code = armor amount (50 or 100), count = 1 */
  ARMOR: 4,
  /** code = throwable index (THROWABLE_IDS), count = how many */
  THROWABLE: 5,
} as const;

export interface Item {
  kind: number;
  code: number;
  count: number;
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

/** One entry of the loot pool: what it is and how likely (weights are relative). */
export interface LootEntry {
  item: Item;
  weight: number;
  rarity: Rarity;
}

/**
 * Bookbag variations. `rolls` = [min, max] items inside; `luck` multiplies the weight of
 * rare and epic entries (designer bags and duffels hold better stuff). `weight` is how often
 * the variation is placed.
 */
export const BAGS = [
  { id: 'school', name: 'Black School Backpack', rolls: [1, 3], luck: 1, weight: 5 },
  { id: 'designer', name: 'Designer Backpack', rolls: [2, 3], luck: 1.8, weight: 1.5 },
  { id: 'camo', name: 'Camo Backpack', rolls: [2, 3], luck: 1.4, weight: 2 },
  { id: 'worn', name: 'Old Worn Backpack', rolls: [1, 2], luck: 0.7, weight: 3 },
  { id: 'bright', name: 'Bright Backpack', rolls: [1, 3], luck: 1, weight: 2.5 },
  { id: 'duffel', name: 'Duffel Bag', rolls: [3, 4], luck: 2.2, weight: 1 },
] as const;

/** How rarity multiplies with a bag's luck. */
export const RARITY_LUCK: Record<Rarity, number> = { common: 0, uncommon: 0.5, rare: 1, epic: 1.4 };

const W = ITEM.WEAPON, A = ITEM.AMMO, H = ITEM.HEAL, R = ITEM.ARMOR, T = ITEM.THROWABLE;
/**
 * The loot pool. Weapon codes follow WEAPON_IDS (0 smg, 1 ar, 2 shotgun, 3 pistol, 4 sniper);
 * ammo codes follow AMMO_TYPES (0 light, 1 medium, 2 shells, 3 heavy); heal codes HEAL_KINDS;
 * throwable codes THROWABLE_IDS (0 grenade, 1 smoke). A looted gun comes with a full magazine
 * and a little ammo for it (see AMMO_WITH_WEAPON).
 */
export const LOOT: LootEntry[] = [
  { item: { kind: W, code: 3, count: 0 }, weight: 12, rarity: 'common' }, // pistol
  { item: { kind: W, code: 0, count: 0 }, weight: 9, rarity: 'common' }, // smg
  { item: { kind: W, code: 2, count: 0 }, weight: 7, rarity: 'uncommon' }, // shotgun
  { item: { kind: W, code: 1, count: 0 }, weight: 6, rarity: 'uncommon' }, // ar
  { item: { kind: W, code: 4, count: 0 }, weight: 2, rarity: 'rare' }, // sniper
  { item: { kind: A, code: 0, count: 40 }, weight: 10, rarity: 'common' },
  { item: { kind: A, code: 1, count: 30 }, weight: 9, rarity: 'common' },
  { item: { kind: A, code: 2, count: 10 }, weight: 7, rarity: 'common' },
  { item: { kind: A, code: 3, count: 6 }, weight: 4, rarity: 'uncommon' },
  { item: { kind: H, code: 0, count: 3 }, weight: 9, rarity: 'common' }, // bandages
  { item: { kind: H, code: 2, count: 1 }, weight: 6, rarity: 'common' }, // drink
  { item: { kind: H, code: 1, count: 1 }, weight: 3, rarity: 'rare' }, // first-aid kit
  { item: { kind: R, code: 50, count: 1 }, weight: 5, rarity: 'uncommon' },
  { item: { kind: R, code: 100, count: 1 }, weight: 1.5, rarity: 'epic' },
  { item: { kind: T, code: 0, count: 2 }, weight: 4, rarity: 'uncommon' }, // grenades
  { item: { kind: T, code: 1, count: 2 }, weight: 3, rarity: 'common' }, // smokes
];

/** Rounds of spare ammo that come with a looted gun (by weapon index). */
export const AMMO_WITH_WEAPON = [32, 30, 8, 12, 5];
