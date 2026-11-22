import * as THREE from 'three';
import {
  ApplyForce, BatchedRenderer, Bezier, ColorOverLife, ColorRange, ConeEmitter, ConstantValue, Gradient, IntervalValue,
  ParticleSystem, PiecewiseBezier, PointEmitter, RandomQuatGenerator, RenderMode, Rotation3DOverLife, SizeOverLife,
  SphereEmitter, Vector3 as QV3, Vector4 as QV4, type Behavior, type EmitterShape,
} from 'three.quarks';
import type { WeaponClass } from '@shared/config/weapons';
import type { MapDef } from '@shared/map/types';

/**
 * Gameplay particles on three.quarks: one long-lived, batched system per kind of effect
 * (a handful of draw calls for all of them), fired as bursts at world positions. Effects
 * farther from the camera than they could matter are skipped; counts follow the effect
 * density setting. Visual only: hits, damage and everything else stay on the server.
 *
 *  - muzzle: sparks and a smoke puff, different for each weapon class (a shotgun's wide spray,
 *    a sniper's long streak, almost nothing from a suppressed gun)
 *  - shell casings, kicked out to the right (brass; red hulls from shotguns)
 *  - impacts by surface: sparks and grey dust on walls and pavement, clods and brown dust on
 *    dirt and sand, a spray on water
 *  - explosions: a fireball, rising smoke, debris chunks, a ring of dust along the ground
 *  - dust kicked up running on dirt and sand, splashes running through water
 */
export type Surface = 'hard' | 'dirt' | 'grass' | 'water';

const DIRT = new Set(['dirt', 'sand', 'gravel', 'jungle', 'desert', 'soil', 'stubble', 'mud', 'path', 'towel', 'wheat', 'corn', 'sunflower', 'court']);
const WATER = new Set(['surf', 'ocean', 'oasis']);

/** What the ground is at (x, z): the topmost painted area there (dirt and sand, water, grass, or hard ground). */
export function surfaceAt(map: MapDef, x: number, z: number): Surface {
  let best: { kind: string; layer: number } | null = null;
  for (const a of map.areas) {
    if (x < a.x0 || x > a.x1 || z < a.z0 || z > a.z1) continue;
    const layer = a.layer ?? 1;
    if (!best || layer >= best.layer) best = { kind: a.kind, layer };
  }
  if (map.terrain?.paint) {
    for (const p of map.terrain.paint) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p.kind === 'stone' ? 'hard' : 'dirt';
  }
  if (!best) return map.round ? 'grass' : 'hard';
  if (DIRT.has(best.kind)) return 'dirt';
  if (WATER.has(best.kind)) return 'water';
  if (best.kind === 'grass') return 'grass';
  return 'hard';
}

/** How a weapon class's shot looks at the muzzle. */
interface MuzzleStyle { sparks: number; cone: number; speed: [number, number]; life: [number, number]; size: number; smoke: number; casing: 'brass' | 'shell' | 'none' }
const MUZZLE: Record<WeaponClass, MuzzleStyle> = {
  pistol: { sparks: 4, cone: 0.22, speed: [6, 11], life: [0.04, 0.08], size: 0.05, smoke: 1, casing: 'brass' },
  revolver: { sparks: 6, cone: 0.3, speed: [7, 12], life: [0.05, 0.09], size: 0.07, smoke: 2, casing: 'none' },
  smg: { sparks: 5, cone: 0.24, speed: [8, 13], life: [0.04, 0.07], size: 0.05, smoke: 1, casing: 'brass' },
  rifle: { sparks: 7, cone: 0.2, speed: [10, 16], life: [0.05, 0.09], size: 0.06, smoke: 1, casing: 'brass' },
  dmr: { sparks: 8, cone: 0.16, speed: [12, 18], life: [0.06, 0.1], size: 0.07, smoke: 2, casing: 'brass' },
  sniper: { sparks: 10, cone: 0.1, speed: [16, 24], life: [0.07, 0.12], size: 0.08, smoke: 3, casing: 'brass' },
  shotgun: { sparks: 16, cone: 0.55, speed: [7, 14], life: [0.05, 0.11], size: 0.07, smoke: 3, casing: 'shell' },
  melee: { sparks: 0, cone: 0, speed: [0, 0], life: [0, 0], size: 0, smoke: 0, casing: 'none' },
};

