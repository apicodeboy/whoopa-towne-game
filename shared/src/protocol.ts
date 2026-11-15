import type { TeamId } from './config/crews';
import type { ModeId } from './config/game';
import type { Loadout } from './config/weapons';
import { PSTATE_KEYS, makeInputCmd, type InputCmd } from './sim/player';

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
} as const;

/** Kill-feed weapon codes: 0..3 are WEAPON_IDS, then these. */
export const KILL_GRENADE = 10;
export const KILL_WORLD = 11;

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
} as const;

/** Held-item codes in snapshots: 0..3 = WEAPON_IDS, 4 = grenade, 5 = smoke. */
export const HELD_GRENADE = 4;
export const HELD_SMOKE = 5;

export interface RosterEntry {
  idx: number;
  name: string;
  team: TeamId;
  bot: boolean;
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
  };
}

// ---------------------------------------------------------------------------------------------
// Input commands on the wire: all integers so both sides reconstruct bit-identical floats.
// ---------------------------------------------------------------------------------------------
const ANGLE_Q = 10000;
const POS_Q = 100;
const AXIS_Q = 127;
export const INPUT_STRIDE = 11;

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
    c.buttons = int(raw[i + 5], 0, 255);
    c.slot = int(raw[i + 6], 0, 2);
    c.ox = int(raw[i + 7], -100000, 100000) / POS_Q;
    c.oy = int(raw[i + 8], -100000, 100000) / POS_Q;
    c.oz = int(raw[i + 9], -100000, 100000) / POS_Q;
    c.rt = int(raw[i + 10], 0, 0x7fffffff);
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
}

export interface MatchEndMsg {
  winner: number;
  scores: [number, number];
  /** Final stats per player. */
  players: Array<{ idx: number; name: string; team: TeamId; bot: boolean; kills: number; deaths: number; score: number }>;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Options sent when creating / joining a room. */
export interface JoinOptions {
  name?: string;
  mode?: ModeId;
  private?: boolean;
  loadout?: Loadout;
}
