import { METAL, ProcMesh, SLOT, fixed, hash01, style, v3, type Style, type V3 } from './meshKit';

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

/** `fine`: tiny details (stones, letters) that get a thin ink line instead of the full one. */
export function buildWrist(kind: string, body: BodyQuery, out: ProcMesh, fine: ProcMesh = out): void {
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
  if (kind === 'gloves' || kind === 'blackgloves') {
    // AJ's shooter gloves: the hands are painted in the assembler; this is the cuff
    for (const side of ['L', 'R'] as const) {
      const { A, B, r } = at(side, 0.95);
      cuff(out, A, B, 0.95, 0.024, r, 0.004, fixed(0x141417, { rough: 0.55, metal: 0.1 }));
    }
    return;
  }
  // watch on the left wrist: strap plus a face on the back of the wrist
  const iced = kind === 'icedwatch';
  const gold = kind === 'goldwatch' || iced;
  const silver = kind === 'silverwatch';
  const { A, B, r } = at('L', 0.86);
  cuff(out, A, B, 0.86, 0.016, r, 0.0026, gold ? METAL.gold : silver ? METAL.silver : fixed(0x1d1e22, { rough: 0.7 }));
  const axis = v3().subVectors(B, A).normalize();
  const c = A.clone().lerp(B, 0.86);
  // the back of the wrist: out and up from the body, square to the forearm (works for any arm pose)
  const ref = v3(1, 1, 0).normalize();
  const outward = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize();
  const base = c.clone().addScaledVector(outward, r + 0.002);
  const top = base.clone().addScaledVector(outward, 0.0045);
  out.tube([base, top], 0.0095, 12, gold ? METAL.gold : silver ? METAL.silver : METAL.steel, { flat: true });
  const dial = top.clone().addScaledVector(outward, 0.0003);
  out.tube([top, dial], 0.0075, 12, iced ? fixed(0xbfe6ff, { metal: 0.3, rough: 0.06 }) : gold || silver ? fixed(0x1a1712, { rough: 0.3 }) : fixed(0xe8ecef, { rough: 0.3 }), { flat: true });
  if (iced) {
    // AJ's: a bezel of stones around the dial and an iced strap
    fine.torus(top.clone().addScaledVector(outward, 0.0006), outward, 0.0098, 0.0019, (u) => (Math.floor(u * 20) % 2 ? METAL.diamond : fixed(0xcfe9ff, { metal: 0.3, rough: 0.05 })), 20, 5);
    cuff(fine, A, B, 0.86, 0.006, r + 0.0026, 0.0018, (u) => (Math.floor(u * 24) % 2 ? METAL.diamond : fixed(0xcfe9ff, { metal: 0.3, rough: 0.05 })), 24);
  }
}

