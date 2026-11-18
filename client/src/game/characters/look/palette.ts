import * as THREE from 'three';
import {
  BOTTOM_COLORS, EYE_COLORS, HAIR_COLORS, SHOE_COLORS, SKIN_TONES, TOP_COLORS, type Appearance, type LookOption,
} from '@shared/config/appearance';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { noise3 } from './hair';
import { SLOT, hash01, smoothstep } from './meshKit';

/** Linear RGB triplet. */
export type RGB = [number, number, number];

const _c = new THREE.Color();
function lin(hex: string | number): RGB {
  if (typeof hex === 'string') _c.set(hex);
  else _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}
function pick(list: readonly LookOption[], id: string): RGB {
  return lin(list.find((o) => o.id === id)?.color ?? list[0].color ?? '#888888');
}
function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}
function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The color of every slot for one character (crew color included). */
export function paletteFor(look: Readonly<Appearance>, team: TeamId): RGB[] {
  const skin = pick(SKIN_TONES, look.skin);
  const out: RGB[] = [];
  out[SLOT.FIXED] = [1, 1, 1];
  out[SLOT.SKIN] = skin;
  out[SLOT.SKIN_DARK] = scale(skin, 0.72);
  // lips: the skin tone, deeper and a little warmer
  out[SLOT.LIPS] = mixRGB(scale(skin, 0.6), lin(0x8a3434), 0.34);
  out[SLOT.IRIS] = pick(EYE_COLORS, look.eyeColor);
  // brows follow the facial hair color (a little darker than the hair itself reads best)
  out[SLOT.BROW] = scale(pick(HAIR_COLORS, look.facialHairColor), 0.8);
  out[SLOT.HAIR] = pick(HAIR_COLORS, look.hairColor);
  out[SLOT.BEARD] = scale(pick(HAIR_COLORS, look.facialHairColor), 0.92);
  out[SLOT.TOP] = pick(TOP_COLORS, look.topColor);
  out[SLOT.BOTTOM] = pick(BOTTOM_COLORS, look.bottomColor);
  out[SLOT.SHOE] = pick(SHOE_COLORS, look.shoeColor);
  out[SLOT.CREW] = lin(crewColorHex(team));
  out[SLOT.TEETH] = look.teeth === 'white' ? lin(0xfbfcff) : lin(0xe9dcc0);
  return out;
}

/** Floats per vertex in an assembled character's paint data: slot, slot B, mix, shade, packed fixed color. */
export const PAINT_STRIDE = 5;

// ------------------------------------------------------------------ AJ's prints
/** Where a slot's vertices are (bind pose, meters): prints like flames run from the hem up. */
interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}
type Print = (x: number, y: number, z: number, b: Bounds, out: RGB) => void;

const C = (hex: number): RGB => lin(hex);
const CAMO = [C(0x5b6b3a), C(0x3b4524), C(0x8a7a4a), C(0x1f2416)];
const DYE = [C(0xd45cc4), C(0x4fc3f7), C(0xffe14d), C(0x7dff6b)];
const FLAME = { base: C(0x1e1e22), red: C(0xd9301c), orange: C(0xff7a1a), yellow: C(0xffd23f) };
const GALAXY = [C(0x1b1340), C(0x3a2a6e), C(0x7a3fd1), C(0x1f6fd1)];
const BRED = { red: C(0xc0232b), black: C(0x141416) };
const set = (out: RGB, c: RGB) => {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
};
const blend = (out: RGB, a: RGB, b: RGB, t: number) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
};

