import type { Appearance } from './config/appearance';
import type { TeamId } from './config/crews';
import type { ModeId } from './config/game';
import { HEAL_KINDS, type SquadMode } from './config/porch';
import type { Loadout } from './config/weapons';
import { BTN, PSTATE_KEYS, makeInputCmd, type InputCmd } from './sim/player';

/** Every input button bit. */
const BTN_MASK = Object.values(BTN).reduce((m, b) => m | b, 0);

// ---------------------------------------------------------------------------------------------
// Match events (sent inside snapshots). Every event is a flat number array: [type, ...payload].
// Positions are centimeters, angles milliradians.
// ---------------------------------------------------------------------------------------------
export const EV = {
  /** [SHOT, shooter, weaponIdx, ox,oy,oz, n, (ex,ey,ez,kind) x n] */
  SHOT: 1,
  /** [HIT, shooter, victim, damage, head, killed, srcX, srcZ] */
  HIT: 2,
  /** [KILL, killer, victim, weaponCode, head] (killer = victim for suicides, -1 for the world) */
  KILL: 3,
  /** [SPAWN, idx, x,y,z, yaw, primaryIdx, secondaryIdx, throwableIdx] */
  SPAWN: 4,
  /** [THROW, projId, owner, type, x,y,z, vx,vy,vz] */
  THROW: 5,
  /** [EXPLODE, projId, type, x,y,z] */
  EXPLODE: 6,
  /** [ZONE, zoneIdx, newOwner, prevOwner] */
  ZONE: 7,
  /** [PHASE, phase, winner] winner: -1 draw / none, else team */
  PHASE: 8,
  /** [RELOAD, idx] */
  RELOAD: 9,
  // ---- JUMP OFF THE PORCH ----
  /** [BAG_OPEN, bagId, idx] */
  BAG_OPEN: 20,
  /** [PICKUP_ADD, id, kind, code, count, x,y,z] (cm) */
  PICKUP_ADD: 21,
  /** [PICKUP_GONE, id, takenBy] */
  PICKUP_GONE: 22,
  /** [LOOT, idx, kind, code, count] something went into a player's inventory */
  LOOT: 23,
  /** [JUMP_OUT, idx] left the transport */
  JUMP_OUT: 24,
  /** [TOUCHDOWN, idx] balloon popped on landing */
  TOUCHDOWN: 25,
  /** [STAGE, stageIdx] the match moved to a new stage (see PorchSnap.stage) */
  STAGE: 26,
  /** [ELIM, victimIdx, place, squadEliminated(0/1)] knocked off the porch for good */
  ELIM: 27,
  /** [HEALED, idx, healKind] */
  HEALED: 28,
  // ---- buildings ----
  /** [DOOR, doorId, bits (1 open, 2 locked, 4 swings back), by] */
  DOOR: 30,
  /** [WINDOW, windowId, state (0 closed, 1 open, 2 broken), by] */
  WINDOW: 31,
  /** [DENIED, doorId, by] tried a locked door from outside */
  DENIED: 32,
  // ---- squad calls ----
  /** [MARK, idx, x, y, z] (cm) someone marked danger; only their squad (or crew) is sent it */
  MARK: 33,
} as const;

/** Kill-feed weapon codes: 0..5 are WEAPON_IDS, then these. */
// (clear of the weapon codes, which are WEAPON_IDS indices)
export const KILL_GRENADE = 40;
export const KILL_WORLD = 41;
export const KILL_RIOT = 42;

export const PHASE = { WARMUP: 0, PLAYING: 1, ENDED: 2 } as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

/** Player flag bits in snapshots. */
export const PF = {
  ALIVE: 1,
  CROUCH: 2,
  GROUND: 4,
  SPRINT: 8,
  AIM: 16,
  RELOAD: 32,
  PROTECTED: 64,
  /** On the transport (not in the world yet). */
  RIDING: 128,
  /** Hanging from a balloon. */
  BALLOON: 256,
  /** Using a healing item. */
  HEALING: 512,
  /** Skydiving out of the blimp (before the balloons go up). */
  SKYDIVE: 1024,
  /** Used the double jump (until landing). */
  AIRJUMP: 2048,
  /** Rolling (sprint + crouch). */
  ROLL: 4096,
  /** Pulling up onto a ledge. */
  CLIMB: 8192,
} as const;

