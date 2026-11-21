import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDef } from '@shared/map/types';
import { Q_PROJECTILE, type PhysicsWorld } from '@shared/sim/physics';

/**
 * JUMP OFF THE PORCH: the riot, on screen. The riot itself (where it is, how fast it spreads,
 * who it hurts) is decided by the server; this draws it as a crowd standing shoulder to
 * shoulder just outside the safe area and pressing inward as it shrinks, with protest signs,
 * torches, burning barrels and smoke. Only the stretch of the edge near the camera is drawn
 * (a pool of instanced figures is laid out along it every frame), plus a looser crowd all
 * around you when you are caught inside the riot.
 */

const EDGE_MAX = 600;
const FILL_MAX = 170;
const MAX = EDGE_MAX + FILL_MAX;
const SIGN_KINDS = 4;
const SIGN_MAX = 70;
const TORCH_MAX = 90;
const FIRE_MAX = 26;
const SMOKE = 320;
/** Distance (m) from the camera that the crowd is drawn out to. */
const VIEW = 135;
const SPACING = 1.35;
const ROWS = [
  { d: 0.9, density: 0.95 },
  { d: 2.35, density: 0.85 },
  { d: 3.8, density: 0.6 },
  { d: 5.3, density: 0.38 },
];
const SHIRTS = [0xe8e4da, 0x1f1f24, 0xc0392b, 0x2f5f9e, 0x3d7a4a, 0xd9b45a, 0x7a4fa3, 0x8a8a8a, 0xe07a2a, 0x2a9d8f, 0x5a3a2a, 0xf2f2f2];
const SKINS = [0x3b2219, 0x5a3825, 0x7a4a2e, 0x8d5a3b, 0xa86f4c, 0xc68f6a, 0xe0b48f];
const SLOGANS = ['WE OUT HERE', 'WHOOPA!', 'NO PEACE', 'OFF THE PORCH'];

/** Deterministic pseudo-random in [0,1) from an integer. */
function hash(n: number): number {
  let t = (n * 374761393 + 668265263) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function painted(src: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  // everything merged here is non-indexed (boxes are indexed, icosahedra are not)
  const g = src.index ? src.toNonIndexed() : src;
  if (g !== src) src.dispose();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function boxAt(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  return painted(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), color);
}

function flameTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 92, 2, 32, 80, 60);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,80,0.95)');
  grad.addColorStop(0.55, 'rgba(255,110,30,0.6)');
  grad.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(60, 50, 64, 100, 32, 126);
  g.bezierCurveTo(0, 100, 4, 50, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function signTexture(text: string, bg: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 160;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#151515';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = text.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && text.length > 9 ? words : [text];
  const size = lines.length > 1 ? 52 : 60;
  g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  lines.forEach((l, i) => g.fillText(l, 128, 80 + (i - (lines.length - 1) / 2) * size * 1.05, 236));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Two crossed quads (a flame that looks right from any side without billboarding). */
function crossedQuads(w: number, h: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b])!;
  a.dispose();
  b.dispose();
  return g;
}

