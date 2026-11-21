import { Rng } from '../math';
import { construct } from './architect';
import { MapBuilder, type Opening, type Side } from './builder';
import type { MapDef } from './types';
import { addWhoopaTowne } from './whoopaTowne';

/**
 * GREATER WHOOPA TOWNE — the JUMP OFF THE PORCH map: nine districts in a 3×3 grid, the
 * original town untouched in the middle (only its boundary walls come down).
 *
 *   x: -200            -86                 86              200
 *      +---------------+------------------+----------------+  z=-150
 *      |   BABYLON     |    THE HILL      |   HONG KONG    |
 *      |  (desert)     |  (houses, AJ'S)  | (Chinatown)    |
 *      +---------------+---- Porch St ----+----------------+  z=-56
 *      |   JUNGLE      |   WHOOPA TOWNE   |   DOWNTOWN     |
 *      |               |  (the classic    |                |
 *      |               |   map)           |                |
 *      +---------------+-- Ocean Drive ---+----------------+  z=61..71
 *      |  THE DOCKS    |    LAKE LINDA    | THE BOARDWALK  |
 *      +---------------+------------------+----------------+  z=118, the lake beyond
 *
 * West Line Rd (x=-86), East Line Rd (x=86), Porch St (z=-56) and Ocean Drive (z=66) are the
 * borders. Everything is generated from fixed seeds, so the server and every client build
 * the exact same map without sending it over the wire.
 */

export const GREATER = { minX: -200, maxX: 200, minZ: -150, maxZ: 118 } as const;
/** The jungle's old west edge (now the west edge of the map). */
const OLD_WEST = -200;
const SHORE = GREATER.maxZ;
const SEED = 0x7055;
/** The grid: column edges (x) and row edges (z), inside the border roads. */
const CELL = {
  w: { x0: GREATER.minX, x1: -90.5 },
  c: { x0: -81.5, x1: 81.5 },
  e: { x0: 90.5, x1: GREATER.maxX },
  n: { z0: GREATER.minZ, z1: -60.5 },
  m: { z0: -51.5, z1: 61 },
  s: { z0: 71, z1: SHORE },
} as const;

type Rect = { x0: number; x1: number; z0: number; z1: number };
const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

const PASTELS = [0xf2b8c6, 0x9fd8d0, 0xc9b8e8, 0xf6d7a0, 0xa8d8f0, 0xf4c2a1, 0xb8e0b0];

export function buildGreaterTowne(): MapDef {
  const b = new MapBuilder();
  const rng = new Rng(SEED);
  addWhoopaTowne(b, { perimeter: false });
  coreLoot(b);

  // ---- one ground slab under everything, and the edges ----
  b.box('ground', GREATER.minX - 12, GREATER.maxX + 12, GREATER.minZ - 12, SHORE + 12, -1, 0);
  // city backs along the north edge (the hill, Hong Kong) and the east edge
  b.box('perimeter', -86, GREATER.maxX + 3, GREATER.minZ - 3, GREATER.minZ, 0, 10, { meta: { side: 'n' } });
  b.box('perimeter', GREATER.maxX, GREATER.maxX + 3, GREATER.minZ, 61, 0, 10, { meta: { side: 'e', tall: 2.2 } });
  // rock cliffs where the desert, the jungle and the docks meet the edge of the world
  // (these draws come first, as they always have, so THE HILL generates exactly as before)
  cliffs(b, rng, 'n', OLD_WEST - 10, -86);
  cliffs(b, rng, 'w', GREATER.minZ - 10, SHORE + 2);
  cliffs(b, rng, 'e', 61, SHORE + 2);
  // LAKE LINDA: you can walk to the water's edge and no further
  b.box('bound', GREATER.minX - 6, GREATER.maxX + 6, SHORE, SHORE + 4, 0, 40);

  // ---- the border roads ----
  b.road('road', [{ x: -86, z: GREATER.minZ }, { x: -86, z: 61 }], 9, true); // West Line Rd
  b.road('road', [{ x: 86, z: GREATER.minZ }, { x: 86, z: 61 }], 9, true); // East Line Rd
  b.road('road', [{ x: GREATER.minX, z: -56 }, { x: GREATER.maxX, z: -56 }], 9, true); // Porch St
  for (const x of [-18, 18]) b.road('road', [{ x, z: 50 }, { x, z: 61 }], 8, true); // the Strips run down to the beach
  b.road('road', [{ x: GREATER.minX, z: 66 }, { x: GREATER.maxX, z: 66 }], 10, true); // Ocean Drive

  hood(b, rng);
  // every other district has its own seed
  babylon(b, new Rng(SEED ^ 0xbab1));
  jungle(b, new Rng(SEED ^ 0x1a6));
  hongKong(b, new Rng(SEED ^ 0x4b6));
  downtown(b, new Rng(SEED ^ 0xd07));
  beach(b, new Rng(SEED ^ 0xbea));
  docks(b, new Rng(SEED ^ 0xd0c));

  billboards(b);
  districtFences(b);

  b.label('BABYLON', -150, -66);
  b.label('THE HILL', 0, -128);
  b.label('HONG KONG', 150, -66);
  b.label('JUNGLE', -150, 50);
  b.label('DOWNTOWN', 150, -48);
  b.label('THE DOCKS', -145, 80);
  b.label('LAKE LINDA', 0, 100);
  b.label('BOARDWALK', 150, 104);
  b.label('OCEAN DRIVE', -60, 66);
  // the names people call out from the blimp
  b.districts.push(
    { name: 'BABYLON', x: -145, z: -105 },
    { name: 'THE HILL', x: 0, z: -105 },
    { name: 'HONG KONG', x: 145, z: -105 },
    { name: 'JUNGLE', x: -145, z: 5 },
    { name: 'WHOOPA TOWNE', x: 0, z: 0 },
    { name: 'DOWNTOWN', x: 145, z: 5 },
    { name: 'THE DOCKS', x: -145, z: 95 },
    { name: 'LAKE LINDA', x: 0, z: 97 },
    { name: 'BOARDWALK', x: 145, z: 95 },
  );
  // JUMP OFF THE PORCH: before the match, everyone warms up in BABYLON
  b.warmup = { x0: CELL.w.x0 + 4, x1: CELL.w.x1 - 4, z0: CELL.n.z0 + 4, z1: CELL.n.z1 - 4 };

  b.backdrop = { n: 'city', e: 'city', w: 'desert', s: 'ocean' };
  return b.build('greater-towne', 'Greater Whoopa Towne', { ...GREATER });
}

/**
 * Billboards around town: ads for the local spots, and big screens showing live scores (the
 * client fills those in from the game server's /api/scores). `face` is the side the front
 * looks toward; the back carries another ad (or the scores again).
 */
/** How tall the railings between the districts are (low enough to jump: a jump clears about 1.25 m). */
export const DISTRICT_FENCE_H = 0.95;

/**
 * Each district is fenced off from its neighbours: a low steel railing down the middle of every
 * border road (and across the beach between the docks, the lake and the boardwalk). It blocks
 * walking but not jumping, bullets or grenades (it is a fence, not a wall). Wherever something
 * already stands on the line (a palm tree, the end of a wall) the railing stops and starts
 * again around it, so that thing is part of the fence.
 */
function districtFences(b: MapBuilder): void {
  const H = DISTRICT_FENCE_H, T = 0.07, PIECE = 12;
  const lines: Array<{ along: 'x' | 'z'; at: number; from: number; to: number }> = [
    { along: 'z', at: -86, from: GREATER.minZ, to: SHORE }, // West Line Rd, then across the sand
    { along: 'z', at: 86, from: GREATER.minZ, to: SHORE }, // East Line Rd
    { along: 'x', at: -56, from: GREATER.minX, to: GREATER.maxX }, // Porch St
    { along: 'x', at: 66, from: GREATER.minX, to: GREATER.maxX }, // Ocean Drive
  ];
  // the spans of each line taken by something already there (gaps in the railing)
  const solidsBefore = b.solids.slice();
  for (const l of lines) {
    const gaps: Array<[number, number]> = [];
    for (const s of solidsBefore) {
      if (s.y + s.sy / 2 < 0.05 || s.y - s.sy / 2 > H + 0.2) continue;
      // (a rotated box: its bounding circle)
      const rx = s.ry ? Math.hypot(s.sx, s.sz) / 2 : s.sx / 2, rz = s.ry ? rx : s.sz / 2;
      const across = l.along === 'z' ? Math.abs(s.x - l.at) - rx : Math.abs(s.z - l.at) - rz;
      if (across > 0.1) continue;
      const c = l.along === 'z' ? s.z : s.x, r = l.along === 'z' ? rz : rx;
      gaps.push([c - r - 0.05, c + r + 0.05]);
    }
    for (const p of b.props) {
      const across = l.along === 'z' ? Math.abs(p.x - l.at) : Math.abs(p.z - l.at);
      if (across > 0.9) continue;
      const c = l.along === 'z' ? p.z : p.x;
      gaps.push([c - 0.9, c + 0.9]);
    }
    gaps.sort((a, c) => a[0] - c[0]);
    // the open stretches between the gaps, in pieces
    let t = l.from;
    const runs: Array<[number, number]> = [];
    for (const [g0, g1] of [...gaps, [l.to, l.to] as [number, number]]) {
      if (g0 > t + 0.3) runs.push([t, Math.min(g0, l.to)]);
      t = Math.max(t, g1);
      if (t >= l.to) break;
    }
    for (const [r0, r1] of runs) {
      const n = Math.max(1, Math.round((r1 - r0) / PIECE));
      for (let i = 0; i < n; i++) {
        const a = r0 + ((r1 - r0) * i) / n, c = r0 + ((r1 - r0) * (i + 1)) / n;
        if (l.along === 'z') b.box('rail', l.at - T / 2, l.at + T / 2, a, c, 0, H, { col: 'fence', meta: { border: 1 } });
        else b.box('rail', a, c, l.at - T / 2, l.at + T / 2, 0, H, { col: 'fence', meta: { border: 1 } });
      }
    }
  }
}

