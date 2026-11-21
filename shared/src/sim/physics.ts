import { PLAYER } from '../config/game';
import type { MapDef } from '../map/types';
import { solidQuat } from '../map/types';

/**
 * The Rapier module instance. Shared code never imports Rapier itself: the client and the
 * server each load + init the WASM build and hand it in, so there is exactly one instance.
 */
export type Rapier = typeof import('@dimforge/rapier3d-compat').default;
type World = InstanceType<Rapier['World']>;
type Collider = ReturnType<World['createCollider']>;
type CharacterController = ReturnType<World['createCharacterController']>;
type Ray = InstanceType<Rapier['Ray']>;

// Collision group bits
export const GROUP_SOLID = 0x0001;
export const GROUP_FENCE = 0x0002;
export const GROUP_PLAYER = 0x0004;
/** Window glass: stops people, grenades and the camera, not bullets (a shot breaks it). */
export const GROUP_GLASS = 0x0008;

function groups(membership: number, filter: number): number {
  return ((membership << 16) | filter) >>> 0;
}

/** Query masks. */
export const Q_BULLET = groups(0xffff, GROUP_SOLID);
export const Q_MOVE = groups(GROUP_PLAYER, GROUP_SOLID | GROUP_FENCE | GROUP_GLASS);
export const Q_CAMERA = groups(0xffff, GROUP_SOLID | GROUP_GLASS);
export const Q_PROJECTILE = groups(0xffff, GROUP_SOLID | GROUP_FENCE | GROUP_GLASS);
/** Just the world's solid parts (ledges: glass is not something to grab). */
export const Q_SOLID = groups(0xffff, GROUP_SOLID);
/** Fences only (bots looking for one low enough to jump). */
export const Q_FENCE = groups(0xffff, GROUP_FENCE);

export interface MoveResult {
  x: number;
  y: number;
  z: number;
  grounded: boolean;
}

/** Gap the character controller keeps between the capsule and geometry. */
const SKIN = 0.02;
const STAND_HALF = PLAYER.height / 2 - PLAYER.radius;
const CROUCH_HALF = PLAYER.crouchHeight / 2 - PLAYER.radius;
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Static collision world built from a MapDef, plus the queries gameplay needs:
 * character movement (kinematic character controller), hitscan rays, camera sphere casts.
 *
 * Players never collide with each other, so one shared pair of capsule "probes"
 * (standing / crouching) is enough for every character on this world. That also makes
 * client-side prediction replays cheap: set probe position, compute, repeat.
 */
