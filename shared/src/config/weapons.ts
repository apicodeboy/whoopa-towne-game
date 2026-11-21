/**
 * Weapon and loadout definitions. All weapons are hitscan (melee is an arm's-reach "shot"
 * from the body).
 *
 * The WHOOPA TOWNE weapon collection: every gun's numbers follow what it is. Snipers hit
 * hardest and reload slowest; SMGs fire fastest and fall off soonest; shotguns own close
 * range; the suppressed guns kick least; pistols draw quickest.
 */

export type WeaponId =
  // primaries
  | 'draco' | 'dmr' | 'honeybadger' | 'intervention' | 'vss' | 'uzi' | 'mp7' | 'doublebarrel' | 'bammer'
  | 'vector' | 'p90' | 'scorpion' | 'bizon'
  // secondaries
  | 'taurus' | 'magnum'
  // melee
  | 'fists' | 'knife';
export type ThrowableId = 'grenade' | 'smoke';

/** Ammo families (battle royale: reloads draw from a shared pool per family). */
export type AmmoType = 'light' | 'medium' | 'shells' | 'heavy' | 'none';
export const AMMO_TYPES: readonly Exclude<AmmoType, 'none'>[] = ['light', 'medium', 'shells', 'heavy'];
export const AMMO_NAMES: Record<Exclude<AmmoType, 'none'>, string> = {
  light: 'Light Ammo', medium: 'Rifle Ammo', shells: 'Shells', heavy: 'Heavy Ammo',
};

/** What kind of gun it is (bots, the HUD and the hands use it). */
export type WeaponClass = 'rifle' | 'dmr' | 'sniper' | 'smg' | 'shotgun' | 'pistol' | 'revolver' | 'melee';

/**
 * The crosshair each gun shows (see the client's HUD): `scope` guns also put a scope over the
 * screen when aimed.
 */
export type Reticle = 'cross' | 'holo' | 'ring' | 'circledot' | 'wide' | 'chevron' | 'dotbrackets' | 'scope' | 'pso' | 'acog' | 'melee';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'primary' | 'secondary' | 'melee';
  cls: WeaponClass;
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

  /** The crosshair. */
  reticle: Reticle;
  /** Built-in suppressor: a small muzzle flash and a quiet shot. */
  suppressed?: boolean;
  /** Spare rounds that come with it when it is looted (JUMP OFF THE PORCH). */
  lootAmmo: number;
}

