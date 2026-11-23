/**
 * Recoloring a one-piece model without replacing its material: the delivered maps stay, and the
 * shader moves the color of three kinds of texel (clothing, skin, hair) to the player's picks,
 * keeping each texel's brightness relative to its kind (so the folds, seams and painted shading
 * stay). Which garment a clothing texel belongs to comes from its vertex (jacket, cargos, boots),
 * found once from the skeleton's weights and the mesh's own shape.
 */
import * as THREE from 'three';
import { BOTTOM_COLORS, HAIR_COLORS, SHOE_COLORS, SKIN_TONES, TOP_COLORS, type Appearance, type LookOption } from '@shared/config/appearance';
import { PRINTS, type RGB } from '../look/palette';

/** Garment of a vertex (index into the per-look tint table). */
export const enum Region { None = 0, Top = 1, Bottom = 2, Shoe = 3 }

export interface Regions {
  /** Per vertex: garment, whether it is hair, whether its skin may be retoned. */
  garment: Uint8Array;
  hair: Uint8Array;
  skin: Uint8Array;
  /** Bind-pose bounds of each garment (prints like flames run from the hem up). */
  bounds: Array<{ min: [number, number, number]; max: [number, number, number] }>;
  /** Where the jacket ends and where the pants' cuffs end (bind pose, file meters). */
  hemY: number;
  cuffY: number;
}

/** Brightness of each kind of texel as delivered (linear), measured from the color map. */
export interface Reference {
  cloth: number;
  skin: number;
  hair: number;
  /** The delivered skin's typical color (linear RGB): bare arms and legs on it match the face. */
  skinColor: [number, number, number];
}

type Group = 'head' | 'neck' | 'hand' | 'arm' | 'foot' | 'leg' | 'torso' | 'hips';

function groupOf(bone: THREE.Object3D): Group {
  for (let o: THREE.Object3D | null = bone; o; o = o.parent) {
    const n = o.name;
    if (n.startsWith('Neck')) return 'neck';
    if (n.startsWith('Head')) return 'head';
    if (/^(Wrist|Index|Middle|Ring|Pinky|Thumb)/.test(n)) return 'hand';
    if (/^(Shoulder|UpperArm|LowerArm)/.test(n)) return 'arm';
    if (/^(Foot|LowerLeg.Extra)/.test(n)) return 'foot';
    if (/^(UpperLeg|LowerLeg)/.test(n)) return 'leg';
    if (/^(Abdomen|Torso|Chest)/.test(n)) return 'torso';
    if (n === 'Body') return 'hips';
  }
  return 'hips';
}

/**
 * Splits the mesh into garments.
 *  - boots: what follows the feet; hands: what follows the hands (cuffs are the jacket's);
 *  - the jacket ends at its hem, found as the band of downward-facing surface under it;
 *  - the head: a hooded model's mask is left as delivered (the hood is the jacket's); otherwise
 *    the face (eyes, glasses) keeps its colors, and above the ears is hair.
 */
