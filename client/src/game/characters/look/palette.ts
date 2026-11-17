import * as THREE from 'three';
import {
  BOTTOM_COLORS, EYE_COLORS, HAIR_COLORS, SHOE_COLORS, SKIN_TONES, TOP_COLORS, type Appearance, type LookOption,
} from '@shared/config/appearance';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { SLOT } from './meshKit';

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

/**
 * Writes the per-vertex colors of an assembled character: each vertex blends two slots and
 * is scaled by its own shading.
 */
export function paint(colors: Float32Array, attrs: Float32Array, palette: RGB[]): void {
  const n = colors.length / 3;
  const fixed: RGB = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = i * PAINT_STRIDE;
    const sA = attrs[a], sB = attrs[a + 1], m = attrs[a + 2], sh = attrs[a + 3];
    if (sA === SLOT.FIXED || sB === SLOT.FIXED) unpack(attrs[a + 4], fixed);
    const base = sA === SLOT.FIXED ? fixed : palette[sA];
    const other = sB === SLOT.FIXED ? fixed : palette[sB];
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