/** Held-item codes in snapshots: WEAPON_IDS indices, then these. */
export const HELD_NONE = 31;
export const HELD_GRENADE = 32;
export const HELD_SMOKE = 33;

export interface RosterEntry {
  idx: number;
  name: string;
  team: TeamId;
  /** Who you fight alongside (JUMP OFF THE PORCH squads; the crew in other modes). */
  squad?: number;
  bot: boolean;
  /** Cosmetic look as a compact code (see encodeAppearance; absent from older servers). */
  look?: string;
}

export interface SnapPlayer {
  idx: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  hp: number;
  held: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
}
export const SNAP_PLAYER_STRIDE = 13;

export interface SnapZone {
  owner: number;
  capTeam: number;
  /** 0..1 */
  progress: number;
  contested: boolean;
}

/** A decoded world snapshot as the client consumes it. */
export interface Snapshot {
  /** Server time (ms). */
  t: number;
  phase: Phase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  scores: [number, number];
  zones: SnapZone[];
  players: SnapPlayer[];
  /** Last input sequence number the server has applied for the receiving player. */
  ack: number;
  /** Authoritative PlayerState of the receiving player (PSTATE_KEYS order), exact floats. */
  self: number[] | null;
  /** Life counter of the receiving player (changes on every respawn). */
  life: number;
  /** Milliseconds until the receiving player respawns (0 if alive). */
  respawnIn: number;
  events: number[][];
  /** JUMP OFF THE PORCH state (null in other modes). */
  porch: PorchSnap | null;
}

/** Battle royale match state carried by every snapshot. */
export interface PorchSnap {
  /** 0 pregame, 1 deployment, 2 early game, 3.. riot phases, then the ended stage. */
  stage: number;
  /** Seconds until the stage changes. */
  stageLeft: number;
  /** 1 while the riot is spreading (safe area shrinking), 0 while it gathers. */
  shrinking: boolean;
  /** Current safe area and the one the riot is heading for. */
  zone: { x: number; z: number; r: number };
  next: { x: number; z: number; r: number };
  alive: number;
  squadsAlive: number;
  /** Your final place once eliminated (0 while alive). */
  place: number;
  /** Damage you have dealt. */
  damage: number;
  /** Server time (ms) the transport took off. */
  takeoff: number;
}

/** Compact wire form of a snapshot. */
export interface WireSnapshot {
  t: number;
  /** [phase, timeLeft*10, score0, score1] */
  m: number[];
  /** per zone: owner+1, capTeam+1, progress*100 (+1000 if contested) */
  z: number[];
  /** SNAP_PLAYER_STRIDE ints per player */
  p: number[];
  a: number;
  s: number[] | null;
  l: number;
  r: number;
  e: number[][];
  /** JUMP OFF THE PORCH: [stage, stageLeft*10, shrinking, zx*10, zz*10, zr*10, nx*10, nz*10, nr*10, alive, squadsAlive, place, damage, takeoff] */
  b?: number[];
}

function decodePorch(b: number[] | undefined): PorchSnap | null {
  if (!b || b.length < 14) return null;
  return {
    stage: b[0], stageLeft: b[1] / 10, shrinking: b[2] === 1,
    zone: { x: b[3] / 10, z: b[4] / 10, r: b[5] / 10 },
    next: { x: b[6] / 10, z: b[7] / 10, r: b[8] / 10 },
    alive: b[9], squadsAlive: b[10], place: b[11], damage: b[12], takeoff: b[13],
  };
}

