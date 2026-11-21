import { Rng } from '../math';
import type { MapBuilder, Side } from './builder';
import type { DoorKind, WindowKind } from './types';

/**
 * WHOOPA TOWNE architect: explorable buildings from a plan.
 *
 * A building is laid out in its own frame: `u` runs along the front wall (left to right seen
 * from the street), `v` runs from the front wall to the back. A plan says what goes where on
 * each floor (walls with openings, doors, windows, stairs, furniture, lights) and the
 * `Structure` turns it into collision boxes, working doors and windows, floors with stairwells,
 * roofs and roof access. Everything is ordinary map data, so the server, every client and the
 * tests build exactly the same building.
 */

/** Floor to floor height (meters). */
export const STORY = 3.2;
const EXT_T = 0.25;
const INT_T = 0.12;
const SLAB_T = 0.22;

/** An opening in a wall: a door (no sill), a window, or a plain doorway / arch. */
export interface ArchOpening {
  /** Center along the wall (u for front / back walls, v for side walls and walls along v). */
  at: number;
  w: number;
  /** Bottom of the opening above the floor (0 = a doorway). */
  sill?: number;
  /** Top of the opening above the floor. */
  top?: number;
  /** A door in it. */
  door?: DoorKind;
  lock?: boolean;
  locked?: boolean;
  /** For lockable interior doors: the room side (+1 toward +u / +v, -1 the other way). */
  inside?: 1 | -1;
  /** A window in it (and whether its glass breaks). */
  window?: WindowKind;
  breakable?: boolean;
}

export type FurnType =
  | 'couch' | 'armchair' | 'coffeetable' | 'tvstand' | 'rug' | 'lamp' | 'plant' | 'bookcase'
  | 'diningtable' | 'chair' | 'counter' | 'fridge' | 'stove' | 'kitchensink'
  | 'bed' | 'bedsingle' | 'wardrobe' | 'dresser' | 'nightstand' | 'desk' | 'officedesk'
  | 'toilet' | 'bathsink' | 'tub' | 'shower'
  | 'shelf' | 'register' | 'rack' | 'washer' | 'dryer' | 'barberchair' | 'mirror' | 'booth' | 'cooler'
  | 'workbench' | 'pallets' | 'boxes' | 'locker' | 'cabinet' | 'lantern' | 'altar' | 'stall' | 'tires';

/** Footprint (width along its own x, depth along its own z, height) and whether it blocks. */
const FURN: Record<FurnType, [number, number, number, boolean]> = {
  couch: [2.0, 0.9, 0.85, true], armchair: [0.9, 0.85, 0.85, true], coffeetable: [1.0, 0.55, 0.42, true],
  tvstand: [1.5, 0.42, 1.2, true], rug: [2.4, 1.7, 0.02, false], lamp: [0.35, 0.35, 1.5, false],
  plant: [0.45, 0.45, 1.1, false], bookcase: [1.1, 0.35, 1.9, true],
  diningtable: [1.5, 0.9, 0.76, true], chair: [0.48, 0.48, 0.92, false], counter: [2.4, 0.62, 0.92, true],
  fridge: [0.8, 0.72, 1.85, true], stove: [0.76, 0.64, 0.92, true], kitchensink: [1.0, 0.62, 0.92, true],
  bed: [1.6, 2.05, 0.62, true], bedsingle: [0.98, 2.0, 0.6, true], wardrobe: [1.2, 0.6, 2.0, true],
  dresser: [1.2, 0.5, 0.9, true], nightstand: [0.46, 0.42, 0.56, true], desk: [1.3, 0.62, 0.76, true],
  officedesk: [1.6, 0.8, 0.76, true], toilet: [0.42, 0.68, 0.78, true], bathsink: [0.58, 0.46, 0.88, true],
  tub: [0.78, 1.7, 0.58, true], shower: [0.92, 0.92, 2.1, true],
  shelf: [1.8, 0.5, 1.7, true], register: [1.6, 0.7, 1.0, true], rack: [1.6, 0.6, 1.6, true],
  washer: [0.66, 0.66, 0.92, true], dryer: [0.66, 0.66, 0.92, true], barberchair: [0.7, 0.8, 1.1, true],
  mirror: [1.2, 0.06, 1.0, false], booth: [1.6, 1.4, 1.05, true], cooler: [1.8, 0.75, 2.0, true],
  workbench: [2.0, 0.75, 0.92, true], pallets: [1.2, 1.0, 0.9, true], boxes: [1.0, 0.8, 1.3, true],
  locker: [0.9, 0.5, 1.9, true], cabinet: [1.0, 0.5, 1.0, true], lantern: [0.4, 0.4, 0.5, false],
  altar: [1.6, 0.7, 1.05, true], stall: [2.4, 1.2, 1.0, true], tires: [0.8, 0.8, 0.9, true],
};

/** Which way a piece of furniture's front faces, in the building's frame. */
export type Face = 'u+' | 'u-' | 'v+' | 'v-';
type WallSide = 'front' | 'back' | 'left' | 'right';

/** A building's place in the world and its frame. */
export class Lot {
  readonly W: number;
  readonly D: number;
  private ox: number;
  private oz: number;
  private U: [number, number];
  private V: [number, number];

  constructor(readonly x0: number, readonly x1: number, readonly z0: number, readonly z1: number, readonly facing: Side) {
    const sz = facing === 's' || facing === 'n';
    this.W = sz ? x1 - x0 : z1 - z0;
    this.D = sz ? z1 - z0 : x1 - x0;
    switch (facing) {
      case 's': this.ox = x0; this.oz = z1; this.U = [1, 0]; this.V = [0, -1]; break;
      case 'n': this.ox = x1; this.oz = z0; this.U = [-1, 0]; this.V = [0, 1]; break;
      case 'e': this.ox = x1; this.oz = z1; this.U = [0, -1]; this.V = [-1, 0]; break;
      default: this.ox = x0; this.oz = z0; this.U = [0, 1]; this.V = [1, 0]; break;
    }
  }

  /** World (x, z) of a local point. */
  pt(u: number, v: number): [number, number] {
    return [this.ox + this.U[0] * u + this.V[0] * v, this.oz + this.U[1] * u + this.V[1] * v];
  }

  /** World box of a local rectangle. */
  rect(u0: number, u1: number, v0: number, v1: number): { x0: number; x1: number; z0: number; z1: number } {
    const [ax, az] = this.pt(u0, v0), [bx, bz] = this.pt(u1, v1);
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
  }

  /** World yaw of a local direction. */
  yaw(face: Face): number {
    const d: [number, number] = face === 'u+' ? this.U : face === 'u-' ? [-this.U[0], -this.U[1]] : face === 'v+' ? this.V : [-this.V[0], -this.V[1]];
    return Math.atan2(d[0], d[1]);
  }

  /** The compass side a local wall faces outward. */
  side(wall: WallSide): Side {
    const out: [number, number] = wall === 'front' ? [-this.V[0], -this.V[1]] : wall === 'back' ? this.V : wall === 'left' ? [-this.U[0], -this.U[1]] : this.U;
    return out[0] > 0.5 ? 'e' : out[0] < -0.5 ? 'w' : out[1] > 0.5 ? 's' : 'n';
  }
}

interface Hole {
  u0: number; u1: number; v0: number; v1: number;
}

export interface StructureOpts {
  id: string;
  floors: number;
  style: string;
  color?: number;
  /** Interior wall color. */
  plaster?: number;
  roof?: 'flat' | 'pitched' | 'none';
  roofColor?: number;
  /** Floor finish per floor (index) or one for all. */
  floor?: 'wood' | 'tile' | 'carpet' | 'concrete' | Array<'wood' | 'tile' | 'carpet' | 'concrete'>;
  parapet?: boolean;
  /** Gaps in the parapet (where outside stairs reach the roof). */
  gaps?: Array<{ side: Side; at: number; w: number }>;
  story?: number;
  /** Pitched roofs: how high the ridge rises over the walls (default: a house's gentle pitch). */
  rise?: number;
  /** Pitched roofs: 'shingle' (default) or 'metal' (standing seam). */
  roofStyle?: string;
  /** Height of the ground floor (a building up on a hill). */
  base?: number;
}

/**
 * One building under construction. Call the plan methods, then `finish()`.
 */
export class Structure {
  readonly H: number;
  private ext = new Map<string, ArchOpening[]>();
  private holes: Hole[][] = [];
  private roofHoles: Hole[] = [];
  readonly id: string;

  constructor(readonly b: MapBuilder, readonly lot: Lot, readonly o: StructureOpts) {
    this.id = o.id;
    this.H = o.story ?? STORY;
    for (let f = 0; f <= o.floors; f++) this.holes.push([]);
  }

  get W(): number {
    return this.lot.W;
  }
  get D(): number {
    return this.lot.D;
  }

  /** Floor height (world y) of a floor. */
  y(floor: number): number {
    return (this.o.base ?? 0) + floor * this.H;
  }

  // ------------------------------------------------------------------ helpers
  private box(kind: string, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, extra: Record<string, unknown> = {}): void {
    const r = this.lot.rect(u0, u1, v0, v1);
    this.b.box(kind, r.x0, r.x1, r.z0, r.z1, y0, y1, { group: this.id, ...extra });
  }

  /**
   * A wall along u (fixed v = c) or along v (fixed u = c) from `from` to `to`, thickness t,
   * with openings (doors, windows, arches) cut out, and the doors and windows registered.
   */
  private wallRun(axis: 'u' | 'v', c: number, from: number, to: number, t: number, floor: number, openings: ArchOpening[], extra: Record<string, unknown>, outward?: 1 | -1): void {
    const y0 = this.y(floor), top = y0 + this.H - (floor < this.o.floors ? SLAB_T * 0 : 0);
    const wallTop = y0 + this.H;
    const piece = (a: number, bb: number, ya: number, yb: number) => {
      if (bb - a < 0.01 || yb - ya < 0.01) return;
      if (axis === 'u') this.box('wall', a, bb, c - t / 2, c + t / 2, ya, yb, extra);
      else this.box('wall', c - t / 2, c + t / 2, a, bb, ya, yb, extra);
    };
    let cur = from;
    for (const op of [...openings].sort((p, q) => p.at - q.at)) {
      const l = Math.max(from, op.at - op.w / 2), r = Math.min(to, op.at + op.w / 2);
      piece(cur, l, y0, wallTop);
      const sill = op.sill ?? 0, otop = Math.min(this.H - 0.05, op.top ?? (sill > 0 ? 2.25 : 2.2));
      if (sill > 0) piece(l, r, y0, y0 + sill);
      piece(l, r, y0 + otop, wallTop);
      cur = r;
      // what is in the opening
      const dirFace: Face = axis === 'u' ? 'u+' : 'v+';
      const a = this.lot.yaw(dirFace);
      const [hx, hz] = axis === 'u' ? this.lot.pt(l, c) : this.lot.pt(c, l);
      if (op.door) {
        // inside: for outer walls, the side the building is on; inside walls say it themselves
        const nIn = outward !== undefined ? (-outward as 1 | -1) : op.inside ?? 1;
        // the leaf's normal (cos a, -sin a) in local terms: +v for a wall along u, -u for one along v
        const normalSign = axis === 'u' ? 1 : -1;
        this.b.doors.push({
          x: hx, y: y0, z: hz, a, w: r - l, h: otop - 0.02, kind: op.door,
          lockable: !!op.lock, locked: !!op.locked, inside: (nIn * normalSign) as 1 | -1,
        });
      } else if (op.window) {
        const [cx, cz] = axis === 'u' ? this.lot.pt(op.at, c) : this.lot.pt(c, op.at);
        const normalSign = axis === 'u' ? 1 : -1;
        const out = outward !== undefined ? ((outward * normalSign) as 1 | -1) : undefined;
        this.b.windows.push({ x: cx, y: y0 + sill, z: cz, a, w: r - l, h: otop - sill, kind: op.window, breakable: op.breakable ?? op.window !== 'fixed', out });
      }
    }
    piece(cur, to, y0, wallTop);
    void top;
  }

