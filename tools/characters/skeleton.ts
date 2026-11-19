/**
 * The Urban Ink skeleton: the CC0 source rig's armature (same bone names, hierarchy and rest
 * rotations, so every one of its animation clips plays on it unchanged) with grown-up
 * proportions: longer upper arms and wider shoulders than the chibi-ish source.
 *
 * All positions here are bind pose (T-pose), meters, +Y up, the character facing +Z, its left
 * toward +X.
 */
import { accessor, type Gltf } from './glb';

export type M4 = Float64Array; // column-major, like glTF
export type V3 = [number, number, number];

export const m4 = (): M4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
export function compose(t: number[], q: number[], s: number[]): M4 {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
export function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function invert(m: M4): M4 {
  const a = m, o = new Float64Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
export const posOf = (m: M4): V3 => [m[12], m[13], m[14]];

/** Bone names lose their dots at runtime ("UpperArm.L" -> "UpperArmL"); the generator uses the same keys. */
export const key = (name: string): string => name.replace(/[.\s_]/g, '');

export interface Joint {
  name: string;
  key: string;
  /** Index in the source file's node list. */
  node: number;
  /** Bind pose world matrix (meters, Y up). */
  bind: M4;
  pos: V3;
  parent: number; // joint index, -1 = none
}

export interface InkSkeleton {
  src: Gltf;
  joints: Joint[];
  byKey: Map<string, Joint>;
  /** Node indices of the source armature (CharacterArmature and everything under it). */
  armatureNodes: number[];
  armatureRoot: number;
  /** Local translations to write for nodes whose length changed (node index -> translation). */
  newTranslation: Map<number, number[]>;
  at(k: string): V3;
}

export interface Proportions {
  /** Upper arm length multiplier (shoulder joint -> elbow). */
  upperArm: number;
  /** Shoulder width multiplier (Shoulder bone -> shoulder joint). */
  shoulder: number;
  /** Hand size multiplier (every bone past the wrist; the source rig has cartoon-big hands). */
  hand: number;
}

export function loadSkeleton(src: Gltf, prop: Proportions): InkSkeleton {
  const nodes = src.json.nodes as any[];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => (parent[c] = i)));
  const local = (i: number) => compose(nodes[i].translation ?? [0, 0, 0], nodes[i].rotation ?? [0, 0, 0, 1], nodes[i].scale ?? [1, 1, 1]);
  const worldCache = new Map<number, M4>();
  const world = (i: number): M4 => {
    const hit = worldCache.get(i);
    if (hit) return hit;
    const w = parent[i] >= 0 ? mul(world(parent[i]), local(i)) : local(i);
    worldCache.set(i, w);
    return w;
  };
  const meshNode = nodes.findIndex((n) => n.mesh !== undefined && n.skin !== undefined);
  const M = world(meshNode);
  const skin = src.json.skins[nodes[meshNode].skin];
  const ibm = accessor(src, skin.inverseBindMatrices);
  const jointNodes: number[] = skin.joints;
  const joints: Joint[] = jointNodes.map((ni, j) => {
    const inv = Float64Array.from(ibm.slice(j * 16, j * 16 + 16));
    const bind = mul(M, invert(inv));
    return { name: nodes[ni].name, key: key(nodes[ni].name), node: ni, bind, pos: posOf(bind), parent: -1 };
  });
  const jointOfNode = new Map(jointNodes.map((ni, j) => [ni, j]));
  joints.forEach((jt) => {
    let p = parent[jt.node];
    while (p >= 0 && !jointOfNode.has(p)) p = parent[p];
    jt.parent = p >= 0 ? jointOfNode.get(p)! : -1;
  });
  const byKey = new Map(joints.map((j) => [j.key, j]));

  // ---- grown-up proportions: shift the arm chains in the T-pose and lengthen the bones ----
  const newTranslation = new Map<number, number[]>();
  const descendants = (j: number): number[] => {
    const out = [j];
    for (let k = 0; k < out.length; k++) joints.forEach((c, ci) => c.parent === out[k] && out.push(ci));
    return out;
  };
  const shift = (j: number, d: V3) => {
    for (const k of descendants(j)) {
      const b = joints[k].bind;
      b[12] += d[0]; b[13] += d[1]; b[14] += d[2];
      joints[k].pos = posOf(b);
    }
  };
  for (const side of ['L', 'R']) {
    const sh = byKey.get(`Shoulder${side}`)!, ua = byKey.get(`UpperArm${side}`)!, la = byKey.get(`LowerArm${side}`)!;
    const uaIdx = joints.indexOf(ua), laIdx = joints.indexOf(la);
    const dSh: V3 = [0, 1, 2].map((c) => (ua.pos[c] - sh.pos[c]) * (prop.shoulder - 1)) as V3;
    const dUa: V3 = [0, 1, 2].map((c) => (la.pos[c] - ua.pos[c]) * (prop.upperArm - 1)) as V3;
    shift(uaIdx, dSh);
    shift(laIdx, dUa);
    newTranslation.set(ua.node, (nodes[ua.node].translation ?? [0, 0, 0]).map((v: number) => v * prop.shoulder));
    newTranslation.set(la.node, (nodes[la.node].translation ?? [0, 0, 0]).map((v: number) => v * prop.upperArm));
    // the hand: every bone past the wrist moves toward it (local offsets scale the same way)
    const wr = byKey.get(`Wrist${side}`)!;
    const wIdx = joints.indexOf(wr);
    for (const d of descendants(wIdx)) {
      if (d === wIdx) continue;
      const jt = joints[d];
      const b = jt.bind;
      for (let c = 0; c < 3; c++) b[12 + c] = wr.pos[c] + (b[12 + c] - wr.pos[c]) * prop.hand;
      jt.pos = posOf(b);
      newTranslation.set(jt.node, (nodes[jt.node].translation ?? [0, 0, 0]).map((v: number) => v * prop.hand));
    }
  }

  // the armature: the node that is an ancestor of every joint and has no parent
  let root = jointNodes[0];
  while (parent[root] >= 0) root = parent[root];
  const armatureNodes: number[] = [];
  const walk = (i: number) => {
    armatureNodes.push(i);
    for (const c of nodes[i].children ?? []) if (nodes[c].mesh === undefined) walk(c);
  };
  walk(root);
  return {
    src, joints, byKey, armatureNodes, armatureRoot: root, newTranslation,
    at: (k: string) => {
      const j = byKey.get(k);
      if (!j) throw new Error(`no joint ${k}`);
      return j.pos;
    },
  };
}
