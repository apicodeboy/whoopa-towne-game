import { dirOf, type HeadRig } from './headRig';
import { ProcMesh, SLOT, hash01, lerp, smoothstep, style, v3, type Style, type V3 } from './meshKit';

/**
 * Procedural hairstyles, wrapped onto the head's depth field so they fit any head shape.
 * The three hairstyles that come with the models (spiky crop, ponytail, mohawk) are not
 * here: they are moved onto the new head instead (see transferHair).
 */

const DEG = Math.PI / 180;

/** Smooth 3D value noise in 0..1. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const h = (a: number, b: number, c: number) => hash01(xi + a + seed * 101, yi + b, zi + c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}

/** Where the hair starts, as a height for each direction around the head. */
export function hairlineY(h: HeadRig, theta: number, opts: { front?: number; temple?: number; side?: number; back?: number } = {}): number {
  const a = Math.abs(theta);
  const front = h.browY + (opts.front ?? 0.034);
  const temple = h.browY + (opts.temple ?? 0.018);
  const side = (h.earL.top + h.earR.top) / 2 + (opts.side ?? 0.004);
  const back = Math.min(h.earL.lobe.y, h.earR.lobe.y) + (opts.back ?? -0.006);
  if (a < 0.55) return front;
  if (a < 1.0) return lerp(front, temple, smoothstep(0.55, 1.0, a));
  if (a < 1.5) return lerp(temple, side, smoothstep(1.0, 1.5, a));
  if (a < 1.9) return side;
  return lerp(side, back, smoothstep(1.9, 2.5, a));
}

interface ShellSpec {
  /** Hair thickness (meters) at a direction; `m` is 0..1 coverage (0 at the hairline). */
  thick: (theta: number, phi: number, p: V3) => number;
  /** Coverage edge (default: the standard hairline). */
  line?: (theta: number) => number;
  /** Color/shading of a point. */
  look?: (theta: number, phi: number, p: V3, m: number) => Style;
  /** Grid step in radians. */
  step?: number;
  /** Extra coverage below the line (curtains of long hair); returns the lowest y, or null. */
  drape?: (theta: number) => number | null;
  /** How tall the soft edge is, relative to the hair's thickness (thick hair slopes down to the skin). */
  taper?: number;
}

const HAIR = style(SLOT.HAIR);

/** A shell of hair over the scalp. */
export function hairShell(h: HeadRig, out: ProcMesh, spec: ShellSpec): void {
  const step = spec.step ?? 4 * DEG;
  const nt = Math.round((Math.PI * 2) / step);
  const phiMin = -72 * DEG;
  const np = Math.ceil((Math.PI / 2 - phiMin) / step);
  const pts: Array<Array<V3 | null>> = [];
  const styles: Style[][] = [];
  // rows from the crown down so the outside faces out
  for (let j = 0; j <= np; j++) {
    const phi = Math.PI / 2 - (j / np) * (Math.PI / 2 - phiMin);
    const row: Array<V3 | null> = [];
    const srow: Style[] = [];
    for (let k = 0; k < nt; k++) {
      const theta = (k / nt) * Math.PI * 2 - Math.PI;
      const skin = h.surface(theta, phi);
      const line = spec.line ? spec.line(theta) : hairlineY(h, theta);
      // coverage: 1 well above the hairline, 0 at it, and the shell dives under the skin below;
      // thick hair gets a taller soft edge so it slopes down to the skin instead of a cliff
      const full = spec.thick(theta, phi, skin);
      let m = smoothstep(line - 0.003, line + Math.max(0.009, full * (spec.taper ?? 1.1)), skin.y);
      let drapeBottom: number | null = null;
      if (spec.drape) {
        drapeBottom = spec.drape(theta);
        if (drapeBottom !== null && skin.y >= drapeBottom - 0.03) m = 1;
      }
      if (skin.y < line - 0.014 && (drapeBottom === null || skin.y < drapeBottom - 0.03)) {
        row.push(null);
        srow.push(HAIR);
        continue;
      }
      const t = full * Math.sqrt(m) - (1 - m) * 0.0025;
      let r = h.radius(theta, phi) + t;
      if (drapeBottom !== null && phi < 0) {
        // long hair hangs straight down instead of following the skull inward
        const top = h.radius(theta, 0) + spec.thick(theta, 0, skin);
        r = Math.max(r, top / Math.cos(phi));
      }
      const p = dirOf(theta, phi).multiplyScalar(r).add(h.center);
      if (drapeBottom !== null && p.y < drapeBottom) {
        // a clean horizontal hem
        if (p.y < drapeBottom - 0.06) {
          row.push(null);
          srow.push(HAIR);
          continue;
        }
        p.y = drapeBottom;
      }
      row.push(p);
      srow.push(spec.look ? spec.look(theta, phi, p, m) : HAIR);
    }
    pts.push(row);
    styles.push(srow);
  }
  out.grid(pts, (r, c) => styles[r][c], { flat: true, wrap: true });
}

