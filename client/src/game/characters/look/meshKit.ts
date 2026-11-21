import * as THREE from 'three';

/**
 * Small toolkit for the Character Creator's procedural pieces (hair, hats, jewelry...).
 *
 * Everything is built in the character's bind pose, in meters: +Y up, the face looks down +Z,
 * the character's left hand is on +X. Each vertex carries a color *slot* (skin, hair, top...)
 * instead of a fixed color, so one merged mesh can be repainted per player without rebuilding.
 */

/** Color slots: the palette (see palette.ts) decides the actual colors per character. */
export const SLOT = {
  /** Uses the vertex's own fixed color. */
  FIXED: 0,
  SKIN: 1,
  /** Skin in shadow (inner ears, creases). */
  SKIN_DARK: 2,
  LIPS: 3,
  IRIS: 4,
  BROW: 5,
  HAIR: 6,
  BEARD: 7,
  TOP: 8,
  BOTTOM: 9,
  SHOE: 10,
  /** The player's crew color (the arm band that keeps teams readable). */
  CREW: 11,
  TEETH: 12,
  /** The blank face plate. */
  FACE: 13,
  /** The belt's strap. */
  BELT: 14,
} as const;

export interface Style {
  slot: number;
  /** sRGB hex, for FIXED vertices. */
  color?: number;
  /** Blend toward a second slot (fades: hair into skin). */
  slotB?: number;
  mix?: number;
  /** Brightness multiplier (baked shading / stripes). */
  shade?: number;
  metal?: number;
  rough?: number;
}

export const style = (slot: number, extra: Partial<Style> = {}): Style => ({ slot, ...extra });
export const fixed = (color: number, extra: Partial<Style> = {}): Style => ({ slot: SLOT.FIXED, color, ...extra });

/** Metal and stone looks for jewelry (shared so pieces match). */
export const METAL = {
  gold: fixed(0xe0b44a, { metal: 0.65, rough: 0.3 }),
  silver: fixed(0xd5d9de, { metal: 0.6, rough: 0.28 }),
  steel: fixed(0x9aa1a8, { metal: 0.55, rough: 0.35 }),
  diamond: fixed(0xf4fbff, { metal: 0.2, rough: 0.08 }),
  black: fixed(0x15161a, { rough: 0.45 }),
};

const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export type V3 = THREE.Vector3;
export const v3 = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);

/**
 * How a procedural mesh follows the skeleton: rigidly with one bone, or with the weights of
 * the nearest vertex of the body under it (beards and chains that sit on skin that bends).
 */
export type Binding = { bone: string } | { nearest: true; fallback: string };

export class ProcMesh {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly idx: number[] = [];
  /** Per vertex: slot, slotB, mix, shade, metal, rough, r, g, b (linear). */
  readonly attr: number[] = [];
  /** Keep zero-area triangles (meshes whose vertices are animated later must keep their layout). */
  keepAll = false;
  constructor(readonly binding: Binding) {}

  get count(): number {
    return this.pos.length / 3;
  }

