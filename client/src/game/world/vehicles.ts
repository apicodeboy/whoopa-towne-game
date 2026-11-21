import * as THREE from 'three';
import type { Prop } from '@shared/map/types';
import { trs, type GeoBatch } from './geoBatch';

/**
 * The rides in Cap's garage, drawn from side profiles (extruded to their width) plus wheels,
 * glass, lights and trim: a stainless wedge pickup, a two-tone hypercar, a lifted off-road truck
 * on big tires and a high-roof cargo van. No badges, no brand names. Front is local +Z.
 */
export interface VDraw {
  geo(key: string): GeoBatch;
}

type P = Array<[number, number]>;

/** A side profile (z forward, y up) extruded across the width, centered on x. */
function body(profile: P, width: number, bevel = 0.04): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  profile.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  // shape x -> forward (+Z), extrusion -> across (x), centered
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

/** A shape made of curves (moveTo / lineTo / quadraticCurveTo calls) extruded the same way. */
function curved(draw: (s: THREE.Shape) => void, width: number, bevel = 0.05): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  draw(s);
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
/** Adds a part in the vehicle's frame. */
function put(d: VDraw, key: string, g: THREE.BufferGeometry, p: Prop, local: THREE.Matrix4, color: number): void {
  _m.copy(trs(p.x, p.y, p.z, p.ry)).multiply(local);
  d.geo(key).add(g, _m, color);
}
const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, ry = 0) => _l.copy(trs(x, y, z, ry, sx, sy, sz, rx, rz));
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 18);
const hubGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 8);

function box(d: VDraw, key: string, p: Prop, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rx = 0): void {
  put(d, key, unitBox, p, at(x, y, z, sx, sy, sz, rx), color);
}

/** A wheel: tire, rim (and spokes when `spokes`), axis across the vehicle. */
function wheel(d: VDraw, p: Prop, x: number, z: number, r: number, w: number, rim: number, o: { spokes?: number; caliper?: number; lug?: boolean } = {}): void {
  const side = Math.sign(x);
  put(d, 'faceted', wheelGeo, p, at(x, r, z, r, w, r, 0, Math.PI / 2), 0x18191b);
  put(d, 'chrome', hubGeo, p, at(x + side * (w / 2 + 0.005), r, z, r * 0.62, 0.02, r * 0.62, 0, Math.PI / 2), rim);
  if (o.spokes) {
    for (let k = 0; k < o.spokes; k++) {
      const a = (k / o.spokes) * Math.PI * 2;
      // (Rx(a) turns the spoke's length toward (cos a, sin a) in y, z: offset it the same way)
      put(d, 'chrome', unitBox, p, at(x + side * (w / 2 + 0.012), r + Math.cos(a) * r * 0.3, z + Math.sin(a) * r * 0.3, 0.012, r * 0.62, 0.06, a, 0), 0x2a2c30);
    }
  }
  if (o.caliper) put(d, 'smooth', unitBox, p, at(x + side * (w / 2 - 0.04), r + r * 0.25, z - r * 0.3, 0.05, r * 0.45, r * 0.3), o.caliper);
  if (o.lug) {
    // off-road tread: blocks round the tire
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      put(d, 'faceted', unitBox, p, at(x, r + Math.cos(a) * r, z + Math.sin(a) * r, w * 0.95, 0.07, 0.12, a, 0), 0x121314);
    }
  }
}

// ------------------------------------------------------------------ the stainless wedge pickup
export function wedgeTruck(d: VDraw, p: Prop): void {
  const W = 2.2, steel = [0xb9bec4, 0x2b2d31][p.variant % 2];
  const shell = body([[-2.85, 0.48], [-2.85, 1.26], [-2.55, 1.34], [0.2, 1.93], [2.85, 1.13], [2.85, 0.62], [2.55, 0.45], [-2.6, 0.45]], W, 0.03);
  put(d, 'carpaint', shell, p, at(0, 0, 0), steel);
  shell.dispose();
  // the glass: one band under the roof line
  const glass = body([[-1.35, 1.42], [0.2, 1.84], [1.65, 1.45], [1.55, 1.36], [-1.25, 1.36]], W + 0.03, 0);
  put(d, 'glassDark', glass, p, at(0, 0, 0), 0x1a2028);
  glass.dispose();
  // wheel arches, the light bars front and back, the bed's tonneau line
  for (const z of [-1.85, 1.85]) for (const x of [-1, 1]) box(d, 'smooth', p, x * (W / 2 + 0.01), 0.72, z, 0.04, 0.5, 1.15, 0x1c1d20);
  box(d, 'lit', p, 0, 1.1, 2.9, W - 0.25, 0.05, 0.03, 0xf4f8ff);
  box(d, 'lit', p, 0, 1.22, -2.9, W - 0.25, 0.06, 0.03, 0xff2a2a);
  box(d, 'smooth', p, 0, 1.35, -1.6, W - 0.1, 0.015, 0.02, 0x8d9299);
  for (const z of [-1.85, 1.85]) for (const x of [-1, 1]) wheel(d, p, x * 0.98, z, 0.44, 0.32, 0xcfd3d8);
}

