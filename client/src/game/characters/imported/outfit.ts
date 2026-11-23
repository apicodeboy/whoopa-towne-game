/**
 * Clothes for the one-piece models. Their own jacket and cargos are sculpted into the mesh, so any
 * other top or bottom comes from the game's clothing system (look/assemble.ts): the garment is built
 * on the custom character's body, then carried bone by bone onto the model's skeleton (each bone's
 * stretch of body stretched to the model's limb length and girth), and drawn with the model's own
 * head, hands and boots. Its arms, legs and neck come along with it (the model has none under its
 * jacket).
 */
import * as THREE from 'three';
import { SLOT } from '../look/meshKit';
import { PAINT_STRIDE } from '../look/palette';
import type { Assembled } from '../look/assemble';

/** Which joint each joint's segment points at (the same names on both skeletons). */
const SEGMENT_END: Record<string, string> = {
  Body: 'Abdomen', Hips: 'Abdomen', Abdomen: 'Torso', Torso: 'Chest', Chest: 'Neck', Neck: 'Head',
  ShoulderL: 'UpperArmL', UpperArmL: 'LowerArmL', LowerArmL: 'WristL',
  ShoulderR: 'UpperArmR', UpperArmR: 'LowerArmR', LowerArmR: 'WristR',
  UpperLegL: 'LowerLegL', LowerLegL: 'FootL', UpperLegR: 'LowerLegR', LowerLegR: 'FootR',
};
/** Joints whose frame is their parent segment's, carried to their own position (no segment of their own here). */
const END_OF: Record<string, string> = { Head: 'Neck', WristL: 'LowerArmL', WristR: 'LowerArmR', FootL: 'LowerLegL', FootR: 'LowerLegR' };
/** The model's skeleton calls the custom character's pelvis joint by its hips' name. */
const ALIAS: Record<string, string> = { Hips: 'Body', Root: 'Body' };

/** How much wider and deeper than the custom character's each part of the model is ([width, depth]). */
export interface Girth {
  torso: [number, number];
  arm: [number, number];
  leg: [number, number];
  neck: [number, number];
}
// (the hips and legs share one girth: layers of clothing there must keep their order)
export const DEFAULT_GIRTH: Girth = { torso: [1.06, 0.92], arm: [1.15, 1.15], leg: [1.06, 0.92], neck: [1.35, 1.35] };
/** The torso's joints move as one piece (pelvis to neck): squeezing each vertebra by its own ratio bulges the belly. */
const TORSO = new Set(['Body', 'Hips', 'Root', 'Abdomen', 'Torso', 'Chest']);

function girthOf(joint: string, g: Girth): [number, number] {
  if (/^(Body|Hips|Root)$/.test(joint)) return g.leg;
  if (/Arm|Shoulder|Wrist/.test(joint)) return g.arm;
  if (/Leg|Foot/.test(joint)) return g.leg;
  if (/Neck|Head/.test(joint)) return g.neck;
  return g.torso;
}