function billboards(b: MapBuilder): void {
  const T = 0.35;
  const put = (x: number, z: number, face: Side, o: { front: string; back?: string; w?: number; h?: number; y0?: number; clear?: number }) => {
    const w = o.w ?? 9, h = o.h ?? 4.2, y0 = o.y0 ?? 0, clear = o.clear ?? 5.2;
    const ns = face === 'n' || face === 's';
    // two steel legs, a catwalk, the panel
    for (const d of [-w * 0.3, w * 0.3]) {
      const px = ns ? x + d : x, pz = ns ? z : z + d;
      b.box('pillar', px - 0.22, px + 0.22, pz - 0.22, pz + 0.22, y0, y0 + clear + 0.2, { color: 0x3a3f46 });
    }
    b.solids.push({
      kind: 'billboard', x, y: y0 + clear + h / 2, z, sx: ns ? w : T, sy: h, sz: ns ? T : w,
      meta: { face, front: o.front, back: o.back ?? '' },
    });
  };
  // ---- live scoreboards ----
  put(150, 10.5, 's', { front: 'live', back: 'live', w: 13, h: 6, clear: 4.6 }); // the plaza's big screen
  put(196.5, -105, 'w', { front: 'live', back: 'hk', w: 10, h: 4.8, clear: 6.2 }); // over Lantern Street
  put(68.5, -108.6, 's', { front: 'live', back: 'ibu', w: 9, h: 4.2 }); // Stoop Ave, by the park
  put(150, 79.2, 'n', { front: 'live', back: 'live', w: 10, h: 4.6, clear: 4.4 }); // the boardwalk
  put(-93.2, 20, 'e', { front: 'live', back: 'jotp', w: 9, h: 4.2 }); // West Line Rd
  // ---- ads ----
  put(-150, -50.2, 'e', { front: 'jotp', back: 'ajs' }); // Porch St through the jungle
  put(-93.4, -128, 's', { front: 'mart', back: 'suds' }); // West Line Rd, by BABYLON's wall
  put(108, -25, 's', { front: 'tower', back: 'grams', y0: 6.5, clear: 1.6, w: 10 }); // on the bank's roof
  put(-27, 59.8, 'w', { front: 'lake', back: 'shack', w: 8, h: 3.8 }); // Ocean Drive
  put(-150, 73.6, 'n', { front: 'kicks', back: 'docks', w: 8, h: 3.8 }); // the docks' promenade
  put(92.6, 32, 'n', { front: 'wings', back: 'dimsum' }); // East Line Rd
  put(23.3, -78, 'w', { front: 'ajs', back: 'ibu', w: 8, h: 3.8, clear: 5.6 }); // the Hill, by the Food Mart
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

// =================================================================================== THE HILL
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
      else if (key === '1,1') ajsStore(b, r);
      else projectBlock(b, rng, r, `h${xi}${zi}`, zi === 0);
      // cars along the curbs: some have not moved in a long time
      for (const [z, ry] of [[z0 - 1.5, Math.PI / 2], [z1 + 1.5, -Math.PI / 2]] as const) {
        if (z < GREATER.minZ + 1) continue;
        for (let x = x0 + 4; x < x1 - 4; x += rng.range(9, 16)) {
          if (!rng.chance(0.45)) continue;
          if (rng.chance(0.18)) b.rbox('burntcar', x, z, 1.8, 4.2, 0.28, 1.25, ry);
          else b.prop('car', x, z, ry, rng.int(8));
        }
      }
      b.prop('lamp', x0 + 1.2, z1 - 1.1, 0, 0);
      if (zi === 1) b.prop('hydrant', x1 - 1.2, z1 - 1.2, 0, 0);
      // the sidewalks and gutters all round the block: litter, bags left at the curb,
      // trash cans nobody empties
      const ring: Rect[] = [
        { x0: x0 - 1.4, x1: x1 + 1.4, z0: z1 - 2.2, z1: z1 + 1.2 }, { x0: x0 - 1.4, x1: x1 + 1.4, z0: z0 - 1.2, z1: z0 + 2.2 },
        { x0: x0 - 1.2, x1: x0 + 2.2, z0, z1 }, { x0: x1 - 2.2, x1: x1 + 1.2, z0, z1 },
      ];
      for (const q of ring) {
        if (q.z0 < GREATER.minZ + 0.5) continue;
        const long = Math.max(q.x1 - q.x0, q.z1 - q.z0);
        filth(b, rng, q, Math.round(long * 1.1), Math.round(long * 0.16));
      }
      for (const [tx, tz] of [[x0 + 1.1, z0 + 1.1], [x1 - 1.1, z1 - 1.3], [(x0 + x1) / 2, z1 - 1.0]] as const) {
        if (tz < GREATER.minZ + 2) continue;
        b.prop('trashcan', tx, tz, rng.range(0, 6), 0);
        filth(b, rng, { x0: tx - 1.2, x1: tx + 1.2, z0: tz - 1.2, z1: tz + 1.2 }, 7, 3, [{ x0: tx - 0.35, x1: tx + 0.35, z0: tz - 0.35, z1: tz + 0.35 }]);
      }
      b.hotspot((x0 + x1) / 2, z1 + 0.5);
    });
  });
  // the housing authority's sign, tagged over
  b.box('post', -80.4, -80.2, -62.6, -62.4, 0, 2.6, { color: 0x4a4a48 });
  b.box('post', -76.6, -76.4, -62.6, -62.4, 0, 2.6, { color: 0x4a4a48 });
  b.sign({ text: 'THE HILL HOMES · HOUSING AUTHORITY', x: -78.4, y: 2.1, z: -62.44, yaw: Math.PI, width: 4.2, height: 0.9, style: 'store', color: '#e9e2c9', bg: '#3b4a3a' });
  b.sign({ text: 'SEC 8', x: -78.2, y: 1.35, z: -62.42, yaw: Math.PI, width: 2.0, height: 0.7, style: 'graffiti', color: '#ff4fa3' });
}

/** Tags sprayed on THE HILL's walls. */
const HILL_TAGS = ['HILL BOYZ', 'RIP TEE', 'SEC 8', 'NO SNITCH', '187', 'FREE DRE', 'HILLSIDE', 'TRAP', 'RENT DUE', 'BROKE', '5-0 OUT', 'ONE WAY'];
const HILL_TAG_COLORS = ['#ff4fa3', '#4fd1ff', '#ffe14d', '#7dff6b', '#ff8a3d', '#c59bff', '#ffffff', '#e23b3b'];
const TRASH_PAPER = [0xe9e4d6, 0xd9d2bf, 0xc9b98f, 0xb8b2a4, 0xd94a3a, 0x3f7fd1, 0xf2c94c, 0x8a8478];
const TRASH_BAGS = [0x1b1c1e, 0x232528, 0x1f2a22, 0xe6e6e2, 0x2a2420];

/**
 * Litter over a rectangle: scraps of paper and wrappers, cups, and trash bags (some torn open),
 * skipping the `keep` rectangles (buildings). All of it is drawn only: nothing to trip on.
 */
function filth(b: MapBuilder, rng: Rng, r: Rect, scraps: number, bags: number, keep: Rect[] = []): void {
  const spot = (): [number, number] | null => {
    for (let k = 0; k < 8; k++) {
      const x = rng.range(r.x0, r.x1), z = rng.range(r.z0, r.z1);
      if (!keep.some((q) => inRect(q, x, z, 0.4))) return [x, z];
    }
    return null;
  };
  for (let i = 0; i < scraps; i++) {
    const p = spot();
    if (!p) continue;
    const w = rng.range(0.14, 0.5), d = rng.range(0.12, 0.36);
    b.solids.push({ kind: 'litter', x: p[0], y: 0.022 + (i % 5) * 0.001, z: p[1], sx: w, sy: 0.006, sz: d, ry: rng.range(0, Math.PI), col: 'none', color: rng.pick(TRASH_PAPER) });
    // a few cans and cups standing or tipped
    if (rng.chance(0.18)) b.solids.push({ kind: 'litter', x: p[0] + rng.range(-0.4, 0.4), y: 0.06, z: p[1] + rng.range(-0.4, 0.4), sx: 0.08, sy: 0.12, sz: 0.08, ry: rng.range(0, 3), col: 'none', color: rng.pick([0xc23a2a, 0x2f6fd1, 0xd9d9d4, 0x3a8a4a]) });
  }
  for (let i = 0; i < bags; i++) {
    const p = spot();
    if (!p) continue;
    // bags pile up: one to three together
    const n = 1 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const s = rng.range(0.45, 0.8);
      b.solids.push({ kind: 'trashbag', x: p[0] + rng.range(-0.5, 0.5) * k, y: s * 0.36, z: p[1] + rng.range(-0.5, 0.5) * k, sx: s, sy: s * 0.8, sz: s * rng.range(0.8, 1.1), ry: rng.range(0, 6), col: 'none', color: rng.pick(TRASH_BAGS) });
    }
  }
}

/**
 * A block of THE HILL: Section 8 walk-ups. Tired brick apartment blocks (you can go into every
 * one: stair halls, a unit on each floor, the roof) round a dirt yard that nobody has cleaned
 * in years: overflowing dumpsters, bags of trash, a stripped car, a couch somebody dragged out,
 * broken windows, tags on every wall.
 */
