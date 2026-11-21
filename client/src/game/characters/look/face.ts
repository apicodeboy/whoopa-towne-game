import { dirOf, type HeadRig } from './headRig';
import { METAL, ProcMesh, SLOT, fixed, hash01, lerp, smoothstep, style, v3, type Style, type V3 } from './meshKit';
import type { Expression } from './palette';

/**
 * Face pieces: mouth (lips, teeth, grills), facial hair, freckles / scar / beauty mark,
 * piercings, glasses and earrings. All fitted with the head's measurements (HeadRig).
 */

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ mouth
const LIP_SHAPES: Record<string, { halfW: number; upper: number; lower: number }> = {
  small: { halfW: 0.015, upper: 0.0026, lower: 0.0034 },
  average: { halfW: 0.019, upper: 0.0033, lower: 0.0044 },
  full: { halfW: 0.0198, upper: 0.0052, lower: 0.0068 },
  wide: { halfW: 0.0245, upper: 0.0032, lower: 0.0042 },
};

export function mouthHalfWidth(lips: string): number {
  return (LIP_SHAPES[lips] ?? LIP_SHAPES.average).halfW;
}

/** Lips sit on the face along the line from the head's center. */
function onFace(h: HeadRig, x: number, y: number, offset: number): V3 {
  return h.project(v3(x, y, h.mouth.z), offset);
}

/**
 * The mouth: lips, the dark inside and the teeth (or a grill). Every expression builds the
 * same vertices in the same order, so expressions can blend between each other as morphs.
 */
export function buildMouth(h: HeadRig, out: ProcMesh, lips: string, expr: Expression, grill: string): void {
  out.keepAll = true;
  const shape = LIP_SHAPES[lips] ?? LIP_SHAPES.average;
  const W = shape.halfW * expr.wide;
  // a grill shows: the lips part in a little "flex"
  const open = Math.max(expr.open, grill !== 'none' ? 0.0048 : 0, 0.00025);
  const N = 10;
  const cx = h.mouth.x, my = h.mouth.y;
  const rows = { uTop: [] as V3[], uMid: [] as V3[], uBot: [] as V3[], lTop: [] as V3[], lMid: [] as V3[], lBot: [] as V3[], inTop: [] as V3[], inBot: [] as V3[], tTop: [] as V3[], tBot: [] as V3[], bTop: [] as V3[], bBot: [] as V3[] };
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 2 - 1;
    const body = Math.pow(Math.max(0, 1 - u * u), 0.55);
    const m = my + expr.smile * u * u + expr.smirk * Math.max(0, u) ** 2 * 1.3 - expr.smirk * 0.15 * Math.max(0, -u) ** 2;
    const gap = Math.max(0.00025, open * Math.pow(Math.max(0, 1 - u * u), 0.8)) / 2;
    const cupid = 0.0007 * Math.exp(-((u / 0.16) ** 2));
    const x = cx + u * W;
    rows.uTop.push(onFace(h, x, m + gap + shape.upper * body - cupid, 0.0009));
    rows.uMid.push(onFace(h, x, m + gap + shape.upper * body * 0.45, 0.0018 * body + 0.0009));
    rows.uBot.push(onFace(h, x, m + gap, 0.0011));
    rows.lTop.push(onFace(h, x, m - gap, 0.0011));
    rows.lMid.push(onFace(h, x, m - gap - shape.lower * body * 0.5, 0.0022 * body + 0.0009));
    rows.lBot.push(onFace(h, x, m - gap - shape.lower * body, 0.0009));
    rows.inTop.push(onFace(h, x, m + gap, 0.0005));
    rows.inBot.push(onFace(h, x, m - gap, 0.0005));
    // teeth: the upper row shows most when the mouth opens
    const tu = Math.abs(u) < 0.78 ? 1 : 0.15;
    rows.tTop.push(onFace(h, x * 0.97 + cx * 0.03, m + gap, 0.0007));
    rows.tBot.push(onFace(h, x * 0.97 + cx * 0.03, m + gap - Math.max(0.0001, Math.min(gap * 1.3, 0.004) * tu), 0.0007));
    rows.bBot.push(onFace(h, x * 0.95 + cx * 0.05, m - gap, 0.0007));
    rows.bTop.push(onFace(h, x * 0.95 + cx * 0.05, m - gap + Math.max(0.0001, Math.min(gap * 0.75, 0.0024) * tu), 0.0007));
  }
  const lip = style(SLOT.LIPS);
  const lipLow = style(SLOT.LIPS, { shade: 1.08 });
  const inside = fixed(0x3a1517, { rough: 0.9 });
  const teeth: Style =
    grill === 'gold' ? METAL.gold : grill === 'silver' ? METAL.silver : grill === 'diamond' ? METAL.diamond : style(SLOT.TEETH, { rough: 0.4 });
  const teethAt = (_r: number, c: number): Style =>
    grill === 'diamond' ? (c % 2 ? METAL.diamond : fixed(0xbfe6ff, { metal: 0.25, rough: 0.05 })) : teeth;
  out.grid([rows.inTop, rows.inBot], () => inside, { flat: true });
  out.grid([rows.tTop, rows.tBot], teethAt, { flat: true });
  out.grid([rows.bTop, rows.bBot], teethAt, { flat: true });
  out.grid([rows.uTop, rows.uMid, rows.uBot], () => lip, { flat: true });
  out.grid([rows.lTop, rows.lMid, rows.lBot], () => lipLow, { flat: true });
}