function dotTexture(soft: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(soft, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A puff: a few overlapping soft blobs (smoke and dust read as clouds, not discs). */
function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = 48 + (rnd() - 0.5) * 34, y = 48 + (rnd() - 0.5) * 34, r = 16 + rnd() * 16;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const fade = (from: number, to = 0) => new PiecewiseBezier([[new Bezier(from, from + (to - from) * 0.33, from + (to - from) * 0.66, to), 0]]);
const v4 = (hex: number, a: number) => {
  const c = new THREE.Color(hex);
  return new QV4(c.r, c.g, c.b, a);
};

export class QuarksFx {
  readonly group = new THREE.Group();
  /** Scales particle counts (performance mode). */
  density = 1;
  private batch = new BatchedRenderer();
  private sys: Record<string, ParticleSystem> = {};
  private disposables: Array<{ dispose(): void }> = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private cam = new THREE.Vector3();

  constructor() {
    this.group.name = 'quarks';
    this.group.add(this.batch);
    const dot = dotTexture(0.35), soft = dotTexture(0.15), puff = puffTexture();
    this.disposables.push(dot, soft, puff);
    const additive = (map: THREE.Texture) => this.mat(new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const normal = (map: THREE.Texture) => this.mat(new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
    const gravity = (g = 9.8) => new ApplyForce(new QV3(0, -1, 0), new ConstantValue(g));

    // ---- muzzle sparks: motion-stretched streaks out of the barrel
    this.add('muzzleSparks', {
      shape: new ConeEmitter({ radius: 0.01, angle: 0.2 }), startLife: new IntervalValue(0.04, 0.09), startSpeed: new IntervalValue(8, 14),
      startSize: new IntervalValue(0.04, 0.07), startColor: new ColorRange(v4(0xfff0b0, 1), v4(0xffa040, 1)), maxParticle: 400,
      material: additive(dot), renderMode: RenderMode.StretchedBillBoard, rendererEmitterSettings: { speedFactor: 0.035, lengthFactor: 1 },
      behaviors: [new ColorOverLife(new Gradient([[new QV3(1, 0.95, 0.7), 0], [new QV3(1, 0.5, 0.15), 1]], [[1, 0], [0, 1]]))],
    });
    // ---- muzzle smoke: a soft grey puff that drifts up and spreads
    this.add('muzzleSmoke', {
      shape: new ConeEmitter({ radius: 0.03, angle: 0.35 }), startLife: new IntervalValue(0.5, 0.9), startSpeed: new IntervalValue(0.6, 1.6),
      startSize: new IntervalValue(0.18, 0.3), startColor: new ColorRange(v4(0xb8b8b8, 0.32), v4(0xd0d0d0, 0.22)), maxParticle: 200,
      startRotation: new IntervalValue(0, Math.PI * 2), material: normal(puff),
      behaviors: [new SizeOverLife(fade(1, 3.2)), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[1, 0], [0, 1]])), new ApplyForce(new QV3(0, 1, 0), new ConstantValue(0.6))],
    });
    // ---- shell casings: little cylinders spinning out to the right and falling
    const casingGeo = new THREE.CylinderGeometry(0.5, 0.5, 2.4, 8).rotateZ(Math.PI / 2);
    const shellGeo = new THREE.CylinderGeometry(0.75, 0.75, 2.6, 10).rotateZ(Math.PI / 2);
    this.disposables.push(casingGeo, shellGeo);
    const casing = (name: string, geo: THREE.BufferGeometry, hex: number, metal: number) => this.add(name, {
      shape: new PointEmitter(), startLife: new IntervalValue(0.45, 0.6), startSpeed: new ConstantValue(0), startSize: new ConstantValue(0.012),
      startColor: new ColorRange(v4(hex, 1), v4(hex, 1)), maxParticle: 120, startRotation: new RandomQuatGenerator(),
      material: this.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: metal, roughness: 0.35 })),
      renderMode: RenderMode.Mesh, instancingGeometry: geo,
      behaviors: [gravity(), new Rotation3DOverLife(new RandomQuatGenerator())],
    });
    casing('casingBrass', casingGeo, 0xc9a24a, 0.85);
    casing('casingShell', shellGeo, 0xb3261e, 0.2);
    // ---- impacts
    this.add('impactSparks', {
      shape: new ConeEmitter({ radius: 0.01, angle: 0.9 }), startLife: new IntervalValue(0.1, 0.28), startSpeed: new IntervalValue(3, 9),
      startSize: new IntervalValue(0.025, 0.05), startColor: new ColorRange(v4(0xfff2c4, 1), v4(0xffb050, 1)), maxParticle: 600,
      material: additive(dot), renderMode: RenderMode.StretchedBillBoard, rendererEmitterSettings: { speedFactor: 0.03, lengthFactor: 1 },
      behaviors: [gravity(14), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 0.4, 0.1), 1]], [[1, 0], [0, 1]]))],
    });
    const dust = (name: string, hex: number, alpha: number) => this.add(name, {
      shape: new ConeEmitter({ radius: 0.05, angle: 0.7 }), startLife: new IntervalValue(0.5, 1.0), startSpeed: new IntervalValue(0.6, 2.2),
      startSize: new IntervalValue(0.25, 0.45), startColor: new ColorRange(v4(hex, alpha), v4(hex, alpha * 0.7)), maxParticle: 500,
      startRotation: new IntervalValue(0, Math.PI * 2), material: normal(puff),
      behaviors: [new SizeOverLife(fade(1, 2.6)), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[1, 0], [0, 1]])), gravity(0.6)],
    });
    dust('dustConcrete', 0xa9a49a, 0.55);
    dust('dustDirt', 0x8a6a45, 0.6);
    dust('dustFeet', 0xb39a76, 0.32);
    const chunk = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(chunk);
    this.add('clods', {
      shape: new ConeEmitter({ radius: 0.03, angle: 0.6 }), startLife: new IntervalValue(0.35, 0.6), startSpeed: new IntervalValue(2.5, 5),
      startSize: new IntervalValue(0.025, 0.05), startColor: new ColorRange(v4(0x5c4326, 1), v4(0x7a5a36, 1)), maxParticle: 300,
      startRotation: new RandomQuatGenerator(), material: this.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })),
      renderMode: RenderMode.Mesh, instancingGeometry: chunk, behaviors: [gravity(), new Rotation3DOverLife(new RandomQuatGenerator())],
    });
    this.add('splash', {
      shape: new ConeEmitter({ radius: 0.12, angle: 0.45 }), startLife: new IntervalValue(0.35, 0.6), startSpeed: new IntervalValue(2, 4.5),
      startSize: new IntervalValue(0.05, 0.11), startColor: new ColorRange(v4(0xe9f6ff, 0.9), v4(0xbfe4f5, 0.7)), maxParticle: 500,
      material: normal(soft), renderMode: RenderMode.StretchedBillBoard, rendererEmitterSettings: { speedFactor: 0.025, lengthFactor: 1 },
      behaviors: [gravity(), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[1, 0], [0, 1]]))],
    });
    // ---- explosions
    this.add('fireball', {
      shape: new SphereEmitter({ radius: 0.6 }), startLife: new IntervalValue(0.35, 0.7), startSpeed: new IntervalValue(1.5, 5),
      startSize: new IntervalValue(1.2, 2.4), startColor: new ColorRange(v4(0xfff0b0, 1), v4(0xff8a2a, 1)), maxParticle: 200,
      startRotation: new IntervalValue(0, Math.PI * 2), material: additive(puff),
      behaviors: [
        new SizeOverLife(fade(0.7, 1.8)),
        new ColorOverLife(new Gradient([[new QV3(1, 0.95, 0.75), 0], [new QV3(1, 0.45, 0.12), 0.45], [new QV3(0.3, 0.1, 0.05), 1]], [[1, 0], [0.8, 0.5], [0, 1]])),
      ],
    });
    this.add('blastSmoke', {
      shape: new SphereEmitter({ radius: 1 }), startLife: new IntervalValue(1.6, 2.8), startSpeed: new IntervalValue(0.8, 2.4),
      startSize: new IntervalValue(1.6, 2.6), startColor: new ColorRange(v4(0x3a3632, 0.65), v4(0x5a544c, 0.5)), maxParticle: 300,
      startRotation: new IntervalValue(0, Math.PI * 2), material: normal(puff),
      behaviors: [new SizeOverLife(fade(1, 2.4)), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[0, 0], [1, 0.12], [0, 1]])), new ApplyForce(new QV3(0, 1, 0), new ConstantValue(1.4))],
    });
    this.add('debris', {
      shape: new SphereEmitter({ radius: 0.3 }), startLife: new IntervalValue(0.8, 1.4), startSpeed: new IntervalValue(5, 12),
      startSize: new IntervalValue(0.05, 0.13), startColor: new ColorRange(v4(0x2e2b28, 1), v4(0x5a5048, 1)), maxParticle: 300,
      startRotation: new RandomQuatGenerator(), material: this.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })),
      renderMode: RenderMode.Mesh, instancingGeometry: chunk, behaviors: [gravity(), new Rotation3DOverLife(new RandomQuatGenerator())],
    });
    this.add('groundRing', {
      shape: new ConeEmitter({ radius: 0.6, angle: 1.5 }), startLife: new IntervalValue(0.8, 1.3), startSpeed: new IntervalValue(5, 9),
      startSize: new IntervalValue(0.8, 1.3), startColor: new ColorRange(v4(0x8a7c6a, 0.55), v4(0x6e645a, 0.4)), maxParticle: 200,
      startRotation: new IntervalValue(0, Math.PI * 2), material: normal(puff),
      behaviors: [new SizeOverLife(fade(1, 2.4)), new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[1, 0], [0, 1]]))],
    });
  }

  private mat<M extends THREE.Material>(m: M): M {
    this.disposables.push(m);
    return m;
  }

  private add(name: string, p: {
    shape: EmitterShape; startLife: IntervalValue | ConstantValue; startSpeed: IntervalValue | ConstantValue; startSize: IntervalValue | ConstantValue;
    startColor: ColorRange; maxParticle: number; material: THREE.Material; behaviors: Behavior[];
    renderMode?: RenderMode; rendererEmitterSettings?: { speedFactor: number; lengthFactor: number }; instancingGeometry?: THREE.BufferGeometry;
    startRotation?: IntervalValue | RandomQuatGenerator;
  }): void {
    const s = new ParticleSystem({
      duration: 1000, looping: true, worldSpace: true, emissionOverTime: new ConstantValue(0),
      shape: p.shape, startLife: p.startLife, startSpeed: p.startSpeed, startSize: p.startSize, startColor: p.startColor,
      startRotation: p.startRotation, material: p.material, renderMode: p.renderMode ?? RenderMode.BillBoard,
      rendererEmitterSettings: p.rendererEmitterSettings, instancingGeometry: p.instancingGeometry, behaviors: p.behaviors,
    });
    (s as unknown as { maxParticle?: number }).maxParticle = p.maxParticle;
    this.sys[name] = s;
    this.batch.addSystem(s);
    this.group.add(s.emitter);
  }

  /** Fires `count` particles of a system at `pos`, the emitter's cone pointing along `dir` (default up). */
  private burst(name: string, count: number, pos: THREE.Vector3, dir?: THREE.Vector3): void {
    const s = this.sys[name];
    const n = Math.round(count * this.density);
    if (!s || n <= 0) return;
    // (cones point down the emitter's +Z)
    if (dir) this.q.setFromUnitVectors(Z, this.v.copy(dir).normalize());
    else this.q.setFromUnitVectors(Z, Y);
    this.m.compose(pos, this.q, ONE);
    s.emissionState.waitEmiting = n;
    // (three's Matrix4 is what the system runs on at runtime; the typings name quarks.core's own)
    s.emit(0, s.emissionState, this.m as unknown as Parameters<ParticleSystem['emit']>[2]);
  }

  /** Effects farther than `range` m from the camera are not worth drawing. */
  private near(pos: THREE.Vector3, range: number): boolean {
    return this.cam.distanceToSquared(pos) < range * range;
  }

  setCamera(p: THREE.Vector3): void {
    this.cam.copy(p);
  }

  /** A shot: sparks and smoke at the muzzle along `dir`, a casing out to the right. */
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, cls: WeaponClass, suppressed: boolean): void {
    if (!this.near(pos, 70)) return;
    const st = MUZZLE[cls] ?? MUZZLE.rifle;
    const sparks = this.sys.muzzleSparks;
    const cone = sparks.emitterShape as ConeEmitter;
    cone.angle = st.cone;
    sparks.startSpeed = new IntervalValue(st.speed[0], st.speed[1]);
    sparks.startLife = new IntervalValue(st.life[0], st.life[1]);
    sparks.startSize = new IntervalValue(st.size * 0.7, st.size * 1.2);
    if (!suppressed) this.burst('muzzleSparks', st.sparks, pos, dir);
    this.burst('muzzleSmoke', suppressed ? 1 : st.smoke, pos, dir);
    if (st.casing !== 'none' && this.near(pos, 30)) {
      // out to the right of the gun, a little up and back
      const right = this.v.set(-dir.z, 0, dir.x).normalize();
      const s = this.sys[st.casing === 'shell' ? 'casingShell' : 'casingBrass'];
      // (a point emitter fires along the emitter's +Z: aim it out and up)
      _out.copy(right).multiplyScalar(2.2).addScaledVector(Y, 1.6).addScaledVector(dir, -0.6);
      s.startSpeed = new ConstantValue(_out.length());
      _at.copy(pos).addScaledVector(dir, -0.25);
      this.burst(st.casing === 'shell' ? 'casingShell' : 'casingBrass', 1, _at, _out);
    }
  }

  /** A bullet hitting the world (`normal` out of the surface). */
  impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: Surface): void {
    if (!this.near(pos, 60)) return;
    if (surface === 'water') {
      this.burst('splash', 10, pos, Y);
      return;
    }
    if (surface === 'dirt' || surface === 'grass') {
      this.burst('clods', surface === 'dirt' ? 7 : 3, pos, normal);
      this.burst('dustDirt', surface === 'dirt' ? 4 : 2, pos, normal);
      return;
    }
    this.burst('impactSparks', 6, pos, normal);
    this.burst('dustConcrete', 3, pos, normal);
  }

  /** A grenade going off. */
  explosion(pos: THREE.Vector3): void {
    if (!this.near(pos, 160)) return;
    _at.copy(pos).setY(pos.y + 0.6);
    this.burst('fireball', 16, _at, Y);
    this.burst('blastSmoke', 14, _at, Y);
    this.burst('debris', 22, _at, Y);
    _at.copy(pos).setY(pos.y + 0.15);
    this.burst('groundRing', 16, _at, Y);
  }

  /** A footfall at speed on loose ground or in water. */
  step(pos: THREE.Vector3, surface: Surface): void {
    if (!this.near(pos, 45)) return;
    if (surface === 'water') this.burst('splash', 5, pos, Y);
    else if (surface === 'dirt') this.burst('dustFeet', 1, pos, Y);
  }

  update(dt: number): void {
    this.batch.update(Math.min(dt, 0.1));
  }

  /** Ends every particle in flight (a match ending, a map change). */
  clear(): void {
    for (const s of Object.values(this.sys)) s.restart();
  }

  dispose(): void {
    for (const s of Object.values(this.sys)) {
      this.batch.deleteSystem(s);
      s.dispose();
    }
    this.batch.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _out = new THREE.Vector3();
const _at = new THREE.Vector3();