function projectBlock(b: MapBuilder, rng: Rng, r: Rect, id: string, northEdge: boolean): void {
  const yard: Rect = { x0: r.x0 + 2.2, x1: r.x1 - 2.2, z0: r.z0 + 2.2, z1: r.z1 - 2.2 };
  b.area('dirt', yard.x0, yard.x1, yard.z0, yard.z1, 1, 0x8f7f69);
  // what is left of the grass
  for (let i = 0; i < 5; i++) {
    const x = rng.range(yard.x0 + 1, yard.x1 - 5), z = rng.range(yard.z0 + 1, yard.z1 - 4);
    b.area('grass', x, x + rng.range(2, 4.5), z, z + rng.range(1.5, 3.5), 2, 0x9aa57c);
  }
  const keep: Rect[] = [];
  const w = (r.x1 - r.x0 - 7.0) / 2;
  let n = 0;
  /** One walk-up; some of its windows are already broken. */
  const walkUp = (x0: number, z0: number, facing: Side, fireEscape: boolean) => {
    const R = { x0, x1: x0 + w, z0, z1: z0 + 11 };
    const first = b.windows.length;
    const name = `${id}_${n++}`;
    construct(b, {
      id: name, type: 'apartment', ...R, facing, floors: rng.pick([3, 3, 4]), fireEscape,
      style: rng.pick(['brickdark', 'apartment', 'brickdark']), color: rng.pick([0x6f5246, 0x7a5a4b, 0x8a7566, 0x66544c]), plaster: rng.pick([0xbfb49c, 0xb7ad9c, 0xc2b6a0]),
    });
    for (let i = first; i < b.windows.length; i++) if (b.windows[i].breakable && rng.chance(0.2)) b.windows[i].broken = true;
    keep.push({ x0: R.x0 - 2.4, x1: R.x1 + 2.4, z0: R.z0 - 0.3, z1: R.z1 + 0.3 });
    // tags on the back wall and a side
    const back = facing === 's' ? R.z0 - 0.07 : R.z1 + 0.07;
    for (let k = 0; k < 2; k++) {
      b.sign({
        text: rng.pick(HILL_TAGS), x: R.x0 + 1.8 + k * (w - 3.6) + rng.range(-0.4, 0.4), y: rng.range(1.2, 1.9), z: back,
        yaw: facing === 's' ? 0 : Math.PI, width: rng.range(2.2, 3.4), height: rng.range(0.8, 1.2), style: 'graffiti', color: rng.pick(HILL_TAG_COLORS),
      });
    }
    b.hotspot((R.x0 + R.x1) / 2, facing === 's' ? R.z1 + 2 : R.z0 - 2);
  };
  // the row on the street to the south (its fire escape on the west end)
  const zs = r.z1 - 4.4 - 11;
  walkUp(r.x0 + 4.6, zs, 's', true);
  walkUp(r.x0 + 4.6 + w, zs, 's', false);
  // and the row behind it: facing the next street, or (at the top of the map) the yard
  if (northEdge) {
    walkUp(r.x0 + 4.6, r.z0 + 4.4, 's', true);
    walkUp(r.x0 + 4.6 + w, r.z0 + 4.4, 's', false);
  } else {
    walkUp(r.x0 + 2.4, r.z0 + 4.4, 'n', false);
    walkUp(r.x0 + 2.4 + w, r.z0 + 4.4, 'n', true);
  }

  // ---- the yard between the rows ----
  const y0 = northEdge ? r.z0 + 16.5 : r.z0 + 16.5, y1 = zs - 1.2;
  const mid = (y0 + y1) / 2;
  const cx = (r.x0 + r.x1) / 2;
  // dumpsters that stopped being emptied, bags heaped against them
  for (const dx of [-7.5, 6.5]) {
    const dz = mid + rng.range(-2, 2);
    b.prop('dumpster', cx + dx, dz, rng.range(-0.3, 0.3), rng.int(2));
    filth(b, rng, { x0: cx + dx - 2.4, x1: cx + dx + 2.4, z0: dz - 2.2, z1: dz + 2.2 }, 10, 6, [{ x0: cx + dx - 0.8, x1: cx + dx + 0.8, z0: dz - 1.2, z1: dz + 1.2 }]);
  }
  // a car on blocks, burnt out
  b.rbox('burntcar', cx + rng.range(-3, 3), mid + rng.range(-1.5, 1.5), 1.8, 4.2, 0.28, 1.25, rng.range(0, Math.PI));
  // furniture nobody came for
  b.rbox('furn', cx - 3.5 + rng.range(-1, 1), y0 + 1.2, 2.0, 0.9, 0, 0.85, rng.range(-0.4, 0.4), { col: 'solid', meta: { t: 'couch', old: 1 } });
  b.rbox('mattress', cx + 4 + rng.range(-1, 1), y1 - 1.4, 1.4, 1.95, 0, 0.22, rng.range(0, Math.PI));
  b.rbox('mattress', cx - 8 + rng.range(-1, 1), y1 - 1.0, 0.95, 1.9, 0, 0.2, rng.range(0, Math.PI));
  b.prop('tires', cx + 9, y0 + rng.range(1, 3), 0, 0);
  b.prop('pallet', cx - 9.5, mid + 4, rng.range(0, 3), 0);
  b.prop(rng.pick(['crate', 'crate_big'] as const), cx + 2.5, y0 + 1.5, rng.range(0, 3), 0);
  for (let i = 0; i < 3; i++) b.rbox('cart', cx + rng.range(-9, 9), rng.range(y0 + 1, y1 - 1), 0.6, 0.95, 0, 0.55, rng.range(0, 6), { meta: { tipped: i % 2 } });
  // standing water that never drains
  for (let i = 0; i < 3; i++) {
    const x = rng.range(yard.x0 + 2, yard.x1 - 5), z = rng.range(y0, y1 - 2);
    b.area('puddle', x, x + rng.range(1.2, 3), z, z + rng.range(0.8, 1.8), 3);
  }
  // a clothesline between two poles
  b.box('post', cx - 5, cx - 4.85, mid - 3.4, mid - 3.25, 0, 2.4, { color: 0x5c5a55 });
  b.box('post', cx + 4.85, cx + 5, mid - 3.4, mid - 3.25, 0, 2.4, { color: 0x5c5a55 });
  b.box('wire', cx - 4.9, cx + 4.9, mid - 3.34, mid - 3.31, 2.3, 2.33, { col: 'none', color: 0x2a2a2a });
  for (let i = 0; i < 5; i++) b.box('laundry', cx - 4 + i * 1.9, cx - 4 + i * 1.9 + rng.range(0.6, 1.1), mid - 3.345, mid - 3.305, 1.45 + rng.range(0, 0.3), 2.3, { col: 'none', color: rng.pick([0xd9d4c6, 0x8a2f2f, 0x2f4f7a, 0xc9b98f, 0x4a4a4a]) });
  // trash everywhere else
  filth(b, rng, yard, 70, 14, keep);
  filth(b, rng, { x0: yard.x0, x1: yard.x1, z0: y0, z1: y1 }, 45, 10, keep);
  b.loot(cx + rng.range(-6, 6), mid);
  b.loot(cx + rng.range(-8, 8), y0 + 1);
  b.hotspot(cx, mid);
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
  // the corner store: aisles, the cooler, the register, a stock room out back
  construct(b, { id: 'foodmart', type: 'store', ...M, facing: 's', color: 0xe3d2ac, sign: { text: 'TOWNE FOOD MART', color: '#ffe14d', bg: '#b3261e' } });
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
  // two walk-up apartment blocks (three floors, a unit on each), the old outside stairs still
  // running up the front to the east block's roof
  const firstWin = b.windows.length;
  construct(b, { id: 'projectsA', type: 'apartment', x0: -46, x1: -35, z0: -146, z1: -134, facing: 's', floors: 3, story: 3.0, style: 'apartment', color: 0x8a7566, plaster: 0xbfb49c });
  construct(b, { id: 'projectsB', type: 'apartment', x0: -35, x1: -24, z0: -146, z1: -134, facing: 's', floors: 3, story: 3.0, style: 'apartment', color: 0x8a7566, plaster: 0xb7ad9c, fireEscape: false, gaps: [{ side: 's', at: -31.4, w: 1.7 }] });
  for (let i = firstWin; i < b.windows.length; i += 5) if (b.windows[i].breakable) b.windows[i].broken = true;
  const pr = new Rng(0x5ec8);
  filth(b, pr, { x0: -46, x1: -24, z0: -133.5, z1: -125 }, 45, 9);
  b.rbox('mattress', -38, -127.5, 1.4, 1.95, 0, 0.22, 0.6);
  b.rbox('cart', -29, -130, 0.6, 0.95, 0, 0.55, 2.1, { meta: { tipped: 1 } });
  for (const [x, t] of [[-43, 'HILL BOYZ'], [-28, 'RIP TEE']] as const) b.sign({ text: t, x, y: 1.5, z: -146.07, yaw: 0, width: 3, height: 1, style: 'graffiti', color: '#4fd1ff' });
  b.ramp({ kind: 'stairs', x: -44, z: -133.15, y0: 0, dir: 'e', run: 12.6, rise: 9, width: 1.7, rails: 'right', style: 'concrete', group: 'projectsA' });
  construct(b, { id: 'laundry', type: 'laundromat', x0: -46, x1: -30, z0: -124, z1: -114, facing: 's', style: 'brickdark', sign: { text: 'SUDS LAUNDRY', color: '#ffffff', bg: '#2a6f97' } });
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

// =================================================================================== AJ'S
/**
 * AJ's: the clothing store on Porch St. Walk in through the glass doors; AJ works the register
 * at the back (the client puts him there and handles talking to him).
 */
export const AJS = {
  /** The shop floor. */
  rect: { x0: -45, x1: -25, z0: -80, z1: -64 },
  /** Where AJ stands behind the counter (yaw PI faces the door, +Z). */
  npc: { x: -35, z: -77.4, yaw: Math.PI },
  /** Talk to AJ from in front of the counter. */
  talk: { x: -35, z: -74.4, radius: 2.8 },
  /** Out on the sidewalk in front of the doors (free roam starts here). */
  door: { x: -35, z: -61.8, yaw: 0 },
} as const;

function ajsStore(b: MapBuilder, r: Rect): void {
  const S = AJS.rect;
  const doorX = -35;
  const windows = [-41.2, -28.8];
  b.shell({
    id: 'ajs', ...S, h: 5, style: 'brickdark', color: 0x2a2a2e,
    openings: [
      { side: 's', at: doorX, w: 3.2, top: 2.8 },
      ...windows.map((at) => ({ side: 's' as Side, at, w: 5, sill: 0.45, top: 3.2 })),
      { side: 'n', at: -28.5, w: 1.6 },
    ],
    awning: { side: 's', color: 0x141416 },
  });
  b.area('floor', S.x0 + 0.3, S.x1 - 0.3, S.z0 + 0.3, S.z1 - 0.3, 4, 0x2b2b30);
  // inside, the black brick is paneled in warm white (bright shop, dark storefront)
  const PANEL = { col: 'none' as const, color: 0xe9e4da };
  const top = 4.7, inX0 = S.x0 + 0.3, inX1 = S.x1 - 0.3, inZ0 = S.z0 + 0.3, inZ1 = S.z1 - 0.3;
  b.box('panel', inX0, inX1, inZ0, inZ0 + 0.04, 0, top, PANEL);
  b.box('panel', inX0, inX0 + 0.04, inZ0 + 0.04, inZ1 - 0.04, 0, top, PANEL);
  b.box('panel', inX1 - 0.04, inX1, inZ0 + 0.04, inZ1 - 0.04, 0, top, PANEL);
  const front = (x0: number, x1: number, y0: number, y1: number) => b.box('panel', x0, x1, inZ1 - 0.04, inZ1, y0, y1, PANEL);
  front(inX0, windows[0] - 2.5, 0, top);
  front(windows[0] + 2.5, doorX - 1.6, 0, top);
  front(doorX + 1.6, windows[1] - 2.5, 0, top);
  front(windows[1] + 2.5, inX1, 0, top);
  for (const at of windows) {
    front(at - 2.5, at + 2.5, 3.2, top);
    front(at - 2.5, at + 2.5, 0, 0.45);
  }
  front(doorX - 1.6, doorX + 1.6, 2.8, top);
  b.area('floor', doorX - 3, doorX + 3, -76, S.z1 - 0.3, 5, 0x3a3226); // a runner from the doors to the counter

  // ---- the front: gold sign, storefront glass, glass doors propped open ----
  signOn(b, "AJ'S", S, 's', 4.05, 6.2, '#f6b73c', '#121214', 1.3);
  for (const at of windows) b.box('glass', at - 2.5, at + 2.5, S.z1 - 0.2, S.z1 - 0.1, 0.45, 3.2, { col: 'fence' });
  for (const side of [-1, 1]) {
    // door leaves swung in against the walls (walk straight through), gold door frame
    b.box('glass', doorX + side * 1.6 - 0.05, doorX + side * 1.6 + 0.05, S.z1 - 1.85, S.z1 - 0.3, 0, 2.75, { col: 'none' });
    b.box('trim', doorX + side * 1.64 - 0.06, doorX + side * 1.64 + 0.06, S.z1 - 0.32, S.z1 + 0.02, 0, 2.8, { col: 'none', color: 0xd4a32a });
  }
  b.box('trim', doorX - 1.7, doorX + 1.7, S.z1 - 0.32, S.z1 + 0.02, 2.78, 2.9, { col: 'none', color: 0xd4a32a });

  // ---- window displays: a mannequin in each window wearing an AJ's fit ----
  const mannequin = (x: number, z: number, top: number, bottom: number, shoes: number, ry = 0) => {
    b.box('deck', x - 0.7, x + 0.7, z - 0.55, z + 0.55, 0, 0.35);
    const part = (dx: number, y0: number, y1: number, w: number, d: number, color: number) =>
      b.rbox('mannequin', x + Math.cos(ry) * dx, z - Math.sin(ry) * dx, w, d, y0, y1 - y0, ry, { col: 'none', color });
    part(-0.1, 0.35, 0.45, 0.14, 0.26, shoes);
    part(0.1, 0.35, 0.45, 0.14, 0.26, shoes);
    part(-0.1, 0.45, 1.2, 0.15, 0.17, bottom);
    part(0.1, 0.45, 1.2, 0.15, 0.17, bottom);
    part(0, 1.15, 1.85, 0.48, 0.28, top);
    part(-0.3, 1.25, 1.82, 0.13, 0.15, top);
    part(0.3, 1.25, 1.82, 0.13, 0.15, top);
    part(0, 1.85, 1.95, 0.11, 0.11, 0xe8e4dc);
    part(0, 1.95, 2.22, 0.21, 0.23, 0xe8e4dc);
  };
  mannequin(windows[0] - 1.2, S.z1 - 1.1, 0xd4a32a, 0x141416, 0xd4a32a, 0.25); // Gold Rush
  mannequin(windows[0] + 1.2, S.z1 - 1.1, 0x5b6b3a, 0x5b6b3a, 0x1d1d22, -0.2); // Camo Season
  mannequin(windows[1] - 1.2, S.z1 - 1.1, 0xeef3f7, 0xeef3f7, 0x9fd6f2, 0.2); // Ice Cold
  mannequin(windows[1] + 1.2, S.z1 - 1.1, 0xd45cc4, 0xd8c7a6, 0xc8ff2e, -0.25); // Block Party

  // ---- the register: AJ's counter at the back ----
  b.box('counter', doorX - 3, doorX + 3, -76.3, -75.3, 0, 1.1);
  b.box('counter', doorX + 3, doorX + 4, -79.7, -75.3, 0, 1.1);
  b.box('register', doorX + 1.6, doorX + 2.3, -76.1, -75.6, 1.13, 1.42, { col: 'none', color: 0x1b1b1f });
  b.box('trim', doorX - 3.02, doorX + 3.02, -75.32, -75.26, 0.15, 0.25, { col: 'none', color: 0xd4a32a });
  b.sign({ text: "AJ'S", x: doorX, y: 3.3, z: S.z0 + 0.36, yaw: Math.PI, width: 3.6, height: 1.1, style: 'store', color: '#f6b73c', bg: '#141416' });
  b.sign({ text: 'FITS · KICKS · ICE · WRAPS', x: doorX, y: 2.45, z: S.z0 + 0.36, yaw: Math.PI, width: 3.6, height: 0.42, style: 'store', color: '#ffffff', bg: '#141416' });

  // ---- the sneaker wall (east wall): lit shelves of kicks ----
  const KICKS = [0xf0efe9, 0xc0232b, 0x9fd6f2, 0xc8ff2e, 0x3a2a6e, 0xd4a32a, 0x141416, 0xe0e0e0, 0xff7a1a];
  let k = 0;
  for (const y of [0.7, 1.25, 1.8, 2.35]) {
    b.box('shelfboard', S.x1 - 0.75, S.x1 - 0.3, -78.6, -66.4, y - 0.04, y, { col: 'none', color: 0xe8e4dc });
    for (let z = -78.1; z < -66.6; z += 0.75) {
      const c = KICKS[k++ % KICKS.length];
      b.box('kicks', S.x1 - 0.68, S.x1 - 0.36, z - 0.14, z + 0.14, y, y + 0.13, { col: 'none', color: c });
      b.box('kicks', S.x1 - 0.68, S.x1 - 0.36, z - 0.14, z + 0.14, y, y + 0.03, { col: 'none', color: 0xf4f4f0 });
    }
  }
  b.box('bound', S.x1 - 0.8, S.x1 - 0.3, -78.7, -66.3, 0, 2.6); // keeps people off the shelves
  b.sign({ text: 'KICKS', x: S.x1 - 0.32, y: 3.05, z: -72.5, yaw: Math.PI / 2, width: 2.4, height: 0.6, style: 'store', color: '#ffffff', bg: '#141416' });

  // ---- clothing racks ----
  const GARMENTS = [0xd4a32a, 0x5b6b3a, 0x141416, 0xd45cc4, 0x2a2146, 0xeef3f7, 0xb3261e, 0x4fc3f7];
  let g = 0;
  for (const rz of [-69.6, -72.8]) {
    const x0 = -43.4, x1 = -38.6;
    for (const px of [x0, x1]) b.box('rackpost', px - 0.04, px + 0.04, rz - 0.04, rz + 0.04, 0, 1.65, { col: 'none', color: 0xc9ccd1 });
    b.box('rackpost', x0, x1, rz - 0.025, rz + 0.025, 1.6, 1.65, { col: 'none', color: 0xc9ccd1 });
    b.box('rackpost', x0 - 0.3, x0 + 0.3, rz - 0.3, rz + 0.3, 0, 0.04, { col: 'none', color: 0xc9ccd1 });
    b.box('rackpost', x1 - 0.3, x1 + 0.3, rz - 0.3, rz + 0.3, 0, 0.04, { col: 'none', color: 0xc9ccd1 });
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.36) {
      b.box('garment', x - 0.05, x + 0.05, rz - 0.28, rz + 0.28, 0.85, 1.58, { col: 'none', color: GARMENTS[g++ % GARMENTS.length] });
    }
    b.box('bound', x0 - 0.3, x1 + 0.3, rz - 0.32, rz + 0.32, 0, 1.6);
  }
  // hoodies on the west wall
  for (let z = -74.6; z < -66.6; z += 0.55) {
    b.box('garment', S.x0 + 0.32, S.x0 + 0.42, z - 0.22, z + 0.22, 1.35, 2.2, { col: 'none', color: GARMENTS[g++ % GARMENTS.length] });
  }

  // ---- the wrap case: weapon skins under glass ----
  const caseX0 = -31.5, caseX1 = -27.5, caseZ0 = -70.2, caseZ1 = -69.2;
  b.box('showcase', caseX0, caseX1, caseZ0, caseZ1, 0, 0.9, { color: 0x141416 });
  b.box('glass', caseX0, caseX1, caseZ0, caseZ1, 0.9, 1.25, { col: 'none' });
  [0xd4a32a, 0x5b6b3a, 0x4dff3a, 0xdfe6ee, 0xff3fd2].forEach((c, i) => {
    const x = caseX0 + 0.45 + i * 0.78;
    b.box('wrapdisplay', x - 0.3, x + 0.3, -69.75, -69.65, 0.92, 0.98, { col: 'none', color: c });
    b.box('wrapdisplay', x - 0.24, x - 0.14, -69.75, -69.65, 0.92, 1.08, { col: 'none', color: c });
  });
  b.sign({ text: 'WRAPS', x: (caseX0 + caseX1) / 2, y: 0.55, z: caseZ1 + 0.03, yaw: Math.PI, width: 1.6, height: 0.4, style: 'store', color: '#f6b73c', bg: '#141416' });

  // ---- fitting rooms (back west corner), curtains you walk through ----
  b.box('wall', S.x0 + 0.3, -42.45, -75.4, -75.25, 0, 2.4, { style: 'stucco', color: 0xe6e1d8, group: 'ajs' });
  b.box('wall', S.x0 + 0.3, -42.45, -77.55, -77.45, 0, 2.4, { style: 'stucco', color: 0xe6e1d8, group: 'ajs' });
  for (const z of [-78.6, -76.4]) b.box('curtain', -42.5, -42.4, z - 0.9, z + 0.9, 0.15, 2.3, { col: 'none', color: 0x7a1f2b });
  b.sign({ text: 'FITTING', x: -42.4, y: 2.65, z: -77.5, yaw: -Math.PI / 2, width: 1.6, height: 0.4, style: 'store', color: '#ffffff', bg: '#141416' });

  b.loot(-35, -67.2);
  b.label("AJ'S", -35, -72);
  b.hotspot(-35, -66);

  // ---- out back: staff parking, the dumpster ----
  b.area('lot', r.x0 + 2.2, r.x1 - 2.2, r.z0 + 2.2, S.z0 - 1, 1);
  b.prop('car', -40, -90, Math.PI / 2, 5);
  b.prop('van', -30, -90, -Math.PI / 2, 2);
  b.prop('dumpster', -26.5, -83, 0, 0);
  b.prop('tree', -45.5, -96, 0, 1);
}

