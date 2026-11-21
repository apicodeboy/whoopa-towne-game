import type { MapDef } from './types';

/**
 * Ground that is not flat: hills. A hill is a flat top with slopes running down from each side
 * to level ground, a little lumpy, and optionally a drive: a ramp up one side, raised on an
 * embankment where it runs out past the slope. The same function gives the height everywhere
 * (server, clients, tests), and the ground is sampled on a grid into one collision mesh, so
 * everybody walks on exactly the same surface.
 */

export interface HillDef {
  /** The flat top (level, `height` up). */
  top: { x0: number; x1: number; z0: number; z1: number };
  height: number;
  /** How far each slope runs out from the top (meters) before it meets level ground. */
  run: { n: number; s: number; e: number; w: number };
  /** Lumps on the slopes (meters, up and down). The top and the foot stay clean. */
  rough: number;
  seed: number;
  /** A drive up the slope along z: level ground at `zFoot`, the top at `zTop`. */
  drive?: { x0: number; x1: number; zFoot: number; zTop: number };
}

/** A painted patch on the ground (the client colors the ground there). */
export interface GroundPaint {
  kind: 'gravel' | 'dirt' | 'stone';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TerrainDef {
  /** The sampled area (everything outside it is level, at 0) and the grid size (meters). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  step: number;
  hills: HillDef[];
  paint?: GroundPaint[];
}

/** How steep the sides of an embankment are (rise over run). */
const BANK = 0.85;
/** The eased slope: level at both ends, a straight run in the middle. */
const EASE = 0.25;
const PEAK = 1 / (1 - EASE);

function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < EASE) return (PEAK * t * t) / (2 * EASE);
  if (t > 1 - EASE) return 1 - (PEAK * (1 - t) * (1 - t)) / (2 * EASE);
  return PEAK * (t - EASE / 2);
}

function hash(x: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi, seed), b = hash(xi + 1, zi, seed), c = hash(xi, zi + 1, seed), d = hash(xi + 1, zi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Height of one hill at (x, z). */
export function hillHeight(h: HillDef, x: number, z: number): number {
  const T = h.top;
  const dx = x < T.x0 ? (T.x0 - x) / h.run.w : x > T.x1 ? (x - T.x1) / h.run.e : 0;
  const dz = z < T.z0 ? (T.z0 - z) / h.run.n : z > T.z1 ? (z - T.z1) / h.run.s : 0;
  const t = Math.hypot(dx, dz);
  let y = t >= 1 ? 0 : h.height * (1 - ease(t));
  if (t > 0 && t < 1) y += h.rough * Math.sin(Math.PI * t) * (noise(x / 9, z / 9, h.seed) * 2 - 1);
  const d = h.drive;
  // (the drive only runs from its foot to the top; past the top it is the hill again)
  if (d && z >= d.zTop) {
    // a straight ramp from the foot to the top, raised on an embankment where it leaves the slope
    const k = Math.max(0, Math.min(1, (d.zFoot - z) / (d.zFoot - d.zTop)));
    const side = Math.max(0, d.x0 - x, x - d.x1);
    y = Math.max(y, h.height * k - side * BANK);
  }
  return Math.max(0, y);
}

/** Height of the ground (0 where there is no hill). */
export function terrainHeight(t: TerrainDef | undefined, x: number, z: number): number {
  if (!t || x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) return 0;
  let y = 0;
  for (const h of t.hills) y = Math.max(y, hillHeight(h, x, z));
  return y;
}

/** The map's ground height at (x, z), its hills included (not roofs or floors). */
export function groundY(map: MapDef, x: number, z: number): number {
  return terrainHeight(map.terrain, x, z);
}

/**
 * The ground as a triangle mesh on the terrain's grid (world coordinates): vertex positions
 * (x, y, z) and triangle indices, two triangles per cell. Physics and the client both use it.
 */
export function terrainMesh(t: TerrainDef): { pos: Float32Array; idx: Uint32Array; nx: number; nz: number } {
  const nx = Math.round((t.x1 - t.x0) / t.step), nz = Math.round((t.z1 - t.z0) / t.step);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = t.x0 + i * t.step, z = t.z0 + j * t.step;
      pos.set([x, terrainHeight(t, x, z), z], (j * (nx + 1) + i) * 3);
    }
  }
  const list: number[] = [];
  const y = (v: number) => pos[v * 3 + 1];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // level ground is left to the map's ground (and its holes, the pool, stay open)
      if (Math.max(y(a), y(b), y(c), y(d)) < 1e-4) continue;
      // facing up (counter-clockwise seen from above)
      list.push(a, c, b, b, c, d);
    }
  }
  return { pos, idx: Uint32Array.from(list), nx, nz };
}