// ------------------------------------------------------------------ facial hair
/**
 * Beards and mustaches as a layer over the lower face. Kinds: mustache, goatee, shortbeard,
 * fullbeard, chinstrap.
 */
export function buildFacialHair(kind: string, h: HeadRig, out: ProcMesh, lips: string): void {
  if (kind === 'none') return;
  const cx = h.mouth.x;
  const mw = mouthHalfWidth(lips) + 0.004;
  const my = h.mouth.y, nose = h.noseBaseY, chin = h.chinY;
  const earTop = (h.earL.top + h.earR.top) / 2;
  const lobe = (h.earL.lobe.y + h.earR.lobe.y) / 2;
  const lowLip = my - 0.0045;
  // the lower edge of the jaw, from the chin back to under the ears
  const jaw = (a: number) => lerp(chin - 0.006, lobe - 0.004, smoothstep(0.15, 1.45, a));
  // returns coverage 0..1 and thickness for a point on the face
  const region = (theta: number, p: V3): [number, number] => {
    const a = Math.abs(theta), dx = Math.abs(p.x - cx), y = p.y;
    if (a > 1.62) return [0, 0];
    const soft = (v: number, w = 0.0035) => smoothstep(-w, w, v);
    const mustache = soft(nose - 0.0015 - y) * soft(y - (my + 0.003)) * soft(mw + 0.004 - dx);
    const lipGap = 1 - soft(mw - dx, 0.002) * soft(0.0055 - Math.abs(y - (my - 0.0012)), 0.0015);
    switch (kind) {
      case 'mustache':
        return [mustache, 0.0042];
      case 'goatee': {
        const chinPatch = soft(0.022 - dx) * soft(lowLip - 0.0015 - y) * soft(y - (chin - 0.012));
        const sides = soft(mw + 0.006 - dx) * soft(dx - (mw - 0.004)) * soft(my + 0.004 - y) * soft(y - (lowLip - 0.012));
        return [Math.max(mustache, chinPatch, sides) * lipGap, 0.0045];
      }
      case 'chinstrap': {
        const j = jaw(a);
        const band = soft(y - (j - 0.008)) * soft(j + 0.009 - y);
        const burns = soft(a - 1.3, 0.05) * soft(earTop - 0.004 - y) * soft(y - j);
        return [Math.max(band, burns) * soft(1.6 - a, 0.03), 0.003];
      }
      default: {
        // full / short beard: cheeks below a line that rises toward the ears, down under the chin
        const cheek = a < 0.5 ? my + 0.012 : lerp(my + 0.012, earTop - 0.006, smoothstep(0.5, 1.45, a));
        const under = soft(y - (jaw(a) - (a < 0.9 ? 0.03 : 0.012)));
        const cover = Math.max(soft(cheek - y) * under, mustache) * soft(1.58 - a, 0.04);
        return [cover * lipGap, kind === 'fullbeard' ? 0.0085 + 0.004 * smoothstep(my, chin, y) : 0.0035];
      }
    }
  };
  const step = 2 * DEG;
  const pts: Array<Array<V3 | null>> = [];
  const looks: Style[][] = [];
  for (let phi = 10 * DEG; phi >= -72 * DEG; phi -= step) {
    const row: Array<V3 | null> = [];
    const srow: Style[] = [];
    for (let theta = -96 * DEG; theta <= 96 * DEG + 1e-6; theta += step) {
      const skin = h.surface(theta, phi);
      const [m, t] = region(theta, skin);
      if (m <= 0.02 || !h.measured(theta, phi)) {
        row.push(null);
        srow.push(style(SLOT.BEARD));
        continue;
      }
      const thick = t * smoothstep(0.02, 0.55, m) - 0.0015 * (1 - m);
      row.push(h.surface(theta, phi, Math.max(-0.0015, thick) + 0.0004));
      const d = dirOf(theta, phi);
      srow.push(style(SLOT.BEARD, { shade: 0.86 + 0.24 * hash01(Math.round(d.x * 400), Math.round(d.y * 400)) }));
    }
    pts.push(row);
    looks.push(srow);
  }
  out.grid(pts, (r, c) => looks[r][c], { flat: true });
}