  vertex(p: V3, n: V3, s: Style): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    _c.setHex(s.color ?? 0xffffff, THREE.SRGBColorSpace);
    this.attr.push(s.slot, s.slotB ?? s.slot, s.mix ?? 0, s.shade ?? 1, s.metal ?? 0.05, s.rough ?? 0.8, _c.r, _c.g, _c.b);
    return this.pos.length / 3 - 1;
  }

  /** A flat-shaded triangle (counter-clockwise seen from outside). */
  tri(a: V3, b: V3, c: V3, s: Style | [Style, Style, Style]): void {
    _n.copy(_a.subVectors(b, a)).cross(_b.subVectors(c, a));
    if (_n.lengthSq() < 1e-16) {
      if (!this.keepAll) return;
      _n.set(0, 0, 1);
    }
    _n.normalize();
    const [sa, sb, sc] = Array.isArray(s) ? s : [s, s, s];
    const i = this.vertex(a, _n, sa);
    this.vertex(b, _n, sb);
    this.vertex(c, _n, sc);
    this.idx.push(i, i + 1, i + 2);
  }

  /** A flat-shaded quad a-b-c-d (counter-clockwise seen from outside). */
  quad(a: V3, b: V3, c: V3, d: V3, s: Style | [Style, Style, Style, Style]): void {
    const [sa, sb, sc, sd] = Array.isArray(s) ? s : [s, s, s, s];
    this.tri(a, b, c, [sa, sb, sc]);
    this.tri(a, c, d, [sa, sc, sd]);
  }

  /**
   * A grid of points [row][col] as a surface. `flat` gives the faceted low-poly look of the
   * character models; otherwise normals are smoothed across the grid. Rows run "down" the
   * surface and columns "across", so the outside is on the side of (down x across).
   */
  grid(pts: Array<Array<V3 | null>>, st: (r: number, c: number) => Style, opts: { flat?: boolean; wrap?: boolean; flip?: boolean } = {}): void {
    const rows = pts.length, cols = pts[0]?.length ?? 0;
    const cmax = opts.wrap ? cols : cols - 1;
    if (opts.flat !== false) {
      for (let r = 0; r + 1 < rows; r++) {
        for (let c = 0; c < cmax; c++) {
          const c1 = (c + 1) % cols;
          const a = pts[r][c], b = pts[r + 1][c], cc = pts[r + 1][c1], d = pts[r][c1];
          const sa = st(r, c), sb = st(r + 1, c), sc = st(r + 1, c1), sd = st(r, c1);
          if (a && b && cc && d) {
            if (opts.flip) this.quad(a, d, cc, b, [sa, sd, sc, sb]);
            else this.quad(a, b, cc, d, [sa, sb, sc, sd]);
          } else if (a && b && cc) {
            if (opts.flip) this.tri(a, cc, b, [sa, sc, sb]);
            else this.tri(a, b, cc, [sa, sb, sc]);
          } else if (a && cc && d) {
            if (opts.flip) this.tri(a, d, cc, [sa, sd, sc]);
            else this.tri(a, cc, d, [sa, sc, sd]);
          } else if (a && b && d) {
            if (opts.flip) this.tri(a, d, b, [sa, sd, sb]);
            else this.tri(a, b, d, [sa, sb, sd]);
          } else if (b && cc && d) {
            if (opts.flip) this.tri(b, d, cc, [sb, sd, sc]);
            else this.tri(b, cc, d, [sb, sc, sd]);
          }
        }
      }
      return;
    }
    // smooth: shared vertices with averaged normals
    const ids: number[][] = [];
    const normals = pts.map((row) => row.map(() => new THREE.Vector3()));
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c < cmax; c++) {
        const c1 = (c + 1) % cols;
        const a = pts[r][c], b = pts[r + 1][c], cc = pts[r + 1][c1], d = pts[r][c1];
        if (!a || !b || !cc || !d) continue;
        _n.copy(_a.subVectors(b, a)).cross(_b.subVectors(cc, a)).add(_a.subVectors(cc, a).cross(_b.subVectors(d, a)));
        if (opts.flip) _n.negate();
        for (const [rr, ccx] of [[r, c], [r + 1, c], [r + 1, c1], [r, c1]]) normals[rr][ccx].add(_n);
      }
    }
    for (let r = 0; r < rows; r++) {
      ids.push([]);
      for (let c = 0; c < cols; c++) {
        const p = pts[r][c];
        ids[r].push(p ? this.vertex(p, normals[r][c].lengthSq() > 0 ? normals[r][c].normalize() : _n.set(0, 1, 0), st(r, c)) : -1);
      }
    }
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c < cmax; c++) {
        const c1 = (c + 1) % cols;
        const a = ids[r][c], b = ids[r + 1][c], cc = ids[r + 1][c1], d = ids[r][c1];
        if (a < 0 || b < 0 || cc < 0 || d < 0) continue;
        if (opts.flip) this.idx.push(a, d, cc, a, cc, b);
        else this.idx.push(a, b, cc, a, cc, d);
      }
    }
  }

  /** A tube along a path (rings of `sides` points); radius per path point. */
  tube(path: V3[], radius: number | number[], sides: number, s: Style | ((i: number) => Style), opts: { flat?: boolean; caps?: boolean } = {}): void {
    if (path.length < 2) return;
    const rad = (i: number) => (Array.isArray(radius) ? radius[i] : radius);
    const sty = typeof s === 'function' ? s : () => s;
    const rings: V3[][] = [];
    let prevN: V3 | null = null;
    for (let i = 0; i < path.length; i++) {
      const t = (i === 0 ? _a.subVectors(path[1], path[0]) : i === path.length - 1 ? _a.subVectors(path[i], path[i - 1]) : _a.subVectors(path[i + 1], path[i - 1])).normalize().clone();
      // parallel transport of a normal along the path (no twisting)
      let n: V3;
      if (!prevN) {
        n = Math.abs(t.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
        n.sub(t.clone().multiplyScalar(n.dot(t))).normalize();
      } else {
        n = prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))).normalize();
      }
      prevN = n;
      const bnorm = t.clone().cross(n);
      const ring: V3[] = [];
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2;
        ring.push(path[i].clone().addScaledVector(n, Math.cos(ang) * rad(i)).addScaledVector(bnorm, Math.sin(ang) * rad(i)));
      }
      rings.push(ring);
    }
    this.grid(rings, (r) => sty(r), { flat: opts.flat !== false, wrap: true, flip: true });
    if (opts.caps !== false) {
      const end = rings.length - 1;
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        if (rad(0) > 1e-5) this.tri(path[0], rings[0][k1], rings[0][k], sty(0));
        if (rad(end) > 1e-5) this.tri(path[end], rings[end][k], rings[end][k1], sty(end));
      }
    }
  }

  /** An ellipsoid (radii rx, ry, rz) with optional rotation. */
  ellipsoid(center: V3, r: V3, s: Style | ((p: V3) => Style), segs = 8, rings = 6, opts: { flat?: boolean; quat?: THREE.Quaternion } = {}): void {
    const pts: V3[][] = [];
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * Math.PI;
      const row: V3[] = [];
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const p = v3(Math.sin(phi) * Math.cos(th) * r.x, Math.cos(phi) * r.y, Math.sin(phi) * Math.sin(th) * r.z);
        if (opts.quat) p.applyQuaternion(opts.quat);
        row.push(p.add(center));
      }
      pts.push(row);
    }
    const sty = typeof s === 'function' ? s : () => s;
    this.grid(pts, (rr, cc) => sty(pts[rr][cc]), { flat: opts.flat !== false, wrap: true, flip: true });
  }

  /** A ring (torus) around `axis` through `center`. */
  torus(center: V3, axis: V3, R: number, r: number, s: Style | ((u: number) => Style), segU = 16, segV = 6, opts: { flat?: boolean; arc?: number; scaleU?: (u: number) => number } = {}): void {
    const ax = axis.clone().normalize();
    const u0 = Math.abs(ax.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const e1 = u0.sub(ax.clone().multiplyScalar(u0.dot(ax))).normalize();
    const e2 = ax.clone().cross(e1);
    const arc = opts.arc ?? Math.PI * 2;
    const closed = arc >= Math.PI * 2 - 1e-6;
    const n = closed ? segU : segU + 1;
    const pts: V3[][] = [];
    for (let i = 0; i < n; i++) {
      const u = (i / segU) * arc;
      const dir = e1.clone().multiplyScalar(Math.cos(u)).addScaledVector(e2, Math.sin(u));
      const rr = r * (opts.scaleU?.(i / segU) ?? 1);
      const ring: V3[] = [];
      for (let k = 0; k < segV; k++) {
        const v = (k / segV) * Math.PI * 2;
        ring.push(center.clone().addScaledVector(dir, R + Math.cos(v) * rr).addScaledVector(ax, Math.sin(v) * rr));
      }
      pts.push(ring);
    }
    const sty = typeof s === 'function' ? s : () => s;
    // rows = around the ring, columns = around the tube
    const rows = closed ? [...pts, pts[0]] : pts;
    this.grid(rows, (rI) => sty(rI / segU), { flat: opts.flat !== false, wrap: true });
  }

  /** A box with its own orientation (axes ax, ay, az, unit vectors) and half sizes. */
  box(center: V3, half: V3, s: Style, axes?: [V3, V3, V3]): void {
    const [ax, ay, az] = axes ?? [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
    const corner = (x: number, y: number, z: number) =>
      center.clone().addScaledVector(ax, x * half.x).addScaledVector(ay, y * half.y).addScaledVector(az, z * half.z);
    const p = [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1), corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)];
    this.quad(p[0], p[3], p[2], p[1], s); // -z
    this.quad(p[4], p[5], p[6], p[7], s); // +z
    this.quad(p[0], p[4], p[7], p[3], s); // -x
    this.quad(p[1], p[2], p[6], p[5], s); // +x
    this.quad(p[3], p[7], p[6], p[2], s); // +y
    this.quad(p[0], p[1], p[5], p[4], s); // -y
  }

  /** A flat polygon outline extruded along `normal` by `depth` (frames, lenses, pendants). */
  slab(outline: V3[], normal: V3, depth: number, s: Style): void {
    const n = normal.clone().normalize();
    const back = outline.map((p) => p.clone().addScaledVector(n, -depth));
    const c = outline.reduce((acc, p) => acc.add(p), v3()).multiplyScalar(1 / outline.length);
    const cb = c.clone().addScaledVector(n, -depth);
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      this.tri(c, outline[i], outline[j], s);
      this.tri(cb, back[j], back[i], s);
      this.quad(outline[i], back[i], back[j], outline[j], s);
    }
    // make sure the front faces point along the normal
    const first = this.idx.length - outline.length * 12;
    if (first >= 0) {
      const i0 = this.idx[first];
      const fn = v3(this.nrm[i0 * 3], this.nrm[i0 * 3 + 1], this.nrm[i0 * 3 + 2]);
      if (fn.dot(n) < 0) {
        for (let k = first; k < this.idx.length; k += 3) {
          const t = this.idx[k + 1];
          this.idx[k + 1] = this.idx[k + 2];
          this.idx[k + 2] = t;
          for (const v of [this.idx[k], this.idx[k + 1], this.idx[k + 2]]) {
            this.nrm[v * 3] *= -1;
            this.nrm[v * 3 + 1] *= -1;
            this.nrm[v * 3 + 2] *= -1;
          }
        }
      }
    }
  }

  /** A flat ring outline (frame) between an outer and inner polygon, extruded by `depth`. */
  frame(outer: V3[], inner: V3[], normal: V3, depth: number, s: Style): void {
    const n = normal.clone().normalize().multiplyScalar(depth);
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      const of = outer[i], og = outer[j], inf = inner[i], ing = inner[j];
      const ob = of.clone().sub(n), obg = og.clone().sub(n), ib = inf.clone().sub(n), ibg = ing.clone().sub(n);
      this.quad(of, og, ing, inf, s); // front
      this.quad(ob, ib, ibg, obg, s); // back
      this.quad(of, ob, obg, og, s); // outer rim
      this.quad(inf, ing, ibg, ib, s); // inner rim
    }
  }

  /** Moves every vertex (e.g. to tuck hair under a hat). */
  mapPositions(fn: (p: V3, i: number) => void): void {
    const p = v3();
    for (let i = 0; i < this.count; i++) {
      p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      fn(p, i);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
    }
  }
}

/** Deterministic 0..1 noise from integers (stable shapes, no Math.random in builds). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
