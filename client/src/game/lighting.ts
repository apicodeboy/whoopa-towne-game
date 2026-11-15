/**
 * NIGHT LIGHTING — the look of the town after dark. Tweak here:
 * how dark the streets are (ambient + moon), how strong and far-reaching the street lights
 * are, and the sky. Colors are 0xRRGGBB, intensities are three.js light units.
 */
export const LIGHTING = {
  /** Sky dome gradient (zenith -> horizon). The horizon also tints the fog, so far buildings melt into it. */
  sky: { top: 0x03050b, mid: 0x111829, horizon: 0x2a2a36 },
  /** Orange haze of the city lights low in the sky (also makes the skyline stand out against it). */
  cityGlow: 0x5c4434,
  stars: 650,

  /** Moonlight: the only light that casts shadows. Direction is where the moon hangs in the sky. */
  moon: { color: 0xa9bcf2, intensity: 0.5, dir: [-0.55, 0.62, 0.56] as const },
  /** Ambient sky / ground bounce. This decides how dark the streets are between the lamps. */
  ambient: { sky: 0x526696, ground: 0x2e2722, intensity: 0.95 },
  exposure: 1.05,

  /*
   * The light sources below shine downward in a wide cone (like real street lamps and ceiling
   * fixtures), so they never light the underside of whatever hangs above them. `angle` is the
   * half-angle of that cone in radians (1.57 = a full half-sphere).
   */
  /** Street lamps: warm sodium light. */
  street: { color: 0xffb867, intensity: 90, distance: 22, angle: 1.22 },
  /** Lights inside the enterable shops and the warehouse (wide, so walls and cover get lit too). */
  interior: { color: 0xe4ecff, intensity: 60, distance: 15, angle: 1.5 },
  /** Lights under the shop awnings, over the sidewalk. */
  shop: { color: 0xffdcaa, intensity: 38, distance: 13, angle: 1.35 },
  /**
   * How many lamps light the world at once (the nearest ones to where you are looking) and
   * how far away they fade out. Every other lamp still shows its glowing head and light pool.
   */
  budget: {
    high: { lights: 10, fade: 44 },
    medium: { lights: 7, fade: 34 },
    low: { lights: 4, fade: 26 },
    performance: { lights: 3, fade: 22 },
  },
  /** Soft cone of light under each street lamp (0 = off). */
  coneOpacity: 0.085,
  /** Light pool painted on the ground under every lamp (visible at any distance). */
  poolOpacity: 0.42,
  /** Share of windows with the lights on. */
  litWindows: 0.3,
  /** Brightness of the lit windows in the distant skyline. */
  skylineWindows: 0.55,

  /** Smoke and dust do not react to lights, so they are dimmed to sit in the dark. */
  unlitEffects: 0.3,
  /** A little self-light on characters so players stay readable in the dark. */
  characterGlow: 0.07,
};