// ------------------------------------------------------------------ details
/** Freckles, a scar, a beauty mark. */
export function buildDetails(details: string[], h: HeadRig, out: ProcMesh): void {
  const cx = h.mouth.x;
  const dot = (x: number, y: number, r: number, s: Style, sides = 6) => {
    const c = h.project(v3(x, y, h.noseTip.z), 0.0004);
    const n = h.normal(...h.angles(c));
    const t1 = v3(0, 1, 0).cross(n).normalize(), t2 = n.clone().cross(t1);
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      out.tri(c, c.clone().addScaledVector(t1, Math.cos(a0) * r).addScaledVector(t2, Math.sin(a0) * r), c.clone().addScaledVector(t1, Math.cos(a1) * r).addScaledVector(t2, Math.sin(a1) * r), s);
    }
  };
  if (details.includes('freckles')) {
    const fr = style(SLOT.SKIN, { shade: 0.64, slotB: SLOT.FIXED, color: 0x8a4a28, mix: 0.25 });
    for (let i = 0; i < 34; i++) {
      const side = i % 2 ? 1 : -1;
      const u = hash01(i, 3), w = hash01(i, 5);
      const x = cx + side * (0.006 + u * 0.036);
      const y = lerp(h.noseBaseY + 0.002, h.eyeY - 0.011, w);
      dot(x, y, 0.0011 + 0.0007 * hash01(i, 9), fr, 5);
    }
  }
  if (details.includes('scar')) {
    // a nick through the left brow, down onto the cheek
    const sc = style(SLOT.SKIN, { shade: 1.12, slotB: SLOT.FIXED, color: 0xd99a8f, mix: 0.4 });
    const a = v3(h.browL.x - 0.004, h.browL.y + 0.013, 0), b = v3(h.browL.x + 0.009, h.eyeY - 0.024, 0);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().lerp(b, i / n), p1 = a.clone().lerp(b, (i + 1) / n);
      const w = 0.0011 * Math.sin(Math.PI * (i + 0.5) / n) + 0.0004;
      const q0 = h.project(v3(p0.x - w, p0.y, h.noseTip.z), 0.0005), q1 = h.project(v3(p0.x + w, p0.y, h.noseTip.z), 0.0005);
      const q2 = h.project(v3(p1.x + w, p1.y, h.noseTip.z), 0.0005), q3 = h.project(v3(p1.x - w, p1.y, h.noseTip.z), 0.0005);
      out.quad(q0, q1, q2, q3, sc);
    }
  }
  if (details.includes('beautymark')) {
    dot(cx - 0.022, h.mouth.y + 0.011, 0.0019, fixed(0x2a1710, { rough: 0.6 }), 7);
  }
}

