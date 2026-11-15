/** Small allocation-free math helpers shared by client and server. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * View conventions used everywhere:
 *  - yaw 0 looks down -Z, positive yaw turns left (counter-clockwise from above)
 *  - pitch positive looks up
 */
export function forwardFromYawPitch(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export function rightFromYaw(yaw: number, out: Vec3): Vec3 {
  out.x = Math.cos(yaw);
  out.y = 0;
  out.z = -Math.sin(yaw);
  return out;
}

/** Yaw that faces from (x0,z0) toward (x1,z1). */
export function yawToward(x0: number, z0: number, x1: number, z1: number): number {
  return Math.atan2(-(x1 - x0), -(z1 - z0));
}

export function dist2D(x0: number, z0: number, x1: number, z1: number): number {
  return Math.hypot(x1 - x0, z1 - z0);
}

export function dist3D(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Deterministic 32-bit integer hash (for seeding per-shot RNG identically on client and server). */
export function hash32(a: number, b: number): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= (b | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  reseed(seed: number): void {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Approximately normal(0,1). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.2247;
  }
}

/** Ray vs sphere. Returns distance along the ray or -1. Direction must be normalized. */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/**
 * Ray vs vertical capsule (axis along Y from y0 to y1, radius r).
 * Returns distance along the ray or -1. Direction must be normalized.
 */
export function rayVerticalCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, y0: number, y1: number, r: number,
): number {
  let best = -1;
  // Infinite vertical cylinder in XZ
  const mx = ox - cx, mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = mx * dx + mz * dz;
    const c = mx * mx + mz * mz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / a;
      if (t < 0 && c <= 0) t = 0; // origin inside the cylinder
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  } else {
    // Ray is vertical: inside the cylinder cross-section?
    if (mx * mx + mz * mz <= r * r) {
      if (oy >= y0 && oy <= y1) return 0;
    }
  }
  if (best === 0) return 0;
  // End caps (spheres)
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
  if (t0 >= 0 && (best < 0 || t0 < best)) best = t0;
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  return best;
}

/** Closest distance from a point to a segment in 3D. */
export function pointSegmentDist(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(ax + abx * t - px, ay + aby * t - py, az + abz * t - pz);
}
