import type { Rng } from '../math';
import { construct } from './architect';
import type { MapBuilder, Side } from './builder';
import { terrainHeight, type HillDef, type TerrainDef } from './terrain';
import type { AnimalKind } from './types';

/**
 * CAP'S HOUSE: the farm in the middle of the battle royale map (where the classic town sits in
 * Team Deathmatch and Turf War, which still play on the classic map, untouched).
 *
 *   z: -51.5  +---- Porch St -----------------------------------------------+
 *             | barn  silos |    /  the hill (8 m up)   \    |  cornfield   |
 *             |  horses     |   | CABIN (4 floors) GARAGE |   |              |
 *             |  chickens   |   |  deck, yard     apron   |   | pigs | goats |
 *             |             |    \   slopes     drive ↓  /    |              |
 *             |  cows,      |      the pool   cabana  |       | orchard  pole|
 *             |  the pond,  |      the yard           |       |          barn|
 *             |  windmill   |            the ranch gate      |              |
 *   z: 50.5   +---- (the strip, then Ocean Drive) -------------------------+
 *          x: -81.5                                                       81.5
 *
 * The cabin and its four-car garage stand on top of a steep hill you can run up (about 30° on
 * the sides, a little under 45° at the steepest); a drive climbs the south side on an
 * embankment. The hill is real ground (see terrain.ts): collision, bots and loot all follow it.
 *
 * Everything here is ordinary map data (collision boxes, doors, windows, loot spots), so the
 * server and every client build the same farm. The animals are scenery the client draws
 * wandering their pens (`MapDef.pens`): no collision, and nobody can shoot them.
 */

export const CAPS = { x0: -81.5, x1: 81.5, z0: -51.5, z1: 50.5 } as const;
/** The hill the cabin stands on: its flat top, 8 m up. */
export const HILL: HillDef = {
  top: { x0: -18, x1: 24, z0: -38, z1: -6 },
  height: 8,
  run: { n: 13, s: 16, e: 12, w: 13 },
  rough: 0.25,
  seed: 29,
  drive: { x0: 15, x1: 21, zFoot: 22, zTop: -6 },
};
/** The ground round Cap's House (sampled every meter). */
export const CAPS_TERRAIN: TerrainDef = {
  x0: -33, x1: 38, z0: -53, z1: 24, step: 1,
  hills: [HILL],
  paint: [
    { kind: 'gravel', x0: 15, x1: 21, z0: -6, z1: 22 }, // the drive
    { kind: 'gravel', x0: 4, x1: 22, z0: -25, z1: -6 }, // the apron in front of the garage
    { kind: 'stone', x0: -10, x1: -4, z0: -14, z1: -8 }, // round the fire pit
  ],
};
/** The pool in the front yard: a real hole in the ground (1.4 m deep), steps at the east end. */
export const POOL = { x0: -10, x1: 6, z0: 20, z1: 30, floor: -1.4, water: -0.2 } as const;
const DECK = { x0: -13, x1: 10, z0: 16.5, z1: 37.5 } as const;

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** A ground area over `outer` with a rectangular hole (as four pieces). */
export function areaAround(b: MapBuilder, kind: string, outer: Rect, hole: Rect, layer: number, color?: number): void {
  b.area(kind, outer.x0, outer.x1, outer.z0, hole.z0, layer, color);
  b.area(kind, outer.x0, outer.x1, hole.z1, outer.z1, layer, color);
  b.area(kind, outer.x0, hole.x0, hole.z0, hole.z1, layer, color);
  b.area(kind, hole.x1, outer.x1, hole.z0, hole.z1, layer, color);
}

/** How tall the ranch fences are: a jump clears them (about 1.25 m), walking does not. */
export const RANCH_FENCE_H = 1.1;

/**
 * A post-and-rail fence round a pen, with gates (gaps) where given. It blocks walking, not
 * jumping or bullets.
 */
