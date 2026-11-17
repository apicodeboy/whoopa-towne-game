import { Rng } from '../math';
import { MapBuilder, type Opening, type Side } from './builder';
import type { MapDef } from './types';
import { addWhoopaTowne } from './whoopaTowne';

/**
 * GREATER WHOOPA TOWNE — the JUMP OFF THE PORCH map. The original town sits untouched in
 * the middle (only its boundary walls come down) and four districts are built around it:
 *
 *   x: -200          -86                86               200
 *      +-------------+-----------------+----------------+  z=-150
 *      |             |    THE HOOD     |                |
 *      |   JUNGLE    +--- Porch St ----+    DOWNTOWN    |  z=-56
 *      |  (temple,   |                 |  (towers, bank,|
 *      |  crash site,|   WHOOPA TOWNE  |  garage, plaza,|
 *      |  ranger stn)|   (the classic  |  city hall,    |
 *      |             |    map)         |  hotel row)    |
 *      +----------------------- Ocean Drive -------------+  z=61..71
 *      |                  WHOOPA BEACH (sand)             |
 *      +--------------------------------------------------+  z=118, the ocean beyond
 *
 * Everything is generated from a fixed seed, so the server and every client build the
 * exact same map without sending it over the wire.
 */

export const GREATER = { minX: -200, maxX: 200, minZ: -150, maxZ: 118 } as const;
const SHORE = GREATER.maxZ;
const SEED = 0x7055;

type Rect = { x0: number; x1: number; z0: number; z1: number };
const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

const HOUSE_COLORS = [0x9fb2c4, 0xc9b48a, 0xa9b7a0, 0xb9a0a0, 0xd8c7a6, 0x8fa3b8, 0xc4a68a, 0xa3a8c9, 0xb8c4a0, 0xd1b0a0];
const PASTELS = [0xf2b8c6, 0x9fd8d0, 0xc9b8e8, 0xf6d7a0, 0xa8d8f0, 0xf4c2a1, 0xb8e0b0];

export function buildGreaterTowne(): MapDef {
  const b = new MapBuilder();
  const rng = new Rng(SEED);
  addWhoopaTowne(b, { perimeter: false });
  coreLoot(b);

  // ---- one ground slab under everything, and the edges ----
  b.box('ground', GREATER.minX - 12, GREATER.maxX + 12, GREATER.minZ - 12, SHORE + 12, -1, 0);
  // city backs along the north edge (hood + downtown) and the east edge (downtown)
  b.box('perimeter', -86, GREATER.maxX + 3, GREATER.minZ - 3, GREATER.minZ, 0, 10, { meta: { side: 'n' } });
  b.box('perimeter', GREATER.maxX, GREATER.maxX + 3, GREATER.minZ, 61, 0, 10, { meta: { side: 'e', tall: 2.2 } });
  // rock cliffs where the jungle and the beach meet the edge of the world
  cliffs(b, rng, 'n', GREATER.minX - 10, -86);
  cliffs(b, rng, 'w', GREATER.minZ - 10, SHORE + 2);
  cliffs(b, rng, 'e', 61, SHORE + 2);
  // the ocean: you can walk to the water's edge and no further
  b.box('bound', GREATER.minX - 6, GREATER.maxX + 6, SHORE, SHORE + 4, 0, 40);

  // ---- connecting roads around the old town ----
  b.road('road', [{ x: -86, z: GREATER.minZ }, { x: -86, z: 61 }], 9, true); // West Line Rd
  b.road('road', [{ x: 86, z: GREATER.minZ }, { x: 86, z: 61 }], 9, true); // East Line Rd
  b.road('road', [{ x: -90.5, z: -56 }, { x: 90.5, z: -56 }], 9, true); // Porch St
  for (const x of [-18, 18]) b.road('road', [{ x, z: 50 }, { x, z: 61 }], 8, true); // the Strips run down to the beach
  b.road('road', [{ x: GREATER.minX, z: 66 }, { x: GREATER.maxX, z: 66 }], 10, true); // Ocean Drive

  hood(b, rng);
  jungle(b, rng);
  downtown(b, rng);
  beach(b, rng);

  b.label('THE HOOD', 0, -128);
  b.label('JUNGLE', -150, -20);
  b.label('DOWNTOWN', 150, -75);
  b.label('WHOOPA BEACH', 0, 100);
  b.label('OCEAN DRIVE', -120, 66);

  b.backdrop = { n: 'city', e: 'city', w: 'hills', s: 'ocean' };
  return b.build('greater-towne', 'Greater Whoopa Towne', { ...GREATER });
}

let cached: MapDef | null = null;
export function getGreaterTowne(): MapDef {
  if (!cached) cached = buildGreaterTowne();
  return cached;
}

// =================================================================================== helpers
function sidewalkRing(b: MapBuilder, r: Rect, w: number): void {
  b.area('sidewalk', r.x0, r.x1, r.z0, r.z0 + w, 1);
  b.area('sidewalk', r.x0, r.x1, r.z1 - w, r.z1, 1);
  b.area('sidewalk', r.x0, r.x0 + w, r.z0 + w, r.z1 - w, 1);
  b.area('sidewalk', r.x1 - w, r.x1, r.z0 + w, r.z1 - w, 1);
}

/** A walk-in building with a loot spot or two inside. */
function room(b: MapBuilder, id: string, r: Rect, h: number, style: string, openings: Opening[], extra: { color?: number; awning?: { side: Side; color: number }; y0?: number; loot?: number } = {}): void {
  b.shell({ id, ...r, h: (extra.y0 ?? 0) + h, y0: extra.y0, style, openings, color: extra.color, awning: extra.awning });
  const n = extra.loot ?? 1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const long = r.x1 - r.x0 >= r.z1 - r.z0;
    const x = long ? r.x0 + 1.2 + (r.x1 - r.x0 - 2.4) * t : (r.x0 + r.x1) / 2;
    const z = long ? (r.z0 + r.z1) / 2 : r.z0 + 1.2 + (r.z1 - r.z0 - 2.4) * t;
    b.loot(x, z, extra.y0 ?? 0);
  }
}

/** Door in the middle of a side, plus windows either side of it. */
function frontage(side: Side, r: Rect, doorW = 1.8, windows = true): Opening[] {
  const along = side === 'n' || side === 's' ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
  const len = side === 'n' || side === 's' ? r.x1 - r.x0 : r.z1 - r.z0;
  const out: Opening[] = [{ side, at: along, w: doorW, top: 2.4 }];
  if (windows && len > 7) {
    out.push({ side, at: along - len * 0.3, w: 1.6, sill: 1.0, top: 2.2 });
    out.push({ side, at: along + len * 0.3, w: 1.6, sill: 1.0, top: 2.2 });
  }
  return out;
}

const opposite = (s: Side): Side => (s === 'n' ? 's' : s === 's' ? 'n' : s === 'e' ? 'w' : 'e');

/** Facing → sign yaw (0 faces -Z). */
const faceYaw = (s: Side): number => (s === 'n' ? 0 : s === 's' ? Math.PI : s === 'w' ? Math.PI / 2 : -Math.PI / 2);

function signOn(b: MapBuilder, text: string, r: Rect, side: Side, y: number, width: number, color: string, bg: string, height = 1.1): void {
  const x = side === 'n' || side === 's' ? (r.x0 + r.x1) / 2 : side === 'w' ? r.x0 - 0.06 : r.x1 + 0.06;
  const z = side === 'e' || side === 'w' ? (r.z0 + r.z1) / 2 : side === 'n' ? r.z0 - 0.06 : r.z1 + 0.06;
  b.sign({ text, x, y, z, yaw: faceYaw(side), width, height, style: 'store', color, bg });
}

