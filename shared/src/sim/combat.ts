import { HITBOX } from '../config/game';
import { damageFalloff, type WeaponDef } from '../config/weapons';
import { DEG, TAU, forwardFromYawPitch, hash32, raySphere, rayVerticalCapsule, rightFromYaw, type Rng, type Vec3 } from '../math';
import { Q_BULLET, type PhysicsWorld } from './physics';

/** Something a bullet can hit: a player's hitboxes at a (possibly rewound) feet position. */
export interface ShotTarget {
  id: number;
  x: number;
  y: number;
  z: number;
  crouching: boolean;
}

export const HIT_NONE = 0;
export const HIT_WORLD = 1;
export const HIT_PLAYER = 2;

export interface ShotResult {
  /** Where the bullet ended up. */
  ex: number;
  ey: number;
  ez: number;
  /** HIT_NONE (flew to max range), HIT_WORLD or HIT_PLAYER. */
  kind: number;
  /** Target id for HIT_PLAYER. */
  target: number;
  head: boolean;
  /** Distance travelled from the shooter's eye. */
  dist: number;
  /** Distance from the eye to the point under the crosshair (dist < aimLen means cover got in the way). */
  aimLen: number;
  /** Surface normal for world hits. */
  nx: number;
  ny: number;
  nz: number;
}

export function makeShotResult(): ShotResult {
  return { ex: 0, ey: 0, ez: 0, kind: HIT_NONE, target: -1, head: false, dist: 0, aimLen: 0, nx: 0, ny: 1, nz: 0 };
}

const _hit = { t: -1, head: false };

/** Ray vs one player's head sphere + body capsule. Direction must be normalized. */
export function rayHitbox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: ShotTarget,
): { t: number; head: boolean } {
  const headC = t.crouching ? HITBOX.crouchHeadCenter : HITBOX.headCenter;
  const bodyTop = t.crouching ? HITBOX.crouchBodyTop : HITBOX.bodyTop;
  const th = raySphere(ox, oy, oz, dx, dy, dz, t.x, t.y + headC, t.z, HITBOX.headRadius);
  const tb = rayVerticalCapsule(ox, oy, oz, dx, dy, dz, t.x, t.z, t.y + HITBOX.bodyBottom, t.y + bodyTop, HITBOX.bodyRadius);
  if (th >= 0 && (tb < 0 || th <= tb + 0.05)) {
    _hit.t = th;
    _hit.head = true;
  } else {
    _hit.t = tb;
    _hit.head = false;
  }
  return _hit;
}

/**
 * Third-person hitscan, done in two rays so the crosshair is honest but cover still works:
 *
 *  1. Aim ray: from the camera through the crosshair, ignoring everything between the camera
 *     and the shooter. The first thing it meets is the point the player is aiming at.
 *  2. Bullet ray: from the shooter's eyes toward that point. Whatever it meets first is hit,
 *     so a wall right in front of your body blocks the shot even if the camera can see past it.
 *
 * The server runs this against lag-compensated targets; the client runs the exact same
 * function for instant tracers and impact effects.
 */
export function traceShot(
  phys: PhysicsWorld,
  eyeX: number, eyeY: number, eyeZ: number,
  camX: number, camY: number, camZ: number,
  dirX: number, dirY: number, dirZ: number,
  range: number, targets: readonly ShotTarget[], out: ShotResult,
): ShotResult {
  // ---- 1) aim ray ----
  let s0 = (eyeX - camX) * dirX + (eyeY - camY) * dirY + (eyeZ - camZ) * dirZ;
  if (s0 < 0) s0 = 0;
  const sx = camX + dirX * s0, sy = camY + dirY * s0, sz = camZ + dirZ * s0;
  let tAim = range;
  let aimHit = false;
  const tw = phys.raycast(sx, sy, sz, dirX, dirY, dirZ, range, Q_BULLET);
  if (tw >= 0) {
    tAim = tw;
    aimHit = true;
  }
  for (let i = 0; i < targets.length; i++) {
    const h = rayHitbox(sx, sy, sz, dirX, dirY, dirZ, targets[i]);
    if (h.t >= 0 && h.t < tAim) {
      tAim = h.t;
      aimHit = true;
    }
  }
  const px = sx + dirX * tAim, py = sy + dirY * tAim, pz = sz + dirZ * tAim;

  // ---- 2) bullet ray ----
  let bx = px - eyeX, by = py - eyeY, bz = pz - eyeZ;
  const len = Math.hypot(bx, by, bz);
  if (len < 1e-3) {
    bx = dirX; by = dirY; bz = dirZ;
  } else {
    bx /= len; by /= len; bz /= len;
  }
  const maxLen = aimHit ? len + 0.3 : range;
  out.aimLen = aimHit ? len : range;
  let best = maxLen;
  out.kind = HIT_NONE;
  out.target = -1;
  out.head = false;
  const tw2 = phys.raycast(eyeX, eyeY, eyeZ, bx, by, bz, maxLen, Q_BULLET, true);
  if (tw2 >= 0) {
    best = tw2;
    out.kind = HIT_WORLD;
    out.nx = phys.hitNormal.x;
    out.ny = phys.hitNormal.y;
    out.nz = phys.hitNormal.z;
  }
  for (let i = 0; i < targets.length; i++) {
    const h = rayHitbox(eyeX, eyeY, eyeZ, bx, by, bz, targets[i]);
    if (h.t >= 0 && h.t <= maxLen && h.t < best) {
      best = h.t;
      out.kind = HIT_PLAYER;
      out.target = targets[i].id;
      out.head = h.head;
    }
  }
  out.dist = best;
  out.ex = eyeX + bx * best;
  out.ey = eyeY + by * best;
  out.ez = eyeZ + bz * best;
  return out;
}

const _f: Vec3 = { x: 0, y: 0, z: 0 };
const _r: Vec3 = { x: 0, y: 0, z: 0 };

/** A random direction inside the spread cone around the view direction (uniform over the disc). */
export function spreadDirection(rng: Rng, yaw: number, pitch: number, spreadDeg: number, out: Vec3): Vec3 {
  forwardFromYawPitch(yaw, pitch, _f);
  rightFromYaw(yaw, _r);
  // camera up = right x forward (right.y is 0)
  const ux = -_r.z * _f.y;
  const uy = _r.z * _f.x - _r.x * _f.z;
  const uz = _r.x * _f.y;
  const ang = spreadDeg * DEG * Math.sqrt(rng.next());
  const th = rng.next() * TAU;
  const k = Math.tan(ang);
  const a = k * Math.cos(th), b = k * Math.sin(th);
  let x = _f.x + _r.x * a + ux * b;
  let y = _f.y + uy * b;
  let z = _f.z + _r.z * a + uz * b;
  const l = Math.hypot(x, y, z);
  x /= l; y /= l; z /= l;
  out.x = x; out.y = y; out.z = z;
  return out;
}

/** Seed for a shot's spread pattern; client and server derive the same one. */
export function shotSeed(playerIdx: number, shotCounter: number): number {
  return hash32(playerIdx * 977 + 13, shotCounter);
}

export function pelletDamage(w: WeaponDef, dist: number, head: boolean): number {
  return w.damage * damageFalloff(w, dist) * (head ? w.headMult : 1);
}
