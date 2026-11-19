/**
 * Turns signed distance shapes into game meshes:
 *  1. surface nets over a voxel grid (empty blocks skipped)
 *  2. quadric edge-collapse decimation to a triangle budget (Garland & Heckbert)
 *  3. vertices snapped back onto the true surface, normals from the SDF gradient (smooth
 *     shading that does not depend on the triangulation), winding fixed to face outward
 */
import type { SDF } from './sdf';
import type { V3 } from './skeleton';

export interface Mesh {
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
}

// ------------------------------------------------------------------ surface nets
export function surfaceNets(f: SDF, min: V3, max: V3, h: number): { pos: Float64Array; idx: Uint32Array } {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // coarse pass: blocks far from the surface are filled without sampling every point
  const B = 4;
  const r = B * h * 0.87 * 2.2 + h;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const cx = min[0] + (bi + B / 2) * h, cy = min[1] + (bj + B / 2) * h, cz = min[2] + (bk + B / 2) * h;
    const dc = f(cx, cy, cz);
    const far = Math.abs(dc) > r;
    for (let k = bk; k < Math.min(nz, bk + B); k++) for (let j = bj; j < Math.min(ny, bj + B); j++) for (let i = bi; i < Math.min(nx, bi + B); i++) {
      val[at(i, j, k)] = far ? dc : f(min[0] + i * h, min[1] + j * h, min[2] + k * h);
    }
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const cat = (i: number, j: number, k: number) => (k * cy + j) * cx + i;
  const pos: number[] = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = val[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      const va = corner[a], vb = corner[b];
      if (va < 0 === vb < 0) continue;
      const t = va / (va - vb);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    cell[cat(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  // every grid edge that crosses the surface becomes a quad joining the four cells around it
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = val[at(i, j, k)] < 0;
    if (i < cx && j >= 1 && j < cy && k >= 1 && k < cz && v0 !== val[at(i + 1, j, k)] < 0) {
      quad(cell[cat(i, j - 1, k - 1)], cell[cat(i, j, k - 1)], cell[cat(i, j, k)], cell[cat(i, j - 1, k)]);
    }
    if (j < cy && i >= 1 && i < cx && k >= 1 && k < cz && v0 !== val[at(i, j + 1, k)] < 0) {
      quad(cell[cat(i - 1, j, k - 1)], cell[cat(i, j, k - 1)], cell[cat(i, j, k)], cell[cat(i - 1, j, k)]);
    }
    if (k < cz && i >= 1 && i < cx && j >= 1 && j < cy && v0 !== val[at(i, j, k + 1)] < 0) {
      quad(cell[cat(i - 1, j - 1, k)], cell[cat(i, j - 1, k)], cell[cat(i, j, k)], cell[cat(i - 1, j, k)]);
    }
  }
  return { pos: Float64Array.from(pos), idx: Uint32Array.from(idx) };
}

// ------------------------------------------------------------------ decimation
class Heap {
  cost: number[] = [];
  a: number[] = [];
  b: number[] = [];
  stamp: number[] = [];
  push(c: number, a: number, b: number, s: number): void {
    let i = this.cost.length;
    this.cost.push(c); this.a.push(a); this.b.push(b); this.stamp.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  private swap(i: number, j: number): void {
    [this.cost[i], this.cost[j]] = [this.cost[j], this.cost[i]];
    [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
    [this.b[i], this.b[j]] = [this.b[j], this.b[i]];
    [this.stamp[i], this.stamp[j]] = [this.stamp[j], this.stamp[i]];
  }
  pop(): [number, number, number, number] | null {
    const n = this.cost.length;
    if (!n) return null;
    const top: [number, number, number, number] = [this.cost[0], this.a[0], this.b[0], this.stamp[0]];
    const last = n - 1;
    this.swap(0, last);
    this.cost.pop(); this.a.pop(); this.b.pop(); this.stamp.pop();
    let i = 0;
    const m = this.cost.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < m && this.cost[l] < this.cost[s]) s = l;
      if (r < m && this.cost[r] < this.cost[s]) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
    return top;
  }
}

/**
 * Quadric error decimation to about `target` triangles. `lock` vertices (e.g. along a seam
 * shared with another piece) are never moved or removed.
 */
export function decimate(posIn: Float64Array, idxIn: Uint32Array, target: number, lock?: (i: number) => boolean, maxEdge = Infinity): { pos: Float64Array; idx: Uint32Array } {
  const nv = posIn.length / 3;
  const pos = Float64Array.from(posIn);
  const tris = Int32Array.from(idxIn);
  const nt = tris.length / 3;
  const alive = new Uint8Array(nt).fill(1);
  const vAlive = new Uint8Array(nv).fill(1);
  const locked = new Uint8Array(nv);
  if (lock) for (let i = 0; i < nv; i++) locked[i] = lock(i) ? 1 : 0;
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) vf[tris[t * 3 + c]].push(t);
  const Q = new Float64Array(nv * 10);
  const addPlane = (q: Float64Array, o: number, a: number, b: number, c: number, d: number, w: number) => {
    q[o] += w * a * a; q[o + 1] += w * a * b; q[o + 2] += w * a * c; q[o + 3] += w * a * d;
    q[o + 4] += w * b * b; q[o + 5] += w * b * c; q[o + 6] += w * b * d;
    q[o + 7] += w * c * c; q[o + 8] += w * c * d; q[o + 9] += w * d * d;
  };
  const faceNormal = (t: number, out: number[]) => {
    const i0 = tris[t * 3] * 3, i1 = tris[t * 3 + 1] * 3, i2 = tris[t * 3 + 2] * 3;
    const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
    const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const n3 = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const l = faceNormal(t, n3);
    if (l < 1e-14) continue;
    const a = n3[0] / l, b = n3[1] / l, c = n3[2] / l;
    const i0 = tris[t * 3] * 3;
    const d = -(a * pos[i0] + b * pos[i0 + 1] + c * pos[i0 + 2]);
    for (let k = 0; k < 3; k++) addPlane(Q, tris[t * 3 + k] * 10, a, b, c, d, l * 0.5);
  }
  const stamp = new Uint32Array(nv);
  const heap = new Heap();
  const qsum = new Float64Array(10);
  const best = [0, 0, 0];
  const evalQ = (q: Float64Array, x: number, y: number, z: number) =>
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const cost = (a: number, b: number): number => {
    for (let k = 0; k < 10; k++) qsum[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const q = qsum;
    // solve the 3x3 system for the optimal point
    const A = q[0], B = q[1], C = q[2], D = q[4], E2 = q[5], F = q[7];
    const det = A * (D * F - E2 * E2) - B * (B * F - E2 * C) + C * (B * E2 - D * C);
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    if (locked[a] && locked[b]) return Infinity;
    if (locked[a] || locked[b]) {
      const l = locked[a] ? a : b;
      best[0] = pos[l * 3]; best[1] = pos[l * 3 + 1]; best[2] = pos[l * 3 + 2];
      return evalQ(q, best[0], best[1], best[2]);
    }
    if (Math.abs(det) > 1e-18) {
      const rx = -q[3], ry = -q[6], rz = -q[8];
      const x = (rx * (D * F - E2 * E2) - B * (ry * F - E2 * rz) + C * (ry * E2 - D * rz)) / det;
      const y = (A * (ry * F - E2 * rz) - rx * (B * F - E2 * C) + C * (B * rz - ry * C)) / det;
      const z = (A * (D * rz - ry * E2) - B * (B * rz - ry * C) + rx * (B * E2 - D * C)) / det;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const el = Math.hypot(bx - ax, by - ay, bz - az);
      // the optimum can run away on flat or cylindrical patches: keep it near the edge
      if (Math.hypot(x - mx, y - my, z - mz) < el * 1.5) {
        best[0] = x; best[1] = y; best[2] = z;
        return evalQ(q, x, y, z);
      }
    }
    const cands = [[ax, ay, az], [bx, by, bz], [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]];
    let bc = Infinity;
    for (const c of cands) {
      const e = evalQ(q, c[0], c[1], c[2]);
      if (e < bc) {
        bc = e;
        best[0] = c[0]; best[1] = c[1]; best[2] = c[2];
      }
    }
    return bc;
  };
  const pushEdge = (a: number, b: number) => {
    const c = cost(a, b);
    if (c < Infinity) heap.push(c, a, b, stamp[a] + stamp[b] * 0); // stamp checked below
  };
  const seen = new Set<number>();
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
    const a = tris[t * 3 + c], b = tris[t * 3 + ((c + 1) % 3)];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const k = lo * nv + hi;
    if (seen.has(k)) continue;
    seen.add(k);
    pushEdge(lo, hi);
  }
  seen.clear();
  const edgeStamp = new Map<number, number>();
  void edgeStamp;
  let live = nt;
  const neighbors = (v: number): Set<number> => {
    const s = new Set<number>();
    for (const t of vf[v]) {
      if (!alive[t]) continue;
      for (let c = 0; c < 3; c++) if (tris[t * 3 + c] !== v) s.add(tris[t * 3 + c]);
    }
    return s;
  };
  const before = [0, 0, 0], after = [0, 0, 0];
  // collapses refused now (flips, non-manifold) are retried once the easy ones run out
  let rejected: Array<[number, number]> = [];
  let lastLive = -1;
  while (live > target) {
    let e = heap.pop();
    if (!e) {
      if (!rejected.length || live === lastLive) break;
      lastLive = live;
      for (const [ra, rb] of rejected) if (vAlive[ra] && vAlive[rb]) pushEdge(ra, rb);
      rejected = [];
      e = heap.pop();
      if (!e) break;
    }
    const [, a, b] = e;
    if (!vAlive[a] || !vAlive[b]) continue;
    // stale entry? recompute and requeue if the cost moved
    const c = cost(a, b);
    if (c === Infinity) continue;
    if (c > e[0] * 1.0001 + 1e-15) {
      heap.push(c, a, b, 0);
      continue;
    }
    const nx = best[0], ny = best[1], nz = best[2];
    // link condition: the edge's two ends may share exactly two neighbours (keeps the mesh manifold)
    const na = neighbors(a), nb = neighbors(b);
    if (!na.has(b)) continue;
    let common = 0;
    for (const v of na) if (nb.has(v)) common++;
    if (common !== 2) {
      rejected.push([a, b]);
      continue;
    }
    // no flipped or squashed faces
    let ok = true;
    for (const v of [a, b]) {
      for (const t of vf[v]) {
        if (!alive[t]) continue;
        const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
        if ((i0 === a || i1 === a || i2 === a) && (i0 === b || i1 === b || i2 === b)) continue;
        const l0 = faceNormal(t, before);
        const ox = pos[v * 3], oy = pos[v * 3 + 1], oz = pos[v * 3 + 2];
        pos[v * 3] = nx; pos[v * 3 + 1] = ny; pos[v * 3 + 2] = nz;
        const l1 = faceNormal(t, after);
        pos[v * 3] = ox; pos[v * 3 + 1] = oy; pos[v * 3 + 2] = oz;
        if (l1 < 1e-16 || (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (l0 * l1 + 1e-30) < 0.3) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    // keep triangles small enough to bend smoothly (no edge longer than maxEdge)
    if (ok && maxEdge < Infinity) {
      for (const v of na) {
        if (v === b) continue;
        if (Math.hypot(pos[v * 3] - nx, pos[v * 3 + 1] - ny, pos[v * 3 + 2] - nz) > maxEdge) ok = false;
      }
      for (const v of nb) {
        if (v === a || !ok) continue;
        if (Math.hypot(pos[v * 3] - nx, pos[v * 3 + 1] - ny, pos[v * 3 + 2] - nz) > maxEdge) ok = false;
      }
      if (!ok) continue; // never becomes possible later: drop it
    }
    if (!ok) {
      rejected.push([a, b]);
      continue;
    }
    // collapse b into a
    pos[a * 3] = nx; pos[a * 3 + 1] = ny; pos[a * 3 + 2] = nz;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    vAlive[b] = 0;
    for (const t of vf[b]) {
      if (!alive[t]) continue;
      let hasA = false;
      for (let c2 = 0; c2 < 3; c2++) if (tris[t * 3 + c2] === a) hasA = true;
      if (hasA) {
        alive[t] = 0;
        live--;
        continue;
      }
      for (let c2 = 0; c2 < 3; c2++) if (tris[t * 3 + c2] === b) tris[t * 3 + c2] = a;
      vf[a].push(t);
    }
    vf[b] = [];
    vf[a] = vf[a].filter((t) => alive[t]);
    stamp[a]++;
    for (const v of neighbors(a)) pushEdge(Math.min(a, v), Math.max(a, v));
  }
  // compact
  const remap = new Int32Array(nv).fill(-1);
  const outPos: number[] = [];
  const outIdx: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue;
    for (let c = 0; c < 3; c++) {
      const v = tris[t * 3 + c];
      if (remap[v] < 0) {
        remap[v] = outPos.length / 3;
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      outIdx.push(remap[v]);
    }
  }
  return { pos: Float64Array.from(outPos), idx: Uint32Array.from(outIdx) };
}

/** Drops triangles (keeps a closed or open surface), re-indexing the vertices. */
export function keepTriangles(m: { pos: Float64Array; idx: Uint32Array }, keep: (t: number) => boolean): { pos: Float64Array; idx: Uint32Array } {
  const remap = new Int32Array(m.pos.length / 3).fill(-1);
  const pos: number[] = [], idx: number[] = [];
  for (let t = 0; t < m.idx.length / 3; t++) {
    if (!keep(t)) continue;
    for (let c = 0; c < 3; c++) {
      const v = m.idx[t * 3 + c];
      if (remap[v] < 0) {
        remap[v] = pos.length / 3;
        pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      }
      idx.push(remap[v]);
    }
  }
  return { pos: Float64Array.from(pos), idx: Uint32Array.from(idx) };
}

/** Vertices on an open edge (an edge used by one triangle only). */
export function boundaryVertices(idx: Uint32Array, nv: number): Uint8Array {
  const count = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) for (let c = 0; c < 3; c++) {
    const a = idx[t + c], b = idx[t + ((c + 1) % 3)];
    const k = Math.min(a, b) * nv + Math.max(a, b);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out = new Uint8Array(nv);
  for (const [k, n] of count) if (n === 1) {
    out[Math.floor(k / nv)] = 1;
    out[k % nv] = 1;
  }
  return out;
}

// ------------------------------------------------------------------ finishing
export function gradient(f: SDF, x: number, y: number, z: number, e = 0.0006): V3 {
  const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/** Snaps vertices onto the zero surface, computes normals from the gradient, fixes winding. */
export function finish(f: SDF, m: { pos: Float64Array; idx: Uint32Array }): Mesh {
  const n = m.pos.length / 3;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z);
      if (Math.abs(d) < 1e-5) break;
      const g = gradient(f, x, y, z);
      const step = Math.max(-0.004, Math.min(0.004, d));
      x -= g[0] * step; y -= g[1] * step; z -= g[2] * step;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const g = gradient(f, x, y, z);
    nrm[i * 3] = g[0]; nrm[i * 3 + 1] = g[1]; nrm[i * 3 + 2] = g[2];
  }
  const idx = Uint32Array.from(m.idx);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const sx = nrm[a] + nrm[b] + nrm[c], sy = nrm[a + 1] + nrm[b + 1] + nrm[c + 1], sz = nrm[a + 2] + nrm[b + 2] + nrm[c + 2];
    if (fx * sx + fy * sy + fz * sz < 0) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  return { pos, nrm, idx };
}

/** Ambient occlusion from a distance field: creases, folds and tucked-in spots darken. */
export function occlusion(f: SDF, x: number, y: number, z: number, n: V3, step = 0.008, strength = 1.6): number {
  let occ = 0, w = 0.5;
  for (let i = 1; i <= 5; i++) {
    const d = i * step;
    occ += w * Math.max(0, d - f(x + n[0] * d, y + n[1] * d, z + n[2] * d)) / d;
    w *= 0.6;
  }
  return Math.max(0, Math.min(1, 1 - occ * strength * 0.55));
}

/** Mesh a shape inside a box at voxel size h, down to `tris` triangles. */
export function build(f: SDF, min: V3, max: V3, h: number, tris: number): Mesh {
  const raw = surfaceNets(f, min, max, h);
  if (raw.idx.length === 0) return { pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };
  const dec = raw.idx.length / 3 > tris ? decimate(raw.pos, raw.idx, tris) : raw;
  return finish(f, dec);
}
