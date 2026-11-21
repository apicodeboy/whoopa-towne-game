/** Weapon and loadout definitions. All weapons are hitscan (fists are an arm's-reach "shot" from the body). */

export type WeaponId = 'smg' | 'ar' | 'shotgun' | 'pistol' | 'sniper' | 'fists';
export type ThrowableId = 'grenade' | 'smoke';

/** Ammo families (battle royale: reloads draw from a shared pool per family). */
export type AmmoType = 'light' | 'medium' | 'shells' | 'heavy' | 'none';
export const AMMO_TYPES: readonly Exclude<AmmoType, 'none'>[] = ['light', 'medium', 'shells', 'heavy'];
export const AMMO_NAMES: Record<Exclude<AmmoType, 'none'>, string> = {
  light: 'Light Ammo', medium: 'Rifle Ammo', shells: 'Shells', heavy: 'Heavy Ammo',
};

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'primary' | 'secondary' | 'melee';
  /** Ammo family it reloads from in JUMP OFF THE PORCH. */
  ammo: AmmoType;
  blurb: string;
  /** Hold-to-fire if true, one shot per trigger pull if false. */
  auto: boolean;
  /** Rounds per minute. */
  rpm: number;
  /** Damage per pellet at point-blank. */
  damage: number;
  pellets: number;
  magSize: number;
  /** Spare rounds carried on spawn. */
  reserve: number;
  /** Seconds. */
  reloadTime: number;
  /** Seconds to raise the weapon after switching to it. */
  swapTime: number;

  // Spread (all in degrees, half-angle of the cone)
  spreadHip: number;
  spreadAim: number;
  /** Extra spread at full walk speed. */
  spreadMove: number;
  /** Extra spread while airborne. */
  spreadAir: number;
  /** Spread added per shot (bloom). */
  bloomPerShot: number;
  bloomMax: number;
  /** Degrees per second the bloom settles. */
  bloomRecover: number;

  // Recoil (view kick, degrees)
  recoilPitch: number;
  recoilYaw: number;

  // Damage model
  headMult: number;
  /** Distance where damage starts dropping. */
  falloffStart: number;
  /** Distance where damage reaches `minDamageMult`. */
  falloffEnd: number;
  minDamageMult: number;
  /** Max hitscan distance. */
  range: number;

  /** Field-of-view multiplier while aiming. */
  aimFov: number;
  /** Movement speed multiplier while this weapon is out. */
  moveMult: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  smg: {
    id: 'smg',
    ammo: 'light',
    name: 'Stinger SMG',
    kind: 'primary',
    blurb: 'Fast and loose. Shreds up close, fades at range.',
    auto: true,
    rpm: 840,
    damage: 17,
    pellets: 1,
    magSize: 32,
    reserve: 128,
    reloadTime: 1.9,
    swapTime: 0.35,
    spreadHip: 1.9,
    spreadAim: 0.85,
    spreadMove: 1.1,
    spreadAir: 3.0,
    bloomPerShot: 0.22,
    bloomMax: 2.4,
    bloomRecover: 9,
    recoilPitch: 0.42,
    recoilYaw: 0.3,
    headMult: 1.5,
    falloffStart: 12,
    falloffEnd: 36,
    minDamageMult: 0.5,
    range: 120,
    aimFov: 0.62,
    moveMult: 1.0,
  },
  ar: {
    id: 'ar',
    ammo: 'medium',
    name: 'Kingpin AR',
    kind: 'primary',
    blurb: 'All-round rifle. Accurate when aimed, hits hard at mid range.',
    auto: true,
    rpm: 600,
    damage: 24,
    pellets: 1,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.3,
    swapTime: 0.45,
    spreadHip: 2.2,
    spreadAim: 0.32,
    spreadMove: 1.6,
    spreadAir: 4.0,
    bloomPerShot: 0.3,
    bloomMax: 2.6,
    bloomRecover: 7,
    recoilPitch: 0.62,
    recoilYaw: 0.28,
    headMult: 1.75,
    falloffStart: 28,
    falloffEnd: 70,
    minDamageMult: 0.65,
    range: 160,
    aimFov: 0.5,
    moveMult: 0.95,
  },
  shotgun: {
    id: 'shotgun',
    ammo: 'shells',
    name: 'Block Sweeper',
    kind: 'primary',
    blurb: 'Pump shotgun. Owns alleys and doorways.',
    auto: false,
    rpm: 72,
    damage: 13,
    pellets: 9,
    magSize: 6,
    reserve: 30,
    reloadTime: 2.7,
    swapTime: 0.45,
    spreadHip: 4.4,
    spreadAim: 3.3,
    spreadMove: 0.6,
    spreadAir: 2.0,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 10,
    recoilPitch: 2.6,
    recoilYaw: 0.8,
    headMult: 1.3,
    falloffStart: 7,
    falloffEnd: 22,
    minDamageMult: 0.2,
    range: 60,
    aimFov: 0.85,
    moveMult: 0.95,
  },
  pistol: {
    id: 'pistol',
    ammo: 'light',
    name: 'Deuce Pistol',
    kind: 'secondary',
    blurb: 'Reliable sidearm. Quick to draw, rewards headshots.',
    auto: false,
    rpm: 380,
    damage: 28,
    pellets: 1,
    magSize: 12,
    reserve: 48,
    reloadTime: 1.4,
    swapTime: 0.25,
    spreadHip: 1.3,
    spreadAim: 0.35,
    spreadMove: 0.8,
    spreadAir: 3.0,
    bloomPerShot: 0.55,
    bloomMax: 2.2,
    bloomRecover: 8,
    recoilPitch: 1.1,
    recoilYaw: 0.35,
    headMult: 2.0,
    falloffStart: 18,
    falloffEnd: 50,
    minDamageMult: 0.55,
    range: 120,
    aimFov: 0.8,
    moveMult: 1.05,
  },
  sniper: {
    id: 'sniper',
    ammo: 'heavy',
    name: 'Long Distance',
    kind: 'primary',
    blurb: 'Bolt-action rifle. One good shot ends the conversation.',
    auto: false,
    rpm: 42,
    damage: 88,
    pellets: 1,
    magSize: 5,
    reserve: 15,
    reloadTime: 3.0,
    swapTime: 0.6,
    spreadHip: 5.0,
    spreadAim: 0.04,
    spreadMove: 2.4,
    spreadAir: 6.0,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 10,
    recoilPitch: 3.4,
    recoilYaw: 0.6,
    headMult: 2.2,
    falloffStart: 80,
    falloffEnd: 220,
    minDamageMult: 0.8,
    range: 300,
    aimFov: 0.32,
    moveMult: 0.9,
  },
  fists: {
    id: 'fists',
    ammo: 'none',
    name: 'Hands',
    kind: 'melee',
    blurb: 'Two hands and a bad attitude.',
    auto: false,
    rpm: 100,
    damage: 22,
    pellets: 1,
    magSize: 0,
    reserve: 0,
    reloadTime: 0,
    swapTime: 0.2,
    spreadHip: 0,
    spreadAim: 0,
    spreadMove: 0,
    spreadAir: 0,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 10,
    recoilPitch: 0,
    recoilYaw: 0,
    headMult: 1.2,
    falloffStart: 10,
    falloffEnd: 20,
    minDamageMult: 1,
    /** Arm's reach from the body (the punch is traced from the eyes, not the camera). */
    range: 1.3,
    aimFov: 1,
    moveMult: 1.05,
  },
};

