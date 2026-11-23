/**
 * Adapter between an auto-rigged one-piece character (Mixamo-style bone names) and the game's
 * character rig: names, a sole probe for standing it on the ground, and clip sampling.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const CENTER_BONES: Record<string, string> = {
  Hips: 'Body', Spine: 'Abdomen', Spine1: 'Torso', Spine2: 'Chest', Neck: 'Neck', Head: 'Head', HeadTop_End: 'HeadTopEnd', headfront: 'HeadFront',
};
const SIDE_BONES: Record<string, string> = {
  Shoulder: 'Shoulder', Arm: 'UpperArm', ForeArm: 'LowerArm', Hand: 'Wrist',
  UpLeg: 'UpperLeg', Leg: 'LowerLeg', Foot: 'Foot', ToeBase: 'FootToe', Toe_End: 'FootToeEnd',
};
/** What the animation system needs from a rig. */
const REQUIRED_CENTER = ['Body', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head'];
const REQUIRED_SIDE = ['Shoulder', 'UpperArm', 'LowerArm', 'Wrist', 'UpperLeg', 'LowerLeg', 'Foot', 'Index2', 'Middle2', 'Pinky2'];

/**
 * The game's name for a file bone, or null for a bone it does not know. The game counts a finger
 * from the bone inside the palm, so a file's knuckle (finger joint 1) is the game's joint 2.
 */
function gameName(fileName: string): string | null {
  const n = fileName.replace(/^mixamorig:?/, '');
  if (CENTER_BONES[n]) return CENTER_BONES[n];
  const m = /^(Left|Right)(.+)$/.exec(n);
  if (!m) return null;
  const side = m[1][0];
  if (SIDE_BONES[m[2]]) return SIDE_BONES[m[2]] + side;
  const finger = /^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/.exec(m[2]);
  if (!finger) return null;
  return `${finger[1]}${Number(finger[2]) + (finger[1] === 'Thumb' ? 0 : 1)}${side}`;
}

/**
 * Renames a freshly loaded rig's bones to the game's. Files differ in their extra auto-rig
 * bones, so those take their parent's name (which also keeps them in the same half of the
 * lower / upper body animation split). Returns file name -> game name, for the clips' tracks.
 */
export function renameBones(scene: THREE.Object3D): Map<string, string> {
  const names = new Map<string, string>();
  const have = new Set<string>();
  let extra = 0;
  // parents come before their children
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    let to = gameName(o.name);
    if (!to || have.has(to)) to = `${o.parent?.name ?? 'Bone'}Extra${extra++}`;
    names.set(o.name, to);
    have.add(to);
    o.name = to;
  });
  const missing = [...REQUIRED_CENTER, ...REQUIRED_SIDE.flatMap((n) => [`${n}L`, `${n}R`])].filter((n) => !have.has(n));
  if (missing.length) throw new Error(`the skeleton is missing ${missing.join(', ')}`);
  return names;
}

export function skinnedMeshOf(scene: THREE.Object3D): THREE.SkinnedMesh {
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error('there is no skinned mesh');
  return mesh;
}

export function bonesByName(scene: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.set(o.name, o);
  });
  return out;
}

/** Plays one clip on a scratch copy of a character, for measuring it. */
export class ClipSampler {
  readonly scene: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Map<string, THREE.Object3D>;
  private mixer: THREE.AnimationMixer;

  constructor(template: THREE.Object3D, private clip: THREE.AnimationClip) {
    this.scene = cloneSkinned(template);
    this.mesh = skinnedMeshOf(this.scene);
    this.bones = bonesByName(this.scene);
    this.mixer = new THREE.AnimationMixer(this.scene);
    this.mixer.clipAction(clip).play();
  }

  /** Poses the copy at `u` (0..1) through the clip. */
  at(u: number): void {
    this.mixer.setTime(Math.min(u, 0.99999) * this.clip.duration);
    this.scene.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    this.mesh.skeleton.dispose();
  }
}

/** Directions (out of a boot, bind pose) whose furthest vertex can be the one touching the ground. */
function supportDirections(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let pitch = -100; pitch <= 100; pitch += 10) {
    for (const roll of [-30, -12, 0, 12, 30]) {
      out.push(new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitch), 0, THREE.MathUtils.degToRad(roll), 'XZY')));
    }
  }
  return out;
}

/**
 * The few boot vertices that can ever be the lowest one, kept in the space of the bones that
 * move them. Finding the ground contact of a blended, IK'd pose costs a few dozen transforms.
 */