/** Rows of rocky bluffs just outside an edge of the map. */
function cliffs(b: MapBuilder, rng: Rng, side: 'n' | 'w' | 'e', a0: number, a1: number): void {
  let a = a0;
  while (a < a1) {
    const len = rng.range(7, 13);
    const depth = rng.range(7, 12);
    const h = rng.range(8, 17);
    const mid = a + len / 2;
    if (side === 'n') b.box('cliff', mid - len / 2 - 0.5, mid + len / 2 + 0.5, GREATER.minZ - 0.5 - depth, GREATER.minZ - 0.5, 0, h);
    else if (side === 'w') b.box('cliff', GREATER.minX - 0.5 - depth, GREATER.minX - 0.5, mid - len / 2 - 0.5, mid + len / 2 + 0.5, 0, h);
    else b.box('cliff', GREATER.maxX + 0.5, GREATER.maxX + 0.5 + depth, mid - len / 2 - 0.5, mid + len / 2 + 0.5, 0, h);
    a += len;
  }
}

/** Distance from a point to a polyline. */
function distToLine(pts: Array<{ x: number; z: number }>, x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i];
    const dx = c.x - a.x, dz = c.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

/** Loot in the old town's walk-in places and up on its roofs. */
function coreLoot(b: MapBuilder): void {
  for (const [x, z, y] of [
    [-4, -9.5, 0], [4, -15, 0], // corner store
    [-33, 3, 0], [-30, 9, 0], [-32.5, 6, 4.4], // liquor store + roof
    [32.5, 8, 0], [32.5, 14, 0], [31, 11, 4.4], // yard office + roof
    [40, -36, 0], [56, -32, 0], [52, -42, 1.1], // warehouse
    [-48, 45.5, 5.5], [-60, 46, 5.5], [48, 45.5, 5.5], // apartment roof, overpass
    [0, -34, 0], [-46, 26, 0], [46, 26, 0], [0, 31, 0], // park, court, rail yard, alleys
  ] as const) b.loot(x, z, y);
}

// =================================================================================== THE HOOD
function hood(b: MapBuilder, rng: Rng): void {
  const xs: Array<[number, number]> = [[-81.5, -56], [-48, -22], [-14, 14], [22, 48], [56, 81.5]];
  const zs: Array<[number, number]> = [[-150, -107], [-99, -60.5]];
  b.road('road', [{ x: -81.5, z: -103 }, { x: 81.5, z: -103 }], 8, true); // Stoop Ave
  for (const x of [-52, 52]) b.road('road', [{ x, z: GREATER.minZ }, { x, z: -60.5 }], 8, true);
  for (const x of [-18, 18]) b.road('road', [{ x, z: GREATER.minZ }, { x, z: -50 }], 8, true);

  xs.forEach(([x0, x1], xi) => {
    zs.forEach(([z0, z1], zi) => {
      const r = { x0, x1, z0, z1 };
      sidewalkRing(b, r, 2.2);
      const key = `${xi},${zi}`;
      if (key === '2,1') school(b, r);
      else if (key === '2,0') church(b, r);
      else if (key === '3,1') foodMart(b, r);
      else if (key === '1,0') projects(b, r);
      else if (key === '4,0') porchPark(b, rng, r);
      else houseBlock(b, rng, r, `h${xi}${zi}`, zi === 0);
      // cars parked along the curbs
      for (const [z, ry] of [[z0 - 1.5, Math.PI / 2], [z1 + 1.5, -Math.PI / 2]] as const) {
        if (z < GREATER.minZ + 1) continue;
        for (let x = x0 + 4; x < x1 - 4; x += rng.range(9, 16)) if (rng.chance(0.45)) b.prop('car', x, z, ry, rng.int(8));
      }
      b.prop('lamp', x0 + 1.2, z1 - 1.1, 0, 0);
      if (zi === 1) b.prop('hydrant', x1 - 1.2, z1 - 1.2, 0, 0);
      b.hotspot((x0 + x1) / 2, z1 + 0.5);
    });
  });
}

/** Houses on their lots, front yards to the street, fenced back yards in the middle. */
function houseBlock(b: MapBuilder, rng: Rng, r: Rect, id: string, northEdge: boolean): void {
  b.area('grass', r.x0 + 2.2, r.x1 - 2.2, r.z0 + 2.2, r.z1 - 2.2, 1);
  const rows: Array<{ facing: Side; zA: number; zB: number }> = [{ facing: 's', zA: r.z1 - 13.6, zB: r.z1 - 4.8 }];
  if (!northEdge) rows.push({ facing: 'n', zA: r.z0 + 4.8, zB: r.z0 + 13.6 });
  let n = 0;
  for (const row of rows) {
    let x = r.x0 + 3.2;
    while (x < r.x1 - 9) {
      let w = rng.range(7.5, 10.5);
      if (x + w > r.x1 - 3.2) w = r.x1 - 3.2 - x;
      if (w < 6.5) break;
      house(b, rng, `${id}_${n++}`, { x0: x, x1: x + w, z0: row.zA, z1: row.zB }, row.facing);
      // driveway car or trash cans in the gap
      const gap = rng.range(2.6, 4.2);
      const gx = x + w + gap / 2;
      if (gap > 3.2 && rng.chance(0.4)) b.prop('car', gx, (row.zA + row.zB) / 2 + (row.facing === 's' ? 2 : -2), 0, rng.int(8));
      else if (rng.chance(0.5)) b.prop('trashcan', gx, row.facing === 's' ? row.zB - 0.5 : row.zA + 0.5, 0, 0);
      x += w + gap;
    }
  }
  // back yards: a fence line with gaps, sheds, junk
  const zm = northEdge ? r.z0 + 6 : (r.z0 + r.z1) / 2;
  const gaps = [r.x0 + (r.x1 - r.x0) * rng.range(0.15, 0.35), r.x0 + (r.x1 - r.x0) * rng.range(0.6, 0.85)];
  let fx = r.x0 + 3;
  for (const g of gaps) {
    b.box('fence_wood', fx, g - 1.2, zm - 0.08, zm + 0.08, 0, 2.0);
    fx = g + 1.2;
  }
  b.box('fence_wood', fx, r.x1 - 3, zm - 0.08, zm + 0.08, 0, 2.0);
  const yardZ = northEdge ? (r.z0 + 6 + r.z1 - 13.6) / 2 : zm + (rng.chance(0.5) ? 3 : -3);
  b.box('shed', r.x0 + 5, r.x0 + 8.5, yardZ - 1.5, yardZ + 1.5, 0, 2.5, { style: 'wood' });
  b.prop(rng.pick(['tires', 'pallet', 'crate', 'dumpster'] as const), r.x1 - 8, yardZ, rng.range(0, 3), 0);
  b.prop('tree', (r.x0 + r.x1) / 2 + rng.range(-4, 4), yardZ + rng.range(-1.5, 1.5), 0, rng.int(3));
  if (northEdge) {
    b.prop('car', r.x0 + 14, r.z0 + 3.4, Math.PI / 2, rng.int(8));
    b.loot(r.x1 - 6, r.z0 + 4);
  }
}