/** The prints AJ's sells (drawn from the vertex position, so they wrap any cut of clothing). */
export const PRINTS: Record<string, Print> = {
  camo: (x, y, z, _b, out) => {
    const k = 7.5;
    const a = noise3(x * k, y * k, z * k, 3), b = noise3(x * k * 1.7 + 9, y * k * 1.7, z * k * 1.7, 7);
    set(out, a > 0.62 ? CAMO[1] : b > 0.64 ? CAMO[2] : a < 0.3 ? CAMO[3] : CAMO[0]);
  },
  tiedye: (x, y, z, b, out) => {
    // a spiral from the middle of the chest
    const cy = (b.min[1] + b.max[1]) / 2 + 0.05;
    const r = Math.hypot(x, y - cy, Math.min(0, z) * 0.5);
    const ang = Math.atan2(y - cy, x) / (Math.PI * 2);
    let t = r * 7 + ang + noise3(x * 6, y * 6, z * 6, 5) * 0.6;
    t = ((t % 1) + 1) % 1;
    const f = t * DYE.length;
    const i = Math.floor(f);
    blend(out, DYE[i % DYE.length], DYE[(i + 1) % DYE.length], smoothstep(0.55, 1, f - i));
  },
  flames: (x, y, z, b, out) => {
    // flames licking up from the hem
    const h = (y - b.min[1]) / Math.max(0.05, b.max[1] - b.min[1]);
    const tongue = 0.32 + 0.22 * noise3(x * 22, 0.5, z * 22, 2) + 0.1 * Math.sin(x * 60 + z * 40);
    if (h < tongue * 0.45) set(out, FLAME.yellow);
    else if (h < tongue * 0.8) set(out, FLAME.orange);
    else if (h < tongue) set(out, FLAME.red);
    else set(out, FLAME.base);
  },
  galaxy: (x, y, z, _b, out) => {
    const n = noise3(x * 11, y * 11, z * 11, 4), m = noise3(x * 23 + 4, y * 23, z * 23, 8);
    const f = Math.min(0.999, Math.max(0, n * 0.8 + m * 0.4 - 0.1)) * (GALAXY.length - 1);
    const i = Math.floor(f);
    blend(out, GALAXY[i], GALAXY[i + 1], f - i);
    // stars
    if (hash01(Math.round(x * 400), Math.round(y * 400), Math.round(z * 400)) > 0.94) set(out, [0.95, 0.95, 1]);
  },
  bred: (_x, y, z, b, out) => {
    // black toe box, heel and lower panels; red uppers
    const h = (y - b.min[1]) / Math.max(0.02, b.max[1] - b.min[1]);
    const f = (z - b.min[2]) / Math.max(0.02, b.max[2] - b.min[2]);
    set(out, h < 0.38 || f > 0.78 || f < 0.18 ? BRED.black : BRED.red);
  },
};

/** The print on each paint slot for a look (only AJ's options have one). */
export function printsFor(look: Readonly<Appearance>): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  out[SLOT.TOP] = TOP_COLORS.find((o) => o.id === look.topColor)?.pattern;
  out[SLOT.BOTTOM] = BOTTOM_COLORS.find((o) => o.id === look.bottomColor)?.pattern;
  out[SLOT.SHOE] = SHOE_COLORS.find((o) => o.id === look.shoeColor)?.pattern;
  return out;
}

/**
 * Writes the per-vertex colors of an assembled character: each vertex blends two slots and
 * is scaled by its own shading. With `pos` (bind pose, meters) and `prints`, slots with a
 * print take their color from it instead of the palette.
 */