interface Spot {
  x: number;
  z: number;
  y: number;
  ok: boolean;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class RiotCrowd {
  readonly group = new THREE.Group();
  /** 0..1: how close the riot is to the camera (for the crowd roar). */
  nearness = 0;
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private signs: THREE.InstancedMesh[] = [];
  private torches: THREE.InstancedMesh;
  private barrels: THREE.InstancedMesh;
  private fires: THREE.InstancedMesh;
  private smoke: THREE.Points;
  private smokeData: Array<{ x: number; y: number; z: number; vx: number; vz: number; age: number; life: number }> = [];
  private firePos: Array<{ x: number; y: number; z: number }> = [];
  private spots = new Map<number, Spot>();
  private signN = new Array<number>(SIGN_KINDS).fill(0);
  private torchN = 0;
  private phys: PhysicsWorld;
  private bounds: MapDef['bounds'];
  private round: MapDef['round'];
  private disposables: Array<{ dispose(): void }> = [];

  constructor(phys: PhysicsWorld, map: MapDef) {
    this.phys = phys;
    this.bounds = map.bounds;
    this.round = map.round;
    this.group.name = 'riot-crowd';
    const std = (opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts });

    // ---- the people: clothes (instance color = shirt), head + arms (instance color = skin) ----
    const bodyGeo = mergeGeometries([
      boxAt(0.17, 0.8, 0.2, -0.11, 0.42, 0, 0x3a3d48), // legs (dark: pants pick up a hint of the shirt color)
      boxAt(0.17, 0.8, 0.2, 0.11, 0.42, 0, 0x3a3d48),
      boxAt(0.19, 0.1, 0.3, -0.11, 0.05, -0.03, 0x262626), // shoes
      boxAt(0.19, 0.1, 0.3, 0.11, 0.05, -0.03, 0x262626),
      boxAt(0.48, 0.64, 0.27, 0, 1.13, 0, 0xffffff), // shirt
    ])!;
    const headGeo = mergeGeometries([
      painted(new THREE.IcosahedronGeometry(0.135, 1).scale(1, 1.12, 1).translate(0, 1.62, -0.01), 0xffffff),
      boxAt(0.1, 0.12, 0.1, 0, 1.47, 0, 0xffffff), // neck
    ])!;
    // arms hang from the shoulder line (origin), pointing down: rotating about X raises them
    const armsGeo = mergeGeometries([
      boxAt(0.12, 0.6, 0.13, -0.3, -0.3, 0, 0xffffff),
      boxAt(0.12, 0.6, 0.13, 0.3, -0.3, 0, 0xffffff),
    ])!;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push(geo, mat);
      return m;
    };
    this.body = mk(bodyGeo, std(), MAX);
    this.head = mk(headGeo, std({ roughness: 0.7 }), MAX);
    this.arms = mk(armsGeo, std({ roughness: 0.7 }), MAX);
    for (let i = 0; i < MAX; i++) {
      this.body.setColorAt(i, _c.setHex(0xffffff));
      this.head.setColorAt(i, _c);
      this.arms.setColorAt(i, _c);
    }

