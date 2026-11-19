/**
 * Signed distance modelling kit: organic primitives (tapered capsules, ellipsoids, rounded
 * boxes in their own frames), smooth blends, and noise for fabric. Negative = inside.
 * Shapes are sculpted by blending many of these, the way a sculptor blocks in muscle masses.
 */
import type { V3 } from './skeleton';

export type SDF = (x: number, y: number, z: number) => number;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------ blends
/** Smooth union (polynomial smooth min), blend radius k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}
export function union(k: number, ...fs: SDF[]): SDF {
  return (x, y, z) => {
    let d = fs[0](x, y, z);
    for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k);
    return d;
  };
}
/** Union where every shape brings its own blend radius (how softly it melts into the rest). */
export function blend(parts: Array<[SDF, number]>): SDF {
  return (x, y, z) => {
    let d = parts[0][0](x, y, z);
    for (let i = 1; i < parts.length; i++) d = smin(d, parts[i][0](x, y, z), parts[i][1]);
    return d;
  };
}
export function subtract(a: SDF, b: SDF, k = 0): SDF {
  return (x, y, z) => smax(a(x, y, z), -b(x, y, z), k);
}
export function intersect(a: SDF, b: SDF, k = 0): SDF {
  return (x, y, z) => smax(a(x, y, z), b(x, y, z), k);
}

// ------------------------------------------------------------------ primitives
export function sphere(c: V3, r: number): SDF {
  return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
}
/** Ellipsoid (a close bound, good for blending). */
export function ellipsoid(c: V3, r: V3): SDF {
  return (x, y, z) => {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
    return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
  };
}
/** A local frame (origin + three unit axes) to place shapes at an angle. */
export interface Frame {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}
export function frame(o: V3, yAxis: V3, zHint: V3 = [0, 0, 1]): Frame {
  const y = norm(yAxis);
  let x = cross(y, zHint);
  if (len(x) < 1e-6) x = cross(y, [1, 0, 0]);
  x = norm(x);
  const z = cross(x, y);
  return { o, x, y, z };
}
const toLocal = (f: Frame, x: number, y: number, z: number): V3 => {
  const dx = x - f.o[0], dy = y - f.o[1], dz = z - f.o[2];
  return [dx * f.x[0] + dy * f.x[1] + dz * f.x[2], dx * f.y[0] + dy * f.y[1] + dz * f.y[2], dx * f.z[0] + dy * f.z[1] + dz * f.z[2]];
};
/** Ellipsoid in a frame (radii along the frame's x, y, z). */
export function ellipsoidIn(f: Frame, r: V3): SDF {
  const e = ellipsoid([0, 0, 0], r);
  return (x, y, z) => {
    const p = toLocal(f, x, y, z);
    return e(p[0], p[1], p[2]);
  };
}
/** Rounded box in a frame (half sizes h, corner radius rr). */
export function roundBoxIn(f: Frame, h: V3, rr: number): SDF {
  return (x, y, z) => {
    const p = toLocal(f, x, y, z);
    const qx = Math.abs(p[0]) - h[0] + rr, qy = Math.abs(p[1]) - h[1] + rr, qz = Math.abs(p[2]) - h[2] + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  };
}
/** Tapered capsule from a (radius ra) to b (radius rb): the basic limb / muscle mass. */
export function roundCone(a: V3, b: V3, ra: number, rb: number): SDF {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
    const zz = yy - l2;
    const qx = pax * l2 - ba[0] * yy, qy = pay * l2 - ba[1] * yy, qz = paz * l2 - ba[2] * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
  };
}
export function capsule(a: V3, b: V3, r: number): SDF {
  return roundCone(a, b, r, r);
}
/** A chain of tapered capsules through points with radii (fingers, straps, cords). */
export function chain(pts: V3[], radii: number[], k = 0): SDF {
  const segs: SDF[] = [];
  for (let i = 1; i < pts.length; i++) segs.push(roundCone(pts[i - 1], pts[i], radii[i - 1], radii[i]));
  return union(k, ...segs);
}
/** Half-space: negative on the side the normal points away from (n·(p-o) < 0 is inside). */
export function plane(o: V3, n: V3): SDF {
  const u = norm(n);
  return (x, y, z) => (x - o[0]) * u[0] + (y - o[1]) * u[1] + (z - o[2]) * u[2];
}

// ------------------------------------------------------------------ segments
/** Where p projects on segment a-b (0..1 clamped) and the distance to it. */
export function segment(a: V3, b: V3, x: number, y: number, z: number): { t: number; d: number } {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz || 1;
  const t = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / l2, 0, 1);
  return { t, d: Math.hypot(x - a[0] - bx * t, y - a[1] - by * t, z - a[2] - bz * t) };
}

// ------------------------------------------------------------------ noise (seeded, deterministic)
function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in -1..1. */
export function noise(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash3(xi + a, yi + b, zi + c, seed);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w) * 2 - 1;
}
export function fbm(x: number, y: number, z: number, seed = 0, oct = 3): number {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f, seed + i * 17);
    a *= 0.5;
    f *= 2.03;
  }
  return s;
}
