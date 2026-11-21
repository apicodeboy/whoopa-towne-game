import * as THREE from 'three';
import { solidQuat, type AreaDef, type Prop, type Solid } from '@shared/map/types';
import type { BoxBatch } from './boxBatch';
import { trs, type GeoBatch } from './geoBatch';

/**
 * CAP'S HOUSE and the country round it: how the farm's pieces look (the pool, hay bales, silos,
 * the windmill, ranch fences, crops in rows, the tractor). Everything here is static and goes
 * into the world's merged batches; the animals and the windmill's fan move (see farmAnimals.ts).
 */
export interface Draw {
  box(key: string): BoxBatch;
  geo(key: string): GeoBatch;
}

/** Deterministic pseudo-random in [0,1) from an integer. */
function hash(n: number): number {
  let t = (n * 374761393 + 668265263) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const STRAW = 0xd6b45e, STRAW_DARK = 0xb8963f;
const WOOD_FENCE = 0x7a5a3a;
const POOL_TILE = 0x6cc6dc, POOL_LINE = 0x24718a;

let bale: THREE.CylinderGeometry | null = null;
let band: THREE.CylinderGeometry | null = null;
let stalk: THREE.OctahedronGeometry | null = null;
let tassel: THREE.ConeGeometry | null = null;
let stem: THREE.CylinderGeometry | null = null;
let head: THREE.CylinderGeometry | null = null;

/** Draws one of the farm's solids. Returns false when `s` is not one of them. */
export function farmSolid(d: Draw, s: Solid, onGround: boolean, index: number): boolean {
  const spec = { x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz, q: solidQuat(s) };
  const x0 = s.x - s.sx / 2, x1 = s.x + s.sx / 2, z0 = s.z - s.sz / 2, z1 = s.z + s.sz / 2;
  const top = s.y + s.sy / 2, bottom = s.y - s.sy / 2;
  switch (s.kind) {
    case 'wainscot':
      // a stone band round the bottom of the barndominium
      d.box('brick').add(spec, { color: 0x9a9184, tile: 1.4, skipBottom: true });
      return true;
    case 'coping':
      d.box('concrete').add(spec, { color: 0xe9e3d5, tile: 2, skipBottom: true });
      return true;
    case 'poolfloor': {
      // the tiled bottom and sides of the pool (the sides are the edges of the hole in the ground)
      d.box('smooth').addQuad(x0, z0, x1, z1, top + 0.002, { color: POOL_TILE });
      // a dark lane line down the middle of the floor
      d.box('smooth').addQuad(x0 + 1.2, s.z - 0.12, x1 - 1.2, s.z + 0.12, top + 0.004, { color: POOL_LINE });
      const h = -top, T = 0.03, cy = top + h / 2;
      d.box('smooth').add({ x: s.x, y: cy, z: z0 + T / 2, sx: s.sx, sy: h, sz: T }, { color: POOL_TILE });
      d.box('smooth').add({ x: s.x, y: cy, z: z1 - T / 2, sx: s.sx, sy: h, sz: T }, { color: POOL_TILE });
      d.box('smooth').add({ x: x0 + T / 2, y: cy, z: s.z, sx: T, sy: h, sz: s.sz }, { color: POOL_TILE });
      d.box('smooth').add({ x: x1 - T / 2, y: cy, z: s.z, sx: T, sy: h, sz: s.sz }, { color: POOL_TILE });
      // the waterline tiles
      const wl = -0.3;
      d.box('smooth').add({ x: s.x, y: wl, z: z0 + T, sx: s.sx, sy: 0.16, sz: T }, { color: POOL_LINE });
      d.box('smooth').add({ x: s.x, y: wl, z: z1 - T, sx: s.sx, sy: 0.16, sz: T }, { color: POOL_LINE });
      d.box('smooth').add({ x: x0 + T, y: wl, z: s.z, sx: T, sy: 0.16, sz: s.sz }, { color: POOL_LINE });
      d.box('smooth').add({ x: x1 - T, y: wl, z: s.z, sx: T, sy: 0.16, sz: s.sz }, { color: POOL_LINE });
      return true;
    }
    case 'poolstep':
      d.box('smooth').add(spec, { color: 0xe8f4f6, skipBottom: true });
      return true;
    case 'poolwater':
      d.box('poolwater').addQuad(x0, z0, x1, z1, top, { color: 0x48c6dc });
      return true;
    case 'board':
      d.box('smooth').add(spec, { color: 0xf4f4f0 });
      return true;
    case 'trough':
      d.box('metal').add(spec, { color: 0x8a949c, tile: 1, skipBottom: true });
      d.box('ground:water').addQuad(x0 + 0.08, z0 + 0.08, x1 - 0.08, z1 - 0.08, top - 0.08, { color: 0x4f7f86 });
      return true;
    case 'haybale': {
      if (s.meta?.square) {
        d.box('flat').add(spec, { color: STRAW, skipBottom: onGround });
        for (const k of [-0.22, 0.22]) d.box('flat').add({ ...spec, sx: s.sx + 0.02, sy: s.sy + 0.02, sz: 0.04, z: s.z + k }, { color: STRAW_DARK });
        return true;
      }
      // a round bale on its side: its axis along the solid's local x
      bale ??= new THREE.CylinderGeometry(0.6, 0.6, 1.2, 14);
      band ??= new THREE.CylinderGeometry(0.61, 0.61, 0.06, 14);
      const ry = s.ry ?? 0;
      d.geo('faceted').add(bale, trs(s.x, bottom + 0.6, s.z, ry, 1, 1, 1, 0, Math.PI / 2), index % 3 ? STRAW : 0xcfae58);
      for (const k of [-0.3, 0.3]) {
        d.geo('faceted').add(band, trs(s.x + Math.cos(ry) * k, bottom + 0.6, s.z - Math.sin(ry) * k, ry, 1, 1, 1, 0, Math.PI / 2), STRAW_DARK);
      }
      return true;
    }
    case 'silo': {
      const r = s.sx / 2, h = s.sy;
      const body = new THREE.CylinderGeometry(r, r, h, 22, 1, true);
      d.geo('metal').add(body, trs(s.x, bottom + h / 2, s.z), 0xc9ced3);
      body.dispose();
      const roof = new THREE.ConeGeometry(r * 1.06, r * 0.55, 22);
      d.geo('smooth').add(roof, trs(s.x, top + r * 0.27, s.z), 0xb7bcc2);
      roof.dispose();
      const ring = new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.12, 22, 1, true);
      for (let y = 2.4; y < h - 0.5; y += 2.4) d.geo('smooth').add(ring, trs(s.x, bottom + y, s.z), 0x9aa1a8);
      ring.dispose();
      const vent = new THREE.CylinderGeometry(0.25, 0.35, 0.5, 8);
      d.geo('smooth').add(vent, trs(s.x, top + r * 0.55 + 0.2, s.z), 0x9aa1a8);
      vent.dispose();
      // a caged ladder up the side
      d.box('flat').add({ x: s.x + r + 0.08, y: s.y, z: s.z, sx: 0.06, sy: h, sz: 0.5 }, { color: 0x6f767d });
      return true;
    }
    case 'windmill': {
      // a steel lattice tower (the fan turns: see farmAnimals); the collision is just its base
      const h = s.sy, base = 1.4;
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lean = Math.atan2(base * 0.8, h);
        d.box('flat').add(
          { x: s.x + a * base * 0.55, y: bottom + h / 2, z: s.z + c * base * 0.55, sx: 0.09, sy: h, sz: 0.09, q: eulerQ(-c * lean, 0, a * lean) },
          { color: 0x8d959d },
        );
      }
      for (let y = 2; y < h - 1; y += 2.2) {
        const w = base * 1.1 * (1 - y / h) + 0.25;
        d.box('flat').add({ x: s.x, y: bottom + y, z: s.z - w / 2, sx: w, sy: 0.06, sz: 0.06 }, { color: 0x8d959d });
        d.box('flat').add({ x: s.x, y: bottom + y, z: s.z + w / 2, sx: w, sy: 0.06, sz: 0.06 }, { color: 0x8d959d });
        d.box('flat').add({ x: s.x - w / 2, y: bottom + y, z: s.z, sx: 0.06, sy: 0.06, sz: w }, { color: 0x8d959d });
        d.box('flat').add({ x: s.x + w / 2, y: bottom + y, z: s.z, sx: 0.06, sy: 0.06, sz: w }, { color: 0x8d959d });
      }
      d.box('flat').add({ x: s.x, y: top - 0.6, z: s.z, sx: 0.9, sy: 0.1, sz: 0.9 }, { color: 0x6f767d });
      return true;
    }
    case 'ranchfence': {
      // posts and three rails
      const along = s.sx >= s.sz ? 'x' : 'z';
      const len = along === 'x' ? s.sx : s.sz, h = s.sy;
      const n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        const px = along === 'x' ? s.x + t : s.x, pz = along === 'x' ? s.z : s.z + t;
        d.box('wood').add({ x: px, y: bottom + (h + 0.06) / 2, z: pz, sx: 0.13, sy: h + 0.06, sz: 0.13 }, { color: 0x6b4e33, tile: 1.3, skipBottom: true });
      }
      for (const y of [h * 0.3, h * 0.62, h * 0.93]) {
        d.box('wood').add(
          { x: s.x, y: bottom + y, z: s.z, sx: along === 'x' ? len : 0.05, sy: 0.13, sz: along === 'x' ? 0.05 : len },
          { color: WOOD_FENCE, tile: 1.3 },
        );
      }
      return true;
    }
    case 'shed':
      d.box('wood').add(spec, { color: s.color ?? 0x8a6f52, tile: 1.3, skipBottom: true, skipTop: true });
      return true;
    default:
      return false;
  }
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
function eulerQ(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  _q.setFromEuler(_e.set(x, y, z, 'YXZ'));
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}