// =================================================================================== JUNGLE
/** The jungle (west, middle row): the temple, the crash site, the huts, the ranger station. */
function jungle(b: MapBuilder, rng: Rng): void {
  const J: Rect = { x0: CELL.w.x0, x1: CELL.w.x1, z0: CELL.m.z0, z1: CELL.m.z1 };
  b.area('jungle', J.x0, J.x1, J.z0, J.z1, 1);
  const trails: Array<Array<{ x: number; z: number }>> = [
    [{ x: J.x1, z: 0 }, { x: -104, z: 2 }, { x: -120, z: 8 }, { x: -136, z: 11 }, { x: -150, z: 9 }],
    [{ x: -104, z: 2 }, { x: -108, z: -12 }, { x: -112, z: -20 }],
    [{ x: -120, z: 8 }, { x: -123, z: 22 }, { x: -119, z: 33 }],
    [{ x: -150, z: 9 }, { x: -158, z: 18 }, { x: -164, z: 26 }],
    [{ x: -112, z: -36 }, { x: -110, z: J.z0 }],
    [{ x: -136, z: 11 }, { x: -140, z: 34 }, { x: -146, z: 52 }, { x: -148, z: J.z1 }],
  ];
  for (const t of trails) b.road('trail', t, 3.4, false);
  const creek = [{ x: J.x0, z: -38 }, { x: -188, z: -30 }, { x: -177, z: -14 }, { x: -170, z: 2 }, { x: -160, z: 0 }, { x: -146, z: -46 }, { x: -140, z: J.z0 }];
  b.road('creek', creek, 4.5, false);
  const keep: Rect[] = [];

  // ---- the temple: a stepped ruin with a shrine on top, its stairs facing the trail ----
  {
    const cx = -150, cz = -18;
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
    const tx = -104, tz = 40;
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      b.box('post', tx + dx - 0.15, tx + dx + 0.15, tz + dz - 0.15, tz + dz + 0.15, 0, 8.4, { color: 0x6b5238 });
    }
    b.box('woodplat', tx - 2, tx + 2, tz - 2, tz + 2, 5.8, 6, { color: 0x7a5c3e });
    b.box('woodplat', tx - 2.3, tx + 2.3, tz - 2.3, tz + 2.3, 8.4, 8.6, { color: 0x5c4630 });
    b.box('rail', tx - 2, tx + 2, tz - 2, tz - 1.93, 6, 7, { col: 'fence' });
    b.box('rail', tx - 2, tx + 2, tz + 1.93, tz + 2, 6, 7, { col: 'fence' });
    b.box('rail', tx + 1.93, tx + 2, tz - 2, tz + 2, 6, 7, { col: 'fence' });
    b.ramp({ kind: 'stairs', x: tx - 10, z: tz, y0: 0, dir: 'e', run: 8, rise: 6, width: 1.4, rails: 'both', style: 'wood', group: 'lookout', thickness: 0.2 });
    b.loot(tx, tz, 6);
    keep.push({ x0: -128, x1: -94, z0: 31, z1: 49 });
    b.label('RANGER STN', -116, 40);
    b.hotspot(-116, 32);
  }

  // ---- crash site: a cargo plane that never made it to the airport ----
  {
    const cx = -180, cz = 36, ry = 0.5;
    const sx = Math.sin(ry), cz2 = Math.cos(ry);
    b.rbox('wreck', cx, cz, 3.6, 20, 0, 3.6, ry, { color: 0xd5d9de });
    b.rbox('wreck', cx + sx * 1, cz + cz2 * 1, 22, 3.2, 1.2, 0.5, ry, { color: 0xc4c9cf });
    b.rbox('wreck', cx - sx * 15, cz - cz2 * 15, 3.2, 7, 0, 3.2, ry + 0.35, { color: 0xd5d9de });
    b.rbox('wreck', cx - sx * 17.5, cz - cz2 * 17.5, 0.5, 3, 3.2, 3.4, ry + 0.35, { color: 0xb3261e });
    for (let i = 0; i < 6; i++) b.prop(i % 2 ? 'crate' : 'crate_big', cx + rng.range(-8, 8), cz + rng.range(-8, 8), rng.range(0, 3), i % 2);
    b.loot(cx + 5, cz - 6);
    b.loot(cx - 6, cz + 4);
    b.loot(cx + 3, cz + 9);
    keep.push({ x0: cx - 18, x1: cx + 16, z0: cz - 22, z1: cz + 16 });
    b.label('CRASH SITE', cx, cz);
    b.hotspot(cx + 6, cz);
  }

  // ---- a little village of huts around a fire pit ----
  {
    const cx = -115, cz = -30;
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
      if (px > J.x1 - 4 || pz > J.z1 - 4 || pz < J.z0 + 2) continue;
      if (distToLine(creek, px, pz) < 3) continue;
      if (r < 0.42) b.prop('tree', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.56) b.prop('palm', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.6) b.prop('boulder', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.66) b.prop('rock', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.69) b.prop('log', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.9) b.prop('bush', px, pz, rng.range(0, 6), rng.int(3));
    }
  }
  for (let i = 0; i < 8; i++) b.loot(rng.range(J.x0 + 8, J.x1 - 8), rng.range(J.z0 + 6, J.z1 - 6));
  for (const [x, z] of [[-104, 2], [-136, 11], [-123, 22], [-164, 26], [-112, -36], [-146, 52], [-185, 0], [-100, -40]] as const) b.hotspot(x, z);
}

