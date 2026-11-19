import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Appearance } from '@shared/config/appearance';
import type { TeamId } from '@shared/config/crews';
import { approach, clamp, damp, lerp } from '@shared/math';
import { CHARACTER_MESH, type Assets, type CharacterTemplate, type ModelTemplate } from '../assets';
import { BALLOON_GRIP, type CharacterPose, type CharacterVisual, type HeldItem } from './characterTypes';
import { LOOK_MATERIAL, weldedNormals, type Assembled, type LookBuilder } from './look/assemble';
import { paint, paletteFor, printsFor } from './look/palette';
import { MOUTH_SCALE, createMouthAccessory, type MouthAccessory } from './mouthAccessories';
import { applyWeaponSkin } from './weaponSkins';

/** Target standing height of the model in meters (matches the gameplay capsule). */
const HEIGHT = 1.8;
/** How far the hips drop when fully crouched. */
const CROUCH_DROP = 0.52;
const LOWER_BONES = /^(Root|Body|Hips|UpperLeg|LowerLeg|Foot|PT)/;

/**
 * How each weapon model is held: real-world length (meters), where along its length the
 * hand grips it (0 = butt, 1 = muzzle), whether the model's muzzle already points down -Z
 * after normalization, and a vertical nudge.
 */
/** Hand grip tuning (rig-specific): how far the wrists turn in, and how the fingers curl. */
const WRIST_TWIST = 0.6;
const FINGER_AXIS = new THREE.Vector3(1, 0, 0);
const FINGER_CURL = 0.75;

/** Where the support hand holds each long gun (0 = butt, 1 = muzzle): handguard, pump, foregrip. */
const FOREGRIP: Partial<Record<HeldItem, number>> = { ar: 0.7, smg: 0.66, shotgun: 0.68, sniper: 0.66 };

const GUN_FIT: Record<string, { length: number; grip: number; muzzleNegZ: boolean; up: number }> = {
  // sized for the characters' stylized (short-armed) proportions
  // (a touch oversized, like most third-person shooters, so the gun reads past the body)
  ar: { length: 0.9, grip: 0.42, muzzleNegZ: true, up: 0.03 },
  smg: { length: 0.62, grip: 0.4, muzzleNegZ: false, up: 0.05 },
  shotgun: { length: 0.95, grip: 0.36, muzzleNegZ: false, up: 0.02 },
  pistol: { length: 0.27, grip: 0.2, muzzleNegZ: false, up: 0.04 },
  // no sniper model yet: the rifle, longer (placeholder art)
  sniper: { length: 1.1, grip: 0.38, muzzleNegZ: true, up: 0.035 },
  grenade: { length: 0.11, grip: 0.5, muzzleNegZ: true, up: 0 },
};

interface ClipSet {
  lower: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  full: Map<string, THREE.AnimationClip>;
  /** Uniform scale that makes the model HEIGHT tall. */
  scale: number;
  /** Ground covered by one cycle of the run / walk clips (meters, at HEIGHT), so feet do not slide. */
  strideRun: number;
  strideWalk: number;
}

/**
 * How far one cycle of a locomotion clip carries you: plays it on a scratch copy of the model
 * and measures how fast a planted foot sweeps backward.
 */
function measureStride(template: CharacterTemplate, clip: THREE.AnimationClip | undefined, scale: number): number {
  if (!clip) return 0;
  const scene = cloneSkinned(template.scene);
  let foot: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone && boneKey(o.name) === 'FootL') foot = o;
  });
  if (!foot) return 0;
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clip).play();
  const N = 72, ys: number[] = [], zs: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    mixer.setTime((clip.duration * i) / N);
    scene.updateMatrixWorld(true);
    (foot as THREE.Object3D).getWorldPosition(v);
    ys.push(v.y);
    zs.push(v.z);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const contact = minY + (maxY - minY) * 0.18;
  const step = clip.duration / N;
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) {
    if (ys[i] > contact || ys[i + 1] > contact) continue;
    sum += -(zs[i + 1] - zs[i]) / step; // a planted foot moves back (the model faces +Z)
    n++;
  }
  const speed = n ? (sum / n) * scale : 0;
  return speed > 0.4 && speed < 20 ? speed * clip.duration : 0;
}

const clipCache = new WeakMap<CharacterTemplate, ClipSet>();

/** Bone names lose their dots when loaded ("UpperLeg.L" -> "UpperLegL"). */
function boneKey(name: string): string {
  return name.replace(/[.\s_]/g, '');
}

function splitClips(template: CharacterTemplate): ClipSet {
  const cached = clipCache.get(template);
  if (cached) return cached;
  const lower = new Map<string, THREE.AnimationClip>();
  const upper = new Map<string, THREE.AnimationClip>();
  const full = new Map<string, THREE.AnimationClip>();
  for (const [name, clip] of template.clips) {
    const lo: THREE.KeyframeTrack[] = [];
    const up: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const node = track.name.slice(0, track.name.lastIndexOf('.'));
      (LOWER_BONES.test(node) ? lo : up).push(track);
    }
    lower.set(name, new THREE.AnimationClip(`${name}:lower`, clip.duration, lo));
    upper.set(name, new THREE.AnimationClip(`${name}:upper`, clip.duration, up));
    full.set(name, clip);
  }

  // measure the model in its bind pose to find the scale that makes it HEIGHT tall
  template.scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  template.scene.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    sm.skeleton.update(); // bone matrices are only filled in during rendering otherwise
    sm.computeBoundingBox();
    if (sm.boundingBox) box.union(tmp.copy(sm.boundingBox).applyMatrix4(sm.matrixWorld));
  });
  const h = box.isEmpty() ? HEIGHT : box.max.y - box.min.y;
  const scale = h > 0.01 ? HEIGHT / h : 1;
  const run = full.get('Run'), walk = full.get('Walk');
  const set: ClipSet = {
    lower, upper, full, scale,
    strideRun: measureStride(template, run, scale) || 5 * (run?.duration ?? 0.7),
    strideWalk: measureStride(template, walk, scale) || 2.6 * (walk?.duration ?? 1),
  };
  clipCache.set(template, set);
  return set;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
/** Scratch for the NPC wave (rotateBoneWorld uses _q2 / _q3 itself). */
const _qw = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _grip = new THREE.Vector3(BALLOON_GRIP.x, BALLOON_GRIP.y, BALLOON_GRIP.z);
const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _s = new THREE.Vector3();
const _el = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Ink outline width in meters (the comic-book line around every character). */
const OUTLINE = 0.0085;

/**
 * The outline: the character's own mesh again, pushed out along its normals and drawn
 * inside-out in black, so only a rim shows around the silhouette (and at folds).
 */
function outlineMaterial(width: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x0a0a0d, side: THREE.BackSide });
  const uniform = { value: width };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = uniform;
    // push along the welded normal (the flat-shaded mesh's own normals would tear the shell open)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;\nattribute vec3 smoothNormal;\nattribute float ink;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = smoothNormal;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\ttransformed += normalize(objectNormal) * uOutline * ink;');
  };
  m.customProgramCacheKey = () => 'ink-outline';
  return m;
}

/** Rotates a bone by a world-space rotation (keeps its children attached). */
function rotateBoneWorld(bone: THREE.Object3D, worldDelta: THREE.Quaternion): void {
  const parent = bone.parent!;
  parent.getWorldQuaternion(_q2);
  // local' = parentQ^-1 * delta * parentQ * local
  _q3.copy(_q2).invert().multiply(worldDelta).multiply(_q2);
  bone.quaternion.premultiply(_q3);
}

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
}

interface Arm {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  wrist: THREE.Object3D;
}

