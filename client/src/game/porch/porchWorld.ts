import * as THREE from 'three';
import { BAGS, ITEM } from '@shared/config/porch';
import { WEAPONS, WEAPON_IDS } from '@shared/config/weapons';
import type { PorchInit } from '@shared/protocol';
import { transportAt } from '@shared/sim/porch';
import type { Assets } from '../assets';
import { BALLOON_GRIP } from '../characters/characterTypes';

/**
 * JUMP OFF THE PORCH, on screen: the party blimp, balloons, bookbags, loose items on the
 * ground, and the riot's edge. Placeholder art built from primitives (no new assets needed),
 * all driven by what the server says.
 */

const _p = { x: 0, z: 0 };

interface PickupVis {
  kind: number;
  code: number;
  count: number;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Object3D;
}

function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
}

/** One geometry per bag style (vertex colored), built from boxes and cylinders. */
function bagGeometry(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (g.index) parts.push(g.toNonIndexed());
    else parts.push(g);
  };
  const id = BAGS[variant]?.id ?? 'school';
  if (id === 'duffel') {
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 10), 0x24252b, 0, 0.16, 0, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.165, 0.165, 0.06, 10), 0xc8312d, -0.22, 0.16, 0, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.165, 0.165, 0.06, 10), 0xc8312d, 0.22, 0.16, 0, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.12, 0.018, 6, 12, Math.PI), 0x111114, 0, 0.3, 0);
  } else {
    const body = { school: 0x1c1d22, designer: 0xd8c8a2, camo: 0x55623d, worn: 0x7c6449, bright: 0xe6408d }[id] ?? 0x1c1d22;
    const trim = { school: 0x30323a, designer: 0x6b4a2c, camo: 0x37402a, worn: 0x5d4a35, bright: 0x2ec4c4 }[id] ?? 0x333333;
    // lying on its back: body, front pocket, top handle, a strap
    add(new THREE.BoxGeometry(0.34, 0.16, 0.44), body, 0, 0.08, 0);
    add(new THREE.BoxGeometry(0.26, 0.07, 0.22), trim, 0, 0.18, 0.07);
    add(new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI), trim, 0, 0.12, -0.24, Math.PI / 2, 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.02, 0.4), trim, -0.11, 0.17, -0.02);
    if (id === 'camo') {
      add(new THREE.BoxGeometry(0.12, 0.165, 0.1), 0x2f3824, 0.08, 0.081, -0.12);
      add(new THREE.BoxGeometry(0.1, 0.165, 0.14), 0x8a7a4e, -0.09, 0.081, 0.1);
    }
    if (id === 'designer') {
      for (let k = -2; k <= 2; k++) add(new THREE.BoxGeometry(0.345, 0.161, 0.015), 0x6b4a2c, 0, 0.081, k * 0.08);
    }
  }
  const merged = mergeSimple(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/** Minimal merge of non-indexed geometries with position / normal / color. */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nrm.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** The party blimp: a yellow envelope with the town's name, a gondola, fins, props. */
function makeBlimp(): { group: THREE.Group; props: THREE.Object3D[] } {
  const g = new THREE.Group();
  const yellow = mat(0xffd23f, { roughness: 0.55 });
  const black = mat(0x15161a, { roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), yellow);
  body.scale.set(3.4, 3.4, 11);
  g.add(body);
  // name on both sides
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 192;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#15161a';
  c.font = '900 120px Impact, "Arial Black", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('WHOOPA-TOWNE', 512, 100);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const side of [-1, 1]) {
    const label = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.position.set(side * 3.42, 0.6, 0);
    label.rotation.y = side * Math.PI / 2;
    g.add(label);
  }
  // fins
  for (const [rx, rz] of [[0, 0], [0, Math.PI / 2], [0, Math.PI], [0, -Math.PI / 2]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 3), black);
    fin.position.set(0, 2.6, -9.4);
    const pivot = new THREE.Group();
    pivot.rotation.set(rx, 0, rz);
    pivot.add(fin);
    g.add(pivot);
  }
  // gondola where everyone waits, with an open door
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 5), mat(0x2b2d34));
  gondola.position.set(0, -4, 0.5);
  g.add(gondola);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 1.2), mat(0xffd23f, { emissive: 0x553f00 }));
  door.position.set(1.23, -4, 0.5);
  g.add(door);
  const props: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hub = new THREE.Group();
    hub.position.set(side * 2.2, -3.6, -2);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.08), black);
    hub.add(blade);
    g.add(hub);
    props.push(hub);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return { group: g, props };
}

/**
 * A bunch of three balloons on strings, to hang over a character's head. The strings meet at
 * the character's grip (BALLOON_GRIP); `userData.pivot` is a group at that point to swing.
 */