export function buildNecklace(kind: string, body: BodyQuery, out: ProcMesh, fine: ProcMesh = out): void {
  if (kind === 'none') return;
  if (kind === 'silverstack') {
    // three silver chains, each a little longer than the last
    buildNecklace('silver', body, out, fine);
    buildChainAt(body, out, 0.1, 0.0019, METAL.silver);
    buildChainAt(body, out, 0.135, 0.0023, fixed(0xc9cfd6, { metal: 0.62, rough: 0.26 }));
    return;
  }
  if (kind === 'medallion') {
    // a silver rope chain with an oversized round medallion
    const path = buildChainAt(body, out, 0.115, 0.0026, METAL.silver);
    const tip = path[Math.round((path.length - 1) / 2)];
    const c = tip.clone().add(v3(0, -0.03, 0.004));
    for (const dy of [-0.03, 0, 0.03]) for (const dx of [-0.03, 0, 0.03]) c.z = Math.max(c.z, torsoZ(body, c.x - body.neckAxis.x + dx, c.y + dy, 1) + 0.004);
    out.tube([tip.clone().add(v3(0, -0.002, 0)), c.clone().add(v3(0, 0.03, 0))], 0.0018, 5, METAL.silver);
    const disc: V3[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      disc.push(c.clone().add(v3(Math.cos(a) * 0.029, Math.sin(a) * 0.029, 0.005)));
    }
    out.slab(disc, v3(0, 0, 1), 0.005, METAL.silver);
    // a raised rim and a star in the middle
    out.torus(c.clone().add(v3(0, 0, 0.0052)), v3(0, 0, 1), 0.025, 0.0022, fixed(0xdfe4ea, { metal: 0.7, rough: 0.2 }), 20, 5);
    const star: V3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 0.0065 : 0.015;
      star.push(c.clone().add(v3(Math.cos(a) * r, -Math.sin(a) * r, 0.0068)));
    }
    fine.slab(star, v3(0, 0, 1), 0.0016, fixed(0xf1f4f8, { metal: 0.75, rough: 0.15 }));
    return;
  }
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
  const cuban = kind === 'cuban';
  const thick = kind === 'thickgold' || cuban;
  const icedChain = kind === 'diamond' || kind === 'wtpendant';
  const drop = kind === 'pendant' || kind === 'wtpendant' ? 0.1 : kind === 'thingold' ? 0.065 : kind === 'diamond' ? 0.07 : cuban ? 0.085 : thick ? 0.075 : 0.068;
  const rad = cuban ? 0.0046 : thick ? 0.0034 : icedChain ? 0.0025 : kind === 'silver' ? 0.0021 : 0.0015;
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
      case 'wtpendant':
        return i % 2 ? METAL.diamond : fixed(0xcfe9ff, { metal: 0.3, rough: 0.05 });
      case 'cuban':
        // heavy links, polished faces catching the light
        return i % 2 ? fixed(0xf2c94c, { metal: 0.75, rough: 0.22 }) : fixed(0xc0912a, { metal: 0.7, rough: 0.3 });
      case 'thickgold':
        return i % 2 ? METAL.gold : fixed(0xb88a2c, { metal: 0.65, rough: 0.32 });
      default:
        return METAL.gold;
    }
  };
  // thick chains get chunky links
  const radii = path.map((_p, i) => (thick ? rad * (i % 2 ? 0.8 : 1.1) : icedChain ? rad * (i % 2 ? 0.85 : 1.15) : rad));
  out.tube(path, radii, thick ? 6 : 5, look, { flat: true, caps: false });
  if (kind === 'wtpendant') {
    // AJ's: an iced-out plate with gold "WT" letters
    const tip = path[Math.round(N / 2)];
    const nrm = v3(0, 0, 1);
    const w = 0.02, hh = 0.015;
    const c = tip.clone().add(v3(0, -0.021, 0.003));
    // hang it in front of whatever is under it (a puffer bulges more lower down)
    for (const dy of [-hh, 0, hh]) {
      for (const dx of [-w, 0, w]) c.z = Math.max(c.z, torsoZ(body, c.x - ax.x + dx, c.y + dy, 1) + 0.003);
    }
    out.tube([tip.clone().add(v3(0, -0.002, 0)), c.clone().add(v3(0, 0.014, 0.002))], 0.0014, 5, METAL.gold);
    const plate = [v3(-w, -hh, 0), v3(w, -hh, 0), v3(w, hh, 0), v3(-w, hh, 0)].map((p) => p.add(c).add(v3(0, 0, 0.004)));
    out.slab(plate, nrm, 0.004, fixed(0xdff3ff, { metal: 0.3, rough: 0.05 }));
    // a sparkle grid of stones on the plate
    for (let gx = 0; gx < 7; gx++) {
      for (let gy = 0; gy < 5; gy++) {
        const p = c.clone().add(v3(-w + 0.003 + gx * ((2 * w - 0.006) / 6), -hh + 0.003 + gy * ((2 * hh - 0.006) / 4), 0.0046));
        fine.ellipsoid(p, v3(0.0017, 0.0017, 0.0009), METAL.diamond, 4, 2);
      }
    }
    const z = c.z + 0.0062;
    const L = (pts: Array<[number, number]>) => fine.tube(pts.map(([x, y]) => v3(c.x + x, c.y + y, z)), 0.0012, 4, fixed(0xf2c94c, { metal: 0.8, rough: 0.2 }));
    L([[-0.017, 0.009], [-0.0135, -0.009], [-0.0095, 0.003], [-0.0055, -0.009], [-0.002, 0.009]]);
    L([[0.003, 0.009], [0.017, 0.009]]);
    L([[0.01, 0.009], [0.01, -0.009]]);
  }
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

