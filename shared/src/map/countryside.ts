import type { Rng } from '../math';
import { construct } from './architect';
import type { MapBuilder } from './builder';
import { bale, pen, silo } from './capsHouse';

/**
 * The round map: the nine districts sit inside one big circle, and the land between their old
 * square edge and the circle is open country. North of THE HILL the NORTH FORTY (fields, two
 * farmsteads and a feed store on County Road), the BADLANDS north and west of BABYLON, more
 * jungle west of the jungle, orchards and fields east of HONG KONG and DOWNTOWN. A rim of rock
 * runs round the circle; south of the shore the circle is LAKE LINDA.
 */

/** The circle (center and radius). */
export const ROUND = { x: 0, z: -16, r: 246 } as const;

type Rect = { x0: number; x1: number; z0: number; z1: number };

const inside = (x: number, z: number, pad = 0): boolean => (x - ROUND.x) ** 2 + (z - ROUND.z) ** 2 < (ROUND.r - pad) ** 2;
const rectInside = (r: Rect, pad: number): boolean => inside(r.x0, r.z0, pad) && inside(r.x1, r.z0, pad) && inside(r.x0, r.z1, pad) && inside(r.x1, r.z1, pad);
const overlaps = (a: Rect, c: Rect, pad = 0): boolean => a.x0 < c.x1 + pad && a.x1 > c.x0 - pad && a.z0 < c.z1 + pad && a.z1 > c.z0 - pad;
/** Half the width of the circle at a given z (inset by `pad`). */
const halfWidth = (z: number, pad = 0): number => Math.sqrt(Math.max(0, (ROUND.r - pad) ** 2 - (z - ROUND.z) ** 2));

/** What grows in a field. */
const CROPS = ['corn', 'wheat', 'sunflower', 'soil', 'wheat', 'corn', 'stubble'] as const;

/**
 * Fills the ring between the districts' square (`city`) and the circle. `shore` is the lake's
 * edge (z): nothing past it.
 */
