import * as THREE from 'three';
import { CREWS, crewColorHex, crewLogoSvg, type TeamId } from '@shared/config/crews';
import { PROP_BOXES, PROP_SIZES } from '@shared/map/props';
import type { MapDef, Prop, Solid } from '@shared/map/types';
import type { ScoreGame, ScoresMsg } from '@shared/protocol';
import { solidQuat } from '@shared/map/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { StaticModelBatch, type Assets } from '../assets';
import { LIGHTING } from '../lighting';
import { BoxBatch, type BoxOptions } from './boxBatch';
import { GeoBatch, trs } from './geoBatch';
import { SignAtlas } from './signAtlas';
import { glowTexture, makeSignCanvas, makeTextures, svgTexture } from './textures';

/** A capture-zone marker in the world. */
export interface ZoneMarker {
  group: THREE.Group;
  setColor(hex: number, strength: number): void;
}

/** Where a light source hangs (street lamp head, shop ceiling light). The renderer lights the nearest ones. */
export interface LightSpot {
  x: number;
  y: number;
  z: number;
  kind: 'street' | 'interior' | 'shop';
}

export interface WorldVisual {
  group: THREE.Group;
  zones: ZoneMarker[];
  lights: LightSpot[];
  /** True when this map has live scoreboard billboards (so the scores are worth fetching). */
  scoreboards: boolean;
  /** Live scores for the scoreboard billboards (null = the feed cannot be reached). */
  setScores(msg: ScoresMsg | null): void;
  /** `camera` lets the sky follow the viewer. */
  update(dt: number, time: number, camera?: THREE.Vector3): void;
  dispose(): void;
}

/** Billboard ads for the local spots: [title, line under it, background top, bottom, title color]. */
const ADS: Record<string, [string, string, string, string, string]> = {
  ajs: ["AJ'S", 'FRESH FITS · PORCH ST', '#17120a', '#4a3210', '#f6b73c'],
  mart: ['TOWNE FOOD MART', 'COLD DRINKS · OPEN LATE', '#8c1414', '#c2261e', '#ffe14d'],
  suds: ['SUDS LAUNDRY', '24 HOURS · THE HILL', '#123a52', '#2a6f97', '#ffffff'],
  tower: ['WHOOPA TOWER', 'OFFICES NOW LEASING', '#0f1a26', '#2b4560', '#dfeaf5'],
  dimsum: ['茶樓 DIM SUM PALACE', 'HONG KONG · LANTERN ST', '#5c0d0d', '#a11a1a', '#ffd977'],
  lake: ['LAKE LINDA', 'SUN · SAND · TIKI BAR', '#0e5a7a', '#39a9c9', '#fff3c4'],
  jotp: ['JUMP OFF THE PORCH', 'LAST SQUAD STANDING', '#1a1206', '#f0a020', '#ffffff'],
  grams: ['GRAMS', "GET YOURS AT AJ'S", '#101012', '#2a2a30', '#ffd23f'],
  shack: ['SHRIMP SHACK', 'ON THE BOARDWALK', '#0f4f55', '#1e7f86', '#ffffff'],
  kicks: ['KICKS', 'DOWNTOWN · NEW DROPS', '#3a0f0f', '#7a1f1f', '#ffffff'],
  wings: ['WINGS & THINGS', 'OCEAN DRIVE · 2 FLOORS', '#7a1410', '#d9451e', '#ffe14d'],
  ibu: ['IBUPROFEN', 'TAKE THE EDGE OFF · +25 ARMOR', '#c25a08', '#ff8a1f', '#ffffff'],
  hk: ['唐人街 HONG KONG', 'NIGHT MARKET · EVERY NIGHT', '#24101a', '#5c1438', '#3ff0ff'],
  docks: ['PIER 9', 'WAREHOUSE SPACE · THE DOCKS', '#1c2a36', '#3d5a70', '#ffd23f'],
};

/** A billboard ad, painted. */
function adCanvas(key: string): HTMLCanvasElement {
  const [title, sub, c0, c1, tc] = ADS[key] ?? ADS.jotp;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, c0);
  grad.addColorStop(1, c1);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  // a slash of the title color across the corner
  g.fillStyle = tc;
  g.globalAlpha = 0.16;
  g.beginPath();
  g.moveTo(330, 0); g.lineTo(512, 0); g.lineTo(512, 256); g.lineTo(420, 256);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 92;
  g.font = `900 ${size}px Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif`;
  const w = g.measureText(title).width;
  if (w > 460) {
    size = Math.floor((size * 460) / w);
    g.font = `900 ${size}px Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif`;
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillText(title, 259, 107);
  g.fillStyle = tc;
  g.fillText(title, 256, 104);
  g.font = '700 26px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText(sub, 256, 186);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 6;
  g.strokeRect(9, 9, 494, 238);
  return c;
}

// ------------------------------------------------------------------ palettes
/** Wall look per building style: which texture batch and what tint. */
const STYLES: Record<string, { tex: string; color: number; tile: number }> = {
  brick: { tex: 'brick', color: 0xb0694f, tile: 2.4 },
  brickdark: { tex: 'brick', color: 0x7d5a4b, tile: 2.4 },
  apartment: { tex: 'brick', color: 0xb59a84, tile: 2.4 },
  liquor: { tex: 'brick', color: 0xb0564b, tile: 2.4 },
  office: { tex: 'brick', color: 0x8497ab, tile: 2.4 },
  stucco: { tex: 'stucco', color: 0xd8c7a6, tile: 3 },
  store: { tex: 'stucco', color: 0xe3d2ac, tile: 3 },
  siding: { tex: 'siding', color: 0x9fb2c4, tile: 1.6 },
  metal: { tex: 'metal', color: 0x8f9aa3, tile: 2.2 },
  concrete: { tex: 'concrete', color: 0xc4c4be, tile: 4 },
  wood: { tex: 'wood', color: 0x9a7a55, tile: 1.4 },
  glass: { tex: 'metal', color: 0x6f8fa8, tile: 3 },
  ruin: { tex: 'concrete', color: 0x9b9a86, tile: 2 },
  // BABYLON
  mudbrick: { tex: 'stucco', color: 0xc49a6c, tile: 3 },
  sandstone: { tex: 'concrete', color: 0xc9a46b, tile: 3 },
  // inside walls of the explorable buildings
  plaster: { tex: 'smooth', color: 0xe9e2d6, tile: 3 },
};
/** Building interiors are drawn within this distance of the camera (meters). */
const INTERIOR_RANGE = 70;
const FACADES = ['brickdark', 'brick', 'apartment', 'stucco', 'concrete', 'metal', 'brickdark', 'brick'];
const CAR_COLORS = [0xb33a3a, 0x2f5f9e, 0xd9d9d9, 0x26282c, 0x3d7a4a, 0xc9a227, 0x7a4fa3, 0x8a8a8a];
const BOXCAR_COLORS = [0x9a4a38, 0x4f6e48, 0x44607e];
const CONTAINER_COLORS = [0x2a7f9b, 0xc1532a, 0x3d7a5a, 0xd9b45a];
const GRAFFITI = ['WT', 'KILO', 'ROOK 1', 'S-CRV', 'X-TRK', 'DICE', 'NO LUV', 'EAST', '2 REAL', 'TOWNE'];
const GRAFFITI_COLORS = ['#ff4fa3', '#4fd1ff', '#ffe14d', '#7dff6b', '#ff8a3d', '#c59bff'];
const AREA_STYLE: Record<string, { tex: string; color: number; tile: number }> = {
  grass: { tex: 'grass', color: 0xffffff, tile: 5 },
  path: { tex: 'gravel', color: 0xe6d6b8, tile: 3 },
  sidewalk: { tex: 'sidewalk', color: 0xffffff, tile: 4 },
  alley: { tex: 'asphalt', color: 0xcfcfd4, tile: 6 },
  lot: { tex: 'asphalt', color: 0xe6e6ea, tile: 6 },
  court: { tex: 'paint', color: 0xb5623f, tile: 4 },
  gravel: { tex: 'gravel', color: 0xffffff, tile: 3 },
  crossing: { tex: 'wood', color: 0x7b6a55, tile: 1.2 },
  floor: { tex: 'concrete', color: 0x9c9488, tile: 3 },
  base0: { tex: 'asphalt', color: 0xffffff, tile: 6 },
  base1: { tex: 'asphalt', color: 0xffffff, tile: 6 },
  // the outer districts
  jungle: { tex: 'grass', color: 0x86a873, tile: 5 },
  dirt: { tex: 'gravel', color: 0xa88a64, tile: 3 },
  sand: { tex: 'gravel', color: 0xf0dfb4, tile: 5 },
  desert: { tex: 'gravel', color: 0xe3c58f, tile: 6 },
  oasis: { tex: 'water', color: 0x2fa3b5, tile: 1 },
  surf: { tex: 'water', color: 0xd8f1f2, tile: 1 },
  ocean: { tex: 'water', color: 0x2a86b0, tile: 1 },
  plaza: { tex: 'concrete', color: 0xd9d6cf, tile: 3 },
  towel: { tex: 'paint', color: 0xffffff, tile: 1 },
  // floors inside the explorable buildings
  floor_wood: { tex: 'wood', color: 0xb58d62, tile: 1.6 },
  floor_tile: { tex: 'concrete', color: 0xe6e1d6, tile: 0.9 },
  floor_carpet: { tex: 'paint', color: 0x7d8a99, tile: 1 },
  floor_concrete: { tex: 'concrete', color: 0xa9a7a2, tile: 3 },
  // THE HILL: standing water in the yards
  puddle: { tex: 'water', color: 0x4d524c, tile: 1 },
  concrete: { tex: 'concrete', color: 0xb8b0a2, tile: 3 },
};

/** Deterministic pseudo-random in [0,1) from an integer (same world every load). */
function hash(n: number): number {
  let t = (n * 374761393 + 668265263) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const _gp = new THREE.Vector3();

function shade(hex: number, k: number): number {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}

function makeLabelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 96px Impact, Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 64, 68);
  g.fillStyle = '#ffffff';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 20;
  return s;
}

/**
 * Builds the visible world from the shared map definition: textured buildings with windows
 * and roofs, streets with markings, rail lines and rolling stock, street furniture, signage,
 * crew banners, a hazy skyline and capture-zone markers. Collision lives in the shared
 * PhysicsWorld; this is purely what the player sees. `assets` (optional) supplies CC0 models
 * for vehicles and small props; anything missing is drawn procedurally instead.
 */
