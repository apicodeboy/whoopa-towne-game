import * as THREE from 'three';

/** Faces of a unit box: normal, plus the u/v tangent axes chosen so u x v = n (CCW from outside). */
const FACES: Array<{ n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }> = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

export interface BoxSpec {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  /** Orientation quaternion (optional). */
  q?: { x: number; y: number; z: number; w: number };
}

export interface BoxOptions {
  /** Vertex tint (multiplies the material color). */
  color?: THREE.Color | number;
  /** World meters per texture repeat. */
  tile?: number;
  /** Skip the bottom face (boxes sitting on the ground). */
  skipBottom?: boolean;
  /** Skip the top face. */
  skipTop?: boolean;
  /** Stretch the texture exactly once over each side face instead of tiling in world space. */
  fit?: boolean;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Accumulates many oriented boxes into a single BufferGeometry (one draw call per material).
 * UVs are projected in world space so textures line up across neighbouring boxes.
 */
export class BoxBatch {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  count = 0;

  add(b: BoxSpec, opts: BoxOptions = {}): void {
    const tile = opts.tile ?? 1;
    if (opts.color instanceof THREE.Color) _c.copy(opts.color);
    else _c.set(opts.color ?? 0xffffff);
    if (b.q) _q.set(b.q.x, b.q.y, b.q.z, b.q.w);
    else _q.identity();
    const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
    const half = [hx, hy, hz];

    for (let f = 0; f < 6; f++) {
      if (f === 3 && opts.skipBottom) continue;
      if (f === 2 && opts.skipTop) continue;
      const face = FACES[f];
      const axisN = face.n[0] !== 0 ? 0 : face.n[1] !== 0 ? 1 : 2;
      const axisU = face.u[0] !== 0 ? 0 : face.u[1] !== 0 ? 1 : 2;
      const axisV = face.v[0] !== 0 ? 0 : face.v[1] !== 0 ? 1 : 2;
      const hn = half[axisN], hu = half[axisU], hv = half[axisV];
      _n.set(face.n[0], face.n[1], face.n[2]).applyQuaternion(_q);
      _u.set(face.u[0], face.u[1], face.u[2]).applyQuaternion(_q);
      _w.set(face.v[0], face.v[1], face.v[2]).applyQuaternion(_q);
      const base = this.pos.length / 3;
      const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [su, sv] of corners) {
        _v.set(
          face.n[0] * hn + face.u[0] * hu * su + face.v[0] * hv * sv,
          face.n[1] * hn + face.u[1] * hu * su + face.v[1] * hv * sv,
          face.n[2] * hn + face.u[2] * hu * su + face.v[2] * hv * sv,
        ).applyQuaternion(_q);
        const wx = _v.x + b.x, wy = _v.y + b.y, wz = _v.z + b.z;
        this.pos.push(wx, wy, wz);
        this.nor.push(_n.x, _n.y, _n.z);
        if (opts.fit) {
          this.uv.push((su + 1) / 2, (sv + 1) / 2);
        } else {
          // world-space projection along the face tangents
          this.uv.push((wx * _u.x + wy * _u.y + wz * _u.z) / tile, (wx * _w.x + wy * _w.y + wz * _w.z) / tile);
        }
        this.col.push(_c.r, _c.g, _c.b);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.count++;
  }

  /**
   * A flat polygon lying on the ground (y up), with holes cut out of it: `outline` and each
   * hole are lists of (x, z) points. Textured in world space like addQuad.
   */
  addPolygon(outline: Array<[number, number]>, holes: Array<Array<[number, number]>>, y: number, opts: BoxOptions = {}): void {
    const tile = opts.tile ?? 1;
    if (opts.color instanceof THREE.Color) _c.copy(opts.color);
    else _c.set(opts.color ?? 0xffffff);
    const v2 = (p: [number, number]) => new THREE.Vector2(p[0], p[1]);
    const contour = outline.map(v2);
    const hs = holes.map((h) => h.map(v2));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    const base = this.pos.length / 3;
    for (const p of all) {
      this.pos.push(p.x, y, p.y);
      this.nor.push(0, 1, 0);
      this.uv.push(p.x / tile, -p.y / tile);
      this.col.push(_c.r, _c.g, _c.b);
    }
    for (const [a, b, c] of tris) {
      const A = all[a], B = all[b], C = all[c];
      // facing up: (B - A) × (C - A) has a positive y
      const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
      if (up) this.idx.push(base + a, base + b, base + c);
      else this.idx.push(base + a, base + c, base + b);
    }
    this.count++;
  }

  /** A flat quad lying on the ground (y up), for roads / painted areas. */
  addQuad(x0: number, z0: number, x1: number, z1: number, y: number, opts: BoxOptions = {}): void {
    const tile = opts.tile ?? 1;
    if (opts.color instanceof THREE.Color) _c.copy(opts.color);
    else _c.set(opts.color ?? 0xffffff);
    const base = this.pos.length / 3;
    const pts: Array<[number, number]> = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const [x, z] of pts) {
      this.pos.push(x, y, z);
      this.nor.push(0, 1, 0);
      if (opts.fit) this.uv.push((x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0));
      else this.uv.push(x / tile, -z / tile);
      this.col.push(_c.r, _c.g, _c.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
  }

  /** A ribbon following a polyline on the ground. u runs across the strip (0..1), v along it in meters / tile. */
  addStrip(points: Array<{ x: number; z: number }>, width: number, y: number, opts: BoxOptions = {}): void {
    if (points.length < 2) return;
    const tile = opts.tile ?? 1;
    if (opts.color instanceof THREE.Color) _c.copy(opts.color);
    else _c.set(opts.color ?? 0xffffff);
    const base = this.pos.length / 3;
    let dist = 0;
    const hw = width / 2;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)];
      const c = points[Math.min(points.length - 1, i + 1)];
      let tx = c.x - a.x, tz = c.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      // left normal of the direction of travel
      const nx = tz, nz = -tx;
      if (i > 0) dist += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
      this.pos.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
      this.nor.push(0, 1, 0, 0, 1, 0);
      this.uv.push(0, dist / tile, 1, dist / tile);
      this.col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2;
      // a = left_i, a+1 = right_i, a+2 = left_i+1, a+3 = right_i+1; wound so the normal points up (+Y)
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.count++;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