  // ------------------------------------------------------------------ plan
  /** An opening in an outside wall of a floor (doors and windows: u along front / back, v along the sides). */
  opening(floor: number, wall: WallSide, op: ArchOpening): this {
    const k = `${floor}:${wall}`;
    if (!this.ext.has(k)) this.ext.set(k, []);
    this.ext.get(k)!.push(op);
    return this;
  }

  /** Windows spread along an outside wall at the given centers. */
  windows(floor: number, wall: WallSide, at: number[], w = 1.4, kind: WindowKind = 'slide', sill = 0.9, top = 2.25): this {
    for (const a of at) this.opening(floor, wall, { at: a, w, sill, top, window: kind });
    return this;
  }

  /** An inside wall along u at v = c (or along v at u = c), from `a` to `b`. */
  partition(floor: number, axis: 'u' | 'v', c: number, a: number, b: number, openings: ArchOpening[] = [], color?: number): this {
    this.wallRun(axis, c, a, b, INT_T, floor, openings, { style: 'plaster', color: color ?? this.o.plaster, meta: { int: 1 } });
    return this;
  }

  /**
   * A straight flight of stairs on `floor` up to the next one: `w` wide starting at u0 (its
   * low-u edge), running along v from `v0` (bottom) to `v1` (top), either way. `open` says
   * which sides are not against a wall (they get a handrail). The floor above gets a stairwell
   * with railings, except on the end you step off at and where `continues` (the next flight
   * starts right there, stacked over this one).
   */
  stairsV(floor: number, u0: number, w: number, v0: number, v1: number, open: 'u-' | 'u+' | 'both' | 'none' = 'u-', toRoof = false, continues = false): this {
    const up = v1 > v0;
    // the ramp's rail sides are relative to the way up: climbing +v, the right hand is +u
    const right = up ? 'u+' : 'u-';
    const rails = open === 'both' ? 'both' : open === 'none' ? 'none' : open === right ? 'right' : 'left';
    const [x, z] = this.lot.pt(u0 + w / 2, v0);
    this.b.ramp({
      kind: 'stairs', x, z, y0: this.y(floor), dir: this.lot.yaw(up ? 'v+' : 'v-'), run: Math.abs(v1 - v0), rise: this.H, width: w,
      fill: floor === 0, rails, style: 'concrete', group: this.id, thickness: 0.25,
    });
    const hole: Hole = { u0: u0 - 0.05, u1: u0 + w + 0.05, v0: Math.min(v0, v1) - 0.05, v1: Math.max(v0, v1) + 0.05 };
    if (toRoof) this.roofHoles.push(hole);
    else this.holes[floor + 1].push(hole);
    const yy = this.y(floor + 1);
    const rail = (u0r: number, u1r: number, v0r: number, v1r: number) => this.box('rail', u0r, u1r, v0r, v1r, yy, yy + 1.0, { col: 'fence', meta: { int: 1 } });
    // the low end of the stairwell (where the flight starts, a floor down) is a drop
    const lowEnd = up ? hole.v0 : hole.v1;
    if (!continues) rail(hole.u0, hole.u1, lowEnd - 0.03, lowEnd + 0.03);
    if (open === 'u-' || open === 'both') rail(hole.u0 - 0.03, hole.u0 + 0.03, hole.v0, hole.v1);
    if (open === 'u+' || open === 'both') rail(hole.u1 - 0.03, hole.u1 + 0.03, hole.v0, hole.v1);
    return this;
  }

  /** Stairs running along u (see stairsV): `w` wide from v0, from u0 (bottom) to u1 (top). */
  stairsU(floor: number, v0: number, w: number, u0: number, u1: number, open: 'v-' | 'v+' | 'both' | 'none' = 'v-'): this {
    const up = u1 > u0;
    // climbing +u, the right hand is -v
    const right = up ? 'v-' : 'v+';
    const rails = open === 'both' ? 'both' : open === 'none' ? 'none' : open === right ? 'right' : 'left';
    const [x, z] = this.lot.pt(u0, v0 + w / 2);
    this.b.ramp({
      kind: 'stairs', x, z, y0: this.y(floor), dir: this.lot.yaw(up ? 'u+' : 'u-'), run: Math.abs(u1 - u0), rise: this.H, width: w,
      fill: floor === 0, rails, style: 'concrete', group: this.id, thickness: 0.25,
    });
    const hole: Hole = { u0: Math.min(u0, u1) - 0.05, u1: Math.max(u0, u1) + 0.05, v0: v0 - 0.05, v1: v0 + w + 0.05 };
    this.holes[floor + 1].push(hole);
    const yy = this.y(floor + 1);
    const rail = (u0r: number, u1r: number, v0r: number, v1r: number) => this.box('rail', u0r, u1r, v0r, v1r, yy, yy + 1.0, { col: 'fence', meta: { int: 1 } });
    const lowEnd = up ? hole.u0 : hole.u1;
    rail(lowEnd - 0.03, lowEnd + 0.03, hole.v0, hole.v1);
    if (open === 'v-' || open === 'both') rail(hole.u0, hole.u1, hole.v0 - 0.03, hole.v0 + 0.03);
    if (open === 'v+' || open === 'both') rail(hole.u0, hole.u1, hole.v1 - 0.03, hole.v1 + 0.03);
    return this;
  }

  /**
   * Leaves a piece of a floor out, so the room below is open to the one above (a great room
   * under a loft), with a railing along the edges named in `rails`.
   */
  open(floor: number, u0: number, u1: number, v0: number, v1: number, rails: Array<'u-' | 'u+' | 'v-' | 'v+'>): this {
    this.holes[floor].push({ u0, u1, v0, v1 });
    const yy = this.y(floor);
    const rail = (a: number, c: number, d: number, e: number) => this.box('rail', a, c, d, e, yy, yy + 1.0, { col: 'fence', meta: { int: 1 } });
    if (rails.includes('u-')) rail(u0 - 0.03, u0 + 0.03, v0, v1);
    if (rails.includes('u+')) rail(u1 - 0.03, u1 + 0.03, v0, v1);
    if (rails.includes('v-')) rail(u0, u1, v0 - 0.03, v0 + 0.03);
    if (rails.includes('v+')) rail(u0, u1, v1 - 0.03, v1 + 0.03);
    return this;
  }

  /** A piece of furniture: centered at (u, v) on a floor, its front facing `face`. */
  furn(floor: number, t: FurnType, u: number, v: number, face: Face = 'v-', scale: number | [number, number] = 1): this {
    const [w, d, h, solid] = FURN[t];
    const [x, z] = this.lot.pt(u, v);
    const [kw, kd] = typeof scale === 'number' ? [scale, scale] : scale;
    this.b.rbox('furn', x, z, w * kw, d * kd, this.y(floor), h, this.lot.yaw(face), { col: solid ? 'solid' : 'none', group: this.id, meta: { t, int: 1 } });
    return this;
  }

  /**
   * A stone band round the bottom of the outside walls (drawn only), `h` tall, with gaps where a
   * doorway, a bay or a low window is on the ground floor.
   */
  skirt(h: number, kind = 'wainscot'): this {
    const { W, D } = this;
    const base = this.y(0);
    const walls: Array<[WallSide, number]> = [['front', W], ['back', W], ['left', D], ['right', D]];
    for (const [wall, len] of walls) {
      const cuts = (this.ext.get(`0:${wall}`) ?? []).filter((o) => (o.sill ?? 0) < h).map((o) => [o.at - o.w / 2, o.at + o.w / 2] as const).sort((a, c) => a[0] - c[0]);
      let t = -0.06;
      const spans: Array<[number, number]> = [];
      for (const [c0, c1] of cuts) {
        if (c0 > t + 0.05) spans.push([t, c0]);
        t = Math.max(t, c1);
      }
      if (len + 0.06 > t + 0.05) spans.push([t, len + 0.06]);
      for (const [a, c] of spans) {
        const r = wall === 'front' ? this.lot.rect(a, c, -0.06, 0.02) : wall === 'back' ? this.lot.rect(a, c, D - 0.02, D + 0.06)
          : wall === 'left' ? this.lot.rect(-0.06, 0.02, a, c) : this.lot.rect(W - 0.02, W + 0.06, a, c);
        this.b.box(kind, r.x0, r.x1, r.z0, r.z1, base, base + h, { col: 'none', group: this.id });
      }
    }
    return this;
  }

  /** A ceiling light over (u, v). */
  light(floor: number, u: number, v: number): this {
    const [x, z] = this.lot.pt(u, v);
    const y = this.y(floor + 1) - SLAB_T - 0.03;
    this.b.box('lamp', x - 0.25, x + 0.25, z - 0.25, z + 0.25, y - 0.04, y, { col: 'none', group: this.id, meta: { int: 1 } });
    return this;
  }

  /** A spot for loot on a floor. */
  loot(floor: number, u: number, v: number): this {
    const [x, z] = this.lot.pt(u, v);
    this.b.loot(x, z, this.y(floor));
    return this;
  }