export function buildWorld(map: MapDef, assets: Assets | null = null): WorldVisual {
  const group = new THREE.Group();
  group.name = 'world';
  const disposables: Array<{ dispose(): void }> = [];
  const tex = makeTextures();
  disposables.push(tex);

  // ---- batches: one merged mesh per material ----
  const boxes: Record<string, BoxBatch> = {};
  /**
   * Inside the explorable buildings (furniture, floors, inside walls, lights) things are batched
   * per chunk of the map and only drawn near the camera. While `inChunk` is set, box() and geo()
   * add to that chunk's batches.
   */
  const CHUNK = 48;
  let inChunk: string | null = null;
  const chunkOf = (x: number, z: number): string => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const box = (key: string): BoxBatch => (boxes[inChunk ? `${key}@${inChunk}` : key] ??= new BoxBatch());
  const geos: Record<string, GeoBatch> = {};
  const geo = (key: string): GeoBatch => (geos[inChunk ? `${key}@${inChunk}` : key] ??= new GeoBatch());
  /** Placed CC0 models (cars, dumpsters...), baked into a few merged meshes. */
  const models = new StaticModelBatch();
  /** Every sign and graffiti tag shares one texture atlas. */
  const signs = new SignAtlas();
  /** Street-lamp light pools on the ground (merged into one mesh). */
  const glows: THREE.BufferGeometry[] = [];
  /** Soft cones of light under the lamps (merged into one mesh). */
  const cones: THREE.BufferGeometry[] = [];
  const lights: LightSpot[] = [];
  const extras: THREE.Object3D[] = [];
  /** Corners of the live scoreboard screens (two triangles each). */
  const liveQuads: number[] = [];

  const b = map.bounds;
  const yawQ = (ry: number) => solidQuat({ ry });
  /** Adds a box in a prop's local space (x = width, y = up from its base, z = length). */
  const part = (
    p: Prop, key: string, lx: number, y0: number, lz: number, sx: number, sy: number, sz: number, color: number, opts: BoxOptions = {},
  ): void => {
    const s = Math.sin(p.ry), c = Math.cos(p.ry);
    box(key).add(
      { x: p.x + lz * s + lx * c, y: p.y + y0 + sy / 2, z: p.z + lz * c - lx * s, sx, sy, sz, q: yawQ(p.ry) },
      { color, ...opts },
    );
  };
  const partPos = (p: Prop, lx: number, ly: number, lz: number): [number, number, number] => {
    const s = Math.sin(p.ry), c = Math.cos(p.ry);
    return [p.x + lz * s + lx * c, p.y + ly, p.z + lz * c - lx * s];
  };

  // ================================================================== ground, areas, roads
  box('asphalt').addQuad(b.minX - 8, b.minZ - 8, b.maxX + 8, b.maxZ + 8, 0, { tile: 6 });
  for (const a of [...map.areas].sort((p, q) => (p.layer ?? 1) - (q.layer ?? 1))) {
    const st = AREA_STYLE[a.kind] ?? { tex: 'paint', color: 0x555555, tile: 4 };
    const y = 0.008 * (a.layer ?? 1);
    let color = a.color ?? st.color;
    if (a.kind === 'base0' || a.kind === 'base1') {
      const team: TeamId = a.kind === 'base0' ? 0 : 1;
      color = new THREE.Color(crewColorHex(team)).lerp(new THREE.Color(0xffffff), 0.72).getHex();
      // painted border in crew colors
      const c2 = crewColorHex(team);
      const t = 0.35;
      box('paint').addQuad(a.x0, a.z0, a.x1, a.z0 + t, y + 0.004, { color: c2 });
      box('paint').addQuad(a.x0, a.z1 - t, a.x1, a.z1, y + 0.004, { color: c2 });
    }
    box(`ground:${st.tex}`).addQuad(a.x0, a.z0, a.x1, a.z1, y, { color, tile: st.tile });
    if (a.kind === 'court') paintCourt(a.x0, a.x1, a.z0, a.z1, y + 0.006);
    if (a.kind === 'lot') paintParking(a.x0, a.x1, a.z0, a.z1, y + 0.006);
  }

  for (const r of map.roads) {
    if (r.kind === 'road') {
      box('ground:road').addStrip(r.points, r.width, 0.012, { tile: 5 });
      // solid edge lines + dashed center line
      for (const side of [-1, 1]) {
        const pts = offsetLine(r.points, side * (r.width / 2 - 0.3));
        box('paint').addStrip(pts, 0.12, 0.02, { color: 0xc8c8c0 });
      }
      if (r.centerLine) dashed(r.points, 2.4, 2.4, 0.15, 0xd6b84a, 0.021);
    } else if (r.kind === 'trail') {
      box('ground:gravel').addStrip(r.points, r.width, 0.014, { color: 0x9a7b55, tile: 3 });
    } else if (r.kind === 'creek') {
      box('ground:gravel').addStrip(r.points, r.width + 1.6, 0.013, { color: 0x8a7a5e, tile: 2 });
      box('ground:water').addStrip(r.points, r.width, 0.017, { color: 0x3f8a9a });
    } else {
      box('ground:gravel').addStrip(r.points, r.width + 0.5, 0.014, { color: 0xb9b0a2, tile: 2.5 });
      const p0 = r.points[0], p1 = r.points[r.points.length - 1];
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const dx = (p1.x - p0.x) / len, dz = (p1.z - p0.z) / len;
      const q = yawQ(Math.atan2(dx, dz));
      for (let d = 0.4; d < len; d += 0.7) {
        box('wood').add({ x: p0.x + dx * d, y: 0.06, z: p0.z + dz * d, sx: 2.5, sy: 0.12, sz: 0.24, q }, { color: 0x5a4634, skipBottom: true, tile: 1 });
      }
      for (const side of [-1, 1]) {
        box('flat').add(
          { x: (p0.x + p1.x) / 2 + dz * 0.75 * side, y: 0.18, z: (p0.z + p1.z) / 2 - dx * 0.75 * side, sx: 0.08, sy: 0.14, sz: len, q },
          { color: 0x9aa1a8, skipBottom: true },
        );
      }
    }
  }
  if (map.id === 'whoopa-towne' || map.id === 'greater-towne') paintStreetMarkings();

  // ================================================================== solids
  let solidIndex = 0;
  let trashBagGeo: THREE.IcosahedronGeometry | null = null;
  for (const s of map.solids) {
    solidIndex++;
    if (s.kind === 'ground' || s.kind === 'perimeter' || s.kind === 'bound') continue;
    if (s.prop !== undefined) continue; // props are painted below
    const spec = { x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz, q: solidQuat(s) };
    const onGround = !s.rx && s.y - s.sy / 2 <= 0.02;
    inChunk = s.meta?.int ? chunkOf(s.x, s.z) : null;
    switch (s.kind) {
      case 'attic':
        break; // collision only
      // ---- THE HILL's trash ----
      case 'litter':
        if (s.sy < 0.02) box('paint').add(spec, { color: s.color ?? 0xd9d2bf });
        else box('flat').add(spec, { color: s.color ?? 0xc23a2a });
        break;
      case 'trashbag': {
        trashBagGeo ??= new THREE.IcosahedronGeometry(0.5, 1);
        geo('faceted').add(trashBagGeo, trs(s.x, s.y, s.z, s.ry ?? 0, s.sx, s.sy, s.sz), s.color ?? 0x1b1c1e);
        // the knot on top
        geo('faceted').add(trashBagGeo, trs(s.x, s.y + s.sy * 0.46, s.z, s.ry ?? 0, s.sx * 0.22, s.sy * 0.3, s.sz * 0.22), shade(s.color ?? 0x1b1c1e, 1.25));
        break;
      }
      case 'mattress':
        box('smooth').add(spec, { color: 0xb9ad94 });
        // stains
        box('paint').add({ ...spec, y: s.y + s.sy / 2 + 0.004, sx: s.sx * 0.45, sy: 0.004, sz: s.sz * 0.3, x: s.x + 0.1 }, { color: 0x7d6a4a });
        box('paint').add({ ...spec, y: s.y + s.sy / 2 + 0.005, sx: s.sx * 0.3, sy: 0.004, sz: s.sz * 0.2, z: s.z - 0.25 }, { color: 0x5f5340 });
        break;
      case 'cart': {
        // a shopping cart on its side
        box('bars').add({ ...spec, y: s.y - 0.05, sy: s.sy - 0.1 }, { tile: 0.25, color: 0x8d949b });
        box('flat').add({ ...spec, y: s.y - s.sy / 2 + 0.03, sy: 0.05 }, { color: 0x6d747b });
        box('flat').add({ ...spec, y: s.y + s.sy / 2 - 0.02, sx: s.sx + 0.04, sy: 0.04, sz: 0.06, z: s.z }, { color: 0xb3261e });
        break;
      }
      case 'burntcar': {
        // a stripped, burnt-out car up on blocks
        const q = spec.q;
        const at = (lx: number, ly: number, lz: number) => {
          const ry = s.ry ?? 0, sn = Math.sin(ry), c = Math.cos(ry);
          return { x: s.x + lz * sn + lx * c, y: s.y - s.sy / 2 + ly, z: s.z + lz * c - lx * sn, q };
        };
        box('flat').add({ ...at(0, 0.55, 0), sx: s.sx, sy: 0.55, sz: s.sz }, { color: 0x1d1b1a });
        box('flat').add({ ...at(0, 1.0, -0.2), sx: s.sx - 0.2, sy: 0.5, sz: s.sz * 0.5 }, { color: 0x151413 });
        box('flat').add({ ...at(0, 0.84, s.sz * 0.3), sx: s.sx - 0.3, sy: 0.04, sz: s.sz * 0.3 }, { color: 0x4a2c1c });
        box('flat').add({ ...at(0.3, 0.84, -s.sz * 0.36), sx: s.sx * 0.5, sy: 0.04, sz: s.sz * 0.2 }, { color: 0x5a3320 });
        for (const [lx, lz] of [[-0.7, 1.3], [0.7, 1.3], [-0.7, -1.3], [0.7, -1.3]]) box('concrete').add({ ...at(lx, 0.14, lz), sx: 0.4, sy: 0.28, sz: 0.2 }, { color: 0x9a968c, tile: 1 });
        break;
      }
      case 'laundry':
        box('flat').add(spec, { color: s.color ?? 0xd9d4c6 });
        break;
      case 'billboard':
        billboard(s);
        break;
      case 'furn':
        furniture(s, solidIndex);
        break;
      case 'floorslab':
        // the ceiling of the floor below (the floor finish lies on top). Indoors only the sky's
        // ambient light reaches a ceiling, so it is drawn evenly lit rather than in the dark
        box('lit').add({ ...spec, y: spec.y - 0.001 }, { color: 0x9c978e, skipTop: true });
        break;
      case 'floorfinish': {
        const f = String(s.meta?.f ?? 'wood');
        const st = AREA_STYLE[`floor_${f}`] ?? AREA_STYLE.floor_wood;
        const color = f === 'carpet' ? [0x7d8a99, 0x8f7a6b, 0x6f7f6a, 0x8a6f7d][Math.floor(hash(solidIndex) * 4)] : st.color;
        box(`ground:${st.tex}`).addQuad(s.x - s.sx / 2, s.z - s.sz / 2, s.x + s.sx / 2, s.z + s.sz / 2, s.y + s.sy / 2, { color, tile: st.tile });
        break;
      }
      case 'lamp':
        box('lit').add(spec, { color: 0xfff1d6 });
        lights.push({ x: s.x, y: s.y - 0.3, z: s.z, kind: 'interior' });
        break;
      case 'roofplane':
        // glazed tiles (Hong Kong) are a clean color; shingles take the texture
        if (s.style === 'tile') {
          box('smooth').add(spec, { color: s.color ?? 0x2f7a5a });
          break;
        }
        box('shingle').add(spec, { color: s.color ?? [0x4a4442, 0x5a3f38, 0x3d4650, 0x4d4a3c][Math.floor(hash(solidIndex) * 4)], tile: 2.5 });
        break;
      case 'gable': {
        const st = STYLES[s.style ?? 'siding'] ?? STYLES.siding;
        gable(s, st.tex, shade(s.color ?? st.color, 0.95), st.tile);
        break;
      }
      case 'awningroof':
        box('flat').add({ ...spec, sy: spec.sy * 0.5, y: spec.y + spec.sy * 0.25 }, { color: s.color ?? 0x6b4a3a, skipBottom: true });
        // a light painted soffit underneath
        box('lit').add({ ...spec, sy: spec.sy * 0.5, y: spec.y - spec.sy * 0.25 }, { color: 0x8f8a80, skipTop: true });
        break;
      case 'antenna':
        box('flat').add(spec, { color: s.color ?? 0x9aa1a8 });
        break;
      case 'building': {
        const st = STYLES[s.style ?? 'brick'] ?? STYLES.brick;
        const color = s.color ?? st.color;
        box(st.tex).add(spec, { color, tile: st.tile, skipBottom: true, skipTop: true });
        const pitched = s.meta?.roof === 'pitched';
        if (pitched) pitchedRoof(s, color, solidIndex);
        else flatRoof(s);
        // towers get glazing bands per floor instead of hundreds of separate windows
        if (s.sy > 16) windowBands(s, solidIndex);
        else dressFacades(s, solidIndex, pitched);
        break;
      }
      case 'wall': {
        const st = STYLES[s.style ?? 'brick'] ?? STYLES.brick;
        box(st.tex).add(spec, { color: s.color ?? st.color, tile: st.tile, skipBottom: onGround });
        // an outside wall of an explorable building: plaster on the inside face
        if (typeof s.meta?.liner === 'number' && typeof s.meta?.side === 'string') liner(s, s.meta.liner, s.meta.side);
        break;
      }
      case 'roof': {
        // flat roofs: gravel on concrete (packed earth on BABYLON's mud-brick houses)
        const mud = s.style === 'mudbrick' || s.style === 'sandstone';
        box('concrete').add(spec, { color: mud ? 0xa98457 : 0x77777a, tile: 4, skipTop: true, skipBottom: !!s.meta?.arch });
        if (s.meta?.arch) {
          // an explorable building's top floor ceiling (evenly lit, like the floors below)
          inChunk = chunkOf(s.x, s.z);
          box('lit').add({ ...spec, y: spec.y - spec.sy / 2 + 0.01, sy: 0.02 }, { color: 0x9c978e, skipTop: true });
          inChunk = null;
        }
        box('ground:gravel').addQuad(s.x - s.sx / 2, s.z - s.sz / 2, s.x + s.sx / 2, s.z + s.sz / 2, s.y + s.sy / 2, { color: mud ? 0xc29a68 : 0x6a6a6e, tile: 3 });
        break;
      }
      case 'parapet': {
        const st = STYLES[s.style ?? 'concrete'] ?? STYLES.concrete;
        box(st.tex).add(spec, { color: shade(st.color, 0.85), tile: st.tile });
        break;
      }
      case 'basewall': {
        box('concrete').add(spec, { color: 0xb9b9b4, tile: 3, skipBottom: true });
        const team = (s.meta?.team === 1 ? 1 : 0) as TeamId;
        // crew-colored band around the top
        box('flat').add({ ...spec, y: s.y + s.sy / 2 - 0.45, sx: s.sx + 0.04, sy: 0.5, sz: s.sz + 0.04 }, { color: crewColorHex(team) });
        break;
      }
      case 'stairs':
        stairSteps(s);
        break;
      case 'stairfill':
      case 'ramp':
      case 'deck':
      case 'pillar':
      case 'lowwall':
      case 'planter':
      case 'plinth':
      case 'bleacher':
        box('concrete').add(spec, {
          color: s.color ?? (s.kind === 'bleacher' ? 0xaab0b6 : s.kind === 'planter' || s.kind === 'lowwall' ? 0xb7b2a6 : 0xbdbdb8),
          tile: 3, skipBottom: onGround,
        });
        if (s.kind === 'planter') box('ground:grass').addQuad(s.x - s.sx / 2 + 0.15, s.z - s.sz / 2 + 0.15, s.x + s.sx / 2 - 0.15, s.z + s.sz / 2 - 0.15, s.y + s.sy / 2 + 0.01, { tile: 3 });
        break;
      case 'fountain':
        box('concrete').add(spec, { color: s.style === 'pillar' ? 0xcfcfc8 : 0xb9bcc0, tile: 3, skipBottom: onGround });
        if (s.style !== 'pillar') box('flat').addQuad(s.x - s.sx / 2 + 0.3, s.z - s.sz / 2 + 0.3, s.x + s.sx / 2 - 0.3, s.z + s.sz / 2 - 0.3, s.y + s.sy / 2 + 0.01, { color: 0x3f6f86 });
        break;
      case 'platform':
        if (s.style === 'metal') box('flat').add(spec, { color: 0x3a3f46 });
        else box('concrete').add(spec, { color: 0xb5b5b0, tile: 3, skipBottom: onGround });
        break;
      case 'fireescape':
        box('flat').add(spec, { color: 0x353a41 });
        break;
      case 'rail': {
        // balusters, and a handrail along the top (it follows a stair's slope)
        const inside = !!s.meta?.int || !!s.group;
        box('bars').add(spec, { tile: 0.5, color: inside ? 0x4a4f56 : 0x2e3238 });
        const q = new THREE.Quaternion(spec.q.x, spec.q.y, spec.q.z, spec.q.w);
        _gp.set(0, s.sy / 2 - 0.025, 0).applyQuaternion(q);
        box(inside ? 'wood' : 'flat').add(
          { ...spec, x: s.x + _gp.x, y: s.y + _gp.y, z: s.z + _gp.z, sx: s.sx + 0.05, sy: 0.05, sz: s.sz + 0.02 },
          { color: inside ? 0x6f4f33 : 0x2e3238, tile: 1.3 },
        );
        break;
      }
      case 'fence_chain':
        box('chain').add(spec, { tile: 0.35, color: 0xffffff });
        fencePosts(s);
        break;
      case 'fence_wood':
        box('wood').add(spec, { color: 0x8f6d48, tile: 1.3, skipBottom: onGround });
        break;
      case 'shed':
        box('wood').add(spec, { color: 0x8a6f52, tile: 1.3, skipBottom: true, skipTop: true });
        box('metal').add({ ...spec, y: s.y + s.sy / 2 + 0.06, sx: s.sx + 0.3, sy: 0.12, sz: s.sz + 0.3 }, { color: 0x6d7379, tile: 1.5 });
        break;
      case 'cliff':
        box('concrete').add(spec, { color: [0x7d7466, 0x8a8172, 0x6f685c][solidIndex % 3], tile: 5, skipBottom: true });
        break;
      case 'ruin':
        box('concrete').add(spec, { color: [0x9b9a86, 0x8f8e78, 0xa3a08a][solidIndex % 3], tile: 2, skipBottom: onGround });
        break;
      case 'stoop':
        box('concrete').add(spec, { color: s.color ?? 0xb9b4a8, tile: 2, skipBottom: true });
        break;
      case 'post':
      case 'woodplat':
        box('wood').add(spec, { color: s.color ?? 0x8f6d48, tile: 1.3, skipBottom: onGround });
        break;
      case 'wreck':
        box('metal').add(spec, { color: s.color ?? 0xd5d9de, tile: 2, skipBottom: onGround });
        break;
      case 'sandstone':
        box('concrete').add(spec, { color: s.color ?? 0xc9a46b, tile: 3, skipBottom: onGround });
        break;
      case 'glazed':
        // glazed blue brick (BABYLON's gate)
        box('brick').add(spec, { color: s.color ?? 0x2e5aa8, tile: 1.6, skipBottom: onGround });
        break;
      case 'glass':
        // storefront glass (AJ's): see-through, catches a little light
        box('glass').add(spec, { color: 0xcfe8f5 });
        break;
      case 'counter':
        box('wood').add(spec, { color: 0x6f4f33, tile: 1.3, skipBottom: true });
        box('flat').add({ ...spec, y: s.y + s.sy / 2 + 0.02, sx: s.sx + 0.08, sy: 0.05, sz: s.sz + 0.08 }, { color: 0x2f3338 });
        break;
      default:
        box('flat').add(spec, { color: s.color ?? 0x808080, skipBottom: onGround });
    }
  }
  inChunk = null;
  trashBagGeo?.dispose();

  // window frames and sills, door casings (the doors and the glass themselves move: see BuildingVisual)
  for (const w of map.windows ?? []) windowFrame(w);
  for (const d of map.doors ?? []) doorCasing(d);

  // storefront awnings on the enterable shops
  awning('cornerstore', 0x1d6b3a, 's');
  awning('liquor', 0x7a1f1f, 'n');
  awning('yardoffice', 0x22384f, 'n');
  for (const r of map.solids) {
    if (r.kind === 'roof' && r.group && typeof r.meta?.awning === 'number') awning(r.group, r.meta.awning, String(r.meta.front ?? 's') as 'n' | 's' | 'e' | 'w');
  }

  // ceiling lights in the buildings you can walk into (every shell has a roof)
  // (the explorable buildings hang their own lights)
  for (const r of map.solids) if (r.kind === 'roof' && r.group && !r.meta?.arch) ceilingLights(r.group);

  // ================================================================== perimeter facades + skyline
  perimeterFacades();
  skyline();
  outskirts();

  // ================================================================== props
  map.props.forEach((p, i) => paintProp(p, i));

  // ================================================================== signs + banners
  for (const sgn of map.signs) {
    const color = sgn.team !== undefined ? CREWS[sgn.team].color : sgn.color ?? '#ffffff';
    const tag = sgn.style === 'graffiti';
    const image = makeSignCanvas(sgn.text, sgn.style, color, tag ? null : sgn.bg ?? '#222222', sgn.width / sgn.height);
    signs.add(image, tag ? 'decal' : 'sign', sgn.x, sgn.y, sgn.z, sgn.yaw + Math.PI, sgn.width, sgn.height);
  }

  // ================================================================== materials + meshes
  const std = (opts: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, ...opts });
  const groundOffset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;
  const materials: Record<string, THREE.Material> = {
    asphalt: std({ map: tex.asphalt }),
    'ground:asphalt': std({ map: tex.asphalt, ...groundOffset }),
    'ground:road': std({ map: tex.road, ...groundOffset }),
    'ground:sidewalk': std({ map: tex.sidewalk, ...groundOffset }),
    'ground:grass': std({ map: tex.grass, ...groundOffset }),
    'ground:gravel': std({ map: tex.gravel, ...groundOffset }),
    'ground:concrete': std({ map: tex.concrete, ...groundOffset }),
    'ground:wood': std({ map: tex.wood, ...groundOffset }),
    'ground:water': std({ roughness: 0.16, metalness: 0.2, ...groundOffset }),
    'ground:paint': std({ ...groundOffset }),
    paint: std({ polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.8 }),
    brick: std({ map: tex.brick }),
    stucco: std({ map: tex.stucco }),
    siding: std({ map: tex.siding }),
    metal: std({ map: tex.metal, roughness: 0.7, metalness: 0.25 }),
    concrete: std({ map: tex.concrete }),
    wood: std({ map: tex.wood }),
    crate: std({ map: tex.crate }),
    shelf: std({ map: tex.shelf }),
    shingle: std({ map: tex.shingle }),
    flat: std({ roughness: 0.8 }),
    faceted: std({ roughness: 0.95, flatShading: true }),
    smooth: std({ roughness: 0.7 }),
    glassDark: std({ roughness: 0.25, metalness: 0.5 }),
    lit: new THREE.MeshBasicMaterial({ vertexColors: true }),
    chain: std({ map: tex.chain, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
    bars: std({ map: tex.bars, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
    glass: std({ transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2, depthWrite: false }),
  };
  for (const m of Object.values(materials)) disposables.push(m);

  const noShadowCast = new Set(['asphalt', 'paint', 'lit', 'chain', 'bars', 'glass', 'glassDark']);
  /** Interior chunks: drawn only within INTERIOR_RANGE of the camera. */
  const chunks = new Map<string, { group: THREE.Group; x: number; z: number }>();
  const addMesh = (g: THREE.BufferGeometry, fullKey: string): void => {
    const at = fullKey.indexOf('@');
    const key = at < 0 ? fullKey : fullKey.slice(0, at);
    const mat = materials[key] ?? materials.flat;
    const mesh = new THREE.Mesh(g, mat);
    const groundish = key.startsWith('ground:') || key === 'asphalt' || key === 'paint';
    mesh.castShadow = !groundish && !noShadowCast.has(key);
    mesh.receiveShadow = key !== 'lit' && key !== 'glass';
    if (key === 'glass') mesh.renderOrder = 5;
    mesh.matrixAutoUpdate = false;
    disposables.push(g);
    if (at < 0) {
      group.add(mesh);
      return;
    }
    const id = fullKey.slice(at + 1);
    let c = chunks.get(id);
    if (!c) {
      const [cx, cz] = id.split(',').map(Number);
      c = { group: new THREE.Group(), x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK };
      c.group.name = `interior ${id}`;
      chunks.set(id, c);
      group.add(c.group);
    }
    c.group.add(mesh);
  };
  for (const [key, batch] of Object.entries(boxes)) if (!batch.empty) addMesh(batch.build(), key);
  for (const [key, batch] of Object.entries(geos)) {
    const g = batch.build();
    if (g) addMesh(g, key);
  }
  // ---- the live scoreboards: every screen shows the same picture, redrawn as it changes ----
  const live = { canvas: document.createElement('canvas'), games: null as ScoreGame[] | null, down: false, page: -1, drawn: '' };
  live.canvas.width = 1024;
  live.canvas.height = 512;
  const liveTex = new THREE.CanvasTexture(live.canvas);
  liveTex.colorSpace = THREE.SRGBColorSpace;
  liveTex.anisotropy = 4;
  disposables.push(liveTex);
  if (liveQuads.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(liveQuads, 3));
    const uvs: number[] = [];
    for (let i = 0; i < liveQuads.length / 18; i++) uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const lm = new THREE.MeshBasicMaterial({ map: liveTex, toneMapped: false });
    const mesh = new THREE.Mesh(lg, lm);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(lg, lm);
    drawScores(0);
  }
  for (const e of extras) group.add(e);
  for (const mesh of signs.build(disposables)) group.add(mesh);
  for (const mesh of models.build()) {
    group.add(mesh);
    disposables.push(mesh.geometry);
  }
  if (glows.length > 0 && LIGHTING.poolOpacity <= 0) for (const part of glows) part.dispose();
  else if (glows.length > 0) {
    const g = mergeGeometries(glows, false);
    for (const part of glows) part.dispose();
    const t = glowTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: t, transparent: true, opacity: LIGHTING.poolOpacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    disposables.push(g, t, mat);
  }

  if (cones.length > 0 && LIGHTING.coneOpacity <= 0) for (const part of cones) part.dispose();
  else if (cones.length > 0) {
    const g = mergeGeometries(cones, false);
    for (const part of cones) part.dispose();
    // additive, so black (the bottom of each cone) adds nothing: the light fades toward the ground
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 6;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    disposables.push(g, mat);
  }

  // ================================================================== sky (+ the sea, where there is one)
  const sky = makeSky();
  group.add(sky);

  // ================================================================== capture zone markers
  const zones: ZoneMarker[] = map.zones.map((z) => {
    const g = new THREE.Group();
    g.position.set(z.x, 0, z.z);
    const ringGeo = new THREE.RingGeometry(z.radius - 0.3, z.radius, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.06;
    ring.renderOrder = 3;
    const wallGeo = new THREE.CylinderGeometry(z.radius, z.radius, 2.6, 72, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 1.3;
    wall.renderOrder = 4;
    const label = makeLabelSprite(z.id);
    label.position.y = 5.4;
    label.scale.set(2.8, 2.8, 1);
    g.add(ring, wall, label);
    g.visible = false;
    group.add(g);
    disposables.push(ringGeo, ringMat, wallGeo, wallMat, label.material.map!, label.material);
    return {
      group: g,
      setColor(hex: number, strength: number) {
        ringMat.color.setHex(hex);
        wallMat.color.setHex(hex);
        wallMat.opacity = 0.05 + 0.13 * strength;
      },
    };
  });

  return {
    group,
    zones,
    lights,
    scoreboards: liveQuads.length > 0,
    setScores(msg: ScoresMsg | null) {
      live.down = msg === null;
      if (msg) live.games = msg.games;
      live.page = -1; // redraw on the next frame
    },
    update(_dt: number, time: number, camera?: THREE.Vector3) {
      if (camera) sky.position.copy(camera);
      // the scoreboards turn a page every few seconds
      if (liveQuads.length) {
        const page = Math.floor(time / 6);
        if (page !== live.page) {
          live.page = page;
          drawScores(page);
        }
      }
      // building interiors only near the camera
      if (camera) {
        const r = INTERIOR_RANGE + CHUNK * 0.71;
        for (const c of chunks.values()) c.group.visible = Math.hypot(c.x - camera.x, c.z - camera.z) < r;
      }
      // the clouds drift slowly across the sky
      const clouds = sky.getObjectByName('clouds');
      if (clouds) clouds.rotation.y = time * 0.004;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };

  // =====================================================================================
  // helpers (hoisted function declarations)
  // =====================================================================================

  /**
   * A billboard panel: a steel frame and a catwalk, with an ad (or a live scoreboard screen)
   * on its front and its back.
   */
  function billboard(s: Solid): void {
    const face = String(s.meta?.face ?? 's');
    const ns = face === 'n' || face === 's';
    const w = ns ? s.sx : s.sz, h = s.sy, T = ns ? s.sz : s.sx;
    box('flat').add({ x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz }, { color: 0x23262b });
    // the catwalk under the panel and a top rail
    box('flat').add({ x: s.x, y: s.y - h / 2 - 0.08, z: s.z, sx: ns ? w + 0.4 : T + 1.2, sy: 0.1, sz: ns ? T + 1.2 : w + 0.4 }, { color: 0x3a3f46 });
    box('flat').add({ x: s.x, y: s.y + h / 2 + 0.06, z: s.z, sx: ns ? w + 0.2 : T + 0.1, sy: 0.12, sz: ns ? T + 0.1 : w + 0.2 }, { color: 0x3a3f46 });
    const sides: Array<[string, string]> = [[face, String(s.meta?.front ?? '')], [face === 'n' ? 's' : face === 's' ? 'n' : face === 'e' ? 'w' : 'e', String(s.meta?.back ?? '')]];
    for (const [f, what] of sides) {
      if (!what) continue;
      const fx = f === 'e' ? 1 : f === 'w' ? -1 : 0, fz = f === 's' ? 1 : f === 'n' ? -1 : 0;
      const cx = s.x + fx * (T / 2 + 0.03), cz = s.z + fz * (T / 2 + 0.03);
      const pw = w - 0.5, ph = h - 0.5;
      if (what === 'live') {
        // corners as the viewer sees them: left to right is (fz, -fx)
        const rx = fz, rz = -fx, hw = pw / 2, hh = ph / 2;
        const bl = [cx - rx * hw, s.y - hh, cz - rz * hw], br = [cx + rx * hw, s.y - hh, cz + rz * hw];
        const tr = [cx + rx * hw, s.y + hh, cz + rz * hw], tl = [cx - rx * hw, s.y + hh, cz - rz * hw];
        liveQuads.push(...bl, ...br, ...tr, ...bl, ...tr, ...tl);
        lights.push({ x: cx + fx * 2, y: s.y - h / 2 - 1, z: cz + fz * 2, kind: 'shop' });
      } else {
        // (map signs face -Z at yaw 0; the atlas turns them half round, as it does for map signs)
        const yaw = f === 'n' ? 0 : f === 's' ? Math.PI : f === 'w' ? Math.PI / 2 : -Math.PI / 2;
        signs.add(adCanvas(what), 'sign', cx, s.y, cz, yaw + Math.PI, pw, ph);
      }
    }
  }

  /** Paints the scoreboard screens: one league a page, live games first. */
  function drawScores(page: number): void {
    const c = live.canvas, g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const games = live.games ?? [];
    // group into pages of four, a league at a time
    const pages: Array<{ league: string; rows: ScoreGame[] }> = [];
    for (const gm of games) {
      const last = pages[pages.length - 1];
      if (last && last.league === gm.league && last.rows.length < 4) last.rows.push(gm);
      else pages.push({ league: gm.league, rows: [gm] });
    }
    const cur = pages.length ? pages[page % pages.length] : null;
    const key = cur ? `${page % pages.length}|${JSON.stringify(cur)}` : live.down ? 'down' : live.games ? 'none' : 'wait';
    if (key === live.drawn) return;
    live.drawn = key;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0e14');
    bg.addColorStop(1, '#101a26');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // header
    g.fillStyle = '#f6b73c';
    g.fillRect(0, 0, W, 84);
    g.fillStyle = '#12100a';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '900 54px Impact, "Arial Narrow Bold", sans-serif';
    g.fillText('LIVE SCORES', 28, 44);
    g.textAlign = 'right';
    g.fillText(cur ? cur.league : 'WHOOPA SPORTS', W - 28, 44);
    if (!cur) {
      g.textAlign = 'center';
      g.fillStyle = '#dfe7f0';
      g.font = '900 64px Impact, "Arial Narrow Bold", sans-serif';
      g.fillText(live.down ? 'SCOREBOARD OFF AIR' : live.games ? 'NO GAMES RIGHT NOW' : 'WARMING UP…', W / 2, 250);
      g.font = '600 30px "Helvetica Neue", Arial, sans-serif';
      g.fillStyle = '#8fa3b8';
      g.fillText(live.down ? 'Scores are back when the feed is' : 'Check back at game time', W / 2, 330);
    } else {
      const rowH = 92, y0 = 104;
      cur.rows.forEach((gm, i) => {
        const y = y0 + i * rowH;
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.09)';
        g.fillRect(18, y, W - 36, rowH - 10);
        const mid = y + (rowH - 10) / 2;
        const lead = gm.state !== 'pre' && +gm.awayScore !== +gm.homeScore ? (+gm.awayScore > +gm.homeScore ? 'a' : 'h') : '';
        g.font = '900 56px Impact, "Arial Narrow Bold", sans-serif';
        g.textAlign = 'left';
        g.fillStyle = lead === 'a' ? '#ffffff' : '#aab8c8';
        g.fillText(gm.away, 40, mid);
        g.textAlign = 'right';
        g.fillText(gm.awayScore, 330, mid);
        g.textAlign = 'center';
        g.fillStyle = '#5f7286';
        g.font = '700 30px "Helvetica Neue", Arial, sans-serif';
        g.fillText(gm.state === 'pre' ? 'at' : '–', 372, mid);
        g.font = '900 56px Impact, "Arial Narrow Bold", sans-serif';
        g.textAlign = 'left';
        g.fillStyle = lead === 'h' ? '#ffffff' : '#aab8c8';
        g.fillText(gm.homeScore, 414, mid);
        g.textAlign = 'left';
        g.fillText(gm.home, gm.state === 'pre' ? 414 : 540, mid);
        // status: live in green with a dot, finals grey, start times white
        g.textAlign = 'right';
        g.font = '800 32px "Helvetica Neue", Arial, sans-serif';
        g.fillStyle = gm.state === 'in' ? '#4dff88' : gm.state === 'post' ? '#8fa3b8' : '#ffffff';
        g.fillText(gm.status.toUpperCase(), W - 44, mid);
        if (gm.state === 'in') {
          g.beginPath();
          g.arc(W - 60 - g.measureText(gm.status.toUpperCase()).width, mid, 8, 0, Math.PI * 2);
          g.fill();
        }
      });
      // page dots and the source
      g.textAlign = 'left';
      g.font = '600 22px "Helvetica Neue", Arial, sans-serif';
      g.fillStyle = '#5f7286';
      g.fillText('scores: ESPN', 28, H - 24);
      const n = Math.min(pages.length, 14);
      for (let i = 0; i < n; i++) {
        g.fillStyle = i === page % pages.length ? '#f6b73c' : '#34465a';
        g.beginPath();
        g.arc(W - 30 - (n - 1 - i) * 22, H - 24, 6, 0, Math.PI * 2);
        g.fill();
      }
    }
    liveTex.needsUpdate = true;
  }

  /** A box in a solid's own frame (x across, y up from its base, z toward its front). */
  function fpart(s: Solid, key: string, lx: number, y0: number, lz: number, sx: number, sy: number, sz: number, color: number, opts: BoxOptions = {}): void {
    const ry = s.ry ?? 0, sn = Math.sin(ry), c = Math.cos(ry);
    const base = s.y - s.sy / 2;
    box(key).add({ x: s.x + lz * sn + lx * c, y: base + y0 + sy / 2, z: s.z + lz * c - lx * sn, sx, sy, sz, q: yawQ(ry) }, { color, ...opts });
  }

  /** Furniture and fittings, from simple shapes that read at a glance. */
  function furniture(s: Solid, seed: number): void {
    const t = String(s.meta?.t ?? '');
    const W = s.sx, D = s.sz, H = s.sy;
    const r = hash(seed);
    const fabric = s.meta?.old ? 0x6a5f4c : [0x5b6b7d, 0x7a5c4a, 0x4f6650, 0x8a7b6a, 0x3f4a5c, 0x7d4b4b, 0x6b6f75][Math.floor(r * 7)];
    const woodC = [0x8a6240, 0x6f4f33, 0xa47a52, 0x5a4232][Math.floor(r * 4)];
    const white = 0xf1efe9, dark = 0x2c2f33, metal = 0x8d959d;
    const legs = (h: number, inset = 0.06, c = dark, k = 'flat') => {
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fpart(s, k, a * (W / 2 - inset), 0, b * (D / 2 - inset), 0.05, h, 0.05, c);
    };
    const table = (top: number, c: number) => {
      fpart(s, 'wood', 0, H - 0.05, 0, W, 0.05, D, c, { tile: 1.3 });
      legs(H - 0.05, 0.08, shade(c, 0.7), 'wood');
      void top;
    };
    switch (t) {
      case 'couch':
      case 'armchair': {
        fpart(s, 'flat', 0, 0, 0, W - 0.08, 0.12, D - 0.08, dark);
        fpart(s, 'smooth', 0, 0.12, 0.06, W - 0.36, 0.3, D - 0.2, fabric);
        const n = t === 'couch' ? 2 : 1, cw = (W - 0.36) / n;
        for (let i = 0; i < n; i++) fpart(s, 'smooth', -(W - 0.36) / 2 + cw * (i + 0.5), 0.42, 0.08, cw - 0.03, 0.1, D - 0.3, shade(fabric, 1.08));
        fpart(s, 'smooth', 0, 0.12, -D / 2 + 0.12, W, H - 0.12, 0.24, shade(fabric, 0.92));
        for (const sd of [-1, 1]) fpart(s, 'smooth', sd * (W / 2 - 0.09), 0.12, 0, 0.18, 0.5, D, shade(fabric, 0.95));
        break;
      }
      case 'coffeetable':
      case 'diningtable':
        table(H, woodC);
        break;
      case 'desk':
      case 'officedesk':
        table(H, t === 'officedesk' ? 0xd8d4cc : woodC);
        fpart(s, 'flat', W / 2 - 0.25, 0.05, 0, 0.4, H - 0.1, D - 0.06, t === 'officedesk' ? 0x9aa0a6 : shade(woodC, 0.85));
        if (t === 'officedesk') {
          fpart(s, 'glassDark', -0.1, H, -D / 2 + 0.2, 0.55, 0.34, 0.04, dark);
          fpart(s, 'flat', -0.1, H, -D / 2 + 0.22, 0.08, 0.06, 0.12, dark);
        }
        break;
      case 'chair':
        fpart(s, 'wood', 0, 0.43, 0, W, 0.05, D, woodC, { tile: 1.3 });
        legs(0.43, 0.04, shade(woodC, 0.7), 'wood');
        fpart(s, 'wood', 0, 0.48, -D / 2 + 0.03, W, 0.45, 0.04, woodC, { tile: 1.3 });
        break;
      case 'tvstand':
        fpart(s, 'wood', 0, 0, 0, W, 0.48, D, woodC, { tile: 1.3 });
        fpart(s, 'flat', 0, 0.48, -0.04, 0.3, 0.05, 0.2, dark);
        fpart(s, 'glassDark', 0, 0.53, -0.04, W * 0.82, 0.62, 0.05, 0x15171a);
        break;
      case 'rug':
        box('paint').add({ x: s.x, y: s.y - s.sy / 2 + 0.012, z: s.z, sx: W, sy: 0.006, sz: D, q: yawQ(s.ry ?? 0) }, { color: shade(fabric, 1.15) });
        break;
      case 'lamp':
        fpart(s, 'flat', 0, 0, 0, 0.3, 0.04, 0.3, dark);
        fpart(s, 'flat', 0, 0.04, 0, 0.04, H - 0.38, 0.04, dark);
        fpart(s, 'lit', 0, H - 0.36, 0, 0.36, 0.3, 0.36, 0xf7e2b8);
        break;
      case 'plant':
        fpart(s, 'flat', 0, 0, 0, 0.32, 0.34, 0.32, 0xa8613f);
        fpart(s, 'faceted', 0, 0.34, 0, 0.5, H - 0.34, 0.5, 0x4d7a3c);
        break;
      case 'bookcase':
      case 'shelf':
      case 'rack':
        box('shelf').add({ x: s.x, y: s.y, z: s.z, sx: W, sy: H, sz: D, q: yawQ(s.ry ?? 0) }, { color: t === 'rack' ? 0xc8ccd0 : 0xffffff, tile: 1 });
        break;
      case 'fridge':
        fpart(s, 'smooth', 0, 0, 0, W, H, D, white);
        fpart(s, 'flat', 0, H * 0.66, D / 2, W, 0.012, 0.012, 0xb9b6ae);
        fpart(s, 'flat', W / 2 - 0.08, H * 0.4, D / 2 + 0.02, 0.03, 0.45, 0.03, metal);
        break;
      case 'stove':
        fpart(s, 'smooth', 0, 0, 0, W, H - 0.02, D, white);
        fpart(s, 'flat', 0, H - 0.02, 0, W, 0.02, D, dark);
        fpart(s, 'glassDark', 0, 0.2, D / 2, W * 0.7, 0.32, 0.012, dark);
        break;
      case 'counter':
      case 'kitchensink':
      case 'register':
        fpart(s, 'wood', 0, 0, 0, W, H - 0.04, D, woodC, { tile: 1.3 });
        fpart(s, 'flat', 0, H - 0.04, 0, W + 0.03, 0.04, D + 0.03, t === 'register' ? 0x2f3338 : 0xd9d4ca);
        if (t === 'register') fpart(s, 'flat', 0, H, 0, 0.38, 0.22, 0.32, dark);
        break;
      case 'bed':
      case 'bedsingle':
        fpart(s, 'wood', 0, 0, 0, W, 0.3, D, woodC, { tile: 1.3 });
        fpart(s, 'smooth', 0, 0.3, 0.02, W - 0.06, 0.2, D - 0.1, white);
        fpart(s, 'smooth', 0, 0.48, D * 0.14, W - 0.02, 0.07, D * 0.68, fabric);
        fpart(s, 'smooth', 0, 0.5, -D / 2 + 0.28, W * 0.78, 0.12, 0.34, 0xfaf8f2);
        fpart(s, 'wood', 0, 0, -D / 2 + 0.03, W, 0.95, 0.06, shade(woodC, 0.85), { tile: 1.3 });
        break;
      case 'wardrobe':
      case 'dresser':
      case 'nightstand':
        fpart(s, 'wood', 0, 0, 0, W, H, D, woodC, { tile: 1.3 });
        if (t === 'wardrobe') fpart(s, 'flat', 0, 0.05, D / 2, 0.012, H - 0.1, 0.012, shade(woodC, 0.6));
        else for (let y = 0.25; y < H - 0.1; y += 0.28) fpart(s, 'flat', 0, y, D / 2, W - 0.1, 0.012, 0.012, shade(woodC, 0.6));
        break;
      case 'cabinet':
      case 'locker':
        fpart(s, 'metal', 0, 0, 0, W, H, D, t === 'locker' ? 0x5d7a8c : 0x8a9096, { tile: 1.5 });
        for (let y = 0.3; y < H - 0.1; y += t === 'locker' ? H : 0.33) fpart(s, 'flat', 0, y, D / 2, W - 0.08, 0.012, 0.012, dark);
        break;
      case 'toilet':
        fpart(s, 'smooth', 0, 0, 0.08, W * 0.8, 0.4, D * 0.66, white);
        fpart(s, 'smooth', 0, 0.38, -D / 2 + 0.1, W, 0.4, 0.2, white);
        break;
      case 'bathsink':
        fpart(s, 'smooth', 0, 0, -0.05, 0.18, 0.74, 0.18, white);
        fpart(s, 'smooth', 0, 0.74, 0, W, 0.14, D, white);
        fpart(s, 'glassDark', 0, 1.15, -D / 2 + 0.01, W * 0.9, 0.6, 0.02, 0x9fb4c0);
        break;
      case 'tub':
        fpart(s, 'smooth', 0, 0, 0, W, H, D, white);
        fpart(s, 'flat', 0, H, 0, W - 0.14, 0.005, D - 0.14, 0xbfd6df);
        break;
      case 'shower':
        fpart(s, 'smooth', 0, 0, 0, W, 0.08, D, white);
        box('glass').add({ ...rotated(s, 0, 1.1, D / 2 - 0.02), sx: W, sy: 2.0, sz: 0.02 }, { color: 0xd8eef6 });
        fpart(s, 'flat', 0, 1.95, -D / 2 + 0.1, 0.18, 0.04, 0.18, metal);
        break;
      case 'washer':
      case 'dryer':
        fpart(s, 'smooth', 0, 0, 0, W, H, D, white);
        fpart(s, 'glassDark', 0, 0.22, D / 2, W * 0.6, W * 0.6, 0.015, t === 'washer' ? 0x2a3a48 : 0x222428);
        fpart(s, 'flat', 0, H - 0.1, D / 2, W, 0.08, 0.012, 0x9aa0a6);
        break;
      case 'barberchair':
        fpart(s, 'metal', 0, 0, 0, 0.36, 0.42, 0.36, metal, { tile: 1 });
        fpart(s, 'smooth', 0, 0.42, 0.05, W, 0.16, D * 0.75, 0x8c1f24);
        fpart(s, 'smooth', 0, 0.58, -D / 2 + 0.08, W, 0.62, 0.14, 0x8c1f24);
        for (const sd of [-1, 1]) fpart(s, 'flat', sd * (W / 2 - 0.04), 0.58, 0.05, 0.08, 0.2, D * 0.6, metal);
        break;
      case 'mirror':
        fpart(s, 'glassDark', 0, 0.9, 0, W, 1.0, Math.max(0.03, D), 0xb7c6cf);
        break;
      case 'booth': {
        const red = [0x8c1f24, 0x1f5a8c, 0x2f6b3a][Math.floor(r * 3)];
        for (const sd of [-1, 1]) {
          fpart(s, 'smooth', 0, 0, sd * (D / 2 - 0.22), W, 0.45, 0.44, red);
          fpart(s, 'smooth', 0, 0, sd * (D / 2 - 0.06), W, 1.05, 0.12, shade(red, 0.85));
        }
        fpart(s, 'flat', 0, 0.7, 0, W * 0.92, 0.04, 0.5, 0xe9e4d8);
        fpart(s, 'flat', 0, 0, 0, 0.1, 0.7, 0.1, metal);
        break;
      }
      case 'cooler':
        fpart(s, 'metal', 0, 0, 0, W, H, D, 0xd9dde0, { tile: 1.5 });
        fpart(s, 'lit', 0, 0.15, D / 2 - 0.06, W - 0.12, H - 0.3, 0.02, 0xbfe6ff);
        for (let y = 0.45; y < H - 0.3; y += 0.4) fpart(s, 'flat', 0, y, D / 2 - 0.03, W - 0.16, 0.18, 0.03, [0xc8323a, 0x2f7ad1, 0xf2b630, 0x37a05a][Math.floor(hash(seed + y * 10) * 4)]);
        box('glass').add({ ...rotated(s, 0, H / 2, D / 2 + 0.01), sx: W, sy: H, sz: 0.02 }, { color: 0xd8eef6 });
        break;
      case 'workbench':
        table(H, 0x8a6a48);
        fpart(s, 'wood', 0, H, -D / 2 + 0.02, W, 0.8, 0.03, 0xa88a62, { tile: 1.3 });
        fpart(s, 'flat', -0.4, H, 0, 0.3, 0.12, 0.2, 0xc4392f);
        break;
      case 'pallets':
        fpart(s, 'wood', 0, 0, 0, W, 0.14, D, 0x9a7b55, { tile: 1 });
        box('crate').add({ ...rotated(s, 0, 0.14 + (H - 0.14) / 2, 0), sx: W * 0.9, sy: H - 0.14, sz: D * 0.9 }, { tile: 1 });
        break;
      case 'boxes':
        box('crate').add({ ...rotated(s, 0, H * 0.3, 0), sx: W, sy: H * 0.6, sz: D }, { tile: 1 });
        box('crate').add({ ...rotated(s, 0.1, H * 0.8, -0.05), sx: W * 0.7, sy: H * 0.4, sz: D * 0.7 }, { tile: 1 });
        break;
      case 'tires':
        for (let i = 0; i < 3; i++) fpart(s, 'faceted', 0, i * 0.3, 0, W, 0.26, D, 0x1f2124);
        break;
      case 'lantern':
        // paper lanterns hang overhead
        fpart(s, 'lit', 0, 2.05, 0, 0.36, 0.42, 0.36, 0xe8332e);
        fpart(s, 'flat', 0, 2.47, 0, 0.02, 0.5, 0.02, dark);
        lights.push({ x: s.x, y: s.y - s.sy / 2 + 2.0, z: s.z, kind: 'shop' });
        break;
      case 'altar':
        fpart(s, 'wood', 0, 0, 0, W, H, D, 0x8c1f1f, { tile: 1.3 });
        fpart(s, 'flat', 0, H, 0, W + 0.04, 0.04, D + 0.04, 0xd4a32a);
        fpart(s, 'lit', -W * 0.3, H + 0.04, 0, 0.05, 0.25, 0.05, 0xffb35c);
        fpart(s, 'lit', W * 0.3, H + 0.04, 0, 0.05, 0.25, 0.05, 0xffb35c);
        break;
      case 'stall': {
        const awn = [0xc8323a, 0x2f7ad1, 0xe0a030, 0x37a05a][Math.floor(r * 4)];
        fpart(s, 'wood', 0, 0, 0, W, H, D, 0x7a5a3a, { tile: 1.3 });
        for (const sd of [-1, 1]) fpart(s, 'flat', sd * (W / 2 - 0.05), H, -D / 2 + 0.05, 0.06, 1.3, 0.06, dark);
        fpart(s, 'flat', 0, H + 1.3, -0.05, W + 0.2, 0.06, D + 0.3, awn);
        for (let i = 0; i < 5; i++) fpart(s, 'smooth', -W / 2 + 0.3 + i * (W - 0.6) / 4, H, 0.1, 0.3, 0.18, 0.3, [0xd95f2b, 0x7fbf3f, 0xf2c94c, 0xc23b3b][(i + seed) % 4]);
        break;
      }
      default:
        fpart(s, 'flat', 0, 0, 0, W, H, D, 0x8a8a8a);
    }
  }

  /** Center (and rotation) of a point in a solid's frame, for box specs. */
  function rotated(s: Solid, lx: number, ly: number, lz: number): { x: number; y: number; z: number; q: { x: number; y: number; z: number; w: number } } {
    const ry = s.ry ?? 0, sn = Math.sin(ry), c = Math.cos(ry);
    return { x: s.x + lz * sn + lx * c, y: s.y - s.sy / 2 + ly, z: s.z + lz * c - lx * sn, q: yawQ(ry) };
  }

  /** A gable end: a triangle (base along the solid's z, apex at the top) as thick as the wall. */
  function gable(s: Solid, key: string, color: number, tile: number): void {
    const q = new THREE.Quaternion(...(Object.values(solidQuat(s)) as [number, number, number, number]));
    const hx = s.sx / 2, hy = s.sy / 2, hz = s.sz / 2;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(_gp.set(s.x, s.y, s.z));
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
    const c = new THREE.Color(color);
    const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, uvs: number[][]) => {
      const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
      for (const [i, p] of [a, b, d].entries()) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        uv.push(uvs[i][0], uvs[i][1]);
        col.push(c.r, c.g, c.b);
      }
    };
    for (const sd of [-1, 1]) {
      const a = P(sd * hx, -hy, -hz), b = P(sd * hx, -hy, hz), top = P(sd * hx, hy, 0);
      const uvs = [[0, 0], [s.sz / tile, 0], [s.sz / 2 / tile, s.sy / tile]];
      if (sd > 0) tri(a, top, b, [uvs[0], uvs[2], uvs[1]]);
      else tri(a, b, top, uvs);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo(key).addColored(g);
  }

  /** Plaster on the inside face of an outside wall of an explorable building. */
  function liner(s: Solid, color: number, side: string): void {
    const t = 0.012;
    // the wall faces `side` outward; the liner goes on the opposite face
    const ox = side === 'e' ? -1 : side === 'w' ? 1 : 0, oz = side === 's' ? -1 : side === 'n' ? 1 : 0;
    const x = s.x + ox * (s.sx / 2 + t / 2), z = s.z + oz * (s.sz / 2 + t / 2);
    const prev = inChunk;
    inChunk = chunkOf(s.x, s.z);
    box('smooth').add({ x, y: s.y, z, sx: ox ? t : s.sx, sy: s.sy, sz: oz ? t : s.sz }, { color, tile: 3 });
    inChunk = prev;
  }

  /** Frame and sill round a window opening. */
  function windowFrame(w: NonNullable<MapDef['windows']>[number]): void {
    const q = yawQ(w.a);
    const ux = Math.sin(w.a), uz = Math.cos(w.a);
    const nx = Math.cos(w.a) * (w.out ?? 1), nz = -Math.sin(w.a) * (w.out ?? 1);
    const frame = w.kind === 'fixed' ? 0x2c2f33 : 0xf1eee6;
    const T = 0.3; // across the wall
    const at = (u: number, y: number, n = 0) => ({ x: w.x + ux * u + nx * n, y, z: w.z + uz * u + nz * n });
    for (const sd of [-1, 1]) box('flat').add({ ...at(sd * (w.w / 2 - 0.03), w.y + w.h / 2), sx: T, sy: w.h, sz: 0.06, q }, { color: frame });
    box('flat').add({ ...at(0, w.y + w.h - 0.03), sx: T, sy: 0.06, sz: w.w, q }, { color: frame });
    // the sill sticks out a little on the outside
    box('flat').add({ ...at(0, w.y - 0.025, 0.06), sx: T + 0.12, sy: 0.05, sz: w.w + 0.14, q }, { color: shade(frame, 0.92) });
  }

  /** Casing round a door opening (the door itself swings: see BuildingVisual). */
  function doorCasing(d: NonNullable<MapDef['doors']>[number]): void {
    const q = yawQ(d.a);
    const ux = Math.sin(d.a), uz = Math.cos(d.a);
    const color = d.kind === 'glass' || d.kind === 'metal' ? 0x3a3e44 : 0xeeeae2;
    const at = (u: number, y: number) => ({ x: d.x + ux * u, y, z: d.z + uz * u });
    for (const u of [-0.035, d.w + 0.035]) box('flat').add({ ...at(u, d.y + (d.h + 0.04) / 2), sx: 0.32, sy: d.h + 0.04, sz: 0.07, q }, { color });
    box('flat').add({ ...at(d.w / 2, d.y + d.h + 0.06), sx: 0.32, sy: 0.08, sz: d.w + 0.14, q }, { color });
  }

  function offsetLine(points: Array<{ x: number; z: number }>, off: number): Array<{ x: number; z: number }> {
    return points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], c = points[Math.min(points.length - 1, i + 1)];
      let tx = c.x - a.x, tz = c.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      return { x: p.x + tz * off, z: p.z - tx * off };
    });
  }

  function dashed(points: Array<{ x: number; z: number }>, on: number, off: number, width: number, color: number, y: number): void {
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1], p1 = points[i];
      const seg = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const steps = Math.max(1, Math.round(seg / 0.6));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const phase = acc % (on + off);
        acc += seg / steps;
        if (phase >= on) continue;
        box('paint').addStrip(
          [
            { x: p0.x + (p1.x - p0.x) * t0, z: p0.z + (p1.z - p0.z) * t0 },
            { x: p0.x + (p1.x - p0.x) * t1, z: p0.z + (p1.z - p0.z) * t1 },
          ],
          width, y, { color },
        );
      }
    }
  }

  function circle(cx: number, cz: number, r: number, a0: number, a1: number, width: number, color: number, y: number): void {
    const pts: Array<{ x: number; z: number }> = [];
    const n = Math.max(6, Math.round(Math.abs(a1 - a0) * 8));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
    box('paint').addStrip(pts, width, y, { color });
  }

  /** Basketball court lines: boundary, half-court, center circle, keys and three-point arcs. */
  function paintCourt(x0: number, x1: number, z0: number, z1: number, y: number): void {
    const w = 0.1, c = 0xf2efe6;
    const P = box('paint');
    const m = 0.6;
    P.addQuad(x0 + m, z0 + m, x1 - m, z0 + m + w, y, { color: c });
    P.addQuad(x0 + m, z1 - m - w, x1 - m, z1 - m, y, { color: c });
    P.addQuad(x0 + m, z0 + m, x0 + m + w, z1 - m, y, { color: c });
    P.addQuad(x1 - m - w, z0 + m, x1 - m, z1 - m, y, { color: c });
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    P.addQuad(cx - w / 2, z0 + m, cx + w / 2, z1 - m, y, { color: c });
    circle(cx, cz, 1.8, 0, Math.PI * 2, w, c, y);
    for (const side of [-1, 1]) {
      const ex = side < 0 ? x0 + m : x1 - m; // baseline
      const hoopX = ex - side * 1.3;
      // the key (painted) and free-throw circle
      const kx0 = Math.min(ex, ex - side * 5.6), kx1 = Math.max(ex, ex - side * 5.6);
      P.addQuad(kx0, cz - 1.8, kx1, cz + 1.8, y - 0.002, { color: 0x8c3f2a });
      P.addQuad(kx0, cz - 1.8, kx1, cz - 1.8 + w, y, { color: c });
      P.addQuad(kx0, cz + 1.8 - w, kx1, cz + 1.8, y, { color: c });
      P.addQuad(ex - side * 5.6 - w / 2, cz - 1.8, ex - side * 5.6 + w / 2, cz + 1.8, y, { color: c });
      circle(ex - side * 5.6, cz, 1.8, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : (Math.PI * 3) / 2, w, c, y);
      // three-point arc
      circle(hoopX, cz, 6.2, side < 0 ? -1.25 : Math.PI - 1.25, side < 0 ? 1.25 : Math.PI + 1.25, w, c, y);
    }
  }

  function paintParking(x0: number, x1: number, z0: number, z1: number, y: number): void {
    const P = box('paint');
    const c = 0xc8c8c0;
    for (let z = z0 + 1.2; z < z1 - 0.5; z += 2.9) {
      P.addQuad(x0 + 0.4, z, x0 + 5.2, z + 0.12, y, { color: c });
      P.addQuad(x1 - 5.2, z, x1 - 0.4, z + 0.12, y, { color: c });
    }
  }

  /** Crosswalks and stop lines at the two Main St / Strip intersections and the rail crossing. */
  function paintStreetMarkings(): void {
    const P = box('paint');
    const c = 0xd8d8d0, y = 0.022;
    for (const sx of [-1, 1]) {
      const xa = Math.min(sx * 14, sx * 22), xb = Math.max(sx * 14, sx * 22);
      // across the Strip, north and south of Main St
      for (const z of [-7.4, 5.8]) {
        for (let x = xa + 0.5; x < xb - 0.4; x += 1.1) P.addQuad(x, z, x + 0.55, z + 1.6, y, { color: c });
      }
      // across Main St, either side of the Strip
      for (const x of [xa - 2.4, xb + 0.8]) {
        for (let z = -4.2; z < 4.0; z += 1.1) P.addQuad(x, z, x + 1.6, z + 0.55, y, { color: c });
      }
    }
    // rail crossing stop bars + big X
    for (const x of [39.2, 54.2]) {
      P.addQuad(x, -4.3, x + 0.45, 4.3, y, { color: c });
      const cx = x + (x < 45 ? -4 : 4.4);
      P.addStrip([{ x: cx - 1.2, z: -1.6 }, { x: cx + 1.2, z: 1.6 }], 0.3, y, { color: c });
      P.addStrip([{ x: cx - 1.2, z: 1.6 }, { x: cx + 1.2, z: -1.6 }], 0.3, y, { color: c });
    }
  }

  /** Visible steps for a stairway whose collision is a smooth ramp. */
  function stairSteps(s: Solid): void {
    const m = s.meta ?? {};
    const rise = Number(m.rise), run = Number(m.run), x0 = Number(m.x0), z0 = Number(m.z0), y0 = Number(m.y0);
    if (!(rise > 0 && run > 0)) {
      box('concrete').add({ x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz, q: solidQuat(s) }, { color: 0xbdbdb8, tile: 3 });
      return;
    }
    const ry = s.ry ?? 0;
    const dx = Math.sin(ry), dz = Math.cos(ry);
    const n = Math.max(2, Math.round(rise / 0.19));
    const d = run / n, h = rise / n;
    const q = yawQ(ry);
    for (let i = 0; i < n; i++) {
      const top = y0 + h * (i + 0.55);
      const cx = x0 + dx * d * (i + 0.5), cz = z0 + dz * d * (i + 0.5);
      box('concrete').add({ x: cx, y: top - (h + 0.06) / 2, z: cz, sx: s.sx, sy: h + 0.06, sz: d + 0.02, q }, { color: i % 2 ? 0xc4c4be : 0xb6b6b0, tile: 3 });
    }
  }

  function fencePosts(s: Solid): void {
    const alongX = s.sx > s.sz;
    const len = alongX ? s.sx : s.sz;
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (len * i) / n;
      box('flat').add({ x: s.x + (alongX ? t : 0), y: s.y, z: s.z + (alongX ? 0 : t), sx: 0.09, sy: s.sy, sz: 0.09 }, { color: 0x8d949c });
    }
    box('flat').add({ x: s.x, y: s.y + s.sy / 2 - 0.03, z: s.z, sx: alongX ? s.sx : 0.07, sy: 0.06, sz: alongX ? 0.07 : s.sz }, { color: 0x8d949c });
  }

  function flatRoof(s: Solid): void {
    const top = s.y + s.sy / 2;
    box('ground:gravel').addQuad(s.x - s.sx / 2, s.z - s.sz / 2, s.x + s.sx / 2, s.z + s.sz / 2, top, { color: 0x64646a, tile: 3 });
    // low roof curb so flat roofs do not look like bare boxes
    const st = STYLES[s.style ?? 'brick'] ?? STYLES.brick;
    const c = shade(s.color ?? st.color, 0.8);
    const t = 0.22, h = 0.3;
    box('flat').add({ x: s.x, y: top + h / 2, z: s.z - s.sz / 2 + t / 2, sx: s.sx, sy: h, sz: t }, { color: c });
    box('flat').add({ x: s.x, y: top + h / 2, z: s.z + s.sz / 2 - t / 2, sx: s.sx, sy: h, sz: t }, { color: c });
    box('flat').add({ x: s.x - s.sx / 2 + t / 2, y: top + h / 2, z: s.z, sx: t, sy: h, sz: s.sz }, { color: c });
    box('flat').add({ x: s.x + s.sx / 2 - t / 2, y: top + h / 2, z: s.z, sx: t, sy: h, sz: s.sz }, { color: c });
  }

  /** Gable roof on top of a house box. */
  function pitchedRoof(s: Solid, wallColor: number, seed: number): void {
    const top = s.y + s.sy / 2;
    const alongX = s.sx >= s.sz; // ridge runs along the longer side
    const span = alongX ? s.sz : s.sx;
    const length = alongX ? s.sx : s.sz;
    const over = 0.45;
    const rh = span * 0.32;
    const hw = span / 2 + over, hl = length / 2 + over;
    const roofColor = [0x4a4442, 0x5a3f38, 0x3d4650, 0x4d4a3c][Math.floor(hash(seed) * 4)];
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
    const c = new THREE.Color(roofColor);
    const tri = (pts: number[][], colr: THREE.Color, uvs: number[][]) => {
      const a = new THREE.Vector3(...(pts[0] as [number, number, number]));
      const e1 = new THREE.Vector3(...(pts[1] as [number, number, number])).sub(a);
      const e2 = new THREE.Vector3(...(pts[2] as [number, number, number])).sub(a);
      const n = e1.cross(e2).normalize();
      pts.forEach((p, i) => {
        pos.push(p[0], p[1], p[2]);
        nor.push(n.x, n.y, n.z);
        uv.push(uvs[i][0], uvs[i][1]);
        col.push(colr.r, colr.g, colr.b);
      });
    };
    // local frame: u along the ridge, v across
    const P = (u: number, v: number, y: number): number[] => (alongX ? [s.x + u, y, s.z + v] : [s.x + v, y, s.z + u]);
    const slope = Math.hypot(hw, rh);
    for (const side of [-1, 1]) {
      const eave0 = P(-hl, side * hw, top - 0.12), eave1 = P(hl, side * hw, top - 0.12);
      const ridge0 = P(-hl, 0, top + rh), ridge1 = P(hl, 0, top + rh);
      const uvs = [[0, 0], [(2 * hl) / 2.5, 0], [(2 * hl) / 2.5, slope / 2.5], [0, slope / 2.5]];
      // wind so the normal points up/out on both slopes and both ridge orientations
      const flip = (side > 0) !== alongX;
      if (flip) {
        tri([eave0, eave1, ridge1], c, [uvs[0], uvs[1], uvs[2]]);
        tri([eave0, ridge1, ridge0], c, [uvs[0], uvs[2], uvs[3]]);
      } else {
        tri([eave1, eave0, ridge0], c, [uvs[1], uvs[0], uvs[3]]);
        tri([eave1, ridge0, ridge1], c, [uvs[1], uvs[3], uvs[2]]);
      }
    }
    // gable ends in the wall color
    const wc = new THREE.Color(shade(wallColor, 0.92));
    for (const end of [-1, 1]) {
      const a = P(end * (length / 2), -span / 2, top), bb = P(end * (length / 2), span / 2, top), r = P(end * (length / 2), 0, top + rh * (span / 2 / hw));
      const flip = (end > 0) === alongX;
      tri(flip ? [a, bb, r] : [bb, a, r], wc, [[0, 0], [1, 0], [0.5, 1]]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo('shingle').addColored(g);
    // chimney
    const cu = (hash(seed + 5) - 0.5) * length * 0.5;
    const cp = P(cu, span * 0.22, top + rh * 0.35);
    box('brick').add({ x: cp[0], y: cp[1] + 0.5, z: cp[2], sx: 0.7, sy: 1.9, sz: 0.7 }, { color: 0x8a5a48, tile: 2.4 });
  }

  /** Windows (some lit) and a door on the faces of a solid building. */
  function dressFacades(s: Solid, seed: number, house: boolean): void {
    const h = s.sy;
    const x0 = s.x - s.sx / 2, x1 = s.x + s.sx / 2, z0 = s.z - s.sz / 2, z1 = s.z + s.sz / 2;
    const faces: Array<{ ax: 'x' | 'z'; at: number; n: number; a0: number; a1: number }> = [
      { ax: 'z', at: z0, n: -1, a0: x0, a1: x1 },
      { ax: 'z', at: z1, n: 1, a0: x0, a1: x1 },
      { ax: 'x', at: x0, n: -1, a0: z0, a1: z1 },
      { ax: 'x', at: x1, n: 1, a0: z0, a1: z1 },
    ];
    let longest = 0;
    faces.forEach((f, i) => {
      if (f.a1 - f.a0 > faces[longest].a1 - faces[longest].a0) longest = i;
    });
    faces.forEach((f, fi) => {
      // faces buried in the perimeter are never seen
      if ((f.ax === 'z' && (f.at <= b.minZ + 0.01 || f.at >= b.maxZ - 0.01)) || (f.ax === 'x' && (f.at <= b.minX + 0.01 || f.at >= b.maxX - 0.01))) return;
      windowsOn(f, s.y - h / 2, h, seed * 7 + fi, house && fi === longest);
    });
  }

  function windowsOn(
    f: { ax: 'x' | 'z'; at: number; n: number; a0: number; a1: number }, base: number, h: number, seed: number, door: boolean,
  ): void {
    const width = f.a1 - f.a0;
    if (width < 3.2) return;
    const cols = Math.max(1, Math.floor((width - 1.0) / 2.7));
    const gap = width / cols;
    const ww = 1.25, wh = 1.35;
    const floors: number[] = [];
    for (let y = 1.05; y + wh < h - 0.35; y += 3.0) floors.push(y);
    const doorCol = door ? Math.floor(cols / 2) : -1;
    floors.forEach((fy, fl) => {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const r = hash(seed * 31 + fl * 17 + cIdx);
        const a = f.a0 + gap * (cIdx + 0.5);
        if (fl === 0 && cIdx === doorCol) {
          pane(f, a, base + 1.08, 1.05, 2.16, 0x3a2a20, false, 0x2b2420);
          continue;
        }
        if (r < 0.12) continue; // a bare stretch of wall here and there
        const lit = r > 1 - LIGHTING.litWindows;
        const boarded = !lit && r < 0.2;
        pane(f, a, base + fy + wh / 2, ww, wh, boarded ? 0x6b5a45 : lit ? 0xffd592 : LIGHTING.windowGlass, lit, 0xd2cec4);
      }
    });
  }

  /** One window / door: a frame with a pane set into it, flush against a wall face. */
  function pane(
    f: { ax: 'x' | 'z'; at: number; n: number }, along: number, y: number, w: number, h: number, color: number, lit: boolean, frame: number,
  ): void {
    const depth = 0.06;
    const at = f.at + f.n * depth * 0.5;
    const spec = f.ax === 'z'
      ? { x: along, y, z: at, sx: w + 0.18, sy: h + 0.18, sz: depth }
      : { x: at, y, z: along, sx: depth, sy: h + 0.18, sz: w + 0.18 };
    box('flat').add(spec, { color: frame });
    const at2 = f.at + f.n * (depth + 0.012);
    const inner = f.ax === 'z'
      ? { x: along, y, z: at2, sx: w, sy: h, sz: 0.02 }
      : { x: at2, y, z: along, sx: 0.02, sy: h, sz: w };
    box(lit ? 'lit' : 'glassDark').add(inner, { color });
  }

  function awning(groupId: string, color: number, side: 'n' | 's' | 'e' | 'w'): void {
    // find the wall pieces of this shell and hang a strip above the entrance side
    const walls = map.solids.filter((s) => s.group === groupId && s.kind === 'wall');
    if (walls.length === 0) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
    for (const w of walls) {
      x0 = Math.min(x0, w.x - w.sx / 2); x1 = Math.max(x1, w.x + w.sx / 2);
      z0 = Math.min(z0, w.z - w.sz / 2); z1 = Math.max(z1, w.z + w.sz / 2);
      y0 = Math.min(y0, w.y - w.sy / 2);
    }
    const alongX = side === 'n' || side === 's';
    const out = side === 's' || side === 'e' ? 1 : -1;
    const len = (alongX ? x1 - x0 : z1 - z0) * 0.8;
    const mid = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2;
    const at = side === 's' ? z1 + 0.55 : side === 'n' ? z0 - 0.55 : side === 'e' ? x1 + 0.55 : x0 - 0.55;
    const put = (key: string, y: number, off: number, w: number, h: number, d: number, c: number) => {
      box(key).add(alongX
        ? { x: mid, y: y0 + y, z: at + off * out, sx: w, sy: h, sz: d }
        : { x: at + off * out, y: y0 + y, z: mid, sx: d, sy: h, sz: w }, { color: c });
    };
    put('flat', 2.78, 0, len, 0.14, 1.1, color);
    put('flat', 2.6, 0.52, len, 0.32, 0.06, shade(color, 1.25));
    // a light under the awning washing the sidewalk out front
    put('lit', 2.69, 0, len * 0.62, 0.03, 0.18, 0xffe9c4);
    lights.push(alongX ? { x: mid, y: y0 + 2.55, z: at + 0.6 * out, kind: 'shop' } : { x: at + 0.6 * out, y: y0 + 2.55, z: mid, kind: 'shop' });
  }

  /** Floor-by-floor glazing on the faces of a tall building. */
  function windowBands(s: Solid, seed: number): void {
    const h = s.sy, base = s.y - h / 2;
    const x0 = s.x - s.sx / 2, x1 = s.x + s.sx / 2, z0 = s.z - s.sz / 2, z1 = s.z + s.sz / 2;
    const glass = s.style === 'glass';
    for (let y = 1.2, fl = 0; y + 1.6 < h - 0.8; y += 3.4, fl++) {
      const bh = glass ? 2.5 : 1.5;
      const lit = hash(seed * 13 + fl) > 1 - LIGHTING.litWindows * 0.6;
      const key = lit ? 'lit' : 'glassDark';
      const color = lit ? 0xffd592 : glass ? 0x3d5a73 : LIGHTING.windowGlass;
      const yc = base + y + bh / 2;
      const inset = 0.5;
      if (z0 > b.minZ + 0.01) box(key).add({ x: s.x, y: yc, z: z0 - 0.03, sx: s.sx - inset * 2, sy: bh, sz: 0.06 }, { color });
      if (z1 < b.maxZ - 0.01) box(key).add({ x: s.x, y: yc, z: z1 + 0.03, sx: s.sx - inset * 2, sy: bh, sz: 0.06 }, { color });
      if (x0 > b.minX + 0.01) box(key).add({ x: x0 - 0.03, y: yc, z: s.z, sx: 0.06, sy: bh, sz: s.sz - inset * 2 }, { color });
      if (x1 < b.maxX - 0.01) box(key).add({ x: x1 + 0.03, y: yc, z: s.z, sx: 0.06, sy: bh, sz: s.sz - inset * 2 }, { color });
    }
  }

  /** The solid boundary wall, dressed as the backs of neighbouring buildings of varied height. */
  function perimeterFacades(): void {
    let seed = 900;
    let tall = 1;
    const run = (ax: 'x' | 'z', at: number, n: number, a0: number, a1: number) => {
      let a = a0;
      while (a < a1 - 0.5) {
        seed++;
        const len = Math.min(a1 - a, 11 + Math.floor(hash(seed) * 12));
        const hgt = (10.5 + Math.floor(hash(seed + 400) * 5) * 1.4) * tall;
        const style = STYLES[FACADES[Math.floor(hash(seed + 800) * FACADES.length)]];
        const mid = a + len / 2;
        const depth = 3;
        const spec = ax === 'z'
          ? { x: mid, y: hgt / 2, z: at - n * (depth / 2), sx: len, sy: hgt, sz: depth }
          : { x: at - n * (depth / 2), y: hgt / 2, z: mid, sx: depth, sy: hgt, sz: len };
        box(style.tex).add(spec, { color: shade(style.color, 0.82), tile: style.tile, skipBottom: true });
        windowsOn({ ax, at, n, a0: a, a1: a + len }, 0, hgt, seed * 3, false);
        a += len;
      }
    };
    // dress the inner face of every boundary wall (clipped to the playable area)
    for (const p of map.solids) {
      if (p.kind !== 'perimeter') continue;
      const side = p.meta?.side;
      tall = Number(p.meta?.tall ?? 1);
      const ax0 = Math.max(b.minX, p.x - p.sx / 2), ax1 = Math.min(b.maxX, p.x + p.sx / 2);
      const az0 = Math.max(b.minZ, p.z - p.sz / 2), az1 = Math.min(b.maxZ, p.z + p.sz / 2);
      if (side === 'n') run('z', p.z + p.sz / 2, 1, ax0, ax1);
      else if (side === 's') run('z', p.z - p.sz / 2, -1, ax0, ax1);
      else if (side === 'w') run('x', p.x + p.sx / 2, 1, az0, az1);
      else if (side === 'e') run('x', p.x - p.sx / 2, -1, az0, az1);
    }
  }

  /**
   * The land past the edges of the big map, so the view from the blimp is forest and desert
   * rather than haze: one ground sheet (dunes in the west, forest floor elsewhere), a deep band
   * of trees to the north and east, rocks and mesas across the desert. Visual only.
   */
  function outskirts(): void {
    if (map.id !== 'greater-towne') return;
    const noise = (x: number, z: number): number => {
      const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
      const h = (a: number, c: number) => hash(((a * 73856093) ^ (c * 19349663)) & 0x7fffffff);
      const s = (t: number) => t * t * (3 - 2 * t);
      const u = s(fx), v = s(fz);
      return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
    };
    /** How far outside the playable area a point is (0 inside). */
    const outside = (x: number, z: number) => Math.hypot(Math.max(0, b.minX - x, x - b.maxX), Math.max(0, b.minZ - z, z - b.maxZ));
    // the desert lies beyond BABYLON (the north-west corner); forest everywhere else
    const desertAt = (x: number, z: number) => (x < -205 && z < -40) || (z < b.minZ - 10 && x < -95);

    // ---- the ground sheet (stops at the shore; the ocean is drawn already) ----
    const W0 = -1800, W1 = 1800, Z0 = -1800, Z1 = b.maxZ - 0.6;
    const g = new THREE.PlaneGeometry(W1 - W0, Z1 - Z0, 96, Math.round((96 * (Z1 - Z0)) / (W1 - W0)));
    g.rotateX(-Math.PI / 2);
    g.translate((W0 + W1) / 2, 0, (Z0 + Z1) / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xdcbb82), sandDark = new THREE.Color(0xc9a46b), green = new THREE.Color(0x5d7f45), greenDark = new THREE.Color(0x4a6b3a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = outside(x, z);
      const n = noise(x / 60, z / 60);
      const desert = desertAt(x, z) ? 1 : 0;
      // dunes rise out of the desert away from the edge (never into the playable area)
      const rise = Math.min(1, Math.max(0, (d - 30) / 120));
      const y = -0.12 + rise * (desert ? 3 + n * 14 + noise(x / 23, z / 23) * 5 : n * 4);
      pos.setY(i, y);
      if (desert) c.copy(sand).lerp(sandDark, noise(x / 31, z / 31) * 0.8);
      else c.copy(green).lerp(greenDark, n);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = false;
    ground.matrixAutoUpdate = false;
    group.add(ground);
    disposables.push(g, groundMat);
    const groundY = (x: number, z: number) => {
      const d = outside(x, z), n = noise(x / 60, z / 60);
      const rise = Math.min(1, Math.max(0, (d - 30) / 120));
      return -0.12 + rise * (desertAt(x, z) ? 3 + n * 14 + noise(x / 23, z / 23) * 5 : n * 4);
    };

    // ---- the woods: a deep band of trees along the north and east ----
    const trunk = new THREE.CylinderGeometry(0.25, 0.4, 2.6, 5);
    trunk.translate(0, 1.3, 0);
    const crown = new THREE.IcosahedronGeometry(2.6, 0);
    crown.translate(0, 4.4, 0);
    const pine = new THREE.ConeGeometry(2.2, 6.5, 6);
    pine.translate(0, 5.2, 0);
    const GREENS = [0x3f7a3a, 0x4d8a42, 0x356b35, 0x5a9446];
    let k = 0;
    const tree = (x: number, z: number) => {
      const y = groundY(x, z), s = 0.8 + hash(k + 3) * 0.9, ry = hash(k + 7) * 6;
      geo('faceted').add(trunk, trs(x, y, z, ry, s, s, s), 0x6b4a2c);
      geo('faceted').add(hash(k + 11) < 0.45 ? pine : crown, trs(x, y, z, ry, s, s * (0.9 + hash(k + 13) * 0.4), s), GREENS[k % GREENS.length]);
      k++;
    };
    const cityN = (x: number) => x > -90; // the Hill and downtown back onto city blocks: trees start further out
    for (let x = -205; x < b.maxX + 280; x += 8) {
      for (let z = b.minZ - 14; z > b.minZ - 320; z -= 8) {
        const px = x + (hash(k * 3 + 1) - 0.5) * 6, pz = z + (hash(k * 3 + 2) - 0.5) * 6;
        k++;
        const d = b.minZ - pz;
        if (cityN(px) && d < 75) continue;
        if (hash(k * 5) > 0.75 - d / 900) continue;
        tree(px, pz);
      }
    }
    // west of the jungle and the docks
    for (let x = b.minX - 14; x > b.minX - 300; x -= 8) {
      for (let z = -30; z < b.maxZ - 2; z += 8) {
        const px = x + (hash(k * 3 + 1) - 0.5) * 6, pz = z + (hash(k * 3 + 2) - 0.5) * 6;
        k++;
        if (desertAt(px, pz) || hash(k * 5) > 0.75 - (b.minX - px) / 900) continue;
        tree(px, pz);
      }
    }
    for (let x = b.maxX + 75; x < b.maxX + 320; x += 8) {
      for (let z = b.minZ - 14; z < 61; z += 8) {
        const px = x + (hash(k * 3 + 1) - 0.5) * 6, pz = z + (hash(k * 3 + 2) - 0.5) * 6;
        k++;
        if (hash(k * 5) > 0.7 - (px - b.maxX) / 900) continue;
        tree(px, pz);
      }
    }

    // ---- the desert: rocks out on the dunes, flat-topped mesas on the horizon ----
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const ROCKS = [0xb48a5a, 0xa47a4e, 0xc49a68];
    for (let i = 0; i < 220; i++) {
      const x = b.minX - 25 - hash(i * 7 + 1) * 700, z = b.minZ - 200 + hash(i * 7 + 2) * 150;
      const r = 1.2 + hash(i * 7 + 3) * 4.5;
      geo('faceted').add(rock, trs(x, groundY(x, z) - r * 0.3, z, hash(i) * 6, r * 1.3, r * 0.8, r), ROCKS[i % 3]);
    }
    for (let i = 0; i < 70; i++) {
      // north-west corner of the desert too
      const x = -205 - hash(i * 5 + 300) * 600, z = b.minZ - 20 - hash(i * 5 + 301) * 500;
      const r = 1.5 + hash(i * 5 + 302) * 4;
      geo('faceted').add(rock, trs(x, groundY(x, z) - r * 0.3, z, hash(i) * 6, r * 1.3, r * 0.8, r), ROCKS[i % 3]);
    }
    const mesa = new THREE.CylinderGeometry(1, 1.25, 1, 7);
    mesa.translate(0, 0.5, 0);
    const MESAS = [0xb07a4c, 0xa56f45, 0xbd8657];
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * (0.55 + hash(i + 900) * 0.75); // spread around the west
      const dist = 520 + hash(i + 910) * 700;
      const x = b.minX + Math.cos(a) * dist, z = -20 + Math.sin(a) * dist * -1;
      if (z > -80) continue;
      const r = 40 + hash(i + 920) * 90, h = 30 + hash(i + 930) * 60;
      geo('faceted').add(mesa, trs(x, -2, z, hash(i + 940) * 6, r, h, r * (0.6 + hash(i + 950) * 0.5)), MESAS[i % 3]);
      geo('faceted').add(mesa, trs(x, -2 + h * 0.62, z, hash(i + 940) * 6, r * 1.02, h * 0.06, r * (0.6 + hash(i + 950) * 0.5) * 1.02), 0x8f5f3a);
    }
    // ---- LAKE LINDA's far shore: green hills and woods across the water, and down both sides ----
    {
      const SHORE = b.maxZ, FAR = SHORE + 420, SIDE = 300;
      const shore = (x0: number, x1: number, z0: number, z1: number, seg: number) => {
        const sg = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg, Math.max(2, Math.round((seg * (z1 - z0)) / (x1 - x0))));
        sg.rotateX(-Math.PI / 2);
        sg.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
        const sp = sg.attributes.position;
        const sc = new Float32Array(sp.count * 3);
        for (let i = 0; i < sp.count; i++) {
          const x = sp.getX(i), z = sp.getZ(i);
          // rises gently away from the water's edge
          const edge = Math.min(Math.abs(z - z0), Math.abs(z - z1), Math.abs(x - x0), Math.abs(x - x1));
          const n = noise(x / 70, z / 70);
          sp.setY(i, -0.3 + Math.min(1, edge / 90) * (2 + n * 22));
          c.copy(green).lerp(greenDark, n);
          sc.set([c.r, c.g, c.b], i * 3);
        }
        sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
        sg.computeVertexNormals();
        const m = new THREE.Mesh(sg, groundMat);
        m.matrixAutoUpdate = false;
        group.add(m);
        disposables.push(sg);
      };
      shore(-1800, 1800, FAR, 1800, 90);
      shore(-1800, b.minX - SIDE, SHORE, FAR, 30);
      shore(b.maxX + SIDE, 1800, SHORE, FAR, 30);
      const shoreY = (x: number, z: number) => {
        const n = noise(x / 70, z / 70);
        const edge = z >= FAR ? z - FAR : x < 0 ? b.minX - SIDE - x : x - (b.maxX + SIDE);
        return -0.3 + Math.min(1, Math.max(0, edge) / 90) * (2 + n * 22);
      };
      for (let x = -1100; x < 1100; x += 9) {
        for (let z = FAR + 6; z < FAR + 260; z += 9) {
          const px = x + (hash(k * 3 + 1) - 0.5) * 7, pz = z + (hash(k * 3 + 2) - 0.5) * 7;
          k++;
          if (hash(k * 5) > 0.72 - (pz - FAR) / 700) continue;
          const sc = 1.3 + hash(k) * 0.8;
          geo('faceted').add(hash(k + 11) < 0.5 ? pine : crown, trs(px, shoreY(px, pz), pz, hash(k + 7) * 6, sc, sc, sc), GREENS[k % GREENS.length]);
        }
      }
      for (const side of [-1, 1]) {
        for (let d = 6; d < 220; d += 9) {
          for (let z = SHORE + 6; z < FAR; z += 9) {
            const px = side < 0 ? b.minX - SIDE - d : b.maxX + SIDE + d, pz = z + (hash(k * 3 + 2) - 0.5) * 7;
            k++;
            if (hash(k * 5) > 0.7) continue;
            const sc = 1.2 + hash(k) * 0.8;
            geo('faceted').add(hash(k + 11) < 0.5 ? pine : crown, trs(px, shoreY(px, pz), pz, hash(k + 7) * 6, sc, sc, sc), GREENS[k % GREENS.length]);
          }
        }
      }
      // the far shore as you see it from the beach: wooded ridges across the water, drawn
      // through the haze (the real trees over there are past the fog from ground level)
      {
        const rp: number[] = [], rc: number[] = [];
        const ridge = (z: number, base: number, amp: number, hex: number, seed: number) => {
          const col = new THREE.Color(hex);
          const top = (x: number) => base + noise(x / 140 + seed, seed) * amp + noise(x / 37 + seed, 3) * amp * 0.25;
          for (let x = -1700; x < 1700; x += 24) {
            const y0 = top(x), y1 = top(x + 24);
            rp.push(x, -2, z, x + 24, -2, z, x + 24, y1, z, x, -2, z, x + 24, y1, z, x, y0, z);
            for (let k = 0; k < 6; k++) rc.push(col.r, col.g, col.b);
          }
        };
        ridge(SHORE + 560, 26, 60, 0xa9c2bd, 7);
        ridge(SHORE + 430, 14, 38, 0x86a898, 3);
        ridge(SHORE + 330, 7, 20, 0x5f8a66, 1);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
        const rm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(rg, rm);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        group.add(mesh);
        disposables.push(rg, rm);
      }
      // a few cabins and a jetty on the far side
      for (let i = 0; i < 9; i++) {
        const x = -700 + i * 170 + (hash(i + 70) - 0.5) * 80, z = FAR + 30 + hash(i + 71) * 60;
        const y = shoreY(x, z);
        box('wood').add({ x, y: y + 2, z, sx: 9, sy: 4, sz: 7, q: yawQ(hash(i) * 0.4) }, { color: 0x8a6440, tile: 1.4 });
        box('shingle').add({ x, y: y + 4.6, z, sx: 10, sy: 1.2, sz: 8, q: yawQ(hash(i) * 0.4) }, { color: 0x4d3a30, tile: 2.5 });
      }
    }
    for (const gq of [trunk, crown, pine, rock, mesa]) gq.dispose();
  }

  /** Distant towers beyond the map edge, for depth. */
  function skyline(): void {
    const ccx = (b.minX + b.maxX) / 2, ccz = (b.minZ + b.maxZ) / 2;
    const backdrop = map.backdrop ?? {};
    const sideOf = (dx: number, dz: number, rx: number, rz: number): 'n' | 's' | 'e' | 'w' =>
      Math.abs(dx / rx) > Math.abs(dz / rz) ? (dx > 0 ? 'e' : 'w') : dz > 0 ? 's' : 'n';
    // rolling hills behind wherever the map ends in rock (the jungle, the headlands by the beach)
    const cliffs = map.solids.filter((c) => c.kind === 'cliff');
    cliffs.forEach((c, i) => {
      if (i % 3) return;
      let ox = c.x - ccx, oz = c.z - ccz;
      // push straight out from the edge the cliff sits on
      if (c.x < b.minX + 0.01) { ox = -1; oz = 0; } else if (c.x > b.maxX - 0.01) { ox = 1; oz = 0; } else { ox = 0; oz = c.z < ccz ? -1 : 1; }
      const out = 70 + hash(i + 700) * 70;
      const r = 32 + hash(i + 800) * 30;
      const hill = new THREE.IcosahedronGeometry(1, 2);
      const desertSide = backdrop.w === 'desert' && (c.x < b.minX + 0.01 || c.x < -205);
      const tones = desertSide ? [0xc9a46b, 0xb8935c, 0xd4b077] : [0x3f6a38, 0x4a7a40, 0x36603a];
      geo('faceted').add(hill, trs(c.x + ox * out, -r * 0.4, c.z + oz * out, hash(i) * 6, r, r * (0.5 + hash(i + 820) * 0.3), r), tones[i % 3]);
      hill.dispose();
    });
    const nearCliff = (x: number, z: number) => cliffs.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 130 * 130);
    for (let i = 0; i < 54; i++) {
      const t = i / 54;
      const ang = t * Math.PI * 2 + hash(i) * 0.1;
      const rx = (b.maxX - b.minX) / 2 + 16 + hash(i + 50) * 46;
      const rz = (b.maxZ - b.minZ) / 2 + 16 + hash(i + 90) * 46;
      const side = sideOf(Math.cos(ang) * rx, Math.sin(ang) * rz, rx, rz);
      if (backdrop[side] && backdrop[side] !== 'city') continue;
      const x = ccx + Math.cos(ang) * rx, z = ccz + Math.sin(ang) * rz;
      if (nearCliff(x, z)) continue;
      const w = 10 + hash(i + 130) * 14, d = 10 + hash(i + 170) * 14;
      const h = 16 + hash(i + 210) * 34;
      box('flat').add({ x, y: h / 2, z, sx: w, sy: h, sz: d }, { color: [0x4b5362, 0x565c68, 0x434a57, 0x5e6470][i % 4], skipBottom: true });
      // a scatter of lit windows on the side facing the map (none by day)
      const fx = Math.abs(x) > Math.abs(z);
      for (let k = 0; k < (LIGHTING.skylineWindows > 0 ? 9 : 0); k++) {
        if (hash(i * 13 + k) < 0.45) continue;
        const u = (hash(i * 29 + k) - 0.5) * (fx ? d : w) * 0.8;
        const y = 4 + hash(i * 41 + k) * (h - 7);
        const spec = fx
          ? { x: x - Math.sign(x) * (w / 2 + 0.05), y, z: z + u, sx: 0.05, sy: 1.3, sz: 1.1 }
          : { x: x + u, y, z: z - Math.sign(z) * (d / 2 + 0.05), sx: 1.1, sy: 1.3, sz: 0.05 };
        box('lit').add(spec, { color: shade(0xffd592, LIGHTING.skylineWindows) });
      }
    }
  }

  /**
   * Sky that follows the camera: a gradient dome with a haze low on the horizon, and the sun
   * by day or stars and the moon by night. Everything here is drawn first and without depth,
   * so the town simply paints over it.
   */
  function makeSky(): THREE.Mesh {
    const g = new THREE.SphereGeometry(100, 48, 24);
    const top = new THREE.Color(LIGHTING.sky.top), mid = new THREE.Color(LIGHTING.sky.mid), low = new THREE.Color(LIGHTING.sky.horizon);
    const glow = new THREE.Color(LIGHTING.cityGlow);
    const colors: number[] = [];
    const p = g.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, p.getY(i) / 100);
      if (t < 0.22) c.copy(low).lerp(mid, t / 0.22);
      else c.copy(mid).lerp(top, Math.min(1, (t - 0.22) / 0.6));
      // haze (city lights at night): a warm band hugging the horizon
      c.lerp(glow, Math.max(0, 1 - t / 0.38) ** 1.6 * LIGHTING.cityGlowAmount);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    disposables.push(g, m);

    // stars: tiny additive points above the city glow (opaque pass, so buildings draw over them)
    if (LIGHTING.stars > 0) {
      const pos: number[] = [];
      const col: number[] = [];
      for (let i = 0; i < LIGHTING.stars; i++) {
        const y = 0.1 + 0.9 * Math.sqrt(hash(i * 3 + 1));
        const a = hash(i * 3 + 2) * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        pos.push(Math.cos(a) * r * 95, y * 95, Math.sin(a) * r * 95);
        // fainter near the horizon, a few bright ones, a hint of color
        const b = (0.25 + 0.75 * hash(i * 3 + 3) ** 3) * Math.min(1, (y - 0.1) / 0.25);
        const warm = hash(i * 7 + 5);
        col.push(b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.15));
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const sm = new THREE.PointsMaterial({
        size: 1.8, sizeAttenuation: false, vertexColors: true, fog: false,
        depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const stars = new THREE.Points(sg, sm);
      stars.renderOrder = -99;
      stars.frustumCulled = false;
      mesh.add(stars);
      disposables.push(sg, sm);
    }

    // the sun or moon, where the shadow-casting light comes from. The light itself is high
    // (short shadows, readable streets); the disc is drawn lower in the same direction so you
    // actually see it in the sky from the third-person camera.
    // (all of it is drawn in the opaque pass, before the town, so buildings always cover it:
    // the halo adds light, the sun disc and the clouds are cut-outs)
    const day = LIGHTING.sun.body === 'sun';
    const [mx, , mz] = LIGHTING.sun.dir;
    const az = Math.atan2(mx, mz);
    const elev = day ? 0.36 : 0.5; // radians above the horizon
    const at = new THREE.Vector3(Math.sin(az) * Math.cos(elev) * 90, Math.sin(elev) * 90, Math.cos(az) * Math.cos(elev) * 90);
    const skySprite = (map: THREE.Texture, size: number, order: number, additive: boolean) => {
      const m = new THREE.SpriteMaterial({
        map, fog: false, depthTest: false, depthWrite: false, transparent: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: additive ? 0 : 0.5,
      });
      const sp = new THREE.Sprite(m);
      sp.position.copy(at);
      sp.scale.setScalar(size);
      sp.renderOrder = order;
      sp.frustumCulled = false;
      mesh.add(sp);
      disposables.push(map, m);
    };
    if (day) {
      skySprite(sunHaloTexture(), 46, -99, true);
      skySprite(sunTexture(), 26, -98, false);
    } else {
      skySprite(moonTexture(), 16, -98, true);
    }

    // puffy cartoon clouds around the horizon (in front of the sun, behind the town)
    if (day) {
      const clouds = new THREE.Group();
      clouds.name = 'clouds';
      const texes = [0, 1, 2, 3].map((v) => cloudTexture(v));
      const mats = texes.map((t) => new THREE.SpriteMaterial({ map: t, fog: false, depthTest: false, depthWrite: false, transparent: false, alphaTest: 0.5 }));
      disposables.push(...texes, ...mats);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + hash(i * 5 + 11) * 0.22;
        const e = 0.07 + hash(i * 5 + 12) ** 1.6 * 0.42;
        const r = 88;
        const sp = new THREE.Sprite(mats[i % mats.length]);
        sp.position.set(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, Math.cos(a) * Math.cos(e) * r);
        const w = 20 + hash(i * 5 + 13) * 22;
        sp.scale.set(w, w * 0.42, 1);
        sp.renderOrder = -97;
        sp.frustumCulled = false;
        clouds.add(sp);
      }
      mesh.add(clouds);
    }
    return mesh;
  }

  /** A puffy cartoon cloud: white lumps on a flat bottom, a soft grey belly, a thin ink rim. */
  function cloudTexture(variant: number): THREE.CanvasTexture {
    const w = 512, h = 216;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d')!;
    const base = h * 0.8;
    const lumps: Array<[number, number, number]> = [];
    const n = 5 + (variant % 3);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = w * (0.12 + 0.76 * t) + (hash(variant * 31 + i) - 0.5) * 30;
      const r = h * (0.2 + 0.26 * Math.sin(Math.PI * t) + hash(variant * 17 + i) * 0.1);
      lumps.push([x, base - r * 0.6, r]);
    }
    const shape = (grow: number) => {
      g.beginPath();
      for (const [x, y, r] of lumps) {
        g.moveTo(x + r + grow, y);
        g.arc(x, y, r + grow, 0, Math.PI * 2);
      }
      g.rect(lumps[0][0], base - h * 0.18 - grow, lumps[n - 1][0] - lumps[0][0], h * 0.18 + grow * 2);
    };
    // ink rim, then the body clipped flat at the bottom
    g.save();
    g.beginPath();
    g.rect(0, 0, w, base + 3);
    g.clip();
    g.fillStyle = '#7f8ea6';
    shape(4);
    g.fill();
    const body = g.createLinearGradient(0, 0, 0, base);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.62, '#f4f7fb');
    body.addColorStop(1, '#c9d5e6');
    g.fillStyle = body;
    shape(0);
    g.fill();
    g.restore();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Open cone from a lamp head down to the ground, bright at the top and fading to nothing. */
  function lightCone(x: number, groundY: number, headY: number, z: number): THREE.BufferGeometry {
    const h = headY - groundY - 0.1;
    const g = new THREE.CylinderGeometry(0.24, 2.7, h, 20, 4, true);
    g.translate(x, groundY + 0.1 + h / 2, z);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(LIGHTING.street.color);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - groundY - 0.1) / h; // 0 at the ground, 1 at the lamp
      const k = LIGHTING.coneOpacity * t ** 1.7;
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  }

  /** Fluorescent panels on the ceiling of an enterable building, and the lights they give. */
  function ceilingLights(id: string): void {
    const walls = map.solids.filter((s) => s.group === id && s.kind === 'wall');
    if (walls.length === 0) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
    for (const w of walls) {
      x0 = Math.min(x0, w.x - w.sx / 2); x1 = Math.max(x1, w.x + w.sx / 2);
      z0 = Math.min(z0, w.z - w.sz / 2); z1 = Math.max(z1, w.z + w.sz / 2);
      top = Math.max(top, w.y + w.sy / 2);
    }
    const roof = map.solids.find((s) => s.group === id && s.kind === 'roof');
    const ceiling = roof ? roof.y - roof.sy / 2 : top;
    const along = x1 - x0 >= z1 - z0 ? 'x' : 'z';
    const long = Math.max(x1 - x0, z1 - z0), short = Math.min(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(long / 9)), m = Math.max(1, Math.round(short / 12));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const u = (i + 0.5) / n, v = (j + 0.5) / m;
        const x = along === 'x' ? x0 + (x1 - x0) * u : x0 + (x1 - x0) * v;
        const z = along === 'x' ? z0 + (z1 - z0) * v : z0 + (z1 - z0) * u;
        box('lit').add(
          { x, y: ceiling - 0.04, z, sx: along === 'x' ? 1.8 : 0.32, sy: 0.06, sz: along === 'x' ? 0.32 : 1.8 },
          { color: 0xf2f6ff },
        );
        lights.push({ x, y: ceiling - 0.3, z, kind: 'interior' });
      }
    }
  }

  /** Soft glow around the sun (added to the sky). */
  function sunHaloTexture(): THREE.CanvasTexture {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const halo = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    halo.addColorStop(0, 'rgb(150,130,90)');
    halo.addColorStop(0.3, 'rgb(70,60,40)');
    halo.addColorStop(0.65, 'rgb(18,15,10)');
    halo.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** The sun: a solid cartoon disc with an ink rim (a cut-out). */
  function sunTexture(): THREE.CanvasTexture {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
    g.fillStyle = '#fff6d2';
    g.fill();
    g.lineWidth = s * 0.03;
    g.strokeStyle = '#e0a63a';
    g.stroke();
    g.beginPath();
    g.arc(s / 2 - s * 0.08, s / 2 - s * 0.08, s * 0.22, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function moonTexture(): THREE.CanvasTexture {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const halo = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    halo.addColorStop(0, 'rgba(200,214,255,0.55)');
    halo.addColorStop(0.16, 'rgba(160,180,235,0.22)');
    halo.addColorStop(0.45, 'rgba(110,130,190,0.06)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, s, s);
    // the disc, with a couple of soft darker "seas"
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.085, 0, Math.PI * 2);
    g.fillStyle = '#f1f3ff';
    g.fill();
    g.fillStyle = 'rgba(150,160,190,0.35)';
    for (const [dx, dy, r] of [[-0.025, -0.02, 0.03], [0.03, 0.025, 0.022], [0.01, -0.04, 0.015]]) {
      g.beginPath();
      g.arc(s / 2 + dx * s, s / 2 + dy * s, r * s, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ------------------------------------------------------------------ props
  function wheels(p: Prop, zs: number[], halfWidth: number, radius: number): void {
    const wheel = new THREE.CylinderGeometry(radius, radius, 0.16, 12);
    for (const z of zs) {
      for (const side of [-1, 1]) {
        const [x, y, zz] = partPos(p, side * halfWidth, radius, z);
        geo('smooth').add(wheel, trs(x, y, zz, p.ry, 1, 1, 1, 0, Math.PI / 2), 0x1c1d20);
      }
    }
    wheel.dispose();
  }

  function graffiti(p: Prop, i: number, lx: number, y: number, lz: number, w: number, h: number, facing: number): void {
    const text = GRAFFITI[Math.floor(hash(i * 7 + 3) * GRAFFITI.length)];
    const image = makeSignCanvas(text, 'graffiti', GRAFFITI_COLORS[Math.floor(hash(i * 11 + 1) * GRAFFITI_COLORS.length)], null, w / h);
    const [x, yy, z] = partPos(p, lx, y, lz);
    signs.add(image, 'decal', x, yy, z, p.ry + facing, w, h);
  }

  /** Places a CC0 model scaled to the prop's footprint; `color` repaints its body (cars). False if the model is missing. */
  function instance(name: string, p: Prop, tx: number, ty: number, tz: number, color?: number): boolean {
    const template = assets?.model(name);
    if (!template) return false;
    models.add(template, trs(p.x, p.y, p.z, p.ry, tx / template.size.x, ty / template.size.y, tz / template.size.z), color);
    return true;
  }

  /** Draws a prop's collision boxes as plain colored boxes (stand-in when no model / painter exists). */
  function fallbackBoxes(p: Prop, color: number, key = 'flat'): void {
    for (const lb of PROP_BOXES[p.type]) {
      if (lb.col === 'fence') continue;
      part(p, key, lb.x, lb.y - lb.sy / 2, lb.z, lb.sx, lb.sy, lb.sz, color, { skipBottom: p.y < 0.02 });
    }
  }

  function paintProp(p: Prop, i: number): void {
    switch (p.type) {
      case 'car': {
        const S = PROP_SIZES.car;
        const taxi = p.variant % 4 === 3;
        const ok = taxi
          ? instance('taxi', p, S.w, S.h, S.l)
          : instance('car', p, S.w, S.h * 0.92, S.l, CAR_COLORS[p.variant % CAR_COLORS.length]);
        if (!ok) {
          part(p, 'flat', 0, 0, 0, 1.85, 0.95, 4.4, CAR_COLORS[p.variant % CAR_COLORS.length], { skipBottom: true });
          part(p, 'flat', 0, 0.95, -0.25, 1.6, 0.5, 2.2, 0x1b1d21);
        }
        break;
      }
      case 'van': {
        const S = PROP_SIZES.van;
        if (!instance('van', p, S.w, S.h, S.l)) fallbackBoxes(p, 0xdadada);
        break;
      }
      case 'truck': {
        const S = PROP_SIZES.truck;
        if (!instance('truck', p, S.w, S.h, S.l)) {
          part(p, 'flat', 0, 0, 2.5, 2.3, 2.3, 2.0, 0x4a6b8a, { skipBottom: true });
          part(p, 'metal', 0, 0, -1.0, 2.5, 3.1, 5.0, 0xd8d8d0, { skipBottom: true, tile: 2 });
        }
        break;
      }
      case 'boxcar':
      case 'boxcar_open': {
        const S = PROP_SIZES.boxcar;
        const color = BOXCAR_COLORS[p.variant % BOXCAR_COLORS.length];
        part(p, 'flat', 0, 0.42, 0, 2.5, 0.55, S.l - 0.5, 0x2a2b2e);
        wheels(p, [-4.6, -3.4, 3.4, 4.6], 1.06, 0.44);
        if (p.type === 'boxcar') {
          part(p, 'metal', 0, 0.97, 0, S.w, S.h - 1.02, S.l, color, { tile: 2 });
          part(p, 'flat', 0, S.h - 0.05, 0, S.w - 0.3, 0.1, S.l - 0.2, shade(color, 0.6));
          for (const side of [-1, 1]) {
            part(p, 'metal', side * (S.w / 2 + 0.03), 1.1, 0, 0.07, 2.7, 2.8, shade(color, 0.78), { tile: 1.4 });
            part(p, 'flat', side * (S.w / 2 + 0.05), 3.84, 0, 0.08, 0.09, 5.8, 0x2a2b2e);
            part(p, 'flat', side * (S.w / 2 + 0.05), 1.02, 0, 0.08, 0.09, 5.8, 0x2a2b2e);
            for (const z of [-5.5, 5.5]) part(p, 'bars', side * (S.w / 2 + 0.04), 1.0, z, 0.03, 3.0, 0.5, 0x323538, { tile: 0.42 });
          }
          graffiti(p, i, S.w / 2 + 0.07, 2.25, (hash(i) - 0.5) * 6 + (hash(i + 1) > 0.5 ? 3.6 : -3.6), 3.4, 1.5, Math.PI / 2);
          if (hash(i + 9) > 0.4) graffiti(p, i + 31, -(S.w / 2 + 0.07), 2.2, hash(i + 2) > 0.5 ? 3.5 : -3.5, 3.0, 1.4, -Math.PI / 2);
        } else {
          for (const lb of PROP_BOXES.boxcar_open) {
            part(p, lb.part === 'floor' ? 'wood' : 'metal', lb.x, lb.y - lb.sy / 2, lb.z, lb.sx, lb.sy, lb.sz,
              lb.part === 'floor' ? 0x7b6a55 : lb.part === 'roof' ? shade(color, 0.6) : color, { tile: lb.part === 'floor' ? 1.2 : 2 });
          }
        }
        break;
      }
      case 'flatcar': {
        const S = PROP_SIZES.flatcar;
        part(p, 'flat', 0, 0.42, 0, 2.5, 0.5, S.l - 0.5, 0x2a2b2e);
        part(p, 'wood', 0, 0.9, 0, S.w, 0.2, S.l, 0x8a7355, { tile: 1.2 });
        wheels(p, [-4.6, -3.4, 3.4, 4.6], 1.06, 0.44);
        for (const z of [-5.6, 5.6]) for (const side of [-1, 1]) part(p, 'flat', side * 1.4, 1.1, z, 0.1, 0.45, 0.1, 0x2a2b2e);
        break;
      }
      case 'container': {
        const S = PROP_SIZES.container;
        const color = CONTAINER_COLORS[p.variant % CONTAINER_COLORS.length];
        part(p, 'metal', 0, 0, 0, S.w, S.h, S.l, color, { tile: 1.6, skipBottom: p.y < 0.02 });
        part(p, 'flat', 0, 0.15, S.l / 2 + 0.02, S.w - 0.2, S.h - 0.3, 0.05, shade(color, 0.72));
        for (const x of [-0.45, 0.45]) part(p, 'flat', x, 0.2, S.l / 2 + 0.06, 0.06, S.h - 0.4, 0.04, 0xc9c9c9);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(p, 'flat', sx * (S.w / 2 - 0.04), 0, sz * (S.l / 2 - 0.04), 0.14, S.h + 0.02, 0.14, shade(color, 0.55));
        if (hash(i + 4) > 0.5) graffiti(p, i + 17, S.w / 2 + 0.03, 1.3, 0, 2.6, 1.2, Math.PI / 2);
        break;
      }
      case 'crate':
      case 'crate_big': {
        const s = p.type === 'crate' ? 1.1 : 1.7;
        part(p, 'crate', 0, 0, 0, s, s, s, p.variant % 2 ? 0xcdb489 : 0xe0cfa8, { fit: true, skipBottom: p.y < 0.02 });
        break;
      }
      case 'pallet':
        for (const y of [0, 0.19, 0.38]) part(p, 'wood', 0, y, 0, 1.2, 0.12, 1.2, 0xb39a70, { tile: 0.8 });
        for (const x of [-0.5, 0, 0.5]) part(p, 'wood', x, 0.12, 0, 0.12, 0.07, 1.2, 0x8f7a58, { tile: 0.8 });
        break;
      case 'tires': {
        const t = new THREE.TorusGeometry(0.44, 0.18, 8, 16);
        for (let k = 0; k < 3; k++) {
          geo('smooth').add(t, trs(p.x + (hash(i + k) - 0.5) * 0.08, p.y + 0.18 + k * 0.3, p.z + (hash(i + k + 9) - 0.5) * 0.08, 0, 1, 1, 1, Math.PI / 2), 0x17181a);
        }
        t.dispose();
        break;
      }
      case 'tree': {
        const trunk = new THREE.CylinderGeometry(0.17, 0.27, 4.4, 7);
        geo('faceted').add(trunk, trs(p.x, p.y + 2.2, p.z), 0x5a4632);
        trunk.dispose();
        const blob = new THREE.IcosahedronGeometry(1, 1);
        const greens = [0x44703c, 0x4f7f44, 0x3a6434, 0x5a8a4a];
        const r = 2.0 + (p.variant % 3) * 0.3;
        const lumps: Array<[number, number, number, number]> = [[0, 4.9, 0, r], [r * 0.5, 4.3, r * 0.25, r * 0.7], [-r * 0.45, 4.5, -r * 0.3, r * 0.75], [0.1, 5.9, -0.2, r * 0.6]];
        lumps.forEach(([ox, oy, oz, rr], k) => {
          geo('faceted').add(blob, trs(p.x + ox, p.y + oy, p.z + oz, hash(i + k) * 6, rr, rr * 0.82, rr), greens[(p.variant + k) % greens.length]);
        });
        blob.dispose();
        break;
      }
      case 'lamp': {
        const pole = new THREE.CylinderGeometry(0.07, 0.1, 6.2, 8);
        geo('smooth').add(pole, trs(p.x, p.y + 3.1, p.z), 0x2e3238);
        pole.dispose();
        // the arm reaches toward the middle of the map
        const dir = p.x > 0 ? -1 : 1;
        box('flat').add({ x: p.x + dir * 0.75, y: p.y + 6.1, z: p.z, sx: 1.6, sy: 0.08, sz: 0.08 }, { color: 0x2e3238 });
        box(LIGHTING.street.intensity > 0 ? 'lit' : 'flat').add({ x: p.x + dir * 1.35, y: p.y + 6.0, z: p.z, sx: 0.6, sy: 0.1, sz: 0.3 }, { color: LIGHTING.lampHead });
        box('flat').add({ x: p.x + dir * 1.35, y: p.y + 6.08, z: p.z, sx: 0.7, sy: 0.08, sz: 0.36 }, { color: 0x2e3238 });
        const glow = new THREE.PlaneGeometry(11, 11);
        glow.rotateX(-Math.PI / 2);
        glow.translate(p.x + dir * 1.35, p.y + 0.04, p.z);
        glows.push(glow);
        const hx = p.x + dir * 1.35, hy = p.y + 5.92, hz = p.z;
        lights.push({ x: hx, y: hy - 0.2, z: hz, kind: 'street' });
        cones.push(lightCone(hx, p.y, hy, hz));
        break;
      }
      case 'bench':
        part(p, 'wood', 0.02, 0.42, 0, 0.5, 0.07, 1.9, 0x8f6d48, { tile: 0.7 });
        part(p, 'wood', -0.24, 0.5, 0, 0.07, 0.38, 1.9, 0x8f6d48, { tile: 0.7 });
        for (const z of [-0.8, 0.8]) part(p, 'flat', 0, 0, z, 0.5, 0.42, 0.07, 0x2e3238, { skipBottom: true });
        break;
      case 'hoop': {
        const pole = new THREE.CylinderGeometry(0.09, 0.11, 3.5, 8);
        geo('smooth').add(pole, trs(p.x, p.y + 1.75, p.z), 0x3a3f46);
        pole.dispose();
        part(p, 'flat', 0, 3.3, 0.45, 0.12, 0.12, 0.95, 0x3a3f46);
        part(p, 'flat', 0, 2.7, 0.92, 1.8, 1.05, 0.06, 0xeeeeea);
        part(p, 'flat', 0, 2.82, 0.96, 0.62, 0.46, 0.02, 0xc0392b);
        part(p, 'flat', 0, 2.86, 0.975, 0.5, 0.36, 0.02, 0xeeeeea);
        const rim = new THREE.TorusGeometry(0.23, 0.022, 6, 16);
        const [rx, ry, rz] = partPos(p, 0, 3.05, 1.22);
        geo('smooth').add(rim, trs(rx, ry, rz, 0, 1, 1, 1, Math.PI / 2), 0xe0531f);
        rim.dispose();
        break;
      }
      case 'busstop':
        for (const lb of PROP_BOXES.busstop) {
          const [x, y, z] = partPos(p, lb.x, lb.y, lb.z);
          if (lb.part === 'glass') box('glass').add({ x, y, z, sx: lb.sx, sy: lb.sy, sz: lb.sz, q: yawQ(p.ry) }, { color: 0x9fd0e6 });
          else box('flat').add({ x, y, z, sx: lb.sx, sy: lb.sy, sz: lb.sz, q: yawQ(p.ry) }, { color: 0x2e3238 });
        }
        for (const z of [-1.7, 1.7]) part(p, 'flat', 0.75, 0, z, 0.08, 2.4, 0.08, 0x2e3238, { skipBottom: true });
        part(p, 'wood', -0.35, 0.45, 0, 0.4, 0.07, 2.4, 0x8f6d48, { tile: 0.7 });
        break;
      case 'acunit': {
        part(p, 'flat', 0, 0, 0, 1.2, 0.9, 1.2, 0xa9aeb4, { skipBottom: p.y < 0.02 });
        part(p, 'flat', 0, 0.2, 0.61, 1.0, 0.5, 0.02, 0x3a3f46);
        const fan = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 14);
        geo('smooth').add(fan, trs(p.x, p.y + 0.92, p.z), 0x2a2d31);
        fan.dispose();
        break;
      }
      case 'signal': {
        const pole = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8);
        geo('smooth').add(pole, trs(p.x, p.y + 2.1, p.z), 0x9a9fa6);
        pole.dispose();
        const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry, Math.PI / 4, 'YXZ'));
        const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry, -Math.PI / 4, 'YXZ'));
        box('flat').add({ x: p.x, y: p.y + 3.6, z: p.z, sx: 1.7, sy: 0.24, sz: 0.06, q: q1 }, { color: 0xf2f2ee });
        box('flat').add({ x: p.x, y: p.y + 3.6, z: p.z, sx: 1.7, sy: 0.24, sz: 0.06, q: q2 }, { color: 0xf2f2ee });
        part(p, 'flat', 0, 2.5, 0.05, 1.1, 0.42, 0.08, 0x1c1d20);
        for (const x of [-0.33, 0.33]) part(p, 'lit', x, 2.6, 0.1, 0.24, 0.24, 0.03, 0xff3b30);
        break;
      }
      case 'buffer':
        part(p, 'flat', 0, 0, 0, 2.4, 1.2, 0.9, 0xb3261e, { skipBottom: true });
        part(p, 'flat', 0, 0.75, -0.46, 2.4, 0.22, 0.03, 0xf2f2ee);
        part(p, 'flat', 0, 0.75, 0.46, 2.4, 0.22, 0.03, 0xf2f2ee);
        break;
      case 'shelf':
        part(p, 'shelf', 0, 0, 0, 0.6, 1.55, 5.0, 0xffffff, { tile: 1.55, skipBottom: true });
        part(p, 'flat', 0, 1.55, 0, 0.64, 0.04, 5.04, 0x3b3329);
        break;
      case 'barrier':
        part(p, 'concrete', 0, 0, 0, 0.6, 0.32, 2.6, 0xc9c9c2, { tile: 2, skipBottom: true });
        part(p, 'concrete', 0, 0.32, 0, 0.3, 0.68, 2.6, 0xc9c9c2, { tile: 2 });
        part(p, 'flat', 0, 0.86, 0, 0.32, 0.1, 2.62, 0xe0a81c);
        break;
      case 'dumpster':
        if (!instance('dumpster', p, 1.3, 1.5, 2.2)) fallbackBoxes(p, 0x2f5d3a);
        break;
      case 'hydrant':
        if (!instance('hydrant', p, 0.5, 0.8, 0.42)) fallbackBoxes(p, 0xc0392b);
        break;
      case 'trashcan':
        if (!instance('trashcan', p, 0.6, 0.95, 0.6)) fallbackBoxes(p, 0x3a3f45);
        break;
      case 'cone':
        if (!instance('cone', p, 0.42, 0.62, 0.42)) {
          const c = new THREE.ConeGeometry(0.2, 0.6, 10);
          geo('smooth').add(c, trs(p.x, p.y + 0.3, p.z), 0xff7a1a);
          c.dispose();
        }
        break;
      case 'banner': {
        const team = (p.team ?? 0) as TeamId;
        const t = svgTexture(crewLogoSvg(team), 256);
        // printed cloth: lit by the scene, with a faint glow so the logo still reads at night
        const mat = new THREE.MeshStandardMaterial({
          map: t, transparent: true, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3,
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), mat);
        const [x, , z] = partPos(p, 0, 0, 0.12);
        m.position.set(x, 4.6, z);
        m.rotation.y = p.ry;
        extras.push(m);
        // cloth backing in the crew's dark shade
        part(p, 'flat', 0, 2.0, 0.05, 5.4, 5.4, 0.06, crewColorHex(team, 'dark'));
        part(p, 'flat', 0, 7.4, 0.06, 5.8, 0.14, 0.14, 0x2e3238);
        disposables.push(t, mat, m.geometry);
        break;
      }
      case 'palm': {
        // a leaning, slightly curved trunk and a crown of drooping fronds
        const h = 6.2 + (p.variant % 3) * 0.6;
        const lean = 0.12 + hash(i + 3) * 0.12;
        const seg = new THREE.CylinderGeometry(0.16, 0.22, h / 3, 7);
        let tx = p.x, ty = p.y, tz = p.z;
        for (let k = 0; k < 3; k++) {
          const tilt = lean * (k + 1) * 0.6;
          const dx = Math.sin(p.ry) * Math.sin(tilt) * (h / 3), dz = Math.cos(p.ry) * Math.sin(tilt) * (h / 3);
          geo('faceted').add(seg, trs(tx + dx / 2, ty + (h / 3) / 2, tz + dz / 2, p.ry, 1 - k * 0.12, 1, 1 - k * 0.12, tilt), 0x7a6247);
          tx += dx; ty += (h / 3) * Math.cos(tilt); tz += dz;
        }
        seg.dispose();
        const frond = new THREE.ConeGeometry(0.55, 3.4, 4, 1);
        frond.translate(0, 1.7, 0);
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + hash(i + k) * 0.4;
          geo('faceted').add(frond, trs(tx, ty - 0.1, tz, a, 1, 1, 0.35, 1.9 + hash(i * 3 + k) * 0.35), [0x4f8a3c, 0x5c9a44, 0x447a34][k % 3]);
        }
        frond.dispose();
        const nut = new THREE.IcosahedronGeometry(0.22, 0);
        for (let k = 0; k < 3; k++) geo('faceted').add(nut, trs(tx + Math.cos(k * 2.1) * 0.3, ty - 0.35, tz + Math.sin(k * 2.1) * 0.3), 0x5a4a2a);
        nut.dispose();
        break;
      }
      case 'bush': {
        const blob = new THREE.IcosahedronGeometry(1, 0);
        const greens = [0x3f6b34, 0x4b7d3d, 0x36602f];
        const r = 0.9 + (p.variant % 3) * 0.25;
        for (let k = 0; k < 3; k++) {
          const a = p.ry + k * 2.1;
          geo('faceted').add(blob, trs(p.x + Math.cos(a) * r * 0.5, p.y + r * 0.55, p.z + Math.sin(a) * r * 0.5, hash(i + k) * 6, r, r * 0.75, r), greens[(p.variant + k) % 3]);
        }
        blob.dispose();
        break;
      }
      case 'rock':
      case 'boulder': {
        const big = p.type === 'boulder';
        const g = new THREE.DodecahedronGeometry(1, 0);
        const sx = big ? 2.0 : 0.95, sy = big ? 1.45 : 0.75;
        geo('faceted').add(g, trs(p.x, p.y + sy * 0.62, p.z, p.ry, sx, sy, sx * (0.85 + hash(i) * 0.3)), [0x8a857a, 0x7a766c, 0x969083][p.variant % 3]);
        g.dispose();
        break;
      }
      case 'log': {
        const g = new THREE.CylinderGeometry(0.4, 0.45, 6, 9);
        geo('faceted').add(g, trs(p.x, p.y + 0.4, p.z, p.ry, 1, 1, 1, Math.PI / 2), 0x5e4a36);
        g.dispose();
        break;
      }
      case 'umbrella': {
        const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6);
        geo('smooth').add(pole, trs(p.x, p.y + 1.2, p.z), 0xe8e8e8);
        pole.dispose();
        const top = new THREE.ConeGeometry(1.5, 0.55, 10, 1, true);
        const colors = [0xe05a8a, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xe9c46a];
        geo('faceted').add(top, trs(p.x, p.y + 2.45, p.z, p.ry), colors[p.variant % colors.length]);
        top.dispose();
        break;
      }
      case 'boat': {
        const hull = [0xf2f2ee, 0x2f5f9e, 0xc0392b][p.variant % 3];
        part(p, 'flat', 0, 0, 0, 2.2, 0.7, 5.6, hull, { skipBottom: true });
        part(p, 'flat', 0, 0, 2.95, 1.2, 0.7, 0.4, hull);
        part(p, 'flat', 0, 0.7, -0.6, 2.0, 0.08, 3.2, 0x8f6d48);
        part(p, 'flat', 0, 0.7, -2.4, 0.5, 0.45, 0.5, 0x2e3238);
        break;
      }
      default:
        fallbackBoxes(p, 0x808080);
    }
  }
}
