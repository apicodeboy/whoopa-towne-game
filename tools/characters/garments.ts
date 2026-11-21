/**
 * The Urban Ink wardrobe: every garment is a real cloth shell (a few millimetres thick, open at
 * its hems) shaped around the body: draped where fabric hangs, tight where it hugs, with
 * designed details (hood, kangaroo pocket, ribbed cuffs, zips, puffer baffles, cargo pockets,
 * stacked denim, sneaker soles and laces) and folds where cloth bunches (elbows, knees, cuffs,
 * ankles). Shading (folds, seams, occlusion) is baked per vertex.
 */
import { SIDES, type Anatomy, type Region, type Side } from './anatomy';
import type { Part } from './build';
import {
  type SDF, add, capsule, chain, clamp, cross, dot, ellipsoid, frame, len, mix, noise, norm, plane, roundBoxIn, roundCone,
  scale, smax, smin, smoothstep, sub,
} from './sdf';
import type { InkSkeleton, V3 } from './skeleton';

export interface Garment {
  part: Part;
  material: string;
  sdf: SDF;
  min: V3;
  max: V3;
  h: number;
  tris: number;
  scene?: SDF;
  ao?: number;
  detail?: (x: number, y: number, z: number) => number;
  allow?: (key: string) => boolean;
  regionAt?: (x: number, y: number, z: number) => Region;
  smooth?: number;
  /** The cloth's outer surface and thickness, and the openings (negative inside, 0 at a hem): the inside is only kept near openings. */
  outer?: SDF;
  th?: number;
  rim?: SDF;
  maxEdge?: number;
}

const sx = (s: Side) => (s === 'L' ? 1 : -1);

/** A cloth shell `th` thick on the inside of `outer`. */
const shell = (outer: SDF, th: number): SDF => (x, y, z) => {
  const d = outer(x, y, z);
  return Math.max(d, -(d + th));
};

/** Elliptic tube standing on the y axis (torso drapes, waistbands). */
function vtube(cx: number, cz: number, y0: number, y1: number, rx0: number, rz0: number, rx1: number, rz1: number): SDF {
  return (x, y, z) => {
    const t = clamp((y - y0) / (y1 - y0), 0, 1);
    const rx = mix(rx0, rx1, t), rz = mix(rz0, rz1, t);
    const q = Math.hypot((x - cx) / rx, (z - cz) / rz);
    const side = (q - 1) * Math.min(rx, rz);
    return Math.max(side, y0 - y, y - y1);
  };
}

