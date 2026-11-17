import * as THREE from 'three';
import { smoothstep, v3, type V3 } from './meshKit';

/**
 * Measures a head (bind pose, meters, face toward +Z) so procedural pieces can be fitted to it:
 *  - a spherical "depth field": distance from the head's center to the skin in every direction,
 *    which hair, beards and hats are wrapped onto (and which fills the open top of a skull)
 *  - landmarks: eyes, brows, nose, mouth, chin, ears, crown.
 */

/** The skin of a head, ready to measure. */
export interface HeadSurface {
  pos: Float32Array;
  index: Uint32Array;
  /** Per-vertex weight on the Head bone (0..1). */
  headWeight: Float32Array;
}

export interface Ear {
  center: V3;
  top: number;
  lobe: V3;
}

const NT = 120; // azimuth cells (3 degrees)
const PHI_MIN = (-75 * Math.PI) / 180;
const PHI_MAX = Math.PI / 2;
const NP = 56; // elevation cells
const DT = (Math.PI * 2) / NT;
const DP = (PHI_MAX - PHI_MIN) / (NP - 1);

/** Unit direction for azimuth theta (0 = front, +PI/2 = the character's left) and elevation phi. */
export function dirOf(theta: number, phi: number, out = v3()): V3 {
  const c = Math.cos(phi);
  return out.set(Math.sin(theta) * c, Math.sin(phi), Math.cos(theta) * c);
}

export class HeadRig {
  readonly center: V3;
  readonly field = new Float32Array(NT * NP);
  /** Which field cells were measured (the rest were filled in, e.g. an open skull top). */
  readonly hit = new Uint8Array(NT * NP);
  // landmarks
  eyeL!: V3;
  eyeR!: V3;
  eyeHalf!: V3;
  browL!: V3;
  browR!: V3;
  noseTip!: V3;
  noseBaseY!: number;
  chinY!: number;
  mouth!: V3;
  earL!: Ear;
  earR!: Ear;
  crownY!: number;
  /** Half width of the skull at eye level. */
  halfWidth!: number;
  frontZ!: number;
  backZ!: number;

  constructor(skin: HeadSurface, eyes: Float32Array, brows: Float32Array, center?: V3) {
    const box = new THREE.Box3();
    const p = v3();
    for (let i = 0; i < skin.headWeight.length; i++) if (skin.headWeight[i] > 0.5) box.expandByPoint(p.fromArray(skin.pos, i * 3));
    const eyeBox = new THREE.Box3().setFromArray(eyes);
    const cx = (box.min.x + box.max.x) / 2;
    const eyeY = (eyeBox.min.y + eyeBox.max.y) / 2;
    this.center = center ?? v3(cx, eyeY - 0.012, (box.min.z + box.max.z) / 2 - 0.01);
    this.buildField(skin);
    this.measure(skin, eyes, brows, box, cx);
  }