function house(b: MapBuilder, rng: Rng, id: string, r: Rect, facing: Side): void {
  const style = rng.pick(['siding', 'stucco', 'brick', 'siding'] as const);
  const color = style === 'brick' ? undefined : rng.pick(HOUSE_COLORS);
  const cx = (r.x0 + r.x1) / 2;
  const front = facing === 's' ? r.z1 : r.z0;
  const out = facing === 's' ? 1 : -1;
  if (rng.chance(0.34)) {
    // a house you can walk into (and through, out the back)
    room(b, id, r, 3.8, style, [...frontage(facing, r), { side: opposite(facing), at: cx + 1.5, w: 1.5 }, { side: 'e', at: (r.z0 + r.z1) / 2, w: 1.4, sill: 1.0, top: 2.2 }], { color, loot: rng.chance(0.5) ? 2 : 1 });
    b.prop('shelf', r.x0 + 0.8, (r.z0 + r.z1) / 2, 0, rng.int(4));
  } else {
    b.building({ id, ...r, h: rng.pick([6.2, 6.5, 7.0]), style, color, roofStyle: 'pitched' });
  }
  // the porch out front
  b.box('stoop', cx - 1.7, cx + 1.7, Math.min(front, front + out * 1.7), Math.max(front, front + out * 1.7), 0, 0.34, { color: 0xb9b4a8 });
}

function school(b: MapBuilder, r: Rect): void {
  const S = { x0: -12, x1: 12, z0: -95, z1: -81 };
  const top = 5;
  b.shell({
    id: 'school', ...S, h: top, style: 'brick', color: 0xa86650,
    openings: [
      { side: 's', at: -6, w: 2.4, top: 2.6 }, { side: 's', at: 6, w: 2.4, top: 2.6 },
      { side: 's', at: -10, w: 1.6, sill: 1.0, top: 2.4 }, { side: 's', at: 0, w: 2.2, sill: 1.0, top: 2.4 }, { side: 's', at: 10, w: 1.6, sill: 1.0, top: 2.4 },
      { side: 'n', at: 0, w: 2.2, top: 2.5 }, { side: 'n', at: -8, w: 1.8, sill: 1.0, top: 2.4 }, { side: 'n', at: 8, w: 1.8, sill: 1.0, top: 2.4 },
      { side: 'w', at: -88, w: 1.8 }, { side: 'e', at: -88, w: 1.8 },
    ],
  });
  // classrooms either side of a hall
  for (const x of [-4, 4]) {
    b.box('wall', x - 0.15, x + 0.15, S.z0 + 0.3, -89, 0, top - 0.3, { style: 'brick', group: 'school', color: 0xa86650 });
    b.box('wall', x - 0.15, x + 0.15, -87, S.z1 - 0.3, 0, top - 0.3, { style: 'brick', group: 'school', color: 0xa86650 });
  }
  for (const x of [-9, -1.5, 1.5, 9]) b.loot(x, -91);
  b.loot(-8, -84);
  b.loot(8, -84);
  signOn(b, 'WHOOPA ELEMENTARY', S, 's', 3.9, 10, '#ffffff', '#1f3a68');
  // playground
  b.area('court', -12, 4, -78, -63.5, 2);
  b.prop('hoop', -11.2, -70.75, Math.PI / 2, 0);
  b.prop('hoop', 3.2, -70.75, -Math.PI / 2, 0);
  b.box('bleacher', 6, 12, -76, -75.2, 0, 0.4);
  b.box('bleacher', 6, 12, -75.2, -74.4, 0, 0.8);
  b.prop('bench', 9, -68, 0, 0);
  b.prop('tree', 9, -64.5, 0, 1);
  b.box('fence_chain', -12, 4, -78.04, -77.96, 0, 2.6, { col: 'fence' });
  b.label('SCHOOL', 0, -88);
  b.hotspot(0, -88);
  b.hotspot(-4, -70);
  void r;
}

function church(b: MapBuilder, r: Rect): void {
  const C = { x0: -7, x1: 7, z0: -138, z1: -116 };
  b.shell({
    id: 'church', ...C, h: 7, style: 'stucco', color: 0xe8e2d4,
    openings: [
      { side: 's', at: 0, w: 3, top: 3.4 },
      { side: 'n', at: 4, w: 1.6 },
      { side: 'w', at: -132, w: 1.2, sill: 1.4, top: 5 }, { side: 'w', at: -126, w: 1.2, sill: 1.4, top: 5 }, { side: 'w', at: -120, w: 1.6 },
      { side: 'e', at: -132, w: 1.2, sill: 1.4, top: 5 }, { side: 'e', at: -126, w: 1.2, sill: 1.4, top: 5 }, { side: 'e', at: -120, w: 1.6 },
    ],
  });
  b.building({ id: 'steeple', x0: -2.5, x1: 2.5, z0: -144, z1: -138, h: 15, style: 'stucco', color: 0xe8e2d4, roofStyle: 'pitched' });
  for (let z = -133; z <= -122; z += 2.6) {
    b.prop('bench', -3.4, z, Math.PI / 2, 0);
    b.prop('bench', 3.4, z, Math.PI / 2, 0);
  }
  b.box('counter', -2, 2, -136.5, -135.5, 0, 1.1);
  b.loot(0, -134);
  b.loot(-5.6, -126);
  b.loot(5.6, -120);
  signOn(b, 'NEW HOPE CHURCH', C, 's', 4.6, 7.5, '#3b2a1a', '#f4ead2');
  b.area('lot', -12, 12, -114.8, -109.4, 1);
  b.prop('van', -6, -112, Math.PI / 2, 1);
  b.prop('car', 4, -112, -Math.PI / 2, 2);
  b.prop('tree', -10.5, -126, 0, 2);
  b.prop('tree', 10.5, -130, 0, 0);
  b.label('CHURCH', 0, -127);
  b.hotspot(0, -112);
  void r;
}

function foodMart(b: MapBuilder, r: Rect): void {
  const M = { x0: 25, x1: 41, z0: -74, z1: -63 };
  room(b, 'foodmart', M, 4.4, 'store', [
    { side: 's', at: 33, w: 2.6, top: 2.5 }, { side: 's', at: 28, w: 3, sill: 1.0, top: 2.4 }, { side: 's', at: 38, w: 3, sill: 1.0, top: 2.4 },
    { side: 'n', at: 37, w: 1.6 }, { side: 'w', at: -68.5, w: 1.6 },
  ], { awning: { side: 's', color: 0xb3261e }, loot: 2 });
  b.prop('shelf', 29, -69.5, Math.PI / 2, 1);
  b.prop('shelf', 36, -69.5, Math.PI / 2, 2);
  b.box('counter', 39, 40.4, -72, -66, 0, 1.05);
  signOn(b, 'TOWNE FOOD MART', M, 's', 3.45, 8, '#ffe14d', '#b3261e');
  b.prop('dumpster', 44.5, -72, 0, 0);
  b.prop('busstop', 46.5, -62, -Math.PI / 2, 0);
  // the court out back
  b.area('court', 24.5, 45.5, -96.5, -80, 2);
  b.prop('hoop', 25.4, -88.25, Math.PI / 2, 0);
  b.prop('hoop', 44.6, -88.25, -Math.PI / 2, 0);
  for (const z of [-96.5, -80]) {
    b.box('fence_chain', 24.5, 31, z - 0.04, z + 0.04, 0, 3, { col: 'fence' });
    b.box('fence_chain', 39, 45.5, z - 0.04, z + 0.04, 0, 3, { col: 'fence' });
  }
  b.prop('barrier', 35, -84, Math.PI / 2, 0);
  b.prop('crate_big', 30, -91, 0.2, 0);
  b.label('FOOD MART', 33, -68.5);
  b.hotspot(35, -88);
  void r;
}