// ------------------------------------------------------------------ the two-tone hypercar
export function hypercar(d: VDraw, p: Prop): void {
  const W = 2.05;
  const [lower, upper] = [[0x1d3b7a, 0x111214], [0xd8d9db, 0x16171a], [0x8c1622, 0x121214]][p.variant % 3];
  const shell = curved((s) => {
    s.moveTo(-2.27, 0.22);
    s.lineTo(-2.27, 0.72);
    s.quadraticCurveTo(-1.85, 0.98, -0.95, 1.1);
    s.quadraticCurveTo(0.05, 1.2, 0.72, 0.96);
    s.quadraticCurveTo(1.6, 0.68, 2.27, 0.56);
    s.lineTo(2.27, 0.26);
    s.quadraticCurveTo(1.6, 0.16, 0.0, 0.16);
    s.quadraticCurveTo(-1.6, 0.16, -2.27, 0.22);
  }, W);
  put(d, 'carpaint', shell, p, at(0, 0, 0), lower);
  shell.dispose();
  // the upper half (the cabin and the spine) in the second color, the glass in it
  const top = curved((s) => {
    s.moveTo(-1.9, 0.86);
    s.quadraticCurveTo(-1.5, 1.02, -0.95, 1.12);
    s.quadraticCurveTo(0.05, 1.22, 0.74, 0.98);
    s.lineTo(0.6, 0.86);
    s.closePath();
  }, W - 0.16, 0.03);
  put(d, 'carpaint', top, p, at(0, 0, 0), upper);
  top.dispose();
  const glass = curved((s) => {
    s.moveTo(-0.9, 0.92);
    s.quadraticCurveTo(-0.4, 1.17, 0.12, 1.16);
    s.quadraticCurveTo(0.45, 1.12, 0.7, 0.97);
    s.lineTo(0.55, 0.9);
    s.closePath();
  }, W - 0.12, 0.02);
  put(d, 'glassDark', glass, p, at(0, 0, 0), 0x141a22);
  glass.dispose();
  // a side air intake behind each door, a chrome sill, the wing, the lights
  for (const x of [-1, 1]) {
    box(d, 'smooth', p, x * (W / 2 + 0.005), 0.58, -0.55, 0.02, 0.32, 0.7, 0x0c0d0f);
    box(d, 'chrome', p, x * (W / 2 + 0.008), 0.24, 0.1, 0.02, 0.04, 2.6, 0xd7dbe0);
  }
  box(d, 'carpaint', p, 0, 0.98, -2.02, W - 0.2, 0.04, 0.32, upper);
  for (const x of [-0.7, 0.7]) box(d, 'smooth', p, x, 0.88, -2.0, 0.05, 0.14, 0.08, 0x111214);
  box(d, 'lit', p, 0, 0.7, -2.335, W - 0.3, 0.05, 0.03, 0xff2030);
  for (const x of [-0.72, 0.72]) box(d, 'lit', p, x, 0.6, 2.06, 0.42, 0.035, 0.3, 0xeef4ff);
  box(d, 'smooth', p, 0, 0.38, 2.33, 0.7, 0.16, 0.04, 0x0c0d0f); // the grille
  for (const z of [-1.42, 1.38]) for (const x of [-1, 1]) wheel(d, p, x * 0.91, z, 0.36, 0.3, 0xc9ccd1, { spokes: 5, caliper: 0xd42a2a });
}

