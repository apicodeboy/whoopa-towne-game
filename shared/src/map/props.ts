import type { CollisionKind, Prop, PropType, Solid } from './types';

/**
 * Collision footprints for props, in the prop's local space
 * (x = width, y = up from the prop's base, z = length).
 * The client renders a model (or a procedural stand-in) for the prop and these
 * boxes are what players and bullets actually hit.
 */
interface LocalBox {
  x: number; y: number; z: number; // center, y measured from the prop base
  sx: number; sy: number; sz: number;
  col?: CollisionKind;
  /** Sub-part tag for the procedural stand-in visuals. */
  part?: string;
}

function lb(x: number, y0: number, z: number, sx: number, sy: number, sz: number, part?: string, col?: CollisionKind): LocalBox {
  return { x, y: y0 + sy / 2, z, sx, sy, sz, part, col };
}

export const PROP_SIZES = {
  boxcar: { w: 3.0, h: 4.2, l: 12.0, floor: 1.05 },
  flatcar: { w: 3.0, h: 1.1, l: 12.0 },
  container: { w: 2.44, h: 2.6, l: 6.1 },
  car: { w: 1.85, h: 1.45, l: 4.4 },
  van: { w: 2.1, h: 2.3, l: 5.2 },
  truck: { w: 2.5, h: 3.1, l: 7.0 },
} as const;

const B = PROP_SIZES.boxcar;

export const PROP_BOXES: Record<PropType, LocalBox[]> = {
  car: [
    lb(0, 0, 0, 1.85, 0.95, 4.4, 'body'),
    lb(0, 0.95, -0.25, 1.6, 0.5, 2.2, 'cabin'),
  ],
  van: [lb(0, 0, 0, 2.1, 2.3, 5.2, 'body')],
  truck: [
    lb(0, 0, 2.5, 2.3, 2.3, 2.0, 'cab'),
    lb(0, 0, -1.0, 2.5, 3.1, 5.0, 'box'),
  ],
  boxcar: [lb(0, 0, 0, B.w, B.h, B.l, 'body')],
  // Hollow boxcar with both side doors open: a pass-through with a 1.05m floor you hop onto.
  boxcar_open: [
    lb(0, 0, 0, B.w, B.floor, B.l, 'floor'),
    lb(0, B.h - 0.2, 0, B.w, 0.2, B.l, 'roof'),
    lb(0, B.floor, -B.l / 2 + 0.1, B.w, B.h - B.floor - 0.2, 0.2, 'end'),
    lb(0, B.floor, B.l / 2 - 0.1, B.w, B.h - B.floor - 0.2, 0.2, 'end'),
    // side walls, leaving a 3.4m door gap in the middle of each side
    lb(-B.w / 2 + 0.08, B.floor, -3.85, 0.16, B.h - B.floor - 0.2, 4.3, 'side'),
    lb(-B.w / 2 + 0.08, B.floor, 3.85, 0.16, B.h - B.floor - 0.2, 4.3, 'side'),
    lb(B.w / 2 - 0.08, B.floor, -3.85, 0.16, B.h - B.floor - 0.2, 4.3, 'side'),
    lb(B.w / 2 - 0.08, B.floor, 3.85, 0.16, B.h - B.floor - 0.2, 4.3, 'side'),
  ],
  flatcar: [lb(0, 0, 0, 3.0, 1.1, 12.0, 'body')],
  container: [lb(0, 0, 0, 2.44, 2.6, 6.1, 'body')],
  dumpster: [lb(0, 0, 0, 1.3, 1.35, 2.2, 'body')],
  barrier: [lb(0, 0, 0, 0.6, 1.0, 2.6, 'body')],
  crate: [lb(0, 0, 0, 1.1, 1.1, 1.1, 'body')],
  crate_big: [lb(0, 0, 0, 1.7, 1.7, 1.7, 'body')],
  tires: [lb(0, 0, 0, 1.3, 0.95, 1.3, 'body')],
  tree: [lb(0, 0, 0, 0.5, 4.4, 0.5, 'trunk')],
  lamp: [lb(0, 0, 0, 0.24, 6.2, 0.24, 'pole')],
  bench: [lb(0, 0, 0, 0.6, 0.85, 1.9, 'body')],
  hoop: [lb(0, 0, 0, 0.26, 3.5, 0.26, 'pole')],
  hydrant: [lb(0, 0, 0, 0.42, 0.8, 0.42, 'body')],
  busstop: [
    lb(-0.7, 0, 0, 0.1, 2.4, 3.4, 'glass', 'fence'),
    lb(0, 2.4, 0, 1.7, 0.12, 3.6, 'roof'),
  ],
  acunit: [lb(0, 0, 0, 1.2, 0.9, 1.2, 'body')],
  signal: [lb(0, 0, 0, 0.26, 4.2, 0.26, 'pole')],
  buffer: [lb(0, 0, 0, 2.4, 1.2, 0.9, 'body')],
  shelf: [lb(0, 0, 0, 0.6, 1.55, 5.0, 'body')],
  trashcan: [lb(0, 0, 0, 0.6, 0.95, 0.6, 'body')],
  cone: [],
  pallet: [lb(0, 0, 0, 1.2, 0.5, 1.2, 'body')],
  banner: [],
  palm: [lb(0, 0, 0, 0.45, 6.5, 0.45, 'trunk')],
  // undergrowth hides you but stops nothing
  bush: [],
  rock: [lb(0, 0, 0, 1.6, 1.1, 1.6, 'body')],
  boulder: [lb(0, 0, 0, 3.4, 2.4, 3.4, 'body')],
  log: [lb(0, 0, 0, 0.8, 0.8, 6.0, 'body')],
  umbrella: [lb(0, 0, 0, 0.12, 2.4, 0.12, 'pole')],
  boat: [lb(0, 0, 0, 2.2, 1.0, 5.6, 'hull')],
  tractor: [lb(0, 0, 0, 2.1, 1.6, 3.7, 'body'), lb(0, 1.6, -0.55, 1.3, 1.15, 1.4, 'cab')],
  // the garage at Cap's House
  wedgetruck: [lb(0, 0, 0, 2.2, 1.85, 5.7, 'body')],
  hypercar: [lb(0, 0, 0, 2.05, 1.15, 4.55, 'body')],
  liftedtruck: [lb(0, 0, 0, 2.25, 2.55, 6.0, 'body')],
  highvan: [lb(0, 0, 0, 2.02, 2.75, 6.0, 'body')],
};

/** Expands a prop into world-space collision solids. */
export function propSolids(prop: Prop, propIndex: number): Solid[] {
  const boxes = PROP_BOXES[prop.type];
  const s = Math.sin(prop.ry), c = Math.cos(prop.ry);
  const out: Solid[] = [];
  for (const b of boxes) {
    // rotate local (x,z) by heading: (x,z) -> (z*sin + x*cos, z*cos - x*sin)
    const wx = b.z * s + b.x * c;
    const wz = b.z * c - b.x * s;
    out.push({
      kind: 'prop',
      x: prop.x + wx,
      y: prop.y + b.y,
      z: prop.z + wz,
      sx: b.sx,
      sy: b.sy,
      sz: b.sz,
      ry: prop.ry,
      col: b.col ?? 'solid',
      prop: propIndex,
      style: b.part,
    });
  }
  return out;
}