function projects(b: MapBuilder, r: Rect): void {
  const A = { x0: -46, x1: -24, z0: -146, z1: -134 };
  b.building({ id: 'projectsA', ...A, h: 9, style: 'apartment', parapet: { h: 1, gaps: [{ side: 's', at: -31.4, w: 1.7 }] } });
  b.ramp({ kind: 'stairs', x: -44, z: -133.15, y0: 0, dir: 'e', run: 12.6, rise: 9, width: 1.7, fill: true, rails: 'right', style: 'concrete', group: 'projectsA' });
  b.prop('acunit', -40, -140, 0, 0, 9);
  b.loot(-35, -140, 9);
  room(b, 'laundry', { x0: -46, x1: -30, z0: -124, z1: -114 }, 4, 'brickdark', [
    ...frontage('s', { x0: -46, x1: -30, z0: -124, z1: -114 }, 2), { side: 'n', at: -34, w: 1.6 }, { side: 'e', at: -119, w: 1.6 },
  ], { loot: 2 });
  signOn(b, 'SUDS LAUNDRY', { x0: -46, x1: -30, z0: -124, z1: -114 }, 's', 3.2, 6, '#ffffff', '#2a6f97');
  b.area('lot', -46, -24, -132.5, -126, 1);
  b.prop('car', -42, -129, Math.PI / 2, 3);
  b.prop('dumpster', -26.5, -129, 0, 1);
  b.prop('car', -28, -118, 0, 6);
  b.label('THE PROJECTS', -35, -140);
  b.hotspot(-35, -129);
  void r;
}

function porchPark(b: MapBuilder, rng: Rng, r: Rect): void {
  b.area('grass', r.x0 + 2.2, r.x1 - 2.2, r.z0 + 2.2, r.z1 - 2.2, 1);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  b.area('path', cx - 1.4, cx + 1.4, r.z0 + 2.2, r.z1 - 2.2, 2);
  b.area('path', r.x0 + 2.2, r.x1 - 2.2, cz - 1.4, cz + 1.4, 2);
  // gazebo
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.box('pillar', cx + dx - 0.2, cx + dx + 0.2, cz + dz - 0.2, cz + dz + 0.2, 0, 3);
  b.box('deck', cx - 3.6, cx + 3.6, cz - 3.6, cz + 3.6, 3, 3.3, { style: 'concrete' });
  b.loot(cx, cz);
  for (let i = 0; i < 9; i++) {
    const x = rng.range(r.x0 + 4, r.x1 - 4), z = rng.range(r.z0 + 4, r.z1 - 4);
    if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue;
    b.prop('tree', x, z, 0, rng.int(3));
  }
  b.prop('bench', cx - 6, cz - 2.2, Math.PI / 2, 0);
  b.prop('bench', cx + 6, cz + 2.2, Math.PI / 2, 0);
  b.box('lowwall', r.x0 + 4, r.x0 + 12, cz + 6, cz + 6.4, 0, 1.0);
  b.label('PORCH PARK', cx, cz);
  b.hotspot(cx, cz);
}

