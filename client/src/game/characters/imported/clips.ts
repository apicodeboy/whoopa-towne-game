/**
 * Clips for the one-piece characters.
 *
 *  - Idle, Walk and Run are the file's own: renamed to the game's bones and centered on the
 *    player's origin. Nothing else about their motion changes (they have no root motion).
 *  - The states those files have no clip for (backpedal, strafes, aiming, firing, punch, death)
 *    are retargeted from the game's existing CC0 clips. They did not come with the characters.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterTemplate } from '../../assets';
import { ClipSampler, bonesByName, skinnedMeshOf, type SoleProbe } from './rig';

export const SUPPLIED_CLIPS = ['Idle', 'Walk', 'Run'] as const;
export const BORROWED_CLIPS = [
  'Idle_Gun_Pointing', 'Idle_Gun', 'Idle_Gun_Shoot', 'Run_Shoot', 'Run_Back', 'Run_Left', 'Run_Right', 'Punch_Right', 'Death',
] as const;
/** Clips with a moment where both feet are off the ground. */
export const FLIGHT_CLIPS = ['Run', 'Run_Back', 'Run_Left', 'Run_Right'] as const;

const SAMPLE_FPS = 30;

/** The file's clips on the game's bone names, without the tracks that never move. */
export function adoptClips(animations: readonly THREE.AnimationClip[], names: ReadonlyMap<string, string>, scene: THREE.Object3D): Map<string, THREE.AnimationClip> {
  const bones = bonesByName(scene);
  const out = new Map<string, THREE.AnimationClip>();
  for (const key of SUPPLIED_CLIPS) {
    // ("Idle" in the file; some tools show it as "Idle_SmartRigArmature")
    const src = animations.find((c) => c.name.split('_')[0] === key);
    if (!src) throw new Error(`there is no ${key} clip`);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of src.tracks) {
      const dot = track.name.lastIndexOf('.');
      const bone = bones.get(names.get(track.name.slice(0, dot)) ?? '');
      if (!bone) continue;
      const prop = track.name.slice(dot + 1);
      // the files key all three properties of every bone: only the rotations (and the hips) move
      const rest = prop === 'scale' ? bone.scale : prop === 'position' && bone.name !== 'Body' ? bone.position : null;
      if (rest) {
        const still = track.values.every((v, i) => Math.abs(v - rest.getComponent(i % 3)) < 0.0015);
        if (still) continue;
      }
      const t = track.clone();
      t.name = `${bone.name}.${prop}`;
      tracks.push(t);
    }
    out.set(key, new THREE.AnimationClip(key, src.duration, tracks));
  }
  return out;
}

/** Moves a clip's hips so the middle of its soles averages out on the character's origin. */
export function centerFeet(scene: THREE.Object3D, clip: THREE.AnimationClip, soles: SoleProbe): void {
  const hips = clip.tracks.find((t) => t.name === 'Body.position');
  if (!hips) return;
  const s = new ClipSampler(scene, clip);
  const sum = new THREE.Vector2(), mid = new THREE.Vector2();
  const N = 32;
  for (let i = 0; i < N; i++) {
    s.at(i / N);
    sum.add(soles.middle(s.mesh.skeleton.bones, mid));
  }
  s.dispose();
  sum.divideScalar(N);
  for (let i = 0; i < hips.values.length; i += 3) {
    hips.values[i] -= sum.x;
    hips.values[i + 2] -= sum.y;
  }
}

/**
 * How far a running clip's body hovers over its current stride's contact (per phase): the lowest
 * the soles get around that moment. Subtracting it puts each footfall on the ground and leaves
 * the flight between footfalls alone.
 */