  /** A balcony outside a wall (a slab with railings), on `floor`, from `a` to `b` along the wall. */
  balcony(floor: number, wall: WallSide, a: number, bb: number, depth = 1.3): this {
    const y = this.y(floor);
    const r = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, kind: string, extra: Record<string, unknown> = {}) => this.box(kind, u0, u1, v0, v1, y0, y1, extra);
    if (wall === 'front') {
      r(a, bb, -depth, 0, y - 0.2, y, 'deck', { style: 'concrete' });
      r(a, bb, -depth, -depth + 0.06, y, y + 1.0, 'rail', { col: 'fence' });
      r(a, a + 0.06, -depth, 0, y, y + 1.0, 'rail', { col: 'fence' });
      r(bb - 0.06, bb, -depth, 0, y, y + 1.0, 'rail', { col: 'fence' });
    } else if (wall === 'back') {
      r(a, bb, this.D, this.D + depth, y - 0.2, y, 'deck', { style: 'concrete' });
      r(a, bb, this.D + depth - 0.06, this.D + depth, y, y + 1.0, 'rail', { col: 'fence' });
      r(a, a + 0.06, this.D, this.D + depth, y, y + 1.0, 'rail', { col: 'fence' });
      r(bb - 0.06, bb, this.D, this.D + depth, y, y + 1.0, 'rail', { col: 'fence' });
    } else {
      const u0 = wall === 'left' ? -depth : this.W, u1 = wall === 'left' ? 0 : this.W + depth;
      r(u0, u1, a, bb, y - 0.2, y, 'deck', { style: 'concrete' });
      const ou = wall === 'left' ? u0 : u1 - 0.06;
      r(ou, ou + 0.06, a, bb, y, y + 1.0, 'rail', { col: 'fence' });
      r(u0, u1, a, a + 0.06, y, y + 1.0, 'rail', { col: 'fence' });
      r(u0, u1, bb - 0.06, bb, y, y + 1.0, 'rail', { col: 'fence' });
    }
    return this;
  }

  /**
   * An outside fire escape on a side wall: at every upper floor a walkway along the wall (by a
   * window you can climb through), and steel flights in an outer lane, stacked one over the
   * next, from the street to the top landing. `v0` is where the flights start.
   */
  fireEscape(wall: 'left' | 'right', v0: number): this {
    const out = wall === 'left' ? -1 : 1;
    const base = wall === 'left' ? 0 : this.W;
    const lane = 1.1, run = 3.7, len = run + 1.1;
    // local u of a distance `d` out from the wall
    const at = (d: number) => base + out * d;
    const span = (d0: number, d1: number): [number, number] => [Math.min(at(d0), at(d1)), Math.max(at(d0), at(d1))];
    for (let f = 1; f < this.o.floors; f++) {
      const y = this.y(f);
      const [iu0, iu1] = span(0, lane);
      const [ou0, ou1] = span(lane, lane * 2);
      // walkway by the wall, and the outer lane past the top of the flight
      this.box('platform', iu0, iu1, v0, v0 + len, y - 0.1, y, { style: 'metal' });
      this.box('platform', ou0, ou1, v0 + run, v0 + len, y - 0.1, y, { style: 'metal' });
      const [ru0, ru1] = span(lane * 2 - 0.05, lane * 2);
      this.box('rail', ru0, ru1, v0 + run, v0 + len, y, y + 1.0, { col: 'fence' });
      this.box('rail', iu0, ou1, v0 + len - 0.05, v0 + len, y, y + 1.0, { col: 'fence' });
      this.box('rail', iu0, iu1, v0, v0 + 0.05, y, y + 1.0, { col: 'fence' });
      // the flight up to this floor, in the outer lane
      const [sx, sz] = this.lot.pt(at(lane * 1.5), v0);
      this.b.ramp({
        kind: 'stairs', x: sx, z: sz, y0: y - this.H, dir: this.lot.yaw('v+'), run, rise: this.H,
        width: lane - 0.08, rails: out < 0 ? 'left' : 'right', style: 'metal', group: this.id, thickness: 0.12,
      });
    }
    return this;
  }

  /** A loot spot list helper for whole rooms (center of a local rect). */
  room(floor: number, u0: number, u1: number, v0: number, v1: number, kind: 'wood' | 'tile' | 'carpet' | 'concrete', light = true): this {
    if (light) this.light(floor, (u0 + u1) / 2, (v0 + v1) / 2);
    const r = this.lot.rect(u0, u1, v0, v1);
    // (a ground floor on raised ground gets a finish of its own: ground areas lie at level 0)
    if (floor === 0 && !this.o.base) this.b.area(`floor_${kind}`, r.x0, r.x1, r.z0, r.z1, 4);
    else {
      // (on a hill the ground is drawn a hair above its true height: the floor goes over it)
      const lift = floor === 0 ? 0.016 : 0;
      this.b.box('floorfinish', r.x0, r.x1, r.z0, r.z1, this.y(floor) + lift, this.y(floor) + lift + 0.005, { col: 'none', group: this.id, meta: { int: 1, f: kind } });
    }
    return this;
  }

  // ------------------------------------------------------------------ build
  /** Outside walls, floors with their stairwells, the roof. */
  finish(): void {
    const { W, D } = this;
    const F = this.o.floors;
    const ext = { style: this.o.style, color: this.o.color };
    // (liner: the plaster color the renderer gives the wall's inside face)
    const m = (w: WallSide) => ({ side: this.lot.side(w), liner: this.o.plaster ?? 0xe9e2d6 });
    for (let f = 0; f < F; f++) {
      const ops = (w: WallSide) => this.ext.get(`${f}:${w}`) ?? [];
      // front / back span the full width; the sides fit between them
      this.wallRun('u', EXT_T / 2, 0, W, EXT_T, f, ops('front'), { ...ext, meta: m('front') }, -1);
      this.wallRun('u', D - EXT_T / 2, 0, W, EXT_T, f, ops('back'), { ...ext, meta: m('back') }, 1);
      this.wallRun('v', EXT_T / 2, EXT_T, D - EXT_T, EXT_T, f, ops('left'), { ...ext, meta: m('left') }, -1);
      this.wallRun('v', W - EXT_T / 2, EXT_T, D - EXT_T, EXT_T, f, ops('right'), { ...ext, meta: m('right') }, 1);
      // ceiling / next floor
      const top = this.y(f + 1);
      const holes = f + 1 < F ? this.holes[f + 1] : this.roofHoles;
      if (f + 1 < F || this.o.roof !== 'pitched') this.slab(EXT_T, W - EXT_T, EXT_T, D - EXT_T, top - SLAB_T, top, holes, f + 1 < F ? 'floorslab' : 'roof');
    }
    const top = this.y(F);
    if (this.o.roof === 'pitched') {
      // a ceiling over the top floor, then two roof planes meeting at a ridge along u
      this.slab(EXT_T, W - EXT_T, EXT_T, D - EXT_T, top - SLAB_T, top, [], 'floorslab');
      const over = 0.45, rise = this.o.rise ?? Math.min(2.6, D * 0.32);
      for (const sgn of [-1, 1]) {
        const v0 = sgn < 0 ? -over : D / 2, v1 = sgn < 0 ? D / 2 : D + over;
        const run = v1 - v0;
        const len = Math.hypot(run, rise);
        const a = Math.atan2(rise, run);
        const [cx, cz] = this.lot.pt(W / 2, (v0 + v1) / 2);
        // tilt about the ridge: rx in the frame where the slope runs along local z
        const yaw = this.lot.yaw(sgn < 0 ? 'v+' : 'v-');
        this.b.solids.push({
          kind: 'roofplane', x: cx, y: top + rise / 2 + 0.1, z: cz, sx: W + over * 2, sy: 0.22, sz: len, ry: yaw, rx: -a,
          group: this.id, color: this.o.roofColor, style: this.o.roofStyle ?? 'shingle',
        });
      }
      // the gable ends: triangles on the side walls (drawn only; the attic is closed off)
      for (const end of [0, W]) {
        const [gx, gz] = this.lot.pt(end === 0 ? EXT_T / 2 : W - EXT_T / 2, D / 2);
        this.b.solids.push({
          kind: 'gable', x: gx, y: top + (rise + 0.1) / 2, z: gz, sx: EXT_T, sy: rise + 0.1, sz: D, ry: this.lot.yaw('v+'),
          col: 'none', group: this.id, style: this.o.style, color: this.o.color,
        });
      }
      const at = this.lot.rect(EXT_T, W - EXT_T, D * 0.3, D * 0.7);
      this.b.box('attic', at.x0, at.x1, at.z0, at.z1, top, top + rise * 0.55, { group: this.id });
    } else if (this.o.parapet !== false && this.o.roof !== 'none') {
      const r = this.lot.rect(0, W, 0, D);
      this.b.parapet(this.id, r.x0, r.x1, r.z0, r.z1, top, 0.9, this.o.gaps ?? [], this.o.style);
    }
  }

  /** A floor / ceiling slab over a rectangle with holes cut out. */
  private slab(u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, holes: Hole[], kind: string): void {
    // split the rectangle along v at every hole edge, then each band along u
    const vs = new Set<number>([v0, v1]);
    for (const h of holes) {
      vs.add(Math.max(v0, Math.min(v1, h.v0)));
      vs.add(Math.max(v0, Math.min(v1, h.v1)));
    }
    const vv = [...vs].sort((a, b) => a - b);
    for (let i = 0; i + 1 < vv.length; i++) {
      const a = vv[i], bb = vv[i + 1];
      if (bb - a < 0.01) continue;
      const mid = (a + bb) / 2;
      const cuts = holes.filter((h) => mid > h.v0 && mid < h.v1).map((h) => [Math.max(u0, h.u0), Math.min(u1, h.u1)] as [number, number]).sort((p, q) => p[0] - q[0]);
      let cur = u0;
      for (const [c0, c1] of cuts) {
        if (c0 - cur > 0.01) this.box(kind, cur, c0, a, bb, y0, y1, kind === 'roof' ? { style: this.o.style, meta: { arch: 1 } } : { meta: { int: 1 } });
        cur = Math.max(cur, c1);
      }
      if (u1 - cur > 0.01) this.box(kind, cur, u1, a, bb, y0, y1, kind === 'roof' ? { style: this.o.style, meta: { arch: 1 } } : { meta: { int: 1 } });
    }
  }
}

// =================================================================================== building types
export type BuildingType =
  | 'house1' | 'house2' | 'duplex' | 'townhouse' | 'apartment' | 'store' | 'barbershop' | 'laundromat'
  | 'office' | 'restaurant' | 'warehouse' | 'garage' | 'workshop' | 'storage' | 'tenement'
  // CAP'S HOUSE and the farms
  | 'cabin' | 'garage4' | 'barn';

export interface BuildingSpec {
  id: string;
  type: BuildingType;
  x0: number; x1: number; z0: number; z1: number;
  facing: Side;
  floors?: number;
  style?: string;
  color?: number;
  roofColor?: number;
  /** Store sign over the front. */
  sign?: { text: string; color: string; bg: string };
  /** Apartments: leave off the fire escape (no room beside it). */
  fireEscape?: boolean;
  /** Floor-to-floor height (default STORY). */
  story?: number;
  /** Inside wall color (default: one of the clean plasters). */
  plaster?: number;
  /** Gaps in the roof's parapet. */
  gaps?: Array<{ side: Side; at: number; w: number }>;
  seed?: number;
  /** Height of the ground floor (a building up on a hill; default 0). */
  base?: number;
}

