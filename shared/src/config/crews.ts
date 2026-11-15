/**
 * CREW CONFIG — edit this file to rename crews, recolor them, or swap logos.
 *
 * Everything in the game (HUD, lobby, minimap, spawn banners, player outfits,
 * capture zones) reads crew identity from here. Team 0 always spawns on the
 * west side of the map, team 1 on the east side.
 *
 * Logos are plain inline SVG strings drawn on a 64x64 canvas. Use the tokens
 * {color}, {dark} and {light} to pick up the crew palette automatically.
 */

export type TeamId = 0 | 1;

export interface CrewConfig {
  id: TeamId;
  /** Stable machine key (used for CSS classes / save data). */
  key: string;
  /** Display name. */
  name: string;
  /** 2-3 letter tag for tight HUD spots. */
  tag: string;
  /** One-liner shown in the lobby. */
  motto: string;
  /** Main crew color (CSS hex). */
  color: string;
  /** Darker shade for backgrounds / outlines. */
  dark: string;
  /** Lighter shade for highlights / text on dark. */
  light: string;
  /** Inline SVG markup (64x64 viewBox). */
  logoSvg: string;
}

export const CREWS: readonly [CrewConfig, CrewConfig] = [
  {
    id: 0,
    key: 'scurve',
    name: 'S-Curve',
    tag: 'SC',
    motto: 'Hold the bend.',
    color: '#2f7dff',
    dark: '#0f2f73',
    light: '#9cc4ff',
    // A road bending into an "S" with a dashed center line.
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="{dark}" stroke="{color}" stroke-width="3"/>
  <path d="M46 14 C22 10 16 28 32 32 C48 36 42 54 18 50" fill="none" stroke="{color}" stroke-width="11" stroke-linecap="round"/>
  <path d="M46 14 C22 10 16 28 32 32 C48 36 42 54 18 50" fill="none" stroke="{light}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5"/>
</svg>`,
  },
  {
    id: 1,
    key: 'crosstrack',
    name: 'Cross Track',
    tag: 'CT',
    motto: 'Nothing crosses us.',
    color: '#ff3b3b',
    dark: '#6e1010',
    light: '#ffa3a3',
    // A railroad crossbuck over a pair of rails.
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="{dark}" stroke="{color}" stroke-width="3"/>
  <path d="M10 44 H54 M10 52 H54" stroke="{light}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M16 41 V55 M26 41 V55 M38 41 V55 M48 41 V55" stroke="{light}" stroke-width="2" opacity="0.6"/>
  <path d="M15 12 L49 38 M49 12 L15 38" stroke="{color}" stroke-width="9" stroke-linecap="round"/>
  <path d="M15 12 L49 38 M49 12 L15 38" stroke="{light}" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
  },
];

/** Returns the crew logo SVG with palette tokens filled in. */
export function crewLogoSvg(team: TeamId): string {
  const c = CREWS[team];
  return c.logoSvg
    .replace(/\{color\}/g, c.color)
    .replace(/\{dark\}/g, c.dark)
    .replace(/\{light\}/g, c.light);
}

/** Crew color as a 0xRRGGBB number (for Three.js materials). */
export function crewColorHex(team: TeamId, shade: 'color' | 'dark' | 'light' = 'color'): number {
  return parseInt(CREWS[team][shade].slice(1), 16);
}

export function otherTeam(team: TeamId): TeamId {
  return team === 0 ? 1 : 0;
}
