import { LEDGE, PLAYER, ROLL, THROW, VAULT } from '../config/game';
import { HEAL_KINDS, PORCH } from '../config/porch';
import {
  SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY, SLOT_THROWABLE, THROWABLE_IDS, WEAPONS, WEAPON_IDS,
  type AmmoType, type Loadout, type WeaponDef, type WeaponId,
} from '../config/weapons';
import type { SpawnPoint } from '../map/types';
import { clamp } from '../math';
import { Q_PROJECTILE, Q_SOLID, type MoveResult, type PhysicsWorld } from './physics';

/** Input button bitmask. */
export const BTN = {
  JUMP: 1,
  SPRINT: 2,
  CROUCH: 4,
  FIRE: 8,
  AIM: 16,
  RELOAD: 32,
  THROW: 64,
  /** Search a bookbag / pick something up (JUMP OFF THE PORCH). */
  USE: 128,
  /** Use a healing item. */
  HEAL: 256,
  /** Drop the weapon in hand. */
  DROP: 512,
  /** Roll (crouch pressed while sprinting). */
  ROLL: 1024,
  /** Mark danger where you are looking (your squad sees it). */
  MARK: 2048,
} as const;

/** PlayerState.air: on the ground, riding the transport, or hanging from a balloon. */
export const AIR_GROUND = 0;
export const AIR_RIDING = 1;
export const AIR_BALLOON = 2;
/** Free fall straight out of the blimp (the balloons go up later). */
export const AIR_SKYDIVE = 3;

/** One tick of player intent. The client predicts with it and the server replays it. */
export interface InputCmd {
  /** Monotonic sequence number (acked by the server for reconciliation). */
  seq: number;
  /** Strafe (-1 left .. 1 right) and forward (-1 back .. 1 forward). */
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** Weapon slot the player wants out (0 primary, 1 secondary / handgun, 2 throwable, 3 second primary). */
  slot: number;
  /** Camera position: third-person shots aim from the camera, then fire from the body. */
  ox: number;
  oy: number;
  oz: number;
  /** Server time the client was rendering other players at (for lag compensation). */
  rt: number;
  /** Which healing item HEAL uses: HEAL_KINDS index + 1 (picked from the weapon wheel), 0 = the best one for the moment. */
  heal: number;
}

export function makeInputCmd(): InputCmd {
  return { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, ox: 0, oy: 0, oz: 0, rt: 0, heal: 0 };
}

export function copyInputCmd(dst: InputCmd, src: InputCmd): InputCmd {
  dst.seq = src.seq; dst.mx = src.mx; dst.mz = src.mz; dst.yaw = src.yaw; dst.pitch = src.pitch;
  dst.buttons = src.buttons; dst.slot = src.slot; dst.ox = src.ox; dst.oy = src.oy; dst.oz = src.oz; dst.rt = src.rt; dst.heal = src.heal;
  return dst;
}

/**
 * Everything about a player that the client predicts. All fields are plain numbers
 * (booleans are 0/1) so the state can be copied, compared and sent over the wire generically.
 */
export interface PlayerState {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: number;
  crouching: number;
  sprinting: number;
  aiming: number;
  slot: number;
  /** Rounds in the magazine / in reserve for the primary (0) and secondary (1). */
  mag0: number;
  mag1: number;
  res0: number;
  res1: number;
  throwables: number;
  /** Seconds until the weapon can fire again. */
  fireCd: number;
  /** Seconds left on the current reload (0 = not reloading). */
  reloadT: number;
  /** Seconds left raising the weapon after a swap. */
  swapT: number;
  throwCd: number;
  /** Extra spread (degrees) built up by sustained fire. */
  bloom: number;
  /** Total shots fired; seeds the per-shot spread RNG identically on client and server. */
  shots: number;
  /** Was FIRE / JUMP / THROW / HEAL held last tick (edge detection). */
  trig: number;
  jumpHeld: number;
  throwHeld: number;
  healHeld: number;

  // ---- what is carried (classic modes fill it from the loadout on spawn) ----
  /** Weapon in the primary, second primary and handgun slots: WEAPON_IDS index + 1 (0 = empty: fists). */
  wA: number;
  wB: number;
  wH: number;
  /** Throwable type: THROWABLE_IDS index + 1 (0 = none). */
  thr: number;
  /** Magazine of the second primary. */
  magB: number;
  /** 1 = reserves come from the shared ammo pools below (JUMP OFF THE PORCH), 0 = res0 / res1. */
  pool: number;
  ammoL: number;
  ammoM: number;
  ammoS: number;
  ammoH: number;
  bandages: number;
  medkits: number;
  drinks: number;
  /** Seconds left using a healing item, and which one (HEAL_KINDS index). */
  healT: number;
  healKind: number;

