import * as THREE from 'three';
import type { Rig } from './library';
import { v3, type V3 } from './meshKit';

/**
 * The graphic on the left thigh of long pants. Every design is drawn once into one small
 * shared texture (the print atlas); a character wearing one gets a patch of its pants' own
 * surface (same shape, same shading, same skin weights) whose vertices point into the atlas,
 * and the character shader lays the print over the cloth color there. No extra draw call and
 * no extra material: the patch is part of the character's one mesh.
 */

/** Cloth to print on (bind pose, meters). */
interface Cloth {
  pos: Float32Array;
  nrm: Float32Array;
  index: Uint32Array;
}

export interface PrintPatch {
  pos: Float32Array;
  nrm: Float32Array;
  index: Uint32Array;
  /** Where each vertex is in the print atlas. */
  uv: Float32Array;
}

/** A design is drawn in these units (across, down)... */
const W = 120, H = 156;
/** ...into a cell this size of the atlas. */
const CELL_W = 256, CELL_H = Math.round((CELL_W * H) / W), GUTTER = 8;
const ATLAS_W = 1024, ATLAS_H = 512;
/** Around the leg: from a little inside of the front to well round the outside (radians, 0 = front). */
const PHI0 = -0.62, PHI1 = 1.06;
/** Height on the leg, as fractions from the hip joint down to the knee. */
const S0 = 0.3, S1 = 0.93;

const BLUE = '#2f6bf2';
const SCRIPT = '"Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", "Lucida Handwriting", cursive';

type Draw = (c: CanvasRenderingContext2D) => void;

/** A scorpion seen from above, head up: claws, eight legs, a body in segments and a curled tail. */
function scorpion(c: CanvasRenderingContext2D, x: number, y: number, k: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // body: head plate and segments getting narrower toward the tail
  const seg = (cy: number, rx: number, ry: number) => {
    c.beginPath();
    c.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };
  seg(0, 9.5, 7.5);
  seg(11, 10.5, 6.5);
  seg(21, 9.5, 6);
  seg(30, 8, 5.5);
  seg(38, 6.5, 5);
  for (const s of [1, -1]) {
    // claws: an arm out and forward, ending in an open pincer
    c.lineWidth = 4.6;
    c.beginPath();
    c.moveTo(s * 6, -3);
    c.quadraticCurveTo(s * 21, -5, s * 22, -19);
    c.stroke();
    c.beginPath();
    c.moveTo(s * 22, -17);
    c.quadraticCurveTo(s * 33, -24, s * 22, -38);
    c.quadraticCurveTo(s * 25, -27, s * 22, -17);
    c.fill();
    c.beginPath();
    c.moveTo(s * 22, -17);
    c.quadraticCurveTo(s * 13, -24, s * 17, -36);
    c.quadraticCurveTo(s * 18, -26, s * 22, -17);
    c.fill();
    c.lineWidth = 3;
    c.stroke();
    // legs: four a side, bent at the knee
    c.lineWidth = 2.8;
    for (let i = 0; i < 4; i++) {
      const y0 = 5 + i * 8.5;
      c.beginPath();
      c.moveTo(s * 8, y0);
      c.lineTo(s * (20 + i), y0 - 5 + i * 2.5);
      c.lineTo(s * (29 + i * 0.5), y0 + 5 + i * 4);
      c.stroke();
    }
  }
  // tail: five beads curling up and over to one side, then the stinger
  const tail: Array<[number, number, number]> = [[1, 46, 5.2], [6, 55, 4.9], [15, 61, 4.6], [25, 60, 4.3], [32, 52, 4], [33, 42, 3.7]];
  for (const [tx, ty, r] of tail) {
    c.beginPath();
    c.arc(tx, ty, r, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.moveTo(36.5, 40);
  c.quadraticCurveTo(33, 28, 22, 30);
  c.quadraticCurveTo(29, 33, 29.5, 41);
  c.closePath();
  c.fill();
  c.restore();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = turn + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.42 : r;
    c.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
  }
  c.closePath();
  c.fill();
}

/** The designs, in atlas order (append only: the order is where each one lives in the atlas). */
const DESIGNS: Array<[string, Draw]> = [
  // blue brush script running up across the thigh, a scorpion under it
  ['gocrazy', (c) => {
    c.save();
    c.translate(W * 0.5, H * 0.17);
    c.rotate(-0.2);
    c.fillStyle = BLUE;
    c.strokeStyle = BLUE;
    c.lineWidth = 1.1;
    c.lineJoin = 'round';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    const word = (text: string, px: number, x: number, y: number) => {
      c.font = `italic 700 ${px}px ${SCRIPT}`;
      // (never wider than the patch, whichever font this device has)
      const wide = c.measureText(text).width;
      c.save();
      c.translate(x, y);
      if (wide > W * 0.86) c.scale((W * 0.86) / wide, 1);
      c.fillText(text, 0, 0);
      c.strokeText(text, 0, 0);
      c.restore();
    };
    word('go', 44, -22, 0);
    word('crazy', 42, 6, 30);
    c.restore();
    scorpion(c, W * 0.47, H * 0.62, 0.84, BLUE);
  }],
  // flames licking up from the knee
  ['flames', (c) => {
    const tongue = (x: number, w: number, h: number, color: string) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(x - w, H);
      c.bezierCurveTo(x - w * 1.1, H - h * 0.5, x - w * 0.2, H - h * 0.6, x + w * 0.1, H - h);
      c.bezierCurveTo(x + w * 0.3, H - h * 0.62, x + w * 1.1, H - h * 0.45, x + w, H);
      c.closePath();
      c.fill();
    };
    const xs = [16, 40, 62, 86, 106];
    xs.forEach((x, i) => tongue(x, 17, 96 + ((i * 37) % 44), '#d9301c'));
    xs.forEach((x, i) => tongue(x + 2, 12, 64 + ((i * 29) % 34), '#ff7a1a'));
    xs.forEach((x, i) => tongue(x + 3, 7, 36 + ((i * 23) % 22), '#ffd23f'));
  }],
  // scattered stars
  ['stars', (c) => {
    c.fillStyle = '#f2f1ec';
    const at: Array<[number, number, number, number]> = [[30, 26, 15, 0.2], [84, 44, 11, -0.3], [52, 78, 19, 0.1], [96, 104, 13, 0.5], [28, 120, 12, -0.2], [70, 136, 9, 0.3]];
    for (const [x, y, r, t] of at) star(c, x, y, r, t);
  }],
];

