import * as THREE from 'three';
import { GRENADE, SMOKE, TICK_DT } from '@shared/config/game';
import { stepProjectile, throwLaunch, type Projectile, type Thrower } from '@shared/sim/game';
import { Q_PROJECTILE, type PhysicsWorld } from '@shared/sim/physics';

const DOTS = 64;
const MAX_TICKS = Math.ceil(Math.max(GRENADE.fuse, SMOKE.fuse) / TICK_DT) + 1;

/**
 * Where a throw will go, shown while a grenade or smoke is lined up (AIM with it in hand): a
 * line of dots along the path and a ring where it goes off, with the reach of the blast (or the
 * smoke) around it. The path is worked out with the very same launch and bounce code the server
 * runs when it is thrown, so it is the throw itself, not a guess: it bounces off what the real
 * one would bounce off, and ends where the real one goes off.
 */
export class ThrowArc {
  readonly group = new THREE.Group();
  private readonly dots: THREE.InstancedMesh;
  private readonly dotMat: THREE.MeshBasicMaterial;
  private readonly spot: THREE.Mesh;
  /** A bead right where it goes off (reads even when the ring is seen edge-on). */
  private readonly bead: THREE.Mesh;
  private readonly spotMat: THREE.MeshBasicMaterial;
  private readonly area: THREE.Mesh;
  private readonly areaMat: THREE.MeshBasicMaterial;
  private readonly fill: THREE.Mesh;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly pts = new Float32Array(MAX_TICKS * 3 + 3);
  private readonly p: Projectile = { id: 0, owner: 0, type: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, resting: false };
  private readonly launch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private shown = 0;
  private march = 0;
  private type = -1;

  constructor() {
    this.group.name = 'throwArc';
    this.group.visible = false;
    const dotGeo = new THREE.SphereGeometry(1, 10, 6);
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.dots = new THREE.InstancedMesh(dotGeo, this.dotMat, DOTS);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 20;
    // where it goes off: a small ring (seen through walls, to throw over cover) ...
    const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
    this.spotMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    this.spot = new THREE.Mesh(flat(new THREE.RingGeometry(0.22, 0.36, 40)), this.spotMat);
    this.spot.renderOrder = 21;
    this.bead = new THREE.Mesh(dotGeo, this.spotMat);
    this.bead.renderOrder = 21;
    // ... and how far it reaches, on the ground round it
    this.areaMat = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.area = new THREE.Mesh(flat(new THREE.RingGeometry(0.93, 1, 96)), this.areaMat);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.fill = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 64)), this.fillMat);
    this.area.renderOrder = this.fill.renderOrder = 19;
    this.group.add(this.dots, this.spot, this.bead, this.area, this.fill);
  }

  /**
   * Call every frame. `show` is whether a throw is being lined up; `who` is the thrower as of now
   * (the aim it would leave the hand with), `type` 0 for a grenade, 1 for smoke.
   */
  update(dt: number, show: boolean, who: Thrower, type: number, phys: PhysicsWorld, camera: THREE.Camera): void {
    this.shown = Math.max(0, Math.min(1, this.shown + (show ? dt * 7 : -dt * 9)));
    this.group.visible = this.shown > 0.01;
    if (!this.group.visible || !show) {
      this.setOpacity();
      return;
    }
    if (type !== this.type) {
      this.type = type;
      const c = type === 0 ? 0xff6a3d : 0xd5dde8;
      this.areaMat.color.setHex(c);
      this.fillMat.color.setHex(c);
      this.dotMat.color.setHex(type === 0 ? 0xfff1c9 : 0xeef4ff);
      this.spotMat.color.copy(this.dotMat.color);
    }

    // fly it, tick by tick, exactly as the server will
    throwLaunch(who, phys, this.launch);
    const p = this.p, l = this.launch, pts = this.pts;
    p.x = l.x; p.y = l.y; p.z = l.z; p.vx = l.vx; p.vy = l.vy; p.vz = l.vz;
    p.type = type;
    p.fuse = type === 0 ? GRENADE.fuse : SMOKE.fuse;
    p.resting = false;
    let n = 0;
    pts[0] = p.x; pts[1] = p.y; pts[2] = p.z;
    n = 1;
    while (p.fuse > 0 && n < MAX_TICKS) {
      stepProjectile(p, TICK_DT, phys);
      pts[n * 3] = p.x; pts[n * 3 + 1] = p.y; pts[n * 3 + 2] = p.z;
      n++;
      if (p.resting) break;
    }

    // dots spaced evenly along the path, drifting toward where it lands
    let len = 0;
    for (let i = 1; i < n; i++) len += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    const gap = Math.max(0.42, len / DOTS);
    this.march = (this.march + dt * 1.6) % gap;
    const cam = camera.position;
    let want = 0.7 + this.march; // (none right at the hand)
    let along = 0, k = 0;
    for (let i = 1; i < n && k < DOTS; i++) {
      const ax = pts[i * 3 - 3], ay = pts[i * 3 - 2], az = pts[i * 3 - 1];
      const seg = Math.hypot(pts[i * 3] - ax, pts[i * 3 + 1] - ay, pts[i * 3 + 2] - az);
      while (want <= along + seg && k < DOTS) {
        const t = seg > 1e-6 ? (want - along) / seg : 0;
        this.v.set(ax + (pts[i * 3] - ax) * t, ay + (pts[i * 3 + 1] - ay) * t, az + (pts[i * 3 + 2] - az) * t);
        // about the same size on screen near and far
        const s = 0.026 + this.v.distanceTo(cam) * 0.0032;
        this.m.makeScale(s, s, s).setPosition(this.v);
        this.dots.setMatrixAt(k++, this.m);
        want += gap;
      }
      along += seg;
    }
    this.dots.count = k;
    this.dots.instanceMatrix.needsUpdate = true;

    // the ring where it goes off, on the ground under it (smoke can pop before it lands)
    const ex = pts[(n - 1) * 3], ey = pts[(n - 1) * 3 + 1], ez = pts[(n - 1) * 3 + 2];
    const down = phys.raycast(ex, ey + 0.3, ez, 0, -1, 0, 40, Q_PROJECTILE);
    const gy = down >= 0 ? ey + 0.3 - down : ey;
    const s = 0.8 + Math.min(2.2, this.v.set(ex, gy, ez).distanceTo(cam) * 0.045);
    this.spot.position.set(ex, gy + 0.05, ez);
    this.spot.scale.setScalar(s);
    this.bead.position.set(ex, ey + 0.02, ez);
    this.bead.scale.setScalar(0.06 + this.v.distanceTo(cam) * 0.006);
    const r = type === 0 ? GRENADE.radius : SMOKE.radius;
    this.area.position.set(ex, gy + 0.04, ez);
    this.area.scale.setScalar(r);
    this.fill.position.set(ex, gy + 0.035, ez);
    this.fill.scale.setScalar(r);
    this.setOpacity();
  }

  private setOpacity(): void {
    const a = this.shown;
    this.dotMat.opacity = 0.92 * a;
    this.spotMat.opacity = 0.95 * a;
    this.areaMat.opacity = 0.55 * a;
    this.fillMat.opacity = 0.1 * a;
  }

  hide(): void {
    this.shown = 0;
    this.group.visible = false;
  }

  dispose(): void {
    this.dots.geometry.dispose();
    this.dotMat.dispose();
    for (const m of [this.spot, this.area, this.fill]) m.geometry.dispose();
    this.spotMat.dispose();
    this.areaMat.dispose();
    this.fillMat.dispose();
  }
}