// =================================================================================== JUNGLE
function jungle(b: MapBuilder, rng: Rng): void {
  const J: Rect = { x0: GREATER.minX, x1: -90.5, z0: GREATER.minZ, z1: 61 };
  b.area('jungle', J.x0, J.x1, J.z0, J.z1, 1);
  const trails: Array<Array<{ x: number; z: number }>> = [
    [{ x: -90.5, z: 0 }, { x: -100, z: 1 }, { x: -112, z: -6 }, { x: -124, z: -18 }, { x: -138, z: -28 }, { x: -150, z: -40 }, { x: -152, z: -54 }, { x: -150, z: -64 }],
    [{ x: -124, z: -18 }, { x: -128, z: -2 }, { x: -127, z: 14 }, { x: -122, z: 28 }, { x: -118, z: 34 }],
    [{ x: -138, z: -28 }, { x: -152, z: -22 }, { x: -166, z: -10 }, { x: -174, z: 2 }],
    [{ x: -90.5, z: -56 }, { x: -100, z: -58 }, { x: -108, z: -70 }, { x: -112, z: -90 }, { x: -113, z: -110 }],
    [{ x: -90.5, z: -103 }, { x: -104, z: -100 }, { x: -112, z: -92 }],
    [{ x: -127, z: 14 }, { x: -140, z: 30 }, { x: -150, z: 48 }, { x: -152, z: 61 }],
    [{ x: -108, z: -70 }, { x: -125, z: -76 }, { x: -136, z: -80 }],
  ];
  for (const t of trails) b.road('trail', t, 3.4, false);
  const creek = [{ x: -200, z: -40 }, { x: -186, z: -47 }, { x: -172, z: -58 }, { x: -170, z: -74 }, { x: -179, z: -95 }, { x: -186, z: -116 }, { x: -183, z: -136 }, { x: -177, z: -150 }];
  b.road('creek', creek, 5, false);
  const keep: Rect[] = [];

  // ---- the temple: a stepped ruin with a shrine on top ----
  {
    const cx = -150, cz = -88;
    b.box('ruin', cx - 13, cx + 13, cz - 13, cz + 13, 0, 2.6);
    b.box('ruin', cx - 9, cx + 9, cz - 9, cz + 9, 2.6, 5.2);
    b.box('ruin', cx - 5.5, cx + 5.5, cz - 5.5, cz + 5.5, 5.2, 7.8);
    b.shell({
      id: 'shrine', x0: cx - 4, x1: cx + 4, z0: cz - 4, z1: cz + 4, y0: 7.8, h: 11.2, style: 'ruin',
      openings: (['n', 's', 'e', 'w'] as Side[]).map((side) => ({ side, at: side === 'n' || side === 's' ? cx : cz, w: 2 })),
    });
    b.ramp({ kind: 'stairs', x: cx, z: cz + 23.5, y0: 0, dir: 'n', run: 18, rise: 7.8, width: 4, fill: true, style: 'ruin', group: 'temple' });
    b.loot(cx - 1.5, cz, 7.8);
    b.loot(cx + 1.5, cz, 7.8);
    for (const [dx, dz] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) b.loot(cx + dx, cz + dz, 2.6);
    // fallen columns around the base
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.range(-0.2, 0.2), d = rng.range(16, 19);
      if (Math.abs(Math.cos(a) * d) < 4.5 && Math.sin(a) > 0) continue; // keep the stairs clear
      b.box('ruin', cx + Math.cos(a) * d - 0.6, cx + Math.cos(a) * d + 0.6, cz + Math.sin(a) * d - 0.6, cz + Math.sin(a) * d + 0.6, 0, rng.range(0.8, 3.6));
    }
    keep.push({ x0: cx - 22, x1: cx + 22, z0: cz - 22, z1: cz + 26 });
    b.label('TEMPLE', cx, cz);
    b.hotspot(cx, cz + 18);
    b.hotspot(cx, cz);
  }

  // ---- ranger station + lookout tower ----
  {
    const R = { x0: -124, x1: -114, z0: 36, z1: 44 };
    room(b, 'ranger', R, 3.6, 'wood', [...frontage('n', R), { side: 's', at: -119, w: 1.6 }, { side: 'w', at: 40, w: 1.4, sill: 1.0, top: 2.2 }], { loot: 2 });
    signOn(b, 'RANGER STATION', R, 'n', 3.0, 6, '#f4ead2', '#3d5a2c');
    const tx = -108, tz = 40;
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      b.box('post', tx + dx - 0.15, tx + dx + 0.15, tz + dz - 0.15, tz + dz + 0.15, 0, 8.4, { color: 0x6b5238 });
    }
    b.box('woodplat', tx - 2, tx + 2, tz - 2, tz + 2, 5.8, 6, { color: 0x7a5c3e });
    b.box('woodplat', tx - 2.3, tx + 2.3, tz - 2.3, tz + 2.3, 8.4, 8.6, { color: 0x5c4630 });
    b.box('rail', tx - 2, tx + 2, tz - 2, tz - 1.93, 6, 7, { col: 'fence' });
    b.box('rail', tx - 2, tx + 2, tz + 1.93, tz + 2, 6, 7, { col: 'fence' });
    b.box('rail', tx - 2, tx - 1.93, tz - 2, tz + 2, 6, 7, { col: 'fence' });
    b.ramp({ kind: 'stairs', x: tx + 10, z: tz, y0: 0, dir: 'w', run: 8, rise: 6, width: 1.4, rails: 'both', style: 'wood', group: 'lookout', thickness: 0.2 });
    b.loot(tx, tz, 6);
    keep.push({ x0: -128, x1: -96, z0: 31, z1: 49 });
    b.label('RANGER STN', -116, 40);
    b.hotspot(-116, 32);
  }

  // ---- crash site: a cargo plane that never made it to the airport ----
  {
    const cx = -172, cz = 20, ry = 0.5;
    const sx = Math.sin(ry), cz2 = Math.cos(ry);
    b.rbox('wreck', cx, cz, 3.6, 20, 0, 3.6, ry, { color: 0xd5d9de });
    b.rbox('wreck', cx + sx * 1, cz + cz2 * 1, 22, 3.2, 1.2, 0.5, ry, { color: 0xc4c9cf });
    b.rbox('wreck', cx - sx * 15, cz - cz2 * 15, 3.2, 7, 0, 3.2, ry + 0.35, { color: 0xd5d9de });
    b.rbox('wreck', cx - sx * 17.5, cz - cz2 * 17.5, 0.5, 3, 3.2, 3.4, ry + 0.35, { color: 0xb3261e });
    for (let i = 0; i < 6; i++) b.prop(i % 2 ? 'crate' : 'crate_big', cx + rng.range(-9, 9), cz + rng.range(-9, 9), rng.range(0, 3), i % 2);
    b.loot(cx + 5, cz - 6);
    b.loot(cx - 6, cz + 4);
    b.loot(cx + 3, cz + 9);
    keep.push({ x0: cx - 20, x1: cx + 16, z0: cz - 22, z1: cz + 16 });
    b.label('CRASH SITE', cx, cz);
    b.hotspot(cx + 6, cz);
  }

  // ---- a little village of huts around a fire pit ----
  {
    const cx = -113, cz = -122;
    b.area('dirt', cx - 13, cx + 13, cz - 13, cz + 13, 2);
    const huts: Array<[number, number, Side]> = [[-7, -7, 's'], [7, -7, 's'], [-7, 7, 'n'], [7, 7, 'n']];
    huts.forEach(([dx, dz, side], i) => {
      const H = { x0: cx + dx - 2.5, x1: cx + dx + 2.5, z0: cz + dz - 2.5, z1: cz + dz + 2.5 };
      room(b, `hut${i}`, H, 3, 'wood', [{ side, at: cx + dx, w: 1.4, top: 2.2 }, { side: dx < 0 ? 'w' : 'e', at: cz + dz, w: 1.2, sill: 1.0, top: 2 }]);
    });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.prop('rock', cx + Math.cos(a) * 1.9, cz + Math.sin(a) * 1.9, a, 0);
    }
    b.prop('log', cx, cz - 4, Math.PI / 2, 0);
    b.prop('log', cx, cz + 4, Math.PI / 2, 1);
    keep.push({ x0: cx - 14, x1: cx + 14, z0: cz - 14, z1: cz + 14 });
    b.label('HUTS', cx, cz);
    b.hotspot(cx, cz);
  }

  // ---- the jungle itself: trees, palms, rocks and undergrowth everywhere else ----
  const cell = 5;
  for (let x = J.x0 + 3; x < J.x1 - 3; x += cell) {
    for (let z = J.z0 + 3; z < J.z1 - 3; z += cell) {
      const px = x + rng.range(-1.8, 1.8), pz = z + rng.range(-1.8, 1.8);
      const r = rng.next();
      if (keep.some((k) => inRect(k, px, pz, 1))) continue;
      const near = Math.min(...trails.map((t) => distToLine(t, px, pz)));
      if (near < 3.4) {
        if (near > 2.2 && r < 0.25) b.prop('bush', px, pz, rng.range(0, 6), rng.int(3));
        continue;
      }
      if (px > J.x1 - 4 || pz > J.z1 - 4) continue;
      if (distToLine(creek, px, pz) < 3.2) continue;
      if (r < 0.42) b.prop('tree', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.56) b.prop('palm', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.6) b.prop('boulder', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.66) b.prop('rock', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.69) b.prop('log', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.9) b.prop('bush', px, pz, rng.range(0, 6), rng.int(3));
    }
  }
  // a few stashes out in the trees
  for (let i = 0; i < 10; i++) b.loot(rng.range(-190, -100), rng.range(-140, 50));
  for (const [x, z] of [[-112, -6], [-138, -28], [-150, -40], [-127, 14], [-166, -10], [-108, -70], [-112, -92], [-140, 30], [-150, 48], [-180, -60], [-185, -120], [-100, -30]] as const) b.hotspot(x, z);
}

// =================================================================================== DOWNTOWN
function downtown(b: MapBuilder, rng: Rng): void {
  const xs: Array<[number, number]> = [[90.5, 125], [135, 165], [175, 200]];
  const zs: Array<[number, number]> = [[-150, -105], [-95, -55], [-45, -5], [5, 61]];
  b.road('road', [{ x: 81.5, z: 0 }, { x: GREATER.maxX, z: 0 }], 10, true); // Main Ave
  for (const z of [-100, -50]) b.road('road', [{ x: 90.5, z }, { x: GREATER.maxX, z }], 10, true);
  for (const x of [130, 170]) b.road('road', [{ x, z: GREATER.minZ }, { x, z: 61 }], 10, true);

  xs.forEach(([x0, x1], xi) => {
    zs.forEach(([z0, z1], zi) => {
      const r = { x0, x1, z0, z1 };
      sidewalkRing(b, r, 3);
      const inner = { x0: x0 + 3, x1: x1 - 3, z0: z0 + 3, z1: z1 - 3 };
      const key = `${xi},${zi}`;
      if (key === '1,2') garage(b, inner);
      else if (key === '1,3') plaza(b, rng, inner);
      else if (key === '0,2') bank(b, inner);
      else if (key === '2,1') cityHall(b, inner);
      else if (key === '1,1') {
        b.building({ id: 'whoopatower', x0: 139, x1: 161, z0: -91, z1: -59, h: 64, style: 'glass', color: 0x6f8fa8 });
        b.sign({ text: 'WHOOPA TOWER', x: 150, y: 8, z: -58.94, yaw: Math.PI, width: 14, height: 2, style: 'store', color: '#ffffff', bg: '#1b2a3a' });
        b.label('WHOOPA TOWER', 150, -75);
      } else if (zi === 3) hotelRow(b, rng, inner, xi);
      else towers(b, rng, inner, `dt${xi}${zi}`);
      // street furniture
      b.prop('lamp', x0 + 1.4, z1 - 1.4, 0, 0);
      b.prop('lamp', x1 - 1.4, z0 + 1.4, 0, 0);
      if (rng.chance(0.6)) b.prop('busstop', x1 - 1.2, (z0 + z1) / 2, -Math.PI / 2, 0);
      b.prop('trashcan', x0 + 1.6, z0 + 1.6, 0, 0);
      b.prop('hydrant', x1 - 1.3, z1 - 1.3, 0, 0);
      for (let x = x0 + 4; x < x1 - 4; x += rng.range(8, 14)) {
        if (z0 > GREATER.minZ + 1 && rng.chance(0.4)) b.prop('car', x, z0 - 1.7, Math.PI / 2, rng.int(8));
        if (rng.chance(0.4)) b.prop('car', x, z1 + 1.7, -Math.PI / 2, rng.int(8));
      }
      b.hotspot((x0 + x1) / 2, z1 + 2);
    });
  });
}

