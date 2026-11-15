import { PLAYER, THROW } from '../config/game';
import {
  SLOT_PRIMARY, SLOT_SECONDARY, SLOT_THROWABLE, WEAPONS, weaponForSlot,
  type Loadout, type WeaponDef,
} from '../config/weapons';
import type { SpawnPoint } from '../map/types';
import { clamp } from '../math';
import type { MoveResult, PhysicsWorld } from './physics';

/** Input button bitmask. */
export const BTN = {
  JUMP: 1,
  SPRINT: 2,
  CROUCH: 4,
  FIRE: 8,
  AIM: 16,
  RELOAD: 32,
  THROW: 64,
} as const;

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
  /** Weapon slot the player wants out (0 primary, 1 secondary, 2 throwable). */
  slot: number;
  /** Camera position: third-person shots aim from the camera, then fire from the body. */
  ox: number;
  oy: number;
  oz: number;
  /** Server time the client was rendering other players at (for lag compensation). */
  rt: number;
}

export function makeInputCmd(): InputCmd {
  return { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, ox: 0, oy: 0, oz: 0, rt: 0 };
}

export function copyInputCmd(dst: InputCmd, src: InputCmd): InputCmd {
  dst.seq = src.seq; dst.mx = src.mx; dst.mz = src.mz; dst.yaw = src.yaw; dst.pitch = src.pitch;
  dst.buttons = src.buttons; dst.slot = src.slot; dst.ox = src.ox; dst.oy = src.oy; dst.oz = src.oz; dst.rt = src.rt;
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
  /** Was FIRE / JUMP / THROW held last tick (edge detection). */
  trig: number;
  jumpHeld: number;
  throwHeld: number;
}

export const PSTATE_KEYS: ReadonlyArray<keyof PlayerState> = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch',
  'grounded', 'crouching', 'sprinting', 'aiming', 'slot',
  'mag0', 'mag1', 'res0', 'res1', 'throwables',
  'fireCd', 'reloadT', 'swapT', 'throwCd', 'bloom', 'shots',
  'trig', 'jumpHeld', 'throwHeld',
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
  if (Math.abs(a.fireCd - b.fireCd) > 1e-4 || Math.abs(a.reloadT - b.reloadT) > 1e-4) return true;
  if (Math.abs(a.swapT - b.swapT) > 1e-4 || Math.abs(a.throwCd - b.throwCd) > 1e-4) return true;
  if (Math.abs(a.bloom - b.bloom) > 1e-3) return true;
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
  s.mag0 = p.magSize;
  s.res0 = p.reserve;
  s.mag1 = q.magSize;
  s.res1 = q.reserve;
  s.throwables = THROW.perLife;
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
}

export function makeStepActions(): StepActions {
  return {
    shot: false, shotSeed: 0, shotSpread: 0, shotSlot: 0, threw: false,
    reloadStart: false, reloadDone: false, dryFire: false,
    jumped: false, landed: false, landSpeed: 0, swapped: false,
  };
}

function resetActions(a: StepActions): void {
  a.shot = false; a.shotSeed = 0; a.shotSpread = 0; a.shotSlot = 0; a.threw = false;
  a.reloadStart = false; a.reloadDone = false; a.dryFire = false;
  a.jumped = false; a.landed = false; a.landSpeed = 0; a.swapped = false;
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
  return speed * (w ? w.moveMult : 1);
}

const mv: MoveResult = { x: 0, y: 0, z: 0, grounded: false };

/**
 * Advances one player by one fixed tick. Pure function of (state, input, static world):
 * the client runs it to predict, the server runs it for the truth, and both get the
 * same answer.
 *
 * @param frozen  warm-up / match over: the player may look around but not move or shoot.
 */