const cellX = (i: number): number => GUTTER + i * (CELL_W + GUTTER * 2);

let atlas: THREE.Texture | null = null;

/** The shared texture every print lives in (transparent where there is no ink). */
export function printAtlas(): THREE.Texture {
  if (atlas) return atlas;
  if (typeof document === 'undefined') {
    atlas = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    atlas.needsUpdate = true;
    return atlas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const c = canvas.getContext('2d');
  if (c) {
    DESIGNS.forEach(([, draw], i) => {
      c.save();
      c.translate(cellX(i), GUTTER);
      c.beginPath();
      c.rect(0, 0, CELL_W, CELL_H);
      c.clip();
      c.scale(CELL_W / W, CELL_H / H);
      draw(c);
      c.restore();
    });
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  atlas = t;
  return t;
}

/**
 * The patch of the left pant leg that carries a print: a lattice of points found on the cloth
 * (rays out from the leg's own axis), a hair above it, with the cloth's normals.
 */
export function buildLegPrint(kind: string, legs: Cloth[], rig: Rig): PrintPatch | null {
  const design = DESIGNS.findIndex(([id]) => id === kind);
  const hip = rig.at.get('UpperLegL'), knee = rig.at.get('LowerLegL');
  if (design < 0 || !legs.length || !hip || !knee) return null;
  const yTop = hip.y + (knee.y - hip.y) * S0, yBot = hip.y + (knee.y - hip.y) * S1;
  const axisAt = (y: number): V3 => {
    const t = (y - hip.y) / (knee.y - hip.y);
    return v3(hip.x + (knee.x - hip.x) * t, y, hip.z + (knee.z - hip.z) * t);
  };
  // the cloth of this leg near the patch: positions and normals of each triangle's corners
  const tris: number[] = [];
  for (const w of legs) {
    for (let t = 0; t < w.index.length; t += 3) {
      let ok = false;
      for (let k = 0; k < 3; k++) {
        const v = w.index[t + k] * 3;
        if (w.pos[v] > 0.02 && w.pos[v + 1] > yBot - 0.04 && w.pos[v + 1] < yTop + 0.04) ok = true;
      }
      if (!ok) continue;
      for (let k = 0; k < 3; k++) {
        const v = w.index[t + k] * 3;
        tris.push(w.pos[v], w.pos[v + 1], w.pos[v + 2], w.nrm[v], w.nrm[v + 1], w.nrm[v + 2]);
      }
    }
  }
  if (!tris.length) return null;
  const NU = 14, NV = 18, n = (NU + 1) * (NV + 1);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const hit = new Uint8Array(n);
  const a = v3(), b = v3(), c = v3(), e1 = v3(), e2 = v3(), pv = v3(), tv = v3(), qv = v3(), d = v3(), nn = v3();
  for (let j = 0; j <= NV; j++) {
    const y = yTop + ((yBot - yTop) * j) / NV;
    const o = axisAt(y);
    for (let i = 0; i <= NU; i++) {
      const at = j * (NU + 1) + i;
      const phi = PHI0 + ((PHI1 - PHI0) * i) / NU;
      d.set(Math.sin(phi), 0, Math.cos(phi));
      let far = 0;
      for (let t = 0; t < tris.length; t += 18) {
        a.set(tris[t], tris[t + 1], tris[t + 2]);
        b.set(tris[t + 6], tris[t + 7], tris[t + 8]);
        c.set(tris[t + 12], tris[t + 13], tris[t + 14]);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        pv.crossVectors(d, e2);
        const det = e1.dot(pv);
        if (Math.abs(det) < 1e-12) continue;
        tv.subVectors(o, a);
        const u = tv.dot(pv) / det;
        if (u < 0 || u > 1) continue;
        qv.crossVectors(tv, e1);
        const v = d.dot(qv) / det;
        if (v < 0 || u + v > 1) continue;
        const dist = e2.dot(qv) / det;
        if (dist <= far) continue;
        far = dist;
        // the cloth's own (smooth) normal there
        nn.set(
          tris[t + 3] * (1 - u - v) + tris[t + 9] * u + tris[t + 15] * v,
          tris[t + 4] * (1 - u - v) + tris[t + 10] * u + tris[t + 16] * v,
          tris[t + 5] * (1 - u - v) + tris[t + 11] * u + tris[t + 17] * v,
        ).normalize();
      }
      if (far > 0) {
        hit[at] = 1;
        pos.set([o.x + d.x * far + nn.x * 0.0014, y + nn.y * 0.0014, o.z + d.z * far + nn.z * 0.0014], at * 3);
        nrm.set([nn.x, nn.y, nn.z], at * 3);
      }
      uv.set([(cellX(design) + (i / NU) * CELL_W) / ATLAS_W, 1 - (GUTTER + (j / NV) * CELL_H) / ATLAS_H], at * 2);
    }
  }
  // a ray that missed (a seam): stand in with the point next to it, moved to its own direction
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        const at = j * (NU + 1) + i;
        if (hit[at]) continue;
        const near = [i > 0 ? at - 1 : -1, i < NU ? at + 1 : -1, j > 0 ? at - (NU + 1) : -1, j < NV ? at + NU + 1 : -1].find((q) => q >= 0 && hit[q]);
        if (near === undefined) continue;
        const y = yTop + ((yBot - yTop) * j) / NV, o = axisAt(y), phi = PHI0 + ((PHI1 - PHI0) * i) / NU;
        const no = axisAt(pos[near * 3 + 1]);
        const r = Math.hypot(pos[near * 3] - no.x, pos[near * 3 + 2] - no.z);
        pos.set([o.x + Math.sin(phi) * r, y, o.z + Math.cos(phi) * r], at * 3);
        nrm.set([Math.sin(phi), 0, Math.cos(phi)], at * 3);
        hit[at] = 1;
      }
    }
  }
  if (hit.some((x) => !x)) return null;
  const index = new Uint32Array(NU * NV * 6);
  let k = 0;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const p00 = j * (NU + 1) + i, p10 = p00 + 1, p01 = p00 + NU + 1, p11 = p01 + 1;
      // counter-clockwise seen from outside (columns run toward the outside of the leg, rows down)
      index.set([p00, p01, p11, p00, p11, p10], k);
      k += 6;
    }
  }
  return { pos, nrm, index, uv };
}