export function findRegions(mesh: THREE.SkinnedMesh, masked: boolean): Regions {
  const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;
  const groups = bones.map(groupOf);
  const head = bones.find((b) => b.name === 'Head')!.getWorldPosition(new THREE.Vector3());
  const ankleZ = (bones.find((b) => b.name === 'FootL')!.getWorldPosition(new THREE.Vector3()).z + bones.find((b) => b.name === 'FootR')!.getWorldPosition(new THREE.Vector3()).z) / 2;

  // the hem: the 1 cm band (between the legs and the chest) with the most downward-facing surface
  const counts = new Map<number, number>();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < 0.55 || y > 1.05 || Math.abs(position.getX(i)) > 0.3 || normal.getY(i) > -0.6) continue;
    const bin = Math.floor(y * 100);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  let peak = 82;
  for (const [bin, n] of counts) if (n > (counts.get(peak) ?? 0)) peak = bin;
  const hemY = peak / 100 - 0.02;
  // the pants' cuffs: the lowest band (above the soles) with downward-facing surface under them
  let cuffY = 0.14;
  for (let bin = 8; bin < 40; bin++) {
    let down = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y >= bin / 100 && y < (bin + 1) / 100 && normal.getY(i) < -0.6) down++;
    }
    if (down >= 12) {
      cuffY = bin / 100;
      break;
    }
  }

  // the hem's outer ring, by angle around the body: under the hem, what lies inside it is the pants
  const ANGLES = 36, zc = head.z;
  const hemR = new Float32Array(ANGLES);
  const angleOf = (x: number, z: number) => Math.floor(((Math.atan2(x, z - zc) / (Math.PI * 2)) + 0.5) * ANGLES) % ANGLES;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), x = position.getX(i), z = position.getZ(i);
    if (y < hemY + 0.005 || y > hemY + 0.05 || Math.abs(x) > 0.3) continue;
    const a = angleOf(x, z);
    hemR[a] = Math.max(hemR[a], Math.hypot(x, z - zc));
  }

  const n = position.count;
  const out: Regions = { garment: new Uint8Array(n), hair: new Uint8Array(n), skin: new Uint8Array(n).fill(1), bounds: [], hemY, cuffY };
  const w: Record<Group, number> = { head: 0, neck: 0, hand: 0, arm: 0, foot: 0, leg: 0, torso: 0, hips: 0 };
  for (let i = 0; i < n; i++) {
    for (const k in w) w[k as Group] = 0;
    for (let k = 0; k < 4; k++) w[groups[skinIndex.getComponent(i, k)]] += skinWeight.getComponent(i, k);
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    let g: Region;
    if (w.head + w.neck > 0.5) {
      const up = y - head.y, front = z - head.z;
      if (masked) {
        // the mask, inside the hood's opening: as delivered
        const inMask = front > 0.02 && (x / 0.155) ** 2 + ((up - 0.115) / 0.165) ** 2 < 1;
        g = inMask ? Region.None : Region.Top;
        if (inMask) out.skin[i] = 0;
      } else if (front > 0.06 && up > 0.02 && up < 0.24 && Math.abs(x) < 0.17) {
        // eyes and glasses (as delivered)
        g = Region.None;
      } else if (up > 0.11) {
        g = Region.None;
        out.hair[i] = 1;
      } else {
        // the collar
        g = Region.Top;
      }
    } else if (w.hand > 0.5) g = Region.Top;
    // the boots show below the cuffs (above, they are inside the pants)
    // (and the toe caps, out in front of the cuffs)
    else if (y < cuffY || (w.foot > 0.5 && z - ankleZ > 0.06 && y < cuffY + 0.12)) g = Region.Shoe;
    // around the hem: the hem is the outer ring, the pants are inside it (and follow the legs)
    else if (y < hemY + 0.06 && y > hemY - 0.06) {
      const ring = hemR[angleOf(x, z)];
      const inside = ring > 0 && Math.hypot(x, z - zc) < ring - 0.015;
      g = y < hemY + 0.005 ? (inside || w.leg > 0.3 ? Region.Bottom : Region.Top) : inside && w.leg > 0.15 ? Region.Bottom : Region.Top;
    } else g = y >= hemY ? Region.Top : Region.Bottom;
    out.garment[i] = g;
    const b = (out.bounds[g] ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    for (const [k, v] of [x, y, z].entries()) {
      b.min[k] = Math.min(b.min[k], v);
      b.max[k] = Math.max(b.max[k], v);
    }
  }
  return out;
}

