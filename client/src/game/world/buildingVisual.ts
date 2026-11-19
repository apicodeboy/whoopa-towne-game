import * as THREE from 'three';
import type { DoorKind } from '@shared/map/types';
import { BUILD, WIN_BROKEN, WIN_OPEN, type Buildings } from '@shared/sim/buildings';

/**
 * The moving parts of the explorable buildings: door leaves that swing open and shut (with a
 * handle on each side), window glass that slides up, swings out or is gone once broken. All
 * instanced: one draw call for the doors, one for their glass, one for the windows. It follows
 * the shared Buildings state (which the server's events keep current) and eases each change.
 */
const DOOR_COLOR: Record<DoorKind, number> = { wood: 0x7a5236, metal: 0x5b6168, glass: 0x3a3e44, apartment: 0x8a3a2c };
/** How far a door swings (radians). */
const SWING = 1.45;
/** Seconds a door or a window takes to move. */
const DOOR_TIME = 0.42;
const WINDOW_TIME = 0.3;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

export class BuildingVisual {
  readonly group = new THREE.Group();
  private leaves: THREE.InstancedMesh;
  private doorGlass: THREE.InstancedMesh;
  private panes: THREE.InstancedMesh;
  private disposables: Array<{ dispose(): void }> = [];
  /** Current swing of each door (radians, signed) and window opening (0..1). */
  private angle: Float32Array;
  private openness: Float32Array;
  /** Instance ranges: each door has leaf parts [first, count) in `leaves`, glass in `doorGlass`. */
  private leafAt: Int32Array;
  private leafN: Uint8Array;
  private glassAt: Int32Array;
  private paneAt: Int32Array;
  private paneN: Uint8Array;
  private seen = -1;
  private moving = new Set<number>();
  private movingWin = new Set<number>();

  constructor(readonly b: Buildings) {
    this.group.name = 'doors and windows';
    const nd = b.doors.length, nw = b.windows.length;
    this.angle = new Float32Array(nd);
    this.openness = new Float32Array(nw);
    this.leafAt = new Int32Array(nd);
    this.leafN = new Uint8Array(nd);
    this.glassAt = new Int32Array(nd).fill(-1);
    this.paneAt = new Int32Array(nw);
    this.paneN = new Uint8Array(nw);

    // a unit box with its hinge edge on the origin: x across the leaf, y up, z along it
    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0.5);
    const centered = new THREE.BoxGeometry(1, 1, 1);
    centered.translate(0, 0.5, 0);
    this.disposables.push(unit, centered);