    // ---- protest signs (a few slogans), torches ----
    const bgs = ['#f4ead2', '#ffe14d', '#ffffff', '#ff9f5a'];
    for (let k = 0; k < SIGN_KINDS; k++) {
      const tex = signTexture(SLOGANS[k], bgs[k]);
      const board = new THREE.BoxGeometry(0.82, 0.52, 0.03).translate(0, 1.32, 0);
      const stick = painted(new THREE.BoxGeometry(0.04, 1.15, 0.04).translate(0, 0.55, 0.03), 0x7a5c3e);
      const geo = mergeGeometries([painted(board, 0xffffff), stick])!;
      const m = mk(geo, std({ map: tex }), SIGN_MAX);
      this.disposables.push(tex);
      this.signs.push(m);
    }
    const fTex = flameTexture();
    const flameMat = new THREE.MeshBasicMaterial({ map: fTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.disposables.push(fTex, flameMat);
    const torchGeo = mergeGeometries([crossedQuads(0.32, 0.55).translate(0, 0.1, 0)])!;
    this.torches = mk(torchGeo, flameMat, TORCH_MAX);
    this.torches.castShadow = false;
    this.torches.receiveShadow = false;
    this.torches.renderOrder = 8;

    // ---- burning barrels + smoke ----
    const barrelGeo = painted(new THREE.CylinderGeometry(0.3, 0.3, 0.92, 10).translate(0, 0.46, 0), 0x4a3a32);
    this.barrels = mk(barrelGeo, std({ roughness: 0.6, metalness: 0.3 }), FIRE_MAX);
    this.fires = mk(crossedQuads(1.0, 1.7), flameMat, FIRE_MAX);
    this.fires.castShadow = false;
    this.fires.receiveShadow = false;
    this.fires.renderOrder = 8;
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3).setUsage(THREE.DynamicDrawUsage));
    sGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SMOKE * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const sTex = smokeTexture();
    const sMat = new THREE.PointsMaterial({ size: 4.2, map: sTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    this.smoke = new THREE.Points(sGeo, sMat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 9;
    this.group.add(this.smoke);
    this.disposables.push(sGeo, sTex, sMat);
    for (let i = 0; i < SMOKE; i++) this.smokeData.push({ x: 0, y: -100, z: 0, vx: 0, vz: 0, age: 1, life: 0 });
  }

  /**
   * Lays the crowd out for this frame. `zone` = the safe area (the crowd stands outside it),
   * `cam` = where the view is, `me` = the local player (nobody stands on top of you),
   * `intensity` 0..1 = how much of the crowd has gathered.
   */
  update(dt: number, time: number, zone: { x: number; z: number; r: number }, cam: THREE.Vector3, me: { x: number; z: number }, intensity: number): void {
    let n = 0;
    this.signN.fill(0);
    this.torchN = 0;
    this.firePos.length = 0;
    this.nearness = 0;

    if (intensity > 0.01 && zone.r < 800) {
      const cx = zone.x, cz = zone.z, r = Math.max(1, zone.r);
      const dx = cam.x - cx, dz = cam.z - cz;
      const d = Math.hypot(dx, dz);
      const phi = Math.atan2(dz, dx);
      const outside = d - r; // > 0: the camera is in the riot
      this.nearness = intensity * (outside > 0 ? 1 : Math.max(0, 1 + outside / 70) ** 2);

      // slots are anchored to angles around the center, sized for a quantized radius so the
      // crowd keeps its faces while the riot spreads (it just packs a little tighter)
      const rq = Math.pow(1.25, Math.round(Math.log(Math.max(r, 6)) / Math.log(1.25)));
      const dTheta = SPACING / rq;
      const cosA = d < 0.01 ? -1 : (d * d + r * r - VIEW * VIEW) / (2 * d * r);
      if (cosA < 1) {
        const alpha = Math.acos(Math.max(-1, cosA));
        const j0 = Math.round(phi / dTheta);
        const maxK = Math.min(Math.ceil(alpha / dTheta), Math.floor(Math.PI / dTheta));
        for (let k = 0; k <= maxK && n < EDGE_MAX; k++) {
          for (const side of k === 0 ? [1] : [1, -1]) {
            const j = j0 + side * k;
            const th = j * dTheta;
            const ct = Math.cos(th), st = Math.sin(th);
            for (let row = 0; row < ROWS.length && n < EDGE_MAX; row++) {
              const key = j * 8 + row;
              if (hash(key) > ROWS[row].density * intensity) continue;
              const rad = r + ROWS[row].d + (hash(key + 11) - 0.5) * 0.9;
              const tan = (hash(key + 23) - 0.5) * 0.7;
              const x = cx + ct * rad - st * tan, z = cz + st * rad + ct * tan;
              const sp = this.spot(key, x, z);
              if (!sp) continue;
              if ((x - me.x) ** 2 + (z - me.z) ** 2 < 1.6) continue;
              n = this.person(n, key, x, sp.y, z, Math.atan2(ct, st) /* face the center */, time);
            }
            // a burning barrel every ~20 m
            const fk = Math.round(th / (20 / rq));
            if (Math.abs(fk * (20 / rq) - th) < dTheta * 0.5 && this.firePos.length < FIRE_MAX) {
              const fx = cx + ct * (r + 3.1), fz = cz + st * (r + 3.1);
              const sp = this.spot(1_000_000_000 + fk, fx, fz);
              if (sp) this.firePos.push({ x: fx, y: sp.y, z: fz });
            }
          }
        }
      }

      // caught in the riot: a looser crowd all around you
      if (outside > 2) {
        const cell = 3.3;
        const gx0 = Math.floor((cam.x - 42) / cell), gx1 = Math.floor((cam.x + 42) / cell);
        const gz0 = Math.floor((cam.z - 42) / cell), gz1 = Math.floor((cam.z + 42) / cell);
        for (let gx = gx0; gx <= gx1 && n < MAX; gx++) {
          for (let gz = gz0; gz <= gz1 && n < MAX; gz++) {
            const key = 1_000_000 + (gx & 1023) * 1024 + (gz & 1023);
            if (hash(key) > 0.42 * intensity) continue;
            const x = (gx + 0.2 + hash(key + 5) * 0.6) * cell, z = (gz + 0.2 + hash(key + 9) * 0.6) * cell;
            if ((x - cx) ** 2 + (z - cz) ** 2 < (r + 1.5) ** 2) continue;
            if ((x - me.x) ** 2 + (z - me.z) ** 2 < 6) continue;
            if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > 42 * 42) continue;
            const sp = this.spot(key, x, z);
            if (!sp) continue;
            // facing the player half the time, otherwise milling about
            const face = hash(key + 3) < 0.5 ? Math.atan2(-(me.x - x), -(me.z - z)) : hash(key + 4) * Math.PI * 2;
            n = this.person(n, key, x, sp.y, z, face, time);
          }
        }
      }
    }

    this.body.count = this.head.count = this.arms.count = n;
    for (let k = 0; k < SIGN_KINDS; k++) this.signs[k].count = this.signN[k];
    this.torches.count = this.torchN;
    for (const m of [this.body, this.head, this.arms, this.torches, ...this.signs]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // ---- fires ----
    this.firePos.forEach((f, i) => {
      _q.identity();
      this.barrels.setMatrixAt(i, _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(1, 1, 1)));
      const fl = 0.85 + 0.25 * Math.sin(time * 11 + i * 3.1) + 0.12 * Math.sin(time * 23 + i);
      _q.setFromAxisAngle(UP, time * 0.7 + i);
      this.fires.setMatrixAt(i, _m.compose(_p.set(f.x, f.y + 0.82, f.z), _q, _s.set(1, fl, 1)));
    });
    this.barrels.count = this.fires.count = this.firePos.length;
    this.barrels.instanceMatrix.needsUpdate = true;
    this.fires.instanceMatrix.needsUpdate = true;
    this.updateSmoke(dt);
    if (this.spots.size > 6000) this.spots.clear();
  }

  private isTorch(key: number): boolean {
    const h = hash(key + 41);
    return h > 0.9;
  }

  /** Ground height under (x, z) for a crowd member, or null if something solid is there. */
  private spot(key: number, x: number, z: number): Spot | null {
    const b = this.bounds;
    if (x < b.minX - 1 || x > b.maxX + 1 || z < b.minZ - 1 || z > b.maxZ - 0.5) return null;
    const R = this.round;
    if (R && Math.hypot(x - R.x, z - R.z) > R.r) return null;
    let s = this.spots.get(key);
    if (!s || Math.abs(s.x - x) + Math.abs(s.z - z) > 0.7) {
      const from = 2.4;
      const hit = this.phys.raycast(x, from, z, 0, -1, 0, 3, Q_PROJECTILE);
      const y = hit < 0 ? 0 : from - hit;
      // started inside a wall (hit at once), or standing on top of a car / counter: nobody here
      const ok = hit !== 0 && y < 0.6 && y > -0.2;
      s = { x, z, y: Math.max(0, y), ok };
      this.spots.set(key, s);
    }
    return s.ok ? s : null;
  }

  /** Poses one rioter (and whatever they carry). Returns the next free slot. */
  private person(i: number, key: number, x: number, y: number, z: number, face: number, t: number): number {
    const h1 = hash(key + 101), h2 = hash(key + 202), h3 = hash(key + 303);
    const ph = h1 * Math.PI * 2;
    const w = 4.5 + h2 * 3.5;
    const jumper = h3 > 0.93;
    const bob = jumper ? Math.max(0, Math.sin(t * 3.2 + ph)) * 0.38 : Math.abs(Math.sin(t * w * 0.5 + ph)) * 0.08;
    const yaw = face + Math.sin(t * 0.7 + ph) * 0.3;
    const scale = 0.92 + h2 * 0.16;
    _q.setFromAxisAngle(UP, yaw);
    _s.set(scale, scale, scale);
    this.body.setMatrixAt(i, _m.compose(_p.set(x, y + bob, z), _q, _s));
    this.head.setMatrixAt(i, _m);
    this.body.setColorAt(i, _c.setHex(SHIRTS[Math.floor(h2 * SHIRTS.length)]));
    const skin = _c.setHex(SKINS[Math.floor(h3 * SKINS.length)]);
    this.head.setColorAt(i, skin);
    this.arms.setColorAt(i, skin);

    // what the arms are doing: fists in the air, pumping forward, or hanging loose
    const sign = hash(key + 77) > 0.86 ? Math.floor(hash(key + 78) * SIGN_KINDS) : -1;
    const torch = sign < 0 && this.isTorch(key);
    const mode = hash(key + 55);
    let ang: number;
    if (sign >= 0) ang = 2.55 + Math.sin(t * 2 + ph) * 0.12;
    else if (torch || mode < 0.45) ang = 2.75 + Math.sin(t * w + ph) * 0.35;
    else if (mode < 0.7) ang = 1.7 + Math.sin(t * w * 1.3 + ph) * 0.6;
    else ang = 0.25 + Math.sin(t * 2 + ph) * 0.15;
    _q2.setFromEuler(_e.set(ang, yaw, 0, 'YXZ'));
    this.arms.setMatrixAt(i, _m.compose(_p.set(x, y + bob + 1.4 * scale, z), _q2, _s));

    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (sign >= 0 && this.signN[sign] < SIGN_MAX) {
      _q2.setFromEuler(_e.set(0, yaw, Math.sin(t * 1.6 + ph) * 0.18, 'YXZ'));
      this.signs[sign].setMatrixAt(this.signN[sign]++, _m.compose(_p.set(x + fx * 0.22, y + bob + 1.25 * scale, z + fz * 0.22), _q2, _s));
    }
    if (torch && this.torchN < TORCH_MAX) {
      _q2.setFromAxisAngle(UP, t * 2 + ph);
      const fl = 0.85 + 0.3 * Math.sin(t * 13 + ph);
      this.torches.setMatrixAt(this.torchN++, _m.compose(_p.set(x + fx * 0.15, y + bob + 2.05 * scale, z + fz * 0.15), _q2, _s.set(1, fl, 1)));
    }
    return i + 1;
  }

  private updateSmoke(dt: number): void {
    const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.smoke.geometry.attributes.color as THREE.BufferAttribute;
    const fires = this.firePos;
    for (let i = 0; i < SMOKE; i++) {
      const p = this.smokeData[i];
      p.age += dt;
      if (p.age >= p.life) {
        if (!fires.length) {
          p.y = -100;
          p.life = 0;
        } else {
          const f = fires[i % fires.length];
          p.x = f.x + (Math.random() - 0.5) * 0.4;
          p.y = f.y + 1.3;
          p.z = f.z + (Math.random() - 0.5) * 0.4;
          p.vx = (Math.random() - 0.5) * 0.5 + 0.35;
          p.vz = (Math.random() - 0.5) * 0.5;
          p.life = 4 + Math.random() * 3;
          p.age = Math.random() * 0.3;
        }
      } else {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += (1.5 - p.age * 0.12) * dt;
      }
      pos.setXYZ(i, p.x, p.y, p.z);
      const a = p.life > 0 ? Math.sin(Math.PI * Math.min(1, p.age / p.life)) * 0.32 : 0;
      const g = 0.18 + 0.1 * Math.min(1, p.age / 2);
      col.setXYZW(i, g, g, g, a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