export function makeGarments(A: Anatomy, sk: InkSkeleton): Garment[] {
  void sk;
  const j = A.j;
  const cz = 0.035;
  const out: Garment[] = [];
  const body = A.body;
  const noHead = (k: string) => k !== 'Head';

  // ---- arm helpers: where a point is along an arm, and the angle around it ----
  const armFrame = (s: Side) => {
    const sh = j(`UpperArm${s}`), el = j(`LowerArm${s}`), wr = j(`Wrist${s}`);
    const ax = norm(sub(wr, sh));
    const up: V3 = norm(sub([0, 1, 0], scale(ax, ax[1])));
    const fwd = cross(ax, up);
    return { sh, el, wr, ax, up, fwd, len: len(sub(wr, sh)), elbowAt: len(sub(el, sh)) };
  };
  const arms = { L: armFrame('L'), R: armFrame('R') };
  const armCoords = (x: number, y: number, z: number) => {
    const a = x >= 0 ? arms.L : arms.R;
    const p = sub([x, y, z], a.sh);
    const u = dot(p, a.ax);
    const th = Math.atan2(dot(p, a.fwd), dot(p, a.up));
    return { u, th, a };
  };
  /** Folds around the elbow and stacked rings above a cuff (outward displacement). */
  const sleeveFolds = (amp: number, cuffAt: number, x: number, y: number, z: number): number => {
    const { u, th, a } = armCoords(x, y, z);
    if (u < 0.05) return 0;
    const e = u - a.elbowAt;
    const elbow = Math.exp(-((e / 0.07) ** 2)) * (0.5 + 0.5 * Math.sin(th * 3 + e * 70)) * (0.6 + 0.4 * Math.cos(th));
    const cuff = Math.exp(-(((u - cuffAt + 0.05) / 0.05) ** 2)) * Math.abs(Math.sin((u * Math.PI) / 0.016));
    const drape = 0.3 * noise(u * 18, th * 1.6, 0, 7);
    return amp * (elbow * 1.0 + cuff * 0.8 + drape);
  };
  /** Wrinkles on a torso: soft vertical drape below the chest, bunching above the hem. */
  const torsoFolds = (amp: number, hem: number, x: number, y: number, z: number): number => {
    const ang = Math.atan2(x, z - cz);
    const drape = smoothstep(1.3, 1.05, y) * (0.5 + 0.5 * Math.sin(ang * 9 + noise(x * 10, y * 6, z * 10, 3) * 2.5));
    const bunch = Math.exp(-(((y - hem - 0.07) / 0.05) ** 2)) * (0.5 + 0.5 * Math.sin(ang * 13 + y * 40));
    return amp * (drape * 0.7 + bunch * 0.9);
  };
  const cut = (f: SDF, ...cuts: SDF[]): SDF => (x, y, z) => {
    let d = f(x, y, z);
    for (const c of cuts) d = Math.max(d, c(x, y, z));
    return d;
  };
  /** Keeps a sleeve up to `t` of the way from shoulder to wrist. */
  const sleeveEnd = (t: number): SDF => (x, y, z) => {
    const a = x >= 0 ? arms.L : arms.R;
    return dot(sub([x, y, z], a.sh), a.ax) - a.len * t;
  };
  /** Removes the arms beyond the shoulder (tank tops, vests): keeps x within the armhole. */
  const armhole = (depth: number): SDF => (x, y, z) => {
    const a = x >= 0 ? arms.L : arms.R;
    const p = sub([x, y, z], a.sh);
    return dot(p, a.ax) - depth;
  };
  /** Removes what is inside the neck opening above y0 (positive = cut away). */
  const neckHole = (r: number, y0: number): SDF => (x, y, z) => Math.min(r - Math.hypot(x, z - (cz + 0.012)), y - y0);

  const torsoBox = (sleeves: number): [V3, V3] => {
    const reach = sleeves > 0 ? Math.abs(arms.L.sh[0]) + arms.L.len * sleeves + 0.05 : 0.27;
    return [[-reach, 0.82, -0.17], [reach, 1.64, 0.22]];
  };
  const ribbed = (period: number, amp: number) => (x: number, y: number, z: number) => 1 - amp * (0.5 + 0.5 * Math.sin((Math.atan2(x, z - cz) * 2 * Math.PI) / period));
  void ribbed;

  // ---------------------------------------------------------------- tops
  /**
   * A top: body offset blended into a drape (a hanging torso and sleeves), cut at the hem, the
   * neck and the sleeve ends, with folds and extras unioned in.
   */
  const top = (o: {
    material: string; offset: number; drape: [number, number]; hem: number; sleeve: number; sleeveR: [number, number];
    neck: number; neckY: number; folds: number; th: number; extras?: SDF[]; cuts?: SDF[]; cuff?: number; band?: number;
    h?: number; tris?: number; collar?: SDF; detail?: (x: number, y: number, z: number) => number;
  }): Garment => {
    const drapeT = vtube(0, cz - 0.004, o.hem - 0.01, 1.43, o.drape[0], o.drape[1], o.drape[0] * 1.03, o.drape[1] * 1.02);
    const sleeves = SIDES.map((s) => {
      const a = arms[s];
      const end = add(a.sh, scale(a.ax, a.len * Math.max(0.05, o.sleeve)));
      return roundCone(add(a.sh, [-sx(s) * 0.01, 0.005, 0]), end, o.sleeveR[0], o.sleeveR[1]);
    });
    const outer: SDF = (x, y, z) => {
      let d = body(x, y, z) - o.offset;
      d = smin(d, drapeT(x, y, z), 0.05);
      if (o.sleeve > 0) d = smin(d, x >= 0 ? sleeves[0](x, y, z) : sleeves[1](x, y, z), 0.04);
      for (const e of o.extras ?? []) d = smin(d, e(x, y, z), 0.02);
      if (o.collar) d = smin(d, o.collar(x, y, z), 0.012);
      // ribbed bands: the hem (and cuffs) pull in a little
      if (o.band) d += o.band * smoothstep(o.hem + 0.05, o.hem, y);
      if (o.cuff && o.sleeve > 0.6) {
        const { u, a } = armCoords(x, y, z);
        d += o.cuff * smoothstep(a.len * o.sleeve - 0.045, a.len * o.sleeve - 0.025, u);
      }
      const fold = torsoFolds(o.folds, o.hem, x, y, z) + (o.sleeve > 0.3 && Math.abs(x) > Math.abs(arms.L.sh[0]) ? sleeveFolds(o.folds * 1.2, arms.L.len * o.sleeve, x, y, z) : 0);
      return d - fold;
    };
    const cuts: SDF[] = [(x, y) => o.hem - y, neckHole(o.neck, o.neckY), ...(o.cuts ?? [])];
    if (o.sleeve > 0) cuts.push(sleeveEnd(o.sleeve));
    const [min, max] = torsoBox(o.sleeve);
    return {
      part: 'Body', material: o.material, sdf: cut(shell(outer, o.th), ...cuts), min, max,
      h: o.h ?? Math.min(0.0045, o.th * 0.5), tris: o.tris ?? 2400, allow: noHead, scene: (x, y, z) => Math.min(outer(x, y, z), body(x, y, z)),
      detail: o.detail, outer, th: o.th, rim: cut((x, y, z) => -1, ...cuts),
    };
  };
  const seam = (d: number, w = 0.0025, k = 0.18) => 1 - k * Math.exp(-((d / w) ** 2));

  // tee: boxy and oversized (dropped shoulders, wide sleeves to the elbow, a long straight hem)
  out.push(top({ material: 'Top_Tee', offset: 0.006, drape: [0.18, 0.126], hem: 0.875, sleeve: 0.5, sleeveR: [0.074, 0.07], neck: 0.064, neckY: 1.465, folds: 0.003, th: 0.006, h: 0.0029, tris: 2600 }));
  // tank: deep armholes, a scoop neck
  out.push(top({ material: 'Top_Tank', offset: 0.003, drape: [0.15, 0.106], hem: 0.93, sleeve: 0, sleeveR: [0, 0], neck: 0.078, neckY: 1.42, folds: 0.002, th: 0.0055, h: 0.0027, tris: 1500, cuts: [armhole(-0.025), (x, y) => (y > 1.355 ? Math.abs(Math.abs(x) - 0.068) - 0.019 : -1)] }));
  // crop: a short boxy tee
  out.push(top({ material: 'Top_Crop', offset: 0.004, drape: [0.15, 0.106], hem: 1.13, sleeve: 0.36, sleeveR: [0.056, 0.05], neck: 0.07, neckY: 1.45, folds: 0.002, th: 0.0055, h: 0.0027, tris: 1700 }));

  // ---- hoodie (pullover): oversized, hood down, kangaroo pocket, ribbed cuffs and waistband
  const hoodBack: SDF = (x, y, z) => {
    const lump = ellipsoid([0, 1.505, cz - 0.07], [0.125, 0.075, 0.07])(x, y, z);
    const rim = roundCone([0, 1.47, cz + 0.06], [0, 1.52, cz - 0.03], 0.03, 0.035)(x, y, z);
    const ring = Math.abs(Math.hypot(x, z - cz) - 0.085) - 0.024 + Math.max(0, Math.abs(y - 1.48) - 0.03);
    return Math.min(smin(lump, ring, 0.04), rim + 0.01);
  };
  const pocket: SDF = roundBoxIn(frame([0, 1.02, cz + 0.12], [0, 1, 0], [0, 0, 1]), [0.12, 0.065, 0.035], 0.03);
  const hoodieDetail = (x: number, y: number, z: number) => {
    // pocket seam outline, side seams, the hood's seam over the crown
    const px = Math.abs(x) - 0.105, py = Math.abs(y - 1.02) - 0.06;
    const pocketEdge = z > cz + 0.08 ? Math.max(px, py) : 1;
    const side = Math.abs(Math.atan2(Math.abs(x), z - cz) - Math.PI / 2) * 0.15;
    return seam(pocketEdge, 0.003, 0.3) * seam(side, 0.0025, 0.2);
  };
  out.push(top({
    material: 'Top_Hoodie', offset: 0.014, drape: [0.178, 0.13], hem: 0.86, sleeve: 0.97, sleeveR: [0.072, 0.054], neck: 0.072, neckY: 1.47,
    folds: 0.006, th: 0.0075, band: 0.008, cuff: 0.012, extras: [hoodBack, pocket], tris: 3000, detail: hoodieDetail,
  }));
  // drawstrings (trim)
  {
    const strings: SDF[] = SIDES.map((s) => chain([[sx(s) * 0.026, 1.48, cz + 0.105], [sx(s) * 0.03, 1.41, cz + 0.128], [sx(s) * 0.028, 1.33, cz + 0.135]], [0.0035, 0.0032, 0.0034], 0.002));
    const tips: SDF[] = SIDES.map((s) => capsule([sx(s) * 0.028, 1.335, cz + 0.135], [sx(s) * 0.028, 1.315, cz + 0.136], 0.0045));
    const f: SDF = (x, y, z) => Math.min(...strings.map((g) => g(x, y, z)), ...tips.map((g) => g(x, y, z)));
    out.push({ part: 'Body', material: 'Top_Hoodie_Trim', sdf: f, min: [-0.06, 1.29, cz + 0.07], max: [0.06, 1.5, cz + 0.16], h: 0.0012, tris: 260, allow: (k) => k === 'Chest' || k === 'Neck' });
  }

  // ---- zip-up hoodie: open front over a white undershirt, zipper teeth down both edges
  const openFront: SDF = (x, y, z) => (z > cz ? 0.016 - Math.abs(x) : -1);
  out.push(top({
    material: 'Top_ZipHoodie', offset: 0.016, drape: [0.18, 0.132], hem: 0.86, sleeve: 0.97, sleeveR: [0.074, 0.055], neck: 0.075, neckY: 1.47,
    folds: 0.006, th: 0.0075, band: 0.007, cuff: 0.012, extras: [hoodBack], cuts: [openFront], tris: 3000,
    detail: (x, y, z) => hoodieDetail(x, y, z) * seam(Math.abs(Math.abs(x) - 0.02), 0.002, 0.25),
  }));
  out.push(top({ material: 'Top_ZipHoodie_Under', offset: 0.006, drape: [0.15, 0.11], hem: 0.9, sleeve: 0, sleeveR: [0, 0], neck: 0.064, neckY: 1.46, folds: 0.002, th: 0.005, h: 0.0028, tris: 900, cuts: [(x, y, z) => (z < cz ? 1 : Math.abs(x) - 0.06)] }));
  {
    // the teeth follow the hoodie's front edge: sample its surface down the opening
    const hoodieOuter = out[out.length - 2].sdf;
    const pts: Record<Side, V3[]> = { L: [], R: [] };
    for (const s of SIDES) {
      for (let y = 0.88; y <= 1.46; y += 0.02) {
        let z = 0.3;
        const x = sx(s) * 0.0185;
        for (let i = 0; i < 120; i++) {
          const d = hoodieOuter(x, y, z);
          if (d < 0.0004) break;
          z -= Math.max(d * 0.8, 0.0006);
        }
        pts[s].push([x, y, z - 0.002]);
      }
    }
    const teeth: SDF = (x, y, z) => Math.min(chain(pts.L, pts.L.map(() => 0.0032), 0.001)(x, y, z), chain(pts.R, pts.R.map(() => 0.0032), 0.001)(x, y, z));
    out.push({ part: 'Body', material: 'Top_ZipHoodie_Trim', sdf: teeth, min: [-0.035, 0.86, cz + 0.02], max: [0.035, 1.48, cz + 0.22], h: 0.0011, tris: 420, allow: noHead });
  }

  // ---- puffers: big clean horizontal baffles, cropped at the waist. The jacket has its hood
  // lying on the back and a short collar; the vest a tall stand collar and wide armholes, worn
  // over a long sleeve. Both zip up the front (the zip is its own piece, so it can be silver).
  const PUFF_HEM = 0.985, PUFF_PITCH = 0.086;
  const baffleAt = (x: number, y: number, z: number): number => {
    if (Math.abs(x) > Math.abs(arms.L.sh[0]) + 0.01 && y > 1.3) return armCoords(x, y, z).u / (PUFF_PITCH * 1.08);
    return (y - PUFF_HEM) / PUFF_PITCH;
  };
  /** How far a baffle stands out between two stitch lines (0 at the seam). */
  const baffle = (amp: number) => (x: number, y: number, z: number): number => amp * Math.pow(Math.abs(Math.sin(baffleAt(x, y, z) * Math.PI)), 0.55);
  const collar = (r: number, y0: number, y1: number): SDF => vtube(0, cz + 0.008, y0, y1, r, r * 0.92, r * 0.96, r * 0.9);
  const pufferSeams = (x: number, y: number, z: number) => {
    const v = baffleAt(x, y, z);
    const f = v - Math.round(v);
    return 1 - 0.5 * Math.exp(-((f / 0.06) ** 2));
  };
  const pufferHood: SDF = (x, y, z) => {
    const lump = ellipsoid([0, 1.49, cz - 0.09], [0.14, 0.085, 0.078])(x, y, z);
    const roll = Math.abs(Math.hypot(x, (z - cz) * 1.05) - 0.092) - 0.028 + Math.max(0, Math.abs(y - 1.49) - 0.03);
    return smin(lump, z < cz + 0.05 ? roll : roll + (z - cz - 0.05) * 0.6, 0.04);
  };
  /** A zip down the front of a top: a narrow strip lying on its surface, with a pull at the top. */
  const zipOf = (g: Garment, material: string, y0: number, y1: number): Garment => {
    const pts: V3[] = [];
    for (let y = y0; y <= y1 + 1e-6; y += 0.01) {
      let z = 0.32;
      for (let i = 0; i < 160; i++) {
        const d = g.sdf(0, y, z);
        if (d < 0.0004) break;
        z -= Math.max(d * 0.8, 0.0005);
      }
      pts.push([0, y, z]);
    }
    // it bridges the stitch lines between baffles instead of dipping into each one
    const zs = pts.map((p) => p[2]);
    pts.forEach((p, i) => {
      let m = -Infinity;
      for (let k = Math.max(0, i - 4); k <= Math.min(pts.length - 1, i + 4); k++) m = Math.max(m, zs[k] - Math.abs(k - i) * 0.0012);
      p[2] = m + 0.001;
    });
    const strip = chain(pts, pts.map(() => 0.0046), 0.002);
    const top_ = pts[pts.length - 1];
    const pull = roundBoxIn(frame([0, top_[1] - 0.022, top_[2] + 0.006], [0, 1, 0], [0, 0, 1]), [0.0045, 0.013, 0.0022], 0.002);
    const f: SDF = (x, y, z) => Math.min(Math.max(strip(x, y, z), Math.abs(x) - 0.0042), pull(x, y, z));
    return { part: 'Body', material, sdf: f, min: [-0.02, y0 - 0.01, cz + 0.03], max: [0.02, y1 + 0.02, cz + 0.26], h: 0.0012, tris: 420, allow: noHead };
  };
  const puffer = (material: string, sleeves: boolean): Garment => {
    const bf = baffle(0.0125);
    const g = top({
      material, offset: 0.026, drape: [0.18, 0.134], hem: PUFF_HEM, sleeve: sleeves ? 0.94 : 0, sleeveR: [0.086, 0.068], neck: 0.072, neckY: 1.5,
      folds: 0, th: 0.01, band: 0.014, cuff: 0.02, tris: sleeves ? 4600 : 3200, h: 0.0038,
      collar: collar(0.087, 1.42, sleeves ? 1.56 : 1.6), extras: sleeves ? [pufferHood] : [], cuts: sleeves ? [] : [armhole(0.014)], detail: pufferSeams,
    });
    const base = g.sdf;
    // puff out between the stitch lines
    g.sdf = (x, y, z) => {
      const d = base(x, y, z);
      return d < 0.03 ? d - bf(x, y, z) : d;
    };
    return g;
  };
  {
    const jacket = puffer('Top_Puffer', true);
    out.push(jacket, zipOf(jacket, 'Top_Puffer_Zip', PUFF_HEM + 0.012, 1.53));
    const vest = puffer('Top_PufferVest', false);
    out.push(vest, zipOf(vest, 'Top_PufferVest_Zip', PUFF_HEM + 0.012, 1.57));
    // the long sleeve under the vest: only its sleeves ever show
    out.push(top({
      material: 'Top_PufferVest_Under', offset: 0.006, drape: [0.15, 0.108], hem: 1.0, sleeve: 0.955, sleeveR: [0.062, 0.044], neck: 0.062, neckY: 1.47,
      folds: 0.004, th: 0.0055, h: 0.0027, cuff: 0.005, tris: 2000,
      cuts: [(x, y, z) => -0.035 - dot(sub([x, y, z], (x >= 0 ? arms.L : arms.R).sh), (x >= 0 ? arms.L : arms.R).ax)],
    }));
  }

  // ---------------------------------------------------------------- bottoms
  const legInfo = (s: Side) => {
    const hip = j(`UpperLeg${s}`), knee = j(`LowerLeg${s}`), foot = j(`Foot${s}`);
    return { hip, knee, ankle: [foot[0], 0.09, foot[2] - 0.005] as V3 };
  };
  const legs = { L: legInfo('L'), R: legInfo('R') };
  /** Stacked cloth above a hem: where the rolls are (center above the hem, spread, roll pitch). */
  type Stack = { at: number; spread: number; pitch: number };
  const STACK: Stack = { at: 0.08, spread: 0.08, pitch: 0.034 };
  /** 0 in the crease between two rolls, 1 on a roll's crest (weighted by how stacked it is there). */
  const stackRoll = (st: Stack, hemY: number, x: number, y: number, z: number): [number, number] => {
    const L = x >= 0 ? legs.L : legs.R;
    const ang = Math.atan2(x - L.knee[0], z - L.knee[2]);
    const band = Math.exp(-(((y - hemY - st.at) / st.spread) ** 2));
    return [band, 0.5 - 0.5 * Math.cos((y * Math.PI * 2) / st.pitch + Math.sin(ang * 2 + y * 9) * 1.6)];
  };
  const legFolds = (amp: number, stack: number, hemY: number, x: number, y: number, z: number, st: Stack = STACK): number => {
    const L = x >= 0 ? legs.L : legs.R;
    const ang = Math.atan2(x - L.knee[0], z - L.knee[2]);
    const knee = Math.exp(-(((y - L.knee[1] - 0.01) / 0.06) ** 2)) * (0.5 + 0.5 * Math.sin(ang * 4 + y * 60)) * (z > L.knee[2] - 0.01 ? 1 : 0.4);
    // stacked denim above the hem: rolls that twist round the leg (smooth, so they shade cleanly)
    const [band, roll] = stackRoll(st, hemY, x, y, z);
    const ankle = band * roll;
    // long drape folds down the shin from the knee
    const drape = smoothstep(L.knee[1] + 0.05, L.knee[1] - 0.1, y) * smoothstep(hemY + 0.02, hemY + 0.2, y) * (0.5 + 0.5 * Math.sin(ang * 5 + noise(x * 14, y * 4, z * 14, 5) * 2));
    const crotch = Math.exp(-(((y - 0.84) / 0.05) ** 2)) * (0.5 + 0.5 * Math.sin(ang * 5));
    return amp * (knee + crotch * 0.6 + drape * 0.8) + stack * ankle;
  };
  const pants = (o: {
    material: string; offset: number; legR: [number, number]; hem: number; waist: number; folds: number; stack: number; th: number;
    extras?: SDF[]; h?: number; tris?: number; detail?: (x: number, y: number, z: number) => number;
    /** Wide legs: how far out (and forward) of the ankle the hem hangs, and how the cloth stacks. */
    flare?: [number, number]; stackAt?: Stack;
  }): Garment => {
    const fl = o.flare ?? [0, 0];
    const hulls = SIDES.map((s) => roundCone(add(legs[s].hip, [sx(s) * 0.01, 0.0, -0.005]), [legs[s].ankle[0] + sx(s) * fl[0], o.hem, legs[s].ankle[2] + fl[1]], o.legR[0], o.legR[1]));
    const seatHull = vtube(0, cz - 0.01, 0.82, o.waist, 0.172, 0.118, 0.165, 0.112);
    const outer: SDF = (x, y, z) => {
      let d = body(x, y, z) - o.offset;
      d = smin(d, seatHull(x, y, z), 0.03);
      d = smin(d, x >= 0 ? hulls[0](x, y, z) : hulls[1](x, y, z), 0.05);
      for (const e of o.extras ?? []) d = smin(d, e(x, y, z), 0.012);
      // waistband pulls in; belt line
      d += 0.004 * smoothstep(o.waist - 0.045, o.waist - 0.03, y);
      return d - legFolds(o.folds, o.stack, o.hem, x, y, z, o.stackAt);
    };
    const cutsP: SDF[] = [(x, y) => y - o.waist, (x, y) => o.hem - y];
    const sdf = cut(shell(outer, o.th), ...cutsP);
    return {
      part: 'Legs', material: o.material, sdf, min: [-0.3, Math.max(0, o.hem - 0.01), -0.2], max: [0.3, o.waist + 0.01, 0.22],
      outer, th: o.th, rim: cut(() => -1, ...cutsP),
      h: o.h ?? 0.0038, tris: o.tris ?? 2200, scene: (x, y, z) => Math.min(outer(x, y, z), body(x, y, z)),
      regionAt: (x, y, z) => (y > 0.86 && Math.abs(x) < 0.06 ? 'hips' : A.region(x, y, z) === 'torso' ? 'hips' : A.region(x, y, z)),
      detail: o.detail,
    };
  };
  const denim = (x: number, y: number, z: number) => {
    // a faded front (the thighs) and a little twill noise
    const L = x >= 0 ? legs.L : legs.R;
    const front = smoothstep(L.knee[2] - 0.02, L.knee[2] + 0.06, z) * Math.exp(-(((y - 0.72) / 0.14) ** 2));
    return 1 + 0.18 * front + 0.04 * noise(x * 220, y * 60, z * 220, 9);
  };
  out.push(pants({ material: 'Bottom_Jeans', offset: 0.008, legR: [0.088, 0.062], hem: 0.06, waist: 0.95, folds: 0.003, stack: 0.004, th: 0.0065, detail: denim }));
  // the baggy pants: worn low, very wide all the way down, the cloth piling up in rolls on the shoe
  const BAGGY_STACK: Stack = { at: 0.15, spread: 0.15, pitch: 0.052 };
  const baggy = pants({
    material: 'Bottom_BaggyJeans', offset: 0.016, legR: [0.12, 0.118], hem: 0.012, waist: 0.95, folds: 0.005, stack: 0.017, th: 0.008, tris: 3800,
    flare: [0.022, 0.012], stackAt: BAGGY_STACK,
    // each crease between two rolls is a dark line
    detail: (x, y, z) => {
      const [band, roll] = stackRoll(BAGGY_STACK, 0.012, x, y, z);
      return 1 - 0.5 * band * Math.exp(-((roll / 0.22) ** 2));
    },
  });
  out.push(baggy);
  // ---- on the baggy pants: a studded belt, and the waistband of the boxers showing above it
  {
    const y0 = 0.9, y1 = 0.94;
    const surf: SDF = (x, y, z) => baggy.outer!(x, y, z) - 0.0045;
    const band: SDF = (x, y, z) => Math.max(shell(surf, 0.008)(x, y, z), y - y1, y0 - y);
    out.push({ part: 'Legs', material: 'Belt', sdf: band, min: [-0.25, y0 - 0.01, -0.15], max: [0.25, y1 + 0.01, 0.21], h: 0.0022, tris: 520, regionAt: () => 'hips', maxEdge: 0.04 });
    // studs: two rows of little pyramids all the way round, and a square buckle in front
    const N = 46, rows = [y0 + 0.0115, y1 - 0.0115];
    const axisZ = cz - 0.01;
    const studs: Array<{ c: V3; n: V3; t: V3 }[]> = rows.map((yy) => Array.from({ length: N }, (_v, i) => {
      const a = ((i + 0.5) / N) * Math.PI * 2;
      const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
      let r = 0.32;
      for (let k = 0; k < 200; k++) {
        const d = surf(dir[0] * r, yy, axisZ + dir[2] * r);
        if (d < 0.0003) break;
        r -= Math.max(d * 0.7, 0.0004);
      }
      const c: V3 = [dir[0] * r, yy, axisZ + dir[2] * r];
      const e = 0.002;
      const n = norm([surf(c[0] + e, c[1], c[2]) - surf(c[0] - e, c[1], c[2]), 0, surf(c[0], c[1], c[2] + e) - surf(c[0], c[1], c[2] - e)]);
      return { c, n, t: [n[2], 0, -n[0]] as V3 };
    }));
    const S = 0.0052;
    const buckle = (() => {
      const c = studs[0].length ? ((): V3 => {
        let z = 0.32;
        for (let k = 0; k < 200; k++) {
          const d = surf(0, (y0 + y1) / 2, z);
          if (d < 0.0003) break;
          z -= Math.max(d * 0.7, 0.0004);
        }
        return [0, (y0 + y1) / 2, z];
      })() : ([0, 0.92, 0.15] as V3);
      const f = frame(c, [0, 1, 0], [0, 0, 1]);
      const outer = roundBoxIn(f, [0.03, 0.026, 0.0045], 0.004), inner = roundBoxIn(f, [0.02, 0.016, 0.02], 0.003);
      const prong = capsule([c[0] - 0.02, c[1], c[2] + 0.004], [c[0] + 0.026, c[1], c[2] + 0.004], 0.0028);
      return (x: number, y: number, z: number) => Math.min(Math.max(outer(x, y, z), -inner(x, y, z)), prong(x, y, z));
    })();
    const metal: SDF = (x, y, z) => {
      let d = buckle(x, y, z);
      // (no studs under the buckle)
      if (Math.abs(x) < 0.04 && z > axisZ) return d;
      const a = Math.atan2(x, z - axisZ);
      const i0 = Math.floor((((a / (Math.PI * 2)) % 1) + 1) % 1 * N);
      for (const row of studs) {
        for (let di = -1; di <= 1; di++) {
          const st = row[(i0 + di + N) % N];
          const px = x - st.c[0], py = y - st.c[1], pz = z - st.c[2];
          const w = px * st.n[0] + pz * st.n[2], u = px * st.t[0] + pz * st.t[2];
          d = Math.min(d, Math.max(Math.max(Math.abs(u), Math.abs(py)) + w - S, -w - 0.002));
        }
      }
      return d;
    };
    out.push({ part: 'Legs', material: 'Belt_Metal', sdf: metal, min: [-0.25, y0 - 0.008, -0.15], max: [0.25, y1 + 0.008, 0.22], h: 0.0011, tris: 1500, regionAt: () => 'hips', maxEdge: 0.02 });
    // boxers: a wide elastic waistband hugging the body, coming up out of the pants
    const wb0 = y1 - 0.012, wb1 = 1.006;
    const elastic: SDF = (x, y, z) => Math.max(shell((px, py, pz) => body(px, py, pz) - 0.0075, 0.006)(x, y, z), y - wb1, wb0 - y);
    out.push({
      part: 'Legs', material: 'Waistband', sdf: elastic, min: [-0.22, wb0 - 0.01, -0.14], max: [0.22, wb1 + 0.01, 0.19], h: 0.0024, tris: 460, regionAt: () => 'hips', maxEdge: 0.04,
      detail: (x, y) => 1 - 0.3 * Math.exp(-(((y - wb0 - 0.014) / 0.0025) ** 2)) - 0.3 * Math.exp(-(((y - wb1 + 0.006) / 0.0025) ** 2)),
    });
  }
  out.push(pants({ material: 'Bottom_SlimJeans', offset: 0.006, legR: [0.082, 0.05], hem: 0.075, waist: 0.95, folds: 0.002, stack: 0.002, th: 0.0055, h: 0.0028, detail: denim }));
  {
    const pockets: SDF[] = SIDES.map((s) => {
      const L = legs[s];
      const c = add(L.hip, [sx(s) * 0.085, -0.25, 0.005]);
      return roundBoxIn(frame(c, norm(sub(L.knee, L.hip)), [sx(s), 0, 0]), [0.022, 0.08, 0.065], 0.012);
    });
    out.push(pants({
      material: 'Bottom_Cargo', offset: 0.012, legR: [0.1, 0.08], hem: 0.045, waist: 0.95, folds: 0.0045, stack: 0.0055, th: 0.007, extras: pockets, tris: 2600,
      detail: (x, y) => 1 - 0.25 * Math.exp(-(((y - 0.72) / 0.004) ** 2)) * (Math.abs(x) > 0.15 ? 1 : 0),
    }));
  }
  out.push(pants({ material: 'Bottom_Leggings', offset: 0.0025, legR: [0.07, 0.03], hem: 0.1, waist: 1.02, folds: 0, stack: 0, th: 0.0045, h: 0.0024, tris: 2000 }));
  {
    const g = pants({ material: 'Bottom_Shorts', offset: 0.012, legR: [0.105, 0.098], hem: 0.6, waist: 0.95, folds: 0.004, stack: 0, th: 0.007, tris: 1600 });
    out.push(g);
  }

  // ---------------------------------------------------------------- shoes
  /**
   * A sneaker built on a "last": cross-sections lofted from heel to toe (tall at the heel
   * counter, high over the instep, a low rounded toe box), a collar opening at the ankle, a
   * tongue, laces lying on the instep, and a cupsole with toe spring and a thicker heel.
   */
  const shoe = (o: {
    name: string; soleH: number; heelLift: number; soleW: number; length: number; collarY: number; instep: number; toeH: number;
    width: number; puffy: number; boot?: boolean; lugs?: boolean;
  }): Garment[] => {
    const res: Garment[] = [];
    const per = SIDES.map((s) => {
      const f = j(`Foot${s}`);
      const cx = f[0];
      const heelZ = f[2] - 0.085, L = o.length, toeZ = heelZ + L;
      const k = sx(s);
      // sole height along the foot: thicker heel, the toe springs up
      const soleTop = (t: number) => o.soleH + o.heelLift * smoothstep(0.55, 0.05, t) + 0.006 * smoothstep(0.82, 1, t);
      const springY = (t: number) => 0.011 * smoothstep(0.78, 1, t) ** 1.5;
      // the last: width, height of the top line and centre height, per fraction along the foot
      const sec = (t: number) => {
        const w = o.width * (0.78 + 0.22 * Math.sin(Math.PI * clamp(t * 1.15, 0, 1))) * (t > 0.86 ? 1 - (t - 0.86) * 1.6 : 1);
        const top = t < 0.18 ? mix(o.collarY, o.collarY - 0.004, t / 0.18)
          : t < 0.62 ? mix(o.collarY - 0.004, soleTop(t) + o.instep, (t - 0.18) / 0.44)
          : mix(soleTop(t) + o.instep, soleTop(t) + springY(t) + o.toeH, smoothstep(0.62, 1, t));
        const bot = soleTop(t) - 0.004 + springY(t);
        return { w, top, bot };
      };
      const last: SDF = (x, y, z) => {
        const t = (z - heelZ) / L;
        const tc = clamp(t, 0, 1);
        const { w, top, bot } = sec(tc);
        const cy = (top + bot) / 2, hy = (top - bot) / 2;
        // superellipse cross-section: flatter sides than a tube
        const ux = Math.abs(x - cx) / (w / 2), uy = Math.abs(y - cy) / hy;
        const q = Math.pow(Math.pow(ux, 2.6) + Math.pow(uy, 2.6), 1 / 2.6);
        let d = (q - 1) * Math.min(w / 2, hy);
        // rounded heel and toe caps
        const over = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0;
        if (over > 0) d = Math.hypot(Math.max(d, 0), over) + Math.min(d, 0) * 0;
        return d - o.puffy;
      };
      // the ankle opening: a slanted cylinder down into the shoe, and the tongue in it
      const opening = roundCone([cx, o.collarY - 0.03, heelZ + 0.07], [cx, o.collarY + 0.25, heelZ + 0.06], 0.034, 0.04);
      const tongue = roundBoxIn(frame([cx, o.collarY - 0.01, heelZ + 0.105], [0, 1, 0.35], [0, 0, 1]), [0.026, 0.045, 0.007], 0.006);
      const upper: SDF = (x, y, z) => {
        let d = smax(last(x, y, z), -opening(x, y, z), 0.008);
        d = smin(d, tongue(x, y, z), 0.008);
        // padded collar rim
        d = smin(d, roundCone([cx - 0.035, o.collarY - 0.004, heelZ + 0.05], [cx + 0.035, o.collarY - 0.004, heelZ + 0.05], 0.011, 0.011)(x, y, z) + (Math.abs(x - cx) < 0.03 && z > heelZ + 0.09 ? 1 : 0), 0.01);
        return Math.max(d, soleTop(clamp((z - heelZ) / L, 0, 1)) - 0.006 - y);
      };
      // cupsole: the footprint outline (a little wider than the upper) extruded, edges rounded
      const sole: SDF = (x, y, z) => {
        const t = clamp((z - heelZ) / L, 0, 1);
        const w = sec(t).w / 2 + 0.006;
        const over = z < heelZ ? heelZ - z : z > toeZ ? z - toeZ : 0;
        const side = Math.hypot(Math.max(Math.abs(x - cx) - w, 0), over) - 0.004;
        const y0 = springY(t), y1 = soleTop(t);
        const vert = Math.max(y0 - y, y - y1);
        let d = smax(side, vert, 0.006);
        d += 0.0012 * Math.exp(-(((y - (y0 + y1) * 0.55) / 0.0018) ** 2)); // midsole groove
        if (o.lugs && y < y0 + 0.008) d += 0.003 * (Math.sin(z * 240) > 0.2 ? 1 : 0);
        return d;
      };
      // laces: bars across the instep, lying on the last's top line
      const bars: SDF[] = [];
      const nb = o.boot ? 7 : 5;
      for (let i = 0; i < nb; i++) {
        const t = mix(0.62, 0.3, i / (nb - 1));
        const lz = heelZ + t * L;
        const yTop = sec(t).top + o.puffy;
        bars.push(capsule([cx - 0.017, yTop + 0.001, lz], [cx + 0.017, yTop + 0.001, lz + 0.003 * k * 0], 0.0026));
      }
      const laces: SDF = (x, y, z) => {
        let d = 1;
        for (const b of bars) d = Math.min(d, b(x, y, z));
        return d;
      };
      return { cx, heelZ, toeZ, upper, sole, laces, sec };
    });
    const both = (key: 'sole' | 'upper' | 'laces'): SDF => (x, y, z) => (x >= 0 ? per[0][key](x, y, z) : per[1][key](x, y, z));
    const box: [V3, V3] = [[-0.22, -0.002, Math.min(per[0].heelZ, per[1].heelZ) - 0.02], [0.22, o.collarY + 0.04, Math.max(per[0].toeZ, per[1].toeZ) + 0.02]];
    const region = (): Region => 'foot';
    // panels: a toe cap and a side swoosh-like stripe as stitched lines in the shading
    const panels = (x: number, y: number, z: number) => {
      const P = x >= 0 ? per[0] : per[1];
      const t = (z - P.heelZ) / (P.toeZ - P.heelZ);
      const toeCap = Math.abs(t - 0.74) < 0.008 ? 0.75 : 1;
      const stripe = Math.abs(y - (0.045 + 0.06 * (1 - t) * (1 - t))) < 0.003 && Math.abs(x - P.cx) > 0.02 ? 0.72 : 1;
      return toeCap * stripe;
    };
    res.push({ part: 'Feet', material: `Shoe_${o.name}`, sdf: both('upper'), min: box[0], max: box[1], h: 0.0024, tris: 1500, regionAt: region, detail: panels, maxEdge: 0.03 });
    res.push({ part: 'Feet', material: `Shoe_${o.name}_Sole`, sdf: both('sole'), min: box[0], max: [0.22, o.soleH + o.heelLift + 0.02, box[1][2]], h: 0.0022, tris: 800, regionAt: region, maxEdge: 0.04 });
    res.push({ part: 'Feet', material: `Shoe_${o.name}_Lace`, sdf: both('laces'), min: box[0], max: box[1], h: 0.0009, tris: 360, regionAt: region });
    return res;
  };
  out.push(...shoe({ name: 'Lowtop', soleH: 0.024, heelLift: 0.006, soleW: 0.1, length: 0.29, collarY: 0.1, instep: 0.062, toeH: 0.038, width: 0.098, puffy: 0.003 }));
  out.push(...shoe({ name: 'Running', soleH: 0.026, heelLift: 0.014, soleW: 0.096, length: 0.29, collarY: 0.096, instep: 0.06, toeH: 0.034, width: 0.092, puffy: 0.002 }));
  out.push(...shoe({ name: 'Chunky', soleH: 0.04, heelLift: 0.012, soleW: 0.114, length: 0.305, collarY: 0.135, instep: 0.07, toeH: 0.044, width: 0.11, puffy: 0.006 }));
  out.push(...shoe({ name: 'Boot', soleH: 0.03, heelLift: 0.012, soleW: 0.108, length: 0.295, collarY: 0.24, instep: 0.075, toeH: 0.045, width: 0.104, puffy: 0.004, boot: true, lugs: true }));
  void plane;
  return out;
}