export class SoleProbe {
  /** Where each point's influences start (one more entry than there are points). */
  private start: Uint16Array;
  private joint: Uint16Array;
  /** Per influence: weight, then the point in that bone's space. */
  private data: Float32Array;
  /** The first point of the right boot. */
  private split = 0;

  constructor(mesh: THREE.SkinnedMesh) {
    const bones = mesh.skeleton.bones, inverses = mesh.skeleton.boneInverses;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const starts = [0], joints: number[] = [], data: number[] = [];
    const v = new THREE.Vector3(), local = new THREE.Vector3();
    for (const side of ['L', 'R']) {
      const lower = bones.find((b) => b.name === `LowerLeg${side}`);
      if (!lower) throw new Error(`no LowerLeg${side} to find the sole with`);
      const below = new Set<number>();
      lower.traverse((o) => {
        if (o !== lower) below.add(bones.indexOf(o as THREE.Bone));
      });
      const boot: number[] = [];
      for (let i = 0; i < position.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (below.has(skinIndex.getComponent(i, k))) w += skinWeight.getComponent(i, k);
        if (w > 0.5) boot.push(i);
      }
      if (!boot.length) throw new Error(`no vertices follow the ${side} foot`);
      const picked = new Set<number>();
      for (const d of supportDirections()) {
        let best = boot[0], far = -Infinity;
        for (const i of boot) {
          const dot = v.fromBufferAttribute(position, i).dot(d);
          if (dot > far) {
            far = dot;
            best = i;
          }
        }
        picked.add(best);
      }
      if (side === 'R') this.split = starts.length - 1;
      for (const i of picked) {
        v.fromBufferAttribute(position, i);
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(i, k);
          if (w <= 0) continue;
          const j = skinIndex.getComponent(i, k);
          local.copy(v).applyMatrix4(inverses[j]);
          joints.push(j);
          data.push(w, local.x, local.y, local.z);
        }
        starts.push(joints.length);
      }
    }
    this.start = Uint16Array.from(starts);
    this.joint = Uint16Array.from(joints);
    this.data = Float32Array.from(data);
  }

  /** The lowest point of the soles in world space. The leg bones' world matrices must be current. */
  lowest(bones: readonly THREE.Bone[]): number {
    let low = Infinity;
    for (let p = 0; p + 1 < this.start.length; p++) {
      let y = 0;
      for (let i = this.start[p]; i < this.start[p + 1]; i++) {
        const e = bones[this.joint[i]].matrixWorld.elements, d = i * 4;
        y += this.data[d] * (e[1] * this.data[d + 1] + e[5] * this.data[d + 2] + e[9] * this.data[d + 3] + e[13]);
      }
      if (y < low) low = y;
    }
    return low;
  }

  /** Every point in world space (x, y, z each). The leg bones' world matrices must be current. */
  points(bones: readonly THREE.Bone[]): Float32Array {
    const out = new Float32Array((this.start.length - 1) * 3);
    for (let p = 0; p + 1 < this.start.length; p++) {
      for (let i = this.start[p]; i < this.start[p + 1]; i++) {
        const e = bones[this.joint[i]].matrixWorld.elements, d = i * 4, w = this.data[d];
        for (let k = 0; k < 3; k++) out[p * 3 + k] += w * (e[k] * this.data[d + 1] + e[4 + k] * this.data[d + 2] + e[8 + k] * this.data[d + 3] + e[12 + k]);
      }
    }
    return out;
  }

  /** Which boot is on the ground: 0 = left, 1 = right. */
  lowerBoot(bones: readonly THREE.Bone[]): number {
    const at = this.points(bones);
    let low = 0;
    for (let p = 0; p < at.length / 3; p++) if (at[p * 3 + 1] < at[low * 3 + 1]) low = p;
    return low < this.split ? 0 : 1;
  }

  /**
   * Halfway between the two soles on the ground plane (x, z), world space. Each boot's own
   * middle, so a turned-out boot does not pull the body sideways.
   */
  middle(bones: readonly THREE.Bone[], out: THREE.Vector2): THREE.Vector2 {
    const at = this.points(bones);
    out.set(0, 0);
    for (const [from, to] of [[0, this.split], [this.split, at.length / 3]]) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let p = from; p < to; p++) {
        minX = Math.min(minX, at[p * 3]);
        maxX = Math.max(maxX, at[p * 3]);
        minZ = Math.min(minZ, at[p * 3 + 2]);
        maxZ = Math.max(maxZ, at[p * 3 + 2]);
      }
      out.x += (minX + maxX) / 4;
      out.y += (minZ + maxZ) / 4;
    }
    return out;
  }
}
