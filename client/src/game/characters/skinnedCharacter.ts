import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Appearance } from '@shared/config/appearance';
import type { TeamId } from '@shared/config/crews';
import { approach, clamp, damp, lerp } from '@shared/math';
import { CHARACTER_MESH, type Assets, type CharacterTemplate, type ModelTemplate } from '../assets';
import { BALLOON_GRIP, type CharacterPose, type CharacterVisual, type HeldItem } from './characterTypes';
import { LOOK_MATERIAL, type Assembled, type LookBuilder } from './look/assemble';
import { paint, paletteFor } from './look/palette';
import { MOUTH_SCALE, createMouthAccessory, type MouthAccessory } from './mouthAccessories';

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
const GUN_FIT: Record<string, { length: number; grip: number; muzzleNegZ: boolean; up: number }> = {
  ar: { length: 0.92, grip: 0.42, muzzleNegZ: true, up: 0.03 },
  smg: { length: 0.62, grip: 0.4, muzzleNegZ: false, up: 0.05 },
  shotgun: { length: 1.0, grip: 0.36, muzzleNegZ: false, up: 0.02 },
  pistol: { length: 0.26, grip: 0.2, muzzleNegZ: false, up: 0.04 },
  // no sniper model yet: the rifle, longer (placeholder art)
  sniper: { length: 1.18, grip: 0.38, muzzleNegZ: true, up: 0.035 },
  grenade: { length: 0.11, grip: 0.5, muzzleNegZ: true, up: 0 },
};

