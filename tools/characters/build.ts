/**
 * WHOOPA TOWNE — Urban Ink character generator.
 *
 *   npx tsx tools/characters/build.ts            (writes client/public/assets/characters/ink.glb)
 *   npx tsx tools/characters/build.ts --quick    (coarser voxels, for fast iteration)
 *
 * Sculpts the body, head, hands and every garment as signed distance shapes (anatomy.ts,
 * garments.ts), meshes and decimates them to a mobile budget, skins them to the CC0 rig with
 * grown-up proportions, bakes occlusion / fold shading into vertex colors, and writes one
 * rigged GLB with the rig's animations embedded. Deterministic: same code, same file.
 */
import { performance } from 'node:perf_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeAnatomy, type Anatomy, type Region } from './anatomy';
import { makeGarments } from './garments';
import { GlbWriter, readGlb } from './glb';
import { boundaryVertices, build as meshShape, finish, keepTriangles, occlusion, decimate, surfaceNets, type Mesh } from './mesher';
import { type SDF, chain, intersect, len, norm, plane, scale, add, sub, sphere } from './sdf';
import { loadSkeleton, invert, type InkSkeleton, type V3 } from './skeleton';
import { makeWeigher, type Weights } from './weights';

const ROOT = resolve(import.meta.dirname, '../..');
const QUICK = process.argv.includes('--quick');
/** --only=regex: rebuild just the matching pieces, reuse the rest from the cache (fast iteration). */
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith('--only='));
  return a ? new RegExp(a.slice(7)) : null;
})();
const CACHE = resolve(ROOT, 'tools/out/inkcache');
mkdirSync(CACHE, { recursive: true });
type Cached = { pos: number[]; nrm: number[]; idx: number[]; shade: number[]; joints: number[]; weights: number[]; maskG?: number[]; maskB?: number[] };
function fromCache(label: string): PieceOut[] | null {
  const f = resolve(CACHE, `${label}.json`);
  if (!existsSync(f)) return null;
  const list = JSON.parse(readFileSync(f, 'utf8')) as Array<{ part: Part; material: string } & Cached>;
  return list.map((c) => ({
    part: c.part, material: c.material,
    mesh: { pos: Float32Array.from(c.pos), nrm: Float32Array.from(c.nrm), idx: Uint32Array.from(c.idx) },
    shade: Float32Array.from(c.shade), weights: { joints: Uint16Array.from(c.joints), weights: Float32Array.from(c.weights) },
    maskG: c.maskG ? Float32Array.from(c.maskG) : undefined, maskB: c.maskB ? Float32Array.from(c.maskB) : undefined,
  }));
}
function toCache(label: string, list: PieceOut[]): void {
  writeFileSync(resolve(CACHE, `${label}.json`), JSON.stringify(list.map((p) => ({
    part: p.part, material: p.material, pos: Array.from(p.mesh.pos), nrm: Array.from(p.mesh.nrm), idx: Array.from(p.mesh.idx),
    shade: Array.from(p.shade), joints: Array.from(p.weights.joints), weights: Array.from(p.weights.weights),
    maskG: p.maskG ? Array.from(p.maskG) : undefined, maskB: p.maskB ? Array.from(p.maskB) : undefined,
  }))));
}
/** Builds (or reuses) a labelled group of pieces. */
function stage(label: string, make: () => void): void {
  if (ONLY && !ONLY.test(label)) {
    const hit = fromCache(label);
    if (hit) {
      pieces.push(...hit);
      return;
    }
  }
  const before = pieces.length;
  make();
  toCache(label, pieces.slice(before));
}
const Q = QUICK ? 1.6 : 1; // voxel size multiplier

export type Part = 'Head' | 'Body' | 'Legs' | 'Feet';
export interface PieceOut {
  part: Part;
  material: string;
  mesh: Mesh;
  shade: Float32Array;
  weights: Weights;
  /** Optional per-vertex masks written to the G and B color channels (e.g. lips, darker skin). */
  maskG?: Float32Array;
  maskB?: Float32Array;
}

