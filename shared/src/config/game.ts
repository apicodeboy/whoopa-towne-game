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
  /** A second jump in mid-air (once per time off the ground). */
  airJumps: 1,
  doubleJumpVelocity: 6.8,
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

// ---- Moves: roll, ledge grab -------------------------------------------------
/** Crouch while sprinting: a quick forward roll (low, fast, can't shoot), then back up. */
export const ROLL = {
  time: 0.62,
  /** Speed at the start of the roll, easing to `endSpeed`. */
  speed: 9.2,
  endSpeed: 5.4,
  /** Seconds before you can roll again. */
  cooldown: 0.35,
} as const;

/**
 * Jumping at a wall whose top is within arm's reach grabs the edge and pulls you up onto it.
 * Only when close: the edge must be `minUp`..`maxUp` above your feet and the wall right in front.
 */
export const LEDGE = {
  minUp: 0.95,
  maxUp: 2.3,
  /** How far in front of your body the wall can be. */
  reach: 0.5,
  /** Seconds the pull-up takes. */
  time: 0.55,
} as const;

/** Climbing through a window (jump at it while moving toward it). */
export const VAULT = {
  /** How far in front of your body the sill can be. */
  reach: 0.55,
  /** The deepest wall you can climb through. */
  depth: 0.9,
  /** Sill height above your feet. */
  minSill: 0.2,
  maxSill: 1.25,
  /** The tallest opening that still counts as a window (taller ones you just jump through). */
  maxOpening: 2.2,
  /** The furthest the floor on the other side can be below the sill and still be landed on. */
  maxDrop: 6,
  /** Seconds it takes. */
  time: 0.5,
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
/** Marking danger: how often, how far, and how long a mark stays up (on the clients). */
export const MARK = {
  cooldown: 0.75,
  range: 320,
  life: 10,
} as const;

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

/** Player names (people and bots alike): letters and numbers only, no spaces, up to 12. */
export const NAME_MAX_LENGTH = 12;
export const NAME_PATTERN = /^[A-Za-z0-9]{1,12}$/;

export function sanitizeName(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[^A-Za-z0-9]/g, '');
  if (s.length > NAME_MAX_LENGTH) s = s.slice(0, NAME_MAX_LENGTH);
  return s.length > 0 ? s : 'Player';
}