/** Ground looks for the farm's areas (texture batch, tint, tile). */
export const FARM_AREAS: Record<string, { tex: string; color: number; tile: number }> = {
  corn: { tex: 'gravel', color: 0x7a5c3e, tile: 3 },
  wheat: { tex: 'gravel', color: 0x9a7a4e, tile: 3 },
  sunflower: { tex: 'gravel', color: 0x6e5a3a, tile: 3 },
  soil: { tex: 'gravel', color: 0x6b4f35, tile: 2 },
  stubble: { tex: 'grass', color: 0xd8c27a, tile: 4 },
  mud: { tex: 'gravel', color: 0x5a4330, tile: 2 },
};

/**
 * What grows on a field: rows of corn (taller than you: good cover, though bullets go
 * straight through), wheat, sunflowers; plowed furrows. Visual only.
 */
export function crops(d: Draw, a: AreaDef, y: number): void {
  const w = a.x1 - a.x0, dd = a.z1 - a.z0;
  // rows run along the field's long side
  const alongX = w >= dd;
  const across0 = alongX ? a.z0 : a.x0, across1 = alongX ? a.z1 : a.x1;
  const run0 = (alongX ? a.x0 : a.z0) + 0.6, run1 = (alongX ? a.x1 : a.z1) - 0.6;
  const row = (c: number, y0: number, h: number, thick: number, color: number, key = 'flat') => {
    const len = run1 - run0, mid = (run0 + run1) / 2;
    d.box(key).add(
      alongX ? { x: mid, y: y0 + h / 2, z: c, sx: len, sy: h, sz: thick } : { x: c, y: y0 + h / 2, z: mid, sx: thick, sy: h, sz: len },
      { color, skipBottom: true },
    );
  };
  const seed = Math.round(a.x0 * 7 + a.z0 * 13);
  /** Plants along each row, `gap` apart (jittered), calling `plant(x, z, k)`. */
  const plants = (spacing: number, gap: number, plant: (x: number, z: number, k: number) => void) => {
    let k = seed * 31;
    for (let c = across0 + spacing * 0.7; c < across1 - spacing * 0.4; c += spacing) {
      for (let t = run0 + gap * 0.5; t < run1; t += gap) {
        k++;
        const j = (hash(k) - 0.5) * gap * 0.35;
        plant(alongX ? t + j : c, alongX ? c : t + j, k);
      }
    }
  };
  switch (a.kind) {
    case 'corn': {
      // a stalk of leaves (two crossed spindles) with the tassel on top
      stalk ??= new THREE.OctahedronGeometry(1, 0);
      tassel ??= new THREE.ConeGeometry(0.1, 0.4, 4);
      const greens = [0x4a7a2c, 0x426f28, 0x55852f, 0x3f6a26];
      plants(1.1, 0.95, (x, z, k) => {
        const h = 2.0 + hash(k + 5) * 0.45, ry = hash(k + 9) * 3;
        d.geo('faceted').add(stalk!, trs(x, y + h / 2, z, ry, 0.34, h / 2, 0.12), greens[k % 4]);
        d.geo('faceted').add(stalk!, trs(x, y + h * 0.45, z, ry + 1.4, 0.4, h * 0.42, 0.1), greens[(k + 1) % 4]);
        d.geo('faceted').add(tassel!, trs(x, y + h + 0.12, z, ry), 0xd2bd62);
      });
      return;
    }
    case 'wheat':
      for (let c = across0 + 0.5, k = 0; c < across1 - 0.3; c += 0.75, k++) row(c, y, 0.82 + hash(seed + k) * 0.08, 0.6, [0xd9b85c, 0xe0c068, 0xcfae52][k % 3]);
      return;
    case 'sunflower': {
      // a stalk, two leaves and the flower, every one facing the morning sun (east)
      stem ??= new THREE.CylinderGeometry(0.04, 0.05, 1, 5);
      head ??= new THREE.CylinderGeometry(0.26, 0.26, 0.07, 9);
      stalk ??= new THREE.OctahedronGeometry(1, 0);
      plants(1.5, 0.9, (x, z, k) => {
        const h = 1.5 + hash(k + 3) * 0.35;
        d.geo('faceted').add(stem!, trs(x, y + h / 2, z, 0, 1, h, 1), 0x4f7f34);
        d.geo('faceted').add(stalk!, trs(x, y + h * 0.5, z, hash(k) * 3, 0.3, 0.12, 0.1), 0x5d8f3c);
        d.geo('faceted').add(head!, trs(x + 0.06, y + h, z, 0, 1, 1, 1, 0, Math.PI / 2 - 0.3), [0xf2c218, 0xf5ca2a, 0xe8b810][k % 3]);
        d.geo('faceted').add(head!, trs(x + 0.1, y + h, z, 0, 0.5, 1.1, 0.5, 0, Math.PI / 2 - 0.3), 0x5a3a1a);
      });
      return;
    }
    case 'soil':
      for (let c = across0 + 0.4; c < across1 - 0.2; c += 0.8) {
        const len = run1 - run0, mid = (run0 + run1) / 2;
        if (alongX) d.box('ground:gravel').addQuad(mid - len / 2, c - 0.18, mid + len / 2, c + 0.18, y + 0.002, { color: 0x4e3826, tile: 2 });
        else d.box('ground:gravel').addQuad(c - 0.18, mid - len / 2, c + 0.18, mid + len / 2, y + 0.002, { color: 0x4e3826, tile: 2 });
      }
      return;
    default:
  }
}

