/**
 * LIGHTING — the look of the town. Two presets live here: DAY (the default) and NIGHT.
 * Switch with TIME_OF_DAY below, or tweak a preset: how bright the streets are (ambient +
 * sun / moon), the street lights, the windows and the sky. Colors are 0xRRGGBB,
 * intensities are three.js light units.
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

/** After dark: moonlight, sodium street lamps, lit windows. */
export const NIGHT: LightingPreset = {
  sky: { top: 0x03050b, mid: 0x111829, horizon: 0x2a2a36 },
  cityGlow: 0x5c4434,
  cityGlowAmount: 0.85,
  stars: 650,

  sun: { color: 0xa9bcf2, intensity: 0.5, dir: [-0.55, 0.62, 0.56], body: 'moon' },
  ambient: { sky: 0x526696, ground: 0x2e2722, intensity: 0.95 },
  exposure: 1.05,

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

/** Which preset the game uses. */
export const TIME_OF_DAY: 'day' | 'night' = 'day';

export const LIGHTING: LightingPreset = TIME_OF_DAY === 'day' ? DAY : NIGHT;