// =================================================================================== BABYLON
/**
 * BABYLON (northwest): a walled desert city. The blue-tiled gate faces West Line Rd; inside are
 * the ziggurat you can climb, the terraced hanging gardens, the bazaar, an oasis and mud-brick
 * houses. JUMP OFF THE PORCH warms up here before the blimp takes off.
 */
const SANDSTONE = 0xc9a46b;
const GLAZE = 0x2e5aa8;
const GOLD_TRIM = 0xd4a32a;

function babylon(b: MapBuilder, rng: Rng): void {
  const D: Rect = { x0: CELL.w.x0, x1: CELL.w.x1, z0: CELL.n.z0, z1: CELL.n.z1 };
  b.area('desert', D.x0 - 12, D.x1, D.z0 - 12, D.z1, 1);
  const keep: Rect[] = [];
  const stone = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color = SANDSTONE) =>
    b.box('sandstone', x0, x1, z0, z1, y0, y1, { color });

  // ---- the city wall along West Line Rd, with the blue gate and a few breaches ----
  const WX = -99;
  const gateZ = -105;
  const wallSegs: Array<[number, number]> = [[-146, -128], [-124, -114.5], [-95.5, -82], [-77, -64]];
  for (const [z0, z1] of wallSegs) {
    stone(WX - 1.2, WX + 1.2, z0, z1, 0, 6.5);
    for (let z = z0 + 1; z < z1 - 0.5; z += 2.4) stone(WX - 1.25, WX + 1.25, z, z + 1.2, 6.5, 7.4); // crenellations
  }
  for (const side of [-1, 1]) {
    const z = gateZ + side * 6.5;
    b.box('glazed', WX - 3, WX + 3, z - 3, z + 3, 0, 13, { color: GLAZE });
    b.box('trim', WX - 3.05, WX + 3.05, z - 3.05, z + 3.05, 4.2, 4.6, { color: GOLD_TRIM, col: 'none' });
    b.box('trim', WX - 3.05, WX + 3.05, z - 3.05, z + 3.05, 9.2, 9.6, { color: GOLD_TRIM, col: 'none' });
    for (let k = -1; k <= 1; k++) b.box('glazed', WX - 3.1, WX + 3.1, z + k * 2 - 0.5, z + k * 2 + 0.5, 13, 14.2, { color: GLAZE });
    b.box('trim', WX + 3.02, WX + 3.12, z - 1.2, z + 1.2, 6, 7.4, { color: 0xf2e4c0, col: 'none' }); // lion relief
  }
  b.box('glazed', WX - 3, WX + 3, gateZ - 3.5, gateZ + 3.5, 7.5, 11, { color: GLAZE });
  b.box('trim', WX + 3.02, WX + 3.1, gateZ - 3.5, gateZ + 3.5, 7.6, 8.0, { color: GOLD_TRIM, col: 'none' });
  b.box('trim', WX - 3.1, WX - 3.02, gateZ - 3.5, gateZ + 3.5, 7.6, 8.0, { color: GOLD_TRIM, col: 'none' });
  b.sign({ text: 'BABYLON', x: WX + 3.15, y: 9.3, z: gateZ, yaw: -Math.PI / 2, width: 6, height: 1.4, style: 'store', color: '#ffd977', bg: '#1d3f80' });
  b.sign({ text: 'BABYLON', x: WX - 3.15, y: 9.3, z: gateZ, yaw: Math.PI / 2, width: 6, height: 1.4, style: 'store', color: '#ffd977', bg: '#1d3f80' });
  keep.push({ x0: WX - 8, x1: WX + 8, z0: gateZ - 12, z1: gateZ + 12 });
  b.hotspot(WX - 6, gateZ);

  // ---- the ziggurat: three tiers, a long stair up the east face, a shrine on top ----
  {
    const cx = -150, cz = -124;
    stone(cx - 20, cx + 20, cz - 20, cz + 20, 0, 4, 0xc29a62);
    stone(cx - 14.5, cx + 14.5, cz - 14.5, cz + 14.5, 4, 8, 0xcda772);
    stone(cx - 9, cx + 9, cz - 9, cz + 9, 8, 12, 0xd6b27d);
    b.shell({
      id: 'zigshrine', x0: cx - 4.5, x1: cx + 4.5, z0: cz - 4.5, z1: cz + 4.5, y0: 12, h: 16.2, style: 'sandstone', color: GLAZE,
      openings: (['n', 's', 'e', 'w'] as Side[]).map((side) => ({ side, at: side === 'n' || side === 's' ? cx : cz, w: 2.2, top: 2.6 })),
    });
    b.ramp({ kind: 'stairs', x: cx + 9 + 26, z: cz, y0: 0, dir: 'w', run: 26, rise: 12, width: 5, fill: true, style: 'ruin', group: 'ziggurat' });
    b.loot(cx - 1.5, cz, 12);
    b.loot(cx + 1.5, cz, 12);
    for (const [dx, dz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) b.loot(cx + dx, cz + dz, 4);
    for (const [dx, dz] of [[-12, 0], [0, -12], [0, 12]]) b.loot(cx + dx, cz + dz, 8);
    keep.push({ x0: cx - 24, x1: cx + 40, z0: cz - 24, z1: cz + 24 });
    b.label('ZIGGURAT', cx, cz);
    b.hotspot(cx + 30, cz);
    b.hotspot(cx, cz);
  }

  // ---- the hanging gardens: green terraces stepping up, palms on every level ----
  {
    const cx = -180, cz = -82;
    const tiers: Array<[number, number]> = [[13, 3], [9, 6], [5, 9]];
    tiers.forEach(([half, top], i) => {
      const y0 = i === 0 ? 0 : tiers[i - 1][1];
      stone(cx - half, cx + half, cz - half, cz + half, y0, top, i % 2 ? 0xcfa871 : 0xbf9a62);
      // planters along the back and the west side (the stairs come up the south side)
      b.box('planter', cx - half, cx + half, cz - half, cz - half + 1.2, top, top + 0.7);
      b.box('planter', cx - half, cx - half + 1.2, cz - half + 1.2, cz + half - 3, top, top + 0.7);
      for (const dx of [-half + 2.5, half - 2.5]) b.prop('palm', cx + dx, cz - half + 2.5, rng.range(0, 6), rng.int(3), top);
      b.prop('bush', cx + half - 3, cz + half - 3, 0, rng.int(3), top);
      // the flight up from the terrace below (or the sand) to this terrace's front edge
      const below = i === 0 ? half + 5 : tiers[i - 1][0];
      b.ramp({ kind: 'stairs', x: cx + (i === 1 ? -5 : i === 2 ? 3 : 0), z: cz + below, y0, dir: 'n', run: below - half, rise: top - y0, width: i === 2 ? 2.4 : 3, fill: true, style: 'ruin', group: 'gardens' });
    });
    b.loot(cx, cz, 9);
    b.loot(cx - 7, cz - 7, 6);
    b.loot(cx + 10, cz - 10, 3);
    keep.push({ x0: cx - 16, x1: cx + 16, z0: cz - 16, z1: cz + 19 });
    b.label('HANGING GARDENS', cx, cz);
    b.hotspot(cx, cz + 19);
  }

  // ---- the bazaar: rows of stalls under colored cloth ----
  {
    const cx = -128, cz = -80;
    b.area('dirt', cx - 18, cx + 18, cz - 12, cz + 12, 2);
    const cloth = [0xb3261e, 0xd4a32a, 0x2e5aa8, 0x3d7a4a, 0x7a3fa0, 0xe07a2a];
    let n = 0;
    for (const row of [-6, 6]) {
      for (let x = cx - 14; x <= cx + 14; x += 7) {
        const z = cz + row;
        for (const [dx, dz] of [[-2.6, -1.8], [2.6, -1.8], [-2.6, 1.8], [2.6, 1.8]]) b.box('post', x + dx - 0.08, x + dx + 0.08, z + dz - 0.08, z + dz + 0.08, 0, 2.7, { color: 0x7a5c3e });
        b.box('canopy', x - 3, x + 3, z - 2.2, z + 2.2, 2.7, 2.85, { color: cloth[n++ % cloth.length], col: 'none' });
        b.box('counter', x - 2.2, x + 2.2, z + (row < 0 ? 1.2 : -1.6), z + (row < 0 ? 1.6 : -1.2), 0, 1.0);
        if (rng.chance(0.5)) b.prop('crate', x + rng.range(-1.5, 1.5), z + (row < 0 ? -1 : 1), rng.range(0, 3), 0);
        if (n % 2 === 0) b.loot(x, z + (row < 0 ? -0.4 : 0.4));
      }
    }
    keep.push({ x0: cx - 19, x1: cx + 19, z0: cz - 13, z1: cz + 13 });
    b.label('BAZAAR', cx, cz);
    b.hotspot(cx, cz);
  }

  // ---- the oasis: water, palms, a well ----
  {
    const cx = -185, cz = -133;
    b.area('grass', cx - 13, cx + 13, cz - 10, cz + 10, 2);
    b.area('oasis', cx - 8, cx + 8, cz - 5, cz + 5, 3);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.range(-0.15, 0.15);
      b.prop('palm', cx + Math.cos(a) * rng.range(9.5, 11.5), cz + Math.sin(a) * rng.range(7, 8.5), rng.range(0, 6), rng.int(3));
    }
    stone(cx + 10, cx + 12, cz + 6, cz + 8, 0, 0.9, 0xb89262);
    b.loot(cx + 11, cz - 8);
    keep.push({ x0: cx - 14, x1: cx + 14, z0: cz - 11, z1: cz + 11 });
    b.label('OASIS', cx, cz);
    b.hotspot(cx + 12, cz);
  }

  // ---- mud-brick houses (walk-in, loot inside) ----
  const houses: Array<[number, number, number, number, Side]> = [
    [-109, -140, 8, 7, 'w'], [-109, -126, 7, 6, 'w'], [-152, -91, 8, 6, 's'], [-158, -69, 8, 6, 's'], [-112, -96, 7, 6, 'n'],
  ];
  houses.forEach(([x, z, w, d, side], i) => {
    const R = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    room(b, `mudhouse${i}`, R, 3.4, 'mudbrick', [...frontage(side, R, 1.6), { side: opposite(side), at: side === 'n' || side === 's' ? x + 1.5 : z + 1.5, w: 1.2, sill: 1.1, top: 2.2 }], { loot: rng.chance(0.5) ? 2 : 1 });
    keep.push({ x0: R.x0 - 3, x1: R.x1 + 3, z0: R.z0 - 3, z1: R.z1 + 3 });
    b.hotspot(x, z + (side === 's' ? d : side === 'n' ? -d : 0));
  });

  // ---- broken columns and ruined walls ----
  for (let i = 0; i < 9; i++) {
    const x = rng.range(D.x0 + 8, D.x1 - 20), z = rng.range(D.z0 + 8, D.z1 - 6);
    if (keep.some((k) => inRect(k, x, z, 3))) continue;
    if (rng.chance(0.5)) {
      for (let c = 0; c < 4; c++) stone(x + c * 3 - 0.6, x + c * 3 + 0.6, z - 0.6, z + 0.6, 0, rng.range(1, 4.5), 0xd0b17e);
    } else {
      const len = rng.range(5, 9);
      stone(x, x + len, z, z + 1, 0, rng.range(1.2, 3), 0xbf9a62);
    }
    keep.push({ x0: x - 2, x1: x + 14, z0: z - 2, z1: z + 3 });
  }

  // ---- trails across the sand ----
  const trails: Array<Array<{ x: number; z: number }>> = [
    [{ x: WX + 2, z: gateZ }, { x: -108, z: -106 }, { x: -114, z: -114 }, { x: -116, z: -122 }],
    [{ x: -108, z: -106 }, { x: -120, z: -96 }, { x: -128, z: -92 }],
    [{ x: -146, z: -80 }, { x: -158, z: -76 }, { x: -170, z: -62 }],
    [{ x: -170, z: -102 }, { x: -176, z: -118 }],
  ];
  for (const t of trails) b.road('trail', t, 3.4, false);

  // ---- open desert: rocks, boulders, a few dry palms ----
  for (let x = D.x0 + 4; x < D.x1 - 3; x += 8) {
    for (let z = D.z0 + 4; z < D.z1 - 4; z += 8) {
      const px = x + rng.range(-2.5, 2.5), pz = z + rng.range(-2.5, 2.5);
      const r = rng.next();
      if (keep.some((k) => inRect(k, px, pz, 1))) continue;
      if (Math.min(...trails.map((t) => distToLine(t, px, pz))) < 3.5) continue;
      if (Math.abs(px - WX) < 3) continue;
      if (r < 0.1) b.prop('boulder', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.28) b.prop('rock', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.32) b.prop('palm', px, pz, rng.range(0, 6), rng.int(3));
      else if (r < 0.38) b.prop('bush', px, pz, rng.range(0, 6), 2);
    }
  }
  for (let i = 0; i < 6; i++) b.loot(rng.range(D.x0 + 8, D.x1 - 14), rng.range(D.z0 + 8, D.z1 - 8));
  for (const [x, z] of [[-120, -140], [-190, -110], [-130, -100], [-168, -96], [-104, -70]] as const) b.hotspot(x, z);
}