  // ------------------------------------------------------------------ field
  private buildField(skin: HeadSurface): void {
    const c = this.center, f = this.field;
    const a = v3(), b = v3(), cc = v3(), e1 = v3(), e2 = v3(), d = v3(), pv = v3(), tv = v3(), qv = v3(), n = v3();
    const sph = (x: number, y: number, z: number) => [Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z))];
    const idx = skin.index, pos = skin.pos;
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      // only skin that moves with the head (the neck below is not part of the scalp)
      if (skin.headWeight[i0] + skin.headWeight[i1] + skin.headWeight[i2] < 0.9) continue;
      a.fromArray(pos, i0 * 3).sub(c);
      b.fromArray(pos, i1 * 3).sub(c);
      cc.fromArray(pos, i2 * 3).sub(c);
      e1.subVectors(b, a);
      e2.subVectors(cc, a);
      n.crossVectors(e1, e2);
      const s = [sph(a.x, a.y, a.z), sph(b.x, b.y, b.z), sph(cc.x, cc.y, cc.z)];
      let t0 = s[0][0], t1 = t0;
      const thetas = s.map(([th]) => {
        let x = th;
        while (x - s[0][0] > Math.PI) x -= Math.PI * 2;
        while (x - s[0][0] < -Math.PI) x += Math.PI * 2;
        t0 = Math.min(t0, x);
        t1 = Math.max(t1, x);
        return x;
      });
      void thetas;
      const p0 = Math.min(s[0][1], s[1][1], s[2][1]), p1 = Math.max(s[0][1], s[1][1], s[2][1]);
      // near the pole a triangle spans every azimuth
      const polar = p1 > 1.35 || t1 - t0 > 1.5;
      const j0 = Math.max(0, Math.floor((p0 - PHI_MIN) / DP)), j1 = Math.min(NP - 1, Math.ceil((p1 - PHI_MIN) / DP));
      const k0 = polar ? 0 : Math.floor(t0 / DT), k1 = polar ? NT - 1 : Math.ceil(t1 / DT);
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const kk = ((k % NT) + NT) % NT;
          dirOf(kk * DT, PHI_MIN + j * DP, d);
          if (n.dot(d) <= 0) continue; // faces inward: the inside of a hole's rim
          // ray from the center along d against the triangle (Moller-Trumbore)
          pv.crossVectors(d, e2);
          const det = e1.dot(pv);
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          tv.copy(a).negate();
          const u = tv.dot(pv) * inv;
          if (u < -1e-4 || u > 1 + 1e-4) continue;
          qv.crossVectors(tv, e1);
          const v = d.dot(qv) * inv;
          if (v < -1e-4 || u + v > 1 + 1e-4) continue;
          const dist = e2.dot(qv) * inv;
          const cell = j * NT + kk;
          if (dist > 0 && dist > f[cell]) {
            f[cell] = dist;
            this.hit[cell] = 1;
          }
        }
      }
    }
    // fill the gaps (open skull tops, the neck hole) smoothly from their surroundings
    const gaps: number[] = [];
    for (let i = 0; i < f.length; i++) if (!this.hit[i]) gaps.push(i);
    if (gaps.length === f.length) {
      f.fill(0.1);
      return;
    }
    let mean = 0, cnt = 0;
    for (let i = 0; i < f.length; i++) if (this.hit[i]) (mean += f[i]), cnt++;
    for (const i of gaps) f[i] = mean / cnt;
    for (let it = 0; it < 300; it++) {
      for (const i of gaps) {
        const j = Math.floor(i / NT), k = i % NT;
        let s = 0, w = 0;
        for (const [dj, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const jj = j + dj;
          if (jj < 0 || jj >= NP) continue;
          s += f[jj * NT + ((k + dk + NT) % NT)];
          w++;
        }
        f[i] = s / w;
      }
    }
  }

  /** Distance from the center to the skin along (theta, phi), smoothly interpolated. */
  radius(theta: number, phi: number): number {
    let x = theta / DT;
    x = ((x % NT) + NT) % NT;
    const y = Math.min(NP - 1, Math.max(0, (phi - PHI_MIN) / DP));
    const k0 = Math.floor(x), j0 = Math.floor(y);
    const k1 = (k0 + 1) % NT, j1 = Math.min(NP - 1, j0 + 1);
    const fx = x - k0, fy = y - j0;
    const f = this.field;
    return (f[j0 * NT + k0] * (1 - fx) + f[j0 * NT + k1] * fx) * (1 - fy) + (f[j1 * NT + k0] * (1 - fx) + f[j1 * NT + k1] * fx) * fy;
  }

  /** Point on the skin along (theta, phi), pushed out by `offset` along that direction. */
  surface(theta: number, phi: number, offset = 0, out = v3()): V3 {
    return dirOf(theta, phi, out).multiplyScalar(this.radius(theta, phi) + offset).add(this.center);
  }

  /** Outward surface normal at (theta, phi). */
  normal(theta: number, phi: number, out = v3()): V3 {
    const e = 0.02;
    const a = this.surface(theta - e, phi), b = this.surface(theta + e, phi);
    const c = this.surface(theta, phi - e), d = this.surface(theta, phi + e);
    out.crossVectors(b.sub(a), d.sub(c)).normalize();
    // keep it pointing away from the center
    if (out.dot(dirOf(theta, phi)) < 0) out.negate();
    return out;
  }

  /** (theta, phi) of a world point as seen from the head's center. */
  angles(p: V3): [number, number] {
    const x = p.x - this.center.x, y = p.y - this.center.y, z = p.z - this.center.z;
    return [Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z))];
  }

  /** Projects a point onto the skin (along the line from the center), plus `offset`. */
  project(p: V3, offset = 0, out = v3()): V3 {
    const [t, ph] = this.angles(p);
    return this.surface(t, ph, offset, out);
  }

  /** Whether the field was measured at (theta, phi) rather than filled in. */
  measured(theta: number, phi: number): boolean {
    let k = Math.round(theta / DT);
    k = ((k % NT) + NT) % NT;
    const j = Math.min(NP - 1, Math.max(0, Math.round((phi - PHI_MIN) / DP)));
    return this.hit[j * NT + k] === 1;
  }

  // ------------------------------------------------------------------ landmarks
  private measure(skin: HeadSurface, eyes: Float32Array, brows: Float32Array, box: THREE.Box3, cx: number): void {
    const split = (arr: Float32Array) => {
      const L = new THREE.Box3(), R = new THREE.Box3(), p = v3();
      for (let i = 0; i < arr.length; i += 3) (arr[i] >= cx ? L : R).expandByPoint(p.fromArray(arr, i));
      return [L, R];
    };
    const [eL, eR] = split(eyes);
    this.eyeL = eL.getCenter(v3());
    this.eyeR = eR.getCenter(v3());
    this.eyeHalf = eL.getSize(v3()).multiplyScalar(0.5);
    const [bL, bR] = split(brows);
    this.browL = bL.isEmpty() ? this.eyeL.clone().add(v3(0, 0.014, 0.004)) : bL.getCenter(v3());
    this.browR = bR.isEmpty() ? this.eyeR.clone().add(v3(0, 0.014, 0.004)) : bR.getCenter(v3());
    const eyeY = (this.eyeL.y + this.eyeR.y) / 2;
    this.crownY = box.max.y;
    this.frontZ = box.max.z;
    this.backZ = box.min.z;

    // face profile down the middle: rays from the front at x = cx
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(skin.pos, 3));
    mesh.geometry.setIndex(new THREE.BufferAttribute(skin.index, 1));
    mesh.geometry.computeBoundingSphere();
    const rc = new THREE.Raycaster();
    const front = (x: number, y: number): number | null => {
      rc.set(v3(x, y, box.max.z + 0.5), v3(0, 0, -1));
      return rc.intersectObject(mesh, false)[0]?.point.z ?? null;
    };
    const N = 40;
    const y0 = box.min.y, y1 = eyeY;
    const ys: number[] = [], zs: Array<number | null> = [];
    for (let i = 0; i <= N; i++) {
      ys.push(y0 + ((y1 - y0) * i) / N);
      zs.push(front(cx, ys[i]));
    }
    // chin: walking down from the eyes, where the profile falls back toward the neck
    let chinY = box.min.y + (eyeY - box.min.y) * 0.3;
    for (let i = N - 4; i >= 1; i--) {
      const a = zs[i], b = zs[i - 1];
      if (a !== null && (b === null || a - b > 0.018) && ys[i] < eyeY - 0.07) {
        chinY = ys[i];
        break;
      }
    }
    // nose base: the biggest forward step between the chin and the eyes
    let noseY = -1, best = 0.004;
    for (let i = 2; i <= N; i++) {
      const a = zs[i - 2], b = zs[i];
      if (a === null || b === null || ys[i] <= chinY + 0.02 || ys[i] > eyeY - 0.015) continue;
      if (b - a > best) {
        best = b - a;
        noseY = ys[i - 2];
      }
    }
    this.chinY = chinY;
    this.noseBaseY = noseY > 0 ? noseY : chinY + (eyeY - chinY) * 0.45;
    const mouthY = chinY + (this.noseBaseY - chinY) * 0.55;
    this.mouth = v3(cx, mouthY, front(cx, mouthY) ?? box.max.z);
    // nose tip: the furthest-forward skin near the middle, between the nose base and the eyes
    let tipZ = -Infinity;
    this.noseTip = v3(cx, (this.noseBaseY + eyeY) / 2, box.max.z);
    for (let i = 0; i < skin.headWeight.length; i++) {
      const x = skin.pos[i * 3], y = skin.pos[i * 3 + 1], z = skin.pos[i * 3 + 2];
      if (Math.abs(x - cx) < 0.02 && y > this.noseBaseY - 0.006 && y < eyeY - 0.004 && z > tipZ) {
        tipZ = z;
        this.noseTip.set(x, y, z);
      }
    }
    mesh.geometry.dispose();

    // ears: skin sticking out sideways around eye level, toward the back half of the head
    let maxW = 0;
    const p = v3();
    for (let i = 0; i < skin.headWeight.length; i++) {
      p.fromArray(skin.pos, i * 3);
      if (skin.headWeight[i] < 0.5 || Math.abs(p.y - eyeY) > 0.05) continue;
      maxW = Math.max(maxW, Math.abs(p.x - cx));
    }
    this.halfWidth = maxW;
    const ear = (side: 1 | -1): Ear => {
      const pts: V3[] = [];
      for (let i = 0; i < skin.headWeight.length; i++) {
        p.fromArray(skin.pos, i * 3);
        if (skin.headWeight[i] < 0.5 || Math.abs(p.y - eyeY + 0.01) > 0.05) continue;
        if ((p.x - cx) * side > maxW * 0.86 && p.z < this.noseTip.z - 0.06) pts.push(p.clone());
      }
      if (pts.length < 3) {
        const c = v3(cx + side * maxW, eyeY - 0.01, this.center.z);
        return { center: c, top: eyeY + 0.01, lobe: c.clone().setY(eyeY - 0.035) };
      }
      const c = pts.reduce((acc, q) => acc.add(q), v3()).multiplyScalar(1 / pts.length);
      let lobe = pts[0], top = -Infinity;
      for (const q of pts) {
        if (q.y < lobe.y) lobe = q;
        top = Math.max(top, q.y);
      }
      return { center: c, top, lobe: lobe.clone() };
    };
    this.earL = ear(1);
    this.earR = ear(-1);
  }

  get eyeY(): number {
    return (this.eyeL.y + this.eyeR.y) / 2;
  }

  get browY(): number {
    return (this.browL.y + this.browR.y) / 2;
  }
}

