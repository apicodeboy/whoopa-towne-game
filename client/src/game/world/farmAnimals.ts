import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimalKind, MapDef, PenDef } from '@shared/map/types';

/**
 * The animals at CAP'S HOUSE and the farms round it: they wander their pens, stop to graze
 * and wander on. Scenery only (no collision, not part of the match), so each client runs
 * its own. Drawn with one instanced mesh per kind for the bodies and one for the legs.
 * The windmill's fan turns here too.
 */

/** A body part: 'c' a capsule along z, 'e' an egg (ellipsoid), 'b' a box; then x, y, z, sx, sy, sz, color. */
type Part = ['c' | 'e' | 'b', number, number, number, number, number, number, number];

interface Shape {
  /** Body parts (y from the ground, +z forward). */
  parts: Part[];
  /** Hips: [x, z] of each leg, and the leg's length and thickness. */
  legs: Array<[number, number]>;
  legLen: number;
  legW: number;
  legColor: number;
  /** Tints per animal (multiplied into the colors; dark patches stay dark). */
  tints: number[];
  speed: number;
  /** How far the head dips to graze (radians of body pitch). */
  graze: number;
}

const W = 0xffffff, BLACK = 0x1e1e20, PINK = 0xf0a8a8, HORN = 0xe8dcc0, HOOF = 0x2a2420, EYE = 0x111111;