// =================================================================================== HONG KONG
/**
 * HONG KONG (northeast): Chinatown. Through the paifang gate off East Line Rd, Lantern Street
 * runs east between tall tenements (shops below, balconies above, neon signs), a dim sum
 * restaurant and an herbal shop, under strings of red lanterns. North of the street a pagoda
 * temple in its courtyard; south of it the night market and a koi garden.
 */
const HK_RED = 0xb3261e;
const HK_JADE = 0x2f7a5a;
const HK_GOLD = 0xd4a32a;

function hongKong(b: MapBuilder, rng: Rng): void {
  const K: Rect = { x0: CELL.e.x0, x1: CELL.e.x1, z0: CELL.n.z0, z1: CELL.n.z1 };
  b.area('plaza', K.x0, K.x1, K.z0, K.z1, 1, 0xc9c2b4);
  const SZ = -105; // Lantern Street
  b.road('road', [{ x: 81.5, z: SZ }, { x: K.x1 - 2, z: SZ }], 8, false);
  b.area('sidewalk', K.x0, K.x1, SZ - 7, SZ - 4, 1);
  b.area('sidewalk', K.x0, K.x1, SZ + 4, SZ + 7, 1);
  // a lane down to Porch St
  b.road('road', [{ x: 160, z: SZ }, { x: 160, z: K.z1 }], 6, false);

  // ---- the paifang: a red gate over the street with a jade-tiled roof ----
  {
    const gx = 95.5;
    for (const z of [SZ - 5.2, SZ + 5.2]) {
      b.box('pillar', gx - 0.45, gx + 0.45, z - 0.45, z + 0.45, 0, 6.4, { color: HK_RED });
      b.box('trim', gx - 0.6, gx + 0.6, z - 0.6, z + 0.6, 0, 0.6, { color: 0x8a8378, col: 'solid' });
    }
    for (const z of [SZ - 7.6, SZ + 7.6]) b.box('pillar', gx - 0.3, gx + 0.3, z - 0.3, z + 0.3, 0, 4.4, { color: HK_RED });
    b.box('beam', gx - 0.35, gx + 0.35, SZ - 5.8, SZ + 5.8, 5.2, 5.7, { color: HK_RED, col: 'none' });
    b.box('beam', gx - 0.4, gx + 0.4, SZ - 5.8, SZ + 5.8, 6.4, 6.9, { color: HK_GOLD, col: 'none' });
    b.box('roofplane', gx - 1.4, gx + 1.4, SZ - 7.2, SZ + 7.2, 6.9, 7.2, { color: HK_JADE, col: 'none', style: 'tile' });
    b.box('roofplane', gx - 0.9, gx + 0.9, SZ - 6.2, SZ + 6.2, 7.2, 7.6, { color: HK_JADE, col: 'none', style: 'tile' });
    // the upturned ends of the eaves
    for (const z of [SZ - 7.2, SZ + 7.2]) b.rbox('roofplane', gx, z, 2.8, 0.9, 6.95, 0.25, 0, { rx: z < SZ ? 0.45 : -0.45, color: HK_JADE, col: 'none', style: 'tile' });
    for (const z of [SZ - 7.6, SZ + 7.6]) b.box('roofplane', gx - 0.8, gx + 0.8, z - 1.2, z + 1.2, 4.4, 4.7, { color: HK_JADE, col: 'none', style: 'tile' });
    b.sign({ text: '唐人街 HONG KONG', x: gx + 0.42, y: 5.95, z: SZ, yaw: -Math.PI / 2, width: 7.6, height: 0.9, style: 'store', color: '#ffd977', bg: '#8c1414' });
    b.sign({ text: '唐人街 HONG KONG', x: gx - 0.42, y: 5.95, z: SZ, yaw: Math.PI / 2, width: 7.6, height: 0.9, style: 'store', color: '#ffd977', bg: '#8c1414' });
    b.hotspot(gx + 4, SZ);
  }

  const neon = ['#ff3fa4', '#3ff0ff', '#ffe14d', '#7dff6b', '#ff8a3d'];
  const blades = ['龍', '福', '茶', '麻雀', '當', '酒店', '金', '藥'];
  /** A sign out front of a building facing the street, and a neon blade sign at the corner. */
  const signs = (x0: number, x1: number, front: number, facing: 'n' | 's', text: string, i: number) => {
    const out = facing === 's' ? 1 : -1;
    b.sign({ text, x: (x0 + x1) / 2, y: 3.35, z: front + out * 0.08, yaw: facing === 's' ? Math.PI : 0, width: Math.min(x1 - x0 - 1.5, 7.5), height: 0.9, style: 'store', color: neon[i % neon.length], bg: '#1a1416' });
    const bx = x1 - 0.8;
    b.sign({ text: blades[i % blades.length], x: bx, y: 6.2, z: front + out * 0.9, yaw: Math.PI / 2, width: 1.0, height: 2.6, style: 'store', color: neon[(i + 2) % neon.length], bg: '#24101a' });
    b.sign({ text: blades[i % blades.length], x: bx, y: 6.2, z: front + out * 0.9, yaw: -Math.PI / 2, width: 1.0, height: 2.6, style: 'store', color: neon[(i + 2) % neon.length], bg: '#24101a' });
  };

  // ---- north side of Lantern Street (fronts face south onto it) ----
  const north = SZ - 7.5;
  const tenementsN: Array<[number, number, number]> = [[99, 110, 5], [111.5, 122.5, 6], [166, 177, 4]];
  tenementsN.forEach(([x0, x1, F], i) => {
    construct(b, { id: `hkN${i}`, type: 'tenement', x0, x1, z0: north - 11, z1: north, facing: 's', floors: F, color: [0xd8c7a6, 0xc9b8a0, 0xb8c4b0][i % 3] });
    signs(x0, x1, north, 's', ['金龍 GOLD DRAGON', '福 LUCKY MART', '麻雀 MAHJONG'][i], i);
  });
  construct(b, {
    id: 'dimsum', type: 'restaurant', x0: 179, x1: 196, z0: north - 12, z1: north, facing: 's', floors: 2, color: 0xe8dcc0,
    sign: { text: '茶樓 DIM SUM PALACE', color: '#ffd977', bg: '#8c1414' },
  });

  // ---- the pagoda temple in its courtyard ----
  {
    const C = { x0: 126, x1: 160, z0: K.z0 + 3, z1: north };
    b.area('concrete', C.x0, C.x1, C.z0, C.z1, 2, 0xb8b0a2);
    // a red wall around the courtyard, open to the street through a moon gate
    const wall = (x0: number, x1: number, z0: number, z1: number) => b.box('lowwall', x0, x1, z0, z1, 0, 2.4, { color: HK_RED });
    wall(C.x0, C.x0 + 0.4, C.z0, C.z1);
    wall(C.x1 - 0.4, C.x1, C.z0, C.z1);
    wall(C.x0, (C.x0 + C.x1) / 2 - 2, C.z1 - 0.4, C.z1);
    wall((C.x0 + C.x1) / 2 + 2, C.x1, C.z1 - 0.4, C.z1);
    const cx = (C.x0 + C.x1) / 2, cz = (C.z0 + C.z1) / 2 - 3;
    // the plinth and five storeys, each with a wide jade roof; you can walk into the ground floor
    b.box('plinth', cx - 8, cx + 8, cz - 8, cz + 8, 0, 0.8, { color: 0xb9b4a8 });
    b.ramp({ kind: 'stairs', x: cx, z: cz + 10.5, y0: 0, dir: 'n', run: 2.5, rise: 0.8, width: 4, fill: true, style: 'concrete', group: 'pagoda' });
    b.shell({
      id: 'pagoda', x0: cx - 5, x1: cx + 5, z0: cz - 5, z1: cz + 5, y0: 0.8, h: 4.4, style: 'stucco', color: HK_RED,
      openings: (['n', 's', 'e', 'w'] as Side[]).map((side) => ({ side, at: side === 'n' || side === 's' ? cx : cz, w: 2, top: 2.6 })),
    });
    b.box('altar', cx - 0.8, cx + 0.8, cz - 3.9, cz - 3.2, 0.8, 1.85, { color: 0x8c1f1f });
    b.rbox('furn', cx, cz - 3.5, 1.6, 0.7, 0.8, 1.05, Math.PI, { col: 'solid', meta: { t: 'altar', int: 1 } });
    b.loot(cx - 2.5, cz, 0.8);
    b.loot(cx + 2.5, cz + 2, 0.8);
    let y = 4.4;
    for (let t = 0; t < 5; t++) {
      const half = 5 - t * 0.75, eave = half + 1.6 - t * 0.15;
      b.box('roofplane', cx - eave, cx + eave, cz - eave, cz + eave, y, y + 0.35, { color: HK_JADE, style: 'tile' });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box('trim', cx + dx * eave - 0.3, cx + dx * eave + 0.3, cz + dz * eave - 0.3, cz + dz * eave + 0.3, y + 0.35, y + 0.75, { color: HK_GOLD, col: 'none' });
      if (t < 4) {
        b.box('sandstone', cx - half + 0.75, cx + half - 0.75, cz - half + 0.75, cz + half - 0.75, y + 0.35, y + 3.1, { color: t % 2 ? 0xc23a2a : HK_RED });
        y += 3.1;
      }
    }
    b.box('trim', cx - 0.15, cx + 0.15, cz - 0.15, cz + 0.15, y + 0.35, y + 3.2, { color: HK_GOLD, col: 'none' });
    // incense burner and stone lions by the gate
    b.box('plinth', cx - 0.8, cx + 0.8, cz + 13.5, cz + 15.1, 0, 1.1, { color: 0x6b5a3a });
    for (const dx of [-3.4, 3.4]) b.box('plinth', cx + dx - 0.7, cx + dx + 0.7, C.z1 - 2.4, C.z1 - 1, 0, 1.6, { color: 0x9a948a });
    for (let i = 0; i < 6; i++) b.rbox('furn', cx - 12 + i * 4.8, C.z0 + 2.5, 0.4, 0.4, 0.5, 0.5, 0, { col: 'none', meta: { t: 'lantern' } });
    b.loot(cx + 10, cz + 8);
    b.label('PAGODA', cx, cz);
    b.hotspot(cx, cz + 12);
  }

  // ---- south side of Lantern Street (fronts face north onto it) ----
  const south = SZ + 7.5;
  construct(b, { id: 'herbal', type: 'store', x0: 99, x1: 110, z0: south, z1: south + 10, facing: 'n', color: 0xd9cdb0, sign: { text: '藥行 HERBAL MEDICINE', color: '#7dff6b', bg: '#14281c' } });
  const tenementsS: Array<[number, number, number]> = [[111.5, 122.5, 5], [165, 176, 6], [177.5, 188.5, 4]];
  tenementsS.forEach(([x0, x1, F], i) => {
    construct(b, { id: `hkS${i}`, type: 'tenement', x0, x1, z0: south, z1: south + 11, facing: 'n', floors: F, color: [0xc7d0c4, 0xd6c3b6, 0xcfc7aa][i % 3] });
    signs(x0, x1, south, 'n', ['當 PAWN', '酒店 HOTEL', '金 GOLD'][i], i + 3);
  });
  construct(b, { id: 'hkbarber', type: 'barbershop', x0: 190, x1: 199, z0: south, z1: south + 10, facing: 'n', color: 0xe3d2ac, sign: { text: '剪 BARBER', color: '#ffffff', bg: '#1d3f80' } });

  // ---- the night market: rows of stalls under lanterns ----
  {
    const M = { x0: 126, x1: 157, z0: south + 1, z1: south + 24 };
    b.area('concrete', M.x0, M.x1, M.z0, M.z1, 2, 0xa9a39a);
    for (const row of [M.z0 + 4, M.z0 + 12, M.z0 + 20]) {
      for (let x = M.x0 + 3; x < M.x1 - 2; x += 5.2) {
        b.rbox('furn', x, row, 2.4, 1.2, 0, 1.0, row === M.z0 + 12 ? Math.PI : 0, { col: 'solid', meta: { t: 'stall' } });
        if (rng.chance(0.35)) b.loot(x, row + (row === M.z0 + 12 ? -1.3 : 1.3));
      }
    }
    b.label('NIGHT MARKET', (M.x0 + M.x1) / 2, (M.z0 + M.z1) / 2);
    b.hotspot((M.x0 + M.x1) / 2, M.z0 + 8);
    b.hotspot((M.x0 + M.x1) / 2, M.z0 + 16);
  }

  // ---- the koi garden: a pond, a bridge, a little pavilion ----
  {
    const G = { x0: 166, x1: 197, z0: south + 14, z1: K.z1 - 2 };
    b.area('grass', G.x0, G.x1, G.z0, G.z1, 2);
    const pcx = (G.x0 + G.x1) / 2, pcz = (G.z0 + G.z1) / 2;
    b.area('oasis', pcx - 9, pcx + 9, pcz - 4, pcz + 4, 3);
    b.box('deck', pcx - 1.2, pcx + 1.2, pcz - 5, pcz + 5, 0, 0.35, { color: HK_RED });
    b.box('rail', pcx - 1.2, pcx - 1.13, pcz - 4.5, pcz + 4.5, 0.35, 1.2, { col: 'fence' });
    b.box('rail', pcx + 1.13, pcx + 1.2, pcz - 4.5, pcz + 4.5, 0.35, 1.2, { col: 'fence' });
    const px = G.x1 - 5, pz = G.z0 + 4;
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) b.box('pillar', px + dx - 0.15, px + dx + 0.15, pz + dz - 0.15, pz + dz + 0.15, 0, 2.8, { color: HK_RED });
    b.box('roofplane', px - 3, px + 3, pz - 3, pz + 3, 2.8, 3.1, { color: HK_JADE, style: 'tile' });
    for (let i = 0; i < 6; i++) b.prop('tree', G.x0 + 2 + rng.range(0, G.x1 - G.x0 - 4), rng.chance(0.5) ? G.z0 + 1.5 : G.z1 - 1.5, 0, rng.int(3));
    b.loot(px, pz);
    b.label('KOI GARDEN', pcx, pcz);
    b.hotspot(pcx, pcz + 6);
  }

  // ---- lanterns strung across the street ----
  for (let x = 101; x < K.x1 - 4; x += 6.5) {
    b.box('wire', x - 0.02, x + 0.02, SZ - 7.3, SZ + 7.3, 4.95, 4.99, { col: 'none', color: 0x222222 });
    for (const dz of [-4.5, -1.5, 1.5, 4.5]) b.rbox('furn', x, SZ + dz, 0.4, 0.4, 2.55, 0.5, 0, { col: 'none', meta: { t: 'lantern' } });
  }
  // parked scooters and cars, a few crates
  for (let x = 102; x < K.x1 - 6; x += rng.range(10, 18)) if (rng.chance(0.5)) b.prop('car', x, SZ + (rng.chance(0.5) ? 2.2 : -2.2), Math.PI / 2, rng.int(8));
  for (let i = 0; i < 5; i++) b.prop(rng.chance(0.5) ? 'crate' : 'pallet', rng.range(126, 157), north - rng.range(12, 30), rng.range(0, 3), 0);
  for (const [x, z] of [[105, SZ], [130, SZ], [175, SZ], [190, SZ], [160, -75]] as const) b.hotspot(x, z);
}