export function makeBalloon(): THREE.Group {
  const g = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(BALLOON_GRIP.x, BALLOON_GRIP.y, BALLOON_GRIP.z);
  g.add(pivot);
  g.userData.pivot = pivot;
  const colors = [0xff4f6d, 0xffd23f, 0x3aa0ff];
  // balloon centers relative to the grip
  const offs = [[-0.2, 2.05, 0.05], [-0.75, 1.7, 0.25], [0.35, 1.75, -0.2]];
  colors.forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), mat(c, { roughness: 0.3, emissive: c, emissiveIntensity: 0.12 }));
    b.scale.set(1, 1.18, 1);
    b.position.set(offs[i][0], offs[i][1], offs[i][2]);
    pivot.add(b);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 6), b.material);
    knot.position.set(offs[i][0], offs[i][1] - 0.78, offs[i][2]);
    knot.rotation.x = Math.PI;
    pivot.add(knot);
    // string down to the hands
    const a = new THREE.Vector3(offs[i][0], offs[i][1] - 0.84, offs[i][2]);
    const h = new THREE.Vector3(0, 0, 0);
    const len = a.distanceTo(h);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), mat(0xf5f5f5));
    s.position.copy(a).add(h).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(h).normalize());
    pivot.add(s);
  });
  return g;
}

/** Balloons pop up out of nowhere when they go up, then bob and swing about the grip (the strings stay in the hands). */
export function swayBalloon(b: THREE.Group, t: number, dt = 0): void {
  const pivot = b.userData.pivot as THREE.Object3D | undefined;
  if (!pivot) return;
  pivot.rotation.set(Math.sin(t * 1.3) * 0.08, Math.sin(t * 0.7) * 0.2, Math.sin(t * 1.7) * 0.14);
  const g = Math.min(1, ((b.userData.grow as number | undefined) ?? 0) + dt / 0.35);
  b.userData.grow = g;
  // ease out with a little overshoot
  const s = g >= 1 ? 1 : 1 + 2.2 * (g - 1) ** 3 + 1.2 * (g - 1) ** 2;
  pivot.scale.setScalar(Math.max(0.05, s));
}

export class PorchWorld {
  readonly group = new THREE.Group();
  private init: PorchInit;
  private assets: Assets | null;
  private blimp: THREE.Group;
  private blimpProps: THREE.Object3D[];
  private bags: THREE.InstancedMesh[] = [];
  private bagSlot = new Map<number, { mesh: THREE.InstancedMesh; i: number }>();
  private bagPos = new Map<number, { x: number; y: number; z: number; variant: number; opened: boolean }>();
  private beams: THREE.InstancedMesh;
  private beamOf = new Map<number, number>();
  private pickups = new Map<number, PickupVis>();
  private wall: THREE.Mesh;
  private wallTex: THREE.CanvasTexture;
  private nextRing: THREE.Mesh;
  private confetti: Array<{ m: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
  private disposables: Array<{ dispose(): void }> = [];
  private time = 0;
  /** Zone the riot wall is drawn at. */
  zone = { x: 0, z: 0, r: 999 };
  next = { x: 0, z: 0, r: 999 };

  constructor(init: PorchInit, assets: Assets | null) {
    this.init = init;
    this.assets = assets;
    const b = makeBlimp();
    this.blimp = b.group;
    this.blimpProps = b.props;
    this.group.add(this.blimp);

    // bookbags: one instanced mesh per style
    const count = init.bags.length / 7;
    const bagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.disposables.push(bagMat);
    const perVariant = new Map<number, number[]>();
    for (let k = 0; k < count; k++) {
      const v = init.bags[k * 7 + 5];
      if (!perVariant.has(v)) perVariant.set(v, []);
      perVariant.get(v)!.push(k);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (const [v, list] of perVariant) {
      const geo = bagGeometry(v);
      this.disposables.push(geo);
      const mesh = new THREE.InstancedMesh(geo, bagMat, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((k, i) => {
        const o = k * 7;
        const id = init.bags[o], x = init.bags[o + 1] / 100, y = init.bags[o + 2] / 100, z = init.bags[o + 3] / 100;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), init.bags[o + 4] / 1000);
        mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q, one));
        this.bagSlot.set(id, { mesh, i });
        this.bagPos.set(id, { x, y, z, variant: v, opened: false });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.bags.push(mesh);
    }
    // a soft beam of light over every bag nobody has searched yet, so they can be spotted
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.32, 2.6, 10, 1, true).translate(0, 1.3, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.disposables.push(beamGeo, beamMat);
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, Math.max(1, count));
    let bi = 0;
    for (const [id, p] of this.bagPos) {
      this.beams.setMatrixAt(bi, m4.makeTranslation(p.x, p.y, p.z));
      this.beamOf.set(id, bi++);
    }
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.computeBoundingSphere();
    this.group.add(this.beams);
    for (let k = 0; k < count; k++) if (init.bags[k * 7 + 6] === 1) this.openBag(init.bags[k * 7]);
    for (let k = 0; k + 7 <= init.pickups.length; k += 7) {
      const p = init.pickups;
      this.addPickup(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4] / 100, p[k + 5] / 100, p[k + 6] / 100);
    }