export function paint(colors: Float32Array, attrs: Float32Array, palette: RGB[], pos?: Float32Array, prints?: Array<string | undefined>): void {
  const n = colors.length / 3;
  const fixed: RGB = [0, 0, 0];
  // prints in use, with the bounds of their slot's vertices
  const active: Array<{ fn: Print; b: Bounds; col: RGB } | undefined> = [];
  if (pos && prints) {
    for (let s = 0; s < prints.length; s++) {
      const fn = prints[s] ? PRINTS[prints[s]!] : undefined;
      if (!fn) continue;
      const b: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let i = 0; i < n; i++) {
        if (attrs[i * PAINT_STRIDE] !== s) continue;
        for (let k = 0; k < 3; k++) {
          const v = pos[i * 3 + k];
          if (v < b.min[k]) b.min[k] = v;
          if (v > b.max[k]) b.max[k] = v;
        }
      }
      if (b.min[0] !== Infinity) active[s] = { fn, b, col: [0, 0, 0] };
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * PAINT_STRIDE;
    const sA = attrs[a], sB = attrs[a + 1], m = attrs[a + 2], sh = attrs[a + 3];
    if (sA === SLOT.FIXED || sB === SLOT.FIXED) unpack(attrs[a + 4], fixed);
    const pa = active[sA], pb = sB !== sA ? active[sB] : pa;
    if (pa) pa.fn(pos![i * 3], pos![i * 3 + 1], pos![i * 3 + 2], pa.b, pa.col);
    if (pb && pb !== pa) pb.fn(pos![i * 3], pos![i * 3 + 1], pos![i * 3 + 2], pb.b, pb.col);
    const base = sA === SLOT.FIXED ? fixed : pa ? pa.col : palette[sA];
    const other = sB === SLOT.FIXED ? fixed : pb ? pb.col : palette[sB];
    colors[i * 3] = (base[0] + (other[0] - base[0]) * m) * sh;
    colors[i * 3 + 1] = (base[1] + (other[1] - base[1]) * m) * sh;
    colors[i * 3 + 2] = (base[2] + (other[2] - base[2]) * m) * sh;
  }
}

/** Fixed colors are packed into one float (8 bits per channel, sqrt-encoded so darks keep detail). */
export function pack(r: number, g: number, b: number): number {
  const q = (x: number) => Math.min(255, Math.max(0, Math.round(Math.sqrt(Math.max(0, x)) * 255)));
  return (q(r) << 16) | (q(g) << 8) | q(b);
}
function unpack(v: number, out: RGB): void {
  const d = (x: number) => (x / 255) ** 2;
  out[0] = d((v >>> 16) & 255);
  out[1] = d((v >>> 8) & 255);
  out[2] = d(v & 255);
}

/** Facial expression previews: brows, eyes and mouth (see face.ts). */
export interface Expression {
  /** Mouth corners up (+) / down (-), meters. */
  smile: number;
  /** One corner only (smirk), meters. */
  smirk: number;
  /** Gap between the lips, meters. */
  open: number;
  /** Mouth width multiplier. */
  wide: number;
  /** Brows: raise the inner / outer ends (meters, + = up). */
  browIn: number;
  browOut: number;
  /** Eye height multiplier (squint < 1 < wide). */
  eyeOpen: number;
}

export const EXPRESSION_PRESETS: Record<string, Expression> = {
  neutral: { smile: 0, smirk: 0, open: 0, wide: 1, browIn: 0, browOut: 0, eyeOpen: 1 },
  happy: { smile: 0.0068, smirk: 0, open: 0.0052, wide: 1.16, browIn: 0.002, browOut: 0.003, eyeOpen: 0.66 },
  angry: { smile: -0.0035, smirk: 0, open: 0.0016, wide: 0.98, browIn: -0.0078, browOut: 0.0036, eyeOpen: 0.76 },
  sad: { smile: -0.0058, smirk: 0, open: 0, wide: 0.9, browIn: 0.0064, browOut: -0.003, eyeOpen: 0.82 },
  serious: { smile: -0.0012, smirk: 0, open: 0, wide: 0.95, browIn: -0.0032, browOut: -0.0006, eyeOpen: 0.84 },
  smirk: { smile: 0.0008, smirk: 0.0065, open: 0, wide: 1.03, browIn: -0.0008, browOut: 0.0032, eyeOpen: 0.88 },
  surprised: { smile: 0, smirk: 0, open: 0.012, wide: 0.76, browIn: 0.0085, browOut: 0.007, eyeOpen: 1.4 },
};