export function countryside(b: MapBuilder, rng: Rng, city: Rect, shore: number): void {
  const CR = -174; // County Road
  const roadX = halfWidth(CR, 14);
  b.road('trail', [{ x: -roadX, z: CR }, { x: roadX, z: CR }], 6, false);
  // the Hill's streets and the Line Roads carry on north as dirt roads
  for (const x of [-86, -52, -18, 18, 52, 86]) b.road('trail', [{ x, z: city.z0 }, { x, z: CR }], 5, false);

  // ---- the farmsteads and the feed store (kept clear of fields)
  const reserved: Rect[] = [
    { x0: -72, x1: -22, z0: -212, z1: -179 },
    { x0: 54, x1: 100, z0: -212, z1: -179 },
    { x0: -10, x1: 10, z0: -196, z1: -179 },
    { x0: 104, x1: 134, z0: -206, z1: -179 },
  ];
  // the Millers' place
  construct(b, { id: 'millerhouse', type: 'house2', x0: -68, x1: -59.5, z0: -196, z1: -187, facing: 's', color: 0xf0ead8, roofColor: 0x4a3a32 });
  construct(b, { id: 'millerbarn', type: 'barn', x0: -52, x1: -36, z0: -208, z1: -190, facing: 's' });
  silo(b, -28, -200, 2.8, 13.5);
  b.area('dirt', -56, -22, -190, -179, 2);
  for (let i = 0; i < 4; i++) bale(b, -33 + i * 1.4, -184, 0);
  b.loot(-30, -186);
  // the Okafors' place
  construct(b, { id: 'okaforhouse', type: 'house1', x0: 58, x1: 66.5, z0: -195, z1: -186.5, facing: 's', color: 0xd9e2d3, roofColor: 0x3d4650 });
  construct(b, { id: 'okaforbarn', type: 'barn', x0: 74, x1: 90, z0: -208, z1: -190, facing: 's', color: 0x8f2a22 });
  silo(b, 95.5, -199, 2.6, 12);
  b.prop('tractor', 69.5, -199, 0.3, 1);
  b.area('dirt', 68, 100, -190, -179, 2);
  b.loot(70, -192);
  // their sheep
  const SHEEP = { x0: 106, x1: 132, z0: -204, z1: -182 };
  pen(b, SHEEP, [{ side: 's', at: 112, w: 3.4 }]);
  b.pens.push({ kind: 'sheep', x0: SHEEP.x0 + 1.2, x1: SHEEP.x1 - 1.2, z0: SHEEP.z0 + 1.2, z1: SHEEP.z1 - 1.2, count: 6 });
  b.loot(128, -186);
  // the feed store on County Road
  construct(b, { id: 'feedseed', type: 'store', x0: -7, x1: 7, z0: -194, z1: -181, facing: 's', color: 0xc9a26b, sign: { text: 'FEED & SEED', color: '#ffffff', bg: '#2f5d34' } });
  b.area('gravel', -9, 9, -181, -177.5, 2);
  b.hotspot(0, -178);
  b.hotspot(-45, -184);
  b.hotspot(80, -184);

  // ---- fields: a grid of plots, farm tracks between them
  const cols: number[] = [];
  for (let x = -190; x < 190; x += 38) cols.push(x);
  const plots: Rect[] = [];
  for (const [z0, z1] of [[-206, -179], [-236, -210], [-262, -240]] as const) for (const x0 of cols) plots.push({ x0: x0 + 2, x1: x0 + 36, z0, z1 });
  // between County Road and the backs of THE HILL: plots between the dirt roads
  const lanes = [-200, -86, -52, -18, 18, 52, 86, 200];
  for (let i = 0; i + 1 < lanes.length; i++) {
    const a = lanes[i] + 4, c = lanes[i + 1] - 4;
    if (c - a > 50) for (let x = a; x < c - 10; x += 36) plots.push({ x0: x, x1: Math.min(c, x + 32), z0: -170, z1: -156 });
    else plots.push({ x0: a, x1: c, z0: -170, z1: -156 });
  }
  plots.forEach((r, k) => {
    if (!rectInside(r, 12) || reserved.some((q) => overlaps(q, r, 2))) return;
    if (r.x1 < -92) return; // the badlands (below)
    const crop = CROPS[(k * 5 + Math.round(Math.abs(r.x0))) % CROPS.length];
    b.area(crop, r.x0, r.x1, r.z0, r.z1, 2);
    if (crop === 'stubble') {
      // cut and baled
      for (let i = 0; i < 6; i++) bale(b, rng.range(r.x0 + 2, r.x1 - 2), rng.range(r.z0 + 2, r.z1 - 2), rng.range(0, 3));
    }
    if (rng.chance(0.35)) b.loot(r.x1 + 1, (r.z0 + r.z1) / 2);
  });
  b.prop('tractor', 30, -222, 1.2, 0);
  b.loot(32, -219);

  // ---- the badlands: north of BABYLON and west of it, sand and rock
  for (let z = -262; z < city.z0 - 2; z += 8) {
    const hw = halfWidth(z + 4, 8);
    const x0 = -hw, x1 = Math.min(-92, hw);
    if (x1 - x0 < 4) continue;
    b.area('desert', x0, x1, z, Math.min(z + 8, city.z0 - 2), 2);
  }
  for (let z = city.z0; z < -60; z += 8) {
    const x0 = -halfWidth(z + 4, 8);
    if (x0 > city.x0 - 2) continue;
    b.area('desert', x0, city.x0 - 1, z, z + 8, 2);
  }
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-235, -95), z = rng.range(-258, -60);
    if (!inside(x, z, 10) || (x > city.x0 - 3 && z > city.z0 - 3)) continue;
    b.prop(rng.chance(0.3) ? 'boulder' : 'rock', x, z, rng.range(0, 6), rng.int(3));
  }
  // an old homestead out in the dust
  for (const [cx, cz] of [[-150, -205], [-214, -120]] as const) {
    b.box('ruin', cx - 6, cx + 6, cz - 0.3, cz + 0.3, 0, 2.4);
    b.box('ruin', cx - 6, cx - 5.4, cz, cz + 7, 0, 1.8);
    b.box('ruin', cx + 5.4, cx + 6, cz, cz + 4, 0, 2.1);
    b.loot(cx, cz + 3);
  }

  // ---- west of the jungle: more jungle; west of the docks: rocks
  for (let z = -56; z < shore; z += 8) {
    const x0 = -halfWidth(z + 4, 8);
    if (x0 > city.x0 - 2) continue;
    b.area(z < 64 ? 'jungle' : 'sand', x0, city.x0 - 0.5, z, Math.min(z + 8, shore), 2);
  }
  for (let i = 0; i < 60; i++) {
    const z = rng.range(-56, shore - 4), x = rng.range(-240, city.x0 - 3);
    if (!inside(x, z, 9)) continue;
    if (z < 64) b.prop(rng.chance(0.5) ? 'palm' : rng.chance(0.5) ? 'tree' : 'bush', x, z, rng.range(0, 6), rng.int(3));
    else b.prop(rng.chance(0.4) ? 'boulder' : 'rock', x, z, rng.range(0, 6), rng.int(3));
  }

  // ---- east of HONG KONG: an orchard; east of DOWNTOWN: sunflowers; east of the boardwalk: rocks
  for (let z = city.z0; z < shore; z += 8) {
    const x1 = halfWidth(z + 4, 8);
    if (x1 < city.x1 + 2) continue;
    const kind = z < -60 ? 'grass' : z < 61 ? 'sunflower' : 'sand';
    b.area(kind, city.x1 + 0.5, x1, z, Math.min(z + 8, shore), 2);
  }
  for (let z = city.z0 + 6; z < -64; z += 6) {
    for (let x = city.x1 + 6; x < 246; x += 6) {
      if (!inside(x, z, 9)) break;
      b.prop('tree', x + rng.range(-0.5, 0.5), z, rng.range(0, 6), 3 + rng.int(2));
    }
  }
  for (let i = 0; i < 14; i++) {
    const z = rng.range(70, shore - 3), x = rng.range(city.x1 + 3, 240);
    if (inside(x, z, 9)) b.prop(rng.chance(0.4) ? 'boulder' : 'rock', x, z, rng.range(0, 6), rng.int(3));
  }
  b.loot(212, -100);
  b.loot(214, 0);
  b.loot(-214, 10);

  b.label('NORTH FORTY', 110, -230);
  b.label('BADLANDS', -150, -190);
  b.districts.push({ name: 'NORTH FORTY', x: 40, z: -205 }, { name: 'BADLANDS', x: -150, z: -185 });
}

/**
 * The rim: rock bluffs all the way round the circle, from the lake on one side round the north
 * to the lake on the other (a little way into the water, to meet the shore's edge).
 */
export function rim(b: MapBuilder, rng: Rng, shore: number): void {
  const { x: cx, z: cz, r } = ROUND;
  // where the circle meets the shore, a little way out into the lake
  const aShore = Math.asin(Math.min(1, (shore + 6 - cz) / r));
  const from = aShore, to = Math.PI - aShore - Math.PI * 2; // the long way round, through the north
  let a = from;
  while (a > to) {
    const len = rng.range(7, 13), depth = rng.range(8, 13), h = rng.range(10, 18);
    const da = len / r;
    const mid = a - da / 2;
    const rr = r + 0.5 + depth / 2;
    const x = cx + Math.cos(mid) * rr, z = cz + Math.sin(mid) * rr;
    // local +Z points straight out from the middle; the box is wide enough to overlap its neighbours
    b.rbox('cliff', x, z, len + 1.4, depth, 0, h, Math.atan2(Math.cos(mid), Math.sin(mid)), { meta: { rim: 1 } });
    a -= da;
  }
}