const pieces: PieceOut[] = [];
const t0 = performance.now();
const log = (s: string) => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`);

// ------------------------------------------------------------------ rig + anatomy
const src = readGlb(resolve(ROOT, 'client/public/assets/characters/hoodie.glb'));
const sk: InkSkeleton = loadSkeleton(src, { upperArm: 1.42, shoulder: 1.3, hand: 0.8 });
const A: Anatomy = makeAnatomy(sk);
const weigh = makeWeigher(sk, A);

/** Splits a mesh's triangles into labelled sub-meshes (vertices on a border are duplicated). */
export function split(m: Mesh, label: (x: number, y: number, z: number) => string | null): Map<string, Mesh> {
  const groups = new Map<string, number[]>();
  for (let t = 0; t < m.idx.length; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let c = 0; c < 3; c++) {
      const v = m.idx[t + c] * 3;
      cx += m.pos[v] / 3; cy += m.pos[v + 1] / 3; cz += m.pos[v + 2] / 3;
    }
    const l = label(cx, cy, cz);
    if (l === null) continue;
    let g = groups.get(l);
    if (!g) groups.set(l, (g = []));
    g.push(m.idx[t], m.idx[t + 1], m.idx[t + 2]);
  }
  const out = new Map<string, Mesh>();
  for (const [l, tris] of groups) out.set(l, subset(m, tris));
  return out;
}
export function subset(m: Mesh, tris: number[]): Mesh {
  const map = new Map<number, number>();
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const v of tris) {
    let k = map.get(v);
    if (k === undefined) {
      k = pos.length / 3;
      map.set(v, k);
      pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      nrm.push(m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2]);
    }
    idx.push(k);
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx) };
}

/** Occlusion-based shading (1 = fully lit) against a scene SDF, times an optional detail term. */
export function shadeOf(m: Mesh, scene: SDF, strength = 1.3, detail?: (x: number, y: number, z: number) => number): Float32Array {
  const n = m.pos.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    const ao = occlusion(scene, x, y, z, [m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]], 0.008, strength);
    out[i] = (0.55 + 0.45 * ao) * (detail ? detail(x, y, z) : 1);
  }
  return out;
}

export function add_(part: Part, material: string, mesh: Mesh, shade: Float32Array, weights: Weights, maskG?: Float32Array, maskB?: Float32Array): void {
  if (mesh.idx.length === 0) return;
  pieces.push({ part, material, mesh, shade, weights, maskG, maskB });
}
const maskOf = (m: Mesh, f: SDF, inner: number, outer: number): Float32Array => {
  const n = m.pos.length / 3, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = f(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
    out[i] = 1 - Math.max(0, Math.min(1, (d - inner) / (outer - inner)));
  }
  return out;
};

// ------------------------------------------------------------------ skin: body
stage('body', () => {
  const wrL = A.j('WristL');
  const body = intersect(A.body, (x) => Math.abs(x) - (wrL[0] - 0.012));
  const m = meshShape(body, [-wrL[0], 0.0, -0.17], [wrL[0], 1.56, 0.2], 0.006 * Q, 7000);
  log(`body: ${m.idx.length / 3} tris`);
  // (the neck is the head piece's own)
  const keep: Partial<Record<Region, string>> = { torso: 'Skin_Torso', upperarm: 'Skin_UpperArm', forearm: 'Skin_Forearm', thigh: 'Skin_Thigh', shin: 'Skin_Shin' };
  const parts = split(m, (x, y, z) => keep[A.region(x, y, z)] ?? null);
  for (const [mat, sub_] of parts) {
    const legs = mat === 'Skin_Thigh' || mat === 'Skin_Shin';
    add_(legs ? 'Legs' : 'Body', mat, sub_, shadeOf(sub_, A.skin), weigh(sub_.pos, sub_.idx));
  }
});

// ------------------------------------------------------------------ skin: hands
stage('hands', () => { for (const s of ['L', 'R'] as const) {
  const wr = A.j(`Wrist${s}`);
  const k = s === 'L' ? 1 : -1;
  const lo: V3 = [k > 0 ? wr[0] - 0.06 : -(wr[0] * -1) - 0.24, wr[1] - 0.06, wr[2] - 0.08];
  const x0 = Math.min(wr[0] - 0.06 * k, wr[0] + 0.25 * k), x1 = Math.max(wr[0] - 0.06 * k, wr[0] + 0.25 * k);
  void lo;
  const m = meshShape(A.hand[s], [x0, wr[1] - 0.06, wr[2] - 0.075], [x1, wr[1] + 0.05, wr[2] + 0.12], 0.0017 * Q, 950);
  log(`hand ${s}: ${m.idx.length / 3} tris`);
  add_('Body', 'Skin_Hand', m, shadeOf(m, A.skin, 1.1), weigh(m.pos, m.idx, { regionAt: () => 'hand' }));
} });

// ------------------------------------------------------------------ head
stage('head', () => {
  const m = meshShape(A.head, [-0.11, 1.32, -0.09], [0.11, 1.83, 0.19], 0.0021 * Q, 3400);
  log(`head: ${m.idx.length / 3} tris`);
  // Cel shading draws the line between light and shadow hard, so every bump of the cheeks and
  // jaw would show as a blotch. Over the face the shading normals lean toward those of a smooth
  // rounded head (the shape, outline and features stay exactly as sculpted): the light falls
  // across it in one clean edge, the way faces are drawn.
  {
    const c = A.headCenter, rx = 0.074 * 1.07, ry = 0.1 * 1.07, rz = 0.092 * 1.07;
    for (let i = 0; i < m.pos.length / 3; i++) {
      const x = m.pos[i * 3] - c[0], y = m.pos[i * 3 + 1] - c[1], z = m.pos[i * 3 + 2] - c[2];
      // the front of the head, from the brows down to under the chin (fading out at the edges)
      const front = Math.max(0, Math.min(1, (z + 0.005) / 0.04));
      const band = Math.max(0, Math.min(1, (y + 0.135) / 0.03)) * Math.max(0, Math.min(1, (0.05 - y) / 0.03));
      // (the eye sockets keep their own shading: it is what frames the eyes)
      const de = Math.min(...(['L', 'R'] as const).map((e) => Math.hypot(m.pos[i * 3] - A.eyes.center[e][0], m.pos[i * 3 + 1] - A.eyes.center[e][1], m.pos[i * 3 + 2] - A.eyes.center[e][2])));
      const eyes = Math.max(0, Math.min(1, (de - 0.019) / 0.012));
      const w = 0.62 * front * band * eyes;
      if (w <= 0) continue;
      let nx = x / (rx * rx), ny = y / (ry * ry), nz = z / (rz * rz);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const ox = m.nrm[i * 3], oy = m.nrm[i * 3 + 1], oz = m.nrm[i * 3 + 2];
      let ax = ox + (nx - ox) * w, ay = oy + (ny - oy) * w, az = oz + (nz - oz) * w;
      const k = Math.hypot(ax, ay, az) || 1;
      m.nrm[i * 3] = ax / k; m.nrm[i * 3 + 1] = ay / k; m.nrm[i * 3 + 2] = az / k;
    }
  }
  // one skin piece: lips (G) and darker skin (B) are soft masks, painted per vertex at runtime
  add_('Head', 'Skin', m, shadeOf(m, A.skin, 0.95), weigh(m.pos, m.idx, { regionAt: (x, y, z) => (y < 1.5 ? 'neck' : A.region(x, y, z)) }), maskOf(m, A.lips, -0.0004, 0.0012), maskOf(m, A.dark, -0.001, 0.002));
});

// ------------------------------------------------------------------ eyes: a white eyeball, an iris and a pupil as clean caps on it
stage('eyes', () => { for (const s of ['L', 'R'] as const) {
  const c = A.eyes.center[s], r = A.eyes.radius;
  const look = norm([s === 'L' ? 0.05 : -0.05, -0.04, 1]);
  const box = (pad: number): [V3, V3] => [[c[0] - r - pad, c[1] - r - pad, c[2] - r - pad], [c[0] + r + pad, c[1] + r + pad, c[2] + r + pad]];
  const sclera = meshShape(sphere(c, r), ...box(0.002), 0.0007, 220);
  add_('Head', 'Sclera', sclera, new Float32Array(sclera.pos.length / 3).fill(1), weigh(sclera.pos, sclera.idx, { regionAt: () => 'head' }));
  // a cap: a thin shell just over the eyeball, cut off by a plane square to the gaze
  const cap = (lift: number, angle: number): SDF => {
    const shell = (x: number, y: number, z: number) => Math.max(Math.hypot(x - c[0], y - c[1], z - c[2]) - (r + lift), -(Math.hypot(x - c[0], y - c[1], z - c[2]) - (r + lift - 0.0005)));
    const o = add(c, scale(look, r * Math.cos(angle)));
    return intersect(shell, plane(o, scale(look, -1)));
  };
  for (const [mat, lift, angle, tris] of [['Eye', 0.00025, 0.5, 140], ['Pupil', 0.0005, 0.22, 60]] as const) {
    const m = meshShape(cap(lift, angle), ...box(0.003), 0.00028, tris);
    add_('Head', mat, m, new Float32Array(m.pos.length / 3).fill(1), weigh(m.pos, m.idx, { regionAt: () => 'head' }));
  }
} });

// ------------------------------------------------------------------ eyebrows: a thin layer on the brow ridge
stage('brows', () => {
  const head = A.head;
  const surfZ = (x: number, y: number): number => {
    let z = 0.2;
    for (let i = 0; i < 80; i++) {
      const d = head(x, y, z);
      if (d < 0.0002) break;
      z -= Math.max(d, 0.0004);
    }
    return z;
  };
  const HC = A.headCenter;
  for (const s of ['L', 'R'] as const) {
    const k = s === 'L' ? 1 : -1;
    const pts: V3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = HC[0] + k * (0.011 + t * 0.043);
      const y = HC[1] + 0.0245 + Math.sin(t * Math.PI * 0.85) * 0.0045 - t * 0.003;
      pts.push([x, y, surfZ(x, y)]);
      radii.push(0.0034 + Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.0012 - t * t * 0.0025);
    }
    const strip = chain(pts, radii, 0.002);
    const brow: SDF = (x, y, z) => {
      const h = head(x, y, z);
      return Math.max(strip(x, y, z), h - 0.0017, -(h + 0.0006));
    };
    const xs = pts.map((p) => p[0]);
    const m = meshShape(brow, [Math.min(...xs) - 0.008, HC[1] + 0.01, HC[2] + 0.05], [Math.max(...xs) + 0.008, HC[1] + 0.045, HC[2] + 0.15], 0.0006, 260);
    add_('Head', 'Eyebrows', m, new Float32Array(m.pos.length / 3).fill(1), weigh(m.pos, m.idx, { regionAt: () => 'head' }));
  }
  log('eyes + brows');
});

// ------------------------------------------------------------------ garments
for (const g of makeGarments(A, sk)) stage(g.material, () => {
  // (cloth shells need voxels well under their thickness: quick mode never coarsens them)
  let raw = surfaceNets(g.sdf, g.min, g.max, g.h);
  if (raw.idx.length === 0) {
    log(`garment ${g.material}: empty!`);
    return;
  }
  // the inside of the cloth only shows near its openings: drop the rest
  if (g.outer && g.th && g.rim) {
    const outer = g.outer, th = g.th, rim = g.rim;
    raw = keepTriangles(raw, (t) => {
      let cx = 0, cy = 0, cz = 0;
      for (let c = 0; c < 3; c++) {
        const v = raw.idx[t * 3 + c] * 3;
        cx += raw.pos[v] / 3; cy += raw.pos[v + 1] / 3; cz += raw.pos[v + 2] / 3;
      }
      const inner = outer(cx, cy, cz) < -th * 0.5;
      return !inner || rim(cx, cy, cz) > -0.07;
    });
  }
  const edge = boundaryVertices(raw.idx, raw.pos.length / 3);
  const dec = raw.idx.length / 3 > g.tris ? decimate(raw.pos, raw.idx, g.tris, (i) => edge[i] === 1, g.maxEdge ?? 0.06) : raw;
  const m = finish(g.sdf, dec);
  const shade = shadeOf(m, g.scene ?? g.sdf, g.ao ?? 1.2, g.detail);
  add_(g.part, g.material, m, shade, weigh(m.pos, m.idx, { allow: g.allow, regionAt: g.regionAt, smooth: g.smooth ?? 3 }));
  log(`${g.material}: ${m.idx.length / 3} tris`);
});

// ------------------------------------------------------------------ one piece per material (left + right eyes, brows, hands...)
{
  const byKey = new Map<string, PieceOut[]>();
  for (const p of pieces) {
    const k = `${p.part}:${p.material}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }
  pieces.length = 0;
  for (const list of byKey.values()) {
    if (list.length === 1) {
      pieces.push(list[0]);
      continue;
    }
    let nv = 0, ni = 0;
    for (const p of list) {
      nv += p.mesh.pos.length / 3;
      ni += p.mesh.idx.length;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint32Array(ni), shade = new Float32Array(nv);
    const joints = new Uint16Array(nv * 4), weights = new Float32Array(nv * 4);
    const hasG = list.some((p) => p.maskG), hasB = list.some((p) => p.maskB);
    const maskG = hasG ? new Float32Array(nv) : undefined, maskB = hasB ? new Float32Array(nv) : undefined;
    let ov = 0, oi = 0;
    for (const p of list) {
      const n = p.mesh.pos.length / 3;
      pos.set(p.mesh.pos, ov * 3);
      nrm.set(p.mesh.nrm, ov * 3);
      shade.set(p.shade, ov);
      joints.set(p.weights.joints, ov * 4);
      weights.set(p.weights.weights, ov * 4);
      if (maskG && p.maskG) maskG.set(p.maskG, ov);
      if (maskB && p.maskB) maskB.set(p.maskB, ov);
      for (let k = 0; k < p.mesh.idx.length; k++) idx[oi + k] = p.mesh.idx[k] + ov;
      ov += n;
      oi += p.mesh.idx.length;
    }
    pieces.push({ part: list[0].part, material: list[0].material, mesh: { pos, nrm, idx }, shade, weights: { joints, weights }, maskG, maskB });
  }
}