    // count instances: a leaf (or a glass door's kick plate, rails and stiles) and two handles
    let leafCount = 0, glassCount = 0, paneCount = 0;
    b.doors.forEach((d, i) => {
      this.leafAt[i] = leafCount;
      this.leafN[i] = d.kind === 'glass' ? 6 : 3;
      leafCount += this.leafN[i];
      if (d.kind === 'glass') this.glassAt[i] = glassCount++;
    });
    b.windows.forEach((w, i) => {
      this.paneAt[i] = paneCount;
      this.paneN[i] = w.kind === 'slide' ? 2 : 1;
      paneCount += this.paneN[i];
    });

    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.1 });
    this.leaves = new THREE.InstancedMesh(unit, leafMat, Math.max(1, leafCount));
    this.leaves.count = leafCount;
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.32, roughness: 0.06, metalness: 0.4, depthWrite: false });
    this.doorGlass = new THREE.InstancedMesh(unit, glassMat, Math.max(1, glassCount));
    this.doorGlass.count = glassCount;
    this.doorGlass.renderOrder = 5;
    this.panes = new THREE.InstancedMesh(centered, glassMat, Math.max(1, paneCount));
    this.panes.count = paneCount;
    this.panes.renderOrder = 5;
    for (const m of [this.leaves, this.doorGlass, this.panes]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.leaves.castShadow = true;
    this.disposables.push(leafMat, glassMat);

    b.doors.forEach((d, i) => {
      for (let k = 0; k < this.leafN[i]; k++) {
        const handle = d.kind === 'glass' ? k >= 4 : k >= 1;
        this.leaves.setColorAt(this.leafAt[i] + k, _c.set(handle ? 0xc9c3b5 : DOOR_COLOR[d.kind]));
      }
    });
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
    this.sync(true);
  }

  /** Eases doors and windows toward their state. */
  update(dt: number): void {
    if (this.b.version !== this.seen) this.sync(false);
    if (this.moving.size) {
      for (const i of this.moving) {
        const target = this.b.open[i] ? this.b.swing[i] * SWING : 0;
        const step = (SWING / DOOR_TIME) * dt;
        const a = this.angle[i];
        this.angle[i] = Math.abs(target - a) <= step ? target : a + Math.sign(target - a) * step;
        this.placeDoor(i);
        if (this.angle[i] === target) this.moving.delete(i);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
      this.doorGlass.instanceMatrix.needsUpdate = true;
    }
    if (this.movingWin.size) {
      for (const i of this.movingWin) {
        const target = this.b.win[i] === WIN_OPEN ? 1 : 0;
        const step = dt / WINDOW_TIME;
        const o = this.openness[i];
        this.openness[i] = Math.abs(target - o) <= step ? target : o + Math.sign(target - o) * step;
        this.placeWindow(i);
        if (this.openness[i] === target || this.b.win[i] === WIN_BROKEN) this.movingWin.delete(i);
      }
      this.panes.instanceMatrix.needsUpdate = true;
    }
  }

  /** Puts every door and window straight where it belongs (a match starting or joined). */
  snap(): void {
    this.moving.clear();
    this.movingWin.clear();
    this.sync(true);
  }

  /** Picks up state changes (snap = place everything right away: joining, a new match). */
  private sync(snap: boolean): void {
    this.seen = this.b.version;
    const b = this.b;
    for (let i = 0; i < b.doors.length; i++) {
      const target = b.open[i] ? b.swing[i] * SWING : 0;
      if (snap) {
        this.angle[i] = target;
        this.placeDoor(i);
      } else if (target !== this.angle[i]) this.moving.add(i);
    }
    for (let i = 0; i < b.windows.length; i++) {
      const target = b.win[i] === WIN_OPEN ? 1 : 0;
      if (snap || b.win[i] === WIN_BROKEN) {
        this.openness[i] = target;
        this.placeWindow(i);
      } else if (target !== this.openness[i]) this.movingWin.add(i);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    this.doorGlass.instanceMatrix.needsUpdate = true;
    this.panes.instanceMatrix.needsUpdate = true;
  }

  private placeDoor(i: number): void {
    const d = this.b.doors[i];
    const t = BUILD.doorT;
    // the hinge frame: rotated about the hinge post by the door's yaw plus its swing
    _q.setFromAxisAngle(Y, d.a + this.angle[i]);
    _p.set(d.x, d.y, d.z);
    _s.set(1, 1, 1);
    const hinge = _m2.compose(_p, _q, _s);
    const part = (k: number, lx: number, y0: number, z0: number, sx: number, sy: number, sz: number, mesh = this.leaves, at = this.leafAt[i] + k) => {
      _p.set(lx, y0, z0);
      _q.identity();
      _s.set(sx, sy, sz);
      _m.compose(_p, _q, _s).premultiply(hinge);
      mesh.setMatrixAt(at, _m);
    };
    const w = d.w - 0.02, h = d.h - 0.02;
    if (d.kind === 'glass') {
      // a metal frame round a glass panel
      part(0, 0, 0.01, 0.01, t, 0.22, w);
      part(1, 0, h - 0.07, 0.01, t, 0.08, w);
      part(2, 0, 0.23, 0.01, t, h - 0.3, 0.06);
      part(3, 0, 0.23, w - 0.05, t, h - 0.3, 0.06);
      part(4, t / 2 + 0.03, 0.95, w - 0.25, 0.03, 0.3, 0.03);
      part(5, -t / 2 - 0.03, 0.95, w - 0.25, 0.03, 0.3, 0.03);
      part(0, 0, 0.23, 0.07, t * 0.4, h - 0.3, w - 0.12, this.doorGlass, this.glassAt[i]);
    } else {
      part(0, 0, 0.01, 0.01, t, h, w);
      // handles on both sides, by the free edge
      part(1, t / 2 + 0.03, 0.98, w - 0.1, 0.04, 0.04, 0.12);
      part(2, -t / 2 - 0.03, 0.98, w - 0.1, 0.04, 0.04, 0.12);
    }
  }

  private placeWindow(i: number): void {
    const w = this.b.windows[i];
    const at = this.paneAt[i];
    if (this.b.win[i] === WIN_BROKEN) {
      _m.makeScale(0, 0, 0);
      for (let k = 0; k < this.paneN[i]; k++) this.panes.setMatrixAt(at + k, _m);
      return;
    }
    const o = this.openness[i];
    const ux = Math.sin(w.a), uz = Math.cos(w.a);
    const out = w.out ?? 1;
    const nx = Math.cos(w.a) * out, nz = -Math.sin(w.a) * out;
    const T = BUILD.paneT;
    const set = (k: number, cx: number, y0: number, cz: number, yaw: number, sx: number, sy: number, sz: number) => {
      _q.setFromAxisAngle(Y, yaw);
      _m.compose(_p.set(cx, y0, cz), _q, _s.set(sx, sy, sz));
      this.panes.setMatrixAt(at + k, _m);
    };
    if (w.kind === 'slide') {
      // the top sash stays; the bottom one slides up in front of it
      const half = w.h / 2;
      set(0, w.x - nx * 0.03, w.y + half, w.z - nz * 0.03, w.a, T, half, w.w - 0.08);
      set(1, w.x + nx * 0.03, w.y + o * (half - 0.04), w.z + nz * 0.03, w.a, T, half, w.w - 0.08);
    } else if (w.kind === 'hinge') {
      // a casement swinging out on its left edge
      const ang = o * 1.2 * out;
      const hx = w.x - ux * (w.w / 2 - 0.04), hz = w.z - uz * (w.w / 2 - 0.04);
      const yaw = w.a + ang;
      const half = (w.w - 0.08) / 2;
      set(0, hx + Math.sin(yaw) * half, w.y + 0.02, hz + Math.cos(yaw) * half, yaw, T, w.h - 0.06, w.w - 0.08);
    } else {
      set(0, w.x, w.y + 0.02, w.z, w.a, T, w.h - 0.06, w.w - 0.08);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.leaves.dispose();
    this.doorGlass.dispose();
    this.panes.dispose();
    this.group.removeFromParent();
  }
}