const _c = new THREE.Color();
function linear(hex: string): RGB {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The same texel classes the shader uses (linear color). */
function texelKind(r: number, g: number, b: number): 'cloth' | 'skin' | 'dark' | null {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = luma(r, g, b);
  const sat = (hi - lo) / Math.max(hi, 1e-4);
  if (sat > 0.55 && r >= b) return 'skin';
  if (sat < 0.15 && l > 0.08) return 'cloth';
  if (l < 0.03) return 'dark';
  return null;
}

/** What each vertex is painted as, from the color map at its UV: 0 cloth, 1 skin, 2 dark (hair, frames), 3 other. */
export function vertexKinds(mesh: THREE.SkinnedMesh): Uint8Array {
  const g = mesh.geometry, uv = g.attributes.uv, n = g.attributes.position.count;
  const out = new Uint8Array(n).fill(3);
  const map = (mesh.material as THREE.MeshStandardMaterial).map;
  const img = map?.image as CanvasImageSource | undefined;
  if (!img || !uv || typeof document === 'undefined') return out;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return out;
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (let i = 0; i < n; i++) {
    // (glTF maps are not flipped: v runs down the image)
    const x = Math.min(size - 1, Math.max(0, Math.floor(uv.getX(i) * size))), y = Math.min(size - 1, Math.max(0, Math.floor(uv.getY(i) * size)));
    const o = (y * size + x) * 4;
    const kind = texelKind(lin(px[o]), lin(px[o + 1]), lin(px[o + 2]));
    out[i] = kind === 'cloth' ? 0 : kind === 'skin' ? 1 : kind === 'dark' ? 2 : 3;
  }
  return out;
}

/** Measures the delivered brightness of each kind of texel (median), from the color map. */
export function measureReference(map: THREE.Texture): Reference {
  const fallback: Reference = { cloth: 0.35, skin: 0.025, hair: 0.012, skinColor: [0.06, 0.02, 0.012] };
  const img = map.image as CanvasImageSource | undefined;
  if (!img || typeof document === 'undefined') return fallback;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const by: Record<string, number[]> = { cloth: [], skin: [], dark: [] };
  const skinSum = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    const r = lin(px[i]), g = lin(px[i + 1]), b = lin(px[i + 2]);
    const kind = texelKind(r, g, b);
    if (kind) by[kind].push(luma(r, g, b));
    if (kind === 'skin') {
      skinSum[0] += r;
      skinSum[1] += g;
      skinSum[2] += b;
    }
  }
  const ns = Math.max(1, by.skin.length);
  const median = (a: number[], d: number) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : d);
  return {
    cloth: median(by.cloth, fallback.cloth), skin: median(by.skin, fallback.skin), hair: median(by.dark, fallback.hair),
    skinColor: by.skin.length ? [skinSum[0] / ns, skinSum[1] / ns, skinSum[2] / ns] : fallback.skinColor,
  };
}

const GARMENT_LISTS: Array<[Region, readonly LookOption[], keyof Appearance]> = [
  [Region.Top, TOP_COLORS, 'topColor'], [Region.Bottom, BOTTOM_COLORS, 'bottomColor'], [Region.Shoe, SHOE_COLORS, 'shoeColor'],
];

/** The picks a recolored model depends on (one cached geometry + material per key). */
export function recolorKey(look: Readonly<Appearance>): string {
  return `${look.topColor}|${look.bottomColor}|${look.shoeColor}|${look.skin}|${look.hairColor}`;
}

/**
 * A look's per-vertex tints: the garment's color (or its print), whether to apply it, its
 * metallic finish. "Original" leaves the garment as delivered.
 */
