import type { MapDef } from '../map/types';
import type { Rng } from '../math';
import type { PhysicsWorld } from './physics';

const SQRT2 = Math.SQRT2;

/**
 * Ground-level navigation grid for bots (1m cells), built by probing the collision world
 * with a standing capsule. A* with wall-avoidance costs, then string-pulled into a short
 * list of waypoints.
 */
export class NavGrid {
  readonly cell = 1;
  readonly w: number;
  readonly h: number;
  readonly minX: number;
  readonly minZ: number;
  /** 1 = a standing player fits at the cell center. */
  readonly walk: Uint8Array;
  /** Extra traversal cost (cells hugging walls). */
  private penalty: Float32Array;

  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: Int32Array;
  private heapSize = 0;
  private cellsTmp: number[] = [];

  constructor(phys: PhysicsWorld, map: MapDef) {
    const b = map.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / this.cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / this.cell);
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.penalty = new Float32Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);

    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.minX + (i + 0.5) * this.cell;
        const z = this.minZ + (j + 0.5) * this.cell;
        this.walk[j * this.w + i] = phys.canStandAt(x, 0.03, z) ? 1 : 0;
      }
    }
    // Penalize cells next to obstacles so bots keep to the middle of lanes and round corners wide.
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const idx = j * this.w + i;
        if (!this.walk[idx]) continue;
        let blocked = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= this.w || jj >= this.h || !this.walk[jj * this.w + ii]) blocked++;
          }
        }
        this.penalty[idx] = blocked > 0 ? 0.6 + blocked * 0.25 : 0;
      }
    }
  }

  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.cell);
    const j = Math.floor((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  cellX(idx: number): number {
    return this.minX + ((idx % this.w) + 0.5) * this.cell;
  }

  cellZ(idx: number): number {
    return this.minZ + (Math.floor(idx / this.w) + 0.5) * this.cell;
  }

  isWalkable(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.walk[c] === 1;
  }

  /** Closest walkable cell to a point (searches outward in rings). */
  nearestWalkable(x: number, z: number, maxRing = 6): number {
    const ci = Math.min(this.w - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
    const cj = Math.min(this.h - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
    if (this.walk[cj * this.w + ci]) return cj * this.w + ci;
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= maxRing; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const idx = j * this.w + i;
          if (!this.walk[idx]) continue;
          const d = (this.cellX(idx) - x) ** 2 + (this.cellZ(idx) - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  randomWalkable(rng: Rng): number {
    for (let k = 0; k < 200; k++) {
      const idx = rng.int(this.walk.length);
      if (this.walk[idx]) return idx;
    }
    return this.nearestWalkable(0, 0, 40);
  }

  /** True if a player can walk the straight segment (sampled, with shoulder clearance). */
  lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return this.isWalkable(x0, z0);
    const steps = Math.ceil(len / 0.35);
    const px = (-dz / len) * 0.3, pz = (dx / len) * 0.3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t, z = z0 + dz * t;
      if (!this.isWalkable(x, z) || !this.isWalkable(x + px, z + pz) || !this.isWalkable(x - px, z - pz)) return false;
    }
    return true;
  }

  // ---- binary heap on f-score ----
  private push(idx: number): void {
    const heap = this.heap, f = this.f;
    let i = this.heapSize++;
    heap[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      const t = heap[p];
      heap[p] = heap[i];
      heap[i] = t;
      i = p;
    }
  }

  private pop(): number {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m];
        heap[m] = heap[i];
        heap[i] = t;
        i = m;
      }
    }
    return top;
  }

  /**
   * A* from (x0,z0) to (x1,z1). Writes smoothed waypoints as flat [x,z,x,z,...] into `out`
   * (excluding the start, ending at the goal). Returns the path length in meters, or -1.
   */
  findPath(x0: number, z0: number, x1: number, z1: number, out: number[]): number {
    out.length = 0;
    const start = this.nearestWalkable(x0, z0);
    const goal = this.nearestWalkable(x1, z1);
    if (start < 0 || goal < 0) return -1;
    if (start === goal) {
      out.push(x1, z1);
      return Math.hypot(x1 - x0, z1 - z0);
    }
    const w = this.w, h = this.h, walk = this.walk;
    const gen = ++this.gen;
    const gi = goal % w, gj = Math.floor(goal / w);
    const heur = (idx: number): number => {
      const dx = Math.abs((idx % w) - gi), dz = Math.abs(Math.floor(idx / w) - gj);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = heur(start);
    this.parent[start] = -1;
    this.stamp[start] = gen;
    this.push(start);
    let found = false;

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      const ci = cur % w, cj = Math.floor(cur / w);
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= h) continue;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          if (ni < 0 || ni >= w) continue;
          const nb = nj * w + ni;
          if (!walk[nb] || this.closed[nb] === gen) continue;
          // no cutting corners diagonally
          if (di !== 0 && dj !== 0 && (!walk[cj * w + ni] || !walk[nj * w + ci])) continue;
          const ng = this.g[cur] + (di !== 0 && dj !== 0 ? SQRT2 : 1) + this.penalty[nb];
          if (this.stamp[nb] !== gen || ng < this.g[nb]) {
            this.stamp[nb] = gen;
            this.g[nb] = ng;
            this.f[nb] = ng + heur(nb);
            this.parent[nb] = cur;
            this.push(nb);
          }
        }
      }
    }
    if (!found) return -1;

    // reconstruct (goal -> start), then reverse
    const cells = this.cellsTmp;
    cells.length = 0;
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();

    // string pulling: skip ahead to the furthest directly reachable cell
    let ax = x0, az = z0;
    let i = 0;
    let length = 0;
    while (i < cells.length - 1) {
      let j = Math.min(cells.length - 1, i + 1);
      // extend while the straight line stays walkable (cap lookahead to bound cost)
      const limit = Math.min(cells.length - 1, i + 40);
      for (let k = j + 1; k <= limit; k++) {
        if (this.lineClear(ax, az, this.cellX(cells[k]), this.cellZ(cells[k]))) j = k;
        else if (k - j > 6) break;
      }
      const isLast = j === cells.length - 1;
      const wx = isLast && this.isWalkable(x1, z1) ? x1 : this.cellX(cells[j]);
      const wz = isLast && this.isWalkable(x1, z1) ? z1 : this.cellZ(cells[j]);
      out.push(wx, wz);
      length += Math.hypot(wx - ax, wz - az);
      ax = wx;
      az = wz;
      i = j;
    }
    return length;
  }
}