interface ClipSet {
  lower: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  full: Map<string, THREE.AnimationClip>;
  /** Uniform scale that makes the model HEIGHT tall. */
  scale: number;
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
  const set: ClipSet = { lower, upper, full, scale: h > 0.01 ? HEIGHT / h : 1 };
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
const _q3 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _grip = new THREE.Vector3(BALLOON_GRIP.x, BALLOON_GRIP.y, BALLOON_GRIP.z);
const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _s = new THREE.Vector3();
const _el = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _t = new THREE.Vector3();

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
    this.geometry = this.ownGeometry(null);
    this.skin.geometry = this.geometry;
    this.skin.material = LOOK_MATERIAL;
    // skinned bounds are not tracked per pose: cull with a fixed sphere that covers every pose
    // (standing, crouched, lying dead) around the character's feet instead
    this.root.updateMatrixWorld(true);
    const center = this.skin.worldToLocal(this.root.localToWorld(new THREE.Vector3(0, 0.9, 0)));
    this.skin.boundingSphere = new THREE.Sphere(center, 2.1 / this.skin.matrixWorld.getMaxScaleOnAxis());
    this.skin.frustumCulled = true;
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
    }
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
    this.death = act(full, 'Death', 'Idle');
    this.calm = act(full, 'Idle_Neutral', 'Idle');
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
    this.death.stop();
    // locomotion + shoot clips are scrubbed by hand so the leg cycles stay in sync
    for (const a of [this.loRun, this.loBack, this.loLeft, this.loRight, this.upAimRun, this.upSprint, this.upShoot]) a.timeScale = 0;
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
    paint(this.colors.array as Float32Array, this.built.paint, paletteFor(this.look, this.team));
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
    const s = fit.length / template.size.z;
    g.scale.setScalar(s);
    // template: long axis on +Z, origin at bottom center. We want the barrel on -Z and the grip at the origin.
    g.rotation.y = fit.muzzleNegZ ? 0 : Math.PI;
    // after the turn the muzzle is at z = -length/2 and the butt at +length/2; slide the grip point to the origin
    g.position.set(0, -template.size.y * s * 0.5 + fit.up, fit.length * (0.5 - fit.grip));
    this.gun = g;
    this.gunMount.add(g);
    this.muzzle.position.set(0, fit.up + 0.01, -(fit.length * (1 - fit.grip)));
  }

  update(dt: number, pose: CharacterPose, visible = true): void {
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
    this.setHeld(pose.held);

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
    }

    if (this.dead) {
      this.mixer.update(dt);
      return;
    }
    if (this.menuIdle) {
      for (const a of this.all) a.setEffectiveWeight(a === this.calm ? 1 : 0);
      this.mixer.update(dt);
      return;
    }
    if (pose.hanging) {
      this.hangFrom(dt, pose);
      return;
    }
    if (this.hangT >= 0) {
      // let go of the balloon: back to the normal stance
      this.hangT = -1;
      this.model.position.set(0, 0, 0);
      this.model.quaternion.copy(_flip);
      this.calm.setEffectiveWeight(0);
      this.gunMount.visible = true;
    }

    const speed = Math.hypot(pose.vx, pose.vz);
    const sinY = Math.sin(pose.yaw), cosY = Math.cos(pose.yaw);
    const mvF = -pose.vx * sinY - pose.vz * cosY;
    const mvR = pose.vx * cosY - pose.vz * sinY;
    const moving = speed > 0.35;
    const armed = pose.held !== 'none' && pose.held !== 'grenade' && pose.held !== 'smoke';

    this.moveT = approach(this.moveT, moving ? clamp(speed / 3.2, 0.35, 1) : 0, dt * 6);
    this.sprintT = approach(this.sprintT, pose.sprinting && speed > 5.6 ? 1 : 0, dt * 6);
    this.crouchT = approach(this.crouchT, pose.crouching ? 1 : 0, dt * 7);
    this.lowT = approach(this.lowT, pose.reload >= 0 || !armed ? 1 : 0, dt * 8);
    this.shootT = Math.max(0, this.shootT - dt * 5);
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

    // shared stride phase: faster when moving faster, slower when crouch-walking
    const cycle = this.loRun.getClip().duration;
    this.phase = (this.phase + (dt / cycle) * clamp(speed / 5.0, 0.45, 1.5) * (moving ? 1 : 0)) % 1;
    const air = pose.grounded ? 1 : 0.35;
    for (const a of [this.loRun, this.loBack, this.loLeft, this.loRight, this.upAimRun, this.upSprint]) {
      a.time = this.phase * a.getClip().duration;
    }

    const m = this.moveT * air + (1 - air) * 0.6;
    this.loIdle.setEffectiveWeight(1 - m);
    this.loRun.setEffectiveWeight(m * this.wF);
    this.loBack.setEffectiveWeight(m * this.wB);
    this.loLeft.setEffectiveWeight(m * this.wL);
    this.loRight.setEffectiveWeight(m * this.wR);

    // upper body: aim (idle or running), sprint carry, lowered (reload / throwable), shoot kick
    const shoot = this.shootT;
    const low = this.lowT * (1 - this.sprintT);
    const sprint = this.sprintT;
    const aim = Math.max(0, 1 - low - sprint);
    const runAim = aim * this.moveT;
    this.upAim.setEffectiveWeight((aim - runAim) * (1 - shoot * 0.85));
    this.upAimRun.setEffectiveWeight(runAim * (1 - shoot * 0.85));
    this.upSprint.setEffectiveWeight(sprint);
    this.upLow.setEffectiveWeight(low);
    this.upShoot.setEffectiveWeight(shoot * 0.85 * aim);
    if (shoot > 0) this.upShoot.time = (1 - shoot) * Math.min(0.3, this.upShoot.getClip().duration);

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
      _q1.setFromAxisAngle(_v5, pose.pitch * 0.3);
      rotateBoneWorld(this.chest, _q1);
    }
    if (this.head) {
      // keep the head level-ish while the torso leans
      _q1.setFromAxisAngle(_v5, lean * 0.6);
      rotateBoneWorld(this.head, _q1);
    }

    // ---- weapon: held at the right hand, always pointing where the character aims ----
    if (this.handR) {
      this.handR.getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      let pitch = pose.pitch;
      let yaw = 0;
      let roll = 0;
      if (this.sprintT > 0) {
        pitch = lerp(pitch, -0.9, this.sprintT);
        yaw = 0.5 * this.sprintT;
      }
      if (pose.reload >= 0 && armed) {
        const r = Math.sin(Math.PI * clamp(pose.reload, 0, 1));
        pitch += 0.35 * r;
        roll = 0.6 * r;
      }
      if (this.throwT >= 0) {
        this.throwT += dt / 0.42;
        const t = clamp(this.throwT, 0, 1);
        pitch += t < 0.35 ? lerp(0, 0.9, t / 0.35) : lerp(0.9, -0.6, (t - 0.35) / 0.65);
        if (this.throwT >= 1) this.throwT = -1;
      }
      pitch += this.recoil * 0.1;
      this.gunMount.position.set(_v1.x, _v1.y, _v1.z - 0.04 + this.recoil * 0.04);
      this.gunMount.rotation.set(pitch, yaw, roll, 'YXZ');
    }
  }

  /**
   * Hanging from balloons: both hands up on the strings, legs dangling, the whole body
   * swinging gently under the grip like a pendulum.
   */
  private hangFrom(dt: number, pose: CharacterPose): void {
    if (this.hangT < 0) this.hangT = 0;
    this.hangT += dt;
    const t = this.hangT + this.phase * 10;
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
    this.mouth?.dispose();
    this.root.removeFromParent();
  }
}

