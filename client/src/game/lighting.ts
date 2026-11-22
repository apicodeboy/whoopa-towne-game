import { Color } from 'three';

/**
 * LIGHTING — the look of the town. Two presets live here: DAY (the default) and NIGHT.
 * TIME_OF_DAY below picks the one the menus and the classic modes use; JUMP OFF THE PORCH
 * moves between them during a match (day and night every three minutes), blending every value
 * through `setNight`. Tweak a preset for how bright the streets are (ambient + sun / moon),
 * the street lights, the windows and the sky. Colors are 0xRRGGBB, intensities are three.js
 * light units.
 */

export interface LightingPreset {
  /** Sky dome gradient (zenith -> horizon). The horizon also tints the fog, so far buildings melt into it. */
  sky: { top: number; mid: number; horizon: number };
  /** Haze low in the sky (city lights at night, warm dust by day) and how strongly it tints the horizon (0..1). */
  cityGlow: number;
  cityGlowAmount: number;
  stars: number;
  /**
   * The sun (day) or moon (night): the only light that casts shadows. `dir` is where it hangs
   * in the sky; `body` picks the disc drawn there.
   */
  sun: { color: number; intensity: number; dir: readonly [number, number, number]; body: 'sun' | 'moon' };
  /** Ambient sky / ground bounce. At night this decides how dark the streets are between the lamps. */
  ambient: { sky: number; ground: number; intensity: number };
  exposure: number;

  /*
   * The light sources below shine downward in a wide cone (like real street lamps and ceiling
   * fixtures), so they never light the underside of whatever hangs above them. `angle` is the
   * half-angle of that cone in radians (1.57 = a full half-sphere). Intensity 0 switches a kind off.
   */
  /** Street lamps: warm sodium light. */
  street: { color: number; intensity: number; distance: number; angle: number };
  /** Lights inside the enterable shops and the warehouse (wide, so walls and cover get lit too). */
  interior: { color: number; intensity: number; distance: number; angle: number };
  /** Lights under the shop awnings, over the sidewalk. */
  shop: { color: number; intensity: number; distance: number; angle: number };
  /**
   * How many lamps light the world at once (the nearest ones to where you are looking) and
   * how far away they fade out. Every other lamp still shows its head and light pool.
   */
  budget: Record<'high' | 'medium' | 'low' | 'performance', { lights: number; fade: number }>;
  /** Color of the street-lamp heads (bright when lit, grey glass when off). */
  lampHead: number;
  /** Soft cone of light under each street lamp (0 = off). */
  coneOpacity: number;
  /** Light pool painted on the ground under every lamp (0 = off). */
  poolOpacity: number;
  /** Share of windows with the lights on. */
  litWindows: number;
  /** Color of the unlit window glass (dark at night, reflecting the sky by day). */
  windowGlass: number;
  /** Brightness of the lit windows in the distant skyline (0 = none). */
  skylineWindows: number;

  /** Smoke and dust do not react to lights, so they are dimmed to sit in the scene (1 = as is). */
  unlitEffects: number;
  /** A little self-light on characters so players stay readable in the dark. */
  characterGlow: number;
}

/** Bright afternoon: high sun, blue sky, lamps off. */
export const DAY: LightingPreset = {
  sky: { top: 0x2f6fc4, mid: 0x6fa6e0, horizon: 0xc4d6e6 },
  cityGlow: 0xe9dcc6,
  cityGlowAmount: 0.35,
  stars: 0,

  sun: { color: 0xfff1dc, intensity: 2.6, dir: [-0.45, 0.78, 0.43], body: 'sun' },
  ambient: { sky: 0xc4d9f4, ground: 0x7d7262, intensity: 1.65 },
  exposure: 1.0,

  street: { color: 0xffb867, intensity: 0, distance: 22, angle: 1.22 },
  interior: { color: 0xeef3ff, intensity: 30, distance: 13, angle: 1.5 },
  shop: { color: 0xffdcaa, intensity: 0, distance: 13, angle: 1.35 },
  budget: {
    high: { lights: 4, fade: 30 },
    medium: { lights: 3, fade: 26 },
    low: { lights: 2, fade: 20 },
    performance: { lights: 0, fade: 1 },
  },
  lampHead: 0xb9b8b0,
  coneOpacity: 0,
  poolOpacity: 0,
  litWindows: 0,
  windowGlass: 0x4a6078,
  skylineWindows: 0,

  unlitEffects: 1,
  characterGlow: 0.015,
};

/** After dark: grey moonlight, sodium street lamps (plenty of them), lit windows. */
export const NIGHT: LightingPreset = {
  sky: { top: 0x03050b, mid: 0x111829, horizon: 0x2a2a36 },
  cityGlow: 0x5c4434,
  cityGlowAmount: 0.85,
  stars: 650,

  // a greyish moonlight, bright enough to see by between the lamps (still clearly night)
  sun: { color: 0xc3c7cf, intensity: 1.05, dir: [-0.55, 0.62, 0.56], body: 'moon' },
  ambient: { sky: 0x6e7584, ground: 0x3d3a37, intensity: 1.4 },
  exposure: 1.1,

  street: { color: 0xffb867, intensity: 90, distance: 22, angle: 1.22 },
  interior: { color: 0xe4ecff, intensity: 60, distance: 15, angle: 1.5 },
  shop: { color: 0xffdcaa, intensity: 38, distance: 13, angle: 1.35 },
  budget: {
    high: { lights: 10, fade: 44 },
    medium: { lights: 7, fade: 34 },
    low: { lights: 4, fade: 26 },
    performance: { lights: 3, fade: 22 },
  },
  lampHead: 0xffe2a8,
  coneOpacity: 0.085,
  poolOpacity: 0.42,
  litWindows: 0.3,
  windowGlass: 0x1c2530,
  skylineWindows: 0.55,

  unlitEffects: 0.3,
  characterGlow: 0.07,
};