/** Office towers filling a block, split by service alleys. Ground-floor shops on some. */
function towers(b: MapBuilder, rng: Rng, r: Rect, id: string): void {
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const n = len > 30 ? 2 : 1;
  const gap = 3;
  const w = (len - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const a = (alongX ? r.x0 : r.z0) + i * (w + gap);
    const lot = alongX ? { x0: a, x1: a + w, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: a, z1: a + w };
    if (rng.chance(0.3)) {
      // a shop you can walk into, with the rest of the lot paved
      const shop = alongX ? { ...lot, z1: lot.z0 + Math.min(12, lot.z1 - lot.z0) } : { ...lot, x1: lot.x0 + Math.min(12, lot.x1 - lot.x0) };
      const side: Side = alongX ? 'n' : 'w';
      const name = rng.pick(['PAWN SHOP', 'KICKS', 'CELL PHONES', 'WINGS', 'BARBER', 'NAILS', 'CHECKS CASHED', 'GOLD & GRILLZ']);
      room(b, `${id}_${i}`, shop, 4.4, 'store', [...frontage(side, shop, 2.4), { side: opposite(side), at: side === 'n' ? (shop.x0 + shop.x1) / 2 : (shop.z0 + shop.z1) / 2, w: 1.6 }], {
        color: rng.pick(PASTELS), awning: { side, color: rng.pick([0x1d6b3a, 0x7a1f1f, 0x22384f, 0x6b3a7a]) }, loot: 2,
      });
      signOn(b, name, shop, side, 3.45, Math.min(8, (alongX ? shop.x1 - shop.x0 : shop.z1 - shop.z0) * 0.7), '#ffffff', rng.pick(['#1d6b3a', '#7a1f1f', '#22384f', '#6b3a7a']));
      const rest = alongX ? { ...lot, z0: shop.z1 } : { ...lot, x0: shop.x1 };
      if ((alongX ? rest.z1 - rest.z0 : rest.x1 - rest.x0) > 4) {
        b.area('lot', rest.x0, rest.x1, rest.z0, rest.z1, 1);
        b.prop('car', (rest.x0 + rest.x1) / 2, (rest.z0 + rest.z1) / 2, alongX ? 0 : Math.PI / 2, rng.int(8));
      }
    } else {
      b.building({ id: `${id}_${i}`, ...lot, h: Math.round(rng.range(18, 50)), style: rng.pick(['glass', 'office', 'concrete', 'brickdark', 'glass']), color: rng.chance(0.4) ? rng.pick([0x6f8fa8, 0x8a94a0, 0xa69c8c, 0x5f7086]) : undefined });
    }
    if (i < n - 1) {
      // the alley between
      const al = alongX ? { x0: a + w, x1: a + w + gap, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: a + w, z1: a + w + gap };
      b.area('alley', al.x0, al.x1, al.z0, al.z1, 1);
      b.prop('dumpster', (al.x0 + al.x1) / 2, (al.z0 + al.z1) / 2, alongX ? 0 : Math.PI / 2, rng.int(2));
    }
  }
}

/** A three-level parking garage: ramps up the sides, open decks, a roof to fight on. */
function garage(b: MapBuilder, r: Rect): void {
  const x0 = 137, x1 = 163, z0 = -43, z1 = -7, t = 0.4;
  const L = [3.5, 7, 10.5];
  b.area('lot', x0, x1, z0, z1, 1);
  const deck = (xa: number, xb: number, za: number, zb: number, y: number) => b.box('deck', xa, xb, za, zb, y - t, y, { style: 'concrete', group: 'garage' });
  // level 1 (hole over the west entry ramp)
  deck(x0 + 4, x1, z0, z1, L[0]);
  deck(x0, x0 + 4, z0, -23, L[0]);
  // level 2 (hole over the east ramp)
  deck(x0, x1 - 4, z0, z1, L[1]);
  deck(x1 - 4, x1, -27, z1, L[1]);
  deck(x1 - 4, x1, z0, -41, L[1]);
  // roof (hole over the west ramp)
  deck(x0 + 4, x1, z0, z1, L[2]);
  deck(x0, x0 + 4, z0, -23, L[2]);
  b.ramp({ kind: 'ramp', x: x0 + 2.2, z: -9, y0: 0, dir: 'n', run: 14, rise: L[0], width: 3.5, style: 'concrete', group: 'garage', thickness: 0.35 });
  b.ramp({ kind: 'ramp', x: x1 - 2.2, z: -41, y0: L[0], dir: 's', run: 14, rise: L[1] - L[0], width: 3.5, style: 'concrete', group: 'garage', thickness: 0.35 });
  b.ramp({ kind: 'ramp', x: x0 + 2.2, z: -9, y0: L[1], dir: 'n', run: 14, rise: L[2] - L[1], width: 3.5, style: 'concrete', group: 'garage', thickness: 0.35 });
  for (const x of [142, 150, 158]) for (const z of [-41, -33, -25, -17, -9]) b.box('pillar', x - 0.4, x + 0.4, z - 0.4, z + 0.4, 0, L[2] - t);
  // low walls around each level's edge
  for (const y of L) {
    b.box('lowwall', x0, x1, z0, z0 + 0.25, y, y + 1);
    b.box('lowwall', x0 + 4, x1, z1 - 0.25, z1, y, y + 1);
    b.box('lowwall', x1 - 0.25, x1, z0 + 0.25, z1 - 0.25, y, y + 1);
    b.box('lowwall', x0, x0 + 0.25, z0 + 0.25, -23, y, y + 1);
  }
  for (const [x, z, y] of [[150, -30, 0], [146, -20, L[0]], [154, -36, L[1]], [150, -25, L[2]], [158, -14, L[2]]] as const) b.loot(x, z, y);
  b.prop('car', 146, -38, 0, 1);
  b.prop('car', 154, -14, Math.PI, 4);
  b.prop('car', 146, -14, 0, 2, L[0]);
  b.prop('car', 154, -30, Math.PI, 5, L[1]);
  b.prop('van', 150, -38, Math.PI / 2, 0, L[2]);
  b.sign({ text: 'PARKING', x: 150, y: 2.6, z: -6.94, yaw: Math.PI, width: 5, height: 1, style: 'store', color: '#ffffff', bg: '#1f5fa8' });
  b.label('GARAGE', 150, -25);
  b.hotspot(150, -25);
  void r;
}