/** Builds one explorable building. Returns the structure (for anything extra a caller adds). */
export function construct(b: MapBuilder, spec: BuildingSpec): Structure {
  const lot = new Lot(spec.x0, spec.x1, spec.z0, spec.z1, spec.facing);
  const rng = new Rng(spec.seed ?? hashId(spec.id));
  switch (spec.type) {
    case 'house1': return house(b, lot, spec, rng, 1);
    case 'house2': return house(b, lot, spec, rng, 2);
    case 'duplex': return duplex(b, lot, spec, rng);
    case 'townhouse': return house(b, lot, spec, rng, 2, true);
    case 'apartment':
    case 'tenement': return apartments(b, lot, spec, rng);
    case 'store':
    case 'barbershop':
    case 'laundromat':
    case 'restaurant': return shop(b, lot, spec, rng);
    case 'office': return offices(b, lot, spec, rng);
    case 'cabin': return cabin(b, lot, spec);
    case 'garage4': return garage4(b, lot, spec);
    case 'barn': return barn(b, lot, spec, rng);
    default: return industrial(b, lot, spec, rng);
  }
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const PLASTERS = [0xe9e2d6, 0xdfe5e8, 0xe8dccb, 0xd9e2d3, 0xeadfd8, 0xf0ead8];

/**
 * A house, one or two floors, on a lot 6.5–10.5 m wide and 8.5–10 m deep.
 *
 * Two floors (the reference building): you come in the front door into the hall on the right,
 * the stairs straight ahead along the right wall; the living room is through the arch on the
 * left, the kitchen behind it, the back door at the end of the hall. Upstairs, off the landing
 * and the hallway beside the stairwell: the front bedroom, the bathroom (it locks) and the back
 * bedroom with a walk-in closet. One floor: the same downstairs, with a bedroom and a bathroom
 * where the stairs would be.
 */
function house(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng, floors: 1 | 2, flatRoof = false): Structure {
  const { W, D } = lot;
  const s = new Structure(b, lot, {
    id: spec.id, floors, style: spec.style ?? 'siding', color: spec.color, plaster: rng.pick(PLASTERS),
    roof: flatRoof ? 'flat' : 'pitched', roofColor: spec.roofColor, floor: 'wood',
  });
  const E = EXT_T, I = INT_T / 2;
  // the hall: u > hallU (one floor: wider, a bathroom and a bedroom share it)
  const hallU = floors === 2 ? W - 2.5 : W - 3.4;
  const split = Math.round(D * 0.52 * 10) / 10; // living room | kitchen
  const uc = Math.max(1.75, (hallU - 1.3) / 2 + 0.15); // middle of the living room's furniture
  // ---- downstairs
  // two floors: the front door lines up with the stairs, so you walk straight in and up
  const doorU = floors === 2 ? W - E - 0.55 : hallU + 0.62;
  s.opening(0, 'front', { at: doorU, w: 0.9, door: 'wood', lock: true });
  s.opening(0, 'back', { at: hallU + 0.7, w: 0.9, door: 'wood', lock: true });
  s.windows(0, 'front', [Math.min(uc, hallU - 1.2)], Math.min(1.8, hallU - 1.2));
  s.windows(0, 'left', [split * 0.5, split + (D - split) * 0.5], 1.3);
  s.windows(0, 'back', [Math.max(1.6, uc + 0.2)], 1.2, 'slide', 1.1, 2.2);
  // the hall wall: an arch into the living room, a doorway into the kitchen
  s.partition(0, 'v', hallU, E, D - E, [
    { at: split - 1.2, w: 1.4, top: 2.35 },
    { at: split + 1.0, w: 0.9 },
  ]);
  // living room | kitchen, open by the hall
  s.partition(0, 'u', split, E, hallU, [{ at: hallU - 0.85, w: 1.1, top: 2.35 }]);
  s.room(0, E, hallU, E, split, 'wood').room(0, E, hallU, split, D - E, 'tile').room(0, hallU, W - E, E, D - E, 'wood');
  // living room: the couch under the front window facing the TV on the kitchen wall
  s.furn(0, 'rug', uc, split * 0.5, 'v+', 0.8);
  s.furn(0, 'couch', uc, E + 0.55, 'v+');
  s.furn(0, 'coffeetable', uc, E + 1.75, 'v+');
  s.furn(0, 'tvstand', uc, split - I - 0.24, 'v-');
  if (uc > 2.4) s.furn(0, 'armchair', E + 0.5, split - I - 0.95, 'u+');
  s.furn(0, 'lamp', E + 0.3, E + 0.3);
  s.furn(0, 'plant', hallU - I - 0.3, E + 0.3);
  // kitchen: fridge, counter and stove along the back wall, the table in the middle
  s.furn(0, 'fridge', E + 0.42, D - E - 0.38, 'v-');
  const counterW = Math.min(2.4, hallU - E - 0.9 - (hallU > 5.2 ? 0.8 : 0) - 0.2);
  s.furn(0, 'counter', E + 0.85 + counterW / 2, D - E - 0.32, 'v-', [counterW / 2.4, 1]);
  if (hallU > 5.2) s.furn(0, 'stove', E + 0.9 + counterW + 0.4, D - E - 0.33, 'v-');
  const tv = split + (D - split) * 0.42;
  s.furn(0, 'diningtable', Math.min(uc, hallU - 1.6), tv, 'u+');
  s.furn(0, 'chair', Math.min(uc, hallU - 1.6) - 0.75, tv, 'u+');
  s.furn(0, 'chair', Math.min(uc, hallU - 1.6) + 0.75, tv, 'u-');
  s.loot(0, Math.min(uc, hallU - 1.6), tv + 0.9);
  s.loot(0, uc + 0.9, E + 1.6);
  if (floors === 1) {
    // the hall runs from the front door to the bedroom at the back; the bathroom is beside it
    const bv = Math.round(D * 0.45 * 10) / 10, cu = hallU + 1.25;
    s.partition(0, 'u', bv, hallU, W - E, [{ at: hallU + 0.62, w: 0.85, door: 'wood', lock: true, inside: 1 }]);
    s.partition(0, 'v', cu, E, bv, [{ at: 1.5, w: 0.8, door: 'wood', lock: true, inside: 1 }]);
    s.room(0, cu, W - E, E, bv, 'tile');
    s.furn(0, 'toilet', W - E - 0.36, E + 0.5, 'u-');
    s.furn(0, 'bathsink', W - E - 0.25, 2.0, 'u-');
    s.furn(0, 'shower', W - E - 0.47, bv - I - 0.47, 'u-');
    s.furn(0, 'bed', W - E - 1.15, D - E - 1.05, 'v-');
    s.furn(0, 'wardrobe', W - E - 0.32, bv + I + 0.75, 'u-');
    s.loot(0, hallU + 1.6, bv + 1.0);
    s.finish();
    porch(b, lot, s, spec, doorU);
    return s;
  }
  // the stairs along the right wall, from just inside the front door up toward the back
  const sw = 1.0, su = W - E - sw;
  const vb = 1.5, run = Math.min(4.3, D - vb - 2.6);
  s.stairsV(0, su, sw, vb, vb + run, 'u-');
  // ---- upstairs
  const bedV = Math.round(D * 0.47 * 10) / 10;
  const bathV = bedV + 2.2;
  const bathU = Math.max(E + 1.4, hallU - 2.6);
  s.windows(1, 'front', [Math.min(uc, hallU - 1.2)], Math.min(1.6, hallU - 1.4), 'slide', 0.95);
  s.opening(1, 'front', { at: doorU - 0.2, w: 0.8, sill: 1.0, window: 'hinge' });
  s.windows(1, 'left', [bedV * 0.5, (bathV + D) / 2], 1.2, 'hinge', 0.95);
  s.windows(1, 'back', [Math.max(1.5, (E + hallU) / 2)], 1.2, 'slide', 0.95);
  s.partition(1, 'v', hallU, E, D - E, [
    { at: 0.95, w: 0.85, door: 'wood' },
    { at: bedV + 1.1, w: 0.85, door: 'wood', lock: true, inside: -1 },
    { at: D - E - 0.75, w: 0.85, door: 'wood' },
  ]);
  s.partition(1, 'u', bedV, E, hallU);
  s.partition(1, 'u', bathV, E, hallU, [{ at: (E + bathU) / 2, w: 0.8 }]);
  s.partition(1, 'v', bathU, bedV, bathV);
  s.room(1, E, hallU, E, bedV, 'carpet').room(1, bathU, hallU, bedV, bathV, 'tile').room(1, E, hallU, bathV, D - E, 'carpet').room(1, hallU, W - E, E, D - E, 'wood');
  // front bedroom: the bed against the bedroom wall, a wardrobe by the window
  // (a narrow room has the bed against the hall wall, the floor open on the window side)
  const bu = hallU < 6 ? hallU - I - 0.85 : Math.min(hallU - 1.3, Math.max(1.4, hallU * 0.45));
  s.furn(1, 'bed', bu, bedV - I - 1.05, 'v-');
  // (in a narrow room it goes on the open side, so there is no dead corner by the wardrobe)
  s.furn(1, 'nightstand', bu - 1.08, bedV - I - 0.25);
  s.furn(1, 'wardrobe', E + 0.32, E + 0.75, 'u+');
  if (hallU > 4.6) s.furn(1, 'dresser', hallU - I - 0.27, bedV - 1.2, 'u-');
  s.loot(1, bu, E + 0.9);
  // bathroom
  s.furn(1, 'tub', bathU + I + 0.41, bedV + 1.05, 'u+');
  s.furn(1, 'toilet', hallU - 1.3, bathV - I - 0.36, 'v-');
  s.furn(1, 'bathsink', hallU - 1.3, bedV + I + 0.24, 'v+');
  // back bedroom and its closet
  s.furn(1, 'bedsingle', E + 1.1, D - E - 0.52, 'u+');
  if (hallU > 5) {
    s.furn(1, 'desk', (E + 2.2 + hallU - 0.9) / 2, D - E - 0.32, 'v-');
    s.furn(1, 'chair', (E + 2.2 + hallU - 0.9) / 2, D - E - 0.95, 'v+');
  }
  s.furn(1, 'wardrobe', E + 0.32, bedV + 1.1, 'u+');
  s.loot(1, E + 0.8, bedV + 0.6);
  s.loot(1, (E + hallU) / 2, bathV + 0.8);
  // the landing: something to hide behind
  s.furn(1, 'bookcase', W - E - 0.2, D - E - 1.0, 'u-', 0.9);
  s.finish();
  porch(b, lot, s, spec, doorU);
  return s;
}

/** A covered front porch: a stoop, two posts, a little roof, a light by the door. */
function porch(b: MapBuilder, lot: Lot, s: Structure, spec: BuildingSpec, doorU: number): void {
  const u1 = Math.min(doorU + 1.3, lot.W - 0.05), u0 = Math.min(doorU - 1.5, u1 - 2.8);
  // (two low steps: the character controller steps up 0.15 and 0.3 cleanly)
  const r = lot.rect(u0, u1, -1.8, 0);
  b.box('stoop', r.x0, r.x1, r.z0, r.z1, 0, 0.3, { color: 0xb9b4a8 });
  const st = lot.rect(doorU - 0.8, doorU + 0.8, -2.2, -1.8);
  b.box('stoop', st.x0, st.x1, st.z0, st.z1, 0, 0.15, { color: 0xb9b4a8 });
  for (const u of [u0 + 0.12, u1 - 0.12]) {
    const p = lot.rect(u - 0.08, u + 0.08, -1.7, -1.54);
    b.box('post', p.x0, p.x1, p.z0, p.z1, 0.3, 2.8, { color: 0xf0ece4 });
  }
  const roof = lot.rect(u0 - 0.1, u1 + 0.1, -1.95, 0);
  b.box('awningroof', roof.x0, roof.x1, roof.z0, roof.z1, 2.8, 2.95, { color: spec.roofColor ?? 0x6b4a3a, group: s.id });
  void spec;
}

/** Two homes side by side, mirror images, each a two-floor house plan. */
function duplex(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const half = lot.W / 2;
  const mk = (i: number) => {
    const r = lot.rect(i === 0 ? 0 : half, i === 0 ? half : lot.W, 0, lot.D);
    return house(b, new Lot(r.x0, r.x1, r.z0, r.z1, lot.facing), { ...spec, id: `${spec.id}${i ? 'b' : 'a'}`, type: 'house2' }, rng, 2);
  };
  mk(0);
  return mk(1);
}

/**
 * Stairs carried up through every floor along the right wall (each flight starts at the front
 * of the stairwell and rises toward the back, stacked over the one below), out onto the roof
 * through a bulkhead with a door.
 */
function stairTower(s: Structure, sw: number, lv: number, run: number): void {
  const F = s.o.floors;
  const su = s.W - EXT_T - sw;
  for (let f = 0; f < F; f++) s.stairsV(f, su, sw, lv, lv + run, 'u-', f === F - 1, f < F - 1);
  // the bulkhead on the roof
  const b = s.b, lot = s.lot;
  const top = s.y(F), h = 2.6, T = 0.2;
  const u0 = su - 1.0, v0 = lv - 0.4, v1 = lv + run + 1.5;
  const ext = { style: s.o.style, color: s.o.color, group: `${s.id}_bulk` };
  const wall = (a0: number, a1: number, b0: number, b1: number, y0 = top, y1 = top + h) => {
    const r = lot.rect(a0, a1, b0, b1);
    b.box('wall', r.x0, r.x1, r.z0, r.z1, y0, y1, ext);
  };
  wall(s.W - EXT_T, s.W, v0 - T, v1 + T);
  wall(u0 - T, s.W - EXT_T, v0 - T, v0);
  wall(u0 - T, s.W - EXT_T, v1, v1 + T);
  const dw = 0.95, dv = v1 - 0.7;
  wall(u0 - T, u0, v0, dv - dw / 2);
  wall(u0 - T, u0, dv + dw / 2, v1);
  wall(u0 - T, u0, dv - dw / 2, dv + dw / 2, top + 2.15, top + h);
  const [hx, hz] = lot.pt(u0 - T / 2, dv - dw / 2);
  // a wall along v: the door's normal points to -u (out onto the roof), inside is the other way
  b.doors.push({ x: hx, y: top, z: hz, a: lot.yaw('v+'), w: dw, h: 2.12, kind: 'metal', lockable: true, inside: -1 });
  const r = lot.rect(u0 - T, s.W, v0 - T, v1 + T);
  b.box('roof', r.x0, r.x1, r.z0, r.z1, top + h, top + h + 0.2, { style: s.o.style, group: `${s.id}_bulk`, meta: { arch: 1 } });
}

/**
 * Apartments (2–6 floors): the entrance and a stairwell along the right wall that goes all the
 * way up to the roof, one unit on each floor off the stair hall (a lockable front door, the
 * living room and kitchen at the front, the bedroom and bathroom at the back), a fire escape
 * on the left wall. A tenement (Hong Kong) has a shop on the ground floor and balconies.
 */
function apartments(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const { W, D } = lot;
  const F = Math.max(2, Math.min(6, spec.floors ?? 3));
  const hk = spec.type === 'tenement';
  const s = new Structure(b, lot, {
    id: spec.id, floors: F, style: spec.style ?? (hk ? 'stucco' : 'apartment'), color: spec.color, plaster: spec.plaster ?? rng.pick(PLASTERS), roof: 'flat', floor: 'wood',
    story: spec.story, gaps: spec.gaps,
  });
  const E = EXT_T, I = INT_T / 2;
  const sw = 1.2, cw = 3.0, cu = W - E - cw; // the stair hall: u > cu
  const lv = E + 1.3, run = 4.0;
  stairTower(s, sw, lv, run);
  const midV = Math.round(D * 0.55 * 10) / 10;
  const bathW = Math.min(2.6, cu * 0.4);
  const unitDoorV = Math.min(midV - 0.9, lv + run * 0.55);
  for (let f = 0; f < F; f++) {
    s.light(f, cu + 0.9, lv + run / 2);
    s.room(f, cu, W - E, E, D - E, 'concrete', false);
    if (f > 0) s.windows(f, 'right', [lv + run * 0.5], 1.1, 'slide', 1.1);
    if (f === 0) s.opening(0, 'front', { at: cu + 0.95, w: 1.1, door: 'glass', lock: true });
    else s.windows(f, 'front', [cu + 1.5], 1.0, 'slide', 1.1);
    if (f === 0 && hk) {
      // a shop on the ground floor: glass front, shelves, a counter, a door to the stairs
      s.opening(0, 'front', { at: (E + cu - 1.4) / 2, w: Math.min(cu - 2.2, 5), sill: 0.5, top: 2.6, window: 'fixed', breakable: true });
      s.opening(0, 'front', { at: cu - 0.8, w: 1.0, door: 'glass', lock: true });
      s.partition(0, 'v', cu, E, D - E, [{ at: D - E - 1.0, w: 0.9, door: 'metal', lock: true, inside: -1 }]);
      s.room(0, E, cu, E, D - E, 'tile');
      s.furn(0, 'counter', cu - I - 0.32, D * 0.45, 'u-');
      s.furn(0, 'register', cu - I - 0.45, D * 0.45 - 1.95, 'u-', 0.8);
      s.furn(0, 'shelf', E + 0.26, D * 0.4, 'u+');
      s.furn(0, 'shelf', E + 0.26, D * 0.4 + 2.0, 'u+');
      s.furn(0, 'stall', (E + cu) / 2, D - E - 1.2, 'v-', 0.8);
      s.furn(0, 'lantern', (E + cu) / 2, 1.5);
      s.loot(0, (E + cu) / 2, D * 0.5);
      continue;
    }
    s.partition(f, 'v', cu, E, D - E, [{ at: unitDoorV, w: 0.95, door: 'apartment', lock: true, inside: -1 }]);
    s.partition(f, 'u', midV, E, cu, [
      { at: (E + bathW) / 2, w: 0.8, door: 'wood', lock: true, inside: 1 },
      { at: cu - 0.75, w: 0.85, door: 'wood' },
    ]);
    s.partition(f, 'v', bathW, midV, D - E);
    s.room(f, E, cu, E, midV, 'wood').room(f, bathW, cu, midV, D - E, 'carpet').room(f, E, bathW, midV, D - E, 'tile');
    // living room: TV on the left wall, the couch facing it, the kitchen along the stair wall
    const lvC = (E + midV) / 2;
    s.furn(f, 'tvstand', E + 0.22, lvC, 'u+');
    s.furn(f, 'coffeetable', E + 1.5, lvC, 'u+');
    s.furn(f, 'couch', Math.min(E + 2.7, cu - 2.0), lvC, 'u-');
    s.furn(f, 'fridge', cu - I - 0.37, E + 0.45, 'u-');
    s.furn(f, 'counter', cu - I - 0.32, E + 0.9 + 0.9, 'u-', 0.75);
    if (f % 2 === 0) s.furn(f, 'plant', E + 0.3, E + 0.3);
    s.loot(f, (E + cu) / 2, midV - 0.8);
    // bedroom and bathroom
    s.furn(f, 'bed', (bathW + cu) / 2 + 0.2, D - E - 1.05, 'v-');
    s.furn(f, 'wardrobe', bathW + I + 0.32, midV + 1.0, 'u+');
    s.furn(f, 'toilet', E + 0.4, D - E - 0.36, 'v-');
    s.furn(f, 'shower', bathW - I - 0.47, D - E - 0.47, 'v-');
    s.furn(f, 'bathsink', E + 0.25, midV + 0.9, 'u+');
    s.loot(f, (bathW + cu) / 2, midV + 0.8);
    // windows
    if (hk) {
      // a glass door out to the balcony
      s.opening(f, 'front', { at: (E + cu) * 0.3, w: 0.9, door: 'glass' });
      s.windows(f, 'front', [(E + cu) * 0.72], 1.3, 'hinge');
    } else s.windows(f, 'front', [(E + cu) * 0.3, (E + cu) * 0.72], 1.3, f === 0 ? 'slide' : 'hinge');
    s.windows(f, 'left', [lvC], 1.3, 'slide');
    s.windows(f, 'back', [(bathW + cu) / 2 + 0.2], 1.2, 'slide', 1.0);
  }
  if (hk) for (let f = 1; f < F; f++) s.balcony(f, 'front', 0.6, cu - 0.4, 1.0);
  s.finish();
  const top = s.y(F);
  const ac = lot.pt(cu * 0.35, D * 0.7);
  b.prop('acunit', ac[0], ac[1], 0, 0, top);
  const an = lot.rect(cu * 0.6, cu * 0.6 + 0.08, D * 0.3, D * 0.3 + 0.08);
  b.box('antenna', an.x0, an.x1, an.z0, an.z1, top, top + 3.2, { col: 'none', color: 0x9aa1a8 });
  s.loot(F, cu * 0.4, D * 0.4);
  // the fire escape passes the living room window on every floor
  if (!hk && spec.fireEscape !== false) s.fireEscape('left', Math.max(E, (E + midV) / 2 - 2.0));
  return s;
}

/**
 * A shop (store, barbershop, laundromat, restaurant): a glass storefront and door, the shop
 * floor, a back room through a staff door, a metal back door (locked), and on two floors an
 * office upstairs reached from the back room.
 */
function shop(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const { W, D } = lot;
  const F = spec.floors ?? 1;
  const s = new Structure(b, lot, {
    id: spec.id, floors: F, style: spec.style ?? 'store', color: spec.color, plaster: rng.pick(PLASTERS), roof: 'flat', floor: 'tile',
  });
  const E = EXT_T, I = INT_T / 2;
  const backV = Math.round((D - Math.max(2.9, Math.min(3.6, D * 0.32))) * 10) / 10;
  const front = backV - E; // depth of the shop floor
  s.opening(0, 'front', { at: W * 0.5, w: 1.5, door: 'glass', lock: true });
  const glassW = Math.min(3.2, W * 0.5 - 1.6);
  for (const at of [W * 0.5 - 0.95 - glassW / 2 - 0.2, W * 0.5 + 0.95 + glassW / 2 + 0.2]) {
    s.opening(0, 'front', { at, w: glassW, sill: 0.55, top: 2.55, window: 'fixed', breakable: true });
  }
  const staffU = E + 1.2;
  s.opening(0, 'back', { at: staffU, w: 1.0, door: 'metal', lock: true, locked: true });
  s.partition(0, 'u', backV, E, W - E, [{ at: staffU, w: 0.9, door: 'metal', lock: true, inside: 1 }]);
  s.room(0, E, W - E, E, backV, spec.type === 'restaurant' ? 'wood' : 'tile').room(0, E, W - E, backV, D - E, 'concrete');
  s.light(0, W * 0.3, E + front * 0.66);
  switch (spec.type) {
    case 'barbershop': {
      const n = Math.max(2, Math.min(4, Math.floor((front - 1.8) / 1.5)));
      for (let i = 0; i < n; i++) {
        const v = E + 1.6 + i * 1.5;
        s.furn(0, 'barberchair', E + 1.1, v, 'u-');
        s.furn(0, 'mirror', E + 0.05, v, 'u+');
      }
      s.furn(0, 'couch', W - E - 0.47, E + 2.0, 'u-');
      s.furn(0, 'register', W - E - 0.4, backV - I - 1.2, 'u-', 0.7);
      s.furn(0, 'plant', W - E - 0.3, E + 0.35);
      break;
    }
    case 'laundromat': {
      for (let v = E + 1.5; v < backV - 0.5; v += 0.72) {
        s.furn(0, 'washer', E + 0.35, v, 'u+');
        s.furn(0, 'dryer', W - E - 0.35, v, 'u-');
      }
      s.furn(0, 'counter', W / 2, E + front * 0.55, 'u+', 0.8);
      s.furn(0, 'chair', W * 0.27, E + 0.6, 'v+');
      s.furn(0, 'chair', W * 0.73, E + 0.6, 'v+');
      break;
    }
    case 'restaurant': {
      for (let v = E + 1.3; v < backV - 1.6; v += 1.8) s.furn(0, 'booth', E + 0.72, v, 'u+');
      s.furn(0, 'counter', W - E - 1.6, backV - I - 0.32, 'v-', 1);
      s.furn(0, 'register', W - E - 0.55, E + front * 0.45, 'u-', 0.7);
      // the kitchen along the back room's front wall
      s.furn(0, 'stove', staffU + 1.3, backV + I + 0.33, 'v+');
      s.furn(0, 'fridge', staffU + 2.2, backV + I + 0.37, 'v+');
      s.furn(0, 'counter', staffU + 3.6, backV + I + 0.32, 'v+', 0.7);
      break;
    }
    default: {
      // aisles of shelves running front to back, the cooler on the right wall, the register by the door
      const aisles = Math.max(1, Math.floor((W - 4.2) / 2.1));
      for (let i = 0; i < aisles; i++) s.furn(0, 'shelf', 2.6 + i * 2.1, E + front * 0.58, 'u+', 0.9);
      s.furn(0, 'cooler', W - E - 0.38, E + front * 0.55, 'u-');
      s.furn(0, 'register', E + 0.8, E + 1.4, 'u+', 0.8);
    }
  }
  if (F === 1) {
    s.furn(0, 'shelf', W * 0.5 + 0.6, D - E - 0.26, 'v-', 0.8);
    s.furn(0, 'boxes', W - E - 0.8, D - E - 0.6);
  } else s.furn(0, 'boxes', W - E - 0.6, backV + I + 0.5);
  s.loot(0, W * 0.5, E + front * 0.4).loot(0, W * 0.5 - 0.2, backV + 1.2);
  if (F > 1) {
    // stairs in the back room along the back wall, rising to the right, an office upstairs
    const sw = 1.1, u0 = staffU + 1.3, run = Math.min(4.3, W - E - 0.8 - u0);
    s.stairsU(0, D - E - sw, sw, u0, u0 + run, 'v-');
    s.windows(1, 'front', [W * 0.28, W * 0.72], 1.4, 'slide');
    s.windows(1, 'left', [D * 0.5], 1.2, 'hinge');
    s.room(1, E, W - E, E, D - E, 'carpet');
    s.furn(1, 'officedesk', W * 0.4, D * 0.38, 'v-');
    s.furn(1, 'chair', W * 0.4, D * 0.38 + 0.7, 'v-');
    s.furn(1, 'cabinet', E + 0.27, D * 0.3, 'u+');
    s.furn(1, 'couch', W * 0.4, E + 0.47, 'v+');
    s.loot(1, W * 0.6, D * 0.5);
  }
  s.finish();
  if (spec.sign) {
    const [cx, cz] = lot.pt(W / 2, -0.06);
    // (a sign's yaw 0 faces -Z: half a turn from the direction it faces)
    b.sign({ text: spec.sign.text, x: cx, y: 3.3, z: cz, yaw: lot.yaw('v-') + Math.PI, width: Math.min(W - 1, 8), height: 0.95, style: 'store', color: spec.sign.color, bg: spec.sign.bg });
  }
  const aw = lot.rect(0.3, W - 0.3, -1.4, 0);
  b.box('awningroof', aw.x0, aw.x1, aw.z0, aw.z1, 2.75, 2.85, { color: rng.pick([0xb3261e, 0x1d6b3a, 0x22384f, 0x6b3a1a]), group: s.id });
  return s;
}

/** Offices (2–6 floors): a lobby with a front desk, open-plan floors, a meeting room, stairs to the roof. */
function offices(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const { W, D } = lot;
  const F = Math.max(2, Math.min(6, spec.floors ?? 4));
  const s = new Structure(b, lot, {
    id: spec.id, floors: F, style: spec.style ?? 'office', color: spec.color, plaster: 0xe6e8ea, roof: 'flat', floor: 'carpet', story: 3.4,
  });
  const E = EXT_T, I = INT_T / 2;
  const sw = 1.2, lv = E + 1.5, run = 4.2;
  const su = W - E - sw;
  stairTower(s, sw, lv, run);
  const mu = Math.min(W * 0.42, su - 3), mv = D * 0.6; // meeting room: u < mu, v > mv
  for (let f = 0; f < F; f++) {
    s.windows(f, 'front', [W * 0.18, W * 0.42], 1.8, 'fixed', 0.8, 2.6);
    s.windows(f, 'left', [D * 0.3, D * 0.75], 1.5, 'hinge', 0.9, 2.5);
    s.windows(f, 'back', [W * 0.25, W * 0.55], 1.5, 'hinge', 0.9, 2.5);
    s.room(f, E, W - E, E, D - E, f === 0 ? 'tile' : 'carpet', false);
    s.light(f, W * 0.3, D * 0.35).light(f, W * 0.6, D * 0.7);
    if (f === 0) {
      s.opening(0, 'front', { at: su - 1.2, w: 1.6, door: 'glass', lock: true });
      s.furn(0, 'counter', W * 0.42, D * 0.42, 'v-');
      s.furn(0, 'chair', W * 0.42, D * 0.42 + 0.7, 'v-');
      s.furn(0, 'plant', E + 0.35, E + 0.35).furn(0, 'couch', E + 0.47, D * 0.7, 'u+').furn(0, 'plant', su - 0.5, D - E - 0.4);
      s.loot(0, W * 0.3, D * 0.7);
    } else {
      s.partition(f, 'u', mv, E, mu, [{ at: mu - 0.8, w: 0.95, door: 'glass' }], 0xdde3e8);
      s.partition(f, 'v', mu, mv, D - E, [], 0xdde3e8);
      s.furn(f, 'diningtable', (E + mu) / 2, (mv + D - E) / 2, 'u+', 1.1);
      const cols = Math.max(1, Math.floor((su - 1.6 - E) / 2.2));
      for (let k = 0; k < cols; k++) s.furn(f, 'officedesk', E + 1.3 + k * 2.2, E + 1.4, 'v-');
      for (let k = 0; k < cols; k++) if (E + 1.3 + k * 2.2 > mu + 1) s.furn(f, 'officedesk', E + 1.3 + k * 2.2, mv + 1.2, 'v-');
      s.furn(f, 'cabinet', su - 0.9, D - E - 0.27, 'v-');
      s.loot(f, W * 0.45, D * 0.45);
    }
  }
  s.finish();
  const top = s.y(F);
  for (let i = 0; i < 2; i++) {
    const p = lot.pt(W * (0.2 + i * 0.25), D * 0.7);
    b.prop('acunit', p[0], p[1], 0, i, top);
  }
  s.loot(F, W * 0.35, D * 0.4);
  void rng; void I;
  return s;
}

/**
 * A warehouse / workshop / storage (one tall floor with a mezzanine office) or a garage: a
 * roll-up bay that stands open, a side door, a locked back door, high windows.
 */
function industrial(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const { W, D } = lot;
  const garage = spec.type === 'garage';
  const small = garage || spec.type === 'workshop' || spec.type === 'storage';
  const s = new Structure(b, lot, {
    id: spec.id, floors: 1, style: spec.style ?? 'metal', color: spec.color, plaster: 0xcfcfc8, roof: 'flat', floor: 'concrete', story: small ? 4.4 : 6.4,
  });
  const E = EXT_T;
  const bayW = Math.min(4.2, W * 0.4);
  s.opening(0, 'front', { at: E + 0.6 + bayW / 2, w: bayW, top: 3.6 });
  s.opening(0, 'front', { at: W - E - 1.2, w: 1.0, door: 'metal', lock: true });
  s.opening(0, 'back', { at: W - E - 1.2, w: 1.0, door: 'metal', lock: true, locked: true });
  s.windows(0, 'left', [D * 0.3, D * 0.7], 1.6, 'fixed', 2.4, 3.3);
  s.windows(0, 'right', [D * 0.3, D * 0.7], 1.6, 'fixed', 2.4, 3.3);
  s.room(0, E, W - E, E, D - E, 'concrete', false);
  s.light(0, W * 0.3, D * 0.5).light(0, W * 0.7, D * 0.5);
  if (spec.type === 'workshop') {
    // benches round the walls, a lathe in the middle, a parts cage
    for (let v = E + 2.5; v < D - E - 1.5; v += 2.4) s.furn(0, 'workbench', W - E - 0.38, v, 'u-');
    s.furn(0, 'workbench', E + 0.38, D - E - 2.0, 'u+');
    s.furn(0, 'locker', E + 0.25, D - E - 0.6, 'u+');
    s.furn(0, 'cabinet', W * 0.5, D - E - 0.27, 'v-');
    s.furn(0, 'tires', E + 0.6, E + 5.2);
    s.furn(0, 'pallets', W * 0.45, D * 0.55);
    s.loot(0, W * 0.4, D * 0.4).loot(0, W - E - 1.4, D - E - 1.2);
  } else if (spec.type === 'storage') {
    // aisles of steel racks, stock in boxes
    for (let u = E + 2.2; u < W - E - 1.6; u += 2.6) s.furn(0, 'rack', u, D * 0.58, 'u+', [Math.min(1.4, (D - 6) / 1.6), 1]);
    s.furn(0, 'boxes', W - E - 0.7, E + 4.5);
    s.furn(0, 'cabinet', W - E - 0.27, D - E - 0.8, 'u-');
    s.loot(0, W * 0.5, E + 3.2).loot(0, E + 3.5, D - E - 1.2);
  } else if (garage) {
    s.furn(0, 'workbench', W - E - 0.38, D * 0.5, 'u-');
    s.furn(0, 'locker', W - E - 0.25, D - E - 0.8, 'u-');
    s.furn(0, 'cabinet', E + 0.27, D - E - 0.8, 'u+');
    s.furn(0, 'tires', E + 0.6, D - E - 2.2);
    const [cx, cz] = lot.pt(E + 0.6 + bayW / 2, D * 0.45);
    b.prop('car', cx, cz, lot.yaw('v+'), rng.int(8));
    s.loot(0, W - E - 1.2, D * 0.35);
  } else {
    // a mezzanine office over the back left, its stairs alongside
    const my = 3.2, mz = Math.max(E + 5.5, D - 4.2), mu = Math.min(W * 0.55, W - E - 3.0);
    const r = lot.rect(E, mu, mz, D - E);
    b.box('floorslab', r.x0, r.x1, r.z0, r.z1, my - 0.2, my, { group: s.id, meta: { int: 1 } });
    const rl = lot.rect(E, mu, mz - 0.05, mz);
    b.box('rail', rl.x0, rl.x1, rl.z0, rl.z1, my, my + 1, { col: 'fence', meta: { int: 1 } });
    const run = 4.4, su = mu + 0.1;
    const [sx, sz] = lot.pt(su + 0.55, mz + 0.6 - run);
    b.ramp({ kind: 'stairs', x: sx, z: sz, y0: 0, dir: lot.yaw('v+'), run, rise: my, width: 1.1, rails: 'right', style: 'metal', group: s.id, thickness: 0.15 });
    const fr = lot.rect(mu - 0.05, su + 1.15, mz + 0.6, mz + 1.6);
    b.box('platform', fr.x0, fr.x1, fr.z0, fr.z1, my - 0.12, my, { style: 'metal' });
    const fr2 = lot.rect(su + 1.1, su + 1.15, mz + 0.6, mz + 1.6);
    b.box('rail', fr2.x0, fr2.x1, fr2.z0, fr2.z1, my, my + 1, { col: 'fence' });
    const fr3 = lot.rect(mu, su + 1.15, mz + 1.55, mz + 1.6);
    b.box('rail', fr3.x0, fr3.x1, fr3.z0, fr3.z1, my, my + 1, { col: 'fence' });
    const desk = lot.pt(mu * 0.5, D - E - 1.2);
    b.rbox('furn', desk[0], desk[1], 1.6, 0.8, my, 0.76, lot.yaw('v-'), { group: s.id, meta: { t: 'officedesk', int: 1 } });
    const cab = lot.pt(E + 0.3, D - E - 2.4);
    b.rbox('furn', cab[0], cab[1], 1.0, 0.5, my, 1.0, lot.yaw('u+'), { group: s.id, meta: { t: 'cabinet', int: 1 } });
    b.loot(desk[0] + 0.01, desk[1] + 0.01, my);
    // stock on the floor, clear of the bay and the stairs
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
      const u = E + 1.0 + i * 1.8, v = E + 4.6 + k * 2.2;
      if (u > mu - 0.8 || v > mz - 0.8) continue;
      s.furn(0, rng.chance(0.5) ? 'pallets' : 'boxes', u, v);
    }
    s.furn(0, 'shelf', W - E - 0.3, D * 0.45, 'u-', 1.2);
    s.loot(0, W - E - 1.6, D * 0.5);
  }
  s.finish();
  const p = lot.pt(W * 0.6, D * 0.5);
  b.prop('acunit', p[0], p[1], 0, 0, s.y(1));
  return s;
}