/**
 * Two-bone IK: turns an arm (shoulder -> elbow -> wrist) so the wrist reaches `target`, the
 * elbow bending toward `pole`. All in world space.
 */
function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3): void {
  arm.upper.getWorldPosition(_s);
  arm.lower.getWorldPosition(_el);
  arm.wrist.getWorldPosition(_wr);
  const l1 = _s.distanceTo(_el), l2 = _el.distanceTo(_wr);
  const dir = _t.copy(target).sub(_s);
  const d = clamp(dir.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
  dir.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const bend = _v3.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0);
  bend.normalize();
  const elbow = _v4.copy(_s).addScaledVector(dir, along).addScaledVector(bend, out);
  // upper arm: from where the elbow is to where it should be
  _q1.setFromUnitVectors(_v1.copy(_el).sub(_s).normalize(), _v2.copy(elbow).sub(_s).normalize());
  rotateBoneWorld(arm.upper, _q1);
  // forearm: point it at the (reachable) target
  arm.lower.getWorldPosition(_el);
  arm.wrist.getWorldPosition(_wr);
  const end = _v2.copy(_s).addScaledVector(dir, d);
  _q1.setFromUnitVectors(_v1.copy(_wr).sub(_el).normalize(), end.sub(_el).normalize());
  rotateBoneWorld(arm.lower, _q1);
}

/**
 * A rigged CC0 character (Quaternius) driven by its own animation clips:
 * legs and torso are animated separately so the character can run / strafe / backpedal
 * while the upper body keeps the weapon up, with procedural aim pitch, a crouch (hips
 * lowered + two-bone leg IK onto the animated feet), recoil, reload and death.
 *
 * The body itself comes from the Character Creator: the player's Appearance is assembled
 * into one skinned mesh (see look/assemble.ts) and painted with their colors.
 */