// ------------------------------------------------------------------ write the GLB
const W = new GlbWriter();
const srcNodes = src.json.nodes as any[];
const nodeMap = new Map<number, number>();
for (const ni of sk.armatureNodes) {
  nodeMap.set(ni, W.json.nodes.length);
  const n = srcNodes[ni];
  const out: any = { name: n.name };
  if (n.translation) out.translation = sk.newTranslation.get(ni) ?? n.translation;
  if (n.rotation) out.rotation = n.rotation;
  if (n.scale) out.scale = n.scale;
  W.json.nodes.push(out);
}
for (const ni of sk.armatureNodes) {
  const kids = (srcNodes[ni].children ?? []).filter((c: number) => nodeMap.has(c)).map((c: number) => nodeMap.get(c));
  if (kids.length) W.json.nodes[nodeMap.get(ni)!].children = kids;
}
W.json.scenes[0].nodes.push(nodeMap.get(sk.armatureRoot));
// skin: same joints (and order) as the source rig; inverse bind matrices of our bind pose
const ibm = new Float32Array(sk.joints.length * 16);
sk.joints.forEach((jt, i) => ibm.set(Array.from(invert(jt.bind)), i * 16));
W.json.skins = [{ joints: sk.joints.map((jt) => nodeMap.get(jt.node)), inverseBindMatrices: W.accessor(ibm, 'MAT4'), skeleton: nodeMap.get(sk.armatureRoot) }];
const materials = new Map<string, number>();
const groups = new Map<Part, PieceOut[]>();
for (const p of pieces) {
  if (!groups.has(p.part)) groups.set(p.part, []);
  groups.get(p.part)!.push(p);
}
let totalTris = 0, totalVerts = 0;
for (const [part, list] of groups) {
  const prims = list.map((p) => {
    let mi = materials.get(p.material);
    if (mi === undefined) {
      mi = W.material(p.material, [1, 1, 1]);
      materials.set(p.material, mi);
    }
    const n = p.mesh.pos.length / 3;
    totalVerts += n;
    totalTris += p.mesh.idx.length / 3;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([p.shade[i], p.maskG?.[i] ?? 0, p.maskB?.[i] ?? 0], i * 3);
    return {
      attributes: {
        POSITION: W.accessor(p.mesh.pos, 'VEC3', { minmax: true, target: 34962 }),
        NORMAL: W.accessor(p.mesh.nrm, 'VEC3', { target: 34962 }),
        COLOR_0: W.accessor(col, 'VEC3', { target: 34962 }),
        JOINTS_0: W.accessor(p.weights.joints, 'VEC4', { target: 34962 }),
        WEIGHTS_0: W.accessor(p.weights.weights, 'VEC4', { target: 34962 }),
      },
      indices: W.accessor(n > 65535 ? p.mesh.idx : Uint16Array.from(p.mesh.idx), 'SCALAR', { target: 34963 }),
      material: mi,
    };
  });
  W.json.meshes.push({ name: `Ink_${part}`, primitives: prims });
  W.json.nodes.push({ name: `Ink_${part}`, mesh: W.json.meshes.length - 1, skin: 0 });
  W.json.scenes[0].nodes.push(W.json.nodes.length - 1);
}
// the rig's animation clips, unchanged
W.json.animations = (src.json.animations as any[]).map((a) => ({
  name: a.name,
  samplers: a.samplers.map((s: any) => ({ input: W.copyAccessor(src, s.input), output: W.copyAccessor(src, s.output), interpolation: s.interpolation ?? 'LINEAR' })),
  channels: a.channels.filter((c: any) => nodeMap.has(c.target.node)).map((c: any) => ({ sampler: c.sampler, target: { node: nodeMap.get(c.target.node), path: c.target.path } })),
}));
const out = resolve(ROOT, 'client/public/assets/characters/ink.glb');
const bytes = W.write(out);
log(`wrote ${out}: ${(bytes / 1024).toFixed(0)} KB, ${pieces.length} pieces, ${totalVerts} vertices, ${totalTris} triangles`);
void len; void scale; void add; void plane;