// ------------------------------------------------------------------ piercings
export function buildFacePiercing(kind: string, h: HeadRig, out: ProcMesh): void {
  const cx = h.mouth.x;
  if (kind === 'nosestud') {
    const p = h.project(v3(cx + 0.0085, h.noseBaseY + 0.0045, h.noseTip.z), 0.0012);
    out.ellipsoid(p, v3(0.0026, 0.0026, 0.0018), METAL.diamond, 6, 4);
  } else if (kind === 'nosering') {
    const p = h.project(v3(cx + 0.0075, h.noseBaseY + 0.0015, h.noseTip.z), 0.0006);
    out.torus(p.clone().add(v3(0.0008, -0.0036, 0.0006)), v3(1, 0, 0.35), 0.0048, 0.0011, METAL.silver, 14, 5);
  } else if (kind === 'browpiercing') {
    const b = h.browR;
    for (const dy of [0.0055, -0.004]) {
      const p = h.project(v3(b.x - 0.008, b.y + dy, b.z), 0.0013);
      out.ellipsoid(p, v3(0.0022, 0.0022, 0.0018), METAL.silver, 6, 4);
    }
  }
}

/** Lip piercing (stud under the lower lip) or lip ring (hoop through the side of the lower lip). */
export function buildLipPiercing(kind: string, h: HeadRig, out: ProcMesh, lips: string): void {
  const shape = LIP_SHAPES[lips] ?? LIP_SHAPES.average;
  if (kind === 'lippiercing') {
    const p = h.project(v3(h.mouth.x, h.mouth.y - shape.lower - 0.0058, h.mouth.z), 0.0014);
    out.ellipsoid(p, v3(0.0024, 0.0024, 0.0018), METAL.silver, 6, 4);
  } else if (kind === 'lipring') {
    const x = h.mouth.x + shape.halfW * 0.42;
    const p = h.project(v3(x, h.mouth.y - shape.lower * 0.75, h.mouth.z), 0.0016);
    out.torus(p.add(v3(0, -0.0018, 0)), v3(1, 0, 0), 0.0048, 0.0011, METAL.silver, 14, 5);
  }
}