export function contactCurve(scene: THREE.Object3D, clip: THREE.AnimationClip, soles: SoleProbe): Float32Array {
  const N = 64, reach = Math.round(N * 0.22);
  const s = new ClipSampler(scene, clip);
  const low: number[] = [];
  for (let i = 0; i < N; i++) {
    s.at(i / N);
    low.push(soles.lowest(s.mesh.skeleton.bones));
  }
  s.dispose();
  const floor = low.map((_, i) => {
    let m = Infinity;
    for (let k = -reach; k <= reach; k++) m = Math.min(m, low[(i + k + N) % N]);
    return m;
  });
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += floor[(i + k + N) % N];
    curve[i] = sum / 5;
  }
  return curve;
}

export function readCurve(curve: Float32Array, phase: number): number {
  const at = phase * curve.length, i = Math.floor(at), f = at - i;
  return curve[i % curve.length] * (1 - f) + curve[(i + 1) % curve.length] * f;
}

/**
 * Ground covered by one cycle: how fast the ankle over the standing boot goes back while that
 * boot is flat (the upper end of its speeds: rolling onto the heel and toe slows the ankle down,
 * and speeds the tip of the sole up, so neither the mean nor the lowest vertex will do).
 */
export function strideOf(scene: THREE.Object3D, clip: THREE.AnimationClip, soles: SoleProbe): number {
  const N = 96, step = clip.duration / N;
  const s = new ClipSampler(scene, clip);
  const ankles = [s.bones.get('FootL')!, s.bones.get('FootR')!];
  const standing: number[] = [], z: number[][] = [];
  for (let i = 0; i <= N; i++) {
    s.at(i / N);
    standing.push(soles.lowerBoot(s.mesh.skeleton.bones));
    z.push(ankles.map((a) => a.matrixWorld.elements[14]));
  }
  s.dispose();
  const speeds: number[] = [];
  for (let i = 0; i < N; i++) {
    const side = standing[i];
    const speed = -(z[i + 1][side] - z[i][side]) / step;
    if (speed > 0.2) speeds.push(speed);
  }
  speeds.sort((a, b) => a - b);
  return speeds.length ? speeds[Math.floor(speeds.length * 0.8)] * clip.duration : 0;
}

/** A bone's mean orientation over a clip, in the model's own space. */
export function meanOrientation(scene: THREE.Object3D, clip: THREE.AnimationClip, name: string): THREE.Quaternion {
  const s = new ClipSampler(scene, clip);
  const bone = s.bones.get(name)!;
  const first = new THREE.Quaternion(), q = new THREE.Quaternion(), sum = new THREE.Vector4();
  const N = 24;
  for (let i = 0; i < N; i++) {
    s.at(i / N);
    bone.getWorldQuaternion(q);
    if (i === 0) first.copy(q);
    const sign = q.dot(first) < 0 ? -1 : 1;
    sum.x += q.x * sign;
    sum.y += q.y * sign;
    sum.z += q.z * sign;
    sum.w += q.w * sign;
  }
  s.dispose();
  return new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize();
}

// ------------------------------------------------------------------ retargeting
/** A bone that follows a source bone; `to` = the joint its segment points at. */
interface Link {
  from: string;
  to?: string;
}

function linksByBone(): Map<string, Link> {
  const out = new Map<string, Link>([['Body', { from: 'Hips' }]]);
  for (const b of ['Abdomen', 'Torso', 'Chest', 'Neck', 'Head']) out.set(b, { from: b });
  for (const s of ['L', 'R']) {
    out.set(`Shoulder${s}`, { from: `Shoulder${s}` });
    out.set(`UpperArm${s}`, { from: `UpperArm${s}`, to: `LowerArm${s}` });
    out.set(`LowerArm${s}`, { from: `LowerArm${s}`, to: `Wrist${s}` });
    out.set(`Wrist${s}`, { from: `Wrist${s}` });
    out.set(`UpperLeg${s}`, { from: `UpperLeg${s}`, to: `LowerLeg${s}` });
    out.set(`LowerLeg${s}`, { from: `LowerLeg${s}`, to: `Foot${s}` });
    out.set(`Foot${s}`, { from: `Foot${s}` });
  }
  return out;
}