  // ---- JUMP OFF THE PORCH ----
  /** AIR_GROUND / AIR_RIDING / AIR_BALLOON / AIR_SKYDIVE. */
  air: number;
  /** Wind pushing balloons this match (m/s). */
  windX: number;
  windZ: number;
  /** 1 while caught in the riot (slows you down). */
  riot: number;
  /** Mirrors of the server's health and armor (so healing choices predict exactly). */
  hp: number;
  armor: number;
  /** Seconds spent in free fall (skydiving). */
  airT: number;
  /** Jumps used up in the air since leaving the ground (the double jump). */
  airJumps: number;
  /** Rolling: seconds left (> 0), or the cooldown still running (< 0). Roll direction (unit). */
  rollT: number;
  rollX: number;
  rollZ: number;
  /** Pulling up onto a ledge: seconds left, where it started and where it ends (feet). */
  climbT: number;
  climbAX: number;
  climbAY: number;
  climbAZ: number;
  climbBX: number;
  climbBY: number;
  climbBZ: number;
  /** Climbing through a window (a vault): the height the feet go over (0 for a ledge pull-up). */
  climbH: number;
  /** Perc 29 bottles carried (each one taken fills your armor). */
  pills: number;
  /** What you swing with a gun slot empty: WEAPON_IDS index + 1 (0 = hands). */
  wM: number;
  /** Mirror of the server's health still building up from an orange (for the HUD and choices). */
  regen: number;
}

export const PSTATE_KEYS: ReadonlyArray<keyof PlayerState> = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch',
  'grounded', 'crouching', 'sprinting', 'aiming', 'slot',
  'mag0', 'mag1', 'res0', 'res1', 'throwables',
  'fireCd', 'reloadT', 'swapT', 'throwCd', 'bloom', 'shots',
  'trig', 'jumpHeld', 'throwHeld', 'healHeld',
  'wA', 'wB', 'wH', 'thr', 'magB', 'pool', 'ammoL', 'ammoM', 'ammoS', 'ammoH',
  'bandages', 'medkits', 'drinks', 'healT', 'healKind',
  'air', 'windX', 'windZ', 'riot', 'hp', 'armor', 'airT', 'airJumps',
  'rollT', 'rollX', 'rollZ', 'climbT', 'climbAX', 'climbAY', 'climbAZ', 'climbBX', 'climbBY', 'climbBZ', 'climbH',
  'pills', 'wM', 'regen',
];

export function makePlayerState(): PlayerState {
  const s = {} as PlayerState;
  for (const k of PSTATE_KEYS) s[k] = 0;
  return s;
}

export function copyPlayerState(dst: PlayerState, src: PlayerState): PlayerState {
  for (let i = 0; i < PSTATE_KEYS.length; i++) {
    const k = PSTATE_KEYS[i];
    dst[k] = src[k];
  }
  return dst;
}

export function playerStateToArray(s: PlayerState, out: number[] = []): number[] {
  for (let i = 0; i < PSTATE_KEYS.length; i++) out[i] = s[PSTATE_KEYS[i]];
  out.length = PSTATE_KEYS.length;
  return out;
}

export function playerStateFromArray(arr: ArrayLike<number>, out: PlayerState): PlayerState {
  for (let i = 0; i < PSTATE_KEYS.length; i++) out[PSTATE_KEYS[i]] = +arr[i] || 0;
  return out;
}

/** Largest difference worth correcting between a predicted state and the server's. */
export function playerStateDiffers(a: PlayerState, b: PlayerState): boolean {
  if (Math.abs(a.x - b.x) > 0.005 || Math.abs(a.y - b.y) > 0.005 || Math.abs(a.z - b.z) > 0.005) return true;
  if (Math.abs(a.vx - b.vx) > 0.01 || Math.abs(a.vy - b.vy) > 0.01 || Math.abs(a.vz - b.vz) > 0.01) return true;
  if (a.grounded !== b.grounded || a.crouching !== b.crouching || a.slot !== b.slot) return true;
  if (a.mag0 !== b.mag0 || a.mag1 !== b.mag1 || a.res0 !== b.res0 || a.res1 !== b.res1) return true;
  if (a.throwables !== b.throwables || a.shots !== b.shots) return true;
  if (a.wA !== b.wA || a.wB !== b.wB || a.wH !== b.wH || a.thr !== b.thr || a.magB !== b.magB || a.air !== b.air) return true;
  if (a.ammoL !== b.ammoL || a.ammoM !== b.ammoM || a.ammoS !== b.ammoS || a.ammoH !== b.ammoH) return true;
  if (a.bandages !== b.bandages || a.medkits !== b.medkits || a.drinks !== b.drinks || a.pills !== b.pills || a.riot !== b.riot) return true;
  if (Math.abs(a.healT - b.healT) > 1e-4 || a.hp !== b.hp || a.armor !== b.armor) return true;
  if (Math.abs(a.fireCd - b.fireCd) > 1e-4 || Math.abs(a.reloadT - b.reloadT) > 1e-4) return true;
  if (Math.abs(a.swapT - b.swapT) > 1e-4 || Math.abs(a.throwCd - b.throwCd) > 1e-4) return true;
  if (Math.abs(a.bloom - b.bloom) > 1e-3) return true;
  if (Math.abs(a.rollT - b.rollT) > 1e-4 || Math.abs(a.climbT - b.climbT) > 1e-4) return true;
  return false;
}

/** Resets a state for a fresh life at a spawn point. `shots` keeps counting across lives. */
export function spawnPlayerState(s: PlayerState, spawn: SpawnPoint, loadout: Loadout): void {
  const shots = s.shots;
  for (const k of PSTATE_KEYS) s[k] = 0;
  s.shots = shots;
  s.x = spawn.x;
  s.y = spawn.y + 0.05;
  s.z = spawn.z;
  s.yaw = spawn.yaw;
  s.grounded = 1;
  s.slot = SLOT_PRIMARY;
  const p = WEAPONS[loadout.primary];
  const q = WEAPONS[loadout.secondary];
  s.wA = weaponCode(loadout.primary);
  s.wH = weaponCode(loadout.secondary);
  s.wM = loadout.melee && loadout.melee !== 'fists' ? weaponCode(loadout.melee) : 0;
  s.thr = THROWABLE_IDS.indexOf(loadout.throwable) + 1;
  s.mag0 = p.magSize;
  s.res0 = p.reserve;
  s.mag1 = q.magSize;
  s.res1 = q.reserve;
  s.throwables = THROW.perLife;
  s.hp = PLAYER.maxHealth;
}