// ------------------------------------------------------------------ glasses
export function buildGlasses(kind: string, h: HeadRig, out: ProcMesh): void {
  if (kind === 'none') return;
  const eyeZ = Math.max(h.eyeL.z, h.eyeR.z);
  const plane = Math.max(eyeZ + 0.014, h.noseTip.z - 0.006);
  const y = (h.eyeL.y + h.eyeR.y) / 2 + 0.002;
  const cxs = [h.eyeL.x, h.eyeR.x];
  const metal = kind === 'aviators' || kind === 'round' ? METAL.gold : METAL.black;
  const frameW = kind === 'sunglasses' ? 0.0034 : 0.0022;
  const outline = (cx: number, side: number): V3[] => {
    const pts: V3[] = [];
    const n = 20;
    for (let i = 0; i < n; i++) {
      // counter-clockwise seen from the front (+Z)
      const a = (i / n) * Math.PI * 2;
      let x: number, yy: number;
      if (kind === 'round') {
        x = Math.cos(a) * 0.0138;
        yy = Math.sin(a) * 0.0138;
      } else if (kind === 'aviators') {
        // teardrop: wide at the top, dipping low on the outer side
        const c = Math.cos(a), s = Math.sin(a);
        x = c * 0.0172;
        yy = s > 0 ? s * 0.0118 : s * (0.0165 + 0.004 * c * side);
      } else {
        // rounded rectangle
        const c = Math.cos(a), s = Math.sin(a);
        const k = 1 / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
        x = c * k * (kind === 'sunglasses' ? 0.0175 : 0.0165);
        yy = s * k * (kind === 'sunglasses' ? 0.0128 : 0.0115);
      }
      pts.push(v3(cx + x, y + yy, plane - 0.0035 * (x * side > 0 ? (x * side) / 0.017 : 0) ** 2));
    }
    return pts;
  };
  const lensStyle: Style | null =
    kind === 'sunglasses' ? fixed(0x0b0c10, { metal: 0.35, rough: 0.12 })
    : kind === 'aviators' ? fixed(0x2a3a33, { metal: 0.35, rough: 0.1 })
    : kind === 'tinted' ? fixed(0xc98a3b, { metal: 0.2, rough: 0.12 })
    : null;
  cxs.forEach((cx, i) => {
    const side = i === 0 ? 1 : -1;
    const inner = outline(cx, side);
    const c = inner.reduce((a, p) => a.add(p), v3()).multiplyScalar(1 / inner.length);
    const outer = inner.map((p) => p.clone().sub(c).multiplyScalar(1 + frameW / 0.014).add(c));
    out.frame(outer, inner, v3(0, 0, 1), 0.0022, metal);
    if (lensStyle) out.slab(inner, v3(0, 0, 1), 0.0009, lensStyle);
  });
  // bridge
  const inL = h.eyeL.x - 0.0165, inR = h.eyeR.x + 0.0165;
  out.tube([v3(inR, y + 0.004, plane), v3((inL + inR) / 2, y + 0.006, plane + 0.0015), v3(inL, y + 0.004, plane)], 0.0011, 5, metal);
  // temples back to the ears, following the side of the head
  for (const [ex, ear, side] of [[h.eyeL.x, h.earL, 1], [h.eyeR.x, h.earR, -1]] as const) {
    const start = v3(ex + side * 0.0185, y + 0.004, plane - 0.002);
    const end = v3(ear.center.x, ear.top - 0.003, ear.center.z + 0.004);
    const path: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const p = start.clone().lerp(end, i / 6);
      const [t, ph] = h.angles(p);
      const minR = h.radius(t, ph) + 0.0035;
      if (p.distanceTo(h.center) < minR) h.surface(t, ph, 0.0035, p);
      path.push(p);
    }
    out.tube(path, 0.0011, 4, metal);
  }
}

