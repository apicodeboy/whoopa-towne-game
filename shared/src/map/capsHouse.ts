import type { Rng } from '../math';
import { construct } from './architect';
import type { MapBuilder, Side } from './builder';
import type { AnimalKind } from './types';

/**
 * CAP'S HOUSE: the farm in the middle of the battle royale map (where the classic town sits in
 * Team Deathmatch and Turf War, which still play on the classic map, untouched).
 *
 *   z: -51.5  +---- Porch St -----------------------------------------------+
 *             | barn  silos |        the pool deck         |   cornfield    |
 *             |  horses     |   [  the pool  ]  cabana     |                |
 *             |  chickens   | +--------------------------+ |  pigs | goats  |
 *             |             | |  CAP'S HOUSE (barndo)    | |               |
 *             |  cows,      | +--------------------------+ |  orchard  pole |
 *             |  the pond,  |   the yard, the fountain     |           barn |
 *             |  windmill   |   the drive, the ranch gate  |                |
 *   z: 50.5   +---- (the strip, then Ocean Drive) -------------------------+
 *          x: -81.5                                                       81.5
 *
 * Everything here is ordinary map data (collision boxes, doors, windows, loot spots), so the
 * server and every client build the same farm. The animals are scenery the client draws
 * wandering their pens (`MapDef.pens`): no collision, and nobody can shoot them.
 */

export const CAPS = { x0: -81.5, x1: 81.5, z0: -51.5, z1: 50.5 } as const;
/** The pool behind the house: a real hole in the ground (1.4 m deep), steps at the east end. */
export const POOL = { x0: -9, x1: 9, z0: -38, z1: -26, floor: -1.4, water: -0.2 } as const;
const DECK = { x0: -16, x1: 18, z0: -47, z1: -18 } as const;

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
  // ---- the ground: grass all over, the pool deck behind the house, the drive in front
  areaAround(b, 'grass', CAPS, DECK, 1);
  areaAround(b, 'plaza', DECK, POOL, 2);
  b.area('gravel', -25, -10.5, 8, 15, 2); // the apron in front of the shop
  const loop: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2 + Math.PI / 2;
    loop.push({ x: Math.cos(a) * 9, z: 24 + Math.sin(a) * 9 });
  }
  b.road('trail', loop, 4.5, false);
  b.road('trail', [{ x: 3.5, z: 61 }, { x: 3.5, z: 32.4 }], 5, false);
  b.road('trail', [{ x: -9, z: 24 }, { x: -17.5, z: 15 }], 4, false);
  b.box('fountain', -2, 2, 22, 26, 0, 0.8);
  // the ranch gate where the drive leaves Ocean Drive
  b.box('post', -0.75, -0.15, 48.7, 49.3, 0, 5.4, { color: 0x5a3f2a });
  b.box('post', 7.15, 7.75, 48.7, 49.3, 0, 5.4, { color: 0x5a3f2a });
  b.box('post', -1.1, 8.1, 48.8, 49.2, 4.75, 5.15, { color: 0x5a3f2a });
  b.sign({ text: "CAP'S HOUSE", x: 3.5, y: 4.15, z: 49.24, yaw: Math.PI, width: 6.4, height: 0.9, style: 'store', color: '#f5c518', bg: '#1b1c1f' });
  b.sign({ text: "CAP'S HOUSE", x: 3.5, y: 4.15, z: 48.76, yaw: 0, width: 6.4, height: 0.9, style: 'store', color: '#f5c518', bg: '#1b1c1f' });
  for (const z of [34, 42]) {
    b.prop('tree', -2.5, z, rng.range(0, 6), rng.int(3));
    b.prop('tree', 9.5, z, rng.range(0, 6), rng.int(3));
  }

  // ---- the house
  construct(b, { id: 'caps', type: 'barndo', x0: -25, x1: 25, z0: -18, z1: 8, facing: 's' });

  // ---- the pool: coping round the edge (a step up), steps down at the east end, a diving board
  const C = 0.45;
  b.box('coping', POOL.x0 - C, POOL.x1 + C, POOL.z0 - C, POOL.z0, 0, 0.3);
  b.box('coping', POOL.x0 - C, POOL.x1 + C, POOL.z1, POOL.z1 + C, 0, 0.3);
  b.box('coping', POOL.x0 - C, POOL.x0, POOL.z0, POOL.z1, 0, 0.3);
  b.box('coping', POOL.x1, POOL.x1 + C, POOL.z0, POOL.z1, 0, 0.3);
  b.box('poolfloor', POOL.x0, POOL.x1, POOL.z0, POOL.z1, -2.6, POOL.floor);
  for (let i = 0; i < 4; i++) b.box('poolstep', POOL.x1 - 2 + 0.5 * i, POOL.x1, -34, -30, POOL.floor, POOL.floor + 0.35 * (i + 1));
  b.box('poolwater', POOL.x0, POOL.x1, POOL.z0, POOL.z1, POOL.floor, POOL.water, { col: 'none' });
  b.box('lowwall', -12.4, -11.0, -32.7, -31.3, 0, 0.5, { color: 0xd9d6cf });
  b.box('board', -11.6, -8.0, -32.35, -31.65, 0.5, 0.6);
  for (const x of [-7, -4.6, 3.2, 5.6]) b.rbox('furn', x, -42, 0.7, 1.9, 0, 0.42, 0, { meta: { t: 'lounger' } });
  b.prop('umbrella', -5.8, -43.4, 0, 1);
  b.prop('umbrella', 4.4, -43.4, 0, 2);
  // the cabana: a bar and a fridge, towels
  b.shell({ id: 'cabana', x0: 11, x1: 17, z0: -46.5, z1: -40.5, h: 3.0, style: 'wood', color: 0x8a6440, openings: [{ side: 's', at: 14, w: 3.2, top: 2.5 }, { side: 'w', at: -43.5, w: 1.4, sill: 1.0, top: 2.2 }] });
  b.box('counter', 11.6, 16.4, -46.0, -45.3, 0, 1.05);
  b.loot(14, -43.2);
  b.loot(-12, -36);
  b.loot(0, -44.5);
  b.hotspot(0, -44);

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

  // trees along Porch St behind the pool, the north fence
  for (let x = -28; x <= 28; x += 8) if (Math.abs(x) > 4) b.prop('tree', x, -49.5, rng.range(0, 6), rng.int(3));
  b.hotspot(0, 30);
  b.label("CAP'S HOUSE", 0, 30);
}