/** Distance along a direction from the head's center to an ellipsoid around it. */
function ellipsoidR(dx: number, dy: number, dz: number, off: V3, rad: V3): number {
  // solve |(t*d - off) / rad| = 1 for t > 0
  const ax = dx / rad.x, ay = dy / rad.y, az = dz / rad.z;
  const bx = off.x / rad.x, by = off.y / rad.y, bz = off.z / rad.z;
  const A = ax * ax + ay * ay + az * az;
  const B = -2 * (ax * bx + ay * by + az * bz);
  const C = bx * bx + by * by + bz * bz - 1;
  const disc = B * B - 4 * A * C;
  return disc <= 0 ? 0 : (-B + Math.sqrt(disc)) / (2 * A);
}

/** Roots spread evenly over the scalp (Fibonacci points above the hairline). */
function roots(h: HeadRig, count: number, below = 0): Array<[number, number]> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Array<[number, number]> = [];
  const N = count * 4;
  for (let i = 0; i < N && out.length < count; i++) {
    const y = 1 - (i / N) * 1.3;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const ang = i * golden;
    const theta = Math.atan2(Math.cos(ang) * rr, Math.sin(ang) * rr);
    const phi = Math.asin(Math.max(-1, Math.min(1, y)));
    if (h.surface(theta, phi).y < hairlineY(h, theta) + 0.006 - below) continue;
    out.push([theta, phi]);
  }
  return out;
}

/**
 * The path of a long strand: over the scalp, then straight down like hanging hair. Strands
 * from the front are swept to the sides so the face stays clear.
 */
function drapePath(h: HeadRig, theta0: number, phi0: number, length: number, off: number): V3[] {
  const side = Math.sign(theta0) || 1;
  const sweep = Math.abs(theta0) < 1.3 ? side * (1.3 + 0.25 * (1.3 - Math.abs(theta0))) : theta0;
  const pts: V3[] = [];
  let used = 0;
  for (let i = 0; i <= 48; i++) {
    const f = i / 48;
    const phi = lerp(phi0, -1.27, f);
    const theta = lerp(theta0, sweep, smoothstep(0, 0.45, f));
    let r = h.radius(theta, phi) + off;
    if (phi < 0) r = Math.max(r, (h.radius(theta, 0) + off) / Math.cos(phi));
    const p = dirOf(theta, phi).multiplyScalar(r).add(h.center);
    if (pts.length) used += p.distanceTo(pts[pts.length - 1]);
    pts.push(p);
    if (used >= length) break;
  }
  // a few points are enough for a low-poly strand
  const keep = Math.max(3, Math.round(length / 0.035));
  return Array.from({ length: keep + 1 }, (_v, k) => pts[Math.round((k / keep) * (pts.length - 1))]);
}

/** Long strands (dreads, braids) hanging from the scalp. */
function longStrands(h: HeadRig, out: ProcMesh, opts: { count: number; length: [number, number]; radius: number; beads?: boolean; seed: number }): void {
  roots(h, opts.count).forEach(([theta, phi], i) => {
    const len = lerp(opts.length[0], opts.length[1], hash01(i, opts.seed));
    const off = opts.radius + 0.002 + 0.006 * hash01(i, opts.seed + 3);
    const path = drapePath(h, theta, phi, len, off);
    const radii = path.map((_q, k) => {
      const r = opts.radius * (1 - 0.3 * (k / path.length));
      return opts.beads && k % 2 === 1 ? r * 0.7 : r;
    });
    out.tube(path, radii, 5, style(SLOT.HAIR, { shade: 0.85 + 0.25 * hash01(i, opts.seed + 7) }), { flat: true });
  });
}

/** Short twists that stand up and out from the scalp. */
function shortStrands(h: HeadRig, out: ProcMesh, count: number, seed: number): void {
  roots(h, count).forEach(([theta, phi], i) => {
    const root = h.surface(theta, phi, 0.002);
    const n = h.normal(theta, phi);
    const len = lerp(0.045, 0.07, hash01(i, seed));
    // out from the head, bending a little under their own weight (front ones lean back)
    const bend = v3(0, -0.35, Math.abs(theta) < 1 ? -0.35 : 0);
    const mid = root.clone().addScaledVector(n, len * 0.55).addScaledVector(bend, len * 0.15);
    const tip = root.clone().addScaledVector(n, len * 0.9).addScaledVector(bend, len * 0.45);
    out.tube([root, mid, tip], [0.0075, 0.007, 0.0055], 5, style(SLOT.HAIR, { shade: 0.85 + 0.25 * hash01(i, seed + 7) }), { flat: true });
  });
}