// ------------------------------------------------------------------ head & face presets
export interface HeadFrame {
  center: V3;
  eyeY: number;
  chinY: number;
  half: V3;
}

/**
 * Head shape and face shape as gentle deformations of the head (weighted by how much each
 * vertex follows the Head bone, so the neck is left alone). Returns the moved point.
 */
export function shapeHead(p: V3, wHead: number, f: HeadFrame, headShape: string, faceShape: string): V3 {
  if (wHead <= 0) return p;
  const d = v3().subVectors(p, f.center);
  const out = d.clone();
  switch (headShape) {
    case 'round':
      out.multiply(v3(1.06, 0.95, 1.04));
      break;
    case 'narrow':
      out.multiply(v3(0.9, 1.03, 0.97));
      break;
    case 'square': {
      // push the outline toward a rounded square (strongest at the corners) and widen the jaw
      const nx = d.x / f.half.x, nz = d.z / f.half.z;
      const a = Math.atan2(nz, nx);
      const sq = 1 / Math.pow(Math.abs(Math.cos(a)) ** 4 + Math.abs(Math.sin(a)) ** 4, 0.25);
      const k = 1 + (sq - 1) * 0.5;
      out.x *= k * 1.03;
      out.z *= k;
      out.y *= 0.98;
      break;
    }
    default:
      break; // oval: the model's own head
  }
  // face shape works on the lower face: nothing at the eyes, full effect at the chin
  const low = smoothstep(f.eyeY, f.chinY, p.y);
  const front = smoothstep(-0.03, 0.04, d.z);
  switch (faceShape) {
    case 'soft':
      out.x *= 1 + 0.05 * low;
      out.z -= 0.004 * low * front;
      out.y += 0.003 * low;
      break;
    case 'wide':
      out.x *= 1 + 0.13 * low;
      break;
    case 'slim':
      out.x *= 1 - 0.11 * low;
      out.y -= 0.004 * low;
      out.z += 0.002 * low * front;
      break;
    default:
      break; // defined: the model's own face
  }
  return p.copy(d.lerp(out, wHead)).add(f.center);
}
