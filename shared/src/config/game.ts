/** Core gameplay tunables. Shared by client prediction and the authoritative server. */

export const GAME_NAME = 'Whoopa Towne';

// ---- Simulation timing -------------------------------------------------------
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
/** Server sends a world snapshot every N ticks (2 => 30 Hz). */
export const SNAPSHOT_EVERY = 2;
/** Remote entities are rendered this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY_MS = 100;
/** How far back the server will rewind hitboxes for lag compensation. */
export const MAX_REWIND_MS = 400;

// ---- Match size --------------------------------------------------------------
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const TEAM_SIZE = MAX_PLAYERS / 2;

// ---- Player body & movement --------------------------------------------------
export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.15,
  eyeHeight: 1.62,
  crouchEyeHeight: 0.95,

  walkSpeed: 5.2,
  sprintSpeed: 7.6,
  crouchSpeed: 2.7,
  aimSpeed: 3.4,
  accelGround: 70,
  accelAir: 14,
  gravity: 22,
  jumpVelocity: 7.4,
  maxPitch: 1.45,

  maxHealth: 100,
  /** Seconds without taking damage before health starts to regenerate. */
  regenDelay: 5,
  /** Health per second once regenerating. */
  regenRate: 22,
  /** Seconds between dying and respawning at a crew spawn. */
  respawnTime: 5,
  /** Seconds of invulnerability after spawning (ends early if you shoot). */
  spawnProtection: 2,
} as const;

// ---- Hitboxes (relative to feet) --------------------------------------------
export const HITBOX = {
  /** Body capsule: sphere centers at bodyBottom / bodyTop above the feet. */
  bodyRadius: 0.36,
  bodyBottom: 0.36,
  bodyTop: 1.08,
  headRadius: 0.21,
  headCenter: 1.6,
  crouchBodyTop: 0.44,
  crouchHeadCenter: 0.94,
} as const;

// ---- Modes -------------------------------------------------------------------
export type ModeId = 'tdm' | 'turf' | 'porch';

export interface ModeConfig {
  id: ModeId;
  name: string;
  blurb: string;
  scoreLimit: number;
  /** Seconds. */
  timeLimit: number;
}

export const MODES: Record<ModeId, ModeConfig> = {
  tdm: {
    id: 'tdm',
    name: 'Team Deathmatch',
    blurb: 'First crew to 50 kills, or the most kills after 10 minutes.',
    scoreLimit: 50,
    timeLimit: 600,
  },
  turf: {
    id: 'turf',
    name: 'Gang Turf War',
    blurb: 'Hold the three turf zones to earn points. First crew to 200 wins.',
    scoreLimit: 200,
    timeLimit: 600,
  },
  porch: {
    id: 'porch',
    name: 'Jump Off the Porch',
    blurb: 'Everybody gotta jump off the porch someday. Only one makes it out.',
    scoreLimit: 0,
    // no clock: the riot ends it (see config/porch.ts)
    timeLimit: 3600,
  },
};

export const MODE_IDS: readonly ModeId[] = ['tdm', 'turf', 'porch'];
/** Crew-vs-crew modes (two teams, respawns). */
export const CLASSIC_MODES: readonly ModeId[] = ['tdm', 'turf'];

export const TURF = {
  /** Seconds for one uncontested player to flip a neutral zone. */
  captureTime: 6,
  /** Each extra teammate in the zone speeds capture up by this fraction. */
  extraPlayerBonus: 0.35,
  /** Capture progress lost per second when nobody is inside. */
  decayRate: 0.12,
  /** Every `pointInterval` seconds each held zone pays out 1 point. */
  pointInterval: 3,
  zoneHeight: 4,
} as const;

/** Seconds of "get ready" before a match goes live (players can look around but not move or shoot). */
export const WARMUP_SECONDS = 4;
/** Seconds the final scoreboard stays up before returning to the lobby. */
export const ENDED_SECONDS = 12;

// ---- Throwables --------------------------------------------------------------
export const THROW = {
  speed: 17,
  upBoost: 3.5,
  gravity: 20,
  radius: 0.12,
  bounce: 0.38,
  friction: 0.72,
  cooldown: 1.0,
  perLife: 2,
} as const;

export const GRENADE = {
  fuse: 2.4,
  radius: 7.5,
  maxDamage: 130,
  minDamage: 12,
  /** Damage multiplier when a wall is between the blast and the victim. */
  coverMult: 0.2,
} as const;

export const SMOKE = {
  fuse: 1.3,
  duration: 13,
  radius: 5.2,
} as const;

// ---- Networking ---------------------------------------------------------------
export const NET = {
  /** Max buffered input commands the server keeps per player. */
  maxQueuedInputs: 24,
  /** Max input commands simulated for one player in a single server tick. */
  maxInputsPerTick: 4,
  /** Furthest the client-reported camera may be from the player's head (anti-cheat clamp). */
  maxAimOriginDist: 5.5,
  defaultPort: 2567,
} as const;

export const ROOM_NAME = 'match';
export const INVITE_CODE_LENGTH = 6;
/** No 0/O/1/I/L so codes are easy to read out loud. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NAME_MAX_LENGTH = 16;

export function sanitizeName(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[^\p{L}\p{N} _\-.']/gu, '').replace(/\s+/g, ' ').trim();
  if (s.length > NAME_MAX_LENGTH) s = s.slice(0, NAME_MAX_LENGTH).trim();
  return s.length > 0 ? s : 'Player';
}