interface Rest {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

/** Where in a cycle the left foot is furthest forward (0..1). */
function strideMark(scene: THREE.Object3D, clip: THREE.AnimationClip): number {
  const s = new ClipSampler(scene, clip);
  const foot = s.bones.get('FootL');
  let best = 0, far = -Infinity;
  const v = new THREE.Vector3(), N = 48;
  for (let i = 0; foot && i < N; i++) {
    s.at(i / N);
    const z = foot.getWorldPosition(v).z;
    if (z > far) {
      far = z;
      best = i / N;
    }
  }
  s.dispose();
  return best;
}

/** How closed the hands are in a borrowed clip (the source clips' fingers do not fit these hands). */
function fingerCurl(clip: string): number {
  return clip === 'Punch_Right' ? 1.1 : clip === 'Death' ? 0.4 : 0.55;
}

/**
 * Rebuilds the game's clips on a character's skeleton. Both rigs bind as T-poses facing +Z, so
 * each bone takes its source's turn away from the bind pose, and limb segments are then swung to
 * point the way the source's do (the source's feet are separate IK bones, not the shins' children).
 */
export function borrowClips(scene: THREE.Object3D, run: THREE.AnimationClip, source: CharacterTemplate): Map<string, THREE.AnimationClip> {
  const out = new Map<string, THREE.AnimationClip>();
  const links = linksByBone();

  const from = cloneSkinned(source.scene);
  const fromMesh = skinnedMeshOf(from);
  const fromBones = bonesByName(from);
  const fromRest = new Map<string, Rest>();
  fromMesh.skeleton.bones.forEach((b, i) => {
    const r: Rest = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    fromMesh.skeleton.boneInverses[i].clone().invert().decompose(r.p, r.q, new THREE.Vector3());
    fromRest.set(b.name, r);
  });

  scene.updateMatrixWorld(true);
  const bones = [...bonesByName(scene).values()];
  const rest = new Map<THREE.Object3D, Rest>();
  for (const b of bones) rest.set(b, { p: b.getWorldPosition(new THREE.Vector3()), q: b.getWorldQuaternion(new THREE.Quaternion()) });
  const hips = bones.find((b) => b.name === 'Body')!;
  const hipsRest = rest.get(hips)!;
  const hipsFrom = fromRest.get('Hips');
  if (!hipsFrom || !fromBones.has('Hips')) throw new Error('the animation source has no hips');
  const ratio = hipsRest.p.y / hipsFrom.p.y;

  // the direction each linked segment points at rest on the source
  const restDir = new Map<string, THREE.Vector3>();
  for (const [name, link] of links) {
    const a = fromRest.get(link.from), b = link.to ? fromRest.get(link.to) : null;
    if (a && b) restDir.set(name, b.p.clone().sub(a.p).normalize());
  }

  // finger joints close toward the palm (which faces down at rest)
  const curls: Array<{ bone: THREE.Object3D; axis: THREE.Vector3 }> = [];
  for (const b of bones) {
    if (!/^(Index|Middle|Ring|Pinky)[234][LR]$/.test(b.name)) continue;
    const child = b.children.find((c) => (c as THREE.Bone).isBone);
    if (!child) continue;
    const r = rest.get(b)!;
    const axis = rest.get(child)!.p.clone().sub(r.p).normalize().cross(new THREE.Vector3(0, -1, 0)).normalize();
    curls.push({ bone: b, axis: axis.applyQuaternion(r.q.clone().invert()) });
  }

  // the borrowed cycles are in step with the source's Run: shift them into step with this one's
  const sourceRun = source.clips.get('Run');
  const shift = sourceRun ? strideMark(source.scene, sourceRun) - strideMark(scene, run) : 0;

  const mixer = new THREE.AnimationMixer(from);
  const world = new Map<THREE.Object3D, THREE.Quaternion>(bones.map((b) => [b, new THREE.Quaternion()]));
  const turn = new THREE.Quaternion(), undo = new THREE.Quaternion(), swing = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), p = new THREE.Vector3();

