import * as THREE from 'three';
import { BOTTOM_COLORS, SHOE_COLORS, SKIN_TONES, type Appearance } from '@shared/config/appearance';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { approach, clamp, damp, lerp, lerpAngle, wrapAngle } from '@shared/math';
import type { CharacterPose, CharacterVisual, HeldItem } from './characterTypes';
import { MOUTH_SCALE, createMouthAccessory, type MouthAccessory } from './mouthAccessories';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const LEG = 0.44;
const UPPER_ARM = 0.29;
const FORE_ARM = 0.27;
const HIP_STAND = 0.92;
const HIP_CROUCH = 0.56;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A box "bone" that hangs down from its origin. */
function bone(len: number, w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, len, d);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

interface WeaponModel {
  group: THREE.Group;
  /** Muzzle offset along -Z from the grip. */
  muzzleZ: number;
  /** Where the support hand goes, in weapon space. */
  leftGrip: THREE.Vector3;
  /** Hip / aim offsets of the grip relative to the chest pivot. */
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  twoHanded: boolean;
}

/** Simple box-built stand-ins for each weapon. The art pass can swap these for real models. */
export function buildWeaponModel(item: HeldItem): WeaponModel {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.6, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.2, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.8, flatShading: true });
  const model: WeaponModel = {
    group: g, muzzleZ: -0.5, leftGrip: new THREE.Vector3(0, -0.03, -0.32),
    hip: new THREE.Vector3(0.17, -0.1, -0.34), ads: new THREE.Vector3(0.085, 0.15, -0.3), twoHanded: true,
  };
  switch (item) {
    case 'sniper':
    case 'ar':
      g.add(box(0.06, 0.09, 0.42, metal, 0, 0.02, -0.12));
      g.add(box(0.03, 0.03, 0.3, dark, 0, 0.035, -0.46));
      g.add(box(0.05, 0.08, 0.24, dark, 0, 0.0, 0.2));
      g.add(box(0.04, 0.17, 0.07, dark, 0, -0.11, -0.1));
      g.add(box(0.04, 0.1, 0.05, dark, 0, -0.07, 0.05));
      g.add(box(0.05, 0.05, 0.2, dark, 0, -0.01, -0.36));
      g.add(box(0.02, 0.035, 0.14, dark, 0, 0.085, -0.1));
      model.muzzleZ = -0.62;
      model.leftGrip.set(0, -0.04, -0.36);
      break;
    case 'smg':
      g.add(box(0.06, 0.1, 0.3, metal, 0, 0.01, -0.06));
      g.add(box(0.03, 0.03, 0.12, dark, 0, 0.03, -0.27));
      g.add(box(0.035, 0.21, 0.05, dark, 0, -0.14, -0.05));
      g.add(box(0.04, 0.1, 0.05, dark, 0, -0.07, 0.07));
      g.add(box(0.02, 0.02, 0.2, dark, 0, 0.03, 0.19));
      g.add(box(0.02, 0.08, 0.02, dark, 0, 0.0, 0.28));
      model.muzzleZ = -0.34;
      model.leftGrip.set(0, -0.05, -0.2);
      model.hip.set(0.16, -0.1, -0.3);
      break;
    case 'shotgun':
      g.add(box(0.06, 0.09, 0.3, metal, 0, 0.01, -0.02));
      g.add(box(0.035, 0.035, 0.5, dark, 0, 0.03, -0.42));
      g.add(box(0.03, 0.03, 0.4, dark, 0, -0.012, -0.38));
      g.add(box(0.055, 0.055, 0.16, wood, 0, -0.015, -0.36));
      g.add(box(0.05, 0.09, 0.26, wood, 0, -0.02, 0.26));
      g.add(box(0.04, 0.09, 0.05, wood, 0, -0.07, 0.1));
      model.muzzleZ = -0.68;
      model.leftGrip.set(0, -0.04, -0.36);
      break;
    case 'pistol':
      g.add(box(0.035, 0.05, 0.2, metal, 0, 0.035, -0.07));
      g.add(box(0.035, 0.11, 0.05, dark, 0, -0.035, 0.0));
      model.muzzleZ = -0.18;
      model.leftGrip.set(-0.035, -0.03, 0.0);
      model.hip.set(0.1, -0.02, -0.42);
      model.ads.set(0.03, 0.2, -0.44);
      break;
    case 'grenade': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3c4a2f, roughness: 0.7, flatShading: true }));
      m.castShadow = true;
      g.add(m);
      g.add(box(0.03, 0.04, 0.03, metal, 0, 0.06, 0));
      model.twoHanded = false;
      model.muzzleZ = 0;
      model.hip.set(0.24, -0.16, -0.22);
      model.ads.copy(model.hip);
      break;
    }
    case 'smoke': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, flatShading: true }));
      m.castShadow = true;
      g.add(m);
      model.twoHanded = false;
      model.muzzleZ = 0;
      model.hip.set(0.24, -0.16, -0.22);
      model.ads.copy(model.hip);
      break;
    }
    default:
      model.twoHanded = false;
      model.hip.set(0.26, -0.3, -0.05);
      model.ads.copy(model.hip);
  }
  return model;
}

