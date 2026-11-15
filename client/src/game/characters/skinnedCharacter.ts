import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { approach, clamp, damp, lerp } from '@shared/math';
import { CHARACTER_MESH, characterGeometry, type Assets, type CharacterTemplate, type ModelTemplate } from '../assets';
import type { CharacterPose, CharacterVisual, HeldItem } from './characterTypes';

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

/**
 * A rigged CC0 character (Quaternius) driven by its own animation clips:
 * legs and torso are animated separately so the character can run / strafe / backpedal
 * while the upper body keeps the weapon up, with procedural aim pitch, a crouch (hips
 * lowered + two-bone leg IK onto the animated feet), recoil, reload and death.
 */
export class SkinnedCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: ClipSet;
  private assets: Assets;
  private template: CharacterTemplate;
  /** The single merged mesh (when the template could be merged). */
  private skin: THREE.SkinnedMesh | null = null;
  private tintMat: THREE.MeshStandardMaterial | null = null;
  private ownedMats: THREE.Material[] = [];

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
  private all: THREE.AnimationAction[] = [];

  private body: THREE.Object3D | null;
  private spine: THREE.Object3D | null;
  private chest: THREE.Object3D | null;
  private head: THREE.Object3D | null;
  private handR: THREE.Object3D | null;
  private legs: Leg[] = [];
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

  constructor(template: CharacterTemplate, assets: Assets, team: TeamId) {
    this.assets = assets;
    this.template = template;
    this.clips = splitClips(template);
    this.model = cloneSkinned(template.scene);
    this.model.scale.setScalar(this.clips.scale);
    // glTF models face +Z; the game's "forward" at yaw 0 is -Z
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    this.root.add(this.gunMount);
    this.gunMount.add(this.muzzle);

    const skin = template.merged ? (this.model.getObjectByName(CHARACTER_MESH) as THREE.SkinnedMesh | undefined) : undefined;
    if (skin) {
      // merged character: one mesh, crew color baked into a per-crew copy of the vertex colors
      this.skin = skin;
      // skinned bounds are not tracked per pose: cull with a fixed sphere that covers every pose
      // (standing, crouched, lying dead) around the character's feet instead
      this.root.updateMatrixWorld(true);
      const center = skin.worldToLocal(this.root.localToWorld(new THREE.Vector3(0, 0.9, 0)));
      skin.boundingSphere = new THREE.Sphere(center, 2.1 / skin.matrixWorld.getMaxScaleOnAxis());
      skin.frustumCulled = true;
    } else {
      // unmerged fallback: per-instance copy of the crew-colored material
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.frustumCulled = false;
        const swap = (mat: THREE.Material): THREE.Material => {
          if (mat.name !== template.tint) return mat;
          if (!this.tintMat) {
            this.tintMat = (mat as THREE.MeshStandardMaterial).clone();
            this.ownedMats.push(this.tintMat);
          }
          return this.tintMat;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      });
    }
    this.setTeam(team);

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
    }

    const adjusted = new Set<THREE.Object3D>();
    for (const b of [this.body, this.spine, this.chest, this.head]) if (b) adjusted.add(b);
    for (const leg of this.legs) {
      adjusted.add(leg.upper);
      adjusted.add(leg.lower);
    }
    for (const b of adjusted) this.touched.push({ bone: b, q: b.quaternion.clone(), p: b.position.clone() });

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
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
    this.death.stop();
    // locomotion + shoot clips are scrubbed by hand so the leg cycles stay in sync
    for (const a of [this.loRun, this.loBack, this.loLeft, this.loRight, this.upAimRun, this.upSprint, this.upShoot]) a.timeScale = 0;
  }

  setTeam(team: TeamId): void {
    if (this.skin) {
      const g = characterGeometry(this.template, team);
      if (g) this.skin.geometry = g;
    } else {
      this.tintMat?.color.setHex(crewColorHex(team));
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
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
    const template: ModelTemplate | null = item === 'none' ? null : this.assets.model(key);
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

    if (this.dead) {
      this.mixer.update(dt);
      return;
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

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.ownedMats) m.dispose();
    this.root.removeFromParent();
  }
}