export function stepPlayer(
  s: PlayerState, cmd: InputCmd, dt: number,
  phys: PhysicsWorld, loadout: Loadout, act: StepActions, frozen = false,
): void {
  resetActions(act);

  s.yaw = cmd.yaw;
  s.pitch = clamp(cmd.pitch, -PLAYER.maxPitch, PLAYER.maxPitch);

  const btn = frozen ? 0 : cmd.buttons;
  let mx = frozen ? 0 : clamp(cmd.mx, -1, 1);
  let mz = frozen ? 0 : clamp(cmd.mz, -1, 1);
  const inLen = Math.hypot(mx, mz);
  if (inLen > 1) {
    mx /= inLen;
    mz /= inLen;
  }
  const firing = (btn & BTN.FIRE) !== 0;

  // ---- stance ---------------------------------------------------------------
  const wantCrouch = (btn & BTN.CROUCH) !== 0;
  if (wantCrouch) s.crouching = 1;
  else if (s.crouching && phys.canStandAt(s.x, s.y, s.z)) s.crouching = 0;

  let weapon = weaponForSlot(loadout, s.slot);
  s.aiming = (btn & BTN.AIM) !== 0 && weapon !== null ? 1 : 0;
  s.sprinting =
    (btn & BTN.SPRINT) !== 0 && mz > 0.5 && Math.abs(mx) < 0.75 && !s.crouching && !s.aiming && !firing ? 1 : 0;

  // ---- horizontal velocity --------------------------------------------------
  const speed = targetSpeed(s, weapon);
  const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
  // right = (cos, 0, -sin), forward = (-sin, 0, -cos)
  const wishX = (cosY * mx - sinY * mz) * speed;
  const wishZ = (-sinY * mx - cosY * mz) * speed;
  if (s.grounded || inLen > 0.01) {
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
  if (s.grounded && s.vy < 0) s.vy = 0;
  if (jumpBtn && !s.jumpHeld && s.grounded) {
    s.vy = PLAYER.jumpVelocity;
    s.grounded = 0;
    act.jumped = true;
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
    if (!wasGrounded && !act.jumped) {
      act.landed = true;
      act.landSpeed = fallSpeed;
    }
    s.vy = 0;
  }

  // ---- weapons --------------------------------------------------------------
  if (s.fireCd > 0) s.fireCd -= dt;
  if (s.swapT > 0) s.swapT = Math.max(0, s.swapT - dt);
  if (s.throwCd > 0) s.throwCd = Math.max(0, s.throwCd - dt);

  // slot change
  const want = cmd.slot | 0;
  if (!frozen && want !== s.slot && want >= SLOT_PRIMARY && want <= SLOT_THROWABLE && !(want === SLOT_THROWABLE && s.throwables <= 0)) {
    s.slot = want;
    weapon = weaponForSlot(loadout, s.slot);
    s.swapT = weapon ? weapon.swapTime : 0.3;
    s.reloadT = 0;
    act.swapped = true;
  }

  if (weapon) {
    const primary = s.slot === SLOT_PRIMARY;
    let mag = primary ? s.mag0 : s.mag1;
    let res = primary ? s.res0 : s.res1;

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
      s.reloadT <= 0 && s.swapT <= 0 && mag < weapon.magSize && res > 0 &&
      ((btn & BTN.RELOAD) !== 0 || (mag === 0 && firing))
    ) {
      s.reloadT = weapon.reloadTime;
      act.reloadStart = true;
    }

    // fire
    if (firing && s.reloadT <= 0 && s.swapT <= 0 && s.fireCd <= 0 && (weapon.auto || !s.trig)) {
      if (mag > 0) {
        mag -= 1;
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

    if (primary) {
      s.mag0 = mag;
      s.res0 = res;
    } else {
      s.mag1 = mag;
      s.res1 = res;
    }
  }
  if (s.fireCd < 0 && !act.shot) s.fireCd = 0;

  // throwables: dedicated quick-throw button, or FIRE while the throwable slot is out
  const throwBtn = (btn & BTN.THROW) !== 0;
  const throwEdge = (throwBtn && !s.throwHeld) || (s.slot === SLOT_THROWABLE && firing && !s.trig);
  if (throwEdge && s.throwables > 0 && s.throwCd <= 0 && s.swapT <= 0) {
    s.throwables -= 1;
    s.throwCd = THROW.cooldown;
    act.threw = true;
    if (s.slot === SLOT_THROWABLE && s.throwables === 0) {
      s.slot = SLOT_PRIMARY;
      s.swapT = WEAPONS[loadout.primary].swapTime;
      act.swapped = true;
    }
  }
  s.throwHeld = throwBtn ? 1 : 0;
  s.trig = firing ? 1 : 0;
}

export { SLOT_PRIMARY, SLOT_SECONDARY, SLOT_THROWABLE };