/** Slot code for a weapon id (WEAPON_IDS index + 1). */
export function weaponCode(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id) + 1;
}

/** The weapon in a slot (fists when a gun slot is empty, null for the throwable slot). */
export function weaponInSlot(s: PlayerState, slot: number): WeaponDef | null {
  const code = slot === SLOT_PRIMARY ? s.wA : slot === SLOT_SECONDARY ? s.wH : slot === SLOT_PRIMARY_B ? s.wB : -1;
  if (code < 0) return null;
  // an empty gun slot: whatever you swing (hands, or the knife from your loadout)
  const melee = s.wM > 0 ? WEAPONS[WEAPON_IDS[s.wM - 1]] ?? WEAPONS.fists : WEAPONS.fists;
  return code > 0 ? WEAPONS[WEAPON_IDS[code - 1]] ?? melee : melee;
}

/** Rounds in a slot's magazine. */
export function magOf(s: PlayerState, slot: number): number {
  return slot === SLOT_PRIMARY ? s.mag0 : slot === SLOT_SECONDARY ? s.mag1 : slot === SLOT_PRIMARY_B ? s.magB : 0;
}

export function setMag(s: PlayerState, slot: number, v: number): void {
  if (slot === SLOT_PRIMARY) s.mag0 = v;
  else if (slot === SLOT_SECONDARY) s.mag1 = v;
  else if (slot === SLOT_PRIMARY_B) s.magB = v;
}

/** PlayerState field holding an ammo family's pool. */
export function ammoField(type: AmmoType): 'ammoL' | 'ammoM' | 'ammoS' | 'ammoH' | null {
  return type === 'light' ? 'ammoL' : type === 'medium' ? 'ammoM' : type === 'shells' ? 'ammoS' : type === 'heavy' ? 'ammoH' : null;
}

/** Spare rounds available for the weapon in a slot. */
export function reserveOf(s: PlayerState, slot: number): number {
  const w = weaponInSlot(s, slot);
  if (!w || w.magSize === 0) return 0;
  if (s.pool) {
    const f = ammoField(w.ammo);
    return f ? s[f] : 0;
  }
  return slot === SLOT_PRIMARY ? s.res0 : slot === SLOT_SECONDARY ? s.res1 : 0;
}

function setReserve(s: PlayerState, slot: number, v: number): void {
  if (s.pool) {
    const w = weaponInSlot(s, slot);
    const f = w ? ammoField(w.ammo) : null;
    if (f) s[f] = v;
  } else if (slot === SLOT_PRIMARY) s.res0 = v;
  else if (slot === SLOT_SECONDARY) s.res1 = v;
}

/** How many of a healing item (HEAL_KINDS index) are carried. */
export function healCount(s: PlayerState, kind: number): number {
  switch (HEAL_KINDS[kind]) {
    case 'bandage': return s.bandages;
    case 'medkit': return s.medkits;
    case 'drink': return s.drinks;
    case 'ibuprofen': return s.pills;
    default: return 0;
  }
}

/** Whether a healing item would do anything right now (carried, and not already topped up). */
export function canHeal(s: PlayerState, kind: number): boolean {
  const k = HEAL_KINDS[kind];
  if (!k || healCount(s, kind) <= 0) return false;
  const h = PORCH.heals[k];
  if (h.armor) return s.armor < Math.min(h.cap, PORCH.maxArmor);
  // an orange is not worth eating while the last one's health is still coming
  return (h.slow > 0 ? s.hp + s.regen : s.hp) < Math.min(h.cap, PLAYER.maxHealth);
}

/**
 * Which healing item HEAL uses right now (HEAL_KINDS index), or -1. `want` is the one picked
 * on the weapon wheel; otherwise health comes first, then Perc 29 fills the armor.
 */
export function pickHeal(s: PlayerState, want = -1): number {
  if (want >= 0) return canHeal(s, want) ? want : -1;
  const B = HEAL_KINDS.indexOf('bandage'), M = HEAL_KINDS.indexOf('medkit'), D = HEAL_KINDS.indexOf('drink'), I = HEAL_KINDS.indexOf('ibuprofen');
  if (s.hp < PLAYER.maxHealth) {
    if (s.hp < 50 && s.medkits > 0) return M;
    if (canHeal(s, B)) return B;
    if (canHeal(s, D)) return D;
    if (s.medkits > 0) return M;
  }
  return canHeal(s, I) ? I : -1;
}