/**
 * A red barn: one tall floor under a steep roof, the big doors at both ends standing open,
 * stalls down one side, a hay loft over the back with a stair up to it.
 */
function barn(b: MapBuilder, lot: Lot, spec: BuildingSpec, rng: Rng): Structure {
  const { W, D } = lot;
  const H = spec.story ?? 6.2;
  const s = new Structure(b, lot, {
    id: spec.id, floors: 1, style: spec.style ?? 'wood', color: spec.color ?? 0x9e2b25, plaster: 0xb9a37f,
    roof: 'pitched', roofColor: spec.roofColor ?? 0x3a3d42, roofStyle: 'metal', rise: Math.min(4.2, D * 0.36), story: H,
  });
  const E = EXT_T;
  s.opening(0, 'front', { at: W / 2, w: Math.min(4.6, W * 0.4), top: 4.6 });
  s.opening(0, 'back', { at: W / 2, w: Math.min(4.6, W * 0.4), top: 4.6 });
  s.windows(0, 'left', [D * 0.3, D * 0.7], 1.2, 'hinge', 1.6, 2.6);
  s.windows(0, 'right', [D * 0.3, D * 0.7], 1.2, 'hinge', 1.6, 2.6);
  s.room(0, E, W - E, E, D - E, 'concrete', false);
  s.light(0, W / 2, D * 0.3).light(0, W / 2, D * 0.7);
  // stalls down the left side
  for (let v = E + 1.6; v < D - 6.4; v += 2.6) s.furn(0, 'stall', E + 0.65, v, 'u+', [1, 1.1]);
  // the hay loft: over the back of the barn, a stair up along the right wall
  const ly = 3.2, lv = D - 5.2;
  const lr = lot.rect(E, W - E, lv, D - E);
  b.box('woodplat', lr.x0, lr.x1, lr.z0, lr.z1, ly - 0.2, ly, { color: 0x7a5a3a, group: s.id, meta: { int: 1 } });
  const rl = lot.rect(E, W - E - 1.3, lv - 0.05, lv);
  b.box('rail', rl.x0, rl.x1, rl.z0, rl.z1, ly, ly + 1, { col: 'fence', meta: { int: 1 } });
  const run = 4.4;
  const [stx, stz] = lot.pt(W - E - 0.6, lv - run);
  b.ramp({ kind: 'stairs', x: stx, z: stz, y0: 0, dir: lot.yaw('v+'), run, rise: ly, width: 1.1, rails: 'left', style: 'metal', group: s.id, thickness: 0.15 });
  for (let i = 0; i < 4; i++) {
    const [hx, hz] = lot.pt(E + 1.2 + i * 1.5, D - E - 0.9);
    b.box('haybale', hx - 0.6, hx + 0.6, hz - 0.45, hz + 0.45, ly, ly + 0.9, { group: s.id, meta: { square: 1, int: 1 } });
  }
  s.furn(0, 'workbench', W - E - 0.38, D * 0.35, 'u-').furn(0, 'boxes', W - E - 0.6, E + 0.9);
  s.loot(0, W / 2, D * 0.45).loot(0, W * 0.65, ly > 0 ? D - 2.6 : D - 2, );
  b.loot(...lot.pt(W * 0.35, D - 2.4), ly);
  s.finish();
  void rng;
  return s;
}