export function decodeSnapshot(w: WireSnapshot): Snapshot {
  const players: SnapPlayer[] = [];
  const p = w.p;
  for (let i = 0; i + SNAP_PLAYER_STRIDE <= p.length; i += SNAP_PLAYER_STRIDE) {
    players.push({
      idx: p[i],
      x: p[i + 1] / 100,
      y: p[i + 2] / 100,
      z: p[i + 3] / 100,
      yaw: p[i + 4] / 1000,
      pitch: p[i + 5] / 1000,
      flags: p[i + 6],
      hp: p[i + 7],
      held: p[i + 8],
      kills: p[i + 9],
      deaths: p[i + 10],
      score: p[i + 11],
      ping: p[i + 12],
    });
  }
  const zones: SnapZone[] = [];
  for (let i = 0; i + 3 <= w.z.length; i += 3) {
    const raw = w.z[i + 2];
    zones.push({ owner: w.z[i] - 1, capTeam: w.z[i + 1] - 1, progress: (raw % 1000) / 100, contested: raw >= 1000 });
  }
  return {
    t: w.t,
    phase: w.m[0] as Phase,
    timeLeft: w.m[1] / 10,
    scores: [w.m[2], w.m[3]],
    zones,
    players,
    ack: w.a,
    self: w.s && w.s.length === PSTATE_KEYS.length ? w.s : null,
    life: w.l,
    respawnIn: w.r,
    events: w.e ?? [],
    porch: decodePorch(w.b),
  };
}

// ---------------------------------------------------------------------------------------------
// Input commands on the wire: all integers so both sides reconstruct bit-identical floats.
// ---------------------------------------------------------------------------------------------
const ANGLE_Q = 10000;
const POS_Q = 100;
const AXIS_Q = 127;
export const INPUT_STRIDE = 12;

/**
 * Snaps a command to the wire precision in place. The client must do this BEFORE predicting,
 * so its prediction uses exactly the numbers the server will see.
 */
export function quantizeInput(c: InputCmd): InputCmd {
  c.mx = Math.round(Math.max(-1, Math.min(1, c.mx)) * AXIS_Q) / AXIS_Q;
  c.mz = Math.round(Math.max(-1, Math.min(1, c.mz)) * AXIS_Q) / AXIS_Q;
  c.yaw = Math.round(c.yaw * ANGLE_Q) / ANGLE_Q;
  c.pitch = Math.round(c.pitch * ANGLE_Q) / ANGLE_Q;
  c.ox = Math.round(c.ox * POS_Q) / POS_Q;
  c.oy = Math.round(c.oy * POS_Q) / POS_Q;
  c.oz = Math.round(c.oz * POS_Q) / POS_Q;
  c.rt = Math.round(c.rt);
  return c;
}

/** Appends a (quantized) command to a flat int array. */
export function encodeInput(c: InputCmd, out: number[]): number[] {
  out.push(
    c.seq,
    Math.round(c.mx * AXIS_Q),
    Math.round(c.mz * AXIS_Q),
    Math.round(c.yaw * ANGLE_Q),
    Math.round(c.pitch * ANGLE_Q),
    c.buttons,
    c.slot,
    Math.round(c.ox * POS_Q),
    Math.round(c.oy * POS_Q),
    Math.round(c.oz * POS_Q),
    c.rt,
    c.heal,
  );
  return out;
}

function int(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return n < lo ? lo : n > hi ? hi : n;
}