/** Things that happened during a step. The server turns them into hits/events, the client into effects. */
export interface StepActions {
  shot: boolean;
  /** Seed for this shot's spread pattern. */
  shotSeed: number;
  /** Spread cone half-angle in degrees at the moment of the shot. */
  shotSpread: number;
  /** Slot the shot was fired from. */
  shotSlot: number;
  threw: boolean;
  reloadStart: boolean;
  reloadDone: boolean;
  dryFire: boolean;
  jumped: boolean;
  landed: boolean;
  /** Downward speed at the moment of landing (m/s). */
  landSpeed: number;
  swapped: boolean;
  /** Finished using a healing item this step (HEAL_KINDS index, -1 = none). */
  healed: number;
  healStart: boolean;
  /** Let go of HEAL (or fired) before the item was done. */
  healCanceled: boolean;
  /** Started a roll / grabbed a ledge this tick. */
  rolled: boolean;
  climbed: boolean;
  /** Touched down from a balloon (or straight out of a skydive) this step. */
  touchdown: boolean;
  /** The balloons went up this step (end of the skydive). */
  deployed: boolean;
  /** Jumped again in mid-air this step. */
  doubleJumped: boolean;
}

export function makeStepActions(): StepActions {
  return {
    shot: false, shotSeed: 0, shotSpread: 0, shotSlot: 0, threw: false,
    reloadStart: false, reloadDone: false, dryFire: false,
    jumped: false, landed: false, landSpeed: 0, swapped: false,
    healed: -1, healStart: false, healCanceled: false, rolled: false, climbed: false, touchdown: false, deployed: false, doubleJumped: false,
  };
}

function resetActions(a: StepActions): void {
  a.shot = false; a.shotSeed = 0; a.shotSpread = 0; a.shotSlot = 0; a.threw = false;
  a.reloadStart = false; a.reloadDone = false; a.dryFire = false;
  a.jumped = false; a.landed = false; a.landSpeed = 0; a.swapped = false;
  a.healed = -1; a.healStart = false; a.healCanceled = false; a.rolled = false; a.climbed = false; a.touchdown = false; a.deployed = false; a.doubleJumped = false;
}

export function eyeHeight(crouching: number | boolean): number {
  return crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
}

/** Current hip/aim spread cone (degrees, half-angle) including movement and bloom. */
export function currentSpread(s: PlayerState, w: WeaponDef): number {
  let sp = s.aiming ? w.spreadAim : w.spreadHip;
  const speed = Math.hypot(s.vx, s.vz);
  sp += w.spreadMove * Math.min(1, speed / PLAYER.walkSpeed) * (s.aiming ? 0.5 : 1);
  if (!s.grounded) sp += w.spreadAir;
  if (s.crouching && s.grounded) sp *= 0.8;
  return sp + s.bloom;
}

/** Top movement speed for the current stance. */
export function targetSpeed(s: PlayerState, w: WeaponDef | null): number {
  let speed: number = s.crouching ? PLAYER.crouchSpeed : s.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  if (s.aiming) speed = Math.min(speed, PLAYER.aimSpeed);
  if (s.riot) speed *= PORCH.riotSlow;
  if (s.healT > 0) speed *= PORCH.healSlow;
  return speed * (w ? w.moveMult : 1);
}

/**
 * Hanging from a balloon: sink slowly (faster holding crouch), steer with the move keys,
 * drift with the wind, stay over the town. Touching anything solid underneath lands you.
 */
function stepBalloon(s: PlayerState, cmd: InputCmd, dt: number, phys: PhysicsWorld, act: StepActions, frozen: boolean): void {
  const B = PORCH.balloon;
  let mx = frozen ? 0 : clamp(cmd.mx, -1, 1);
  let mz = frozen ? 0 : clamp(cmd.mz, -1, 1);
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
  const wishX = (cosY * mx - sinY * mz) * B.steerSpeed + s.windX;
  const wishZ = (-sinY * mx - cosY * mz) * B.steerSpeed + s.windZ;
  const k = Math.min(1, B.steerAccel * dt / B.steerSpeed * 2);
  s.vx += (wishX - s.vx) * k;
  s.vz += (wishZ - s.vz) * k;
  const dive = !frozen && (cmd.buttons & BTN.CROUCH) !== 0;
  const wantVy = -(dive ? B.diveSpeed : B.fallSpeed);
  s.vy += (wantVy - s.vy) * Math.min(1, dt * 3);
  s.crouching = 0;
  s.sprinting = 0;
  s.aiming = 0;
  phys.moveCharacter(s.x, s.y, s.z, s.vx * dt, s.vy * dt, s.vz * dt, false, mv);
  _over.x = mv.x;
  _over.z = mv.z;
  phys.keepOver(_over, 1);
  s.x = _over.x;
  s.y = mv.y;
  s.z = _over.z;
  if (mv.grounded) {
    act.landed = true;
    act.landSpeed = -s.vy;
    act.touchdown = true;
    s.air = AIR_GROUND;
    s.grounded = 1;
    s.vy = 0;
    s.vx *= 0.4;
    s.vz *= 0.4;
  } else {
    s.grounded = 0;
  }
}

const _over = { x: 0, z: 0 };

/**
 * Skydiving: fall fast (faster holding crouch), fly over the town with the move keys, and
 * the balloons go up by themselves near the ground (or sooner on jump). Hitting something
 * on the way down just lands you.
 */