/**
 * CAP'S HOUSE: a four-story log cabin (about 20 × 16 m), built to stand up on a hill (`base`).
 * One stair runs up the left wall through every floor. Ground floor: the great room round a
 * stone fireplace, the kitchen with its island and the dining table at the back, the front door
 * onto the deck, a side door out to the garage. Second floor: two bedrooms at the front, a loft
 * and a bath at the back. Third: the master suite (balcony, bath) and a den. Top floor: the
 * lookout, a game room with windows all round. A balcony runs across the front of every upper
 * floor, looking out over the yard to the lake.
 */
function cabin(b: MapBuilder, lot: Lot, spec: BuildingSpec): Structure {
  const { W, D } = lot;
  const s = new Structure(b, lot, {
    id: spec.id, floors: 4, style: spec.style ?? 'wood', color: spec.color ?? 0x8b5a33, plaster: spec.plaster ?? 0xd9b98f,
    roof: 'pitched', roofColor: spec.roofColor ?? 0x2f4a3a, roofStyle: 'panel', rise: 4.2, story: spec.story ?? 3.4, base: spec.base,
  });
  const E = EXT_T, I = INT_T / 2;
  const SW = 1.3, SV0 = 8.2, RUN = 4.4; // the stair: along the left wall, climbing toward the back
  const SU = E + 0.02;
  for (let f = 0; f < 3; f++) s.stairsV(f, SU, SW, SV0, SV0 + RUN, 'u+', false, f < 2);
  const HALL = SU + SW + 0.03; // first clear u past the stairwell

  // ================================================================ ground floor
  s.windows(0, 'front', [4.5, 9.5], 3.2, 'fixed', 0.4, 3.0);
  s.opening(0, 'front', { at: 14.5, w: 1.6, door: 'glass', lock: true });
  s.windows(0, 'front', [W - 2.2], 1.4, 'hinge', 0.9, 2.4);
  s.opening(0, 'right', { at: 4, w: 1.0, door: 'wood', lock: true });
  s.windows(0, 'back', [6.5, 11, 15.5], 1.6, 'hinge', 1.1, 2.4);
  s.windows(0, 'left', [1.6], 1.4, 'hinge', 0.9, 2.4);
  s.windows(0, 'right', [10], 1.6, 'hinge', 1.0, 2.4);
  s.room(0, E, W - E, E, D - E, 'wood', false);
  s.light(0, 5, 4).light(0, 11, 4).light(0, 9, 11).light(0, 15.5, 11.5);
  // the fireplace on the left wall, the sitting area round it
  const [fx0, fz0] = lot.pt(E, 3.3), [fx1, fz1] = lot.pt(E + 0.75, 5.7);
  // (meta.face: which way the hearth opens, into the room)
  b.box('fireplace', Math.min(fx0, fx1), Math.max(fx0, fx1), Math.min(fz0, fz1), Math.max(fz0, fz1), s.y(0), s.y(1) - 0.25, { group: s.id, meta: { int: 1, face: lot.side('right') } });
  s.furn(0, 'rug', 4.2, 4.5, 'u-', [1.2, 1.3]);
  s.furn(0, 'couch', 5.6, 4.5, 'u-', [1.2, 1]).furn(0, 'coffeetable', 3.6, 4.5, 'u-');
  s.furn(0, 'armchair', 3.4, 1.4, 'v+').furn(0, 'armchair', 3.4, 7.4, 'v-').furn(0, 'lamp', 7.2, 1.0);
  // kitchen and dining at the back
  s.furn(0, 'fridge', W - E - 0.42, D - E - 0.38, 'v-').furn(0, 'stove', W - 2.3, D - E - 0.33, 'v-');
  s.furn(0, 'counter', W - 4.4, D - E - 0.32, 'v-', [1.2, 1]).furn(0, 'kitchensink', 13.2, D - E - 0.32, 'v-');
  s.furn(0, 'counter', 15.6, 11.4, 'v+', [1.3, 1.3]);
  s.furn(0, 'diningtable', 8.8, 11, 'u+', [1.5, 1.2]);
  for (const dv of [-0.75, 0.75]) s.furn(0, 'chair', 7.6, 11 + dv, 'u+').furn(0, 'chair', 10, 11 + dv, 'u-');
  s.furn(0, 'bookcase', HALL + 2.2, D - E - 0.2, 'v-').furn(0, 'plant', 12.4, E + 0.4);
  s.loot(0, 6.5, 2.6).loot(0, 12, 8.6).loot(0, 17.5, 9.2);

  // ================================================================ second floor: bedrooms, loft, bath
  const BV = 7.5, BATH = 14;
  s.partition(1, 'u', BV, HALL, W - E, [{ at: 5, w: 0.95, door: 'wood', lock: true, inside: -1 }, { at: 15, w: 0.95, door: 'wood', lock: true, inside: -1 }]);
  s.partition(1, 'v', 10, E, BV);
  s.partition(1, 'v', BATH, BV, D - E, [{ at: 10.5, w: 0.85, door: 'wood', lock: true, inside: 1 }]);
  s.opening(1, 'front', { at: 5, w: 1.6, door: 'glass' });
  s.windows(1, 'front', [15], 1.8, 'hinge', 0.9, 2.4);
  s.windows(1, 'left', [3.6], 1.4, 'hinge', 0.9, 2.4);
  s.windows(1, 'right', [3.6, 12], 1.4, 'hinge', 0.9, 2.4);
  s.windows(1, 'back', [7, 17], 1.4, 'hinge', 1.0, 2.4);
  s.room(1, E, 10, E, BV, 'carpet').room(1, 10, W - E, E, BV, 'carpet').room(1, E, BATH, BV, D - E, 'wood').room(1, BATH, W - E, BV, D - E, 'tile');
  s.furn(1, 'bed', E + 1.06, 4.2, 'u+').furn(1, 'nightstand', E + 0.25, 2.6, 'u+').furn(1, 'dresser', 8.2, E + 0.27, 'v+');
  s.furn(1, 'bedsingle', W - E - 1.02, 4.2, 'u-').furn(1, 'bedsingle', 11.6, 4.2, 'u+').furn(1, 'wardrobe', 12.4, BV - I - 0.32, 'v-');
  s.furn(1, 'couch', 8.5, D - E - 0.5, 'v-').furn(1, 'tvstand', 8.5, BV + I + 0.24, 'v+').furn(1, 'rug', 8.5, 11.8, 'v-');
  s.furn(1, 'toilet', W - E - 0.36, D - E - 0.6, 'u-').furn(1, 'bathsink', 16, BV + I + 0.25, 'v+').furn(1, 'shower', W - E - 0.47, BV + I + 0.5, 'u-');
  s.loot(1, 6.5, 4).loot(1, 15.5, 2.6).loot(1, 6, 12);

  // ================================================================ third floor: the master suite, a den
  const MV = 8, MB = 13;
  s.partition(2, 'u', MV, HALL, W - E, [{ at: 6, w: 0.95, door: 'wood', lock: true, inside: -1 }]);
  s.partition(2, 'v', MB, MV, D - E, [{ at: 12, w: 0.85, door: 'wood', lock: true, inside: 1 }]);
  s.opening(2, 'front', { at: 10, w: 1.8, door: 'glass' });
  s.windows(2, 'front', [4, 16], 1.8, 'hinge', 0.9, 2.4);
  s.windows(2, 'left', [3.6], 1.4, 'hinge', 0.9, 2.4);
  s.windows(2, 'right', [4, 12], 1.4, 'hinge', 0.9, 2.4);
  s.windows(2, 'back', [7, 17], 1.4, 'hinge', 1.0, 2.4);
  s.room(2, E, W - E, E, MV, 'carpet').room(2, E, MB, MV, D - E, 'wood').room(2, MB, W - E, MV, D - E, 'tile');
  s.furn(2, 'bed', E + 1.25, 4.3, 'u+', 1.15).furn(2, 'nightstand', E + 0.25, 2.5, 'u+').furn(2, 'nightstand', E + 0.25, 6.1, 'u+');
  s.furn(2, 'dresser', 15.5, MV - I - 0.27, 'v-').furn(2, 'armchair', W - E - 0.6, 2.2, 'u-').furn(2, 'rug', 5.5, 4.3, 'u+', [1.2, 1.3]);
  s.furn(2, 'officedesk', 8, D - E - 0.6, 'v-').furn(2, 'chair', 8, D - E - 1.3, 'v+').furn(2, 'bookcase', 11.5, MV + I + 0.2, 'v+');
  s.furn(2, 'tub', W - E - 0.42, D - E - 1.0, 'u-').furn(2, 'toilet', MB + 1.2, D - E - 0.36, 'v-');
  s.furn(2, 'bathsink', 16.5, MV + I + 0.25, 'v+').furn(2, 'bathsink', 17.5, MV + I + 0.25, 'v+');
  s.loot(2, 9, 4).loot(2, 6, 12.5).loot(2, 16.5, 11.5);

  // ================================================================ top floor: the lookout
  s.opening(3, 'front', { at: 10, w: 1.8, door: 'glass' });
  s.windows(3, 'front', [4.5, 15.5], 2.6, 'fixed', 0.6, 2.7);
  s.windows(3, 'left', [3, 13.6], 1.6, 'fixed', 0.8, 2.6);
  s.windows(3, 'right', [3, 8, 13], 1.6, 'fixed', 0.8, 2.6);
  s.windows(3, 'back', [5, 10, 15], 1.8, 'fixed', 0.8, 2.6);
  s.room(3, E, W - E, E, D - E, 'wood', false);
  s.light(3, 6, 5).light(3, 14, 5).light(3, 10, 12);
  s.furn(3, 'diningtable', 12.5, 10.5, 'u+', [1.7, 1.45]); // the pool table
  s.furn(3, 'couch', 6, 3.2, 'v+', [1.3, 1]).furn(3, 'coffeetable', 6, 4.6, 'v+').furn(3, 'tvstand', 6, 6.6, 'v-', [1.3, 1]);
  s.furn(3, 'booth', W - E - 0.75, 4, 'u-').furn(3, 'cooler', W - E - 0.4, 8.5, 'u-').furn(3, 'rug', 12.5, 10.5, 'u+', [1.5, 1.6]);
  s.loot(3, 9, 9).loot(3, 16, 13.5);

  // balconies across the front of the upper floors
  for (const f of [1, 2, 3]) s.balcony(f, 'front', 1, W - 1, 2.2);
  s.finish();

  // ================================================================ outside
  const base = s.y(0);
  // the deck along the front, a step up off the yard
  const dk = lot.rect(-0.3, W + 0.3, -3.4, 0);
  b.box('woodplat', dk.x0, dk.x1, dk.z0, dk.z1, base, base + 0.2, { color: 0x7a5232, group: s.id });
  for (const [a0, a1] of [[-0.3, 13.4], [15.6, W + 0.3]] as const) {
    const r = lot.rect(a0, a1, -3.4, -3.34);
    b.box('rail', r.x0, r.x1, r.z0, r.z1, base + 0.2, base + 1.2, { col: 'fence', group: s.id });
  }
  for (const [u0, u1] of [[-0.3, -0.24], [W + 0.24, W + 0.3]] as const) {
    const r = lot.rect(u0, u1, -3.4, 0);
    b.box('rail', r.x0, r.x1, r.z0, r.z1, base + 0.2, base + 1.2, { col: 'fence', group: s.id });
  }
  // the stone chimney up the outside of the left wall
  const ch = lot.rect(-1.1, 0, 3.4, 5.6);
  b.box('chimney', ch.x0, ch.x1, ch.z0, ch.z1, base, s.y(4) + 4.2 + 1.2, { group: s.id });
  // a stone band round the bottom of the walls (drawn only), open at the doors and low windows
  s.skirt(0.9);
  // the name across the front of the first balcony
  const [sx, sz] = lot.pt(W / 2, -2.2 - 0.07);
  b.sign({ text: "CAP'S HOUSE", x: sx, y: s.y(1) - 0.45, z: sz, yaw: lot.yaw('v-') + Math.PI, width: 6.5, height: 0.6, style: 'store', color: '#f5c518', bg: '#1b1c1f' });
  b.hotspot(...lot.pt(W / 2, D / 2));
  return s;
}

