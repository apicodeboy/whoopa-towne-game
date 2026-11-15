import { CREWS } from '../config/crews';
import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * WHOOPA TOWNE
 *
 * Top-down layout (north is -Z / up, east is +X / right). 160m x 100m.
 *
 *   x: -80        -67            -22   -14        14    22             67        80
 *      +-----------+--------------+-----+----------+-----+--------------+---------+  z=-50
 *      | row       | corner houses|  W  |   PARK   |  E  |  WAREHOUSE   | row     |
 *      | houses    | north lane   |  e  |          |  a  |  (interior)  | houses  |
 *      +-----------+              |  s  +----------+  s  |  depot       +---------+  z=-14
 *      | S-CURVE   | S-shaped road|  t  |  CORNER  |  t  | == crossing =| CROSS   |
 *      | BASE      | liquor store |     |  STORE B |     | boxcars      | TRACK   |
 *      | (blue)    |              |  S  +----------+  S  | yard office  | BASE    |
 *      +-----------+ parking      |  t  |  ALLEYS  |  t  | RAIL YARD  C | (red)   |  z=14
 *      | row       | COURT  A     |  r  |          |  r  | tracks       | row     |
 *      | houses    | apartments   |  i  |          |  i  | OVERPASS     | houses  |
 *      +-----------+--------------+--p--+----------+--p--+--------------+---------+  z=50
 *
 * The middle band is mirror-symmetric. The two sides share a mirrored skeleton
 * (base, home zone position, south deck with two stairways, an enterable building
 * with a rooftop next to the middle) but are themed differently:
 *   - S-Curve (west): a winding S-shaped road, corner houses, a liquor store, a basketball court.
 *   - Cross Track (east): railroad tracks and a crossing, boxcars, a rail yard, a warehouse, an overpass.
 */

const HX = 80;
const HZ = 50;

// S-shaped road centerline on the west side.
const S_X0 = -67;
const S_X1 = -22;
const S_AMP = 11;
export function sRoadZ(x: number): number {
  if (x <= S_X0 || x >= S_X1) return 0;
  return S_AMP * Math.sin((2 * Math.PI * (x - S_X1)) / (S_X1 - S_X0));
}
function sRoadSlope(x: number): number {
  const k = (2 * Math.PI) / (S_X1 - S_X0);
  return S_AMP * k * Math.cos(k * (x - S_X1));
}

const DECK_H = 5.5;
const STORE_H = 4.4;
const STAIR_RUN = 7.6;