const SHAPES: Record<AnimalKind, Shape> = {
  cow: {
    parts: [
      ['c', 0, 1.2, 0, 0.84, 0.82, 1.95, W], // body
      ['e', 0.39, 1.26, 0.25, 0.1, 0.5, 0.75, BLACK], ['e', -0.38, 1.12, -0.35, 0.1, 0.48, 0.62, BLACK], ['e', 0, 1.6, -0.25, 0.5, 0.08, 0.6, BLACK], // patches
      ['e', 0, 1.36, 0.92, 0.46, 0.52, 0.5, W], // neck
      ['e', 0, 1.36, 1.25, 0.38, 0.44, 0.56, W], // head
      ['e', 0, 1.22, 1.5, 0.34, 0.26, 0.24, PINK], // muzzle
      ['b', 0.16, 1.47, 1.36, 0.05, 0.06, 0.05, EYE], ['b', -0.16, 1.47, 1.36, 0.05, 0.06, 0.05, EYE],
      ['b', 0.24, 1.62, 1.16, 0.2, 0.05, 0.05, HORN], ['b', -0.24, 1.62, 1.16, 0.2, 0.05, 0.05, HORN],
      ['e', 0.28, 1.5, 1.1, 0.2, 0.1, 0.08, BLACK], ['e', -0.28, 1.5, 1.1, 0.2, 0.1, 0.08, BLACK], // ears
      ['e', 0, 0.82, -0.2, 0.32, 0.18, 0.32, PINK], // udder
      ['b', 0, 1.12, -1.0, 0.05, 0.62, 0.05, BLACK], // tail
    ],
    legs: [[0.27, 0.68], [-0.27, 0.68], [0.27, -0.68], [-0.27, -0.68]], legLen: 0.84, legW: 0.17, legColor: 0xf2f2ee,
    tints: [0xffffff, 0xffffff, 0x8a5a3a, 0xb07a4a], speed: 0.7, graze: 0.32,
  },
  horse: {
    parts: [
      ['c', 0, 1.46, 0, 0.62, 0.7, 1.62, W],
      ['e', 0, 1.86, 0.8, 0.32, 0.82, 0.46, W], // neck
      ['e', 0, 2.2, 1.12, 0.26, 0.32, 0.64, W], // head
      ['e', 0, 2.1, 1.4, 0.22, 0.22, 0.2, 0x3a2a22], // muzzle
      ['b', 0.12, 2.28, 1.12, 0.04, 0.05, 0.05, EYE], ['b', -0.12, 2.28, 1.12, 0.04, 0.05, 0.05, EYE],
      ['b', 0, 2.02, 0.66, 0.08, 0.74, 0.22, BLACK], // mane
      ['e', 0.08, 2.42, 0.98, 0.06, 0.18, 0.07, W], ['e', -0.08, 2.42, 0.98, 0.06, 0.18, 0.07, W], // ears
      ['e', 0, 1.26, -0.9, 0.15, 0.78, 0.2, BLACK], // tail
    ],
    legs: [[0.19, 0.58], [-0.19, 0.58], [0.19, -0.58], [-0.19, -0.58]], legLen: 1.12, legW: 0.13, legColor: 0xffffff,
    tints: [0x7a4a2a, 0x3a2a22, 0xa0603a, 0xe8e2d8, 0x5a3a24], speed: 1.3, graze: 0.4,
  },
  pig: {
    parts: [
      ['c', 0, 0.62, 0, 0.64, 0.58, 1.08, W],
      ['e', 0, 0.66, 0.6, 0.46, 0.44, 0.38, W],
      ['e', 0, 0.6, 0.82, 0.22, 0.18, 0.1, 0xe58a8a], // snout
      ['b', 0.12, 0.76, 0.76, 0.04, 0.05, 0.04, EYE], ['b', -0.12, 0.76, 0.76, 0.04, 0.05, 0.04, EYE],
      ['e', 0.17, 0.9, 0.6, 0.14, 0.08, 0.12, 0xe58a8a], ['e', -0.17, 0.9, 0.6, 0.14, 0.08, 0.12, 0xe58a8a], // ears
      ['e', 0, 0.76, -0.56, 0.06, 0.06, 0.1, 0xe58a8a],
    ],
    legs: [[0.18, 0.32], [-0.18, 0.32], [0.18, -0.32], [-0.18, -0.32]], legLen: 0.36, legW: 0.12, legColor: 0xffffff,
    tints: [0xf3b6b0, 0xf0aaa4, 0xe9b0a8, 0x6a5048], speed: 0.6, graze: 0.25,
  },
  goat: {
    parts: [
      ['c', 0, 0.8, 0, 0.38, 0.42, 0.82, W],
      ['e', 0, 1.04, 0.44, 0.2, 0.42, 0.24, W], // neck
      ['e', 0, 1.2, 0.6, 0.18, 0.22, 0.34, W], // head
      ['b', 0.07, 1.36, 0.5, 0.04, 0.22, 0.04, HORN], ['b', -0.07, 1.36, 0.5, 0.04, 0.22, 0.04, HORN],
      ['b', 0.07, 1.25, 0.66, 0.03, 0.04, 0.03, EYE], ['b', -0.07, 1.25, 0.66, 0.03, 0.04, 0.03, EYE],
      ['e', 0, 1.02, 0.7, 0.06, 0.16, 0.06, 0xd8d2c4], // beard
      ['e', 0, 0.96, -0.42, 0.06, 0.16, 0.06, W],
    ],
    legs: [[0.12, 0.3], [-0.12, 0.3], [0.12, -0.3], [-0.12, -0.3]], legLen: 0.6, legW: 0.08, legColor: 0xffffff,
    tints: [0xf2efe6, 0x8a6a4a, 0x2e2a28, 0xd8c0a0], speed: 0.9, graze: 0.35,
  },
  sheep: {
    parts: [
      ['e', 0, 0.84, 0, 0.74, 0.66, 1.02, W], // wool
      ['e', 0, 0.94, 0.5, 0.26, 0.3, 0.34, 0x2b2522], // face
      ['e', 0.17, 1.0, 0.46, 0.16, 0.06, 0.08, 0x2b2522], ['e', -0.17, 1.0, 0.46, 0.16, 0.06, 0.08, 0x2b2522],
      ['e', 0, 1.1, 0.42, 0.3, 0.16, 0.2, W], // the wool on top of its head
    ],
    legs: [[0.18, 0.3], [-0.18, 0.3], [0.18, -0.3], [-0.18, -0.3]], legLen: 0.54, legW: 0.08, legColor: 0x2b2522,
    tints: [0xf4f1e8, 0xece6d6, 0xe6e0d2], speed: 0.55, graze: 0.3,
  },
  chicken: {
    parts: [
      ['e', 0, 0.3, 0, 0.24, 0.26, 0.34, W],
      ['e', 0, 0.47, 0.13, 0.14, 0.16, 0.14, W],
      ['e', 0, 0.57, 0.14, 0.03, 0.08, 0.1, 0xd8262a], // comb
      ['b', 0, 0.45, 0.22, 0.05, 0.04, 0.06, 0xe8a020], // beak
      ['e', 0, 0.39, -0.17, 0.12, 0.16, 0.08, W], // tail
    ],
    legs: [[0.05, 0], [-0.05, 0]], legLen: 0.18, legW: 0.03, legColor: 0xe8a020,
    tints: [0xffffff, 0xb06a32, 0x8a4a22, 0x2a2826], speed: 0.9, graze: 0.55,
  },
};