export function pen(b: MapBuilder, r: Rect, gates: Array<{ side: Side; at: number; w: number }>, h = RANCH_FENCE_H): void {
  const T = 0.12, PIECE = 10;
  const run = (side: Side, a0: number, a1: number) => {
    const cuts = gates.filter((g) => g.side === side).map((g) => [g.at - g.w / 2, g.at + g.w / 2] as const).sort((p, q) => p[0] - q[0]);
    let t = a0;
    const spans: Array<[number, number]> = [];
    for (const [c0, c1] of cuts) {
      if (c0 > t + 0.2) spans.push([t, c0]);
      t = Math.max(t, c1);
    }
    if (a1 > t + 0.2) spans.push([t, a1]);
    for (const [s0, s1] of spans) {
      const n = Math.max(1, Math.round((s1 - s0) / PIECE));
      for (let i = 0; i < n; i++) {
        const p = s0 + ((s1 - s0) * i) / n, q = s0 + ((s1 - s0) * (i + 1)) / n;
        if (side === 'n' || side === 's') {
          const z = side === 'n' ? r.z0 : r.z1;
          b.box('ranchfence', p, q, z - T / 2, z + T / 2, 0, h, { col: 'fence' });
        } else {
          const x = side === 'w' ? r.x0 : r.x1;
          b.box('ranchfence', x - T / 2, x + T / 2, p, q, 0, h, { col: 'fence' });
        }
      }
    }
  };
  run('n', r.x0, r.x1);
  run('s', r.x0, r.x1);
  run('w', r.z0, r.z1);
  run('e', r.z0, r.z1);
}

/** Animals grazing a pen (kept a little off the fence). */
function animals(b: MapBuilder, kind: AnimalKind, r: Rect, count: number): void {
  b.pens.push({ kind, x0: r.x0 + 1.2, x1: r.x1 - 1.2, z0: r.z0 + 1.2, z1: r.z1 - 1.2, count });
}

/** A round hay bale lying on its side (about 1.2 m: a jump gets you on top). */
export function bale(b: MapBuilder, x: number, z: number, ry: number): void {
  b.rbox('haybale', x, z, 1.25, 1.2, 0, 1.2, ry);
}

/** A grain silo (a steel bin with a cone roof). */
export function silo(b: MapBuilder, x: number, z: number, r: number, h: number): void {
  b.box('silo', x - r, x + r, z - r, z + r, 0, h);
}

/** A small shed with a lean-to roof (a coop, a hog house). */
function shed(b: MapBuilder, r: Rect, h: number, color = 0x8a6f52): void {
  b.box('shed', r.x0, r.x1, r.z0, r.z1, 0, h, { color });
  b.box('awningroof', r.x0 - 0.3, r.x1 + 0.3, r.z0 - 0.3, r.z1 + 0.3, h, h + 0.12, { color: 0x4a4d52 });
}

/** An open-sided pole barn: posts and a metal roof. */
function poleBarn(b: MapBuilder, r: Rect, h: number): void {
  for (const x of [r.x0 + 0.2, (r.x0 + r.x1) / 2, r.x1 - 0.2]) {
    for (const z of [r.z0 + 0.2, (r.z0 + r.z1) / 2, r.z1 - 0.2]) {
      if (x === (r.x0 + r.x1) / 2 && z === (r.z0 + r.z1) / 2) continue;
      b.box('post', x - 0.16, x + 0.16, z - 0.16, z + 0.16, 0, h, { color: 0x6f4f33 });
    }
  }
  b.box('awningroof', r.x0 - 0.5, r.x1 + 0.5, r.z0 - 0.5, r.z1 + 0.5, h, h + 0.15, { color: 0x5b6168 });
}