// ------------------------------------------------------------------ earrings
export function buildEarrings(kind: string, h: HeadRig, out: ProcMesh): void {
  if (kind === 'none') return;
  for (const [ear, side] of [[h.earL, 1], [h.earR, -1]] as const) {
    const at = ear.lobe.clone().add(v3(side * 0.0012, 0.0006, 0.002));
    switch (kind) {
      case 'studs':
        out.ellipsoid(at.clone().add(v3(side * 0.0024, 0, 0)), v3(0.0026, 0.0026, 0.0026), METAL.silver, 6, 4);
        break;
      case 'diamondstuds':
        out.ellipsoid(at.clone().add(v3(side * 0.0026, 0, 0)), v3(0.0036, 0.0042, 0.0036), METAL.diamond, 4, 2);
        break;
      case 'hoops':
        out.torus(at.clone().add(v3(side * 0.0016, -0.0122, 0)), v3(1, 0, 0), 0.013, 0.0016, METAL.gold, 18, 5);
        break;
      case 'diamondhoops':
        // AJ's: a fat hoop set with stones all the way round
        out.torus(at.clone().add(v3(side * 0.0018, -0.0142, 0)), v3(1, 0, 0), 0.015, 0.0024, (u) => (Math.floor(u * 28) % 2 ? METAL.diamond : fixed(0xcfe9ff, { metal: 0.3, rough: 0.05 })), 28, 5);
        break;
      case 'dangling': {
        const top = at.clone().add(v3(side * 0.0018, 0, 0));
        const bot = top.clone().add(v3(0, -0.016, 0));
        out.tube([top, bot], 0.0009, 4, METAL.gold);
        out.ellipsoid(bot.clone().add(v3(0, -0.006, 0)), v3(0.0042, 0.007, 0.0042), METAL.diamond, 5, 3);
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ the blank face
/**
 * A flat decal lying on the face: a polygon (star-shaped about its middle) given as offsets
 * from (x, y) in the plane of the face, counter-clockwise seen from the front.
 */
function decal(h: HeadRig, out: ProcMesh, x: number, y: number, pts: Array<[number, number]>, s: Style): void {
  const at = (dx: number, dy: number) => h.project(v3(x + dx, y + dy, h.noseTip.z), 0.0008);
  // whichever way round it was given, it faces out of the face
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) pts = [...pts].reverse();
  let mx = 0, my = 0;
  for (const [dx, dy] of pts) {
    mx += dx / pts.length;
    my += dy / pts.length;
  }
  const c = at(mx, my);
  const ring = pts.map(([dx, dy]) => at(dx, dy));
  for (let i = 0; i < ring.length; i++) out.tri(c, ring[i], ring[(i + 1) % ring.length], s);
}

/**
 * What little there is on the faceless head: a faint line where the mouth would be and, if
 * picked, one small mark (a star on the forehead, a cross, teardrops, a lightning bolt).
 * `dark`: the face itself is dark, so the marks are drawn light.
 */
export function buildFaceMarks(kind: string, h: HeadRig, out: ProcMesh, dark = false): void {
  const cx = h.center.x;
  const k = Math.max(0.6, (h.crownY - h.eyeY) / 0.116);
  // the mouth: a thin sliver, a shade off the face's own color
  const line: Array<[number, number]> = [];
  const hw = 0.0125 * k, th = 0.00075 * k;
  for (let i = 0; i <= 8; i++) line.push([-hw + (2 * hw * i) / 8, -th * Math.sin((Math.PI * i) / 8) - 0.0004 * Math.sin((Math.PI * i) / 8)]);
  for (let i = 8; i >= 0; i--) line.push([-hw + (2 * hw * i) / 8, th * Math.sin((Math.PI * i) / 8) - 0.0004 * Math.sin((Math.PI * i) / 8)]);
  decal(h, out, cx, h.mouth.y, line, style(SLOT.FACE, { shade: dark ? 1.7 : 0.7, rough: 0.9 }));
  if (kind === 'none') return;
  const ink = fixed(dark ? 0xe9e8e3 : 0x24252a, { rough: 0.9 });
  const foreheadY = h.eyeY + 0.041 * k;
  switch (kind) {
    case 'star': {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = (i % 2 ? 0.0034 : 0.0082) * k;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      decal(h, out, cx, foreheadY, pts, ink);
      break;
    }
    case 'cross': {
      const a = 0.0017 * k, v = 0.011 * k, w = 0.0065 * k, up = 0.003 * k;
      decal(h, out, cx, foreheadY, [[-a, -v], [a, -v], [a, v], [-a, v]], ink);
      decal(h, out, cx, foreheadY + up, [[-w, -a], [w, -a], [w, a], [-w, a]], ink);
      break;
    }
    case 'tears': {
      // two teardrops under the right eye
      for (const [dy, r] of [[-0.021, 0.0032], [-0.034, 0.0026]] as const) {
        const pts: Array<[number, number]> = [[0, r * 2.1 * k]];
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI * 0.86 + (i / 8) * Math.PI * 1.28;
          pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
        }
        decal(h, out, h.eyeR.x - 0.004 * k, h.eyeY + dy * k, pts, ink);
      }
      break;
    }
    case 'bolt': {
      // a lightning bolt down the left cheek (two slanted bars meeting at a step)
      const x = h.eyeL.x + 0.003 * k, y = h.eyeY - 0.03 * k;
      decal(h, out, x, y, [[0.0005, 0.0125], [0.0052, 0.0125], [0.0012, 0.001], [-0.0042, 0.001]].map(([a, b]) => [a * k, b * k] as [number, number]), ink);
      decal(h, out, x, y, [[0.0042, 0.003], [-0.0012, 0.003], [-0.0052, -0.012], [0.0005, -0.0015]].map(([a, b]) => [a * k, b * k] as [number, number]), ink);
      break;
    }
  }
}
