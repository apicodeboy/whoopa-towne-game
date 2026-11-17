import * as THREE from 'three';
import { LIGHTING } from '../lighting';
import { SMOKE } from '@shared/config/game';

const TRACER_CAP = 96;
const TRACER_SPEED = 320;
const TRACER_LEN = 9;
const SPARK_CAP = 512;
const DUST_CAP = 384;
const DECAL_CAP = 128;
const FLASH_CAP = 12;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

interface Tracer {
  active: boolean;
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  len: number;
  t: number;
  r: number; g: number; b: number;
}

interface SmokeCloud {
  group: THREE.Group;
  sprites: THREE.Sprite[];
  age: number;
  duration: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  grow: number;
}

function softDot(size: number, inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // a few overlapping soft blobs so sprites do not look like perfect discs
  for (let i = 0; i < 9; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.35;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.35;
    const r = size * (0.22 + Math.random() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Simple CPU particle pool rendered as one THREE.Points. */
class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private base: Float32Array;
  private head = 0;
  private gravity: number;
  private drag: number;
  private cap: number;
  private live = 0;

  constructor(cap: number, material: THREE.PointsMaterial, gravity: number, drag: number) {
    this.cap = cap;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.vel = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b;
    const c4 = i * 4;
    this.col[c4] = r; this.col[c4 + 1] = g; this.col[c4 + 2] = b; this.col[c4 + 3] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.live = Math.max(this.live, 1);
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let any = 0;
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1000;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      any++;
      this.vel[k + 1] -= this.gravity * dt;
      this.vel[k] *= damp; this.vel[k + 1] *= damp; this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] *= -0.3;
      }
      this.col[i * 4 + 3] = this.life[i] / this.maxLife[i];
    }
    this.live = any;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Smoke and dust are unlit sprites: dimmed to match the scene's light (see lighting.ts). */
const DIM = LIGHTING.unlitEffects;
const SMOKE_COLOR = new THREE.Color(0xb9bcc2).multiplyScalar(Math.min(1, LIGHTING.unlitEffects * 1.3)).getHex();

/**
 * All transient combat visuals: bullet tracers, muzzle flashes, impact sparks/dust,
 * bullet-hole decals, explosions and smoke clouds. Everything is pooled.
 */
export class Effects {
  readonly group = new THREE.Group();
  /** Scales particle counts (performance mode). */
  density = 1;
  private tracers: Tracer[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private sparks: ParticlePool;
  private dust: ParticlePool;
  private decalMesh: THREE.InstancedMesh;
  private decalHead = 0;
  private decalAge = new Float32Array(DECAL_CAP);
  private flashes: Flash[] = [];
  private flashTex: THREE.CanvasTexture;
  private smokeTex: THREE.CanvasTexture;
  private dotTex: THREE.CanvasTexture;
  private smokes: SmokeCloud[] = [];
  private light: THREE.PointLight;
  private lightLife = 0;
  private disposables: Array<{ dispose(): void }> = [];

  constructor() {
    this.group.name = 'effects';

    // tracers: one instanced stretched box, additive
    const tGeo = new THREE.BoxGeometry(0.028, 0.028, 1);
    tGeo.translate(0, 0, 0.5);
    const tMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.tracerMesh = new THREE.InstancedMesh(tGeo, tMat, TRACER_CAP);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    this.tracerMesh.setColorAt(0, _c.set(0xffffff));
    this.group.add(this.tracerMesh);
    for (let i = 0; i < TRACER_CAP; i++) {
      this.tracers.push({ active: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, len: 0, t: 0, r: 1, g: 1, b: 1 });
    }
    this.disposables.push(tGeo, tMat);

    this.dotTex = softDot(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.flashTex = softDot(128, 'rgba(255,244,200,1)', 'rgba(255,140,40,0)');
    this.smokeTex = smokeTexture();
    this.disposables.push(this.dotTex, this.flashTex, this.smokeTex);

    this.sparks = new ParticlePool(
      SPARK_CAP,
      new THREE.PointsMaterial({
        size: 0.09, map: this.dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, sizeAttenuation: true,
      }),
      9, 1.2,
    );
    this.dust = new ParticlePool(
      DUST_CAP,
      new THREE.PointsMaterial({
        size: 0.55, map: this.dotTex, vertexColors: true, transparent: true, opacity: 0.5,
        depthWrite: false, sizeAttenuation: true,
      }),
      -0.6, 2.6,
    );
    this.group.add(this.sparks.points, this.dust.points);

    // bullet holes
    const dGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const dMat = new THREE.MeshBasicMaterial({
      map: softDot(32, 'rgba(0,0,0,0.9)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.decalMesh = new THREE.InstancedMesh(dGeo, dMat, DECAL_CAP);
    this.decalMesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < DECAL_CAP; i++) this.decalMesh.setMatrixAt(i, _m);
    this.group.add(this.decalMesh);
    this.disposables.push(dGeo, dMat, dMat.map!);

    for (let i = 0; i < FLASH_CAP; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.flashes.push({ sprite, life: 0, max: 1, grow: 0 });
      this.disposables.push(mat);
    }

    this.light = new THREE.PointLight(0xffc27a, 0, 14, 2);
    this.group.add(this.light);
  }

  /** A fast streak from `from` toward `to`. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe7a8): void {
    const t = this.tracers.find((x) => !x.active);
    if (!t) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    t.active = true;
    t.ox = from.x; t.oy = from.y; t.oz = from.z;
    t.dx = dx / len; t.dy = dy / len; t.dz = dz / len;
    t.len = len;
    t.t = 0;
    _c.set(color);
    t.r = _c.r; t.g = _c.g; t.b = _c.b;
  }

  muzzleFlash(pos: THREE.Vector3, scale = 1): void {
    this.flash(pos, 0.42 * scale, 0.05, 0);
    this.light.position.copy(pos);
    this.light.intensity = 9 * scale;
    this.lightLife = 0.05;
  }

  private flash(pos: THREE.Vector3, size: number, life: number, grow: number): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(pos);
    f.sprite.scale.setScalar(size);
    f.sprite.material.opacity = 1;
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = life;
    f.max = life;
    f.grow = grow;
  }

  /** A ring of air puffed out under a double jump. */
  airPuff(pos: THREE.Vector3): void {
    const n = Math.max(4, Math.round(10 * this.density));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.dust.emit(pos.x, pos.y, pos.z, Math.cos(a) * 2.4, -0.6 + Math.random() * 0.4, Math.sin(a) * 2.4, 0.3 + Math.random() * 0.15, 0.95 * DIM, 0.95 * DIM, 0.95 * DIM);
    }
  }

  /** Bullet hitting the world: sparks, a puff of dust and a decal. */
  impact(pos: THREE.Vector3, normal: THREE.Vector3): void {
    const n = Math.max(2, Math.round(7 * this.density));
    for (let i = 0; i < n; i++) {
      const sp = 2 + Math.random() * 5;
      this.sparks.emit(
        pos.x, pos.y, pos.z,
        normal.x * sp + (Math.random() - 0.5) * 4, normal.y * sp + Math.random() * 2.5, normal.z * sp + (Math.random() - 0.5) * 4,
        0.12 + Math.random() * 0.22, 1, 0.78, 0.38,
      );
    }
    const d = Math.max(1, Math.round(3 * this.density));
    for (let i = 0; i < d; i++) {
      this.dust.emit(
        pos.x + normal.x * 0.05, pos.y + normal.y * 0.05, pos.z + normal.z * 0.05,
        normal.x * 1.2 + (Math.random() - 0.5), normal.y * 1.2 + Math.random() * 0.6, normal.z * 1.2 + (Math.random() - 0.5),
        0.35 + Math.random() * 0.3, 0.62 * DIM, 0.6 * DIM, 0.56 * DIM,
      );
    }
    // decal
    const i = this.decalHead;
    this.decalHead = (this.decalHead + 1) % DECAL_CAP;
    _q.setFromUnitVectors(Z_AXIS, normal);
    _v.copy(pos).addScaledVector(normal, 0.012);
    _s.setScalar(0.8 + Math.random() * 0.5);
    _m.compose(_v, _q, _s);
    this.decalMesh.setMatrixAt(i, _m);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalAge[i] = 0;
  }

  /** Bullet hitting a player: a short dark-red burst (stylized, not gory). */
  hitPuff(pos: THREE.Vector3): void {
    const n = Math.max(2, Math.round(6 * this.density));
    for (let i = 0; i < n; i++) {
      this.sparks.emit(
        pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3,
        0.18 + Math.random() * 0.2, 0.9, 0.12, 0.1,
      );
    }
  }

  explosion(pos: THREE.Vector3): void {
    _v.copy(pos).setY(pos.y + 0.6);
    this.flash(_v, 3.5, 0.28, 16);
    this.light.position.copy(_v);
    this.light.intensity = 60;
    this.light.distance = 30;
    this.lightLife = 0.22;
    const n = Math.round(70 * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5;
      const sp = 6 + Math.random() * 14;
      this.sparks.emit(
        pos.x, pos.y + 0.3, pos.z,
        Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp,
        0.35 + Math.random() * 0.5, 1, 0.6 + Math.random() * 0.3, 0.2,
      );
    }
    const d = Math.round(40 * this.density);
    for (let i = 0; i < d; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5;
      this.dust.emit(
        pos.x, pos.y + 0.4, pos.z,
        Math.cos(a) * sp, 1 + Math.random() * 3.5, Math.sin(a) * sp,
        0.9 + Math.random() * 1.2, 0.34 * DIM, 0.32 * DIM, 0.3 * DIM,
      );
    }
  }

  /** A lingering smoke cloud that blocks sight. */
  smoke(pos: THREE.Vector3, duration = SMOKE.duration): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    const count = Math.max(7, Math.round(22 * this.density));
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: SMOKE_COLOR, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SMOKE.radius * 0.8;
      s.position.set(Math.cos(a) * r, 0.6 + Math.random() * 2.6, Math.sin(a) * r);
      const size = 4.2 + Math.random() * 3;
      s.scale.set(size, size, 1);
      s.material.rotation = Math.random() * Math.PI * 2;
      s.userData.spin = (Math.random() - 0.5) * 0.25;
      s.userData.base = 0.5 + Math.random() * 0.3;
      group.add(s);
      sprites.push(s);
    }
    this.group.add(group);
    this.smokes.push({ group, sprites, age: 0, duration });
  }

  update(dt: number): void {
    // tracers
    let n = 0;
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      const head = t.t * TRACER_SPEED;
      const tail = Math.max(0, head - TRACER_LEN);
      if (tail >= t.len) {
        t.active = false;
        continue;
      }
      const end = Math.min(head, t.len);
      _v.set(t.ox + t.dx * tail, t.oy + t.dy * tail, t.oz + t.dz * tail);
      _v2.set(t.dx, t.dy, t.dz);
      _q.setFromUnitVectors(Z_AXIS, _v2);
      _s.set(1, 1, Math.max(0.05, end - tail));
      _m.compose(_v, _q, _s);
      this.tracerMesh.setMatrixAt(n, _m);
      this.tracerMesh.setColorAt(n, _c.setRGB(t.r, t.g, t.b));
      n++;
    }
    this.tracerMesh.count = n;
    if (n > 0) {
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
    }

    this.sparks.update(dt);
    this.dust.update(dt);

    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.material.opacity = f.life / f.max;
      if (f.grow) f.sprite.scale.addScalar(f.grow * dt);
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) {
        this.light.intensity = 0;
        this.light.distance = 14;
      }
    }

    // decals fade out after a while
    let decalsDirty = false;
    for (let i = 0; i < DECAL_CAP; i++) {
      if (this.decalAge[i] < 0) continue;
      this.decalAge[i] += dt;
      if (this.decalAge[i] > 25) {
        this.decalAge[i] = -1;
        _m.makeScale(0, 0, 0);
        this.decalMesh.setMatrixAt(i, _m);
        decalsDirty = true;
      }
    }
    if (decalsDirty) this.decalMesh.instanceMatrix.needsUpdate = true;

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      const fadeIn = Math.min(1, s.age / 1.2);
      const fadeOut = Math.min(1, Math.max(0, (s.duration - s.age) / 3));
      const k = fadeIn * fadeOut;
      for (const sp of s.sprites) {
        sp.material.opacity = (sp.userData.base as number) * k;
        sp.material.rotation += (sp.userData.spin as number) * dt;
        sp.position.y += dt * 0.03;
      }
      if (s.age >= s.duration) {
        for (const sp of s.sprites) sp.material.dispose();
        s.group.removeFromParent();
        this.smokes.splice(i, 1);
      }
    }
  }

  /** Remove lingering effects between matches. */
  clear(): void {
    for (const t of this.tracers) t.active = false;
    for (const s of this.smokes) {
      for (const sp of s.sprites) sp.material.dispose();
      s.group.removeFromParent();
    }
    this.smokes.length = 0;
  }

  dispose(): void {
    this.clear();
    this.sparks.dispose();
    this.dust.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
