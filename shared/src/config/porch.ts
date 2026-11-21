/**
 * JUMP OFF THE PORCH — battle royale tunables. Everything about the mode that someone might
 * want to change lives here: lobby size, the transport and balloons, the riot's phases and
 * damage, inventory limits, healing items and the bookbag loot tables. Shared by the server
 * (which runs the rules) and the client (HUD, prediction).
 */

import { WEAPONS, WEAPON_IDS, type WeaponId } from './weapons';

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
  pregame: 60,
  /** The pregame warm-up (in the map's warm-up area): respawn delay, and when bots turn up. */
  warmup: {
    respawn: 3,
    /** Bots join at random between these fractions of the pregame (so they arrive one by one). */
    joinFrom: 0.04,
    joinTo: 0.78,
  },

  // ---- the transport (a party blimp flying a straight line over the town) ------------
  transport: {
    /** Meters up (where you jump from). */
    altitude: 150,
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
  /** Armor on top of health. */
  maxArmor: 100,
  /**
   * Perc 29 (internally still 'ibuprofen'): orange pill bottles. They go in your pockets when
   * you pick them up; taking one (HEAL, or from the weapon wheel) fills your armor. `loose`:
   * bottles lying around the map at the start.
   */
  ibuprofen: { armor: 100, loose: 40 },
  /** Carry limits. */
  carry: {
    ammo: { light: 240, medium: 180, shells: 40, heavy: 30 },
    bandage: 10,
    medkit: 3,
    drink: 4,
    ibuprofen: 4,
    throwables: 4,
  },
  /**
   * Healing items: seconds to use, what they give and up to how much. Perc 29 gives armor
   * (`armor: true`), the rest health. An orange (`slow`) is eaten, then its health builds up
   * over `slow` seconds instead of all at once. (The keys are wire ids: the orange is still
   * 'drink', Perc 29 still 'ibuprofen'.)
   */
  heals: {
    bandage: { name: 'Bandage', time: 2.5, amount: 25, cap: 100, armor: false, slow: 0 },
    medkit: { name: 'First-Aid Kit', time: 8, amount: 100, cap: 100, armor: false, slow: 0 },
    drink: { name: 'Orange', time: 2.5, amount: 50, cap: 100, armor: false, slow: 10 },
    ibuprofen: { name: 'Perc 29', time: 2, amount: 100, cap: 100, armor: true, slow: 0 },
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
/** Wire codes for healing items (append only). */
export const HEAL_KINDS: readonly HealKind[] = ['bandage', 'medkit', 'drink', 'ibuprofen'];

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
  /** Perc 29 bottles (code 0), count = how many: carried; each one taken fills your armor. */
  IBUPROFEN: 6,
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

const W = ITEM.WEAPON, A = ITEM.AMMO, H = ITEM.HEAL, I = ITEM.IBUPROFEN, T = ITEM.THROWABLE;
const gun = (id: WeaponId, weight: number, rarity: Rarity): LootEntry => ({ item: { kind: W, code: WEAPON_IDS.indexOf(id), count: 0 }, weight, rarity });
/**
 * The loot pool. Guns are listed by id (their wire code is their place in WEAPON_IDS); ammo
 * codes follow AMMO_TYPES (0 light, 1 medium, 2 shells, 3 heavy); heal codes HEAL_KINDS;
 * throwable codes THROWABLE_IDS (0 grenade, 1 smoke). A looted gun comes with a full magazine
 * and a little ammo for it (its `lootAmmo`).
 */
export const LOOT: LootEntry[] = [
  // handguns and the common street guns
  gun('taurus', 10, 'common'),
  gun('uzi', 6, 'common'),
  gun('mp7', 5, 'common'),
  gun('bammer', 5, 'common'),
  gun('draco', 5, 'common'),
  // better
  gun('honeybadger', 3.5, 'uncommon'),
  gun('scorpion', 3, 'uncommon'),
  gun('bizon', 3, 'uncommon'),
  gun('doublebarrel', 3, 'uncommon'),
  gun('dmr', 2.5, 'uncommon'),
  gun('magnum', 2.5, 'uncommon'),
  // the good stuff
  gun('vector', 1.6, 'rare'),
  gun('p90', 1.6, 'rare'),
  gun('vss', 1.4, 'rare'),
  gun('intervention', 0.9, 'epic'),
  { item: { kind: A, code: 0, count: 40 }, weight: 10, rarity: 'common' },
  { item: { kind: A, code: 1, count: 30 }, weight: 9, rarity: 'common' },
  { item: { kind: A, code: 2, count: 10 }, weight: 7, rarity: 'common' },
  { item: { kind: A, code: 3, count: 8 }, weight: 5, rarity: 'uncommon' },
  { item: { kind: H, code: 0, count: 3 }, weight: 9, rarity: 'common' }, // bandages
  { item: { kind: H, code: 2, count: 1 }, weight: 6, rarity: 'common' }, // an orange
  { item: { kind: H, code: 1, count: 1 }, weight: 3, rarity: 'rare' }, // first-aid kit
  { item: { kind: I, code: 0, count: 1 }, weight: 7, rarity: 'uncommon' }, // Perc 29
  { item: { kind: I, code: 0, count: 2 }, weight: 2.5, rarity: 'rare' },
  { item: { kind: T, code: 0, count: 2 }, weight: 4, rarity: 'uncommon' }, // grenades
  { item: { kind: T, code: 1, count: 2 }, weight: 3, rarity: 'common' }, // smokes
];

/** Rounds of spare ammo that come with a looted gun (by weapon index). */
export const AMMO_WITH_WEAPON: readonly number[] = WEAPON_IDS.map((id) => WEAPONS[id].lootAmmo);

