import type { TeamId } from '../config/crews';

/**
 * How a solid participates in collision:
 *  - 'solid': blocks movement, bullets, grenades and the camera
 *  - 'fence': blocks movement and grenades, but bullets and the camera pass (chain-link, railings, glass)
 *  - 'none' : purely visual
 */
export type CollisionKind = 'solid' | 'fence' | 'none';

/**
 * An oriented box. The whole map (collision and greybox visuals) is made of these.
 * Rotation order is heading (ry, about world Y) applied after tilt (rx, about local X),
 * i.e. q = qY(ry) * qX(rx) — the same as THREE.Euler order 'YXZ'.
 */
export interface Solid {
  /** Semantic tag the client uses to pick materials / meshes. */
  kind: string;
  /** Center. */
  x: number;
  y: number;
  z: number;
  /** Full sizes. */
  sx: number;
  sy: number;
  sz: number;
  ry?: number;
  rx?: number;
  col?: CollisionKind;
  /** Visual style hint (facade type, etc). */
  style?: string;
  /** Override color 0xRRGGBB. */
  color?: number;
  /** Groups solids that belong to one structure (for signage, roofs...). */
  group?: string;
  /** Index into MapDef.props when this solid is the collision shape of a prop. */
  prop?: number;
  /** Extra per-kind data for visuals (e.g. stairs step count, which faces are exterior). */
  meta?: Record<string, number | string | boolean>;
}

export type PropType =
  | 'car' | 'van' | 'truck'
  | 'boxcar' | 'boxcar_open' | 'flatcar' | 'container'
  | 'dumpster' | 'barrier' | 'crate' | 'crate_big' | 'tires'
  | 'tree' | 'lamp' | 'bench' | 'hoop' | 'hydrant' | 'busstop'
  | 'acunit' | 'signal' | 'buffer' | 'shelf' | 'trashcan' | 'cone' | 'pallet' | 'banner'
  // the outer districts (JUMP OFF THE PORCH)
  | 'palm' | 'bush' | 'rock' | 'boulder' | 'log' | 'umbrella' | 'boat';

export interface Prop {
  type: PropType;
  x: number;
  y: number;
  z: number;
  /** Heading: local +Z (the prop's length axis) is rotated toward (sin ry, 0, cos ry). */
  ry: number;
  /** Picks a color / model variation. */
  variant: number;
  /** Team association (banners). */
  team?: TeamId;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ZoneDef {
  /** 'A' | 'B' | 'C' */
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

/** Visual-only ground patch (asphalt, grass, court...). */
export interface AreaDef {
  kind: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Draw order / tiny height offset layer. */
  layer?: number;
  color?: number;
}

/** Visual-only road strip following a polyline. */
export interface RoadDef {
  /** 'trail' = a dirt path, 'creek' = shallow water you can wade through (both visual only). */
  kind: 'road' | 'rail' | 'trail' | 'creek';
  points: Array<{ x: number; z: number }>;
  width: number;
  /** Draw dashed center line. */
  centerLine?: boolean;
}

/** Text painted on a wall or sign board. */
export interface SignDef {
  text: string;
  x: number;
  y: number;
  z: number;
  /** Facing direction (yaw of the outward normal: 0 faces -Z, like the player convention). */
  yaw: number;
  width: number;
  height: number;
  style: 'store' | 'graffiti' | 'street' | 'plain';
  color?: string;
  bg?: string;
  team?: TeamId;
}

/** Door leaf look and sound. */
export type DoorKind = 'wood' | 'metal' | 'glass' | 'apartment';

/**
 * A working door. The leaf hangs from its hinge at (x, y, z) and, closed, runs `w` meters in
 * direction `a` (radians about Y: (sin a, 0, cos a)). It opens away from whoever opens it.
 * `inside` says which side of the leaf is the inside (+1: the side its normal (cos a, 0, -sin a)
 * points to): a lockable door is locked and unlocked from there.
 */
export interface DoorDef {
  x: number;
  y: number;
  z: number;
  a: number;
  w: number;
  h: number;
  kind: DoorKind;
  lockable?: boolean;
  /** Starts locked. */
  locked?: boolean;
  inside?: 1 | -1;
}

/** 'slide' = a sash window (the lower half slides up), 'hinge' = a casement, 'fixed' = shop glass. */
export type WindowKind = 'slide' | 'hinge' | 'fixed';

/**
 * A working window: an opening `w` wide and `h` tall, its sill at (x, y, z), running in
 * direction `a` like a door. Closed or intact, its glass blocks movement (not bullets); open or
 * broken, people can climb through it if the sill is low enough.
 */
export interface WindowDef {
  x: number;
  y: number;
  z: number;
  a: number;
  w: number;
  h: number;
  kind: WindowKind;
  breakable: boolean;
  /** Which side of the wall is outside (+1 the normal side (cos a, 0, -sin a), -1 the other). */
  out?: 1 | -1;
}

export interface LabelDef {
  text: string;
  x: number;
  z: number;
}

export interface MapDef {
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  solids: Solid[];
  props: Prop[];
  /** spawns[team] */
  spawns: [SpawnPoint[], SpawnPoint[]];
  zones: ZoneDef[];
  areas: AreaDef[];
  roads: RoadDef[];
  signs: SignDef[];
  labels: LabelDef[];
  /** Points of interest bots wander between. */
  hotspots: Array<{ x: number; z: number }>;
  /** Good places for loot (inside shops, houses, up on roofs). JUMP OFF THE PORCH puts bookbags here first. */
  lootSpots?: Array<{ x: number; y: number; z: number }>;
  /** Big area names shown floating over the map while people are in the air (to call landings). */
  districts?: Array<{ name: string; x: number; z: number }>;
  /** Working doors and windows (the buildings you can walk into). */
  doors?: DoorDef[];
  windows?: WindowDef[];
  /** JUMP OFF THE PORCH: where everyone warms up before the match (shooting around while players join). */
  warmup?: { x0: number; x1: number; z0: number; z1: number };
  /** What lies beyond each edge, for the backdrop. Unset sides get a hazy skyline. */
  backdrop?: Partial<Record<'n' | 's' | 'e' | 'w', 'city' | 'hills' | 'ocean' | 'desert'>>;
}

/** Quaternion (x,y,z,w) for a solid's orientation. */
export function solidQuat(s: { ry?: number; rx?: number }): { x: number; y: number; z: number; w: number } {
  const ry = s.ry ?? 0;
  const rx = s.rx ?? 0;
  const sy = Math.sin(ry / 2), cy = Math.cos(ry / 2);
  const sx = Math.sin(rx / 2), cx = Math.cos(rx / 2);
  return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}