type Base = Omit<WeaponDef, 'id' | 'name' | 'blurb' | 'kind' | 'cls' | 'ammo' | 'reticle' | 'lootAmmo'>;
const def = (id: WeaponId, name: string, kind: WeaponDef['kind'], cls: WeaponClass, ammo: AmmoType, reticle: Reticle, lootAmmo: number, blurb: string, b: Base, extra: Partial<WeaponDef> = {}): WeaponDef =>
  ({ id, name, kind, cls, ammo, reticle, lootAmmo, blurb, ...b, ...extra });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // ------------------------------------------------------------------ rifles
  draco: def('draco', 'Draco SR.', 'primary', 'rifle', 'medium', 'cross', 30,
    'AK pistol, 7.62. Hits hard and kicks harder: short bursts.', {
      auto: true, rpm: 620, damage: 27, pellets: 1, magSize: 30, reserve: 90, reloadTime: 2.6, swapTime: 0.4,
      spreadHip: 2.6, spreadAim: 0.55, spreadMove: 1.8, spreadAir: 4.2, bloomPerShot: 0.42, bloomMax: 3.2, bloomRecover: 6,
      recoilPitch: 0.95, recoilYaw: 0.45, headMult: 1.7, falloffStart: 18, falloffEnd: 48, minDamageMult: 0.6, range: 140,
      aimFov: 0.6, moveMult: 0.97,
    }),
  honeybadger: def('honeybadger', 'Honey Badger', 'primary', 'rifle', 'medium', 'holo', 30,
    'Suppressed .300 PDW. Quiet, smooth and quick: the all-rounder.', {
      auto: true, rpm: 780, damage: 22, pellets: 1, magSize: 30, reserve: 120, reloadTime: 2.2, swapTime: 0.38,
      spreadHip: 1.9, spreadAim: 0.4, spreadMove: 1.3, spreadAir: 3.6, bloomPerShot: 0.25, bloomMax: 2.2, bloomRecover: 8,
      recoilPitch: 0.5, recoilYaw: 0.25, headMult: 1.7, falloffStart: 25, falloffEnd: 60, minDamageMult: 0.6, range: 150,
      aimFov: 0.52, moveMult: 1.0,
    }, { suppressed: true }),
  dmr: def('dmr', 'DMR', 'primary', 'dmr', 'heavy', 'acog', 15,
    'Semi-auto marksman rifle with a 4x sight. Two to the head, three to the body.', {
      auto: false, rpm: 320, damage: 46, pellets: 1, magSize: 15, reserve: 60, reloadTime: 2.7, swapTime: 0.5,
      spreadHip: 2.8, spreadAim: 0.06, spreadMove: 2.0, spreadAir: 4.5, bloomPerShot: 0.6, bloomMax: 2.4, bloomRecover: 6,
      recoilPitch: 1.9, recoilYaw: 0.35, headMult: 2.0, falloffStart: 70, falloffEnd: 180, minDamageMult: 0.8, range: 260,
      aimFov: 0.38, moveMult: 0.93,
    }),
  // ------------------------------------------------------------------ snipers
  intervention: def('intervention', 'Intervention', 'primary', 'sniper', 'heavy', 'scope', 7,
    'Bolt-action .408. One to the body ends it (if they have no armor). Slow to cycle, slower to reload.', {
      auto: false, rpm: 38, damage: 105, pellets: 1, magSize: 7, reserve: 21, reloadTime: 3.8, swapTime: 0.7,
      spreadHip: 6.0, spreadAim: 0.02, spreadMove: 3.0, spreadAir: 7.0, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
      recoilPitch: 4.2, recoilYaw: 0.8, headMult: 2.6, falloffStart: 120, falloffEnd: 320, minDamageMult: 0.85, range: 400,
      aimFov: 0.2, moveMult: 0.86,
    }),
  vss: def('vss', 'VSS Vintorez', 'primary', 'sniper', 'heavy', 'pso', 10,
    'Silent sniper on full auto. Ten heavy subsonic rounds, a 4x scope, a quick follow-up.', {
      auto: true, rpm: 600, damage: 34, pellets: 1, magSize: 10, reserve: 50, reloadTime: 2.5, swapTime: 0.5,
      spreadHip: 2.4, spreadAim: 0.12, spreadMove: 1.6, spreadAir: 4.0, bloomPerShot: 0.35, bloomMax: 2.4, bloomRecover: 7,
      recoilPitch: 1.1, recoilYaw: 0.4, headMult: 2.0, falloffStart: 40, falloffEnd: 110, minDamageMult: 0.65, range: 220,
      aimFov: 0.34, moveMult: 0.95,
    }, { suppressed: true }),
  // ------------------------------------------------------------------ SMGs
  uzi: def('uzi', 'UZI', 'primary', 'smg', 'light', 'circledot', 32,
    'Old-school open bolt. Sprays well from the hip, wanders when you aim.', {
      auto: true, rpm: 620, damage: 20, pellets: 1, magSize: 32, reserve: 128, reloadTime: 1.9, swapTime: 0.3,
      spreadHip: 1.7, spreadAim: 1.0, spreadMove: 0.9, spreadAir: 2.8, bloomPerShot: 0.2, bloomMax: 2.4, bloomRecover: 9,
      recoilPitch: 0.45, recoilYaw: 0.4, headMult: 1.5, falloffStart: 10, falloffEnd: 30, minDamageMult: 0.5, range: 100,
      aimFov: 0.75, moveMult: 1.04,
    }),
  mp7: def('mp7', 'MP7', 'primary', 'smg', 'light', 'holo', 40,
    'Forty rounds, barely any kick. Laser-flat at mid range for an SMG.', {
      auto: true, rpm: 950, damage: 15, pellets: 1, magSize: 40, reserve: 160, reloadTime: 2.0, swapTime: 0.3,
      spreadHip: 1.6, spreadAim: 0.6, spreadMove: 0.9, spreadAir: 2.8, bloomPerShot: 0.15, bloomMax: 2.0, bloomRecover: 10,
      recoilPitch: 0.32, recoilYaw: 0.22, headMult: 1.6, falloffStart: 14, falloffEnd: 38, minDamageMult: 0.5, range: 120,
      aimFov: 0.62, moveMult: 1.03,
    }),
  vector: def('vector', 'Kriss Vector', 'primary', 'smg', 'light', 'holo', 33,
    'The fastest gun on the block. The recoil system keeps it pinned: empty a mag in under two seconds.', {
      auto: true, rpm: 1100, damage: 14, pellets: 1, magSize: 33, reserve: 132, reloadTime: 2.3, swapTime: 0.3,
      spreadHip: 1.5, spreadAim: 0.55, spreadMove: 0.8, spreadAir: 2.6, bloomPerShot: 0.12, bloomMax: 1.8, bloomRecover: 11,
      recoilPitch: 0.24, recoilYaw: 0.2, headMult: 1.5, falloffStart: 10, falloffEnd: 30, minDamageMult: 0.45, range: 100,
      aimFov: 0.62, moveMult: 1.03,
    }),
  p90: def('p90', 'P90', 'primary', 'smg', 'light', 'ring', 50,
    'Fifty in the top mag. Reaches further than other SMGs; the reload is the catch.', {
      auto: true, rpm: 900, damage: 16, pellets: 1, magSize: 50, reserve: 150, reloadTime: 2.8, swapTime: 0.35,
      spreadHip: 1.6, spreadAim: 0.6, spreadMove: 0.9, spreadAir: 2.8, bloomPerShot: 0.16, bloomMax: 2.0, bloomRecover: 10,
      recoilPitch: 0.3, recoilYaw: 0.25, headMult: 1.5, falloffStart: 16, falloffEnd: 40, minDamageMult: 0.5, range: 120,
      aimFov: 0.6, moveMult: 1.02,
    }),
  scorpion: def('scorpion', 'Scorpion EVO', 'primary', 'smg', 'light', 'circledot', 30,
    'Tiny, mean and fast. Quickest reload of the SMGs; keep it close.', {
      auto: true, rpm: 1150, damage: 15, pellets: 1, magSize: 30, reserve: 120, reloadTime: 1.8, swapTime: 0.25,
      spreadHip: 1.8, spreadAim: 0.75, spreadMove: 0.8, spreadAir: 2.6, bloomPerShot: 0.22, bloomMax: 2.4, bloomRecover: 9,
      recoilPitch: 0.42, recoilYaw: 0.35, headMult: 1.5, falloffStart: 9, falloffEnd: 26, minDamageMult: 0.45, range: 100,
      aimFov: 0.68, moveMult: 1.05,
    }),
  bizon: def('bizon', 'PP-19 Bizon', 'primary', 'smg', 'light', 'cross', 64,
    'Sixty-four rounds in the helical mag. Slow to empty, slow to reload.', {
      auto: true, rpm: 680, damage: 18, pellets: 1, magSize: 64, reserve: 128, reloadTime: 3.0, swapTime: 0.4,
      spreadHip: 1.8, spreadAim: 0.7, spreadMove: 1.0, spreadAir: 2.8, bloomPerShot: 0.18, bloomMax: 2.2, bloomRecover: 9,
      recoilPitch: 0.36, recoilYaw: 0.3, headMult: 1.5, falloffStart: 12, falloffEnd: 32, minDamageMult: 0.5, range: 110,
      aimFov: 0.66, moveMult: 1.0,
    }),
  // ------------------------------------------------------------------ shotguns
  doublebarrel: def('doublebarrel', 'Double-Barrel', 'primary', 'shotgun', 'shells', 'wide', 8,
    'Two barrels, two chances. Both shells hit like a truck across a doorway.', {
      auto: false, rpm: 240, damage: 15, pellets: 10, magSize: 2, reserve: 24, reloadTime: 2.6, swapTime: 0.45,
      spreadHip: 5.2, spreadAim: 4.2, spreadMove: 0.5, spreadAir: 1.5, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
      recoilPitch: 3.6, recoilYaw: 1.0, headMult: 1.25, falloffStart: 5, falloffEnd: 16, minDamageMult: 0.15, range: 40,
      aimFov: 0.88, moveMult: 0.97,
    }),
  bammer: def('bammer', 'Bammer 1997', 'primary', 'shotgun', 'shells', 'ring', 8,
    'Old pump trench gun, tighter choke. Five shells, a long reach for a shotgun.', {
      auto: false, rpm: 75, damage: 14, pellets: 8, magSize: 5, reserve: 30, reloadTime: 3.2, swapTime: 0.5,
      spreadHip: 4.0, spreadAim: 3.0, spreadMove: 0.6, spreadAir: 2.0, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
      recoilPitch: 2.6, recoilYaw: 0.8, headMult: 1.3, falloffStart: 8, falloffEnd: 24, minDamageMult: 0.2, range: 60,
      aimFov: 0.85, moveMult: 0.95,
    }),
  // ------------------------------------------------------------------ secondaries
  taurus: def('taurus', 'Taurus – Mia Edition', 'secondary', 'pistol', 'light', 'dotbrackets', 17,
    'Seventeen in the mag, pink on the slide. Quick out of the holster, rewards headshots.', {
      auto: false, rpm: 400, damage: 25, pellets: 1, magSize: 17, reserve: 68, reloadTime: 1.4, swapTime: 0.22,
      spreadHip: 1.3, spreadAim: 0.35, spreadMove: 0.8, spreadAir: 3.0, bloomPerShot: 0.5, bloomMax: 2.2, bloomRecover: 8,
      recoilPitch: 1.0, recoilYaw: 0.35, headMult: 2.0, falloffStart: 16, falloffEnd: 45, minDamageMult: 0.55, range: 110,
      aimFov: 0.8, moveMult: 1.05,
    }),
  magnum: def('magnum', 'Magnum .44', 'secondary', 'revolver', 'heavy', 'chevron', 12,
    'Six heavy rounds. Two to the body, one and a bit to the head; take your time.', {
      auto: false, rpm: 140, damage: 60, pellets: 1, magSize: 6, reserve: 30, reloadTime: 3.0, swapTime: 0.35,
      spreadHip: 1.8, spreadAim: 0.25, spreadMove: 1.2, spreadAir: 4.0, bloomPerShot: 1.4, bloomMax: 3.0, bloomRecover: 5,
      recoilPitch: 3.4, recoilYaw: 0.9, headMult: 2.0, falloffStart: 25, falloffEnd: 70, minDamageMult: 0.7, range: 160,
      aimFov: 0.72, moveMult: 1.0,
    }),
  // ------------------------------------------------------------------ melee
  fists: def('fists', 'Hands', 'melee', 'melee', 'none', 'melee', 0, 'Two hands and a bad attitude.', {
    auto: false, rpm: 100, damage: 22, pellets: 1, magSize: 0, reserve: 0, reloadTime: 0, swapTime: 0.2,
    spreadHip: 0, spreadAim: 0, spreadMove: 0, spreadAir: 0, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
    recoilPitch: 0, recoilYaw: 0, headMult: 1.2, falloffStart: 10, falloffEnd: 20, minDamageMult: 1,
    /** Arm's reach from the body (the punch is traced from the eyes, not the camera). */
    range: 1.3,
    aimFov: 1, moveMult: 1.05,
  }),
  knife: def('knife', 'Street Knife', 'melee', 'melee', 'none', 'melee', 0, 'Quicker and nastier than hands. Three cuts and they are done.', {
    auto: false, rpm: 130, damage: 36, pellets: 1, magSize: 0, reserve: 0, reloadTime: 0, swapTime: 0.15,
    spreadHip: 0, spreadAim: 0, spreadMove: 0, spreadAir: 0, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
    recoilPitch: 0, recoilYaw: 0, headMult: 1.5, falloffStart: 10, falloffEnd: 20, minDamageMult: 1,
    range: 1.5, aimFov: 1, moveMult: 1.1,
  }),
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
export const WEAPON_IDS: readonly WeaponId[] = [
  'draco', 'dmr', 'honeybadger', 'intervention', 'vss', 'uzi', 'mp7', 'doublebarrel', 'bammer',
  'taurus', 'magnum', 'vector', 'p90', 'scorpion', 'bizon', 'fists', 'knife',
];
export const THROWABLE_IDS: readonly ThrowableId[] = ['grenade', 'smoke'];
export const PRIMARY_IDS: readonly WeaponId[] = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'primary');
export const SECONDARY_IDS: readonly WeaponId[] = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'secondary');
export const MELEE_IDS: readonly WeaponId[] = ['fists', 'knife'];
/** Guns you can hold (everything but melee). */
export const GUN_IDS: readonly WeaponId[] = WEAPON_IDS.filter((id) => WEAPONS[id].kind !== 'melee');