/** The tractor: a red farm tractor with big rear wheels and an open cab. */
export function tractor(d: Draw, p: Prop): void {
  const sn = Math.sin(p.ry), c = Math.cos(p.ry);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [p.x + lz * sn + lx * c, p.y + ly, p.z + lz * c - lx * sn];
  const q = solidQuat({ ry: p.ry });
  const part = (lx: number, y0: number, lz: number, sx: number, sy: number, sz: number, color: number, key = 'flat') => {
    const [x, y, z] = at(lx, y0 + sy / 2, lz);
    d.box(key).add({ x, y, z, sx, sy, sz, q }, { color });
  };
  const RED = [0xb3261e, 0x2e7d32, 0x2f5f9e][p.variant % 3];
  part(0, 0.65, 0.6, 0.9, 0.85, 2.3, RED); // the hood
  part(0, 0.55, 1.85, 0.95, 0.75, 0.15, 0x2a2c31); // the grille
  part(0, 0.5, -0.7, 1.3, 0.55, 1.4, RED); // the body over the axle
  part(0, 1.05, -0.95, 0.55, 0.15, 0.5, 0x1f2023); // the seat
  part(0, 1.2, -1.2, 0.55, 0.55, 0.12, 0x1f2023);
  for (const sx of [-0.6, 0.6]) for (const sz of [-1.6, -0.1]) part(sx, 1.05, sz, 0.08, 1.55, 0.08, 0x2a2c31); // the cab frame
  part(0, 2.6, -0.85, 1.4, 0.1, 1.7, 0xe8e6e0); // the canopy
  part(0.3, 1.5, 1.3, 0.12, 0.9, 0.12, 0x2a2c31); // the exhaust
  const wheel = new THREE.CylinderGeometry(1, 1, 1, 16);
  for (const [lx, lz, r, w] of [[-0.95, -0.85, 0.78, 0.45], [0.95, -0.85, 0.78, 0.45], [-0.72, 1.25, 0.45, 0.28], [0.72, 1.25, 0.45, 0.28]] as const) {
    const [x, y, z] = at(lx, r, lz);
    d.geo('faceted').add(wheel, trs(x, y, z, p.ry, w, r, r, 0, Math.PI / 2), 0x1b1c1e);
    d.geo('smooth').add(wheel, trs(x + Math.cos(p.ry) * Math.sign(lx) * 0.02, y, z - Math.sin(p.ry) * Math.sign(lx) * 0.02, p.ry, w + 0.02, r * 0.55, r * 0.55, 0, Math.PI / 2), 0xe0b020);
  }
  wheel.dispose();
}