function stepSkydive(s: PlayerState, cmd: InputCmd, dt: number, phys: PhysicsWorld, act: StepActions, frozen: boolean): void {
  const D = PORCH.skydive;
  let mx = frozen ? 0 : clamp(cmd.mx, -1, 1);
  let mz = frozen ? 0 : clamp(cmd.mz, -1, 1);
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
  const wishX = (cosY * mx - sinY * mz) * D.steerSpeed + s.windX * 0.5;
  const wishZ = (-sinY * mx - cosY * mz) * D.steerSpeed + s.windZ * 0.5;
  const k = Math.min(1, (D.steerAccel * dt) / D.steerSpeed * 2);
  s.vx += (wishX - s.vx) * k;
  s.vz += (wishZ - s.vz) * k;
  const dive = !frozen && (cmd.buttons & BTN.CROUCH) !== 0;
  const top = dive ? D.diveSpeed : D.fallSpeed;
  s.vy = Math.max(-top, s.vy - D.gravity * dt);
  if (s.vy < -top) s.vy = -top;
  s.crouching = 0;
  s.sprinting = 0;
  s.aiming = 0;
  s.airT += dt;
  phys.moveCharacter(s.x, s.y, s.z, s.vx * dt, s.vy * dt, s.vz * dt, false, mv);
  _over.x = mv.x;
  _over.z = mv.z;
  phys.keepOver(_over, 1);
  s.x = _over.x;
  s.y = mv.y;
  s.z = _over.z;
  if (mv.grounded) {
    act.landed = true;
    act.landSpeed = -s.vy;
    act.touchdown = true;
    s.air = AIR_GROUND;
    s.grounded = 1;
    s.vy = 0;
    s.vx *= 0.3;
    s.vz *= 0.3;
    return;
  }
  s.grounded = 0;
  // balloons up: near the ground, or on a fresh jump press after a moment of free fall
  const jump = !frozen && (cmd.buttons & BTN.JUMP) !== 0 && !s.jumpHeld;
  const below = phys.raycast(s.x, s.y, s.z, 0, -1, 0, D.deployHeight, Q_PROJECTILE);
  if (below >= 0 || (jump && s.airT >= D.minFreefall)) {
    s.air = AIR_BALLOON;
    act.deployed = true;
  }
}

const mv: MoveResult = { x: 0, y: 0, z: 0, grounded: false };

/**
 * Looks for an edge to grab right in front: a wall at chest height within reach, whose top is
 * between LEDGE.minUp and LEDGE.maxUp above the feet with room to stand on it. Starts the
 * pull-up when there is one.
 */
function tryGrabLedge(s: PlayerState, phys: PhysicsWorld, sinY: number, cosY: number, act: StepActions): void {
  const fx = -sinY, fz = -cosY;
  const wall = phys.raycast(s.x, s.y + 1.15, s.z, fx, 0, fz, PLAYER.radius + LEDGE.reach, Q_SOLID);
  if (wall < 0) return;
  // straight down just past the face of the wall, from above the highest grabbable edge
  const px = s.x + fx * (wall + 0.25), pz = s.z + fz * (wall + 0.25);
  const from = s.y + LEDGE.maxUp + 0.35;
  const down = phys.raycast(px, from, pz, 0, -1, 0, LEDGE.maxUp + 0.35 - LEDGE.minUp, Q_SOLID);
  if (down <= 0.02) return; // no edge in reach (or the wall goes higher than that)
  const top = from - down;
  // stand a body-width past the edge, with room to stand and nothing over our head on the way up
  const tx = s.x + fx * (wall + PLAYER.radius + 0.12), tz = s.z + fz * (wall + PLAYER.radius + 0.12);
  // (cheap rays first; the body-sized test only when everything else says yes)
  if (phys.raycast(s.x, s.y + 1.5, s.z, 0, 1, 0, Math.max(0.1, top + PLAYER.height - (s.y + 1.5)), Q_SOLID) >= 0) return;
  if (phys.raycast(tx, top + 0.05, tz, 0, 1, 0, PLAYER.height, Q_SOLID) >= 0) return;
  if (!phys.canStandAt(tx, top + 0.03, tz)) return;
  s.climbT = LEDGE.time;
  s.climbAX = s.x; s.climbAY = s.y; s.climbAZ = s.z;
  s.climbBX = tx; s.climbBY = top + 0.03; s.climbBZ = tz;
  s.vx = s.vy = s.vz = 0;
  s.reloadT = 0;
  s.healT = 0;
  act.climbed = true;
}

/**
 * Climbing through an opening in front: something at knee height (a window sill), open space
 * above it at chest height, a lintel overhead (so it is a window, not a low wall to jump), and
 * room to stand on the far side. Starts the vault when all of that holds.
 */