    // the riot's edge: a wall of red haze with drifting streaks
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const c = cv.getContext('2d')!;
    const grad = c.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,60,40,0)');
    grad.addColorStop(0.55, 'rgba(255,70,40,0.35)');
    grad.addColorStop(1, 'rgba(255,40,30,0.75)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(255,${150 + Math.floor(Math.random() * 80)},60,${0.15 + Math.random() * 0.25})`;
      c.fillRect(Math.random() * 256, 40 + Math.random() * 88, 2 + Math.random() * 4, 20 + Math.random() * 40);
    }
    this.wallTex = new THREE.CanvasTexture(cv);
    this.wallTex.wrapS = THREE.RepeatWrapping;
    this.wallTex.repeat.set(24, 1);
    this.wallTex.colorSpace = THREE.SRGBColorSpace;
    // (the crowd is the riot up close; this haze marks its edge from afar)
    const wallGeo = new THREE.CylinderGeometry(1, 1, 7, 128, 1, true).translate(0, 3.5, 0);
    const wallMat = new THREE.MeshBasicMaterial({ map: this.wallTex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.wall = new THREE.Mesh(wallGeo, wallMat);
    this.wall.renderOrder = 7;
    this.wall.frustumCulled = false;
    this.group.add(this.wall);
    const ringGeo = new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.nextRing = new THREE.Mesh(ringGeo, ringMat);
    this.nextRing.position.y = 0.12;
    this.nextRing.renderOrder = 6;
    this.nextRing.frustumCulled = false;
    this.group.add(this.nextRing);
    this.disposables.push(this.wallTex, wallGeo, wallMat, ringGeo, ringMat);
  }

  // ------------------------------------------------------------------ bags & pickups
  openBag(id: number): void {
    const slot = this.bagSlot.get(id), p = this.bagPos.get(id);
    if (!slot || !p || p.opened) return;
    p.opened = true;
    // searched bags lie flat and open
    const m4 = new THREE.Matrix4();
    slot.mesh.getMatrixAt(slot.i, m4);
    m4.multiply(new THREE.Matrix4().makeScale(1.15, 0.45, 1.05));
    slot.mesh.setMatrixAt(slot.i, m4);
    slot.mesh.instanceMatrix.needsUpdate = true;
    const bi = this.beamOf.get(id);
    if (bi !== undefined) {
      this.beams.setMatrixAt(bi, new THREE.Matrix4().makeScale(0, 0, 0));
      this.beams.instanceMatrix.needsUpdate = true;
    }
  }

  /** Bags and items near a point (for the interaction prompt). */
  bagAt(id: number): { x: number; y: number; z: number; variant: number; opened: boolean } | undefined {
    return this.bagPos.get(id);
  }

  get allBags(): IterableIterator<[number, { x: number; y: number; z: number; variant: number; opened: boolean }]> {
    return this.bagPos.entries();
  }

  get allPickups(): IterableIterator<[number, PickupVis]> {
    return this.pickups.entries();
  }

  addPickup(id: number, kind: number, code: number, count: number, x: number, y: number, z: number): void {
    this.removePickup(id);
    const mesh = this.pickupMesh(kind, code);
    mesh.position.set(x, y + 0.35, z);
    this.group.add(mesh);
    this.pickups.set(id, { kind, code, count, x, y, z, mesh });
  }

  removePickup(id: number): void {
    const p = this.pickups.get(id);
    if (!p) return;
    p.mesh.removeFromParent();
    p.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.own) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.pickups.delete(id);
  }

  private pickupMesh(kind: number, code: number): THREE.Object3D {
    const g = new THREE.Group();
    const own = (m: THREE.Mesh) => {
      m.userData.own = true;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (kind === ITEM.WEAPON) {
      const id = WEAPON_IDS[code];
      const t = this.assets?.model(id === 'sniper' ? 'ar' : id);
      if (t) {
        const gun = t.root.clone(true);
        const len = id === 'sniper' ? 1.18 : WEAPONS[id] ? ({ ar: 0.92, smg: 0.62, shotgun: 1, pistol: 0.26 } as Record<string, number>)[id] ?? 0.6 : 0.6;
        gun.scale.setScalar(len / t.size.z);
        gun.position.z = -len / 2;
        const holder = new THREE.Group();
        holder.add(gun);
        holder.rotation.z = 0.25;
        g.add(holder);
      } else {
        own(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), mat(0x2a2c31)));
      }
    } else if (kind === ITEM.AMMO) {
      const color = [0xd9b44a, 0x6a8f3c, 0xc0392b, 0x3a6fd8][code] ?? 0x888888;
      own(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.2), mat(color)));
    } else if (kind === ITEM.HEAL) {
      if (code === 2) {
        own(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10), mat(0xff5a36))).position.y = 0.04;
      } else {
        own(new THREE.Mesh(new THREE.BoxGeometry(code === 1 ? 0.34 : 0.2, 0.14, code === 1 ? 0.26 : 0.14), mat(0xf4f4f0)));
        own(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, code === 1 ? 0.18 : 0.1), mat(0xd62f2f)));
        own(new THREE.Mesh(new THREE.BoxGeometry(code === 1 ? 0.18 : 0.1, 0.15, 0.06), mat(0xd62f2f)));
      }
    } else if (kind === ITEM.ARMOR) {
      own(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.14), mat(code >= 100 ? 0x2e3a8c : 0x3a7bd5, { roughness: 0.5 })));
    } else if (kind === ITEM.THROWABLE) {
      own(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(code === 0 ? 0x3c4a2f : 0xa9b0b8)));
    }
    // a little glow underneath so loot reads from a distance
    const glow = own(new THREE.Mesh(new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: kind === ITEM.WEAPON ? 0xffd23f : kind === ITEM.ARMOR ? 0x6fb0ff : kind === ITEM.HEAL ? 0x8dff9a : 0xffffff,
      transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    glow.position.y = -0.33;
    glow.castShadow = false;
    return g;
  }

  // ------------------------------------------------------------------ effects
  /** A balloon popping: a burst of colored scraps. */
  pop(at: THREE.Vector3): void {
    const colors = [0xff4f6d, 0xffd23f, 0x3aa0ff];
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshBasicMaterial({ color: colors[i % 3], side: THREE.DoubleSide }));
      m.position.copy(at).add(new THREE.Vector3(0, 3.6, 0));
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(6);
      this.group.add(m);
      this.confetti.push({ m, v, life: 1.4 + Math.random() * 0.6 });
    }
  }

  // ------------------------------------------------------------------ per frame
  /** `serverTime` (ms) places the blimp; `takeoff` < 0 = still waiting to take off. */
  update(dt: number, serverTime: number, takeoff: number): void {
    this.time += dt;
    // blimp along its route, nose first
    const route = this.init.route;
    const t0 = takeoff >= 0 ? takeoff : Infinity;
    transportAt(route, this.init.speed, t0, serverTime, _p);
    this.blimp.position.set(_p.x, this.init.altitude + 4.2, _p.z);
    this.blimp.rotation.y = Math.atan2(route[2] - route[0], route[3] - route[1]);
    this.blimp.position.y += Math.sin(this.time * 0.8) * 0.3;
    const len = Math.hypot(route[2] - route[0], route[3] - route[1]);
    this.blimp.visible = takeoff < 0 || (serverTime - takeoff) / 1000 * this.init.speed < len + 40;
    for (const pr of this.blimpProps) pr.rotation.z += dt * 18;

    // bags shimmer; loot bobs and spins
    (this.beams.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.08 * Math.sin(this.time * 3);
    for (const p of this.pickups.values()) {
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = p.y + 0.35 + Math.sin(this.time * 2.4 + p.x) * 0.06;
    }

    // riot edge and the next safe area
    const z = this.zone;
    this.wall.visible = z.r < 900;
    this.wall.position.set(z.x, 0, z.z);
    this.wall.scale.set(Math.max(0.5, z.r), 1, Math.max(0.5, z.r));
    this.wallTex.offset.x = (this.time * 0.05) % 1;
    this.wallTex.repeat.x = Math.max(4, Math.round(z.r / 4));
    const n = this.next;
    const showNext = n.r < z.r - 0.5;
    this.nextRing.visible = showNext;
    if (showNext) {
      this.nextRing.position.set(n.x, 0.12, n.z);
      this.nextRing.scale.setScalar(Math.max(0.5, n.r));
    }

    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life -= dt;
      c.v.y -= 6 * dt;
      c.v.multiplyScalar(1 - dt * 1.2);
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 9;
      c.m.rotation.y += dt * 7;
      if (c.life <= 0) {
        c.m.removeFromParent();
        c.m.geometry.dispose();
        (c.m.material as THREE.Material).dispose();
        this.confetti.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.pickups.keys()]) this.removePickup(id);
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
