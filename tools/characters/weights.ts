/**
 * Automatic skin weights for the Urban Ink meshes. Each vertex belongs to a body region (so an
 * inner thigh never follows the other leg and an armpit never follows the wrong arm); within
 * its region it blends between bones by distance relative to each bone's flesh radius, then
 * the weights are smoothed over the mesh so joints bend without creases.
 */
import type { Anatomy, Region, Side } from './anatomy';
import { add, len, norm, scale, segment, sub } from './sdf';
import type { InkSkeleton, V3 } from './skeleton';

interface Seg {
  joint: number;
  a: V3;
  b: V3;
  r: number;
}

export interface Weights {
  joints: Uint16Array;
  weights: Float32Array;
}

export function makeWeigher(sk: InkSkeleton, A: Anatomy) {
  const idx = (k: string) => {
    const jt = sk.byKey.get(k);
    if (!jt) throw new Error(`no joint ${k}`);
    return sk.joints.indexOf(jt);
  };
  const j = A.j;
  const segs = new Map<string, Seg>();
  const seg = (k: string, a: V3, b: V3, r: number) => segs.set(k, { joint: idx(k), a, b, r });
  seg('Hips', j('Hips'), add(j('Hips'), [0, -0.1, -0.01]), 0.14);
  seg('Abdomen', j('Abdomen'), j('Torso'), 0.13);
  seg('Torso', j('Torso'), j('Chest'), 0.13);
  seg('Chest', j('Chest'), j('Neck'), 0.14);
  seg('Neck', j('Neck'), j('Head'), 0.055);
  seg('Head', j('Head'), add(j('Head'), [0, 0.2, 0]), 0.09);
  for (const s of ['L', 'R'] as Side[]) {
    seg(`Shoulder${s}`, j(`Shoulder${s}`), j(`UpperArm${s}`), 0.06);
    seg(`UpperArm${s}`, j(`UpperArm${s}`), j(`LowerArm${s}`), 0.05);
    seg(`LowerArm${s}`, j(`LowerArm${s}`), j(`Wrist${s}`), 0.04);
    seg(`Wrist${s}`, j(`Wrist${s}`), j(`Middle2${s}`), 0.03);
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const a = j(`${f}2${s}`), b = j(`${f}3${s}`), c = j(`${f}4${s}`);
      const tip = add(c, scale(norm(sub(c, b)), len(sub(c, b)) * 0.85));
      seg(`${f}2${s}`, a, b, 0.0105);
      seg(`${f}3${s}`, b, c, 0.0095);
      seg(`${f}4${s}`, c, tip, 0.0085);
    }
    const t1 = j(`Thumb1${s}`), t2 = j(`Thumb2${s}`), t3 = j(`Thumb3${s}`);
    seg(`Thumb1${s}`, t1, t2, 0.017);
    seg(`Thumb2${s}`, t2, t3, 0.0115);
    seg(`Thumb3${s}`, t3, add(t3, scale(norm(sub(t3, t2)), 0.026)), 0.0105);
    const knee = j(`LowerLeg${s}`), foot = j(`Foot${s}`);
    const ankle: V3 = [foot[0], 0.09, foot[2] - 0.005];
    seg(`UpperLeg${s}`, j(`UpperLeg${s}`), knee, 0.08);
    seg(`LowerLeg${s}`, knee, ankle, 0.05);
    seg(`Foot${s}`, [foot[0], 0.05, foot[2] - 0.03], [foot[0], 0.04, foot[2] + 0.15], 0.04);
  }
  const fingers = (s: Side) => ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [`${f}2${s}`, `${f}3${s}`, `${f}4${s}`]).concat([`Thumb1${s}`, `Thumb2${s}`, `Thumb3${s}`]);
  const candidates = (r: Region, s: Side): string[] => {
    switch (r) {
      case 'head': return ['Head', 'Neck'];
      case 'neck': return ['Neck', 'Head', 'Chest'];
      case 'torso': return ['Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR'];
      case 'hips': return ['Hips', 'Abdomen', 'UpperLegL', 'UpperLegR'];
      case 'upperarm': return [`Shoulder${s}`, `UpperArm${s}`, `LowerArm${s}`, 'Chest'];
      case 'forearm': return [`UpperArm${s}`, `LowerArm${s}`, `Wrist${s}`];
      case 'hand': return [`LowerArm${s}`, `Wrist${s}`, ...fingers(s)];
      case 'thigh': return ['Hips', `UpperLeg${s}`, `LowerLeg${s}`];
      case 'shin': return [`UpperLeg${s}`, `LowerLeg${s}`, `Foot${s}`];
      case 'foot': return [`LowerLeg${s}`, `Foot${s}`];
    }
  };

  /**
   * Weights for a mesh. `allow` can narrow the bones (a hood must not turn with the head);
   * `regionAt` overrides the region (clothing far from the skin asks at a point nearer the body).
   */
  return function weigh(pos: Float32Array, idxs: Uint32Array, opts: { allow?: (key: string) => boolean; regionAt?: (x: number, y: number, z: number) => Region; sharp?: number; smooth?: number } = {}): Weights {
    const n = pos.length / 3;
    const nj = sk.joints.length;
    const dense = new Float32Array(n * nj);
    const sharp = opts.sharp ?? 7;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const r = (opts.regionAt ?? A.region)(x, y, z);
      const s: Side = x >= 0 ? 'L' : 'R';
      let keys = candidates(r, s);
      if (opts.allow) {
        const kept = keys.filter(opts.allow);
        if (kept.length) keys = kept;
      }
      const scores = keys.map((k) => {
        const g = segs.get(k)!;
        return segment(g.a, g.b, x, y, z).d / g.r;
      });
      const m = Math.min(...scores);
      let sum = 0;
      const ws = scores.map((sc) => {
        const w = Math.exp(-(sc - m) * sharp);
        sum += w;
        return w;
      });
      keys.forEach((k, c) => (dense[i * nj + segs.get(k)!.joint] += ws[c] / sum));
    }
    // smooth over the mesh's edges
    const nbr: number[][] = Array.from({ length: n }, () => []);
    for (let t = 0; t < idxs.length; t += 3) {
      for (let c = 0; c < 3; c++) {
        const a = idxs[t + c], b = idxs[t + ((c + 1) % 3)];
        nbr[a].push(b);
        nbr[b].push(a);
      }
    }
    const it = opts.smooth ?? 2;
    for (let pass = 0; pass < it; pass++) {
      const next = new Float32Array(dense.length);
      for (let i = 0; i < n; i++) {
        const nb = nbr[i];
        for (let k = 0; k < nj; k++) {
          let s = 0;
          for (const v of nb) s += dense[v * nj + k];
          next[i * nj + k] = nb.length ? dense[i * nj + k] * 0.5 + (s / nb.length) * 0.5 : dense[i * nj + k];
        }
      }
      dense.set(next);
    }
    // top four
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const row: Array<[number, number]> = [];
      for (let k = 0; k < nj; k++) if (dense[i * nj + k] > 1e-4) row.push([k, dense[i * nj + k]]);
      row.sort((a, b) => b[1] - a[1]);
      const top = row.slice(0, 4);
      const s = top.reduce((acc, [, w]) => acc + w, 0) || 1;
      top.forEach(([k, w], c) => {
        joints[i * 4 + c] = k;
        weights[i * 4 + c] = w / s;
      });
      if (!top.length) weights[i * 4] = 1;
    }
    return { joints, weights };
  };
}