export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: World;
  /** Normal of the last successful `raycast(..., wantNormal=true)` / `sphereCast`. */
  readonly hitNormal = { x: 0, y: 1, z: 0 };
  /** Playable area (players in the air are kept inside it). */
  readonly bounds: MapDef['bounds'];

  private controller: CharacterController;
  private standProbe: Collider;
  private crouchProbe: Collider;
  private ray: Ray;
  private vTmp = { x: 0, y: 0, z: 0 };
  private vTmp2 = { x: 0, y: 0, z: 0 };
  private standShape: InstanceType<Rapier['Capsule']>;
  private ballCache = new Map<number, InstanceType<Rapier['Ball']>>();

  constructor(R: Rapier, map: MapDef) {
    this.R = R;
    this.bounds = { ...map.bounds };
    this.world = new R.World({ x: 0, y: 0, z: 0 });

    for (const s of map.solids) {
      const col = s.col ?? 'solid';
      if (col === 'none') continue;
      const desc = R.ColliderDesc.cuboid(s.sx / 2, s.sy / 2, s.sz / 2)
        .setTranslation(s.x, s.y, s.z)
        .setRotation(solidQuat(s))
        .setCollisionGroups(groups(col === 'fence' ? GROUP_FENCE : GROUP_SOLID, 0xffff));
      this.world.createCollider(desc);
    }

    const probeGroups = groups(GROUP_PLAYER, GROUP_SOLID | GROUP_FENCE | GROUP_GLASS);
    this.standProbe = this.world.createCollider(
      R.ColliderDesc.capsule(STAND_HALF, PLAYER.radius).setTranslation(0, -100, 0).setCollisionGroups(probeGroups),
    );
    this.crouchProbe = this.world.createCollider(
      R.ColliderDesc.capsule(CROUCH_HALF, PLAYER.radius).setTranslation(0, -100, 0).setCollisionGroups(probeGroups),
    );
    this.standShape = new R.Capsule(STAND_HALF, PLAYER.radius - 0.03);

    const cc = this.world.createCharacterController(SKIN);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    cc.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    cc.enableAutostep(0.4, 0.15, false);
    cc.enableSnapToGround(0.3);
    cc.setApplyImpulsesToDynamicBodies(false);
    this.controller = cc;

    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

    // Scene queries only see colliders after a step.
    this.world.step();
  }

  /** Set when a collider was switched on or off; the next query refreshes the scene first. */
  private dirty = false;
  private toggles: Collider[] = [];

  /**
   * Adds a box that can be switched on and off (doors, window panes). Returns its handle for
   * `setEnabled`. `glass` boxes stop movement, grenades and the camera but not bullets.
   */
  addToggleBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, glass: boolean, enabled: boolean): number {
    const desc = this.R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(x, y, z)
      .setRotation(solidQuat({ ry }))
      .setCollisionGroups(groups(glass ? GROUP_GLASS : GROUP_SOLID, 0xffff));
    const c = this.world.createCollider(desc);
    c.setEnabled(enabled);
    this.toggles.push(c);
    this.dirty = true;
    return this.toggles.length - 1;
  }

  setEnabled(handle: number, on: boolean): void {
    const c = this.toggles[handle];
    if (!c || c.isEnabled() === on) return;
    c.setEnabled(on);
    this.dirty = true;
  }

  private refresh(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.world.step();
  }

  /**
   * Slides a character capsule from feet position (x,y,z) by the desired delta.
   * Writes the resulting feet position and grounded flag into `out`.
   */
  moveCharacter(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    crouching: boolean, out: MoveResult,
  ): void {
    this.refresh();
    const probe = crouching ? this.crouchProbe : this.standProbe;
    const center = (crouching ? PLAYER.crouchHeight : PLAYER.height) / 2;
    const p = this.vTmp;
    p.x = x; p.y = y + center; p.z = z;
    probe.setTranslation(p);
    const d = this.vTmp2;
    d.x = dx; d.y = dy; d.z = dz;
    this.controller.computeColliderMovement(probe, d, undefined, Q_MOVE);
    const m = this.controller.computedMovement();
    out.x = x + m.x;
    out.y = y + m.y;
    out.z = z + m.z;
    out.grounded = this.controller.computedGrounded();
  }

  /** True if a standing capsule fits at this feet position (used to stand up from a crouch and by the nav grid). */
  canStandAt(x: number, y: number, z: number): boolean {
    this.refresh();
    const p = this.vTmp;
    p.x = x; p.y = y + PLAYER.height / 2 + 0.06; p.z = z;
    return this.world.intersectionWithShape(p, IDENTITY_ROT, this.standShape, undefined, Q_MOVE) === null;
  }

  /**
   * Casts a ray. Direction must be normalized. Returns the hit distance, or -1 if nothing
   * was hit within maxDist. With wantNormal the surface normal lands in `hitNormal`.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number, mask: number, wantNormal = false,
  ): number {
    this.refresh();
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    if (wantNormal) {
      const hit = this.world.castRayAndGetNormal(r, maxDist, true, undefined, mask);
      if (!hit) return -1;
      this.hitNormal.x = hit.normal.x;
      this.hitNormal.y = hit.normal.y;
      this.hitNormal.z = hit.normal.z;
      return hit.timeOfImpact;
    }
    const hit = this.world.castRay(r, maxDist, true, undefined, mask);
    return hit ? hit.timeOfImpact : -1;
  }

  /** True if nothing solid is between the two points. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mask = Q_BULLET): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, mask) < 0;
  }

  /** Sweeps a sphere. Direction must be normalized. Returns travel distance until contact, or -1. */
  sphereCast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    radius: number, maxDist: number, mask: number,
  ): number {
    this.refresh();
    const key = Math.round(radius * 1000);
    let ball = this.ballCache.get(key);
    if (!ball) {
      ball = new this.R.Ball(radius);
      this.ballCache.set(key, ball);
    }
    const p = this.vTmp;
    p.x = ox; p.y = oy; p.z = oz;
    const d = this.vTmp2;
    d.x = dx; d.y = dy; d.z = dz;
    const hit = this.world.castShape(p, IDENTITY_ROT, d, ball, 0, maxDist, true, undefined, mask);
    if (!hit) return -1;
    this.hitNormal.x = hit.normal1.x;
    this.hitNormal.y = hit.normal1.y;
    this.hitNormal.z = hit.normal1.z;
    return hit.time_of_impact;
  }

  dispose(): void {
    this.world.free();
  }
}