/**
 * The collection, as the gun picker shows it: numbered cards, card 12 a choice of four
 * (the weapon in that slot is whichever of them you pick).
 */
export const COLLECTION: ReadonlyArray<{ no: number; ids: readonly WeaponId[] }> = [
  { no: 1, ids: ['draco'] }, { no: 2, ids: ['dmr'] }, { no: 3, ids: ['honeybadger'] },
  { no: 4, ids: ['intervention'] }, { no: 5, ids: ['vss'] }, { no: 6, ids: ['uzi'] },
  { no: 7, ids: ['mp7'] }, { no: 8, ids: ['doublebarrel'] }, { no: 9, ids: ['bammer'] },
  { no: 10, ids: ['taurus'] }, { no: 11, ids: ['magnum'] }, { no: 12, ids: ['vector', 'p90', 'scorpion', 'bizon'] },
];

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
  /** What you swing when a gun slot is empty (hands or the knife). */
  melee: WeaponId;
}

export const DEFAULT_LOADOUT: Loadout = { primary: 'draco', secondary: 'taurus', throwable: 'grenade', melee: 'knife' };

/** Coerce untrusted input (network / localStorage) into a valid loadout. */
export function sanitizeLoadout(raw: unknown): Loadout {
  const r = (raw ?? {}) as Partial<Record<keyof Loadout, unknown>>;
  const primary = PRIMARY_IDS.includes(r.primary as WeaponId) ? (r.primary as WeaponId) : DEFAULT_LOADOUT.primary;
  const secondary = SECONDARY_IDS.includes(r.secondary as WeaponId) ? (r.secondary as WeaponId) : DEFAULT_LOADOUT.secondary;
  const throwable = THROWABLE_IDS.includes(r.throwable as ThrowableId) ? (r.throwable as ThrowableId) : DEFAULT_LOADOUT.throwable;
  const melee = MELEE_IDS.includes(r.melee as WeaponId) ? (r.melee as WeaponId) : DEFAULT_LOADOUT.melee;
  return { primary, secondary, throwable, melee };
}

/**
 * The gun picker's stat bars (0..1): damage per second, fire rate, accuracy, range and
 * control, worked out from the real numbers so they always agree with how the gun plays.
 */
export function weaponBars(w: WeaponDef): { damage: number; fireRate: number; accuracy: number; range: number; control: number } {
  if (w.kind === 'melee') return { damage: w.damage / 60, fireRate: w.rpm / 1200, accuracy: 1, range: w.range / 300, control: 1 };
  const perShot = w.damage * w.pellets;
  const clamp01 = (x: number) => Math.max(0.04, Math.min(1, x));
  return {
    damage: clamp01(perShot / 150),
    fireRate: clamp01(w.rpm / 1150),
    accuracy: clamp01(1 - Math.log2(1 + w.spreadAim) / 2.6),
    range: clamp01((w.falloffStart + w.falloffEnd) / 2 / 220),
    control: clamp01(1 - (w.recoilPitch + w.recoilYaw * 0.6 + w.bloomPerShot) / 5),
  };
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