export function buildWhoopaTowne(): MapDef {
  const b = new MapBuilder();

  // ---------------------------------------------------------------- ground & perimeter
  b.box('ground', -HX - 6, HX + 6, -HZ - 6, HZ + 6, -1, 0);
  b.box('perimeter', -HX - 3, HX + 3, -HZ - 3, -HZ, 0, 10, { meta: { side: 'n' } });
  b.box('perimeter', -HX - 3, HX + 3, HZ, HZ + 3, 0, 10, { meta: { side: 's' } });
  b.box('perimeter', -HX - 3, -HX, -HZ, HZ, 0, 10, { meta: { side: 'w' } });
  b.box('perimeter', HX, HX + 3, -HZ, HZ, 0, 10, { meta: { side: 'e' } });

  // ---------------------------------------------------------------- roads (visual)
  {
    const pts: Array<{ x: number; z: number }> = [{ x: -HX, z: 0 }];
    for (let x = S_X0; x <= S_X1 + 0.001; x += 1.25) pts.push({ x, z: sRoadZ(x) });
    b.road('road', pts, 8, true);
    b.road('road', [{ x: S_X1, z: 0 }, { x: HX, z: 0 }], 9, true); // Main St
    b.road('road', [{ x: -18, z: -HZ }, { x: -18, z: HZ }], 8, true); // West Strip
    b.road('road', [{ x: 18, z: -HZ }, { x: 18, z: HZ }], 8, true); // East Strip
    b.road('rail', [{ x: 44, z: -44 }, { x: 44, z: HZ }], 2.8, false);
    b.road('rail', [{ x: 50, z: -21 }, { x: 50, z: HZ }], 2.8, false);
    b.road('rail', [{ x: 57, z: 20 }, { x: 57, z: 37 }], 2.8, false);
  }

  // =================================================================== MIDDLE BAND
  // ---- Corner store (Zone B) ----
  b.shell({
    id: 'cornerstore', x0: -9, x1: 9, z0: -17, z1: -6, h: STORE_H, style: 'store',
    openings: [
      { side: 's', at: 0, w: 2.6, top: 2.5 },
      { side: 's', at: -5.3, w: 3.2, sill: 1.0, top: 2.4 },
      { side: 's', at: 5.3, w: 3.2, sill: 1.0, top: 2.4 },
      { side: 'w', at: -9.2, w: 1.7 },
      { side: 'e', at: -9.2, w: 1.7 },
      { side: 'n', at: 0, w: 1.7 },
    ],
  });
  b.prop('shelf', -4.7, -12.4, 0, 0);
  b.prop('shelf', 4.7, -12.4, 0, 1);
  b.box('counter', -1.2, 1.2, -14.2, -12.2, 0, 1.05);
  b.sign({ text: 'WHOOPA MART', x: 0, y: 3.45, z: -5.94, yaw: Math.PI, width: 8.5, height: 1.2, style: 'store', color: '#ffe14d', bg: '#1d6b3a' });
  b.sign({ text: 'OPEN 24/7', x: -8.94 - 0.12, y: 3.3, z: -12.5, yaw: Math.PI / 2, width: 4, height: 0.9, style: 'store', color: '#ffffff', bg: '#b3261e' });
  b.sign({ text: 'OPEN 24/7', x: 9.06, y: 3.3, z: -12.5, yaw: -Math.PI / 2, width: 4, height: 0.9, style: 'store', color: '#ffffff', bg: '#b3261e' });
  // sidewalk + side lots
  b.area('sidewalk', -14, 14, -20, -4.5, 1);
  b.prop('dumpster', -6, -18.5, Math.PI / 2, 0);
  b.prop('acunit', 6, -18.4, 0, 0);
  b.prop('crate', -11.9, -14.5, 0.2, 0);
  b.prop('crate', 11.9, -14.5, -0.2, 1);
  b.prop('trashcan', -9.9, -7.2, 0, 0);
  b.prop('trashcan', 9.9, -7.2, 0, 0);
  // street clutter in front of the store (cover inside Zone B)
  b.prop('barrier', -3.0, 0.4, Math.PI / 2 + 0.25, 0);
  b.prop('barrier', 3.0, 0.4, Math.PI / 2 - 0.25, 0);
  b.prop('car', -7.2, 3.0, Math.PI / 2, 3);
  b.prop('car', 7.2, 3.0, -Math.PI / 2, 5);
  b.prop('cone', -1.2, 1.4, 0, 0);
  b.prop('cone', 1.2, 1.4, 0, 0);
  b.prop('busstop', -11.6, -5.4, -Math.PI / 2, 0);
  b.prop('busstop', 11.6, -5.4, -Math.PI / 2, 0);

  // ---- Park (north) ----
  b.area('grass', -14, 14, -HZ, -20, 1);
  b.area('path', -1.6, 1.6, -HZ, -20, 2);
  b.area('path', -14, 14, -35.6, -32.4, 2);
  b.box('fountain', -2.6, 2.6, -36.6, -31.4, 0, 0.8);
  b.box('fountain', -0.6, 0.6, -34.6, -33.4, 0.8, 2.9, { style: 'pillar' });
  for (const sx of [-1, 1]) {
    b.box('planter', sx * 8 - 2, sx * 8 + 2, -28.5, -25.5, 0, 1.0);
    b.box('planter', sx * 8 - 2, sx * 8 + 2, -42.5, -39.5, 0, 1.0);
    b.prop('tree', sx * 8, -27, 0, 0, 0.9);
    b.prop('tree', sx * 8, -41, 0, 1, 0.9);
    b.prop('tree', sx * 11.5, -34, 0, 2);
    b.prop('tree', sx * 4.5, -46.5, 0, 1);
    b.prop('bench', sx * 4.6, -34, 0, 0);
    // low stone walls on the park edges
    b.box('lowwall', sx * 14 - 0.2, sx * 14 + 0.2, -47, -39.5, 0, 1.05);
    b.box('lowwall', sx * 14 - 0.2, sx * 14 + 0.2, -35.5, -27, 0, 1.05);
    b.box('lowwall', Math.min(sx * 4, sx * 14), Math.max(sx * 4, sx * 14), -20.4, -20, 0, 1.05);
    b.prop('lamp', sx * 13.2, -21.2, 0, 0);
    b.prop('lamp', sx * 2.4, -39.2, 0, 0);
  }
  b.prop('bench', 0, -29.6, Math.PI / 2, 0);
  b.prop('bench', 0, -38.4, Math.PI / 2, 0);
  // statue plinth at the north end
  b.box('plinth', -1.6, 1.6, -45.6, -42.4, 0, 1.3);
  b.box('plinth', -0.5, 0.5, -44.5, -43.5, 1.3, 3.6, { style: 'statue' });

  // ---- Alleys (south) ----
  b.building({ id: 'alleyNW', x0: -14, x1: -3, z0: 6, z1: 20, h: 6.5, style: 'brick' });
  b.building({ id: 'alleyNE', x0: 3, x1: 14, z0: 6, z1: 20, h: 6.5, style: 'brickdark' });
  b.building({ id: 'alleySW', x0: -14, x1: -2, z0: 25, z1: 37, h: 7.5, style: 'stucco' });
  b.building({ id: 'alleySE', x0: 2, x1: 14, z0: 25, z1: 37, h: 7.5, style: 'brick' });
  b.building({ id: 'alleyBack', x0: -14, x1: 14, z0: 42, z1: HZ, h: 8.5, style: 'brickdark' });
  b.area('sidewalk', -14, 14, 4.5, 6, 1);
  b.area('alley', -14, 14, 20, 25, 1);
  b.area('alley', -14, 14, 37, 42, 1);
  b.area('alley', -3, 3, 6, 20, 1);
  b.area('alley', -2, 2, 25, 37, 1);
  // staggered wooden fences break the long east-west sightline through alley 1
  b.box('fence_wood', -8.08, -7.92, 20, 23.2, 0, 2.5);
  b.box('fence_wood', -0.08, 0.08, 21.8, 25, 0, 2.5);
  b.box('fence_wood', 7.92, 8.08, 20, 23.2, 0, 2.5);
  b.prop('dumpster', -11.2, 20.9, Math.PI / 2, 1);
  b.prop('dumpster', 11.2, 20.9, Math.PI / 2, 0);
  b.prop('dumpster', -6, 41.2, Math.PI / 2, 0);
  b.prop('dumpster', 6, 41.2, Math.PI / 2, 1);
  b.prop('crate_big', 0, 39.6, 0.3, 0);
  b.prop('crate', -2.3, 10.5, 0, 0);
  b.prop('crate', 2.3, 15.5, 0, 1);
  b.prop('trashcan', -3.6, 24.4, 0, 0);
  b.prop('trashcan', 3.6, 20.6, 0, 0);
  b.prop('acunit', -1.3, 30, 0, 0);
  b.prop('pallet', 1.3, 33.5, 0.4, 0);
  b.sign({ text: 'PAWN & LOAN', x: -8.5, y: 3.6, z: 5.94, yaw: 0, width: 7, height: 1.1, style: 'store', color: '#111111', bg: '#f2c14e' });
  b.sign({ text: 'LAUNDROMAT', x: 8.5, y: 3.6, z: 5.94, yaw: 0, width: 7, height: 1.1, style: 'store', color: '#ffffff', bg: '#2a6f97' });

  // ---- The Strips (north-south streets on both edges of the middle) ----
  for (const sx of [-1, 1]) {
    b.prop('car', sx * 20.6, -37, 0, sx > 0 ? 1 : 2);
    b.prop('car', sx * 15.4, -27.5, Math.PI, sx > 0 ? 4 : 0);
    b.prop('car', sx * 20.6, 12.5, 0, sx > 0 ? 6 : 7);
    b.prop('van', sx * 15.5, 30, Math.PI, sx > 0 ? 1 : 0);
    b.prop('car', sx * 20.6, 43, 0, sx > 0 ? 2 : 4);
    b.prop('lamp', sx * 22.6, -14, 0, 0);
    b.prop('lamp', sx * 22.6, 15, 0, 0);
    b.prop('lamp', sx * 13.4, 38.6, 0, 0);
    b.prop('hydrant', sx * 13.3, 5.2, 0, 0);
  }

  // =================================================================== SHARED SKELETON (both sides)
  for (const s of [-1, 1] as const) {
    const team = s < 0 ? 0 : 1;
    const X = (x: number) => s * x;
    const lo = (a: number, c: number) => Math.min(s * a, s * c);
    const hi = (a: number, c: number) => Math.max(s * a, s * c);

    // ---- Base: walled yard with three exits (north, center, south) ----
    b.box('basewall', lo(66.7, 67.3), hi(66.7, 67.3), -8, -2.5, 0, 3.4, { meta: { team } });
    b.box('basewall', lo(66.7, 67.3), hi(66.7, 67.3), 2.5, 8, 0, 3.4, { meta: { team } });
    b.building({ id: `rowN${team}`, x0: lo(67, HX), x1: hi(67, HX), z0: -HZ, z1: -14, h: 8, style: s < 0 ? 'siding' : 'brickdark' });
    b.building({ id: `rowS${team}`, x0: lo(67, HX), x1: hi(67, HX), z0: 14, z1: HZ, h: 8, style: s < 0 ? 'stucco' : 'metal' });
    b.area(team === 0 ? 'base0' : 'base1', lo(67.3, HX), hi(67.3, HX), -14, 14, 1);
    b.prop('crate_big', X(70.2), -5.3, 0.1, team);
    b.prop('crate_big', X(70.2), 5.3, -0.1, team);
    b.prop('crate', X(78.6), -12.6, 0.3, 0);
    b.prop('crate', X(78.6), 12.6, -0.3, 1);
    b.prop('banner', X(79.7), 0, s < 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0, team);
    const yaw = s < 0 ? -Math.PI / 2 : Math.PI / 2; // face the middle
    for (const z of [-9, -3, 3, 9]) b.spawn(team, X(77), z, yaw);
    for (const z of [-11, -4, 4, 11]) b.spawn(team, X(73.2), z, yaw);

    // ---- South deck (apartment roof on the west, overpass on the east) with two stairways ----
    const stairZ = 40.15;
    // outer stairway (near the base), ascends toward the middle
    b.ramp({ kind: 'stairs', x: X(64.3), z: stairZ, y0: 0, dir: s < 0 ? 'e' : 'w', run: STAIR_RUN, rise: DECK_H, width: 1.7, fill: true, rails: s < 0 ? 'left' : 'right', style: 'concrete', group: `deck${team}` });
    b.box('stairfill', lo(55, 56.7), hi(55, 56.7), 39.3, 41, 0, DECK_H, { style: 'concrete', group: `deck${team}` });
    // inner stairway (near the middle), ascends toward the base
    b.ramp({ kind: 'stairs', x: X(31.7), z: stairZ, y0: 0, dir: s < 0 ? 'w' : 'e', run: STAIR_RUN, rise: DECK_H, width: 1.7, fill: true, rails: s < 0 ? 'right' : 'left', style: 'concrete', group: `deck${team}` });
    b.box('stairfill', lo(39.3, 41), hi(39.3, 41), 39.3, 41, 0, DECK_H, { style: 'concrete', group: `deck${team}` });
    // guard rails on the open north side of the landings
    b.box('rail', lo(55, 56.7), hi(55, 56.7), 39.3, 39.37, DECK_H, DECK_H + 1, { col: 'fence' });
    b.box('rail', lo(39.3, 41), hi(39.3, 41), 39.3, 39.37, DECK_H, DECK_H + 1, { col: 'fence' });
    b.box('rail', lo(54.93, 55), hi(54.93, 55), 39.3, 41, DECK_H, DECK_H + 1, { col: 'fence' });
    b.box('rail', lo(41, 41.07), hi(41, 41.07), 39.3, 41, DECK_H, DECK_H + 1, { col: 'fence' });

    // ---- Home turf zone ----
    b.zone(s < 0 ? 'A' : 'C', s < 0 ? 'The Court' : 'Rail Yard', X(46), 26, 7.5);

    // lamps
    b.prop('lamp', X(66), -15.5, 0, 0);
    b.prop('lamp', X(66), 15.5, 0, 0);
    b.prop('lamp', X(34.5), 38.4, 0, 0);
    b.prop('lamp', X(58), 38.4, 0, 0);
  }
  b.zone('B', 'Corner Store', 0, -3, 8.5);
  // keep zones ordered A, B, C
  b.zones.sort((p, q) => p.id.localeCompare(q.id));

  // =================================================================== S-CURVE SIDE (west)
  // ---- corner houses ----
  b.building({ id: 'houseSC1', x0: -61, x1: -52, z0: -9, z1: 2, h: 6.5, style: 'siding', roofStyle: 'pitched', color: 0x8fa3b8 });
  b.building({ id: 'houseSC2', x0: -62, x1: -53, z0: -24, z1: -14, h: 6.2, style: 'stucco', roofStyle: 'pitched', color: 0xc9b48a });
  b.building({ id: 'houseN1', x0: -67, x1: -52, z0: -HZ, z1: -30, h: 6.5, style: 'brick', roofStyle: 'pitched' });
  b.building({ id: 'houseN2', x0: -47, x1: -35, z0: -HZ, z1: -31, h: 6.5, style: 'siding', roofStyle: 'pitched', color: 0xa9b7a0 });
  b.building({ id: 'houseN3', x0: -31, x1: -23, z0: -HZ, z1: -30, h: 6.2, style: 'stucco', roofStyle: 'pitched', color: 0xb9a0a0 });
  b.building({ id: 'houseS1', x0: -67, x1: -61.5, z0: 17, z1: 33, h: 6.5, style: 'brick', roofStyle: 'pitched' });
  // yards between the north houses (closed off by wooden fences)
  b.box('fence_wood', -52, -47, -40.1, -39.9, 0, 2.3);
  b.box('fence_wood', -35, -31, -40.1, -39.9, 0, 2.3);
  b.area('grass', -67, -44, -30, -9, 1);
  b.area('grass', -52, -47, -HZ, -30, 1);
  b.area('grass', -35, -31, -HZ, -30, 1);
  b.area('grass', -67, -58, 33, 41, 1);
  // yard clutter / cover in the empty lot north of the first bend
  b.box('shed', -50.5, -46.5, -22.5, -19, 0, 2.7, { style: 'wood' });
  b.prop('tires', -45.3, -24.2, 0.4, 0);
  b.prop('car', -49.5, -13.2, 1.9, 6);
  b.prop('tree', -65, -27, 0, 0);
  b.prop('tree', -44.5, -27.5, 0, 2);
  b.prop('tree', -66, -12, 0, 1);
  b.box('fence_wood', -52, -47.5, -9.1, -8.9, 0, 2.0);
  b.prop('trashcan', -52.6, -11.2, 0, 0);
  b.prop('barrier', -39.5, -22, 0.3, 0);
  b.prop('car', -27.5, -22.5, Math.PI / 2 + 0.1, 2);
  b.prop('lamp', -44, -16.5, 0, 0);
  b.prop('lamp', -24, -27.5, 0, 0);

  // ---- parked cars along the bends of the S road ----
  {
    const cars: Array<[number, number, number]> = [
      // [x along the road, side (+1 south / -1 north), variant]
      [-61, 1, 0], [-56.6, 1, 1], [-50.2, 1, 2], [-46.6, -1, 3],
      [-40.6, -1, 4], [-34.2, -1, 5], [-30.4, 1, 6], [-25.4, -1, 7],
    ];
    for (const [x, side, variant] of cars) {
      const slope = sRoadSlope(x);
      const len = Math.hypot(1, slope);
      const nx = -slope / len, nz = 1 / len; // normal pointing south-ish
      const px = x + nx * 3.0 * side;
      const pz = sRoadZ(x) + nz * 3.0 * side;
      // heading: local +Z along the road tangent (1, slope)
      const ry = Math.atan2(1, slope) + (variant % 2 ? Math.PI : 0);
      b.prop('car', px, pz, ry, variant);
    }
  }

  // ---- Liquor store (enterable, rooftop via fire escape) ----
  b.shell({
    id: 'liquor', x0: -38, x1: -27, z0: 0, z1: 11, h: STORE_H, style: 'liquor',
    openings: [
      { side: 'n', at: -32.5, w: 2.0, top: 2.4 },
      { side: 'n', at: -35.7, w: 1.8, sill: 1.0, top: 2.3 },
      { side: 'n', at: -29.3, w: 1.8, sill: 1.0, top: 2.3 },
      { side: 'e', at: 5.5, w: 1.7 },
      { side: 's', at: -32.5, w: 1.7 },
    ],
    parapet: { h: 0.95, gaps: [{ side: 'w', at: 3.4, w: 1.7 }] },
  });
  b.box('counter', -37.5, -36.5, 2.4, 8.6, 0, 1.1);
  b.prop('shelf', -34.7, 5.5, 0, 2);
  b.prop('shelf', -30.3, 5.5, 0, 3);
  b.ramp({ kind: 'fireescape', x: -38.85, z: 10.53, y0: 0, dir: 'n', run: 6.28, rise: STORE_H, width: 1.7, rails: 'left', style: 'metal', group: 'liquor', thickness: 0.14 });
  b.box('platform', -39.7, -38, 2.55, 4.25, STORE_H - 0.14, STORE_H, { style: 'metal', group: 'liquor' });
  b.box('rail', -39.7, -39.63, 2.55, 4.25, STORE_H, STORE_H + 1, { col: 'fence' });
  b.box('rail', -39.7, -38, 2.55, 2.62, STORE_H, STORE_H + 1, { col: 'fence' });
  b.prop('acunit', -29.5, 8.5, 0, 0, STORE_H);
  b.sign({ text: 'S-CURVE LIQUOR', x: -32.5, y: 3.4, z: -0.06, yaw: 0, width: 8, height: 1.1, style: 'store', color: '#fff2a8', bg: '#7a1f1f' });
  b.sign({ text: 'LIQUOR', x: -26.94, y: 3.4, z: 5.5, yaw: -Math.PI / 2, width: 5, height: 1.1, style: 'store', color: '#fff2a8', bg: '#7a1f1f' });

  // ---- parking lot between the liquor store and the court ----
  b.area('lot', -33.5, -22, 11.5, 39, 1);
  b.prop('car', -30.6, 16.4, 0, 3);
  b.prop('car', -24.6, 21, Math.PI, 5);
  b.prop('car', -30.6, 28.5, Math.PI, 0);
  b.prop('truck', -25.2, 34, 0, 0);
  b.prop('lamp', -27.6, 24.6, 0, 0);
  b.prop('trashcan', -33.4, 12.4, 0, 0);

  // ---- Basketball court (Zone A) ----
  b.area('court', -58, -34, 19, 33, 2);
  for (const [x0, x1] of [[-58, -51], [-41, -34]] as const) {
    b.box('fence_chain', x0, x1, 18.96, 19.04, 0, 3.2, { col: 'fence' });
  }
  for (const [x0, x1] of [[-58, -53], [-39, -34]] as const) {
    b.box('fence_chain', x0, x1, 32.96, 33.04, 0, 3.2, { col: 'fence' });
  }
  for (const x of [-58, -34]) {
    b.box('fence_chain', x - 0.04, x + 0.04, 19, 23, 0, 3.2, { col: 'fence' });
    b.box('fence_chain', x - 0.04, x + 0.04, 29, 33, 0, 3.2, { col: 'fence' });
  }
  b.prop('hoop', -57, 26, Math.PI / 2, 0);
  b.prop('hoop', -35, 26, -Math.PI / 2, 0);
  b.prop('barrier', -46, 21.3, Math.PI / 2, 0);
  b.prop('barrier', -46, 30.7, Math.PI / 2, 0);
  b.prop('crate_big', -51, 24.6, 0.2, 1);
  b.prop('tires', -41, 27.6, 0, 0);
  // bleachers (three tiers stepping up to the south)
  b.box('bleacher', -52, -40, 33.6, 34.4, 0, 0.35);
  b.box('bleacher', -52, -40, 34.4, 35.2, 0, 0.7);
  b.box('bleacher', -52, -40, 35.2, 36, 0, 1.05);
  b.prop('van', -44.2, 16.3, Math.PI / 2, 2);
  b.prop('bench', -56.2, 34.6, Math.PI / 2, 0);
  b.prop('trashcan', -35.2, 34.2, 0, 0);

  // ---- Apartment block: its flat roof is the south deck ----
  b.building({
    id: 'apartments', x0: -67, x1: -30, z0: 41, z1: HZ, h: DECK_H, style: 'apartment',
    parapet: { h: 1.0, gaps: [{ side: 'n', at: -55.85, w: 1.7 }, { side: 'n', at: -40.15, w: 1.7 }] },
  });
  b.prop('acunit', -48, 46.5, 0, 0, DECK_H);
  b.prop('acunit', -36, 47, 0, 0, DECK_H);
  b.prop('crate', -60, 45, 0.3, 0, DECK_H);

  // =================================================================== CROSS TRACK SIDE (east)
  b.area('gravel', 39, 67, -24, -5.5, 1);
  b.area('gravel', 39, 67, 5.5, 41, 1);
  b.area('gravel', 30, 66, 41, HZ, 1);
  b.area('crossing', 41, 53, -4.5, 4.5, 2);

  // ---- Warehouse (enterable; track 1 runs inside) ----
  b.shell({
    id: 'warehouse', x0: 33, x1: 61, z0: -46, z1: -24, h: 7.5, wallT: 0.4, style: 'metal',
    openings: [
      { side: 's', at: 44, w: 4.6, top: 4.8 },
      { side: 's', at: 57, w: 1.7 },
      { side: 'w', at: -35, w: 2.6, top: 3.0 },
      { side: 'e', at: -35, w: 2.6, top: 3.0 },
    ],
  });
  b.building({ id: 'whBack', x0: 33, x1: 61, z0: -HZ, z1: -46, h: 7.5, style: 'metal' });
  b.prop('boxcar', 44, -37.2, 0, 1);
  b.box('platform', 47.2, 60.6, -45.6, -39.2, 0, 1.1, { style: 'concrete' });
  b.ramp({ kind: 'ramp', x: 58, z: -36.4, y0: 0, dir: 'n', run: 2.8, rise: 1.1, width: 2.4, fill: true, style: 'concrete' });
  b.prop('crate_big', 50, -43.6, 0.1, 0, 1.1);
  b.prop('crate_big', 53.2, -43.9, -0.2, 1, 1.1);
  b.prop('crate', 51.6, -41.8, 0.4, 0, 1.1);
  b.prop('crate_big', 37.4, -29.4, 0, 1);
  b.prop('crate_big', 37.4, -31.2, 0, 0);
  b.prop('crate', 39.2, -29.2, 0.2, 1);
  b.prop('container', 53.5, -30, Math.PI / 2, 2);
  b.prop('crate', 36.2, -42.5, 0, 0);
  b.prop('pallet', 39.5, -41, 0.5, 0);
  b.prop('tires', 59.2, -27, 0, 0);
  b.sign({ text: 'CROSS TRACK FREIGHT', x: 47, y: 6.1, z: -23.94, yaw: Math.PI, width: 14, height: 1.3, style: 'store', color: '#f1f1f1', bg: '#3a3f47' });

  // ---- buildings along Main St ----
  b.building({ id: 'depot', x0: 27, x1: 38, z0: -18, z1: -6.5, h: 5.5, style: 'brickdark' });
  b.sign({ text: 'SIGNAL DEPOT', x: 32.5, y: 4.2, z: -6.44, yaw: Math.PI, width: 7.5, height: 1.1, style: 'store', color: '#f2e8c9', bg: '#4b3526' });
  b.building({ id: 'switchshed', x0: 54, x1: 62, z0: -19, z1: -10, h: 4.6, style: 'metal' });
  b.building({ id: 'engineshed', x0: 61.5, x1: 67, z0: 17, z1: 33, h: 6.2, style: 'brickdark' });

  // ---- Yard office (enterable, rooftop via fire escape) ----
  b.shell({
    id: 'yardoffice', x0: 27, x1: 38, z0: 5.5, z1: 16.5, h: STORE_H, style: 'office',
    openings: [
      { side: 'n', at: 32.5, w: 2.0, top: 2.4 },
      { side: 'n', at: 29.3, w: 1.8, sill: 1.0, top: 2.3 },
      { side: 'n', at: 35.7, w: 1.8, sill: 1.0, top: 2.3 },
      { side: 'w', at: 11, w: 1.7 },
      { side: 's', at: 32.5, w: 1.7 },
    ],
    parapet: { h: 0.95, gaps: [{ side: 'e', at: 8.9, w: 1.7 }] },
  });
  b.box('counter', 36.5, 37.5, 7.9, 14.1, 0, 1.1);
  b.prop('shelf', 34.7, 11, 0, 4);
  b.prop('shelf', 30.3, 11, 0, 5);
  b.ramp({ kind: 'fireescape', x: 38.85, z: 16.03, y0: 0, dir: 'n', run: 6.28, rise: STORE_H, width: 1.7, rails: 'right', style: 'metal', group: 'yardoffice', thickness: 0.14 });
  b.box('platform', 38, 39.7, 8.05, 9.75, STORE_H - 0.14, STORE_H, { style: 'metal', group: 'yardoffice' });
  b.box('rail', 39.63, 39.7, 8.05, 9.75, STORE_H, STORE_H + 1, { col: 'fence' });
  b.box('rail', 38, 39.7, 8.05, 8.12, STORE_H, STORE_H + 1, { col: 'fence' });
  b.prop('acunit', 29.5, 14, 0, 0, STORE_H);
  b.sign({ text: 'YARD OFFICE', x: 32.5, y: 3.4, z: 5.44, yaw: 0, width: 7, height: 1.1, style: 'store', color: '#f1f1f1', bg: '#22384f' });

  // ---- the crossing: two staggered boxcars block the straight shot down Main St ----
  b.prop('boxcar', 44, 5, 0, 0);
  b.prop('boxcar', 50, -5, 0, 2);
  b.prop('signal', 40.4, -5.6, 0, 0);
  b.prop('signal', 53.6, 5.6, Math.PI, 0);
  b.prop('flatcar', 44, -14.2, 0, 0);
  b.prop('buffer', 50, -21.6, 0, 0);
  b.prop('crate', 47, -15.5, 0.3, 0);
  b.prop('container', 59.5, -3.2, 0.12, 0);
  b.prop('barrier', 36, -3.9, Math.PI / 2, 0);
  b.prop('truck', 26.8, 3.0, Math.PI / 2, 1);
  b.prop('car', 62.5, 3.1, Math.PI / 2, 4);
  b.prop('lamp', 39.2, 4.9, 0, 0);
  b.prop('lamp', 54.6, -5, 0, 0);
  b.prop('lamp', 24, -21, 0, 0);

  // ---- Rail yard (Zone C) ----
  b.prop('flatcar', 44, 26, 0, 1);
  b.prop('boxcar_open', 50, 12.2, 0, 1);
  b.prop('boxcar', 50, 34.6, 0, 0);
  b.prop('boxcar', 57, 28.2, 0, 2);
  b.prop('buffer', 57, 20.8, 0, 0);
  b.prop('buffer', 57, 36.6, Math.PI, 0);
  b.prop('container', 39.2, 22, 0, 3);
  b.prop('crate', 40.6, 30.2, 0.2, 0);
  b.prop('crate_big', 38.8, 31.6, 0, 1);
  b.prop('crate', 47, 29.6, 0.5, 1);
  b.prop('tires', 47.1, 22.2, 0, 0);
  b.prop('barrier', 34, 26, 0, 0);
  b.prop('pallet', 53.4, 27, 0.2, 0);
  b.prop('crate', 53.6, 11.4, 0, 0);
  b.prop('lamp', 41.2, 34, 0, 0);
  b.prop('lamp', 53.6, 21.5, 0, 0);
  b.prop('car', 24.6, 22, 0, 6);
  b.prop('car', 29.4, 33, Math.PI, 1);

  // ---- Overpass: the south deck on this side. Open underneath but fenced off. ----
  b.box('deck', 30, 67, 41, HZ, DECK_H - 0.6, DECK_H, { style: 'concrete', group: 'overpass' });
  b.parapet('overpass', 30, 67, 41, HZ + 0.25, DECK_H, 1.0, [
    { side: 'n', at: 55.85, w: 1.7 },
    { side: 'n', at: 40.15, w: 1.7 },
  ], 'concrete');
  for (const x of [34, 40.8, 47, 53.5, 61]) {
    b.box('pillar', x - 0.6, x + 0.6, 41.6, 42.8, 0, DECK_H - 0.6, { style: 'concrete' });
    b.box('pillar', x - 0.6, x + 0.6, 47.8, 49, 0, DECK_H - 0.6, { style: 'concrete' });
  }
  b.box('fence_chain', 30, 67, 41.0, 41.08, 0, DECK_H - 0.6, { col: 'fence' });
  b.box('fence_chain', 29.96, 30.04, 41, HZ, 0, DECK_H - 0.6, { col: 'fence' });
  b.prop('container', 37, 46, Math.PI / 2, 2);
  b.prop('container', 59, 46.2, Math.PI / 2 + 0.05, 0);
  b.prop('barrier', 45, 45.4, Math.PI / 2, 0, DECK_H);
  b.prop('barrier', 51, 43.2, Math.PI / 2, 0, DECK_H);
  b.prop('crate', 62, 46, 0.2, 0, DECK_H);

  // =================================================================== signage, labels, bot hotspots
  // crew tags and base names come from the crew config, so renaming a crew renames these too
  const crew0 = CREWS[0].name.toUpperCase(), crew1 = CREWS[1].name.toUpperCase();
  b.sign({ text: crew0, x: -66.64, y: 2.2, z: -5.2, yaw: -Math.PI / 2, width: 4.6, height: 1.6, style: 'graffiti', team: 0 });
  b.sign({ text: crew0, x: -66.64, y: 2.2, z: 5.2, yaw: -Math.PI / 2, width: 4.6, height: 1.6, style: 'graffiti', team: 0 });
  b.sign({ text: crew1, x: 66.64, y: 2.2, z: -5.2, yaw: Math.PI / 2, width: 4.8, height: 1.6, style: 'graffiti', team: 1 });
  b.sign({ text: crew1, x: 66.64, y: 2.2, z: 5.2, yaw: Math.PI / 2, width: 4.8, height: 1.6, style: 'graffiti', team: 1 });
  b.sign({ text: 'WHOOPA TOWNE', x: 0, y: 5.4, z: 41.94, yaw: 0, width: 16, height: 2.4, style: 'graffiti' });
  b.sign({ text: 'HOLD THE BEND', x: -51.94, y: 3.2, z: -3.5, yaw: -Math.PI / 2, width: 6.5, height: 1.5, style: 'graffiti', team: 0 });
  b.sign({ text: 'NOTHING CROSSES US', x: 26.94, y: 3.4, z: -12.2, yaw: Math.PI / 2, width: 8.5, height: 1.4, style: 'graffiti', team: 1 });

  b.label(`${crew0} BASE`, -73.5, 0);
  b.label(`${crew1} BASE`, 73.5, 0);
  b.label('COURT', -46, 26);
  b.label('LIQUOR', -32.5, 5.5);
  b.label('CORNER STORE', 0, -11.5);
  b.label('PARK', 0, -37);
  b.label('ALLEYS', 0, 31);
  b.label('RAIL YARD', 47, 26);
  b.label('WAREHOUSE', 47, -35);
  b.label('OVERPASS', 48, 45.5);
  b.label('APARTMENTS', -48, 45.5);
  b.label('CROSSING', 47, 0);
  b.label('YARD OFFICE', 32.5, 11);

  for (const [x, z] of [
    [-46, 26], [0, -3], [46, 26],
    [0, -34], [0, 22.5], [0, 39.5], [-18, 0], [18, 0], [-18, -30], [18, -30], [-18, 30], [18, 30],
    [-44.5, 0], [-33, -12], [-56, 12], [-40, -24], [-58, -27], [-28, 24], [-60, 37],
    [47, 0], [33, -21], [47, -35], [58, -7], [47, 14], [60, 37], [28, 24], [64, -30],
  ] as const) b.hotspot(x, z);

  return b.build('whoopa-towne', 'Whoopa Towne', { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ });
}

let cached: MapDef | null = null;
/** The map is deterministic, so client and server both build it locally. */
export function getWhoopaTowne(): MapDef {
  if (!cached) cached = buildWhoopaTowne();
  return cached;
}