/** Decodes and validates a batch of commands from an untrusted client. */
export function decodeInputs(raw: unknown, max = 8): InputCmd[] {
  const out: InputCmd[] = [];
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i + INPUT_STRIDE <= raw.length && out.length < max; i += INPUT_STRIDE) {
    const c = makeInputCmd();
    c.seq = int(raw[i], 0, 0x7fffffff);
    c.mx = int(raw[i + 1], -AXIS_Q, AXIS_Q) / AXIS_Q;
    c.mz = int(raw[i + 2], -AXIS_Q, AXIS_Q) / AXIS_Q;
    c.yaw = int(raw[i + 3], -40000, 40000) / ANGLE_Q;
    c.pitch = int(raw[i + 4], -16000, 16000) / ANGLE_Q;
    // only known bits (a clamp would turn an out-of-range value into "every button held")
    c.buttons = int(raw[i + 5], 0, 0x7fffffff) & BTN_MASK;
    c.slot = int(raw[i + 6], 0, 3);
    c.ox = int(raw[i + 7], -100000, 100000) / POS_Q;
    c.oy = int(raw[i + 8], -100000, 100000) / POS_Q;
    c.oz = int(raw[i + 9], -100000, 100000) / POS_Q;
    c.rt = int(raw[i + 10], 0, 0x7fffffff);
    c.heal = int(raw[i + 11], 0, HEAL_KINDS.length);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Room messages
// ---------------------------------------------------------------------------------------------
export const MSG = {
  // client -> server
  INPUT: 'i',
  READY: 'ready',
  TEAM: 'team',
  LOADOUT: 'loadout',
  /** Character appearance (lobby only; it applies from the next match). */
  LOOK: 'look',
  START: 'start',
  /** Host of a private lobby ends the running match early. */
  END: 'endmatch',
  CONFIG: 'config',
  PING: 'ping',
  // server -> client
  SNAPSHOT: 's',
  MATCH_START: 'match',
  MATCH_END: 'end',
  ROSTER: 'roster',
  PONG: 'pong',
  NOTICE: 'notice',
} as const;

/** Sent to each client when the match begins. */
export interface MatchStartMsg {
  mode: ModeId;
  /** Your player index in snapshots. */
  you: number;
  roster: RosterEntry[];
  /** Server time (ms) when this message was sent. */
  t: number;
  /** JUMP OFF THE PORCH: the static layout of this match (bags, transport route) and its current state. */
  porch?: PorchInit;
  /** Doors and windows as they are right now (see Buildings.encode). */
  bld?: number[];
}

/** What a client needs to draw a battle royale match it is joining (or rejoining). */
export interface PorchInit {
  squads: SquadMode;
  /** Transport route (meters), altitude, speed (m/s). Take-off time comes with snapshots. */
  route: [number, number, number, number];
  altitude: number;
  speed: number;
  /** Bookbags: [id, x*100, y*100, z*100, yaw*1000, variant, opened] per bag. */
  bags: number[];
  /** Items on the ground: [id, kind, code, count, x*100, y*100, z*100] per item. */
  pickups: number[];
}

export interface StandingRow {
  idx: number;
  name: string;
  team: TeamId;
  bot: boolean;
  kills: number;
  deaths: number;
  score: number;
  /** JUMP OFF THE PORCH extras. */
  squad?: number;
  place?: number;
  damage?: number;
  /** Seconds survived. */
  survived?: number;
}

export interface MatchEndMsg {
  /** Winning crew, or (JUMP OFF THE PORCH) winning squad. -1 = draw. */
  winner: number;
  scores: [number, number];
  /** Final stats per player. */
  players: StandingRow[];
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Options sent when creating / joining a room. */
export interface JoinOptions {
  name?: string;
  mode?: ModeId;
  private?: boolean;
  loadout?: Loadout;
  /** Character look: a wire code (or, from older clients, an appearance object). */
  look?: string | Appearance;
  /** JUMP OFF THE PORCH team size. */
  squads?: SquadMode;
  /** Account session (GRAMS / AJ's / TRAP): signed-in players get their name and owned cosmetics. */
  token?: string;
}

// ---------------------------------------------------------------------------------------------
// Live scores (billboards)
// ---------------------------------------------------------------------------------------------
/** One game on the scoreboard billboards (served by the game server at /api/scores). */
export interface ScoreGame {
  /** 'NBA', 'NFL', ... */
  league: string;
  away: string;
  home: string;
  /** Scores as shown ('' before the game starts). */
  awayScore: string;
  homeScore: string;
  /** 'Final', 'Q3 5:12', '7:30 PM ET' ... */
  status: string;
  /** Not started, being played, over. */
  state: 'pre' | 'in' | 'post';
}

export interface ScoresMsg {
  games: ScoreGame[];
  /** When the feed was last read (ms since epoch), 0 if it never has been. */
  at: number;
}