  for (const name of BORROWED_CLIPS) {
    const clip = source.clips.get(name);
    if (!clip) continue;
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    const cyclic = name.startsWith('Run_');
    const N = Math.max(8, Math.ceil(clip.duration * SAMPLE_FPS));
    const times = new Float32Array(N + 1);
    const turns = new Map<THREE.Object3D, Float32Array>();
    for (const b of bones) if (links.has(b.name)) turns.set(b, new Float32Array((N + 1) * 4));
    const moves = new Float32Array((N + 1) * 3);
    for (let i = 0; i <= N; i++) {
      times[i] = (clip.duration * i) / N;
      let u = i / N;
      if (cyclic) u = (((u + shift) % 1) + 1) % 1;
      mixer.setTime(Math.min(u, 0.99999) * clip.duration);
      from.updateMatrixWorld(true);
      // (parents first: that is the order they were collected in)
      for (const bone of bones) {
        const parent = bone.parent!;
        parentQ.copy(world.get(parent) ?? parent.getWorldQuaternion(turn));
        const q = world.get(bone)!;
        const link = links.get(bone.name);
        const src = link ? fromBones.get(link.from) : undefined;
        const srcRest = link ? fromRest.get(link.from) : undefined;
        if (!link || !src || !srcRest) {
          q.copy(parentQ).multiply(bone.quaternion);
        } else {
          src.getWorldQuaternion(turn).multiply(undo.copy(srcRest.q).invert());
          const end = link.to ? fromBones.get(link.to) : undefined;
          const dir0 = restDir.get(bone.name);
          if (end && dir0) {
            end.getWorldPosition(a).sub(src.getWorldPosition(b2)).normalize().applyQuaternion(undo.copy(turn).invert());
            turn.multiply(swing.setFromUnitVectors(dir0, a));
          }
          q.copy(turn).multiply(rest.get(bone)!.q).normalize();
        }
        const keys = turns.get(bone);
        if (keys) undo.copy(parentQ).invert().multiply(q).normalize().toArray(keys, i * 4);
      }
      fromBones.get('Hips')!.getWorldPosition(p);
      p.set(hipsRest.p.x + (p.x - hipsFrom.p.x) * ratio, p.y * ratio, hipsRest.p.z + (p.z - hipsFrom.p.z) * ratio);
      hips.parent!.worldToLocal(p).toArray(moves, i * 3);
    }
    const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack('Body.position', times, moves)];
    for (const [bone, keys] of turns) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, keys));
    for (const c of curls) {
      const q = c.bone.quaternion.clone().multiply(swing.setFromAxisAngle(c.axis, fingerCurl(name)));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${c.bone.name}.quaternion`, [0, clip.duration], [...q.toArray(), ...q.toArray()]));
    }
    out.set(name, new THREE.AnimationClip(name, clip.duration, tracks));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(from);
  fromMesh.skeleton.dispose();
  return out;
}

/** A fallen body rests on the ground: lifts (or lowers) the death clip's hips frame by frame. */
export function layOnGround(scene: THREE.Object3D, clip: THREE.AnimationClip): void {
  const hips = clip.tracks.find((t) => t.name === 'Body.position');
  if (!hips) return;
  const s = new ClipSampler(scene, clip);
  const position = s.mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const lift: number[] = [];
  for (const t of hips.times) {
    s.at(t / clip.duration);
    s.mesh.skeleton.update();
    let low = Infinity;
    for (let i = 0; i < position.count; i += 4) low = Math.min(low, s.mesh.getVertexPosition(i, v).y);
    lift.push(-low);
  }
  s.dispose();
  lift.forEach((y, i) => (hips.values[i * 3 + 1] += y));
}