export interface ThrowableDef {
  id: ThrowableId;
  name: string;
  blurb: string;
}

export const THROWABLES: Record<ThrowableId, ThrowableDef> = {
  grenade: { id: 'grenade', name: 'Frag Grenade', blurb: 'Bounces, then clears a corner. Mind the fuse.' },
  smoke: { id: 'smoke', name: 'Smoke Canister', blurb: 'Blocks sightlines for a push or a getaway.' },
};

/** Stable numeric ids for the wire (append only). */
export const WEAPON_IDS: readonly WeaponId[] = ['smg', 'ar', 'shotgun', 'pistol', 'sniper', 'fists'];
export const THROWABLE_IDS: readonly ThrowableId[] = ['grenade', 'smoke'];
export const PRIMARY_IDS: readonly WeaponId[] = ['smg', 'ar', 'shotgun'];
export const SECONDARY_IDS: readonly WeaponId[] = ['pistol'];

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}
export function throwableIndex(id: ThrowableId): number {
  return THROWABLE_IDS.indexOf(id);
}

/** What a player carries into a match. No XP or unlocks: everything is available. */
export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
  throwable: ThrowableId;
}

export const DEFAULT_LOADOUT: Loadout = { primary: 'ar', secondary: 'pistol', throwable: 'grenade' };

/** Coerce untrusted input (network / localStorage) into a valid loadout. */
export function sanitizeLoadout(raw: unknown): Loadout {
  const r = (raw ?? {}) as Partial<Record<keyof Loadout, unknown>>;
  const primary = PRIMARY_IDS.includes(r.primary as WeaponId) ? (r.primary as WeaponId) : DEFAULT_LOADOUT.primary;
  const secondary = SECONDARY_IDS.includes(r.secondary as WeaponId) ? (r.secondary as WeaponId) : DEFAULT_LOADOUT.secondary;
  const throwable = THROWABLE_IDS.includes(r.throwable as ThrowableId) ? (r.throwable as ThrowableId) : DEFAULT_LOADOUT.throwable;
  return { primary, secondary, throwable };
}

/** Weapon slots: 0 = primary, 1 = secondary, 2 = throwable. */
export const SLOT_PRIMARY = 0;
export const SLOT_SECONDARY = 1;
export const SLOT_THROWABLE = 2;

/** Weapon slot for the second primary (JUMP OFF THE PORCH carries two). */
export const SLOT_PRIMARY_B = 3;

export function weaponForSlot(loadout: Loadout, slot: number): WeaponDef | null {
  if (slot === SLOT_PRIMARY) return WEAPONS[loadout.primary];
  if (slot === SLOT_SECONDARY) return WEAPONS[loadout.secondary];
  return null;
}

/** Damage multiplier for a hit at `dist` meters. */
export function damageFalloff(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.minDamageMult;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.minDamageMult - 1) * t;
}