/** Builds one of the procedural hairstyles. Returns false for an id it does not know. */
export function buildHair(id: string, h: HeadRig, out: ProcMesh): boolean {
  const crownDir = v3(0, 1, -0.25).normalize();
  const crownAngle = (p: V3) => Math.acos(Math.min(1, v3().subVectors(p, h.center).normalize().dot(crownDir)));
  switch (id) {
    case 'bald':
      return true;
    case 'buzz':
      hairShell(h, out, {
        thick: () => 0.0032,
        line: (t) => hairlineY(h, t, { front: 0.04 }),
        look: () => style(SLOT.HAIR, { slotB: SLOT.SKIN, mix: 0.38 }),
      });
      return true;
    case 'lowfade':
    case 'highfade': {
      const high = id === 'highfade';
      hairShell(h, out, {
        thick: (t, _ph, p) => {
          const top = high ? 0.016 : 0.01;
          const k = smoothstep(hairlineY(h, t), hairlineY(h, t) + (high ? 0.075 : 0.035), p.y);
          return lerp(0.0018, top, k);
        },
        look: (t, _ph, p) => {
          const k = smoothstep(hairlineY(h, t), hairlineY(h, t) + (high ? 0.07 : 0.032), p.y);
          return style(SLOT.HAIR, { slotB: SLOT.SKIN, mix: 0.62 * (1 - k) });
        },
      });
      return true;
    }
    case 'waves':
      hairShell(h, out, {
        step: 2.6 * DEG,
        thick: (_t, _ph, p) => 0.0045 + 0.0012 * Math.sin(crownAngle(p) * 46),
        look: (_t, _ph, p) => style(SLOT.HAIR, { shade: 0.7 + 0.32 * (0.5 + 0.5 * Math.sin(crownAngle(p) * 46)) }),
      });
      return true;
    case 'cornrows':
    case 'braids': {
      const rows = 9;
      const ridge = (p: V3) => {
        const d = v3().subVectors(p, h.center).normalize();
        const psi = Math.atan2(d.x, d.y + 0.15);
        return 0.5 + 0.5 * Math.cos(psi * rows * 2);
      };
      hairShell(h, out, {
        step: 2.4 * DEG,
        thick: (_t, _ph, p) => 0.0018 + 0.0052 * ridge(p) ** 0.7,
        look: (_t, _ph, p) => {
          const r = ridge(p);
          return style(SLOT.HAIR, { slotB: SLOT.SKIN, mix: 0.6 * (1 - r) ** 2, shade: 0.82 + 0.22 * r });
        },
      });
      if (id === 'braids') longStrands(h, out, { count: 54, length: [0.26, 0.34], radius: 0.0048, beads: true, seed: 11 });
      return true;
    }
    case 'shortafro':
    case 'largeafro': {
      const big = id === 'largeafro';
      const off = v3(0, big ? 0.03 : 0.02, -0.012);
      const rad = v3(h.halfWidth + (big ? 0.085 : 0.045), h.crownY - h.center.y + (big ? 0.06 : 0.032) - off.y, (h.frontZ - h.backZ) / 2 + (big ? 0.07 : 0.04));
      const line = (t: number) => hairlineY(h, t, { front: 0.03, side: -0.012, back: -0.004 });
      hairShell(h, out, {
        step: 5 * DEG,
        line,
        taper: 0.25,
        thick: (t, ph, p) => {
          const d = dirOf(t, ph);
          const e = ellipsoidR(d.x, d.y, d.z, off, rad) - h.radius(t, ph);
          const bump = (noise3(d.x * 7, d.y * 7, d.z * 7, 3) - 0.5) * (big ? 0.016 : 0.01);
          // grows out of the hairline in a rounded slope, up to the full puff
          return Math.max(0.008, Math.min(e + bump, 0.01 + (big ? 1.7 : 1.4) * (p.y - line(t))));
        },
        look: (t, ph) => {
          const d = dirOf(t, ph);
          return style(SLOT.HAIR, { shade: 0.86 + 0.24 * noise3(d.x * 11, d.y * 11, d.z * 11, 5) });
        },
      });
      return true;
    }
    case 'curly': {
      const line = (t: number) => hairlineY(h, t, { front: 0.028, side: -0.004 });
      hairShell(h, out, {
        step: 4 * DEG,
        line,
        taper: 0.3,
        thick: (t, ph, p) => {
          const d = dirOf(t, ph);
          const full = 0.016 + 0.012 * Math.max(0, d.y) + (noise3(d.x * 14, d.y * 14, d.z * 14, 9) - 0.5) * 0.014;
          return Math.max(0.006, Math.min(full, 0.006 + 1.1 * (p.y - line(t))));
        },
        look: (t, ph) => {
          const d = dirOf(t, ph);
          return style(SLOT.HAIR, { shade: 0.8 + 0.3 * noise3(d.x * 18, d.y * 18, d.z * 18, 2) });
        },
      });
      return true;
    }
    case 'straight':
    case 'bob': {
      const bob = id === 'bob';
      const hem = bob ? h.chinY - 0.006 : h.chinY - 0.11;
      hairShell(h, out, {
        step: 4 * DEG,
        // bob: a heavy fringe down to the brows
        line: (t) => hairlineY(h, t, bob ? { front: 0.007, temple: 0.004 } : { front: 0.03 }),
        thick: (t, ph) => (Math.abs(t) < 0.6 && ph < 0.6 ? 0.011 : bob ? 0.022 : 0.015) + 0.006 * Math.max(0, Math.sin(ph)),
        drape: (t) => (Math.abs(t) > (bob ? 0.95 : 1.0) ? hem : null),
        look: (t, ph) => style(SLOT.HAIR, { shade: 0.9 + 0.14 * Math.sin(t * 40 + ph * 3) * 0.5 }),
      });
      return true;
    }
    case 'bun':
      hairShell(h, out, { thick: () => 0.0065, look: (t) => style(SLOT.HAIR, { shade: 0.92 + 0.1 * Math.sin(t * 30) }) });
      {
        const at = h.surface(Math.PI, 38 * DEG, 0.03);
        out.ellipsoid(at, v3(0.036, 0.032, 0.034), (p) => style(SLOT.HAIR, { shade: 0.85 + 0.25 * noise3(p.x * 90, p.y * 90, p.z * 90, 4) }), 10, 7);
        out.torus(h.surface(Math.PI, 38 * DEG, 0.008), v3().subVectors(at, h.center).normalize(), 0.018, 0.0045, style(SLOT.HAIR, { shade: 0.75 }), 12, 5);
      }
      return true;
    case 'shortdreads':
      hairShell(h, out, { thick: () => 0.005, look: () => style(SLOT.HAIR, { shade: 0.8 }) });
      shortStrands(h, out, 56, 4);
      return true;
    case 'longdreads':
      hairShell(h, out, { thick: () => 0.006, look: () => style(SLOT.HAIR, { shade: 0.8 }) });
      longStrands(h, out, { count: 64, length: [0.26, 0.36], radius: 0.0072, seed: 8 });
      return true;
    case 'locs':
      // shoulder-length locs, thicker and fewer than dreads
      hairShell(h, out, { thick: () => 0.006, look: () => style(SLOT.HAIR, { shade: 0.78 }) });
      longStrands(h, out, { count: 46, length: [0.17, 0.24], radius: 0.0088, seed: 21 });
      return true;
    case 'twists': {
      // two-strand twists standing up and out: short spiralled strands all over
      hairShell(h, out, { thick: () => 0.0055, look: () => style(SLOT.HAIR, { shade: 0.8 }) });
      shortStrands(h, out, 84, 13);
      return true;
    }
    default:
      return false;
  }
}

/** Moves hair modelled for one head onto another, keeping its height above the skin. */
export function transferHair(pos: Float32Array, from: HeadRig, to: HeadRig): void {
  const p = v3();
  for (let i = 0; i < pos.length; i += 3) {
    p.fromArray(pos, i);
    const [t, ph] = from.angles(p);
    const above = p.distanceTo(from.center) - from.radius(t, ph);
    to.surface(t, ph, above, p);
    pos[i] = p.x;
    pos[i + 1] = p.y;
    pos[i + 2] = p.z;
  }
}

/**
 * Hair under a hat: anything inside the hat's coverage is pressed down to just under the
 * hat's inner surface. `covered(theta, y)` says whether a point is under the hat.
 */
export function tuckHair(pos: Float32Array | number[], h: HeadRig, covered: (theta: number, y: number) => boolean, room: number): void {
  const p = v3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i], pos[i + 1], pos[i + 2]);
    const [t, ph] = h.angles(p);
    if (!covered(t, p.y)) continue;
    const r = p.distanceTo(h.center), max = h.radius(t, ph) + room;
    if (r <= max) continue;
    h.surface(t, ph, room, p);
    pos[i] = p.x;
    pos[i + 1] = p.y;
    pos[i + 2] = p.z;
  }
}