// ------------------------------------------------------------------ the lifted off-road truck
export function liftedTruck(d: VDraw, p: Prop): void {
  const W = 2.25, paint = [0x2f3a46, 0x3d4a32, 0x7a1b1b][p.variant % 3], R = 0.6, lift = 1.08;
  const shell = body([[3.0, lift], [3.0, 1.92], [1.3, 2.0], [0.62, 2.6], [-0.88, 2.62], [-1.05, 2.0], [-3.0, 2.0], [-3.0, lift]], W, 0.04);
  put(d, 'carpaint', shell, p, at(0, 0, 0), paint);
  shell.dispose();
  const glass = body([[0.56, 2.05], [0.5, 2.5], [-0.8, 2.52], [-0.92, 2.05]], W + 0.02, 0);
  put(d, 'glassDark', glass, p, at(0, 0, 0), 0x141a22);
  glass.dispose();
  box(d, 'glassDark', p, 0, 2.3, 0.99, W - 0.3, 0.78, 0.04, 0x141a22, -0.85); // the windshield
  // the frame under it, the axles, the coilovers you can see through the wheel wells
  box(d, 'smooth', p, 0, lift - 0.12, 0, 1.3, 0.2, 5.4, 0x16171a);
  for (const z of [-1.95, 1.95]) {
    put(d, 'smooth', tubeGeo, p, at(0, R, z, 0.09, 1.9, 0.09, 0, Math.PI / 2), 0x232427);
    for (const x of [-0.62, 0.62]) put(d, 'smooth', tubeGeo, p, at(x, (R + lift) / 2 + 0.05, z - 0.2, 0.07, lift - R + 0.2, 0.07), 0xf2b705);
  }
  // fender flares, rock sliders, the bed rails, the roof rack and light bar, the bull bar
  for (const z of [-1.95, 1.95]) for (const x of [-1, 1]) box(d, 'smooth', p, x * (W / 2 + 0.06), lift + 0.12, z, 0.16, 0.12, 1.55, 0x101113);
  for (const x of [-1, 1]) box(d, 'smooth', p, x * (W / 2 + 0.05), lift - 0.05, 0, 0.1, 0.1, 2.4, 0x101113);
  for (const x of [-1, 1]) box(d, 'chrome', p, x * (W / 2 - 0.08), 2.12, -2.0, 0.05, 0.22, 1.9, 0x2a2c30);
  box(d, 'smooth', p, 0, 2.68, -0.2, W - 0.3, 0.06, 1.3, 0x151619);
  box(d, 'lit', p, 0, 2.74, 0.42, W - 0.5, 0.1, 0.1, 0xfff1c9);
  box(d, 'chrome', p, 0, 1.25, 3.12, W - 0.2, 0.1, 0.1, 0x2b2d31);
  for (const x of [-0.7, 0.7]) box(d, 'chrome', p, x, 1.48, 3.12, 0.1, 0.55, 0.1, 0x2b2d31);
  box(d, 'chrome', p, 0, 1.72, 3.12, 1.5, 0.1, 0.1, 0x2b2d31);
  for (const x of [-0.78, 0.78]) box(d, 'lit', p, x, 1.7, 3.06, 0.42, 0.14, 0.03, 0xeef4ff);
  for (const x of [-0.85, 0.85]) box(d, 'lit', p, x, 1.62, -3.06, 0.3, 0.3, 0.03, 0xff2a2a);
  for (const x of [-0.6, 0.6]) box(d, 'smooth', p, x, 1.22, 3.15, 0.08, 0.08, 0.08, 0xd42a2a); // tow hooks
  // a snorkel up the right side of the windshield
  put(d, 'smooth', tubeGeo, p, at(-(W / 2 + 0.05), 2.1, 0.75, 0.06, 1.0, 0.06), 0x111214);
  for (const z of [-1.95, 1.95]) for (const x of [-1, 1]) wheel(d, p, x * 1.0, z, R, 0.46, 0x1d1e21, { lug: true });
}

// ------------------------------------------------------------------ the high-roof cargo van
export function highVan(d: VDraw, p: Prop): void {
  const W = 2.02, paint = [0xf1f1ee, 0x1b1c1f, 0x9aa1a8][p.variant % 3];
  const shell = body([[3.0, 0.42], [3.0, 0.98], [2.55, 1.26], [1.75, 1.36], [1.1, 2.3], [0.85, 2.72], [-3.0, 2.72], [-3.0, 0.42]], W, 0.05);
  put(d, 'carpaint', shell, p, at(0, 0, 0), paint);
  shell.dispose();
  // windshield and the cab's side windows
  const glass = body([[1.7, 1.42], [1.12, 2.26], [0.3, 2.26], [0.3, 1.45]], W + 0.02, 0);
  put(d, 'glassDark', glass, p, at(0, 0, 0), 0x141a22);
  glass.dispose();
  box(d, 'smooth', p, 0, 0.6, 3.06, W - 0.1, 0.32, 0.06, 0x1a1b1d); // bumper
  box(d, 'smooth', p, 0, 0.95, 3.05, 1.1, 0.26, 0.04, 0x1a1b1d); // grille
  for (const x of [-0.8, 0.8]) box(d, 'lit', p, x, 1.05, 2.96, 0.36, 0.16, 0.06, 0xeef4ff);
  box(d, 'smooth', p, 0, 0.55, -3.07, W - 0.1, 0.22, 0.06, 0x1a1b1d);
  for (const x of [-0.92, 0.92]) box(d, 'lit', p, x, 1.2, -3.07, 0.12, 0.55, 0.03, 0xff2a2a);
  box(d, 'smooth', p, 0, 1.55, -3.065, 0.02, 2.0, 0.02, 0x8d9299); // the rear doors' seam
  for (const x of [-1, 1]) box(d, 'smooth', p, x * (W / 2 + 0.01), 1.4, -0.9, 0.015, 1.5, 0.02, 0x8d9299); // the sliding door's seam
  for (const z of [-1.85, 1.9]) for (const x of [-1, 1]) wheel(d, p, x * 0.9, z, 0.4, 0.28, 0x9ea4ab);
}
