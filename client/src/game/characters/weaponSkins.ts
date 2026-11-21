import * as THREE from 'three';
import { gunSkinField, type Appearance } from '@shared/config/appearance';

/**
 * AJ's weapon wraps. Purely a material swap on the held model: the gun, its stats, its muzzle
 * and its hit box are untouched (cosmetic only, by design).
 *
 * The prints are drawn in the shader from the model's own vertex positions, so they wrap any
 * gun model whatever its UVs, and the model's own dark details (grips, holes) stay dark.
 */

interface SkinDef {
  id: number;
  metal: number;
  rough: number;
  /** Extra self-light (neon glows, metals read as shiny without an environment map). */
  glow: number;
}

const SKINS: Record<string, SkinDef> = {
  gold: { id: 1, metal: 0.4, rough: 0.3, glow: 0.08 },
  camo: { id: 2, metal: 0.05, rough: 0.85, glow: 0.12 },
  neon: { id: 3, metal: 0.2, rough: 0.4, glow: 0.05 },
  chrome: { id: 4, metal: 0.4, rough: 0.12, glow: 0.04 },
  graffiti: { id: 5, metal: 0.05, rough: 0.6, glow: 0.18 },
  ice: { id: 6, metal: 0.35, rough: 0.08, glow: 0.1 },
};

const NOISE = /* glsl */ `
float wsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wsNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wsHash(i), wsHash(i + vec3(1,0,0)), f.x), mix(wsHash(i + vec3(0,1,0)), wsHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wsHash(i + vec3(0,0,1)), wsHash(i + vec3(1,0,1)), f.x), mix(wsHash(i + vec3(0,1,1)), wsHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 wsPrint(int kind, vec3 p, out float glow) {
  glow = 0.0;
  if (kind == 1) return vec3(0.78, 0.5, 0.1);
  if (kind == 4) return vec3(0.68, 0.72, 0.78);
  if (kind == 2) {
    float a = wsNoise(p * 9.0), b = wsNoise(p * 15.0 + 7.0);
    return a > 0.62 ? vec3(0.13, 0.17, 0.08) : b > 0.6 ? vec3(0.32, 0.27, 0.15) : a < 0.32 ? vec3(0.05, 0.06, 0.04) : vec3(0.21, 0.28, 0.1);
  }
  if (kind == 3) {
    float s = fract(p.z * 6.0 + p.y * 2.0);
    if (s < 0.14) { glow = 1.6; return vec3(0.25, 1.0, 0.12); }
    if (s > 0.5 && s < 0.6) { glow = 1.6; return vec3(1.0, 0.12, 0.75); }
    return vec3(0.03, 0.03, 0.035);
  }
  if (kind == 6) {
    // iced out: rows of little stones, each catching the light its own way
    vec3 q = p * 70.0;
    vec3 cell = floor(q);
    float sparkle = wsHash(cell);
    float d = length(fract(q) - 0.5);
    if (d > 0.44) return vec3(0.55, 0.6, 0.66);
    glow = sparkle > 0.86 ? 2.2 : 0.0;
    return mix(vec3(0.78, 0.88, 0.98), vec3(1.0), sparkle);
  }
  // graffiti: bright blobs with black outlines
  float n = wsNoise(p * 6.0), m = wsNoise(p * 11.0 + 3.0);
  float edge = abs(n - 0.5);
  if (edge < 0.025) return vec3(0.02);
  vec3 c = n > 0.5 ? (m > 0.5 ? vec3(1.0, 0.16, 0.7) : vec3(0.2, 0.62, 1.0)) : (m > 0.55 ? vec3(0.3, 1.0, 0.18) : vec3(1.0, 0.85, 0.2));
  return c;
}
`;

const cache = new Map<string, THREE.MeshStandardMaterial>();

function skinMaterial(src: THREE.Material, kind: string, def: SkinDef, unit: number): THREE.MeshStandardMaterial {
  const std = src as THREE.MeshStandardMaterial;
  // keyed on what the material looks like (stand-in guns make fresh materials every time)
  const key = `${std.map?.uuid ?? '-'}|${std.color?.getHexString() ?? '-'}|${std.vertexColors ? 1 : 0}|${kind}|${unit.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshStandardMaterial({
    name: `wrap-${kind}`,
    map: std.map ?? null,
    color: std.color?.clone() ?? new THREE.Color(0xffffff),
    vertexColors: !!std.vertexColors,
    roughness: def.rough,
    metalness: def.metal,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.wsUnit = { value: unit };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWsPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWsPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWsPos;\nuniform float wsUnit;\n${NOISE}`)
      .replace(
        // after the texture and the vertex colors, so the wrap replaces both
        '#include <color_fragment>',
        `#include <color_fragment>
\tfloat wsLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
\tfloat wsGlow;
\tvec3 wsCol = wsPrint(${def.id}, vWsPos * wsUnit, wsGlow);
\t// the model's own darkest details (grips, holes, sights) stay dark
\tdiffuseColor.rgb = wsCol * mix(0.5, 1.0, smoothstep(0.002, 0.03, wsLum));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
	totalEmissiveRadiance += diffuseColor.rgb * (${def.glow.toFixed(3)} + wsGlow * 0.5);
	// metals: a fake sky / ground reflection (the scene has no environment map)
	${def.id === 1 || def.id === 4 || def.id === 6 ? `{
		vec3 wsR = reflect(-normalize(vViewPosition), normal);
		float wsSky = smoothstep(-0.25, 0.4, wsR.y);
		totalEmissiveRadiance += diffuseColor.rgb * (0.1 + 0.9 * wsSky) * ${def.id === 4 ? '0.9' : '0.55'};
	}` : ''}`,
      );
  };
  mat.customProgramCacheKey = () => `wrap-${kind}`;
  cache.set(key, mat);
  return mat;
}

/** The skin a gun wears for a look: its own (bought for that gun), else the AJ'S wrap. */
export function skinForGun(look: Readonly<Appearance>, gun: string): string {
  const own = (look as unknown as Record<string, string | undefined>)[gunSkinField(gun)];
  return own && own !== 'none' ? own : look.weaponSkin;
}

/** Is this an AJ's wrap that changes the gun's look? */
export function hasWeaponSkin(skin: string | undefined): boolean {
  return !!skin && skin in SKINS;
}

/**
 * Puts a wrap on a (cloned) gun model. `size` is the model's own size (its units), so the
 * print is the same scale on every gun.
 */
export function applyWeaponSkin(model: THREE.Object3D, skin: string | undefined, size?: THREE.Vector3): void {
  const def = skin ? SKINS[skin] : undefined;
  if (!def || !skin) return;
  const unit = size ? 1 / Math.max(1e-6, size.x, size.y, size.z) : 1;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => skinMaterial(m, skin, def, unit))
      : skinMaterial(mesh.material, skin, def, unit);
  });
}