const UNIT = {
  c: new THREE.CapsuleGeometry(0.5, 1, 3, 10).rotateX(Math.PI / 2).scale(1, 1, 0.5),
  e: new THREE.IcosahedronGeometry(0.5, 1),
  b: new THREE.BoxGeometry(1, 1, 1),
};

function boxes(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(([shape, x, y, z, sx, sy, sz, color]) => {
    const g = UNIT[shape].clone().toNonIndexed();
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

/** A leg: a round post with a hoof, its top at the hip (y = 0). */
function legGeometry(sh: Shape, hoof: number): THREE.BufferGeometry {
  const leg = new THREE.CylinderGeometry(sh.legW * 0.5, sh.legW * 0.42, sh.legLen, 6).toNonIndexed();
  leg.translate(0, -sh.legLen / 2, 0);
  const h = new THREE.CylinderGeometry(sh.legW * 0.46, sh.legW * 0.5, 0.08, 6).toNonIndexed();
  h.translate(0, -sh.legLen + 0.04, 0);
  for (const [g, color] of [[leg, sh.legColor], [h, hoof]] as const) {
    const c = new THREE.Color(color);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
  }
  const merged = mergeGeometries([leg, h], false)!;
  leg.dispose();
  h.dispose();
  return merged;
}

interface Animal {
  kind: AnimalKind;
  pen: PenDef;
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  wait: number;
  phase: number;
  seed: number;
  /** Graze amount (0..1, eased). */
  dip: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _hip = new THREE.Vector3();
const _body = new THREE.Matrix4();
const _leg = new THREE.Matrix4();

export class FarmAnimals {
  readonly group = new THREE.Group();
  private animals: Animal[] = [];
  private bodies = new Map<AnimalKind, THREE.InstancedMesh>();
  private legs = new Map<AnimalKind, THREE.InstancedMesh>();
  private fans: THREE.Object3D[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private rnd = 1;

  constructor(map: MapDef) {
    this.group.name = 'farm animals';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.disposables.push(mat);
    for (const pen of map.pens ?? []) {
      for (let i = 0; i < pen.count; i++) {
        const x = pen.x0 + this.rand() * (pen.x1 - pen.x0), z = pen.z0 + this.rand() * (pen.z1 - pen.z0);
        this.animals.push({ kind: pen.kind, pen, x, z, yaw: this.rand() * Math.PI * 2, tx: x, tz: z, wait: this.rand() * 6, phase: this.rand() * 6, seed: this.animals.length, dip: 0 });
      }
    }
    const byKind = new Map<AnimalKind, Animal[]>();
    for (const a of this.animals) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
    for (const [kind, list] of byKind) {
      const sh = SHAPES[kind];
      const bodyGeo = boxes(sh.parts);
      const legAll = legGeometry(sh, kind === 'chicken' ? sh.legColor : HOOF);
      const body = new THREE.InstancedMesh(bodyGeo, mat, list.length);
      const legs = new THREE.InstancedMesh(legAll, mat, list.length * sh.legs.length);
      const tint = new THREE.Color();
      list.forEach((a, i) => {
        tint.set(sh.tints[a.seed % sh.tints.length]);
        body.setColorAt(i, tint);
        for (let k = 0; k < sh.legs.length; k++) legs.setColorAt(i * sh.legs.length + k, kind === 'sheep' || kind === 'chicken' ? new THREE.Color(0xffffff) : tint);
      });
      for (const m of [body, legs]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
      }
      this.bodies.set(kind, body);
      this.legs.set(kind, legs);
      this.disposables.push(bodyGeo, legAll);
    }
    // the windmills' fans (facing south, into the breeze off the lake)
    for (const s of map.solids) {
      if (s.kind !== 'windmill') continue;
      const hub = new THREE.Group();
      hub.position.set(s.x, s.y + s.sy / 2 + 0.2, s.z + 0.45);
      const blades: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 18; k++) {
        const g = new THREE.BoxGeometry(0.28, 1.25, 0.03).toNonIndexed();
        g.translate(0, 1.05, 0);
        g.rotateY(0.35);
        g.rotateZ((k / 18) * Math.PI * 2);
        blades.push(g);
      }
      blades.push(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10).rotateX(Math.PI / 2).toNonIndexed());
      for (const g of blades) g.deleteAttribute('uv');
      const fanGeo = mergeGeometries(blades, false)!;
      for (const g of blades) g.dispose();
      const fanMat = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.6, metalness: 0.3, flatShading: true });
      const fan = new THREE.Mesh(fanGeo, fanMat);
      fan.castShadow = true;
      hub.add(fan);
      // the tail vane behind it
      const vaneGeo = new THREE.BoxGeometry(0.04, 1.0, 1.6);
      vaneGeo.translate(0, 0, -1.4);
      const vane = new THREE.Mesh(vaneGeo, fanMat);
      vane.castShadow = true;
      hub.add(vane);
      this.group.add(hub);
      this.fans.push(fan);
      this.disposables.push(fanGeo, fanMat, vaneGeo);
    }
    this.update(0);
  }

  private rand(): number {
    // a small LCG: the animals are scenery, each client may wander them its own way
    this.rnd = (Math.imul(this.rnd, 1664525) + 1013904223) >>> 0;
    return this.rnd / 4294967296;
  }

  update(dt: number): void {
    for (const f of this.fans) f.rotation.z -= dt * 2.4;
    const counts = new Map<AnimalKind, number>();
    for (const a of this.animals) {
      const sh = SHAPES[a.kind];
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      let moving = false;
      if (a.wait > 0) {
        a.wait -= dt;
        if (a.wait <= 0) {
          // somewhere else in the pen, not too far
          const p = a.pen;
          a.tx = Math.min(p.x1, Math.max(p.x0, a.x + (this.rand() - 0.5) * 14));
          a.tz = Math.min(p.z1, Math.max(p.z0, a.z + (this.rand() - 0.5) * 14));
        }
      } else if (d < 0.2) {
        a.wait = 2 + this.rand() * (a.kind === 'chicken' ? 3 : 9);
      } else {
        moving = true;
        const want = Math.atan2(dx, dz);
        let turn = want - a.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        a.yaw += Math.max(-dt * 1.6, Math.min(dt * 1.6, turn));
        if (Math.abs(turn) < 0.6) {
          const step = Math.min(d, sh.speed * dt);
          a.x += Math.sin(a.yaw) * step;
          a.z += Math.cos(a.yaw) * step;
          a.phase += dt * sh.speed * (a.kind === 'chicken' ? 16 : 5);
        }
      }
      a.dip += ((moving ? 0 : 1) - a.dip) * Math.min(1, dt * 1.5);
      const i = counts.get(a.kind) ?? 0;
      counts.set(a.kind, i + 1);
      // the body: yaw, a dip forward to graze, a little bob while walking
      const bob = moving ? Math.abs(Math.sin(a.phase)) * 0.03 : 0;
      _e.set(a.dip * sh.graze * (a.kind === 'chicken' ? 1 : 0.35), a.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(a.x, bob, a.z);
      _body.compose(_p, _q, _s);
      this.bodies.get(a.kind)!.setMatrixAt(i, _body);
      // the legs swing in diagonal pairs
      const legs = this.legs.get(a.kind)!;
      sh.legs.forEach(([lx, lz], k) => {
        const swing = moving ? Math.sin(a.phase + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.45 : 0;
        _hip.set(lx, sh.legLen + bob, lz).applyMatrix4(_body);
        _e.set(swing, a.yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        _leg.compose(_hip, _q, _s);
        legs.setMatrixAt(i * sh.legs.length + k, _leg);
      });
    }
    for (const m of this.bodies.values()) m.instanceMatrix.needsUpdate = true;
    for (const m of this.legs.values()) m.instanceMatrix.needsUpdate = true;
    void _m;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const m of [...this.bodies.values(), ...this.legs.values()]) m.dispose();
    this.group.removeFromParent();
  }
}