function tryVault(s: PlayerState, phys: PhysicsWorld, sinY: number, cosY: number, act: StepActions): boolean {
  const fx = -sinY, fz = -cosY;
  // (low, so it also finds the sill when you are already perched on its edge)
  const knee = phys.raycast(s.x, s.y + 0.15, s.z, fx, 0, fz, PLAYER.radius + VAULT.reach, Q_PROJECTILE);
  if (knee < 0) return false;
  if (phys.raycast(s.x, s.y + 1.25, s.z, fx, 0, fz, knee + VAULT.depth + 0.6, Q_PROJECTILE) >= 0) return false;
  // the sill top, just past the face of the wall
  const px = s.x + fx * (knee + 0.06), pz = s.z + fz * (knee + 0.06);
  const d = phys.raycast(px, s.y + 1.2, pz, 0, -1, 0, 1.2, Q_PROJECTILE);
  if (d < 0) return false;
  const sill = s.y + 1.2 - d;
  if (sill < s.y + VAULT.minSill || sill > s.y + VAULT.maxSill) return false;
  // a lintel overhead: an opening you could not simply jump through
  if (phys.raycast(px, sill + 0.05, pz, 0, 1, 0, VAULT.maxOpening, Q_PROJECTILE) < 0) return false;
  // the far face of the wall: back toward us from beyond it, at knee height
  const reachBack = knee + VAULT.depth;
  const bx0 = s.x + fx * reachBack, bz0 = s.z + fz * reachBack;
  const back = phys.raycast(bx0, sill - 0.15, bz0, -fx, 0, -fz, VAULT.depth, Q_PROJECTILE);
  if (back <= 0.05) return false; // solid all the way (or something right behind it)
  const far = reachBack - back;
  const tx = s.x + fx * (far + PLAYER.radius + 0.15), tz = s.z + fz * (far + PLAYER.radius + 0.15);
  // the floor over there (a balcony, a fire escape, the street, or a drop)
  const down = phys.raycast(tx, sill + 0.3, tz, 0, -1, 0, VAULT.maxDrop + 0.3, Q_PROJECTILE);
  let ty = down >= 0 ? sill + 0.3 - down : sill + 0.05;
  if (ty > sill + 0.1) return false;
  // a long way down: come out at sill height and fall from there
  if (ty < sill - 1.2) ty = sill + 0.05;
  if (!phys.canStandAt(tx, ty + 0.02, tz)) return false;
  s.climbT = VAULT.time;
  s.climbH = sill + 0.08;
  s.climbAX = s.x; s.climbAY = s.y; s.climbAZ = s.z;
  s.climbBX = tx; s.climbBY = ty + 0.02; s.climbBZ = tz;
  s.vx = s.vy = s.vz = 0;
  s.reloadT = 0;
  s.healT = 0;
  act.climbed = true;
  return true;
}

/**
 * Advances one player by one fixed tick. Pure function of (state, input, static world):
 * the client runs it to predict, the server runs it for the truth, and both get the
 * same answer.
 *
 * @param frozen  warm-up / match over: the player may look around but not move or shoot.
 */