// =================================================================================== DOWNTOWN
/**
 * DOWNTOWN (east, middle row): the bank, the parking garage, WHOOPA TOWER, the plaza, a hotel
 * row, and a block of explorable offices, a restaurant and a store.
 */
function downtown(b: MapBuilder, rng: Rng): void {
  const xs: Array<[number, number]> = [[90.5, 125], [135, 165], [175, 200]];
  const zs: Array<[number, number]> = [[-45, -5], [5, 61]];
  b.road('road', [{ x: 81.5, z: 0 }, { x: GREATER.maxX, z: 0 }], 10, true); // Main Ave
  for (const x of [130, 170]) b.road('road', [{ x, z: -51.5 }, { x, z: 61 }], 10, true);

  xs.forEach(([x0, x1], xi) => {
    zs.forEach(([z0, z1], zi) => {
      const r = { x0, x1, z0, z1 };
      sidewalkRing(b, r, 3);
      const inner = { x0: x0 + 3, x1: x1 - 3, z0: z0 + 3, z1: z1 - 3 };
      const key = `${xi},${zi}`;
      if (key === '1,0') garage(b, inner);
      else if (key === '1,1') plaza(b, rng, inner);
      else if (key === '0,0') bank(b, inner);
      else if (key === '2,0') {
        b.building({ id: 'whoopatower', x0: 179, x1: 197, z0: -41, z1: -12, h: 64, style: 'glass', color: 0x6f8fa8 });
        b.sign({ text: 'WHOOPA TOWER', x: 188, y: 8, z: -11.94, yaw: Math.PI, width: 13, height: 2, style: 'store', color: '#ffffff', bg: '#1b2a3a' });
        b.label('WHOOPA TOWER', 188, -26);
      } else if (key === '0,1') hotelRow(b, rng, inner, xi);
      else offices(b, inner);
      b.prop('lamp', x0 + 1.4, z1 - 1.4, 0, 0);
      b.prop('lamp', x1 - 1.4, z0 + 1.4, 0, 0);
      if (rng.chance(0.6)) b.prop('busstop', x1 - 1.2, (z0 + z1) / 2, -Math.PI / 2, 0);
      b.prop('trashcan', x0 + 1.6, z0 + 1.6, 0, 0);
      b.prop('hydrant', x1 - 1.3, z1 - 1.3, 0, 0);
      for (let x = x0 + 4; x < x1 - 4; x += rng.range(8, 14)) {
        if (rng.chance(0.4)) b.prop('car', x, z0 - 1.7, Math.PI / 2, rng.int(8));
        if (rng.chance(0.4)) b.prop('car', x, z1 + 1.7, -Math.PI / 2, rng.int(8));
      }
      b.hotspot((x0 + x1) / 2, z1 + 2);
    });
  });
}