/** A plain chain round the neck dropping `drop` meters onto the chest; returns its path. */
function buildChainAt(body: BodyQuery, out: ProcMesh, drop: number, rad: number, look: Style): V3[] {
  const neck = body.joint('Neck');
  const ax = body.neckAxis;
  const yBack = neck.y + 0.016;
  const N = 56;
  const path: V3[] = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2 - Math.PI;
    const front = Math.max(0, Math.cos(a)) ** 2.2;
    const y = yBack - drop * front;
    const r = body.torso(a, y) + rad + 0.0024;
    path.push(v3(ax.x + Math.sin(a) * r, y, ax.z + Math.cos(a) * r));
  }
  out.tube(path, path.map((_p, i) => rad * (i % 2 ? 0.85 : 1.1)), 5, look, { flat: true, caps: false });
  return path;
}

/**
 * A silver chain hanging from the front belt loop on the right hip round to the back pocket.
 * `hip` is the outside of the right hip at belt height; `down` how low the loop hangs.
 */
export function buildWaistChain(kind: string, hip: V3, front: V3, back: V3, out: ProcMesh): void {
  if (kind === 'none') return;
  const pts: V3[] = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // a hanging curve (catenary-like) from front to back past the hip
    const a = front.clone().lerp(hip, Math.min(1, t * 2)).lerp(back, Math.max(0, t * 2 - 1));
    a.y -= Math.sin(Math.PI * t) * 0.17;
    a.x += Math.sin(Math.PI * t) * -0.012;
    pts.push(a);
  }
  out.tube(pts, pts.map((_p, i) => (i % 2 ? 0.0024 : 0.0032)), 5, (i) => (i % 2 ? METAL.silver : fixed(0xb9c0c8, { metal: 0.6, rough: 0.28 })), { flat: true });
  out.torus(front.clone(), v3(0, 0, 1), 0.006, 0.0016, METAL.silver, 10, 4);
  out.torus(back.clone(), v3(0, 0, 1), 0.006, 0.0016, METAL.silver, 10, 4);
}

/** Where the torso surface is for a point `dx` to the side of the neck axis at height y (front +1 / back -1). */
function torsoZ(body: BodyQuery, dx: number, y: number, side: 1 | -1): number {
  const base = side > 0 ? 0 : Math.PI;
  let a = base + Math.asin(Math.max(-0.95, Math.min(0.95, dx / body.torso(base, y)))) * side;
  for (let it = 0; it < 3; it++) a = base + Math.asin(Math.max(-0.95, Math.min(0.95, dx / body.torso(a, y)))) * side;
  return body.neckAxis.z + Math.cos(a) * body.torso(a, y);
}

/**
 * AJ's backpacks: a rounded pack on the back plus two shoulder straps. Rides rigidly on the
 * chest bone (built in the bind pose, so it sits right whatever the body build).
 */
