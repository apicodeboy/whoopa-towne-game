import * as THREE from 'three';
import { approach, damp, forwardFromYawPitch, lerp, rightFromYaw, type Vec3 } from '@shared/math';
import { Q_CAMERA, type PhysicsWorld } from '@shared/sim/physics';

const CAM_RADIUS = 0.2;
// the character sits left of the crosshair (gun side toward the middle of the screen), close
// enough that the gun reads, and over the right shoulder when aiming
const DIST_HIP = 2.6;
const DIST_AIM = 1.7;
const SHOULDER_HIP = 0.85;
const SHOULDER_AIM = 0.78;
/** Indoors (a ceiling overhead) the boom comes in this much, so rooms and halls stay readable. */
const INDOOR_DIST = 0.7;
const INDOOR_SHOULDER = 0.82;
const PIVOT_STAND = 1.5;
const PIVOT_CROUCH = 1.02;
const RISE = 0.2;

const _fwd: Vec3 = { x: 0, y: 0, z: 0 };
const _right: Vec3 = { x: 0, y: 0, z: 0 };

/** Converts a horizontal FOV measured at 16:9 into the vertical FOV Three.js cameras use. */
export function verticalFov(horizontalDeg: number): number {
  const h = (horizontalDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) * (9 / 16)) * 180) / Math.PI;
}