export function tintGeometry(base: THREE.BufferGeometry, regions: Regions, look: Readonly<Appearance>): THREE.BufferGeometry {
  const n = base.attributes.position.count, pos = base.attributes.position;
  const tint = new Float32Array(n * 3), mix = new Float32Array(n * 4);
  const picks = new Map<Region, { color: RGB; on: number; metal: number; print?: string }>();
  for (const [region, list, field] of GARMENT_LISTS) {
    const o = list.find((x) => x.id === look[field]);
    picks.set(region, { color: linear(o?.color ?? '#888888'), on: o && o.id !== 'original' ? 1 : 0, metal: o?.metal ?? 0, print: o?.pattern });
  }
  const c: RGB = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const g = regions.garment[i] as Region;
    const p = picks.get(g);
    if (p && p.on) {
      const draw = p.print ? PRINTS[p.print] : undefined;
      if (draw) draw(pos.getX(i), pos.getY(i), pos.getZ(i), regions.bounds[g], c);
      else [c[0], c[1], c[2]] = p.color;
      tint.set(c, i * 3);
      mix[i * 4] = 1;
      mix[i * 4 + 3] = p.metal;
    }
    mix[i * 4 + 1] = regions.hair[i];
    mix[i * 4 + 2] = regions.skin[i];
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  g.setAttribute('wtTint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('wtMix', new THREE.BufferAttribute(mix, 4));
  g.boundingBox = base.boundingBox;
  g.boundingSphere = base.boundingSphere;
  return g;
}

/** A copy of the model's own material (same maps) that recolors as the look asks. */
export function recolorMaterial(base: THREE.MeshStandardMaterial, ref: Reference, look: Readonly<Appearance>, glow: { value: number }): THREE.MeshStandardMaterial {
  const m = base.clone();
  const skin = SKIN_TONES.find((o) => o.id === look.skin);
  const hair = HAIR_COLORS.find((o) => o.id === look.hairColor);
  const uniforms = {
    uSkin: { value: new THREE.Vector3(...linear(skin?.color ?? '#603821')) },
    uSkinMix: { value: skin && skin.id !== 'original' ? 1 : 0 },
    uHair: { value: new THREE.Vector3(...linear(hair?.color ?? '#1b1714')) },
    // (the braids are black as delivered)
    uHairMix: { value: hair && hair.id !== 'black' ? 1 : 0 },
    uRef: { value: new THREE.Vector3(ref.cloth, ref.skin, ref.hair) },
    uCharGlow: glow,
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wtTint;\nattribute vec4 wtMix;\nvarying vec3 vWtTint;\nvarying vec4 vWtMix;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWtTint = wtTint;\n\tvWtMix = wtMix;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCharGlow;
uniform vec3 uSkin;
uniform float uSkinMix;
uniform vec3 uHair;
uniform float uHairMix;
uniform vec3 uRef;
varying vec3 vWtTint;
varying vec4 vWtMix;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	// which kind of texel this is, from its own color (see recolor.ts)
	vec3 wtTex = diffuseColor.rgb;
	float wtL = dot( wtTex, vec3( 0.2126, 0.7152, 0.0722 ) );
	float wtHi = max( wtTex.r, max( wtTex.g, wtTex.b ) ), wtLo = min( wtTex.r, min( wtTex.g, wtTex.b ) );
	float wtSat = ( wtHi - wtLo ) / max( wtHi, 1e-4 );
	float wtSkin = smoothstep( 0.42, 0.62, wtSat ) * step( wtTex.b, wtTex.r ) * vWtMix.z;
	float wtHair = vWtMix.y * ( 1.0 - wtSkin );
	// (chains and zips are metal in the map: left alone)
	float wtMetal = texture2D( metalnessMap, vMetalnessMapUv ).b;
	float wtCloth = vWtMix.x * ( 1.0 - smoothstep( 0.12, 0.3, wtSat ) ) * ( 1.0 - wtHair ) * ( 1.0 - smoothstep( 0.25, 0.55, wtMetal ) );
	vec3 wtCol = wtTex;
	wtCol = mix( wtCol, vWtTint * clamp( wtL / uRef.x, 0.12, 1.7 ), wtCloth );
	wtCol = mix( wtCol, uSkin * clamp( wtL / uRef.y, 0.35, 2.4 ), wtSkin * uSkinMix );
	wtCol = mix( wtCol, uHair * clamp( wtL / uRef.z, 0.3, 2.5 ), wtHair * uHairMix );
	diffuseColor.rgb = wtCol;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 0.32, vWtMix.w * wtCloth );')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance += diffuseColor.rgb * uCharGlow;
	// metallic finishes read as shiny without an environment map: a little of their own light
	totalEmissiveRadiance += diffuseColor.rgb * 0.22 * vWtMix.w * wtCloth;`);
  };
  m.customProgramCacheKey = () => 'imported-recolor';
  return m;
}
