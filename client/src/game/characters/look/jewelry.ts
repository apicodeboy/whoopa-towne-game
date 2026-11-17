import { METAL, ProcMesh, SLOT, fixed, style, v3, type Style, type V3 } from './meshKit';

/**
 * Pieces fitted to the body (not the head): necklaces, wrist pieces and the crew arm bands.
 * Measurements come from the assembled body (see BodyQuery in assemble.ts).
 */

export interface BodyQuery {
  /** Bind-pose joint position. */
  joint(key: string): V3;
  /** Axis (x, z) of the neck: torso() is measured around a vertical line through it. */
  neckAxis: V3;
  /** Outer radius of the neck / shoulders / chest at angle alpha (0 = front, +PI/2 = left) and height y. */
  torso(alpha: number, y: number): number;
  /** Outer radius of a limb around the bone a->b at fraction s (widest point within +-half meters). */
  limb(a: string, b: string, s: number, half: number): number;
}

/** A band around a limb (watch strap, wristband, crew band): an outer wall plus both edges. */
function cuff(out: ProcMesh, a: V3, b: V3, s: number, width: number, radius: number, thick: number, look: Style | ((u: number) => Style), sides = 14): void {
  const axis = v3().subVectors(b, a).normalize();
  const c = a.clone().lerp(b, s);
  const ref = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize();
  const e2 = axis.clone().cross(e1);
  const ring = (along: number, r: number) => {
    const pts: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      pts.push(c.clone().addScaledVector(axis, along).addScaledVector(e1, Math.cos(ang) * r).addScaledVector(e2, Math.sin(ang) * r));
    }
    return pts;
  };
  const h = width / 2;
  const rows = [ring(-h, radius - 0.002), ring(-h, radius + thick), ring(h, radius + thick), ring(h, radius - 0.002)];
  const sty = typeof look === 'function' ? look : () => look;
  out.grid(rows, (_r, k) => sty(k / sides), { flat: true, wrap: true, flip: true });
}

/** The left/right arm keys for a side. */
const ARM = (side: 'L' | 'R') => ({ up: `UpperArm${side}`, low: `LowerArm${side}`, wrist: `Wrist${side}` });

/** Crew colored bands around both upper arms (team readability in matches). */
export function buildCrewBands(body: BodyQuery, out: ProcMesh): void {
  for (const side of ['L', 'R'] as const) {
    const a = ARM(side);
    const r = body.limb(a.up, a.low, 0.5, 0.02);
    cuff(out, body.joint(a.up), body.joint(a.low), 0.5, 0.034, r, 0.0028, style(SLOT.CREW, { rough: 0.6 }));
  }
}

export function buildWrist(kind: string, body: BodyQuery, out: ProcMesh): void {
  if (kind === 'none') return;
  const at = (side: 'L' | 'R', s: number) => {
    const a = ARM(side);
    const A = body.joint(a.low), B = body.joint(a.wrist);
    return { A, B, r: body.limb(a.low, a.wrist, s, 0.012) };
  };
  if (kind === 'wristbands') {
    for (const side of ['L', 'R'] as const) {
      const { A, B, r } = at(side, 0.84);
      cuff(out, A, B, 0.84, 0.03, r, 0.005, fixed(0x17181c, { rough: 0.9, shade: 1 }));
    }
    return;
  }
  if (kind === 'bracelet') {
    const { A, B, r } = at('R', 0.93);
    const axis = v3().subVectors(B, A).normalize();
    const c = A.clone().lerp(B, 0.93);
    out.torus(c, axis, r + 0.0035, 0.0017, (u) => (Math.floor(u * 22) % 2 ? METAL.gold : fixed(0xc9982f, { metal: 0.65, rough: 0.3 })), 22, 5);
    return;
  }
  // watch on the left wrist: strap plus a face on the back of the wrist
  const gold = kind === 'goldwatch';
  const { A, B, r } = at('L', 0.86);
  cuff(out, A, B, 0.86, 0.016, r, 0.0026, gold ? METAL.gold : fixed(0x1d1e22, { rough: 0.7 }));
  const axis = v3().subVectors(B, A).normalize();
  const c = A.clone().lerp(B, 0.86);
  // the back of the wrist: out and up from the body, square to the forearm (works for any arm pose)
  const ref = v3(1, 1, 0).normalize();
  const outward = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize();
  const base = c.clone().addScaledVector(outward, r + 0.002);
  const top = base.clone().addScaledVector(outward, 0.0045);
  out.tube([base, top], 0.0095, 12, gold ? METAL.gold : METAL.steel, { flat: true });
  const dial = top.clone().addScaledVector(outward, 0.0003);
  out.tube([top, dial], 0.0075, 12, gold ? fixed(0x1a1712, { rough: 0.3 }) : fixed(0xe8ecef, { rough: 0.3 }), { flat: true });
}

