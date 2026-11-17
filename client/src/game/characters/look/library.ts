import * as THREE from 'three';
import { CHARACTER_MESH, type CharacterPiece, type CharacterTemplate } from '../../assets';

/**
 * The Character Creator's parts bin: every sub-mesh of the three CC0 models (heads, hair,
 * tops, bottoms, shoes) in one shared space (bind pose, meters, +Y up, face toward +Z), plus
 * the two skeletons (male / female) the pieces can be fitted to.
 */

/** Bone names lose their dots when loaded ("UpperLeg.L" -> "UpperLegL"). */
export function boneKey(name: string): string {
  return name.replace(/[.\s_]/g, '');
}

export interface Rig {
  id: 'male' | 'female';
  template: CharacterTemplate;
  /** Merged mesh space -> bind-pose world (meters). */
  F: THREE.Matrix4;
  Finv: THREE.Matrix4;
  /** Joint keys in skin-index order. */
  joints: string[];
  /** Joint index by key. */
  jointIndex: Map<string, number>;
  /** Bind-pose joint positions (world, meters) by key. */
  at: Map<string, THREE.Vector3>;
  /** Inverse bind matrices of the merged mesh (bone space <- mesh space). */
  boneInverses: THREE.Matrix4[];
}

export interface Piece {
  rig: Rig;
  part: string;
  material: string;
  /** Linear material color. */
  color: [number, number, number];
  pos: Float32Array;
  nrm: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Triangle indices into this piece's own vertices. */
  index: Uint32Array;
  /** Per-vertex brightness relative to the material color (per-vertex tints like faded denim). */
  shade: Float32Array;
}

export class PartLibrary {
  readonly rigs = new Map<string, Rig>();
  /** Pieces by `${template}:${part}:${material}`. */
  private pieces = new Map<string, Piece>();

  constructor(templates: CharacterTemplate[]) {
    for (const t of templates) {
      const mesh = t.scene.getObjectByName(CHARACTER_MESH) as THREE.SkinnedMesh | undefined;
      if (!mesh || !t.merged) continue;
      t.scene.updateMatrixWorld(true);
      const F = mesh.matrixWorld.clone().multiply(mesh.bindMatrix);
      const rig: Rig = {
        id: t.name === 'punk' ? 'female' : 'male',
        template: t,
        F,
        Finv: F.clone().invert(),
        joints: mesh.skeleton.bones.map((b) => boneKey(b.name)),
        jointIndex: new Map(),
        at: new Map(),
        boneInverses: mesh.skeleton.boneInverses,
      };
      rig.joints.forEach((k, i) => {
        rig.jointIndex.set(k, i);
        rig.at.set(k, new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()).applyMatrix4(F));
      });
      this.rigs.set(t.name, rig);
      for (const pc of t.merged.pieces) this.pieces.set(`${t.name}:${pc.part}:${pc.material}`, extractPiece(rig, mesh.geometry, pc));
    }
  }

  /** The skeleton a body type is built on (the punk model carries the feminine proportions). */
  rigFor(bodyType: string): Rig | null {
    return (bodyType === 'fem' ? this.rigs.get('punk') : this.rigs.get('hoodie') ?? this.rigs.get('casual')) ?? this.rigs.values().next().value ?? null;
  }

  piece(template: string, part: string, material: string): Piece | null {
    return this.pieces.get(`${template}:${part}:${material}`) ?? null;
  }

  get ready(): boolean {
    return this.rigs.size > 0;
  }
}

function extractPiece(rig: Rig, g: THREE.BufferGeometry, pc: CharacterPiece): Piece {
  const n = pc.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), shade = new Float32Array(n);
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const nm = new THREE.Matrix3().getNormalMatrix(rig.F);
  const v = new THREE.Vector3();
  const lum = (r: number, gg: number, b: number) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const base = Math.max(1e-4, lum(...pc.color));
  for (let i = 0; i < n; i++) {
    const s = pc.start + i;
    v.fromBufferAttribute(P, s).applyMatrix4(rig.F);
    pos.set([v.x, v.y, v.z], i * 3);
    v.fromBufferAttribute(N, s).applyMatrix3(nm).normalize();
    nrm.set([v.x, v.y, v.z], i * 3);
    shade[i] = C ? Math.min(1.6, lum(C.getX(s), C.getY(s), C.getZ(s)) / base) : 1;
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = SI.getComponent(s, k);
      skinWeight[i * 4 + k] = SW.getComponent(s, k);
    }
  }
  const index = new Uint32Array(pc.indexCount);
  const src = g.index!.array;
  for (let i = 0; i < pc.indexCount; i++) index[i] = src[pc.indexStart + i] - pc.start;
  return { rig, part: pc.part, material: pc.material, color: pc.color, pos, nrm, skinIndex, skinWeight, index, shade };
}

/**
 * Splits a piece into connected parts (vertices at the same spot count as connected, so UV
 * seams do not split a part). Returns one triangle list per part.
 */
export function components(p: Piece): Uint32Array[] {
  const n = p.pos.length / 3;
  const parent = new Int32Array(n).map((_v, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const byPos = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
    const j = byPos.get(key);
    if (j === undefined) byPos.set(key, i);
    else union(i, j);
  }
  for (let t = 0; t < p.index.length; t += 3) {
    union(p.index[t], p.index[t + 1]);
    union(p.index[t], p.index[t + 2]);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < p.index.length; t += 3) {
    const r = find(p.index[t]);
    let list = groups.get(r);
    if (!list) groups.set(r, (list = []));
    list.push(p.index[t], p.index[t + 1], p.index[t + 2]);
  }
  return [...groups.values()].map((l) => Uint32Array.from(l));
}

/** Centroid of the vertices used by a triangle list. */
export function centroid(p: Piece, tris: Uint32Array): THREE.Vector3 {
  const c = new THREE.Vector3();
  const seen = new Set<number>();
  for (const i of tris) {
    if (seen.has(i)) continue;
    seen.add(i);
    c.x += p.pos[i * 3];
    c.y += p.pos[i * 3 + 1];
    c.z += p.pos[i * 3 + 2];
  }
  return c.multiplyScalar(1 / Math.max(1, seen.size));
}