/** A segment frame: origin at the joint, X along the segment, Y toward the front, Z = X x Y. */
function frame(origin: THREE.Vector3, end: THREE.Vector3): THREE.Matrix4 {
  const x = end.clone().sub(origin).normalize();
  const fwd = new THREE.Vector3(0, 0, 1);
  const y = fwd.clone().addScaledVector(x, -fwd.dot(x));
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(x, -x.y);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

export interface Carry {
  /** Per source joint index: the transform (source bind world -> model bind world), and the model bone index. */
  mats: THREE.Matrix4[];
  normals: THREE.Matrix3[];
  target: number[];
}

/**
 * The bone-by-bone transforms from the custom character's skeleton (bind pose, meters) to the
 * model's: each segment is stretched along itself to the model's length and around itself by the
 * girth, then placed on the model's segment.
 */
export function carryTransforms(sourceJoints: readonly string[], sourceAt: ReadonlyMap<string, THREE.Vector3>, targetBones: readonly THREE.Object3D[], girth: Girth = DEFAULT_GIRTH, bootTop?: number): Carry {
  const targetAt = new Map<string, THREE.Vector3>();
  const targetIndex = new Map<string, number>();
  targetBones.forEach((b, i) => {
    targetAt.set(b.name, b.getWorldPosition(new THREE.Vector3()));
    targetIndex.set(b.name, i);
  });
  // the custom character's ankle joint is down at its sole: on the model it goes to the top of the
  // boots, so pant legs come down into them (not to the model's ankle, high inside the boot)
  if (bootTop !== undefined) {
    for (const f of ['FootL', 'FootR']) {
      const at = targetAt.get(f);
      if (at) targetAt.set(f, new THREE.Vector3(at.x, bootTop - 0.01, at.z));
    }
  }
  const mats: THREE.Matrix4[] = [], normals: THREE.Matrix3[] = [], target: number[] = [];
  const spine = targetIndex.get('Body') ?? 0;
  for (const j of sourceJoints) {
    const own = ALIAS[j] ?? j;
    const torso = TORSO.has(j);
    const segJoint = torso ? 'Hips' : SEGMENT_END[j] ? j : END_OF[j];
    const seg = torso ? 'Neck' : segJoint ? SEGMENT_END[segJoint] : undefined;
    const sa = segJoint && (sourceAt.get(segJoint) ?? sourceAt.get('Body')), sb = seg && sourceAt.get(seg);
    const ta = segJoint && targetAt.get(ALIAS[segJoint] ?? segJoint), tb = seg && targetAt.get(seg);
    target.push(targetIndex.get(own) ?? spine);
    if (!sa || !sb || !ta || !tb) {
      mats.push(new THREE.Matrix4());
      normals.push(new THREE.Matrix3());
      continue;
    }
    const fs = frame(sa, sb), ft = frame(ta, tb);
    const along = ta.distanceTo(tb) / Math.max(1e-4, sa.distanceTo(sb));
    const [wide, deep] = girthOf(j, girth);
    // (frame axes: along the segment, to the front, to the side)
    const s = new THREE.Matrix4().makeScale(along, deep, wide);
    const m = ft.clone().multiply(s).multiply(fs.clone().invert());
    mats.push(m);
    normals.push(new THREE.Matrix3().getNormalMatrix(m));
  }
  return { mats, normals, target };
}

/** What the clothing system's look keeps on the model. */
export interface Keep {
  /** The top (and the arms, neck and chest under it). */
  top: boolean;
  /** The bottom (and the legs under it). */
  bottom: boolean;
  /** Bind-pose height (meters, on the custom character) between the two. */
  waistY: number;
  /** Neck skin up to this height (on the custom character) stays, to meet the model's head. */
  neckTopY: number;
  /** Pant legs widen from `from` down to `to` (model meters) just enough to cover each boot's opening. */
  flare?: { from: number; to: number; boots: BootTops };
}

/** The model's boot openings: per side, the middle and the radius around it by angle. */
export interface BootTops {
  center: [THREE.Vector3, THREE.Vector3];
  radius: [Float32Array, Float32Array];
}
const BOOT_ANGLES = 24;
const angleBin = (dx: number, dz: number) => Math.floor(((Math.atan2(dx, dz) / (Math.PI * 2)) + 0.5) * BOOT_ANGLES) % BOOT_ANGLES;

/** Measures the boot openings: the boots' outline just under where the pants end (bind pose). */
export function bootTops(mesh: THREE.SkinnedMesh, isBoot: (i: number) => boolean, top: number): BootTops {
  const pos = mesh.geometry.attributes.position;
  const sums = [new THREE.Vector3(), new THREE.Vector3()], counts = [0, 0];
  const pick: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (!isBoot(i) || y < top - 0.05 || y > top) continue;
    const side = pos.getX(i) > 0 ? 0 : 1;
    sums[side].add(new THREE.Vector3(pos.getX(i), 0, pos.getZ(i)));
    counts[side]++;
    pick.push(i);
  }
  const center: [THREE.Vector3, THREE.Vector3] = [sums[0].divideScalar(Math.max(1, counts[0])), sums[1].divideScalar(Math.max(1, counts[1]))];
  const radius: [Float32Array, Float32Array] = [new Float32Array(BOOT_ANGLES), new Float32Array(BOOT_ANGLES)];
  for (const i of pick) {
    const side = pos.getX(i) > 0 ? 0 : 1, c = center[side];
    const dx = pos.getX(i) - c.x, dz = pos.getZ(i) - c.z, a = angleBin(dx, dz);
    radius[side][a] = Math.max(radius[side][a], Math.hypot(dx, dz));
  }
  // (an empty direction takes its neighbors')
  for (const r of radius) for (let a = 0; a < BOOT_ANGLES; a++) if (!r[a]) r[a] = Math.max(r[(a + 1) % BOOT_ANGLES], r[(a + BOOT_ANGLES - 1) % BOOT_ANGLES]);
  return { center, radius };
}