/**
 * Third-person over-the-shoulder camera.
 *  - zooms in and tightens toward the shoulder while aiming
 *  - can swap shoulders
 *  - sphere-casts against the world so it never clips through walls: it snaps in
 *    instantly when blocked and eases back out when clear
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Target shoulder: +1 right, -1 left. */
  side = 1;
  /** 0..1 aim blend (read by the HUD for the reticle). */
  aimT = 0;
  /** Current boom length after collision. */
  dist = DIST_HIP;
  /** Base horizontal FOV from settings. */
  baseFov = 95;
  /** FOV multiplier of the current weapon when fully aimed. */
  aimFovMult = 0.75;
  /**
   * Special views (JUMP OFF THE PORCH): a long boom around the blimp, the camera up above a
   * skydiver. `dist` = boom length, `height` = pivot height above the target position.
   */
  mode: { dist: number; height: number } | null = null;

  private sideT = 1;
  private crouchT = 0;
  private sprintT = 0;
  private shoulderNow = SHOULDER_HIP;
  /** 0 outdoors .. 1 under a ceiling (eased). */
  private indoorT = 0;
  private pivotH = PIVOT_STAND;
  private shakeAmp = 0;
  private shakeT = 0;
  private kickPitch = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(verticalFov(this.baseFov), aspect, 0.08, 420);
    this.camera.rotation.order = 'YXZ';
  }

  swapShoulder(): void {
    this.side = -this.side;
  }

  /** Adds trauma (explosions, taking damage). */
  shake(amount: number): void {
    this.shakeAmp = Math.min(1.2, this.shakeAmp + amount);
  }

  /** Purely visual upward kick when firing (the real recoil is applied to the aim itself). */
  kick(amount: number): void {
    this.kickPitch = Math.min(0.06, this.kickPitch + amount);
  }

  /** Ratio of current FOV to base FOV (used to scale look sensitivity while zoomed). */
  get zoomScale(): number {
    return this.camera.fov / verticalFov(this.baseFov);
  }

  /**
   * Camera position for a player at feet position (px,py,pz) using the rig's current
   * (smoothed, collision-resolved) boom. This is the aim-ray origin sent to the server.
   */
  positionFor(px: number, py: number, pz: number, yaw: number, pitch: number, out: Vec3): Vec3 {
    forwardFromYawPitch(yaw, pitch, _fwd);
    rightFromYaw(yaw, _right);
    out.x = px + _right.x * this.shoulderNow - _fwd.x * this.dist;
    out.y = py + this.pivotH + RISE - _fwd.y * this.dist;
    out.z = pz + _right.z * this.shoulderNow - _fwd.z * this.dist;
    return out;
  }

  update(
    dt: number,
    px: number, py: number, pz: number,
    yaw: number, pitch: number,
    aiming: boolean, crouching: boolean, sprinting: boolean,
    phys: PhysicsWorld,
  ): void {
    this.aimT = approach(this.aimT, aiming ? 1 : 0, dt * 8.5);
    this.sideT = approach(this.sideT, this.side, dt * 7);
    this.crouchT = approach(this.crouchT, crouching ? 1 : 0, dt * 7);
    this.sprintT = approach(this.sprintT, sprinting ? 1 : 0, dt * 4);

    const aimE = this.aimT * this.aimT * (3 - 2 * this.aimT);
    const mode = this.mode;
    this.pivotH = mode ? mode.height - RISE : lerp(PIVOT_STAND, PIVOT_CROUCH, this.crouchT);
    // a ceiling within a floor's height above the head: indoors
    const ceiling = mode ? -1 : phys.raycast(px, py + 1.2, pz, 0, 1, 0, 2.6, Q_CAMERA);
    this.indoorT = approach(this.indoorT, ceiling >= 0 ? 1 : 0, dt * 3);
    const indoorE = this.indoorT * this.indoorT * (3 - 2 * this.indoorT);
    const wantShoulder = mode ? 0 : lerp(SHOULDER_HIP, SHOULDER_AIM, aimE) * this.sideT * lerp(1, INDOOR_SHOULDER, indoorE);
    const wantDist = mode ? mode.dist : lerp(DIST_HIP, DIST_AIM, aimE) * lerp(1, INDOOR_DIST, indoorE * (1 - aimE * 0.6));

    forwardFromYawPitch(yaw, pitch, _fwd);
    rightFromYaw(yaw, _right);

    const pivX = px, pivY = py + this.pivotH + RISE, pivZ = pz;

    // 1) slide out to the shoulder, stopping at walls
    let shoulder = wantShoulder;
    const sLen = Math.abs(wantShoulder);
    if (sLen > 0.01) {
      const sgn = Math.sign(wantShoulder);
      const t = phys.sphereCast(pivX, pivY, pivZ, _right.x * sgn, 0, _right.z * sgn, CAM_RADIUS, sLen, Q_CAMERA);
      if (t >= 0) shoulder = sgn * Math.max(0, t - 0.02);
    }
    this.shoulderNow = shoulder;
    const sx = pivX + _right.x * shoulder;
    const sy = pivY;
    const sz = pivZ + _right.z * shoulder;

    // 2) boom back from the shoulder, stopping at walls
    let allowed = wantDist;
    const t = phys.sphereCast(sx, sy, sz, -_fwd.x, -_fwd.y, -_fwd.z, CAM_RADIUS, wantDist, Q_CAMERA);
    if (t >= 0) allowed = Math.max(0.12, t - 0.04);
    if (allowed < this.dist) this.dist = allowed; // snap in: never show the inside of a wall
    else this.dist = approach(this.dist, allowed, dt * (mode ? Math.max(7, allowed) : 7)); // ease back out

    const cam = this.camera;
    cam.position.set(sx - _fwd.x * this.dist, sy - _fwd.y * this.dist, sz - _fwd.z * this.dist);

    // shake + visual kick (do not affect aim)
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.2);
    this.kickPitch = lerp(this.kickPitch, 0, damp(14, dt));
    this.shakeT += dt * 38;
    const sh = this.shakeAmp * this.shakeAmp;
    const shakeYaw = Math.sin(this.shakeT * 1.13) * 0.02 * sh;
    const shakePitch = Math.cos(this.shakeT * 0.87) * 0.02 * sh;
    const shakeRoll = Math.sin(this.shakeT * 1.31) * 0.025 * sh;
    cam.rotation.set(pitch + shakePitch + this.kickPitch, yaw + shakeYaw, shakeRoll, 'YXZ');

    const fov = verticalFov(this.baseFov) * lerp(1, this.aimFovMult, aimE) + this.sprintT * 3;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