function plaza(b: MapBuilder, rng: Rng, r: Rect): void {
  b.area('plaza', r.x0, r.x1, r.z0, r.z1, 1);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  b.box('fountain', cx - 5, cx + 5, cz - 5, cz + 5, 0, 0.8);
  b.box('fountain', cx - 0.8, cx + 0.8, cz - 0.8, cz + 0.8, 0.8, 4, { style: 'pillar' });
  for (const [dx, dz] of [[-10, -16], [10, -16], [-10, 16], [10, 16]]) {
    b.box('planter', cx + dx - 2.5, cx + dx + 2.5, cz + dz - 2.5, cz + dz + 2.5, 0, 0.9);
    b.prop('tree', cx + dx, cz + dz, 0, rng.int(3), 0.9);
  }
  for (const dz of [-8, 8]) {
    b.prop('bench', cx - 8, cz + dz, Math.PI / 2, 0);
    b.prop('bench', cx + 8, cz + dz, Math.PI / 2, 0);
  }
  const K = { x0: r.x0 + 1, x1: r.x0 + 6, z0: r.z1 - 6, z1: r.z1 - 1 };
  room(b, 'coffee', K, 3.2, 'wood', [{ side: 'e', at: (K.z0 + K.z1) / 2, w: 1.6 }, { side: 'n', at: (K.x0 + K.x1) / 2, w: 2.4, sill: 1.0, top: 2.2 }]);
  signOn(b, 'COFFEE', K, 'n', 2.75, 3.6, '#ffffff', '#4b3526', 0.8);
  b.loot(cx + 3, cz + 7);
  b.loot(cx - 3, cz - 7);
  b.label('PLAZA', cx, cz);
  b.hotspot(cx, cz);
  b.hotspot(cx, cz + 18);
}

function bank(b: MapBuilder, r: Rect): void {
  const B = { x0: 96, x1: 120, z0: -36, z1: -14 };
  b.shell({
    id: 'bank', ...B, h: 6.5, style: 'concrete', color: 0xd9d4c7,
    openings: [
      { side: 's', at: 108, w: 3, top: 3.2 }, { side: 's', at: 100, w: 2, sill: 1.0, top: 3 }, { side: 's', at: 116, w: 2, sill: 1.0, top: 3 },
      { side: 'n', at: 100, w: 1.6 }, { side: 'w', at: -25, w: 1.8 },
    ],
  });
  b.box('counter', 99, 114, -27, -26, 0, 1.15);
  // the vault
  b.box('wall', 110, 110.3, -35.7, -32.5, 0, 6.2, { style: 'concrete', group: 'bank' });
  b.box('wall', 110, 110.3, -30.5, -29, 0, 6.2, { style: 'concrete', group: 'bank' });
  b.box('wall', 110, 119.7, -29.3, -29, 0, 6.2, { style: 'concrete', group: 'bank' });
  b.loot(115, -33);
  b.loot(117, -31);
  b.loot(104, -20);
  b.loot(100, -31);
  for (const x of [98, 102, 114, 118]) b.box('pillar', x - 0.35, x + 0.35, -13.3, -12.6, 0, 6.2);
  signOn(b, 'FIRST WHOOPA BANK', B, 's', 4.6, 10, '#f2e8c9', '#2b3a2e');
  b.label('BANK', 108, -25);
  b.hotspot(108, -8);
  void r;
}

function cityHall(b: MapBuilder, r: Rect): void {
  const C = { x0: 180, x1: 197, z0: -90, z1: -60 };
  b.shell({
    id: 'cityhall', ...C, h: 9, style: 'concrete', color: 0xe6e1d3,
    openings: [
      { side: 'w', at: -75, w: 3.4, top: 3.6 }, { side: 'w', at: -85, w: 1.8, sill: 1.0, top: 3 }, { side: 'w', at: -65, w: 1.8, sill: 1.0, top: 3 },
      { side: 'n', at: 188, w: 1.8 }, { side: 's', at: 188, w: 1.8 },
    ],
  });
  b.box('counter', 190, 191, -80, -70, 0, 1.1);
  for (const z of [-88, -83.5, -66.5, -62]) b.box('pillar', 178.2, 178.9, z - 0.35, z + 0.35, 0, 8.6);
  b.box('stoop', 176.5, 180, -79, -71, 0, 0.34, { color: 0xd8d4c8 });
  b.loot(185, -80);
  b.loot(185, -68);
  b.loot(194, -75);
  b.sign({ text: 'CITY HALL', x: 179.94, y: 6.2, z: -75, yaw: Math.PI / 2, width: 9, height: 1.4, style: 'store', color: '#2b2b2b', bg: '#e6e1d3' });
  b.label('CITY HALL', 188, -75);
  b.hotspot(176, -75);
  void r;
}

/** Pastel hotels facing the beach, lobbies on the street, parking behind. */
function hotelRow(b: MapBuilder, rng: Rng, r: Rect, xi: number): void {
  const names = ['SEABREEZE HOTEL', 'THE PALMS', 'CORAL INN', 'OCEAN VIEW', 'SUNSET SUITES'];
  const n = r.x1 - r.x0 > 28 ? 2 : 1;
  const w = (r.x1 - r.x0 - (n - 1) * 3) / n;
  for (let i = 0; i < n; i++) {
    const x0 = r.x0 + i * (w + 3), x1 = x0 + w;
    const color = PASTELS[(xi * 2 + i) % PASTELS.length];
    const lobby = { x0, x1, z0: r.z1 - 8, z1: r.z1 };
    room(b, `hotel${xi}${i}`, lobby, 4.4, 'stucco', [...frontage('s', lobby, 2.6), { side: 'n', at: (x0 + x1) / 2, w: 1.8 }], { color, awning: { side: 's', color: 0x1e7f86 }, loot: 2 });
    const towerZ0 = r.z1 - 8 - rng.range(14, 22);
    b.building({ id: `hotelT${xi}${i}`, x0, x1, z0: towerZ0, z1: r.z1 - 8, h: Math.round(rng.range(12, 22)), style: 'stucco', color });
    b.sign({ text: names[(xi + i * 3) % names.length], x: (x0 + x1) / 2, y: 4.2, z: r.z1 + 0.06, yaw: Math.PI, width: Math.min(9, w * 0.8), height: 1.1, style: 'store', color: '#ffffff', bg: '#e05a8a' });
    b.area('lot', x0, x1, r.z0, towerZ0 - 1, 1);
    for (let z = r.z0 + 3; z < towerZ0 - 4; z += 6) if (rng.chance(0.5)) b.prop('car', x0 + 3, z, Math.PI / 2, rng.int(8));
    b.prop('palm', x0 + 1, r.z1 + 1.6, 0, 0);
  }
  b.label('HOTELS', (r.x0 + r.x1) / 2, r.z1 - 4);
}