export class SkinnedCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: ClipSet;
  private assets: Assets;
  private builder: LookBuilder;
  private look: Appearance;
  private built: Assembled;
  private team: TeamId;
  /** The character's one mesh, and its own geometry (shared buffers + its own colors). */
  private skin: THREE.SkinnedMesh;
  private outline: THREE.SkinnedMesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private geometry: THREE.BufferGeometry;
  private colors: THREE.BufferAttribute;
  /** Expression preview (Character screen): morph weight now, target, and when it ends. */
  private expr = { id: 'neutral', w: 0, target: 0, until: 0 };

  // locomotion (lower body)
  private loIdle: THREE.AnimationAction;
  private loRun: THREE.AnimationAction;
  private loBack: THREE.AnimationAction;
  private loLeft: THREE.AnimationAction;
  private loRight: THREE.AnimationAction;
  // upper body
  private upAim: THREE.AnimationAction;
  private upAimRun: THREE.AnimationAction;
  private upSprint: THREE.AnimationAction;
  private upLow: THREE.AnimationAction;
  private upShoot: THREE.AnimationAction;
  /** Unarmed: relaxed arms standing, a punch for fists. */
  private upCalm: THREE.AnimationAction;
  private upPunch: THREE.AnimationAction;
  private loWalk: THREE.AnimationAction;
  /** The model has been tilted / spun (hanging, skydiving, flipping) and needs putting back. */
  private tilted = false;
  private death: THREE.AnimationAction;
  /** Relaxed full-body idle for menus (Character screen). */
  private calm: THREE.AnimationAction;
  private menuIdle = false;
  private all: THREE.AnimationAction[] = [];

  private body: THREE.Object3D | null;
  private spine: THREE.Object3D | null;
  private chest: THREE.Object3D | null;
  private head: THREE.Object3D | null;
  private handR: THREE.Object3D | null;
  private legs: Leg[] = [];
  private arms: { L: Arm | null; R: Arm | null } = { L: null, R: null };
  /** Finger joints per hand (curled into a grip around a gun). */
  private fingers: { L: THREE.Object3D[]; R: THREE.Object3D[] } = { L: [], R: [] };
  /** Seconds spent hanging from balloons (drives the swing); -1 = not hanging. */
  private hangT = -1;
  /**
   * Bones we adjust procedurally after the mixer runs, with the clean animated values.
   * The mixer only writes a property when its animated value changes, so without restoring
   * these every frame our adjustments would pile up on top of each other.
   */
  private touched: Array<{ bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }> = [];

  private gunMount = new THREE.Group();
  private gun: THREE.Object3D | null = null;
  private muzzle = new THREE.Object3D();
  private held: HeldItem = 'none';
  private mouth: MouthAccessory | null = null;

  private phase = Math.random();
  private moveT = 0;
  private sprintT = 0;
  private crouchT = 0;
  private lowT = 0;
  /** 0..1 blend from the hip hold to the aimed (shouldered) hold. */
  private aimT = 0;
  private shootT = 0;
  private recoil = 0;
  private flinch = 0;
  private throwT = -1;
  private dead = false;
  /** Animation time not yet applied because the character was off screen. */
  private skipped = 0;
  private wF = 1;
  private wB = 0;
  private wL = 0;
  private wR = 0;

  /** Use `SkinnedCharacter.create` (it returns null when the look cannot be built). */
  private constructor(built: Assembled, builder: LookBuilder, assets: Assets, team: TeamId, look: Appearance) {
    const template: CharacterTemplate = built.rig.template;
    this.assets = assets;
    this.builder = builder;
    this.look = look;
    this.built = built;
    this.team = team;
    this.clips = splitClips(template);
    this.model = cloneSkinned(template.scene);
    this.model.scale.setScalar(this.clips.scale * built.heightScale);
    // glTF models face +Z; the game's "forward" at yaw 0 is -Z
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    this.root.add(this.gunMount);
    this.gunMount.add(this.muzzle);

    this.skin = this.model.getObjectByName(CHARACTER_MESH) as THREE.SkinnedMesh;
    this.colors = new THREE.BufferAttribute(new Float32Array(built.paint.length / 5 * 3), 3);
    if (!built.geometry.attributes.smoothNormal) {
      const g = built.geometry;
      g.setAttribute('smoothNormal', new THREE.BufferAttribute(weldedNormals(g.attributes.position.array, g.attributes.normal.array), 3));
    }
    this.geometry = this.ownGeometry(null);
    this.skin.geometry = this.geometry;
    this.skin.material = LOOK_MATERIAL;
    // skinned bounds are not tracked per pose: cull with a fixed sphere that covers every pose
    // (standing, crouched, lying dead) around the character's feet instead
    this.root.updateMatrixWorld(true);
    const center = this.skin.worldToLocal(this.root.localToWorld(new THREE.Vector3(0, 0.9, 0)));
    this.skin.boundingSphere = new THREE.Sphere(center, 2.1 / this.skin.matrixWorld.getMaxScaleOnAxis());
    this.skin.frustumCulled = true;
    // the ink line (in the mesh's own units, which are scaled to make the model 1.8 m tall)
    this.outlineMat = outlineMaterial(OUTLINE / this.skin.matrixWorld.getMaxScaleOnAxis());
    this.outline = new THREE.SkinnedMesh(this.geometry, this.outlineMat);
    this.outline.visible = SkinnedCharacter.outlines;
    this.outline.bind(this.skin.skeleton, this.skin.bindMatrix);
    this.outline.boundingSphere = this.skin.boundingSphere;
    this.outline.castShadow = false;
    this.outline.receiveShadow = false;
    this.skin.parent!.add(this.outline);
    this.repaint();

    const bones = new Map<string, THREE.Object3D>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(boneKey(o.name), o);
    });
    const bone = (n: string) => bones.get(n) ?? null;
    this.body = bone('Body');
    this.spine = bone('Abdomen') ?? bone('Torso');
    this.chest = bone('Chest') ?? bone('Torso');
    this.head = bone('Head');
    this.handR = bone('WristR') ?? bone('LowerArmR');
    for (const side of ['L', 'R']) {
      const upper = bone(`UpperLeg${side}`), lower = bone(`LowerLeg${side}`), foot = bone(`Foot${side}`);
      if (upper && lower && foot) this.legs.push({ upper, lower, foot });
      const au = bone(`UpperArm${side}`), al = bone(`LowerArm${side}`), aw = bone(`Wrist${side}`);
      if (au && al && aw) this.arms[side as 'L' | 'R'] = { upper: au, lower: al, wrist: aw };
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
        // Urban Ink hands: the palm is the wrist's, the fingers bend at their knuckles (2..4)
        for (const j of built.rig.id === 'ink' ? [2, 3, 4] : [1, 2, 3]) {
          const b = bone(`${f}${j}${side}`);
          if (b) this.fingers[side as 'L' | 'R'].push(b);
        }
      }
    }

    const adjusted = new Set<THREE.Object3D>();
    for (const b of [this.body, this.spine, this.chest, this.head]) if (b) adjusted.add(b);
    for (const leg of this.legs) {
      adjusted.add(leg.upper);
      adjusted.add(leg.lower);
    }
    for (const arm of [this.arms.L, this.arms.R]) {
      if (!arm) continue;
      adjusted.add(arm.upper);
      adjusted.add(arm.lower);
      adjusted.add(arm.wrist);
    }
    for (const b of [...this.fingers.L, ...this.fingers.R]) adjusted.add(b);
    for (const b of adjusted) this.touched.push({ bone: b, q: b.quaternion.clone(), p: b.position.clone() });

    // something held in the mouth rides on the head bone, placed at the lips
    const accessory = this.head ? createMouthAccessory(look.mouthProp) : null;
    const headIdx = built.rig.jointIndex.get('Head');
    if (accessory && headIdx !== undefined) {
      // where it should be in the bind pose (out of the face = +Z there, -Z in mouth space)...
      const m = new THREE.Matrix4().compose(
        built.mouth.clone().add(new THREE.Vector3(0, 0, 0.0015)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
        new THREE.Vector3().setScalar(MOUTH_SCALE),
      );
      // ...expressed in the head bone's own space
      const local = built.rig.boneInverses[headIdx].clone().multiply(built.rig.Finv).multiply(m);
      local.decompose(accessory.object.position, accessory.object.quaternion, accessory.object.scale);
      this.head!.add(accessory.object);
      accessory.attachSmoke(this.root);
      this.mouth = accessory;
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const act = (set: Map<string, THREE.AnimationClip>, name: string, fallback: string): THREE.AnimationAction => {
      const clip = set.get(name) ?? set.get(fallback) ?? set.values().next().value!;
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.all.push(a);
      return a;
    };
    const { lower, upper, full } = this.clips;
    this.loIdle = act(lower, 'Idle_Gun_Pointing', 'Idle');
    this.loRun = act(lower, 'Run', 'Walk');
    this.loBack = act(lower, 'Run_Back', 'Run');
    this.loLeft = act(lower, 'Run_Left', 'Run');
    this.loRight = act(lower, 'Run_Right', 'Run');
    this.upAim = act(upper, 'Idle_Gun_Pointing', 'Idle');
    this.upAimRun = act(upper, 'Run_Shoot', 'Idle_Gun_Pointing');
    this.upSprint = act(upper, 'Run', 'Idle');
    this.upLow = act(upper, 'Idle_Gun', 'Idle');
    this.upShoot = act(upper, 'Idle_Gun_Shoot', 'Idle_Gun_Pointing');
    this.upCalm = act(upper, 'Idle_Neutral', 'Idle');
    this.upPunch = act(upper, 'Punch_Right', 'Idle_Gun_Shoot');
    this.loWalk = act(lower, 'Walk', 'Run');
    this.death = act(full, 'Death', 'Idle');
    this.calm = act(full, 'Idle_Neutral', 'Idle');
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
    this.death.stop();
    // locomotion + shoot clips are scrubbed by hand so the leg cycles stay in sync
    for (const a of [this.loRun, this.loWalk, this.loBack, this.loLeft, this.loRight, this.upAimRun, this.upSprint, this.upShoot, this.upPunch]) a.timeScale = 0;
  }

  /** Builds a character for a look, or null when the models are not loaded. */
  static create(builder: LookBuilder, assets: Assets, team: TeamId, look: Appearance): SkinnedCharacter | null {
    const built = builder.build(look);
    return built ? new SkinnedCharacter(built, builder, assets, team, look) : null;
  }

  /** A per-character geometry: the look's shared buffers, this character's colors, an optional expression morph. */
  private ownGeometry(morph: THREE.BufferAttribute | null): THREE.BufferGeometry {
    const src = this.built.geometry;
    const g = new THREE.BufferGeometry();
    g.setIndex(src.index);
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setAttribute('color', this.colors);
    if (morph) {
      g.morphAttributes.position = [morph];
      g.morphTargetsRelative = true;
    }
    g.boundingBox = src.boundingBox;
    g.boundingSphere = src.boundingSphere;
    return g;
  }

  private repaint(): void {
    paint(this.colors.array as Float32Array, this.built.paint, paletteFor(this.look, this.team), this.built.rigPos, printsFor(this.look));
    this.colors.needsUpdate = true;
  }

  setTeam(team: TeamId): void {
    this.team = team;
    this.repaint();
  }

  /**
   * Character screen: shows a facial expression for a few seconds, then eases back to the
   * normal face. Never used in matches.
   */
  previewExpression(id: string, holdMs = 2600): void {
    if (id === 'neutral') {
      this.expr.target = 0;
      return;
    }
    if (id !== this.expr.id || !this.geometry.morphAttributes.position) {
      const face = this.builder.build(this.look, id);
      const base = this.built.geometry.attributes.position, to = face?.geometry.attributes.position;
      if (!face || !to || to.count !== base.count) return;
      const delta = new Float32Array(base.count * 3);
      for (let i = 0; i < delta.length; i++) delta[i] = (to.array[i] as number) - (base.array[i] as number);
      const old = this.geometry;
      this.geometry = this.ownGeometry(new THREE.BufferAttribute(delta, 3));
      this.skin.geometry = this.geometry;
      this.skin.updateMorphTargets();
      this.outline.geometry = this.geometry;
      this.outline.updateMorphTargets();
      old.dispose();
      this.expr.id = id;
      this.expr.w = 0;
    }
    this.expr.target = 1;
    this.expr.until = performance.now() + holdMs;
  }

  /** Bind-pose heights (meters, before the height preset) the Character screen frames on. */
  get frame(): Assembled['frame'] & { scale: number } {
    return { ...this.built.frame, scale: this.built.heightScale };
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  setOutline(on: boolean): void {
    this.outline.visible = on && SkinnedCharacter.outlines;
  }

  /** Off on low graphics quality and in performance mode (set by the app). */
  static outlines = true;

  // ------------------------------------------------------------------ NPCs (AJ behind the counter)
  private lookTarget: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private waveT = -1;

  /** NPC idle: turn the head (and a little of the chest) toward a world point, or null to look ahead. */
  lookAt(target: THREE.Vector3 | null): void {
    this.lookTarget = target ? (this.lookTarget ?? new THREE.Vector3()).copy(target) : null;
  }

  /** NPC idle: a wave with the right hand. */
  wave(): void {
    if (this.waveT < 0 || this.waveT > 0.7) this.waveT = 0;
  }

  /** Head turn and wave on top of the relaxed idle clip (NPCs only; players never use it). */
  private npcLayer(dt: number, yaw: number): void {
    let wantYaw = 0, wantPitch = 0;
    if (this.lookTarget && this.head) {
      const head = this.head.getWorldPosition(_v1);
      const dx = this.lookTarget.x - head.x, dz = this.lookTarget.z - head.z;
      // relative to where the body faces (forward at yaw 0 is -Z)
      const rel = Math.atan2(-dx, -dz) - yaw;
      wantYaw = clamp(Math.atan2(Math.sin(rel), Math.cos(rel)), -1.15, 1.15);
      wantPitch = clamp(Math.atan2(this.lookTarget.y - head.y, Math.hypot(dx, dz)), -0.45, 0.35);
    }
    const k = damp(5, dt);
    this.lookYaw = lerp(this.lookYaw, wantYaw, k);
    this.lookPitch = lerp(this.lookPitch, wantPitch, k);
    const up = _v4.set(0, 1, 0);
    if (this.chest && Math.abs(this.lookYaw) > 1e-3) {
      _q1.setFromAxisAngle(up, this.lookYaw * 0.3);
      rotateBoneWorld(this.chest, _q1);
    }
    if (this.head) {
      _q1.setFromAxisAngle(up, this.lookYaw * 0.7);
      rotateBoneWorld(this.head, _q1);
      const a = yaw + this.lookYaw;
      _q1.setFromAxisAngle(_v5.set(Math.cos(a), 0, -Math.sin(a)), this.lookPitch);
      rotateBoneWorld(this.head, _q1);
    }
    // the wave: arm up and out, the forearm swinging side to side
    const arm = this.arms.R;
    if (this.waveT >= 0 && arm) {
      this.waveT += dt / 1.9;
      if (this.waveT >= 1) {
        this.waveT = -1;
        return;
      }
      const t = this.waveT;
      const e = Math.min(1, t / 0.18, (1 - t) / 0.2);
      const env = e * e * (3 - 2 * e);
      const right = _v5.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = _v2.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const sh = arm.upper.getWorldPosition(_v1);
      const el = arm.lower.getWorldPosition(new THREE.Vector3());
      const cur = el.clone().sub(sh).normalize();
      const want = new THREE.Vector3().addScaledVector(right, 0.85).addScaledVector(up, 0.35).addScaledVector(fwd, 0.25).normalize();
      _q1.setFromUnitVectors(cur, want);
      _qw.identity().slerp(_q1, env);
      rotateBoneWorld(arm.upper, _qw);
      const el2 = arm.lower.getWorldPosition(new THREE.Vector3());
      const wr = arm.wrist.getWorldPosition(new THREE.Vector3());
      const fore = wr.sub(el2).normalize();
      const swing = Math.sin(t * Math.PI * 7) * 0.45;
      const wantF = new THREE.Vector3().addScaledVector(up, 1).addScaledVector(right, swing).addScaledVector(fwd, 0.15).normalize();
      _q1.setFromUnitVectors(fore, wantF);
      _qw.identity().slerp(_q1, env);
      rotateBoneWorld(arm.lower, _qw);
    }
  }

  /** Stands in a relaxed idle with no weapon (menus only). */
  setMenuIdle(on: boolean): void {
    this.menuIdle = on;
    this.gunMount.visible = !on;
  }

  shot(): void {
    this.shootT = 1;
    this.recoil = 1;
  }

  throwItem(): void {
    this.throwT = 0;
  }

  hit(): void {
    this.flinch = 1;
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    for (const a of this.all) if (a !== this.death) a.setEffectiveWeight(0);
    this.death.reset();
    this.death.setEffectiveWeight(1);
    this.death.play();
    this.gunMount.visible = false;
  }

  respawn(): void {
    this.dead = false;
    this.skipped = 0;
    this.death.stop();
    this.death.setEffectiveWeight(0);
    this.gunMount.visible = true;
    this.flinch = 0;
    this.recoil = 0;
    this.shootT = 0;
    this.throwT = -1;
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  private setHeld(item: HeldItem): void {
    if (item === this.held) return;
    this.held = item;
    if (this.gun) {
      this.gunMount.remove(this.gun);
      this.gun = null;
    }
    const key = item === 'smoke' ? 'grenade' : item;
    const template: ModelTemplate | null = item === 'none' ? null : this.assets.model(key === 'sniper' ? 'ar' : key);
    const fit = GUN_FIT[key];
    if (!template || !fit) {
      this.muzzle.position.set(0, 0, -0.3);
      return;
    }
    const g = template.root.clone(true);
    // AJ's wrap (a material swap only: same gun, same stats)
    if (key !== 'grenade') applyWeaponSkin(g, this.look.weaponSkin, template.size);
    const s = fit.length / template.size.z;
    g.scale.setScalar(s);
    // template: long axis on +Z, origin at bottom center. We want the barrel on -Z and the grip at the origin.
    g.rotation.y = fit.muzzleNegZ ? 0 : Math.PI;
    // after the turn the muzzle is at z = -length/2 and the butt at +length/2, so the grip point
    // (`grip` of the way up from the butt) is at z = length * (0.5 - grip): slide it to the origin
    g.position.set(0, -template.size.y * s * 0.5 + fit.up, -fit.length * (0.5 - fit.grip));
    this.gun = g;
    this.gunMount.add(g);
    this.muzzle.position.set(0, fit.up + 0.01, -(fit.length * (1 - fit.grip)));
  }

  update(dt: number, pose: CharacterPose, visible = true): void {
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
    // using a healing item: the gun is put away while the hands work
    const healKind = pose.alive && pose.heal !== undefined && pose.heal >= 0 ? pose.heal : -1;
    this.setHeld(healKind >= 0 ? 'none' : pose.held);
    if (healKind < 0) {
      this.healT = 0;
      if (this.healProp) this.healProp.visible = false;
    }

    // off screen: skip the animation work and catch up when the character is seen again
    if (!visible) {
      this.skipped = Math.min(this.dead ? 6 : 0.25, this.skipped + dt);
      return;
    }
    dt += this.skipped;
    this.skipped = 0;
    this.mouth?.update(dt);
    if (this.expr.target > 0 || this.expr.w > 0) {
      if (performance.now() > this.expr.until) this.expr.target = 0;
      this.expr.w = approach(this.expr.w, this.expr.target, dt * 5);
      if (this.skin.morphTargetInfluences) this.skin.morphTargetInfluences[0] = this.expr.w;
      if (this.outline.morphTargetInfluences) this.outline.morphTargetInfluences[0] = this.expr.w;
    }

    if (this.dead) {
      this.mixer.update(dt);
      return;
    }
    if (this.menuIdle) {
      for (const a of this.all) a.setEffectiveWeight(a === this.calm ? 1 : 0);
      // put back the clean animated pose first: bones the idle clip does not animate would
      // otherwise keep every frame's procedural turn on top of the last
      for (const t of this.touched) {
        t.bone.quaternion.copy(t.q);
        t.bone.position.copy(t.p);
      }
      this.mixer.update(dt);
      for (const t of this.touched) {
        t.q.copy(t.bone.quaternion);
        t.p.copy(t.bone.position);
      }
      this.npcLayer(dt, pose.yaw);
      if (this.look.carry === 'phone') this.phonePose(dt);
      else if (this.phone) this.phone.visible = false;
      return;
    }
    if (pose.skydive) {
      this.skydive(dt, pose);
      return;
    }
    if (pose.hanging) {
      this.hangFrom(dt, pose);
      return;
    }
    if (this.hangT >= 0) {
      // let go of the balloon (or landed straight out of a skydive): back to the normal stance
      this.hangT = -1;
      this.tilted = true;
      this.calm.setEffectiveWeight(0);
    }
    if (this.tilted) {
      this.tilted = false;
      this.model.position.set(0, 0, 0);
      this.model.quaternion.copy(_flip);
      this.gunMount.visible = true;
    }

    const speed = Math.hypot(pose.vx, pose.vz);
    const sinY = Math.sin(pose.yaw), cosY = Math.cos(pose.yaw);
    const mvF = -pose.vx * sinY - pose.vz * cosY;
    const mvR = pose.vx * cosY - pose.vz * sinY;
    const moving = speed > 0.35;
    const held: HeldItem = healKind >= 0 ? 'none' : pose.held;
    const twoHand = held === 'ar' || held === 'smg' || held === 'shotgun' || held === 'sniper';
    const pistol = held === 'pistol';
    const armed = twoHand || pistol;
    const unarmed = held === 'none';

    this.moveT = approach(this.moveT, moving ? clamp(speed / 3.2, 0.35, 1) : 0, dt * 6);
    this.sprintT = approach(this.sprintT, pose.sprinting && speed > 5.6 ? 1 : 0, dt * 6);
    this.crouchT = approach(this.crouchT, pose.crouching ? 1 : 0, dt * 7);
    this.lowT = approach(this.lowT, !armed && !unarmed ? 1 : 0, dt * 8);
    this.aimT = approach(this.aimT, pose.aiming && armed && this.sprintT < 0.5 ? 1 : 0, dt * 9);
    this.shootT = Math.max(0, this.shootT - dt * (unarmed ? 3.2 : 5));
    this.recoil = Math.max(0, this.recoil - dt * 11);
    this.flinch = Math.max(0, this.flinch - dt * 5);

    // direction weights for the 4-way leg blend
    if (moving) {
      const inv = 1 / Math.max(0.001, Math.abs(mvF) + Math.abs(mvR));
      const k = damp(12, dt);
      this.wF = lerp(this.wF, Math.max(0, mvF) * inv, k);
      this.wB = lerp(this.wB, Math.max(0, -mvF) * inv, k);
      this.wR = lerp(this.wR, Math.max(0, mvR) * inv, k);
      this.wL = lerp(this.wL, Math.max(0, -mvR) * inv, k);
    }

    // feet: walk when slow, run when fast, and the cycle advances exactly as fast as the
    // ground goes by (each clip's stride is measured from the animation) so feet do not slide
    const walkK = clamp((4.1 - speed) / 1.7, 0, 1) * this.wF;
    const scaleH = this.built.heightScale;
    // (a touch longer than measured: the stylized clips take short steps, and matching them
    // exactly at a sprint would make the legs a blur)
    const stride = lerp(this.clips.strideRun, this.clips.strideWalk, walkK) * scaleH * (1 + 0.25 * this.sprintT);
    if (moving) this.phase = (this.phase + clamp((dt * speed) / Math.max(0.4, stride), 0, 0.2)) % 1;
    const air = pose.grounded ? 1 : 0.35;
    for (const a of [this.loRun, this.loWalk, this.loBack, this.loLeft, this.loRight, this.upAimRun, this.upSprint]) {
      a.time = this.phase * a.getClip().duration;
    }

    const m = this.moveT * air + (1 - air) * 0.6;
    this.loIdle.setEffectiveWeight(1 - m);
    this.loRun.setEffectiveWeight(m * this.wF * (1 - walkK / Math.max(0.001, this.wF)));
    this.loWalk.setEffectiveWeight(m * walkK);
    this.loBack.setEffectiveWeight(m * this.wB);
    this.loLeft.setEffectiveWeight(m * this.wL);
    this.loRight.setEffectiveWeight(m * this.wR);

    // upper body
    const shoot = this.shootT;
    if (unarmed) {
      // no weapon: arms swing with the stride, hang loose standing still; fists punch
      const punch = shoot > 0 ? Math.min(1, shoot * 2.2) : 0;
      this.upAim.setEffectiveWeight(0);
      this.upAimRun.setEffectiveWeight(0);
      this.upLow.setEffectiveWeight(0);
      this.upShoot.setEffectiveWeight(0);
      this.upSprint.setEffectiveWeight(this.moveT * (1 - punch));
      this.upCalm.setEffectiveWeight((1 - this.moveT) * (1 - punch));
      this.upPunch.setEffectiveWeight(punch);
      if (shoot > 0) this.upPunch.time = (1 - shoot) * this.upPunch.getClip().duration * 0.75;
    } else {
      const low = this.lowT * (1 - this.sprintT);
      const sprint = this.sprintT;
      const aim = Math.max(0, 1 - low - sprint);
      const runAim = aim * this.moveT;
      this.upAim.setEffectiveWeight((aim - runAim) * (1 - shoot * 0.85));
      this.upAimRun.setEffectiveWeight(runAim * (1 - shoot * 0.85));
      this.upSprint.setEffectiveWeight(sprint);
      this.upLow.setEffectiveWeight(low);
      this.upShoot.setEffectiveWeight(shoot * 0.85 * aim);
      this.upCalm.setEffectiveWeight(0);
      this.upPunch.setEffectiveWeight(0);
      if (shoot > 0) this.upShoot.time = (1 - shoot) * Math.min(0.3, this.upShoot.getClip().duration);
    }

    // put back last frame's clean animated pose, advance the clips, remember the new clean pose
    for (const t of this.touched) {
      t.bone.quaternion.copy(t.q);
      t.bone.position.copy(t.p);
    }
    this.mixer.update(dt);
    for (const t of this.touched) {
      t.q.copy(t.bone.quaternion);
      t.p.copy(t.bone.position);
    }

    // ---- procedural layers on top of the clips ----
    // (every world-space read below goes through getWorldPosition / getWorldQuaternion, which
    // refresh just that bone's parent chain: no whole-skeleton matrix passes are needed)
    _v5.set(cosY, 0, -sinY); // character's right axis in world space

    // crouch: drop the hips and re-solve both legs onto the (animated) feet
    if (this.crouchT > 0.001 && this.body) {
      const drop = CROUCH_DROP * this.crouchT;
      const anchors = this.legs.map((leg) => ({
        knee: leg.lower.getWorldPosition(new THREE.Vector3()),
        hip: leg.upper.getWorldPosition(new THREE.Vector3()),
        foot: leg.foot.getWorldPosition(new THREE.Vector3()),
      }));
      this.body.getWorldPosition(_v1);
      _v1.y -= drop;
      this.body.parent!.worldToLocal(_v1);
      this.body.position.copy(_v1);
      const fwd = _v4.set(-sinY, 0, -cosY);
      for (let i = 0; i < this.legs.length; i++) {
        const leg = this.legs[i], a = anchors[i];
        const l1 = a.hip.distanceTo(a.knee), l2 = a.knee.distanceTo(a.foot);
        const hip = leg.upper.getWorldPosition(_v1);
        const toFoot = _v2.copy(a.foot).sub(hip);
        const d = clamp(toFoot.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
        toFoot.normalize();
        const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
        // knees bend forward (the part of "forward" perpendicular to the hip->foot line)
        const bend = _v3.copy(fwd).addScaledVector(toFoot, -fwd.dot(toFoot));
        if (bend.lengthSq() < 1e-6) bend.copy(fwd);
        bend.normalize();
        const knee = new THREE.Vector3().copy(hip).addScaledVector(toFoot, along).addScaledVector(bend, out);
        // thigh: old direction (hip -> old knee, both shifted down by the drop) to the new one
        const oldThigh = a.knee.clone().sub(a.hip).normalize();
        const newThigh = knee.clone().sub(hip).normalize();
        _q1.setFromUnitVectors(oldThigh, newThigh);
        rotateBoneWorld(leg.upper, _q1);
        // shin: it was carried along by the thigh rotation; point it at the foot
        const oldShin = a.foot.clone().sub(a.knee).normalize().applyQuaternion(_q1);
        const newShin = a.foot.clone().sub(knee).normalize();
        _q1.setFromUnitVectors(oldShin, newShin);
        rotateBoneWorld(leg.lower, _q1);
      }
    }

    // aim pitch through the spine (+ lean forward when crouched or sprinting, flinch when hit)
    const lean = this.crouchT * 0.42 + this.sprintT * 0.12;
    if (this.spine) {
      const pitch = armed || this.throwT >= 0 ? pose.pitch : pose.pitch * 0.4;
      _q1.setFromAxisAngle(_v5, pitch * 0.55 - lean + this.flinch * 0.15);
      rotateBoneWorld(this.spine, _q1);
    }
    if (this.chest && this.chest !== this.spine) {
      _q1.setFromAxisAngle(_v5, (armed ? pose.pitch : pose.pitch * 0.4) * 0.3);
      rotateBoneWorld(this.chest, _q1);
    }
    if (this.head) {
      // keep the head level-ish while the torso leans
      _q1.setFromAxisAngle(_v5, lean * 0.6);
      rotateBoneWorld(this.head, _q1);
    }

    // ---- weapon ----
    let pitch = pose.pitch;
    let yaw = 0;
    let roll = 0;
    if (this.sprintT > 0) {
      pitch = lerp(pitch, -0.75, this.sprintT);
      yaw = 0.55 * this.sprintT;
    }
    const reload = pose.reload >= 0 && armed ? Math.sin(Math.PI * clamp(pose.reload, 0, 1)) : 0;
    if (reload > 0) {
      pitch += 0.3 * reload;
      roll = 0.5 * reload;
    }
    if (this.throwT >= 0) {
      this.throwT += dt / 0.42;
      const t = clamp(this.throwT, 0, 1);
      pitch += t < 0.35 ? lerp(0, 0.9, t / 0.35) : lerp(0.9, -0.6, (t - 0.35) / 0.65);
      if (this.throwT >= 1) this.throwT = -1;
    }
    pitch += this.recoil * 0.1;
    this.gunMount.rotation.set(pitch, yaw, roll, 'YXZ');
    if (armed && this.arms.R) {
      // guns are held where the character aims, and the hands go to the gun: a long gun is
      // tucked into the right shoulder with the left hand out on the handguard; a pistol is
      // held out in the right hand alone
      const q = this.gunMount.quaternion;
      const rq = this.root.quaternion;
      const sh = this.root.worldToLocal(this.arms.R.upper.getWorldPosition(new THREE.Vector3()));
      // from the hip a long gun is held out on the right side (so it shows past the body from
      // the over-the-shoulder camera); aiming brings it up into the shoulder at cheek height.
      // A pistol is held out at arm's length, up at eye level when aiming.
      const a = this.aimT * this.aimT * (3 - 2 * this.aimT);
      const want = new THREE.Vector3(
        lerp(twoHand ? 0.07 : -0.02, twoHand ? -0.02 : -0.1, a),
        lerp(twoHand ? -0.16 : -0.06, twoHand ? 0.01 : 0.03, a),
        lerp(twoHand ? -0.3 : -0.38, twoHand ? -0.24 : -0.46, a),
      ).applyQuaternion(q).add(sh);
      want.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), this.recoil * 0.05);
      // right hand to the grip (the wrist sits just behind it)...
      const back = new THREE.Vector3(0, -0.012, 0.055).applyQuaternion(q);
      reach(this.arms.R, this.root.localToWorld(want.clone().add(back)), new THREE.Vector3(1, -1.3, 0.5).applyQuaternion(rq));
      // ...and the gun goes wherever the hand actually got to, so it never floats
      const grip = this.root.worldToLocal(this.arms.R.wrist.getWorldPosition(new THREE.Vector3())).sub(back);
      this.gunMount.position.copy(grip);
      if (twoHand && this.arms.L) {
        const fit = GUN_FIT[held];
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const down = new THREE.Vector3(0, -0.035, 0).applyQuaternion(q);
        const wristBack = new THREE.Vector3(-0.025, -0.015, 0.05).applyQuaternion(q);
        // the support hand goes as far out along the handguard as the arm reaches
        const shL = this.arms.L.upper.getWorldPosition(new THREE.Vector3());
        const elL = this.arms.L.lower.getWorldPosition(new THREE.Vector3());
        const wrL = this.arms.L.wrist.getWorldPosition(new THREE.Vector3());
        const armLen = (shL.distanceTo(elL) + elL.distanceTo(wrL)) * 0.97;
        const shLl = this.root.worldToLocal(shL.clone());
        let along = (fit?.length ?? 0.8) * ((FOREGRIP[held] ?? 0.7) - (fit?.grip ?? 0.4));
        const hand = new THREE.Vector3();
        for (let i = 0; i < 12; i++) {
          hand.copy(grip).addScaledVector(dir, along).add(down).add(wristBack);
          if (hand.distanceTo(shLl) <= armLen || along < 0.06) break;
          along *= 0.88;
        }
        if (reload > 0) {
          // left hand down to the magazine and back
          const mag = new THREE.Vector3(0.02, -0.13, -0.08).applyQuaternion(q).add(grip);
          hand.lerp(mag, reload);
        }
        reach(this.arms.L, this.root.localToWorld(hand), new THREE.Vector3(-1, -1.4, 0.3).applyQuaternion(rq));
      } else if (this.arms.L) {
        // pistol: the free arm hangs relaxed at the side
        const shL = this.root.worldToLocal(this.arms.L.upper.getWorldPosition(new THREE.Vector3()));
        const rest = shL.add(new THREE.Vector3(-0.07, -0.4, 0.05 + Math.sin(this.phase * Math.PI * 2) * 0.07 * this.moveT));
        reach(this.arms.L, this.root.localToWorld(rest), new THREE.Vector3(-0.3, 0, 1).applyQuaternion(rq));
      }
      // close the hands around the gun: turn the palms in and curl the fingers
      this.grip('R', twoHand ? WRIST_TWIST : WRIST_TWIST * 0.6, 1);
      if (twoHand) this.grip('L', -WRIST_TWIST, 0.75);
    } else if (this.handR) {
      // throwables (and nothing) ride in the right hand wherever the clip puts it
      this.handR.getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      this.gunMount.position.set(_v1.x, _v1.y, _v1.z - 0.04 + this.recoil * 0.04);
    }

    if (healKind >= 0) this.healPose(dt, healKind);

    // roll (sprint + crouch): tucked up tight, once over forward around the middle of the body
    if (pose.roll !== undefined && pose.roll >= 0) {
      const f = clamp(pose.roll, 0, 1);
      const e = f * f * (3 - 2 * f);
      const tuck = Math.min(1, Math.sin(Math.PI * f) * 1.6);
      this.legs.forEach((leg) => {
        _q1.setFromAxisAngle(_v5, 1.5 * tuck);
        rotateBoneWorld(leg.upper, _q1);
        _q1.setFromAxisAngle(_v5, -2.1 * tuck);
        rotateBoneWorld(leg.lower, _q1);
      });
      if (this.spine) {
        _q1.setFromAxisAngle(_v5, -0.7 * tuck);
        rotateBoneWorld(this.spine, _q1);
      }
      if (this.head) {
        _q1.setFromAxisAngle(_v5, -0.5 * tuck);
        rotateBoneWorld(this.head, _q1);
      }
      _q1.setFromAxisAngle(_v4.set(1, 0, 0), -Math.PI * 2 * e);
      const hip = _v3.set(0, 0.5, 0);
      this.model.quaternion.copy(_q1).multiply(_flip);
      this.model.position.copy(hip).sub(_v2.copy(hip).applyQuaternion(_q1));
      this.gunMount.visible = false;
      this.tilted = true;
    } else if (pose.climb !== undefined && pose.climb >= 0) {
      this.climbPose(clamp(pose.climb, 0, 1));
    }
  }

  // ------------------------------------------------------------------ phone (menus only)
  private phone: THREE.Group | null = null;
  private phoneT = 0;

  /** Looking at a phone held in both hands in front of the chest (menus and the creator). */
  private phonePose(dt: number): void {
    const R = this.arms.R, L = this.arms.L;
    if (!R || !L) return;
    this.phoneT += dt;
    if (!this.phone) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.152, 0.009), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.4 }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.138), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }));
      screen.position.z = 0.0047;
      g.add(body, screen);
      this.phone = g;
      this.root.add(g);
    }
    this.phone.visible = true;
    const rq = this.root.quaternion;
    const right = _v5.set(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y));
    // the phone in front of the chest, screen up toward the face; thumbs scrolling now and then
    const scroll = Math.max(0, Math.sin(this.phoneT * 1.3)) * 0.006;
    // (root space: forward is -Z, the character's right hand on +X)
    const at = new THREE.Vector3(0.01, 1.15 + scroll, -0.25);
    reach(R, this.root.localToWorld(at.clone().add(new THREE.Vector3(0.045, -0.04, 0.025))), new THREE.Vector3(1, -1.3, 0.5).applyQuaternion(rq));
    reach(L, this.root.localToWorld(at.clone().add(new THREE.Vector3(-0.045, -0.045, 0.03))), new THREE.Vector3(-1, -1.3, 0.5).applyQuaternion(rq));
    this.grip('R', WRIST_TWIST * 0.5, 0.55);
    this.grip('L', -WRIST_TWIST * 0.5, 0.55);
    if (this.chest) {
      _q1.setFromAxisAngle(right, -0.06);
      rotateBoneWorld(this.chest, _q1);
    }
    if (this.head) {
      _q1.setFromAxisAngle(right, -0.4);
      rotateBoneWorld(this.head, _q1);
    }
    this.phone.position.copy(at);
    this.phone.rotation.set(-1.05, 0, 0);
  }

  // ------------------------------------------------------------------ ledge
  /**
   * Pulling up onto a ledge: both hands up on the edge, the body rising past them, one knee
   * coming up over the top, leaning in.
   */
  private climbPose(t: number): void {
    const R = this.arms.R, L = this.arms.L;
    const rq = this.root.quaternion;
    const right = _v5.set(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y));
    // the edge drops past the body as it rises (the hands stay on it)
    const edgeY = 2.05 - 1.25 * Math.min(1, t / 0.7);
    for (const [arm, side] of [[R, 1], [L, -1]] as const) {
      if (!arm) continue;
      const hand = new THREE.Vector3(side * 0.22, edgeY, -0.42 + 0.15 * t);
      reach(arm, this.root.localToWorld(hand), new THREE.Vector3(side * 1, -0.6, 0.6).applyQuaternion(rq));
    }
    if (this.spine) {
      _q1.setFromAxisAngle(right, -0.45 * Math.sin(Math.PI * Math.min(1, t * 1.2)));
      rotateBoneWorld(this.spine, _q1);
    }
    const knee = Math.sin(Math.PI * clamp((t - 0.25) / 0.75, 0, 1));
    if (this.legs[0]) {
      _q1.setFromAxisAngle(right, 1.3 * knee);
      rotateBoneWorld(this.legs[0].upper, _q1);
      _q1.setFromAxisAngle(right, -1.6 * knee);
      rotateBoneWorld(this.legs[0].lower, _q1);
    }
    this.gunMount.visible = false;
    this.tilted = true;
  }

  // ------------------------------------------------------------------ healing
  private healT = 0;
  private healProp: THREE.Group | null = null;
  private healPropKind = -1;

  /** The item in hand: a first-aid kit, a bandage roll or a drink bottle. */
  private makeHealProp(kind: number): THREE.Group {
    const g = new THREE.Group();
    const mat = (c: number, rough = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, flatShading: true });
    if (kind === 2) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.17, 10), mat(0x2f9be8, 0.3));
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.07, 10), mat(0xff7a1a));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 8), mat(0xffffff));
      cap.position.y = 0.1;
      g.add(bottle, label, cap);
    } else if (kind === 0) {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 12), mat(0xf1ece0, 0.9));
      roll.rotation.z = Math.PI / 2;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.004), mat(0xf1ece0, 0.9));
      tail.position.set(0, -0.07, 0.044);
      g.add(roll, tail);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.06), mat(0xf4f4f0, 0.5));
      const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.065), mat(0xd62b2b, 0.5));
      const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, 0.065), mat(0xd62b2b, 0.5));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), mat(0x2a2a2e));
      handle.position.y = 0.075;
      g.add(box, crossA, crossB, handle);
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
  }

  /**
   * Healing: a first-aid kit is opened in front of the chest and pressed on; a bandage is
   * wound around the arm; a drink is tipped back. Head down to watch the hands (or back to drink).
   */
  private healPose(dt: number, kind: number): void {
    const R = this.arms.R, L = this.arms.L;
    if (!R || !L) return;
    this.healT += dt;
    const t = this.healT;
    if (!this.healProp || this.healPropKind !== kind) {
      if (this.healProp) {
        this.healProp.removeFromParent();
        this.healProp.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        });
      }
      this.healProp = this.makeHealProp(kind);
      this.healPropKind = kind;
      this.root.add(this.healProp);
    }
    this.healProp.visible = true;
    const rq = this.root.quaternion;
    const shR = this.root.worldToLocal(R.upper.getWorldPosition(new THREE.Vector3()));
    const shL = this.root.worldToLocal(L.upper.getWorldPosition(new THREE.Vector3()));
    const mid = shR.clone().add(shL).multiplyScalar(0.5);
    const right = _v5.set(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y));
    const at = (v: THREE.Vector3) => this.root.localToWorld(v.clone());
    let headPitch = -0.35;
    if (kind === 2) {
      // drink: bottle up to the mouth, tipping back in sips
      const sip = 0.5 + 0.5 * Math.sin(t * 3.2);
      reach(R, at(shR.clone().add(new THREE.Vector3(-0.1, 0.14 + 0.03 * sip, -0.12))), new THREE.Vector3(1, -1.2, 0.3).applyQuaternion(rq));
      reach(L, at(shL.clone().add(new THREE.Vector3(0.0, -0.45, 0.05))), new THREE.Vector3(-0.3, 0, 1).applyQuaternion(rq));
      headPitch = 0.25 + 0.12 * sip;
      this.grip('R', WRIST_TWIST * 0.5, 0.9);
    } else {
      // kit / bandage held in the left hand in front of the belly...
      reach(L, at(mid.clone().add(new THREE.Vector3(-0.06, -0.32, -0.27))), new THREE.Vector3(-1, -1.4, 0.3).applyQuaternion(rq));
      // ...the right hand works on it: winding a bandage, pressing a dressing on
      const w = kind === 0 ? 8 : 5;
      const r = kind === 0 ? 0.07 : 0.035;
      const work = mid.clone().add(new THREE.Vector3(0.05 + Math.cos(t * w) * r, -0.22 + Math.sin(t * w) * r, -0.24 - (kind === 0 ? 0 : 0.03 * (0.5 + 0.5 * Math.sin(t * w)))));
      reach(R, at(work), new THREE.Vector3(1, -1.3, 0.5).applyQuaternion(rq));
      this.grip('L', -WRIST_TWIST, 0.8);
      this.grip('R', WRIST_TWIST * 0.4, 0.5);
    }
    if (this.head) {
      _q1.setFromAxisAngle(right, headPitch);
      rotateBoneWorld(this.head, _q1);
    }
    // the item rides in its hand (just past the wrist, on the palm side)
    const arm = kind === 2 ? R : L;
    const wr = arm.wrist.getWorldPosition(new THREE.Vector3());
    const el = arm.lower.getWorldPosition(new THREE.Vector3());
    const hand = wr.clone().addScaledVector(wr.clone().sub(el).normalize(), 0.07);
    this.healProp.position.copy(this.root.worldToLocal(hand));
    if (kind === 2) {
      // tipped toward the mouth
      this.healProp.rotation.set(-0.9 - 0.3 * Math.sin(t * 3.2), 0, 0);
    } else {
      this.healProp.rotation.set(-0.5, 0, 0);
    }
  }

  /** Turns a hand's palm in (a twist about the forearm) and curls its fingers into a grip. */
  private grip(side: 'L' | 'R', twist: number, curl: number): void {
    const arm = this.arms[side];
    if (!arm) return;
    const el = arm.lower.getWorldPosition(new THREE.Vector3());
    const axis = arm.wrist.getWorldPosition(new THREE.Vector3()).sub(el).normalize();
    _q1.setFromAxisAngle(axis, twist);
    rotateBoneWorld(arm.wrist, _q1);
    for (const f of this.fingers[side]) f.rotateOnAxis(FINGER_AXIS, FINGER_CURL * curl);
  }

  /** Runs the relaxed full-body clip as the base for a procedural pose (hanging, skydiving). */
  private basePose(dt: number): void {
    if (this.hangT < 0) this.hangT = 0;
    this.hangT += dt;
    for (const a of this.all) a.setEffectiveWeight(a === this.calm ? 1 : 0);
    for (const tb of this.touched) {
      tb.bone.quaternion.copy(tb.q);
      tb.bone.position.copy(tb.p);
    }
    this.mixer.update(dt);
    for (const tb of this.touched) {
      tb.q.copy(tb.bone.quaternion);
      tb.p.copy(tb.bone.position);
    }
    this.gunMount.visible = false;
  }

  /**
   * Skydiving: belly down, arms up and out in the "box" position, knees bent with the feet
   * up behind, head up to see where you are going. Rolls into turns and pitches into a dive.
   */
  private skydive(dt: number, pose: CharacterPose): void {
    this.basePose(dt);
    const t = this.hangT + this.phase * 10;
    const sinY = Math.sin(pose.yaw), cosY = Math.cos(pose.yaw);
    const fwd = -pose.vx * sinY - pose.vz * cosY, right = pose.vx * cosY - pose.vz * sinY;
    const dive = pose.crouching ? 0.35 : 0;
    const tilt = -1.32 - dive - clamp(fwd * 0.012, -0.15, 0.15) + Math.sin(t * 2.3) * 0.04;
    const roll = -clamp(right * 0.035, -0.4, 0.4) + Math.sin(t * 1.7) * 0.05;
    _q1.setFromEuler(_e1.set(tilt, 0, roll));
    // pivot around the hips
    const hip = _v4.set(0, 1.0, 0);
    this.model.quaternion.copy(_q1).multiply(_flip);
    this.model.position.copy(hip).sub(_v1.copy(hip).applyQuaternion(_q1));
    const body = _q1.clone();

    const right3 = new THREE.Vector3(cosY, 0, -sinY);
    // hands: in the upright body frame they are up beside the head, elbows out and down
    const flap = Math.sin(t * 3.1) * 0.03;
    for (const [arm, side] of [[this.arms.R, 1], [this.arms.L, -1]] as const) {
      if (!arm) continue;
      const local = new THREE.Vector3(side * (0.52 + flap), 1.74, -0.08).sub(hip).applyQuaternion(body).add(hip);
      const pole = new THREE.Vector3(side * 1, -0.9, 0.2).applyQuaternion(body).applyQuaternion(this.root.quaternion);
      reach(arm, this.root.localToWorld(local), pole);
    }
    // legs: a little apart, knees bent so the feet trail up behind
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? -1 : 1;
      const k = Math.sin(t * 2.6 + i * 1.7) * 0.06;
      // spreading the legs turns them about the body's own front-back axis (which now points down)
      const fwdAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(body).applyQuaternion(this.root.quaternion);
      _q1.setFromAxisAngle(fwdAxis, side * 0.22);
      rotateBoneWorld(leg.upper, _q1);
      _q1.setFromAxisAngle(right3, 0.12 + k);
      rotateBoneWorld(leg.upper, _q1);
      _q1.setFromAxisAngle(right3, -(1.05 + dive * 0.8) + k);
      rotateBoneWorld(leg.lower, _q1);
    });
    // chin up, eyes on the ground ahead
    if (this.head) {
      _q1.setFromAxisAngle(right3, 0.75);
      rotateBoneWorld(this.head, _q1);
    }
  }

  /**
   * Hanging from balloons: both hands up on the strings, legs dangling, the whole body
   * swinging gently under the grip like a pendulum.
   */
  private hangFrom(dt: number, pose: CharacterPose): void {
    this.basePose(dt);
    const t = this.hangT + this.phase * 10;

    // swing about the grip: roll side to side, a little fore and aft, leaning into the steering
    const sinY = Math.sin(pose.yaw), cosY = Math.cos(pose.yaw);
    const fwd = -pose.vx * sinY - pose.vz * cosY, right = pose.vx * cosY - pose.vz * sinY;
    const roll = Math.sin(t * 1.7) * 0.09 - clamp(right * 0.03, -0.18, 0.18);
    const pitch = Math.sin(t * 1.3 + 1) * 0.05 - clamp(fwd * 0.03, -0.2, 0.2);
    _q1.setFromEuler(_e1.set(pitch, 0, roll));
    this.model.quaternion.copy(_q1).multiply(_flip);
    this.model.position.copy(_grip).sub(_v1.copy(_grip).applyQuaternion(_q1));

    // hands up on the strings (right a little higher), elbows out to the sides
    const up = _v5.set(cosY, 0, -sinY); // character's right in world space
    const back = new THREE.Vector3(sinY, 0, cosY);
    if (this.arms.R) {
      const target = this.root.localToWorld(new THREE.Vector3(BALLOON_GRIP.x - 0.02, BALLOON_GRIP.y - 0.1, BALLOON_GRIP.z));
      reach(this.arms.R, target, new THREE.Vector3().copy(up).addScaledVector(back, 0.4));
    }
    if (this.arms.L) {
      const target = this.root.localToWorld(new THREE.Vector3(BALLOON_GRIP.x - 0.16, BALLOON_GRIP.y - 0.24, BALLOON_GRIP.z - 0.02));
      reach(this.arms.L, target, new THREE.Vector3().copy(up).multiplyScalar(-1).addScaledVector(back, 0.4));
    }

    // legs dangle and kick a little
    this.legs.forEach((leg, i) => {
      const k = Math.sin(t * 2.2 + i * Math.PI);
      _q1.setFromAxisAngle(up, 0.12 + 0.16 * k);
      rotateBoneWorld(leg.upper, _q1);
      _q1.setFromAxisAngle(up, -(0.3 + 0.18 * Math.max(0, -k)));
      rotateBoneWorld(leg.lower, _q1);
    });
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.geometry.dispose();
    this.outlineMat.dispose();
    this.mouth?.dispose();
    this.phone?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.healProp?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}