/** Which preset the game uses outside JUMP OFF THE PORCH's day/night cycle. */
export const TIME_OF_DAY: 'day' | 'night' = 'day';

/** The base preset (what the world is built for, and what the menus and classic modes show). */
export const LIGHTING: LightingPreset = TIME_OF_DAY === 'day' ? DAY : NIGHT;
/** How dark the base preset is (0 day, 1 night). */
export const BASE_NIGHT = TIME_OF_DAY === 'day' ? 0 : 1;

// ---------------------------------------------------------------- the live lighting
const clonePreset = (p: LightingPreset): LightingPreset => ({
  ...p,
  sky: { ...p.sky },
  sun: { ...p.sun, dir: [...p.sun.dir] as [number, number, number] },
  ambient: { ...p.ambient },
  street: { ...p.street },
  interior: { ...p.interior },
  shop: { ...p.shop },
  budget: { ...p.budget },
});

/**
 * The lighting right now: DAY blended toward NIGHT by `night` (0..1). The renderer reads it
 * every frame; the world's sky, lamps and windows follow it through `setNight`.
 */
export const live: LightingPreset & { night: number } = Object.assign(clonePreset(LIGHTING), { night: BASE_NIGHT });

/**
 * Uniforms shared by every material that changes with the time of day (one object each, so
 * setting `.value` reaches them all without recompiling anything).
 */
export const lightUniforms = {
  /** 0 day .. 1 night: night windows and lamp heads glow by this much. */
  night: { value: BASE_NIGHT },
  /** The self-light on characters (more at night so players stay readable). */
  charGlow: { value: LIGHTING.characterGlow },
};

const _a = new Color(), _b = new Color();
const mixHex = (a: number, b: number, k: number): number => _a.setHex(a).lerp(_b.setHex(b), k).getHex();
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Blends DAY toward NIGHT into `live` and the shared uniforms. Cheap; call it when `night` changes. */
export function setNight(k: number): void {
  k = Math.max(0, Math.min(1, k));
  live.night = k;
  const d = DAY, n = NIGHT, o = live;
  o.sky.top = mixHex(d.sky.top, n.sky.top, k);
  o.sky.mid = mixHex(d.sky.mid, n.sky.mid, k);
  o.sky.horizon = mixHex(d.sky.horizon, n.sky.horizon, k);
  o.cityGlow = mixHex(d.cityGlow, n.cityGlow, k);
  o.cityGlowAmount = mix(d.cityGlowAmount, n.cityGlowAmount, k);
  o.stars = n.stars;
  // the sun goes down and the (dimmer, bluer) moon takes over as the shadow caster
  o.sun.color = mixHex(d.sun.color, n.sun.color, k);
  o.sun.intensity = mix(d.sun.intensity, n.sun.intensity, k);
  const dx = mix(d.sun.dir[0], n.sun.dir[0], k), dy = mix(d.sun.dir[1], n.sun.dir[1], k), dz = mix(d.sun.dir[2], n.sun.dir[2], k);
  const len = Math.hypot(dx, dy, dz) || 1;
  o.sun.dir = [dx / len, dy / len, dz / len];
  o.sun.body = k < 0.5 ? 'sun' : 'moon';
  o.ambient.sky = mixHex(d.ambient.sky, n.ambient.sky, k);
  o.ambient.ground = mixHex(d.ambient.ground, n.ambient.ground, k);
  o.ambient.intensity = mix(d.ambient.intensity, n.ambient.intensity, k);
  o.exposure = mix(d.exposure, n.exposure, k);
  for (const kind of ['street', 'interior', 'shop'] as const) {
    o[kind].color = mixHex(d[kind].color, n[kind].color, k);
    // lamps come on as it gets dark (and are fully on a little before full night)
    o[kind].intensity = mix(d[kind].intensity, n[kind].intensity, Math.min(1, k * 1.25));
    o[kind].distance = mix(d[kind].distance, n[kind].distance, k);
  }
  o.lampHead = mixHex(d.lampHead, n.lampHead, k);
  o.coneOpacity = n.coneOpacity * k;
  o.poolOpacity = n.poolOpacity * k;
  o.litWindows = n.litWindows;
  o.windowGlass = mixHex(d.windowGlass, n.windowGlass, k);
  o.skylineWindows = n.skylineWindows * k;
  o.unlitEffects = mix(d.unlitEffects, n.unlitEffects, k);
  o.characterGlow = mix(d.characterGlow, n.characterGlow, k);
  lightUniforms.night.value = k;
  lightUniforms.charGlow.value = o.characterGlow;
}
setNight(BASE_NIGHT);