// =================================================================================== BEACH
function beach(b: MapBuilder, rng: Rng): void {
  const PROM0 = 71, PROM1 = 76, SAND0 = 76.5;
  b.area('sidewalk', GREATER.minX, GREATER.maxX, PROM0, PROM1, 1);
  b.area('sand', GREATER.minX - 12, GREATER.maxX + 12, PROM1, SHORE + 0.5, 1);
  b.area('surf', -1500, 1500, SHORE - 1.2, SHORE + 1.4, 3);
  b.area('ocean', -1500, 1500, SHORE + 0.5, 1500, 2);
  // the sea wall, with steps down to the sand every so often
  let x = GREATER.minX;
  while (x < GREATER.maxX) {
    const len = rng.range(18, 28);
    b.box('lowwall', x, Math.min(GREATER.maxX, x + len), PROM1, PROM1 + 0.5, 0, 0.7);
    x += len + 4;
  }
  let k = 0;
  for (let px = GREATER.minX + 6; px < GREATER.maxX - 4; px += 12) {
    if (k++ % 3 === 1) b.prop('lamp', px, PROM0 + 1, 0, 0);
    else b.prop('palm', px, PROM0 + 2.5, rng.range(0, 6), rng.int(3));
  }
  // the strip between the old town and Ocean Drive
  const IC = { x0: -54, x1: -48, z0: 55.5, z1: 60 };
  const SURF = { x0: 40, x1: 52, z0: 52, z1: 60 };
  for (const [a, c] of [[-81.5, -22], [-14, 14], [22, 81.5]] as const) {
    b.area('sidewalk', a, c, 50.5, 61, 1);
    for (let px = a + 4; px < c - 3; px += 9) if (!inRect(IC, px, 54, 1.5) && !inRect(SURF, px, 54, 1.5)) b.prop('palm', px, 54, rng.range(0, 6), rng.int(3));
  }
  room(b, 'icecream', IC, 3, 'stucco', [{ side: 's', at: -51, w: 2.4, sill: 1.0, top: 2.2 }, { side: 'n', at: -51, w: 1.4 }], { color: 0xf2b8c6 });
  signOn(b, 'ICE CREAM', IC, 's', 2.6, 4.4, '#ffffff', '#e05a8a', 0.7);
  room(b, 'surfshop', SURF, 4, 'stucco', [...frontage('s', SURF, 2.2), { side: 'n', at: 46, w: 1.6 }], { color: 0x8fd3e8, loot: 2 });
  signOn(b, 'SURF SHOP', SURF, 's', 3.2, 6, '#ffffff', '#1e7f86');
  // parked along Ocean Drive in front of the old town (downtown parks its own)
  for (let px = -190; px < 80; px += rng.range(14, 24)) if (rng.chance(0.5) && Math.abs(Math.abs(px) - 86) > 6 && Math.abs(Math.abs(px) - 18) > 6) b.prop('car', px, 62.6, Math.PI / 2, rng.int(8));

  const keep: Rect[] = [];
  // ---- lifeguard towers ----
  for (const cx of [-160, -80, 20, 100, 170]) {
    const cz = 100;
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box('post', cx + dx - 0.12, cx + dx + 0.12, cz + dz - 0.12, cz + dz + 0.12, 0, 4.6, { color: 0xe8e2d4 });
    b.box('woodplat', cx - 1.6, cx + 1.6, cz - 1.6, cz + 1.6, 2.2, 2.4, { color: 0xc9b48a });
    b.box('woodplat', cx - 1.9, cx + 1.9, cz - 1.9, cz + 1.9, 4.6, 4.8, { color: 0xc0392b });
    b.box('rail', cx - 1.6, cx + 1.6, cz + 1.53, cz + 1.6, 2.4, 3.4, { col: 'fence' });
    b.box('rail', cx - 1.6, cx - 1.53, cz - 1.6, cz + 1.6, 2.4, 3.4, { col: 'fence' });
    b.box('rail', cx + 1.53, cx + 1.6, cz - 1.6, cz + 1.6, 2.4, 3.4, { col: 'fence' });
    b.ramp({ kind: 'stairs', x: cx, z: cz - 6.6, y0: 0, dir: 's', run: 5, rise: 2.4, width: 1.2, rails: 'both', style: 'wood', group: `guard${cx}`, thickness: 0.2 });
    b.loot(cx, cz, 2.4);
    keep.push({ x0: cx - 3, x1: cx + 3, z0: cz - 8, z1: cz + 3 });
    b.hotspot(cx, cz - 9);
  }
  // ---- tiki bar ----
  {
    const T = { x0: -36, x1: -24, z0: 88, z1: 96 };
    room(b, 'tiki', T, 3.4, 'wood', [
      { side: 'n', at: -30, w: 2, top: 2.3 }, { side: 'n', at: -34, w: 2.4, sill: 1.0, top: 2.4 }, { side: 'n', at: -26, w: 2.4, sill: 1.0, top: 2.4 },
      { side: 's', at: -30, w: 5, sill: 1.0, top: 2.4 }, { side: 'e', at: 92, w: 1.6 }, { side: 'w', at: 92, w: 3, sill: 1.0, top: 2.4 },
    ], { loot: 2, awning: { side: 'n', color: 0xc9a227 } });
    b.box('counter', -34, -26, 93.6, 94.6, 0, 1.1);
    signOn(b, 'TIKI BAR', T, 'n', 2.95, 5, '#ffe14d', '#6b3a1a');
    for (const [dx, dz] of [[-8, -2], [8, 1], [-6, 7], [7, 8]]) b.prop('palm', -30 + dx, 92 + dz, rng.range(0, 6), rng.int(3));
    keep.push({ x0: -40, x1: -20, z0: 84, z1: 101 });
    b.label('TIKI BAR', -30, 92);
    b.hotspot(-30, 86);
  }
  // ---- lifeguard HQ ----
  {
    const L = { x0: 54, x1: 66, z0: 84, z1: 92 };
    room(b, 'guardhq', L, 4, 'stucco', [...frontage('n', L, 2), { side: 's', at: 60, w: 1.8 }], { color: 0xf4efe6, loot: 2 });
    signOn(b, 'LIFEGUARD', L, 'n', 3.2, 6, '#ffffff', '#c0392b');
    keep.push({ x0: 51, x1: 69, z0: 81, z1: 95 });
    b.label('LIFEGUARD HQ', 60, 88);
    b.hotspot(60, 80);
  }
  // ---- volleyball ----
  for (const vx of [-115, 135]) {
    for (const vz of [91, 101]) b.box('post', vx - 0.1, vx + 0.1, vz - 0.1, vz + 0.1, 0, 2.5, { color: 0xe8e2d4 });
    b.box('fence_chain', vx - 0.03, vx + 0.03, 91, 101, 1.5, 2.45, { col: 'fence' });
    keep.push({ x0: vx - 9, x1: vx + 9, z0: 88, z1: 104 });
    b.hotspot(vx, 96);
  }
  // ---- boats pulled up on the sand, rocks at the ends ----
  b.prop('boat', 150, 109, 0.3, 0);
  b.prop('boat', 156, 106, -0.25, 1);
  b.prop('boat', -172, 108, 0.5, 2);
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    b.prop(rng.chance(0.5) ? 'boulder' : 'rock', side * rng.range(186, 197), rng.range(80, 116), rng.range(0, 6), rng.int(3));
  }
  // ---- umbrellas and towels ----
  for (let i = 0; i < 46; i++) {
    const ux = rng.range(-185, 185), uz = rng.range(84, 112);
    if (keep.some((k) => inRect(k, ux, uz, 2))) continue;
    b.prop('umbrella', ux, uz, rng.range(0, 6), rng.int(5));
    const tx = ux + 1.4, tz = uz + rng.range(-0.6, 0.6);
    b.area('towel', tx - 0.55, tx + 0.55, tz - 1, tz + 1, 2, rng.pick([0xe05a8a, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xe9c46a, 0xffffff]));
    if (rng.chance(0.18)) b.loot(ux - 1, uz);
  }
  for (let px = -180; px <= 180; px += 45) b.hotspot(px, 95);
}
