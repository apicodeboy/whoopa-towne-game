import { dirOf, type HeadRig } from './headRig';
import { ProcMesh, fixed, lerp, smoothstep, v3, type Style, type V3 } from './meshKit';

/**
 * Hats and headwear, fitted to the head. Each returns where it covers the head, so any
 * hairstyle under it can be tucked in instead of poking through.
 */

export interface HatFit {
  covered: (theta: number, y: number) => boolean;
  /** How much room the hair keeps under the hat (meters above the skin). */
  room: number;
}

const DEG = Math.PI / 180;

/** Elevation at which the skin reaches height `y` in direction theta. */
function phiAt(h: HeadRig, theta: number, y: number): number {
  let lo = -70 * DEG, hi = 89 * DEG;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (h.surface(theta, mid).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The crown of a hat: a shell over the head down to a band line, with a short edge that
 * turns into the head so the rim shows its thickness. Returns the outer band ring.
 */
function crown(
  h: HeadRig, out: ProcMesh, band: (theta: number) => number, thick: (theta: number, s: number) => number,
  look: (theta: number, s: number) => Style, opts: { nt?: number; rows?: number; flatTop?: number; lift?: (theta: number, s: number) => number } = {},
): { ring: V3[]; thetas: number[] } {
  const nt = opts.nt ?? 48, J = opts.rows ?? 12;
  const pts: V3[][] = [];
  const looks: Style[][] = [];
  const thetas: number[] = [];
  const bandPhi: number[] = [];
  for (let k = 0; k < nt; k++) {
    const t = (k / nt) * Math.PI * 2 - Math.PI;
    thetas.push(t);
    bandPhi.push(phiAt(h, t, band(t)));
  }
  for (let j = 0; j <= J + 1; j++) {
    const row: V3[] = [];
    const lrow: Style[] = [];
    for (let k = 0; k < nt; k++) {
      const t = thetas[k];
      const edge = j > J;
      const s = edge ? 0 : 1 - j / J;
      const phi = lerp(89.5 * DEG, bandPhi[k], edge ? 1 : j / J);
      const p = h.surface(t, phi, edge ? -0.002 : thick(t, s));
      if (!edge && opts.lift) p.y += opts.lift(t, s);
      if (!edge && opts.flatTop !== undefined && p.y > opts.flatTop) p.y = opts.flatTop;
      row.push(p);
      lrow.push(look(t, s));
    }
    pts.push(row);
    looks.push(lrow);
  }
  out.grid(pts, (r, c) => looks[r][c], { flat: true, wrap: true });
  return { ring: pts[J], thetas };
}

/**
 * A brim around part (or all) of the band ring: `len(theta)` how far it reaches, `drop(theta, s)`
 * how far it bends down at fraction s of the way out.
 */
function brim(out: ProcMesh, ring: V3[], thetas: number[], h: HeadRig, len: (theta: number) => number, drop: (theta: number, s: number) => number, look: Style, thickness = 0.004): void {
  const S = 5;
  const top: Array<Array<V3 | null>> = [];
  const bot: Array<Array<V3 | null>> = [];
  for (let s = 0; s <= S; s++) {
    const tr: Array<V3 | null> = [], br: Array<V3 | null> = [];
    for (let k = 0; k < ring.length; k++) {
      const L = len(thetas[k]);
      if (L <= 0) {
        tr.push(null);
        br.push(null);
        continue;
      }
      const out2 = v3(ring[k].x - h.center.x, 0, ring[k].z - h.center.z).normalize();
      const f = s / S;
      const p = ring[k].clone().addScaledVector(out2, L * f);
      p.y -= drop(thetas[k], f);
      tr.push(p);
      br.push(p.clone().add(v3(0, -thickness, 0)));
    }
    top.push(tr);
    bot.push(br);
  }
  const full = len(thetas[0]) > 0 && thetas.every((t) => len(t) > 0);
  out.grid(top, () => look, { flat: true, wrap: full });
  out.grid(bot, () => look, { flat: true, wrap: full, flip: true });
  // outer rim
  out.grid([top[S], bot[S]], () => look, { flat: true, wrap: full, flip: true });
}

export function buildHat(kind: string, h: HeadRig, out: ProcMesh): HatFit | null {
  const brow = h.browY, eye = h.eyeY;
  const earTop = (h.earL.top + h.earR.top) / 2;
  const nape = Math.min(h.earL.lobe.y, h.earR.lobe.y);
  const frontBack = (front: number, side: number, back: number) => (t: number) => {
    const a = Math.abs(t);
    return a < Math.PI / 2 ? lerp(front, side, smoothstep(0, Math.PI / 2, a)) : lerp(side, back, smoothstep(Math.PI / 2, Math.PI, a));
  };
  switch (kind) {
    case 'capfwd':
    case 'capback': {
      const back = kind === 'capback';
      const facing = back ? Math.PI : 0;
      const band = frontBack(back ? brow + 0.032 : brow + 0.021, eye + 0.008, back ? eye - 0.002 : eye - 0.006);
      const col = 0x1c1f27;
      const panel = (t: number) => {
        const seam = Math.abs(Math.sin(((t - facing) * 3) / 1)) < 0.06;
        return fixed(col, { shade: seam ? 0.7 : 1 });
      };
      const { ring, thetas } = crown(h, out, band, (_t, s) => 0.011 + 0.006 * Math.sin(s * Math.PI * 0.5), (t) => panel(t), { lift: (_t, s) => 0.004 * s * s });
      const rel = (t: number) => Math.atan2(Math.sin(t - facing), Math.cos(t - facing));
      brim(out, ring, thetas, h, (t) => (Math.abs(rel(t)) < 78 * DEG ? 0.07 * Math.cos(rel(t) * 1.12) ** 0.7 : 0), (t, s) => 0.004 * s + 0.011 * Math.sin(rel(t)) ** 2 * s, fixed(col, { shade: 0.85 }));
      out.ellipsoid(h.surface(0, 89 * DEG, 0.019), v3(0.006, 0.0025, 0.006), fixed(col), 8, 3);
      return { covered: (t, y) => y > band(t) - 0.004, room: 0.008 };
    }
    case 'beanie': {
      const band = frontBack(brow + 0.013, earTop - 0.006, nape + 0.016);
      const col = 0x7a2430;
      // a slouchy knit: taller at the back, a folded cuff, ribs
      crown(h, out, band, (_t, s) => (s < 0.2 ? 0.019 : 0.014) + 0.004 * s, (t, s) => fixed(col, { shade: (s < 0.2 ? 0.8 : 1) * (0.88 + 0.12 * Math.cos(t * 28)) }), {
        lift: (t, s) => (0.018 + 0.016 * Math.max(0, -Math.cos(t))) * s ** 2.5, rows: 14,
      });
      return { covered: (t, y) => y > band(t) - 0.004, room: 0.009 };
    }
    case 'bucket': {
      const band = frontBack(brow + 0.017, earTop + 0.006, eye - 0.012);
      const col = 0xc4b086;
      const { ring, thetas } = crown(h, out, band, () => 0.014, (_t, s) => fixed(col, { shade: s < 0.15 ? 0.8 : 1 }), { flatTop: h.crownY + 0.024 });
      brim(out, ring, thetas, h, () => 0.047, (_t, s) => 0.022 * s, fixed(col, { shade: 0.9 }), 0.003);
      return { covered: (t, y) => y > band(t) - 0.004, room: 0.01 };
    }
    case 'durag':
    case 'bandana': {
      const durag = kind === 'durag';
      const band = frontBack(brow + (durag ? 0.03 : 0.024), earTop + 0.008, nape - (durag ? 0.006 : 0.0));
      const pat = (t: number, s: number): Style => {
        if (durag) return fixed(0x17171d, { metal: 0.15, rough: 0.28, shade: Math.abs(Math.sin(t)) < 0.05 ? 0.75 : 1 });
        const d = dirOf(t, s * 1.4);
        const dot = Math.sin(d.x * 160) * Math.sin(d.y * 160 + d.z * 90) > 0.86;
        return dot ? fixed(0xf3ece0) : fixed(0xb3262b);
      };
      crown(h, out, band, () => 0.0045, pat, { rows: 14 });
      // knot and tails at the back
      const knot = h.surface(Math.PI, phiAt(h, Math.PI, nape + 0.02), 0.012);
      const col: Style = durag ? fixed(0x17171d, { metal: 0.15, rough: 0.28 }) : fixed(0xb3262b);
      out.ellipsoid(knot, v3(0.016, 0.012, 0.012), col, 7, 4);
      const tails = durag ? 0.17 : 0.07;
      for (const side of [-1, 1]) {
        const w = durag ? 0.016 : 0.012;
        const a = knot.clone().add(v3(side * 0.008, -0.004, -0.006));
        const rows: V3[][] = [];
        for (let i = 0; i <= 6; i++) {
          const f = i / 6;
          const c = a.clone().add(v3(side * (0.01 * f + 0.004 * Math.sin(f * 5)), -tails * f, -0.02 * f - 0.006 * Math.sin(f * 3)));
          rows.push([c.clone().add(v3(-w, 0, 0)), c.clone().add(v3(w, 0, 0))]);
        }
        out.grid(rows, () => col, { flat: true });
        out.grid(rows, () => col, { flat: true, flip: true });
      }
      return { covered: (t, y) => y > band(t) - 0.004, room: 0.0035 };
    }
    case 'headband': {
      const lo = frontBack(brow + 0.022, earTop + 0.004, eye + 0.004);
      const hi = (t: number) => lo(t) + 0.026;
      const nt = 64;
      const rows: V3[][] = [[], [], [], []];
      const looks: Style[] = [];
      for (let k = 0; k < nt; k++) {
        const t = (k / nt) * Math.PI * 2 - Math.PI;
        const pHi = phiAt(h, t, hi(t)), pLo = phiAt(h, t, lo(t));
        rows[0].push(h.surface(t, pHi, -0.002));
        rows[1].push(h.surface(t, pHi, 0.0055));
        rows[2].push(h.surface(t, pLo, 0.0055));
        rows[3].push(h.surface(t, pLo, -0.002));
        looks.push(fixed(0xf1f1ee));
      }
      const stripe = (r: number) => (r === 1 || r === 2 ? fixed(0xf1f1ee) : fixed(0xd0312d));
      out.grid(rows, (r) => stripe(r), { flat: true, wrap: true });
      // two red stripes painted on the front band
      const mid: V3[][] = [[], []];
      for (let k = 0; k < nt; k++) {
        const t = (k / nt) * Math.PI * 2 - Math.PI;
        const y0 = lerp(lo(t), hi(t), 0.38), y1 = lerp(lo(t), hi(t), 0.62);
        mid[0].push(h.surface(t, phiAt(h, t, y1), 0.0058));
        mid[1].push(h.surface(t, phiAt(h, t, y0), 0.0058));
      }
      out.grid(mid, () => fixed(0xd0312d), { flat: true, wrap: true });
      return { covered: (t, y) => y > lo(t) - 0.003 && y < hi(t) + 0.003, room: 0.004 };
    }
    case 'cowboy': {
      const band = frontBack(brow + 0.021, earTop + 0.012, eye + 0.002);
      const col = 0x7a4a26;
      const nt = 40;
      const top = h.crownY + 0.05;
      const { ring, thetas } = crown(h, out, band, () => 0.013, () => fixed(col), { nt, rows: 4, flatTop: band(0) + 0.02 });
      // tall crown with a crease down the middle
      const c = ring.reduce((a, p) => a.add(p), v3()).multiplyScalar(1 / ring.length);
      const wall: V3[][] = [];
      const R = 3;
      for (let j = 0; j <= R; j++) {
        const f = j / R;
        wall.push(ring.map((p, k) => {
          const t = thetas[k];
          const q = p.clone().sub(c).multiplyScalar(lerp(1.02, 0.84, f * f)).add(c);
          q.y = lerp(p.y, top - 0.012 * Math.cos(t) ** 2, f);
          return q;
        }));
      }
      const capRows: V3[][] = [wall[R]];
      for (let j = 1; j <= 3; j++) {
        const f = j / 3;
        capRows.push(wall[R].map((p, k) => {
          const q = p.clone().lerp(v3(c.x, p.y, c.z), f * 0.98);
          q.y = lerp(p.y, top - 0.024 * Math.abs(Math.sin(thetas[k])) ** 0.5 - 0.004, Math.sin(f * Math.PI * 0.5));
          return q;
        }));
      }
      wall.reverse();
      out.grid(wall, (r) => fixed(col, { shade: r === R ? 0.45 : 1 }), { flat: true, wrap: true });
      out.grid(capRows, () => fixed(col, { shade: 1.05 }), { flat: true, wrap: true, flip: true });
      brim(out, ring, thetas, h, () => 0.088, (t, s) => -0.042 * Math.sin(t) ** 2 * s * s + 0.01 * Math.cos(t) ** 2 * s, fixed(col, { shade: 0.95 }), 0.004);
      return { covered: (t, y) => y > band(t) - 0.004, room: 0.012 };
    }
    default:
      return null;
  }
}