/** A fruit tree in an orchard: short trunk, round crown, fruit. */
export function orchardTree(d: Draw, p: Prop, i: number): void {
  const trunk = new THREE.CylinderGeometry(0.14, 0.22, 2.2, 7);
  d.geo('faceted').add(trunk, trs(p.x, p.y + 1.1, p.z), 0x5a4632);
  trunk.dispose();
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const r = 1.55;
  for (const [ox, oy, oz, rr] of [[0, 2.9, 0, r], [0.6, 2.6, 0.3, r * 0.7], [-0.55, 2.7, -0.35, r * 0.72]] as const) {
    d.geo('faceted').add(blob, trs(p.x + ox, p.y + oy, p.z + oz, hash(i) * 6, rr, rr * 0.85, rr), [0x4f8a3c, 0x5a9446, 0x467f36][(i + Math.round(oy * 10)) % 3]);
  }
  blob.dispose();
  const fruit = new THREE.IcosahedronGeometry(0.11, 0);
  const color = p.variant % 2 ? 0xd33a2c : 0xf08a1c;
  for (let k = 0; k < 9; k++) {
    const a = hash(i * 17 + k) * Math.PI * 2, e = hash(i * 23 + k) * 1.2 - 0.3;
    d.geo('faceted').add(fruit, trs(p.x + Math.cos(a) * r * 0.98 * Math.cos(e), p.y + 2.9 + Math.sin(e) * r * 0.85, p.z + Math.sin(a) * r * 0.98 * Math.cos(e)), color);
  }
  fruit.dispose();
}

/** Disposes the shared shapes once the world is built. */
export function disposeFarmShapes(): void {
  for (const g of [bale, band, stalk, tassel, stem, head]) g?.dispose();
  bale = band = stem = head = null;
  stalk = null;
  tassel = null;
}