export function buildNecklace(kind: string, body: BodyQuery, out: ProcMesh): void {
  if (kind === 'none') return;
  const neck = body.joint('Neck');
  const ax = body.neckAxis;
  if (kind === 'choker') {
    const y = neck.y + 0.03;
    const n = 36;
    const rows: V3[][] = [[], [], [], []];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = body.torso(a, y);
      const d = v3(Math.sin(a), 0, Math.cos(a));
      rows[0].push(v3(ax.x, y + 0.006, ax.z).addScaledVector(d, r - 0.0015));
      rows[1].push(v3(ax.x, y + 0.006, ax.z).addScaledVector(d, r + 0.0018));
      rows[2].push(v3(ax.x, y - 0.006, ax.z).addScaledVector(d, r + 0.0018));
      rows[3].push(v3(ax.x, y - 0.006, ax.z).addScaledVector(d, r - 0.0015));
    }
    out.grid(rows, () => fixed(0x141417, { rough: 0.5 }), { flat: true, wrap: true });
    // a little ring at the front
    out.torus(v3(ax.x, y - 0.009, ax.z).add(v3(0, 0, body.torso(0, y) + 0.0035)), v3(0, 0, 1), 0.0045, 0.0009, METAL.silver, 12, 4);
    return;
  }
  const thick = kind === 'thickgold';
  const drop = kind === 'pendant' ? 0.1 : kind === 'thingold' ? 0.065 : kind === 'diamond' ? 0.07 : thick ? 0.075 : 0.068;
  const rad = thick ? 0.0034 : kind === 'diamond' ? 0.0025 : kind === 'silver' ? 0.0021 : 0.0015;
  // around the base of the neck at the sides and back, dropping onto the chest in front
  const yBack = neck.y + 0.016;
  const N = 56;
  const path: V3[] = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2 - Math.PI; // starts and ends at the back
    const front = Math.max(0, Math.cos(a)) ** 2.2;
    const y = yBack - drop * front;
    const r = body.torso(a, y) + rad + 0.0022;
    path.push(v3(ax.x + Math.sin(a) * r, y, ax.z + Math.cos(a) * r));
  }
  // smooth out kinks where a collar sticks out (never pulling the chain into the body)
  for (let it = 0; it < 3; it++) {
    for (let k = 1; k < N; k++) {
      const avg = path[k - 1].clone().add(path[k + 1]).multiplyScalar(0.5);
      const keepOut = Math.hypot(path[k].x - ax.x, path[k].z - ax.z);
      const rx = avg.x - ax.x, rz = avg.z - ax.z;
      const r = Math.max(keepOut, Math.hypot(rx, rz)) / Math.max(1e-6, Math.hypot(rx, rz));
      avg.set(ax.x + rx * r, avg.y, ax.z + rz * r);
      path[k].lerp(avg, 0.5);
    }
  }
  const look = (i: number): Style => {
    switch (kind) {
      case 'silver':
        return METAL.silver;
      case 'diamond':
        return i % 2 ? METAL.diamond : fixed(0xcfe9ff, { metal: 0.3, rough: 0.05 });
      case 'thickgold':
        return i % 2 ? METAL.gold : fixed(0xb88a2c, { metal: 0.65, rough: 0.32 });
      default:
        return METAL.gold;
    }
  };
  // thick chains get chunky links
  const radii = path.map((_p, i) => (thick ? rad * (i % 2 ? 0.8 : 1.1) : kind === 'diamond' ? rad * (i % 2 ? 0.85 : 1.15) : rad));
  out.tube(path, radii, thick ? 6 : 5, look, { flat: true, caps: false });
  if (kind === 'pendant') {
    const tip = path[Math.round(N / 2)];
    const nrm = v3(0, 0, 1);
    const c = tip.clone().add(v3(0, -0.016, 0.002));
    out.tube([tip.clone().add(v3(0, -0.002, 0)), c.clone().add(v3(0, 0.012, 0))], 0.0012, 5, METAL.gold);
    const disc: V3[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      disc.push(c.clone().add(v3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.0032)));
    }
    out.slab(disc, nrm, 0.0032, METAL.gold);
    // a stone in the middle
    out.ellipsoid(c.clone().add(v3(0, 0, 0.0038)), v3(0.0045, 0.0045, 0.0018), fixed(0xc22a3a, { metal: 0.3, rough: 0.1 }), 6, 3);
  }
}