/**
 * A four-car garage (16 × 9 m), on a hill like the cabin it stands by: four bays standing open,
 * a side door, a workbench, the tools.
 */
function garage4(b: MapBuilder, lot: Lot, spec: BuildingSpec): Structure {
  const { W, D } = lot;
  const s = new Structure(b, lot, {
    id: spec.id, floors: 1, style: spec.style ?? 'wood', color: spec.color ?? 0x8b5a33, plaster: 0xcfc6b8, roof: 'flat', floor: 'concrete',
    story: spec.story ?? 3.6, base: spec.base,
  });
  const E = EXT_T;
  const bay = (W - 2 * E) / 4;
  for (let i = 0; i < 4; i++) s.opening(0, 'front', { at: E + bay * (i + 0.5), w: Math.min(3.3, bay - 0.5), top: 3.0 });
  s.opening(0, 'left', { at: D - 2.2, w: 1.0, door: 'wood', lock: true });
  s.windows(0, 'back', [W * 0.3, W * 0.7], 1.6, 'fixed', 2.0, 3.0);
  s.windows(0, 'right', [D / 2], 1.6, 'fixed', 2.0, 3.0);
  s.room(0, E, W - E, E, D - E, 'concrete', false);
  for (let i = 0; i < 4; i++) s.light(0, E + bay * (i + 0.5), D / 2);
  s.furn(0, 'workbench', E + bay * 2.5, D - E - 0.38, 'v-').furn(0, 'cabinet', E + bay * 3.5 - 0.8, D - E - 0.27, 'v-');
  s.furn(0, 'tires', E + bay * 2.5 + 1.6, D - E - 0.6);
  s.loot(0, E + bay * 2, D - 1.4).loot(0, E + bay * 0.5 + 1.3, D - 1.2);
  s.finish();
  s.skirt(0.9);
  return s;
}