/** Explorable downtown: an office block on Main Ave, a store, a restaurant on Ocean Drive. */
function offices(b: MapBuilder, r: Rect): void {
  construct(b, { id: 'dtoffice', type: 'office', x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z0 + 16, facing: 'n', floors: 5, color: 0x8497ab });
  b.sign({ text: 'WHOOPA OFFICES', x: (r.x0 + r.x1) / 2, y: 3.9, z: r.z0 - 0.08, yaw: 0, width: 9, height: 1.0, style: 'store', color: '#ffffff', bg: '#22384f' });
  construct(b, { id: 'dtstore', type: 'store', x0: r.x0, x1: r.x1, z0: r.z0 + 19, z1: r.z0 + 30, facing: 'w', color: 0xe8d6b8, sign: { text: 'KICKS', color: '#ffffff', bg: '#7a1f1f' } });
  construct(b, { id: 'dtfood', type: 'restaurant', x0: r.x0, x1: r.x1, z0: r.z1 - 14, z1: r.z1, facing: 's', floors: 2, color: 0xf2b8c6, sign: { text: 'WINGS & THINGS', color: '#ffe14d', bg: '#b3261e' } });
  b.label('OFFICES', (r.x0 + r.x1) / 2, r.z0 + 8);
  b.hotspot((r.x0 + r.x1) / 2, r.z0 + 17.5);
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
/** LAKE LINDA's beach (south middle) and the BOARDWALK (southeast): sand, towers, a tiki bar. */
function beach(b: MapBuilder, rng: Rng): void {
  const PROM0 = 71, PROM1 = 76;
  const W0 = CELL.c.x0 - 4.5; // the docks have the shore west of here
  b.area('sidewalk', OLD_WEST, GREATER.maxX, PROM0, PROM1, 1);
  b.area('sand', W0, GREATER.maxX + 12, PROM1, SHORE + 0.5, 1);
  b.area('surf', -1500, 1500, SHORE - 1.2, SHORE + 1.4, 3);
  b.area('ocean', -1500, 1500, SHORE + 0.5, 1500, 2);
  // the sea wall, with steps down to the sand every so often
  let x = W0;
  while (x < GREATER.maxX) {
    const len = rng.range(18, 28);
    b.box('lowwall', x, Math.min(GREATER.maxX, x + len), PROM1, PROM1 + 0.5, 0, 0.7);
    x += len + 4;
  }
  let k = 0;
  for (let px = OLD_WEST + 6; px < GREATER.maxX - 4; px += 12) {
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
  for (let px = -190; px < 190; px += rng.range(14, 24)) if (rng.chance(0.5) && Math.abs(Math.abs(px) - 86) > 6 && Math.abs(Math.abs(px) - 18) > 6) b.prop('car', px, 62.6, Math.PI / 2, rng.int(8));

  const keep: Rect[] = [];
  // ---- lifeguard towers ----
  for (const cx of [-70, 20, 96, 172]) {
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
  // ---- the boardwalk: a deck along the sea wall with a seafood restaurant and a rental shop ----
  {
    b.box('woodplat', 90.5, GREATER.maxX - 2, 77, 81.5, 0, 0.25, { color: 0x9a7b55 });
    construct(b, { id: 'shack', type: 'restaurant', x0: 104, x1: 117, z0: 83, z1: 94, facing: 'n', floors: 2, color: 0x9fd8d0, sign: { text: 'SHRIMP SHACK', color: '#ffffff', bg: '#1e7f86' } });
    construct(b, { id: 'rentals', type: 'store', x0: 121, x1: 132, z0: 83, z1: 93, facing: 'n', color: 0xf6d7a0, sign: { text: 'BEACH RENTALS', color: '#1a1a1a', bg: '#ffe14d' } });
    // a beach duplex: two homes side by side
    construct(b, { id: 'beachduplex', type: 'duplex', x0: 158, x1: 172, z0: 83, z1: 91.8, facing: 'n', style: 'siding', color: 0xa8d8f0, roofColor: 0x3d4650 });
    keep.push({ x0: 100, x1: 136, z0: 80, z1: 97 }, { x0: 156, x1: 174, z0: 80, z1: 93 });
    b.label('SHRIMP SHACK', 110, 88);
    b.hotspot(118, 80);
  }
  // ---- volleyball ----
  for (const vx of [-60, 150]) {
    for (const vz of [91, 101]) b.box('post', vx - 0.1, vx + 0.1, vz - 0.1, vz + 0.1, 0, 2.5, { color: 0xe8e2d4 });
    b.box('fence_chain', vx - 0.03, vx + 0.03, 91, 101, 1.5, 2.45, { col: 'fence' });
    keep.push({ x0: vx - 9, x1: vx + 9, z0: 88, z1: 104 });
    b.hotspot(vx, 96);
  }
  // ---- boats pulled up on the sand, rocks at the east end ----
  b.prop('boat', 166, 110, 0.3, 0);
  b.prop('boat', 180, 107, -0.25, 1);
  b.prop('boat', 40, 110, 0.5, 2);
  for (let i = 0; i < 7; i++) b.prop(rng.chance(0.5) ? 'boulder' : 'rock', rng.range(186, 197), rng.range(84, 116), rng.range(0, 6), rng.int(3));
  // ---- umbrellas and towels ----
  for (let i = 0; i < 40; i++) {
    const ux = rng.range(-78, 185), uz = rng.range(84, 112);
    if (keep.some((kk) => inRect(kk, ux, uz, 2))) continue;
    b.prop('umbrella', ux, uz, rng.range(0, 6), rng.int(5));
    const tx = ux + 1.4, tz = uz + rng.range(-0.6, 0.6);
    b.area('towel', tx - 0.55, tx + 0.55, tz - 1, tz + 1, 2, rng.pick([0xe05a8a, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xe9c46a, 0xffffff]));
    if (rng.chance(0.18)) b.loot(ux - 1, uz);
  }
  for (let px = -70; px <= 180; px += 45) b.hotspot(px, 95);
}

// =================================================================================== THE DOCKS
/**
 * THE DOCKS (southwest): the industrial waterfront. A fenced concrete yard with warehouses,
 * a workshop, a storage depot and a garage you can go into, stacked containers along the
 * quay and a gantry crane over them.
 */
function docks(b: MapBuilder, rng: Rng): void {
  const Y: Rect = { x0: CELL.w.x0 + 2, x1: CELL.c.x0 - 4.5, z0: 76.5, z1: SHORE };
  b.area('lot', Y.x0, Y.x1, Y.z0, Y.z1, 1);
  b.area('concrete', Y.x0, Y.x1, SHORE - 6, SHORE + 0.5, 2, 0x9a958c);
  // the yard fence along the promenade, gates by each building
  const gates = [-176, -150, -126, -103];
  let fx = Y.x0;
  for (const g of gates) {
    b.box('fence_chain', fx, g - 3, 76.46, 76.54, 0, 2.6, { col: 'fence' });
    fx = g + 3;
  }
  b.box('fence_chain', fx, Y.x1, 76.46, 76.54, 0, 2.6, { col: 'fence' });
  construct(b, { id: 'warehouse1', type: 'warehouse', x0: -196, x1: -177, z0: 82, z1: 98, facing: 'n', color: 0x8f9aa3 });
  construct(b, { id: 'workshop', type: 'workshop', x0: -171, x1: -157, z0: 82, z1: 94, facing: 'n', color: 0x9a8a6a });
  construct(b, { id: 'storage', type: 'storage', x0: -151, x1: -134, z0: 82, z1: 96, facing: 'n', color: 0x7f8a7a });
  construct(b, { id: 'dockgarage', type: 'garage', x0: -128, x1: -117, z0: 82, z1: 93, facing: 'n', color: 0xa0a6ac });
  construct(b, { id: 'warehouse2', type: 'warehouse', x0: -111, x1: -94, z0: 82, z1: 97, facing: 'n', color: 0x6f7f8f });
  for (const [x, t, c] of [[-186.5, 'PIER 9 WAREHOUSE', '#2a6f97'], [-164, 'TOWNE WELDING', '#7a1f1f'], [-142.5, 'SELF STORAGE', '#3d5a2c'], [-122.5, 'AUTO BODY', '#22384f'], [-102.5, 'COLD STORAGE', '#2a6f97']] as const) {
    b.sign({ text: t, x, y: x === -122.5 ? 4.6 : 4.9, z: 81.9, yaw: 0, width: 7, height: 1.0, style: 'store', color: '#ffffff', bg: c });
  }
  // containers along the quay, two high in places
  const colors = 4;
  for (let x = Y.x0 + 4; x < Y.x1 - 8; x += 7.2) {
    if (rng.chance(0.2)) continue;
    const z = rng.chance(0.5) ? 104 : 108;
    b.prop('container', x, z, Math.PI / 2, rng.int(colors));
    if (rng.chance(0.35)) b.prop('container', x, z, Math.PI / 2, rng.int(colors), 2.6);
  }
  // a gantry crane straddling the container row
  {
    const cx = -150, z0 = 101, z1 = 112;
    for (const dx of [-7, 7]) for (const z of [z0, z1]) b.box('pillar', cx + dx - 0.4, cx + dx + 0.4, z - 0.4, z + 0.4, 0, 13, { color: 0xd4a32a });
    for (const dx of [-7, 7]) b.box('beam', cx + dx - 0.5, cx + dx + 0.5, z0 - 0.4, z1 + 0.4, 13, 14, { color: 0xd4a32a });
    b.box('beam', cx - 7.5, cx + 7.5, z0 + 4.5, z0 + 6.5, 14, 15, { color: 0xd4a32a });
    b.box('beam', cx - 1, cx + 1, z0 + 4.5, z0 + 6.5, 11, 14, { color: 0x3a3e44, col: 'none' });
    b.loot(cx, (z0 + z1) / 2 + 2.5, 0);
  }
  b.prop('boat', -60, 111, 0.5, 2);
  for (let i = 0; i < 8; i++) b.prop(rng.pick(['pallet', 'crate', 'crate_big', 'tires', 'barrier'] as const), rng.range(Y.x0 + 4, Y.x1 - 4), rng.range(99, 101.5), rng.range(0, 3), 0);
  for (let i = 0; i < 4; i++) b.loot(rng.range(Y.x0 + 4, Y.x1 - 4), rng.range(100, 114));
  b.label('WAREHOUSES', -170, 90);
  b.label('CRANE', -150, 106);
  for (const [x, z] of [[-186, 80], [-164, 80], [-142, 80], [-122, 80], [-102, 80], [-150, 106], [-115, 112]] as const) b.hotspot(x, z);
}