export function stepPlayer(
  s: PlayerState, cmd: InputCmd, dt: number,
  phys: PhysicsWorld, _loadout: Loadout, act: StepActions, frozen = false,
): void {
  resetActions(act);

  s.yaw = cmd.yaw;
  s.pitch = clamp(cmd.pitch, -PLAYER.maxPitch, PLAYER.maxPitch);

  // on the transport the server carries you; hanging from a balloon is its own movement
  if (s.air === AIR_RIDING) {
    s.jumpHeld = (cmd.buttons & BTN.JUMP) !== 0 ? 1 : 0;
    return;
  }
  if (s.air === AIR_SKYDIVE) {
    stepSkydive(s, cmd, dt, phys, act, frozen);
    s.jumpHeld = (cmd.buttons & BTN.JUMP) !== 0 ? 1 : 0;
    s.trig = (cmd.buttons & BTN.FIRE) !== 0 ? 1 : 0;
    return;
  }
  if (s.air === AIR_BALLOON) {
    stepBalloon(s, cmd, dt, phys, act, frozen);
    s.jumpHeld = (cmd.buttons & BTN.JUMP) !== 0 ? 1 : 0;
    s.trig = (cmd.buttons & BTN.FIRE) !== 0 ? 1 : 0;
    return;
  }

  // ---- pulling up onto a ledge: up the wall first, then over the edge ----------
  if (s.climbT > 0) {
    s.climbT = Math.max(0, s.climbT - dt);
    const ease = (k: number) => k * k * (3 - 2 * k);
    if (s.climbH > 0) {
      // through a window: up onto the sill, across, down the other side
      const t = 1 - s.climbT / VAULT.time;
      const over = ease(Math.min(1, Math.max(0, (t - 0.12) / 0.76)));
      s.x = s.climbAX + (s.climbBX - s.climbAX) * over;
      s.z = s.climbAZ + (s.climbBZ - s.climbAZ) * over;
      s.y = t < 0.4 ? s.climbAY + (s.climbH - s.climbAY) * ease(t / 0.4)
        : t < 0.62 ? s.climbH
        : s.climbH + (s.climbBY - s.climbH) * ease((t - 0.62) / 0.38);
      if (s.climbT <= 0) s.climbH = 0;
    } else {
      const t = 1 - s.climbT / LEDGE.time;
      const up = ease(Math.min(1, t / 0.62)), over = ease(Math.max(0, (t - 0.4) / 0.6));
      s.x = s.climbAX + (s.climbBX - s.climbAX) * over;
      s.z = s.climbAZ + (s.climbBZ - s.climbAZ) * over;
      s.y = s.climbAY + (s.climbBY - s.climbAY) * up;
    }
    s.vx = s.vy = s.vz = 0;
    s.crouching = 0;
    s.sprinting = 0;
    s.aiming = 0;
    s.grounded = s.climbT <= 0 ? 1 : 0;
    s.airJumps = 0;
    if (s.fireCd > 0) s.fireCd -= dt;
    if (s.swapT > 0) s.swapT = Math.max(0, s.swapT - dt);
    s.jumpHeld = (cmd.buttons & BTN.JUMP) !== 0 ? 1 : 0;
    s.trig = (cmd.buttons & BTN.FIRE) !== 0 ? 1 : 0;
    s.healHeld = (cmd.buttons & BTN.HEAL) !== 0 ? 1 : 0;
    return;
  }

  let btn = frozen ? 0 : cmd.buttons;
  let mx = frozen ? 0 : clamp(cmd.mx, -1, 1);
  let mz = frozen ? 0 : clamp(cmd.mz, -1, 1);
  const inLen = Math.hypot(mx, mz);
  if (inLen > 1) {
    mx /= inLen;
    mz /= inLen;
  }
  let firing = (btn & BTN.FIRE) !== 0;

  // ---- roll: crouch pressed while sprinting on the ground --------------------
  const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
  if (s.rollT < 0) s.rollT = Math.min(0, s.rollT + dt); // cooling down
  if ((btn & BTN.ROLL) !== 0 && s.rollT === 0 && s.grounded && s.sprinting && s.healT <= 0) {
    const hs = Math.hypot(s.vx, s.vz);
    s.rollX = hs > 0.5 ? s.vx / hs : -sinY;
    s.rollZ = hs > 0.5 ? s.vz / hs : -cosY;
    s.rollT = ROLL.time;
    s.reloadT = 0;
    act.rolled = true;
  }
  const rolling = s.rollT > 0;
  if (rolling) {
    // committed to the roll: no shooting, aiming, reloading, throwing or jumping out of it
    btn &= ~(BTN.FIRE | BTN.AIM | BTN.RELOAD | BTN.THROW | BTN.JUMP | BTN.HEAL);
    firing = false;
  }

  // ---- stance ---------------------------------------------------------------
  const wantCrouch = (btn & BTN.CROUCH) !== 0 || rolling;
  if (wantCrouch) s.crouching = 1;
  else if (s.crouching && phys.canStandAt(s.x, s.y, s.z)) s.crouching = 0;

  let weapon = weaponInSlot(s, s.slot);
  s.aiming = !rolling && (btn & BTN.AIM) !== 0 && weapon !== null && weapon.magSize > 0 ? 1 : 0;
  s.sprinting =
    !rolling && (btn & BTN.SPRINT) !== 0 && mz > 0.5 && Math.abs(mx) < 0.75 && !s.crouching && !s.aiming && !firing ? 1 : 0;

  // ---- horizontal velocity --------------------------------------------------
  const speed = targetSpeed(s, weapon);
  // right = (cos, 0, -sin), forward = (-sin, 0, -cos)
  const wishX = (cosY * mx - sinY * mz) * speed;
  const wishZ = (-sinY * mx - cosY * mz) * speed;
  if (rolling) {
    // committed: straight along the roll, fast at first and easing off
    s.rollT = Math.max(0, s.rollT - dt);
    const k = 1 - s.rollT / ROLL.time;
    const v = ROLL.speed + (ROLL.endSpeed - ROLL.speed) * k;
    s.vx = s.rollX * v;
    s.vz = s.rollZ * v;
    if (s.rollT <= 0) s.rollT = -ROLL.cooldown;
  } else if (s.grounded || inLen > 0.01) {
    const maxDv = (s.grounded ? PLAYER.accelGround : PLAYER.accelAir) * dt;
    let dvx = wishX - s.vx, dvz = wishZ - s.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > maxDv) {
      dvx *= maxDv / dl;
      dvz *= maxDv / dl;
    }
    s.vx += dvx;
    s.vz += dvz;
  }

  // ---- jump + gravity -------------------------------------------------------
  const jumpBtn = (btn & BTN.JUMP) !== 0;
  // jumping at an open (or broken) window climbs through it
  if (jumpBtn && !s.jumpHeld && s.grounded && mz > 0.3 && !rolling && s.air === AIR_GROUND && tryVault(s, phys, sinY, cosY, act)) {
    s.jumpHeld = 1;
    return;
  }
  if (s.grounded && s.vy < 0) s.vy = 0;
  if (jumpBtn && !s.jumpHeld && s.grounded) {
    s.vy = PLAYER.jumpVelocity;
    s.grounded = 0;
    s.airJumps = 0;
    act.jumped = true;
  } else if (jumpBtn && !s.jumpHeld && !s.grounded && s.airJumps < PLAYER.airJumps) {
    // double jump: a fresh kick upward whatever you were doing (rising or falling)
    s.vy = PLAYER.doubleJumpVelocity;
    s.airJumps++;
    act.jumped = true;
    act.doubleJumped = true;
  }
  s.jumpHeld = jumpBtn ? 1 : 0;
  s.vy -= PLAYER.gravity * dt;

  // ---- collide & slide ------------------------------------------------------
  const wasGrounded = s.grounded;
  const fallSpeed = -s.vy;
  const wantDy = s.vy * dt;
  phys.moveCharacter(s.x, s.y, s.z, s.vx * dt, wantDy, s.vz * dt, s.crouching === 1, mv);
  if (s.vy > 0 && mv.y - s.y < wantDy * 0.5) s.vy = 0; // bumped a ceiling
  // Ran into something head-on: drop the stored velocity so speed-based logic (spread,
  // animation, bots) sees that we are not actually moving. Slopes and glancing slides keep it.
  const wantH = Math.hypot(s.vx, s.vz) * dt;
  if (wantH > 1e-4) {
    const gotX = mv.x - s.x, gotZ = mv.z - s.z;
    if (Math.hypot(gotX, gotZ) < wantH * 0.5) {
      s.vx = gotX / dt;
      s.vz = gotZ / dt;
    }
  }
  s.x = mv.x;
  s.y = mv.y;
  s.z = mv.z;
  s.grounded = mv.grounded && s.vy <= 0 ? 1 : 0;
  if (s.grounded) {
    s.airJumps = 0;
    if (!wasGrounded && !act.jumped) {
      act.landed = true;
      act.landSpeed = fallSpeed;
    }
    s.vy = 0;
  }

  // ---- ledge grab: in the air, pushing into a wall whose top is within reach ---
  if (!s.grounded && !frozen && mz > 0.3 && !rolling && s.vy < 4 && s.air === AIR_GROUND) {
    tryGrabLedge(s, phys, sinY, cosY, act);
    if (act.climbed) return;
  }

  // ---- weapons --------------------------------------------------------------
  if (s.fireCd > 0) s.fireCd -= dt;
  if (s.swapT > 0) s.swapT = Math.max(0, s.swapT - dt);
  if (s.throwCd > 0) s.throwCd = Math.max(0, s.throwCd - dt);

  // slot change (the second primary slot only exists when carrying from the ammo pools)
  const want = cmd.slot | 0;
  if (
    !frozen && want !== s.slot && want >= SLOT_PRIMARY && want <= SLOT_PRIMARY_B &&
    !(want === SLOT_THROWABLE && (s.throwables <= 0 || s.thr === 0)) && !(want === SLOT_PRIMARY_B && !s.pool)
  ) {
    s.slot = want;
    weapon = weaponInSlot(s, s.slot);
    s.swapT = weapon ? weapon.swapTime : 0.3;
    s.reloadT = 0;
    s.healT = 0;
    act.swapped = true;
  }

  // healing: HEAL starts the best item for the moment and has to be HELD until it is done.
  // Letting go, firing or swapping cancels it (nothing is used up).
  const healBtn = !frozen && (btn & BTN.HEAL) !== 0;
  if (s.healT > 0) {
    if (!healBtn || (firing && weapon && weapon.magSize > 0)) {
      s.healT = 0;
      act.healCanceled = true;
    } else {
      s.healT -= dt;
      if (s.healT <= 0) {
        s.healT = 0;
        const kind = HEAL_KINDS[s.healKind];
        if (kind === 'bandage' && s.bandages > 0) s.bandages--;
        else if (kind === 'medkit' && s.medkits > 0) s.medkits--;
        else if (kind === 'drink' && s.drinks > 0) s.drinks--;
        else if (kind === 'ibuprofen' && s.pills > 0) s.pills--;
        act.healed = s.healKind;
      }
    }
  } else if (healBtn && !s.healHeld && s.reloadT <= 0) {
    const kind = pickHeal(s, (cmd.heal | 0) - 1);
    if (kind >= 0) {
      s.healKind = kind;
      s.healT = PORCH.heals[HEAL_KINDS[kind]].time;
      act.healStart = true;
    }
  }
  s.healHeld = healBtn ? 1 : 0;
  const healing = s.healT > 0;

  if (weapon && !healing) {
    const melee = weapon.magSize === 0;
    let mag = magOf(s, s.slot);
    let res = reserveOf(s, s.slot);

    if (s.bloom > 0) s.bloom = Math.max(0, s.bloom - weapon.bloomRecover * dt);

    // finish a reload in progress
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) {
        s.reloadT = 0;
        const take = Math.min(weapon.magSize - mag, res);
        mag += take;
        res -= take;
        act.reloadDone = true;
      }
    }

    // start a reload (manual, or automatic when trying to fire an empty magazine)
    if (
      !melee && s.reloadT <= 0 && s.swapT <= 0 && mag < weapon.magSize && res > 0 &&
      ((btn & BTN.RELOAD) !== 0 || (mag === 0 && firing))
    ) {
      s.reloadT = weapon.reloadTime;
      act.reloadStart = true;
    }

    // fire
    if (firing && s.reloadT <= 0 && s.swapT <= 0 && s.fireCd <= 0 && (weapon.auto || !s.trig)) {
      if (mag > 0 || melee) {
        if (!melee) mag -= 1;
        s.fireCd += 60 / weapon.rpm;
        act.shot = true;
        act.shotSeed = s.shots;
        act.shotSpread = currentSpread(s, weapon);
        act.shotSlot = s.slot;
        s.shots += 1;
        s.bloom = Math.min(weapon.bloomMax, s.bloom + weapon.bloomPerShot);
      } else if (!s.trig) {
        act.dryFire = true;
      }
    }

    if (!melee) {
      setMag(s, s.slot, mag);
      setReserve(s, s.slot, res);
    }
  }
  if (s.fireCd < 0 && !act.shot) s.fireCd = 0;

  // throwables: dedicated quick-throw button, or FIRE while the throwable slot is out
  const throwBtn = (btn & BTN.THROW) !== 0;
  const throwEdge = (throwBtn && !s.throwHeld) || (s.slot === SLOT_THROWABLE && firing && !s.trig);
  if (throwEdge && s.throwables > 0 && s.thr > 0 && s.throwCd <= 0 && s.swapT <= 0 && !healing) {
    s.throwables -= 1;
    s.throwCd = THROW.cooldown;
    act.threw = true;
    if (s.slot === SLOT_THROWABLE && s.throwables === 0) {
      s.slot = SLOT_PRIMARY;
      s.swapT = weaponInSlot(s, SLOT_PRIMARY)?.swapTime ?? 0.3;
      act.swapped = true;
    }
  }
  s.throwHeld = throwBtn ? 1 : 0;
  s.trig = firing ? 1 : 0;
}

export { SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY, SLOT_THROWABLE };