interface Leg {
  upper: THREE.Mesh;
  lower: THREE.Mesh;
}

/**
 * A low-poly character built from boxes and animated in code (no asset files):
 * run cycle, strafing, crouch, aim, recoil, reload, throw, hit flinch and death.
 * Also serves as the fallback when skinned character models are unavailable.
 */
export class ProceduralCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private legs = new THREE.Group();
  private legL: Leg;
  private legR: Leg;
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private armLU: THREE.Mesh;
  private armLF: THREE.Mesh;
  private armRU: THREE.Mesh;
  private armRF: THREE.Mesh;
  private weaponPivot = new THREE.Group();
  private weaponMount = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private weaponModel: WeaponModel;
  private held: HeldItem = 'none';

  private jacketMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private mats: THREE.Material[] = [];

  private phase = Math.random() * 6;
  private crouchT = 0;
  private aimT = 0;
  private sprintT = 0;
  private airT = 0;
  private recoil = 0;
  private flinch = 0;
  private throwT = -1;
  private deathT = -1;
  private deathAxis = new THREE.Vector3(1, 0, 0);
  private legsYaw = 0;
  private idleT = Math.random() * 10;

  private shoulderL = new THREE.Vector3(-0.24, 0.46, 0);
  private shoulderR = new THREE.Vector3(0.24, 0.46, 0);

  private mouth: MouthAccessory | null = null;

  /** The stand-in used when the character models are unavailable; it wears the look's colors. */
  constructor(team: TeamId, seed = 0, look?: Readonly<Appearance>) {
    const skinTones = [0xe0ac69, 0xc68642, 0x8d5524, 0xf1c27d, 0x6b4423];
    const hex = (list: typeof SKIN_TONES, id: string | undefined) => list.find((o) => o.id === id)?.color;
    const skin = new THREE.MeshStandardMaterial({ color: hex(SKIN_TONES, look?.skin) ?? skinTones[seed % skinTones.length], roughness: 0.8, flatShading: true });
    const pants = new THREE.MeshStandardMaterial({ color: hex(BOTTOM_COLORS, look?.bottomColor) ?? [0x23272e, 0x2d3748, 0x3b3b3b, 0x1f2a24][seed % 4], roughness: 0.9, flatShading: true });
    const shoes = new THREE.MeshStandardMaterial({ color: hex(SHOE_COLORS, look?.shoeColor) ?? 0xe8e8e8, roughness: 0.7, flatShading: true });
    const mouth = look?.mouthProp;
    this.jacketMat = new THREE.MeshStandardMaterial({ color: crewColorHex(team), roughness: 0.85, flatShading: true });
    this.accentMat = new THREE.MeshStandardMaterial({ color: crewColorHex(team, 'dark'), roughness: 0.85, flatShading: true });
    this.mats.push(skin, pants, shoes, this.jacketMat, this.accentMat);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.add(this.legs, this.spine);

    // pelvis
    this.hips.add(box(0.36, 0.16, 0.22, pants, 0, 0, 0));

    const makeLeg = (side: number): Leg => {
      const upper = bone(LEG, 0.15, 0.17, pants);
      upper.position.set(side * 0.105, -0.02, 0);
      const lower = bone(LEG, 0.13, 0.15, pants);
      lower.position.set(0, -LEG, 0);
      const foot = box(0.13, 0.08, 0.27, shoes, 0, -LEG - 0.01, -0.05);
      lower.add(foot);
      upper.add(lower);
      this.legs.add(upper);
      return { upper, lower };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // torso (hoodie / jacket in crew color) + hood detail
    this.spine.position.y = 0.06;
    this.spine.add(box(0.42, 0.5, 0.24, this.jacketMat, 0, 0.27, 0));
    this.spine.add(box(0.44, 0.1, 0.26, this.accentMat, 0, 0.06, 0));
    this.spine.add(box(0.3, 0.12, 0.14, this.accentMat, 0, 0.5, 0.1));

    // head with a cap/bandana in crew color
    this.head.position.set(0, 0.54, 0);
    this.head.add(box(0.21, 0.23, 0.22, skin, 0, 0.13, 0));
    this.head.add(box(0.23, 0.08, 0.24, this.accentMat, 0, 0.26, 0));
    this.head.add(box(0.21, 0.025, 0.12, this.accentMat, 0, 0.225, -0.16));
    this.spine.add(this.head);
    this.mouth = createMouthAccessory(mouth);
    if (this.mouth) {
      // lips: front face of the head box, a third of the way up
      this.mouth.object.position.set(0, 0.075, -0.112);
      this.mouth.object.scale.setScalar(MOUTH_SCALE);
      this.head.add(this.mouth.object);
      this.mouth.attachSmoke(this.root);
    }

    this.armLU = bone(UPPER_ARM, 0.11, 0.12, this.jacketMat);
    this.armRU = bone(UPPER_ARM, 0.11, 0.12, this.jacketMat);
    this.armLF = bone(FORE_ARM + 0.07, 0.09, 0.1, skin);
    this.armRF = bone(FORE_ARM + 0.07, 0.09, 0.1, skin);
    this.spine.add(this.armLU, this.armRU, this.armLF, this.armRF);

    this.weaponPivot.position.set(0, 0.42, 0);
    this.spine.add(this.weaponPivot);
    this.weaponPivot.add(this.weaponMount);
    this.weaponModel = buildWeaponModel('none');
    this.weaponMount.add(this.weaponModel.group);
    this.weaponMount.add(this.muzzle);
    this.setHeld('ar');
  }

  private setHeld(item: HeldItem): void {
    if (item === this.held) return;
    this.held = item;
    this.weaponMount.remove(this.weaponModel.group);
    disposeTree(this.weaponModel.group);
    this.weaponModel = buildWeaponModel(item);
    this.weaponMount.add(this.weaponModel.group);
    this.muzzle.position.set(0, 0.03, this.weaponModel.muzzleZ);
  }

  setTeam(team: TeamId): void {
    this.jacketMat.color.setHex(crewColorHex(team));
    this.accentMat.color.setHex(crewColorHex(team, 'dark'));
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  shot(): void {
    this.recoil = 1;
  }

  throwItem(): void {
    this.throwT = 0;
  }

  hit(): void {
    this.flinch = 1;
  }

  die(dx: number, dz: number): void {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    // fall away from the shot: rotate about the horizontal axis perpendicular to it (in local space)
    const yaw = this.root.rotation.y;
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    let lx = dx * c + dz * s;
    let lz = -dx * s + dz * c;
    const len = Math.hypot(lx, lz);
    if (len < 1e-3) {
      lx = 0;
      lz = 1;
    } else {
      lx /= len;
      lz /= len;
    }
    this.deathAxis.set(lz, 0, -lx); // up x dir
  }

  respawn(): void {
    this.deathT = -1;
    this.body.quaternion.identity();
    this.body.position.set(0, 0, 0);
    this.flinch = 0;
    this.recoil = 0;
    this.throwT = -1;
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  update(dt: number, pose: CharacterPose): void {
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
    this.setHeld(pose.held);
    this.mouth?.update(dt);

    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt / 0.55);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      this.body.quaternion.setFromAxisAngle(this.deathAxis, e * 1.52);
      this.body.position.y = e * 0.1;
      // go limp
      this.spine.rotation.x = lerp(this.spine.rotation.x, 0.1, damp(8, dt));
      this.head.rotation.x = lerp(this.head.rotation.x, -0.3, damp(8, dt));
      this.weaponPivot.rotation.x = lerp(this.weaponPivot.rotation.x, -1.1, damp(8, dt));
      this.solveArms(0);
      return;
    }

    const speed = Math.hypot(pose.vx, pose.vz);
    const sinY = Math.sin(pose.yaw), cosY = Math.cos(pose.yaw);
    const mvF = -pose.vx * sinY - pose.vz * cosY;
    const mvR = pose.vx * cosY - pose.vz * sinY;
    const moveAng = Math.atan2(mvR, mvF);
    const backwards = Math.abs(moveAng) > 2.0;

    this.crouchT = approach(this.crouchT, pose.crouching ? 1 : 0, dt * 7);
    this.aimT = approach(this.aimT, pose.aiming ? 1 : 0, dt * 9);
    this.sprintT = approach(this.sprintT, pose.sprinting && speed > 5.5 ? 1 : 0, dt * 6);
    this.airT = approach(this.airT, pose.grounded ? 0 : 1, dt * 9);
    this.recoil = Math.max(0, this.recoil - dt * 11);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.idleT += dt;

    // ---- legs ----
    const moving = speed > 0.3 && pose.grounded;
    const stride = clamp(speed / 5.2, 0, 1.3);
    this.phase += dt * (2.2 + speed * 1.75) * (backwards ? -1 : 1) * (moving ? 1 : 0);
    const targetLegsYaw = moving ? clamp(backwards ? wrapAngle(moveAng - Math.PI) : moveAng, -1.0, 1.0) : 0;
    this.legsYaw = lerpAngle(this.legsYaw, targetLegsYaw, damp(12, dt));
    this.legs.rotation.y = -this.legsYaw;

    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, stride) : 0;
    const breathe = Math.sin(this.idleT * 1.7) * 0.006;
    const hipH = lerp(HIP_STAND, HIP_CROUCH, this.crouchT) - bob + breathe;
    this.hips.position.y = hipH;
    const reach = clamp((hipH - 0.07) / (2 * LEG), 0.25, 1);
    const kneeBase = Math.acos(reach);
    const amp = (moving ? stride : 0) * lerp(0.72, 0.42, this.crouchT);
    this.poseLeg(this.legL, this.phase, amp, kneeBase);
    this.poseLeg(this.legR, this.phase + Math.PI, amp, kneeBase);

    // ---- upper body ----
    const lean = this.crouchT * 0.3 + this.sprintT * 0.24 + (moving ? 0.04 : 0);
    this.spine.rotation.x = -lean + pose.pitch * 0.35 + this.flinch * 0.18;
    this.spine.rotation.y = this.legsYaw * 0.15 + (moving ? Math.sin(this.phase) * 0.07 * stride : 0);
    this.spine.rotation.z = this.flinch * 0.12;
    this.head.rotation.x = pose.pitch * 0.4 + lean * 0.7;

    // ---- weapon ----
    const wm = this.weaponModel;
    let pivotPitch = pose.pitch * 0.65 + lean * 0.9;
    const mount = this.weaponMount;
    _a.copy(wm.hip).lerp(wm.ads, this.aimT);
    let rotX = 0, rotY = 0, rotZ = 0;
    if (this.sprintT > 0 && wm.twoHanded) {
      // lowered "running with a gun" carry
      _a.x = lerp(_a.x, 0.1, this.sprintT);
      _a.y = lerp(_a.y, -0.18, this.sprintT);
      _a.z = lerp(_a.z, -0.24, this.sprintT);
      rotX -= 0.75 * this.sprintT;
      rotY += 0.65 * this.sprintT;
      _a.y += Math.sin(this.phase * 2) * 0.02 * this.sprintT;
    }
    if (pose.reload >= 0 && wm.twoHanded) {
      const r = Math.sin(Math.PI * clamp(pose.reload, 0, 1));
      rotZ += 0.55 * r;
      rotX += 0.3 * r;
      _a.y -= 0.05 * r;
    }
    if (this.throwT >= 0) {
      this.throwT += dt / 0.42;
      const t = clamp(this.throwT, 0, 1);
      // wind up, then swing forward
      pivotPitch += t < 0.35 ? lerp(0, 0.9, t / 0.35) : lerp(0.9, -0.7, (t - 0.35) / 0.65);
      if (this.throwT >= 1) this.throwT = -1;
    }
    rotX += this.recoil * 0.11;
    _a.z += this.recoil * 0.045;
    // gentle sway
    _a.y += Math.sin(this.idleT * 1.7) * 0.004;
    mount.position.copy(_a);
    mount.rotation.set(rotX, rotY, rotZ);
    this.weaponPivot.rotation.x = pivotPitch;

    const reloadHand = pose.reload >= 0 && wm.twoHanded ? Math.sin(Math.PI * clamp(pose.reload * 1.15, 0, 1)) : 0;
    this.solveArms(reloadHand);
  }

  private poseLeg(leg: Leg, phase: number, amp: number, kneeBase: number): void {
    const sw = Math.sin(phase) * amp;
    const lift = Math.max(0, Math.cos(phase)) * amp * 1.1;
    leg.upper.rotation.x = kneeBase + sw + this.airT * 0.35;
    leg.lower.rotation.x = -2 * kneeBase - lift - this.airT * 0.7;
  }

  /** Two-bone IK for both arms toward the weapon grips (all in spine space). */
  private solveArms(reloadHand: number): void {
    const wm = this.weaponModel;
    const mount = this.weaponMount;
    const pivot = this.weaponPivot;

    // right hand on the grip (weapon origin)
    _a.set(0, -0.02, 0.02).applyQuaternion(mount.quaternion).add(mount.position).applyQuaternion(pivot.quaternion).add(pivot.position);
    this.solveArm(this.shoulderR, _a, this.armRU, this.armRF, 1);

    // left hand on the fore-grip, or hanging / reaching for a magazine
    if (wm.twoHanded) {
      _b.copy(wm.leftGrip).applyQuaternion(mount.quaternion).add(mount.position).applyQuaternion(pivot.quaternion).add(pivot.position);
      if (reloadHand > 0) {
        _c.set(-0.16, 0.02, -0.14); // belt / mag pouch
        _b.lerp(_c, reloadHand);
      }
    } else {
      _b.set(-0.27, 0.0, -0.06);
    }
    this.solveArm(this.shoulderL, _b, this.armLU, this.armLF, -1);
  }

  private solveArm(shoulder: THREE.Vector3, target: THREE.Vector3, upper: THREE.Mesh, fore: THREE.Mesh, side: number): void {
    const a = UPPER_ARM, b = FORE_ARM;
    _c.copy(target).sub(shoulder);
    let len = _c.length();
    if (len < 1e-4) {
      _c.set(0, -1, 0);
      len = 1;
    }
    const dir = _c.divideScalar(len);
    const L = clamp(len, Math.abs(a - b) + 0.01, a + b - 0.005);
    const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // pole: elbows point down and out
    _d.set(side * 0.55, -1, 0.25);
    _d.addScaledVector(dir, -_d.dot(dir));
    if (_d.lengthSq() < 1e-6) _d.set(side, 0, 0);
    _d.normalize();
    // elbow position
    const ex = shoulder.x + dir.x * a * cosA + _d.x * a * sinA;
    const ey = shoulder.y + dir.y * a * cosA + _d.y * a * sinA;
    const ez = shoulder.z + dir.z * a * cosA + _d.z * a * sinA;
    // hand position
    const hx = shoulder.x + dir.x * L, hy = shoulder.y + dir.y * L, hz = shoulder.z + dir.z * L;

    upper.position.copy(shoulder);
    _d.set(ex - shoulder.x, ey - shoulder.y, ez - shoulder.z).normalize();
    upper.quaternion.copy(_q.setFromUnitVectors(DOWN, _d));
    fore.position.set(ex, ey, ez);
    _d.set(hx - ex, hy - ey, hz - ez).normalize();
    fore.quaternion.copy(_q.setFromUnitVectors(DOWN, _d));
  }

  dispose(): void {
    this.mouth?.dispose(); // first: its geometry is shared, disposeTree would free it
    disposeTree(this.root);
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
    }
  });
}

export { UP as CHARACTER_UP };