export interface CarriedOutfit {
  geometry: THREE.BufferGeometry;
  /** Paint data and bind positions (meters, the custom character's) of the kept vertices, for painting. */
  paint: Float32Array;
  rigPos: Float32Array;
}

/**
 * The clothing system's body + clothes, without its head, hands and feet (the model brings its
 * own), and without the half the model wears its own garment on, carried onto the model.
 */
export function carryOutfit(built: Assembled, carry: Carry, keep: Keep): CarriedOutfit | null {
  const src = built.geometry, n = src.attributes.position.count;
  const si = src.attributes.skinIndex, sw = src.attributes.skinWeight, nrm = src.attributes.normal;
  const joints = built.rig.joints;
  const jointIs = (re: RegExp) => joints.map((j) => re.test(j));
  const isHead = jointIs(/^Head/), isHand = jointIs(/^(Wrist|Thumb|Index|Middle|Ring|Pinky|Hand)/), isFoot = jointIs(/^(Foot|Toe)/);
  const keepV = new Int32Array(n).fill(-1);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    let head = 0, hand = 0, foot = 0;
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(i, k), w = sw.getComponent(i, k);
      if (isHead[j]) head += w;
      if (isHand[j]) hand += w;
      if (isFoot[j]) foot += w;
    }
    const slot = built.paint[i * PAINT_STRIDE];
    const y = built.rigPos[i * 3 + 1];
    // (the neck stays up into the model's head: the model has no neck of its own under its collar)
    const neck = slot === SLOT.SKIN && y < keep.neckTopY;
    if ((head > 0.45 && !neck) || hand > 0.5 || slot === SLOT.SHOE) continue;
    if (foot > 0.5 && slot !== SLOT.BOTTOM) continue;
    const upper = y > keep.waistY;
    // the half the model wears its own garment on: its clothes and the skin under them go
    if (!keep.top && (upper || slot === SLOT.TOP || slot === SLOT.CREW)) continue;
    if (!keep.bottom && (!upper || slot === SLOT.BOTTOM || slot === SLOT.BELT) && slot !== SLOT.TOP) continue;
    keepV[i] = kept++;
  }
  if (!kept) return null;

  const pos = new Float32Array(kept * 3), nor = new Float32Array(kept * 3);
  const sIdx = new Uint16Array(kept * 4), sWgt = new Float32Array(kept * 4);
  const paint = new Float32Array(kept * PAINT_STRIDE), rigPos = new Float32Array(kept * 3);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3();
  // (the clothing system's normals are in its merged mesh space: to bind world first)
  const toWorldN = new THREE.Matrix3().getNormalMatrix(built.rig.F);
  for (let i = 0; i < n; i++) {
    const o = keepV[i];
    if (o < 0) continue;
    p.fromArray(built.rigPos, i * 3);
    acc.set(0, 0, 0);
    accN.set(0, 0, 0);
    const wn = nv.fromBufferAttribute(nrm, i).applyMatrix3(toWorldN).normalize().clone();
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(i, k), w = sw.getComponent(i, k);
      if (w <= 0) continue;
      acc.addScaledVector(q.copy(p).applyMatrix4(carry.mats[j]), w);
      accN.addScaledVector(q.copy(wn).applyMatrix3(carry.normals[j]), w);
      sIdx[o * 4 + k] = carry.target[j];
      sWgt[o * 4 + k] = w;
    }
    acc.toArray(pos, o * 3);
    accN.normalize().toArray(nor, o * 3);
    paint.set(built.paint.subarray(i * PAINT_STRIDE, (i + 1) * PAINT_STRIDE), o * PAINT_STRIDE);
    rigPos.set(built.rigPos.subarray(i * 3, i * 3 + 3), o * 3);
  }
  // pant legs come down over the boots: each slice of a leg (by side, direction and height) is
  // widened as a whole until its outside clears the boot's opening (inner folds stay inside)
  const f = keep.flare;
  if (f) {
    const H = 0.02, slices = new Map<number, number>();
    const sliceOf = (x: number, y: number, z: number) => {
      const side = x > 0 ? 0 : 1, c = f.boots.center[side];
      return ((side * BOOT_ANGLES + angleBin(x - c.x, z - c.z)) * 64) + Math.max(0, Math.min(63, Math.floor(y / H)));
    };
    const legs: number[] = [];
    for (let o = 0; o < kept; o++) {
      const y = pos[o * 3 + 1];
      if (y >= f.from || paint[o * PAINT_STRIDE] !== SLOT.BOTTOM) continue;
      legs.push(o);
      const x = pos[o * 3], z = pos[o * 3 + 2], c = f.boots.center[x > 0 ? 0 : 1];
      const key = sliceOf(x, y, z), r = Math.hypot(x - c.x, z - c.z);
      slices.set(key, Math.max(slices.get(key) ?? 0, r));
    }
    for (const o of legs) {
      const x = pos[o * 3], y = pos[o * 3 + 1], z = pos[o * 3 + 2];
      const side = x > 0 ? 0 : 1, c = f.boots.center[side];
      const dx = x - c.x, dz = z - c.z;
      const outside = slices.get(sliceOf(x, y, z)) ?? 0;
      const want = f.boots.radius[side][angleBin(dx, dz)] + 0.02;
      if (outside < 1e-3 || outside >= want) continue;
      const t = Math.min(1, (f.from - y) / Math.max(0.01, f.from - f.to));
      // (a slice holding only inner folds near the middle would be blown out: capped)
      const k = 1 + (Math.min(1.5, want / outside) - 1) * t * t * (3 - 2 * t);
      pos[o * 3] = c.x + dx * k;
      pos[o * 3 + 2] = c.z + dz * k;
    }
  }

  const index: number[] = [];
  const srcIndex = src.index!;
  for (let t = 0; t < srcIndex.count; t += 3) {
    const a = keepV[srcIndex.getX(t)], b = keepV[srcIndex.getX(t + 1)], c = keepV[srcIndex.getX(t + 2)];
    if (a >= 0 && b >= 0 && c >= 0) index.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sWgt, 4));
  // everything else the clothing system's material reads (finish, baked creases, print coordinates)
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (['position', 'normal', 'skinIndex', 'skinWeight', 'color', 'smoothNormal'].includes(name)) continue;
    const size = attr.itemSize, out = new Float32Array(kept * size);
    for (let i = 0; i < n; i++) if (keepV[i] >= 0) for (let k = 0; k < size; k++) out[keepV[i] * size + k] = attr.getComponent(i, k);
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  geometry.setIndex(kept > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, paint, rigPos };
}