export function buildBackpack(kind: string, body: BodyQuery, out: ProcMesh): void {
  if (kind === 'none') return;
  const neck = body.joint('Neck');
  const ax = body.neckAxis;
  const top = neck.y - 0.075, bot = neck.y - 0.43;
  const designer = kind === 'designer', camo = kind === 'camopack';
  const halfW = designer ? 0.13 : 0.14, depth = designer ? 0.09 : 0.11;
  // the furthest-back point of the back over the pack's height
  let zBack = Infinity;
  for (let y = bot; y <= top + 1e-6; y += 0.02) {
    for (const dx of [-halfW * 0.8, 0, halfW * 0.8]) zBack = Math.min(zBack, torsoZ(body, dx, y, -1));
  }
  zBack -= 0.008;
  const zc = zBack - depth / 2;
  const base = designer ? 0x6b4a2c : camo ? 0x5b6b3a : 0x1d1d22;
  const shell = (r: number, c: number): Style => {
    if (camo) {
      const n = hash01(r * 7 + 3, c * 5 + 1, 11);
      return fixed(n > 0.66 ? 0x3b4524 : n > 0.4 ? 0x8a7a4a : n > 0.15 ? base : 0x1f2416, { rough: 0.9 });
    }
    if (designer) return fixed((r + c) % 3 === 0 ? 0xc9a36a : base, { rough: 0.55 });
    return fixed(base, { rough: 0.75 });
  };
  // rounded-box rings from the bottom up (superellipse across, rounded off at the top)
  const ROWS = 9, SIDES = 20;
  const rows: V3[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const y = bot + (top - bot) * t;
    const shrink = t > 0.72 ? Math.sqrt(Math.max(0, 1 - ((t - 0.72) / 0.28) ** 2)) * 0.25 + 0.75 : 1;
    const capK = i === 0 || i === ROWS ? 0.001 : 1;
    const ring: V3[] = [];
    for (let k = 0; k < SIDES; k++) {
      const th = (k / SIDES) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const sx = Math.sign(c) * Math.abs(c) ** 0.5, sz = Math.sign(s) * Math.abs(s) ** 0.5;
      ring.push(v3(ax.x + sx * halfW * shrink * capK, y, zc + sz * (depth / 2) * capK * (t > 0.85 ? 0.85 : 1)));
    }
    rows.push(ring);
  }
  // rows run up and the ring turns from +x toward +z, so the outside is already (down x across)
  out.grid(rows, shell, { flat: true, wrap: true });
  // front pocket and a zip line
  const pocketZ = zc - depth / 2;
  const pocketTop = bot + (top - bot) * 0.48;
  out.box(v3(ax.x, (bot + pocketTop) / 2 + 0.01, pocketZ - 0.016), v3(halfW * 0.7, (pocketTop - bot) / 2 - 0.02, 0.018), designer ? fixed(0x4e3520, { rough: 0.5 }) : camo ? fixed(0x3b4524, { rough: 0.9 }) : fixed(0x2a2a30, { rough: 0.7 }));
  out.tube([v3(ax.x - halfW * 0.62, pocketTop - 0.012, pocketZ - 0.035), v3(ax.x + halfW * 0.62, pocketTop - 0.012, pocketZ - 0.035)], 0.0022, 4, designer ? METAL.gold : METAL.silver);
  out.ellipsoid(v3(ax.x + halfW * 0.5, pocketTop - 0.022, pocketZ - 0.036), v3(0.004, 0.009, 0.003), designer ? METAL.gold : METAL.silver, 5, 3);
  // shoulder straps: from the top of the pack, over the shoulder, down the chest
  const strap = designer ? fixed(0x3e2a18, { rough: 0.5 }) : fixed(0x141417, { rough: 0.8 });
  for (const side of [1, -1]) {
    const dx = side * 0.075;
    const path: V3[] = [];
    path.push(v3(ax.x + dx * 1.1, top - 0.02, zBack - 0.01));
    path.push(v3(ax.x + dx, neck.y - 0.035, torsoZ(body, dx, neck.y - 0.035, -1) - 0.008));
    path.push(v3(ax.x + dx, neck.y - 0.012, ax.z - 0.01));
    path.push(v3(ax.x + dx, neck.y - 0.035, torsoZ(body, dx, neck.y - 0.035, 1) + 0.008));
    for (const dy of [0.1, 0.18, 0.25]) path.push(v3(ax.x + dx * (1 + dy * 0.6), neck.y - dy, torsoZ(body, dx * (1 + dy * 0.6), neck.y - dy, 1) + 0.007));
    out.tube(path, 0.009, 4, strap, { flat: true });
  }
}