/** The farm in the middle of the map. */
export function capsHouse(b: MapBuilder, rng: Rng): void {
  const H = HILL.height;
  const T = HILL.top;
  b.terrain = CAPS_TERRAIN;
  const at = (x: number, z: number) => terrainHeight(CAPS_TERRAIN, x, z);
  // ---- the ground: grass all over, the pool deck in the front yard
  areaAround(b, 'grass', CAPS, DECK, 1);
  areaAround(b, 'plaza', DECK, POOL, 2);
  // the drive in from Ocean Drive; it climbs the hill from z = 22 (drawn on the hill itself)
  b.road('trail', [{ x: 18, z: 61 }, { x: 18, z: 22 }], 6, false);
  // the ranch gate where the drive leaves Ocean Drive
  b.box('post', 14.0, 14.6, 48.7, 49.3, 0, 5.4, { color: 0x5a3f2a });
  b.box('post', 21.4, 22.0, 48.7, 49.3, 0, 5.4, { color: 0x5a3f2a });
  b.box('post', 13.7, 22.3, 48.8, 49.2, 4.75, 5.15, { color: 0x5a3f2a });
  b.sign({ text: "CAP'S HOUSE", x: 18, y: 4.15, z: 49.24, yaw: Math.PI, width: 6.4, height: 0.9, style: 'store', color: '#f5c518', bg: '#1b1c1f' });
  b.sign({ text: "CAP'S HOUSE", x: 18, y: 4.15, z: 48.76, yaw: 0, width: 6.4, height: 0.9, style: 'store', color: '#f5c518', bg: '#1b1c1f' });
  for (const z of [30, 38, 46]) {
    b.prop('tree', 12.2, z, rng.range(0, 6), rng.int(3));
    b.prop('tree', 23.8, z, rng.range(0, 6), rng.int(3));
  }

  // ================================================================ up on the hill
  // the cabin, its front to the lake, and the garage beside it
  construct(b, { id: 'caps', type: 'cabin', x0: -17, x1: 3, z0: -36, z1: -20, facing: 's', base: H });
  construct(b, { id: 'capsgarage', type: 'garage4', x0: 5, x1: 21, z0: -34, z1: -25, facing: 's', base: H });
  // in the garage, backed in (fronts to the doors): the high-roof van, the lifted truck, the hypercar, the wedge truck
  const bay = (16 - 0.5) / 4;
  const rides: Array<['highvan' | 'liftedtruck' | 'hypercar' | 'wedgetruck', number]> = [['highvan', 0], ['liftedtruck', 0], ['hypercar', 0], ['wedgetruck', 0]];
  rides.forEach(([type, variant], i) => b.prop(type, 5 + 0.25 + bay * (i + 0.5), -25 - 4.4, 0, variant, H));
  // the yard on top: a fire pit with benches, looking out over the lake
  b.rbox('firepit', -7, -11, 1.8, 1.8, H, 0.45, 0);
  for (const [x, z, ry] of [[-7, -13.6, Math.PI / 2], [-9.6, -11, 0], [-4.4, -11, 0]] as const) b.prop('bench', x, z, ry, 0, H);
  b.loot(-7, -9.2, H);
  b.loot(12, -9, H);
  b.loot(T.x1 - 1.5, T.z0 + 1.5, H);
  b.hotspot(2, -12);
  b.hotspot(13, -15);
  // pines on the slopes, boulders half sunk into them
  const slope = (x: number, z: number) => {
    const y = at(x, z);
    return y > 0.6 && y < H - 0.6;
  };
  let trees = 0;
  for (let k = 0; k < 400 && trees < 22; k++) {
    const x = rng.range(-31, 36), z = rng.range(-51, 10);
    if (!slope(x, z) || (x > 10 && x < 26 && z > -7)) continue;
    b.prop('tree', x, z, rng.range(0, 6), rng.int(3), at(x, z));
    trees++;
  }
  let rocks = 0;
  for (let k = 0; k < 400 && rocks < 10; k++) {
    const x = rng.range(-31, 36), z = rng.range(-51, 10);
    if (!slope(x, z) || (x > 10 && x < 26 && z > -7)) continue;
    const big = rng.chance(0.4);
    b.prop(big ? 'boulder' : 'rock', x, z, rng.range(0, 6), rng.int(3), at(x, z) - (big ? 0.7 : 0.3));
    rocks++;
  }
  b.loot(-25, -20, at(-25, -20));

  // ================================================================ the front yard: the pool
  // coping round the edge (a step up), steps down at the east end, a diving board at the west
  const C = 0.45, PZ = (POOL.z0 + POOL.z1) / 2;
  b.box('coping', POOL.x0 - C, POOL.x1 + C, POOL.z0 - C, POOL.z0, 0, 0.3);
  b.box('coping', POOL.x0 - C, POOL.x1 + C, POOL.z1, POOL.z1 + C, 0, 0.3);
  b.box('coping', POOL.x0 - C, POOL.x0, POOL.z0, POOL.z1, 0, 0.3);
  b.box('coping', POOL.x1, POOL.x1 + C, POOL.z0, POOL.z1, 0, 0.3);
  b.box('poolfloor', POOL.x0, POOL.x1, POOL.z0, POOL.z1, -2.6, POOL.floor);
  // five steps of 0.28 m (an easy step up), the last one level with the deck
  for (let i = 0; i < 5; i++) b.box('poolstep', POOL.x1 - 2.25 + 0.45 * i, POOL.x1, PZ - 2, PZ + 2, POOL.floor, POOL.floor + (-POOL.floor / 5) * (i + 1));
  b.box('poolwater', POOL.x0, POOL.x1, POOL.z0, POOL.z1, POOL.floor, POOL.water, { col: 'none' });
  b.box('lowwall', POOL.x0 - 3.4, POOL.x0 - 2.0, PZ - 0.7, PZ + 0.7, 0, 0.5, { color: 0xd9d6cf });
  b.box('board', POOL.x0 - 2.6, POOL.x0 + 1.0, PZ - 0.35, PZ + 0.35, 0.5, 0.6);
  for (const x of [-7, -4.6, -1.6, 0.8]) b.rbox('furn', x, 34, 0.7, 1.9, 0, 0.42, Math.PI, { meta: { t: 'lounger' } });
  b.prop('umbrella', -5.8, 35.4, 0, 1);
  b.prop('umbrella', -0.4, 35.4, 0, 2);
  // the cabana: a bar and a fridge, towels
  b.shell({ id: 'cabana', x0: 3.5, x1: 9.5, z0: 32, z1: 37, h: 3.0, style: 'wood', color: 0x8a6440, openings: [{ side: 'n', at: 6.5, w: 3.2, top: 2.5 }, { side: 'w', at: 34.5, w: 1.4, sill: 1.0, top: 2.2 }] });
  b.box('counter', 4.1, 8.9, 36.3, 36.95, 0, 1.05);
  b.loot(6.5, 34);
  b.loot(-12, 18.5);
  b.hotspot(-2, 32);

  // ================================================================ west: barn, horses, cows
  construct(b, { id: 'capsbarn', type: 'barn', x0: -77, x1: -61, z0: -49, z1: -31, facing: 'e' });
  b.area('dirt', -61, -46, -49, -31, 2);
  silo(b, -51, -46, 3.0, 15);
  silo(b, -51, -38.6, 2.5, 12.5);
  b.loot(-55.5, -42);
  for (let i = 0; i < 5; i++) bale(b, -75 + i * 1.5, -28.2, Math.PI / 2);
  bale(b, -74.25, -28.2, Math.PI / 2);
  b.loot(-66, -27);
  // the horse paddock
  const HORSES = { x0: -79, x1: -50, z0: -25, z1: 2 };
  pen(b, HORSES, [{ side: 'e', at: -11, w: 3.6 }, { side: 'n', at: -64, w: 3.6 }]);
  b.area('dirt', HORSES.x0, HORSES.x1, HORSES.z0, HORSES.z1, 2, 0xb39770);
  animals(b, 'horse', HORSES, 4);
  b.box('trough', -77.8, -77.0, -16, -12, 0, 0.6);
  // chickens and their coop
  const COOP = { x0: -45, x1: -33, z0: -27, z1: -15 };
  pen(b, COOP, [{ side: 'e', at: -21, w: 2.4 }], 0.9);
  shed(b, { x0: -44.4, x1: -40, z0: -26.4, z1: -23 }, 2.0, 0xc9a26b);
  animals(b, 'chicken', COOP, 9);
  b.loot(-38, -18);
  // the cow pasture: a stock pond, the windmill and its trough
  const COWS = { x0: -79, x1: -31, z0: 8, z1: 47 };
  pen(b, COWS, [{ side: 'e', at: 27, w: 4 }, { side: 'n', at: -60, w: 4 }, { side: 'n', at: -38, w: 3 }]);
  b.area('oasis', -73, -60, 29, 40, 2, 0x5b8f86);
  b.box('windmill', -55.6, -54.4, 40.4, 41.6, 0, 12.5);
  b.box('trough', -54, -50.6, 37.6, 38.4, 0, 0.6);
  animals(b, 'cow', { x0: -79, x1: -31, z0: 8, z1: 28 }, 5);
  animals(b, 'cow', { x0: -58, x1: -31, z0: 28, z1: 47 }, 3);
  for (const [x, z] of [[-46, 16], [-36, 40], [-70, 14]] as const) {
    bale(b, x, z, rng.range(0, 3));
    bale(b, x + 1.4, z + 0.3, rng.range(0, 3));
  }
  b.loot(-45, 17.6);
  b.loot(-52.5, 40);
  b.hotspot(-55, 20);
  b.hotspot(-64, -38);

  // ================================================================ east: corn, pigs, goats, orchard
  const CORN = { x0: 36, x1: 79.5, z0: -49.5, z1: -21 };
  b.area('corn', CORN.x0, CORN.x1, CORN.z0, CORN.z1, 2);
  bale(b, 33.5, -30, 0.3);
  bale(b, 33.2, -28.6, 0.1);
  b.loot(33.5, -26.8);
  const PIGS = { x0: 36, x1: 54, z0: -14, z1: 8 };
  pen(b, PIGS, [{ side: 'w', at: -2, w: 3 }]);
  b.area('mud', PIGS.x0, PIGS.x1, PIGS.z0, PIGS.z1, 2);
  shed(b, { x0: 37, x1: 43, z0: -13.4, z1: -9 }, 2.1);
  b.box('trough', 46, 50, 6.6, 7.4, 0, 0.6);
  animals(b, 'pig', PIGS, 5);
  b.loot(40, -6);
  const GOATS = { x0: 60, x1: 79.5, z0: -14, z1: 8 };
  pen(b, GOATS, [{ side: 'w', at: 4, w: 3 }]);
  b.area('dirt', GOATS.x0, GOATS.x1, GOATS.z0, GOATS.z1, 2, 0xa88a64);
  b.prop('boulder', 72, -6, 0.4, 0);
  b.prop('rock', 66, 2, 1.1, 1);
  animals(b, 'goat', GOATS, 4);
  animals(b, 'sheep', { x0: 60, x1: 79.5, z0: -14, z1: 0 }, 3);
  // the orchard
  for (let x = 38; x <= 60; x += 5.5) {
    for (let z = 17; z <= 46; z += 5.8) b.prop('tree', x + rng.range(-0.4, 0.4), z + rng.range(-0.4, 0.4), rng.range(0, 6), 3 + rng.int(2));
  }
  b.loot(49, 31);
  // the pole barn: the tractor, the farm truck, tools
  poleBarn(b, { x0: 66, x1: 79, z0: 20, z1: 36 }, 4.4);
  b.prop('tractor', 70, 26, Math.PI, 0);
  b.prop('truck', 75.5, 29, Math.PI, 2);
  b.rbox('furn', 67, 34.8, 2.0, 0.75, 0, 0.92, Math.PI, { meta: { t: 'workbench' } });
  b.loot(68, 31.5);
  b.area('gravel', 64, 80, 18, 38, 2);
  b.hotspot(58, 0);
  b.hotspot(60, 30);

  b.label("CAP'S HOUSE", 2, -14);
}
