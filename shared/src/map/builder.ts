import type { TeamId } from '../config/crews';
import { propSolids } from './props';
import type {
  AreaDef, CollisionKind, LabelDef, MapDef, Prop, PropType, RoadDef, SignDef, Solid, SpawnPoint, ZoneDef,
} from './types';

/** Compass sides. North is -Z, east is +X. */
export type Side = 'n' | 's' | 'e' | 'w';

/** Heading (ry) whose local +Z points toward the given side. */
export function sideHeading(side: Side | number): number {
  if (typeof side === 'number') return side;
  switch (side) {
    case 's': return 0;
    case 'e': return Math.PI / 2;
    case 'n': return Math.PI;
    case 'w': return -Math.PI / 2;
  }
}

export interface Opening {
  side: Side;
  /** Center of the opening along the wall (x for n/s walls, z for e/w walls). */
  at: number;
  /** Width. */
  w: number;
  /** Door height / window top (from the floor). */
  top?: number;
  /** Window sill height. 0 or undefined = a door. */
  sill?: number;
}

export interface ShellOpts {
  id: string;
  x0: number; x1: number; z0: number; z1: number;
  /** Roof top height. */
  h: number;
  y0?: number;
  wallT?: number;
  roofT?: number;
  style?: string;
  openings?: Opening[];
  /** Low wall around the roof edge; gaps where stairs arrive. */
  parapet?: { h?: number; gaps?: Array<{ side: Side; at: number; w: number }> };
  roof?: boolean;
  color?: number;
  /** A shop awning over the entrance on this side, and ceiling lights inside. */
  awning?: { side: Side; color: number };
}

export interface RampOpts {
  kind?: string;
  /** Bottom-center start point. */
  x: number; z: number; y0: number;
  /** Direction of ascent. */
  dir: Side | number;
  run: number;
  rise: number;
  width: number;
  thickness?: number;
  /** Fill the space under the ramp with solid blocks (concrete stairs). */
  fill?: boolean;
  /** Guard rails (bullets pass through). Sides are relative to the direction of ascent. */
  rails?: 'left' | 'right' | 'both' | 'none';
  style?: string;
  group?: string;
  col?: CollisionKind;
}

export class MapBuilder {
  solids: Solid[] = [];
  props: Prop[] = [];
  areas: AreaDef[] = [];
  roads: RoadDef[] = [];
  signs: SignDef[] = [];
  labels: LabelDef[] = [];
  hotspots: Array<{ x: number; z: number }> = [];
  lootSpots: Array<{ x: number; y: number; z: number }> = [];
  districts: Array<{ name: string; x: number; z: number }> = [];
  backdrop: MapDef['backdrop'];
  spawns: [SpawnPoint[], SpawnPoint[]] = [[], []];
  zones: ZoneDef[] = [];

  /** Axis-aligned box from extents. */
  box(kind: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, extra?: Partial<Solid>): Solid {
    const s: Solid = {
      kind,
      x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
      sx: Math.abs(x1 - x0), sy: Math.abs(y1 - y0), sz: Math.abs(z1 - z0),
      ...extra,
    };
    this.solids.push(s);
    return s;
  }

  /** Box from center + size, rotated about Y. */
  rbox(kind: string, cx: number, cz: number, sx: number, sz: number, y0: number, h: number, ry = 0, extra?: Partial<Solid>): Solid {
    const s: Solid = { kind, x: cx, y: y0 + h / 2, z: cz, sx, sy: h, sz, ry, ...extra };
    this.solids.push(s);
    return s;
  }

  /** Straight wall between two points (any angle). */
  wallLine(kind: string, ax: number, az: number, bx: number, bz: number, y0: number, h: number, t: number, extra?: Partial<Solid>): Solid {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    return this.rbox(kind, (ax + bx) / 2, (az + bz) / 2, t, len, y0, h, ry, extra);
  }

  /**
   * A ramp (used for stairs, fire escapes and embankments). The walkable top surface
   * starts at (x, y0, z) and rises `rise` over `run` horizontal meters toward `dir`.
   */
  ramp(o: RampOpts): Solid {
    const ry = sideHeading(o.dir);
    const dx = Math.sin(ry), dz = Math.cos(ry);
    const a = Math.atan2(o.rise, o.run);
    const len = Math.hypot(o.run, o.rise);
    const t = o.thickness ?? 0.3;
    const sa = Math.sin(a), ca = Math.cos(a);
    const kind = o.kind ?? 'stairs';
    // top-surface center, pushed down along the surface normal by half the thickness
    const cx = o.x + dx * (o.run / 2) + dx * sa * (t / 2);
    const cy = o.y0 + o.rise / 2 - ca * (t / 2);
    const cz = o.z + dz * (o.run / 2) + dz * sa * (t / 2);
    const s: Solid = {
      kind, x: cx, y: cy, z: cz, sx: o.width, sy: t, sz: len, ry, rx: -a,
      style: o.style, group: o.group, col: o.col,
      meta: { rise: o.rise, run: o.run, x0: o.x, z0: o.z, y0: o.y0 },
    };
    this.solids.push(s);

    if (o.fill) {
      const n = Math.max(1, Math.round(o.run / 0.9));
      const segRun = o.run / n;
      for (let i = 1; i < n; i++) {
        const h = o.rise * (i / n) - 0.04;
        if (h < 0.12) continue;
        const mx = o.x + dx * segRun * (i + 0.5);
        const mz = o.z + dz * segRun * (i + 0.5);
        this.solids.push({
          kind: 'stairfill', x: mx, y: o.y0 + h / 2, z: mz, sx: o.width, sy: h, sz: segRun, ry,
          style: o.style, group: o.group,
        });
      }
    }

    const rails = o.rails ?? 'none';
    if (rails !== 'none') {
      const railH = 1.0;
      // right-hand side when facing the direction of ascent: d x up = (-dz, 0, dx)
      const rxv = -dz, rzv = dx;
      const mid = {
        x: o.x + dx * (o.run / 2) - dx * sa * (railH / 2),
        y: o.y0 + o.rise / 2 + ca * (railH / 2),
        z: o.z + dz * (o.run / 2) - dz * sa * (railH / 2),
      };
      const off = o.width / 2 - 0.04;
      const add = (sign: number) => {
        this.solids.push({
          kind: 'rail', x: mid.x + rxv * off * sign, y: mid.y, z: mid.z + rzv * off * sign,
          sx: 0.07, sy: railH, sz: len, ry, rx: -a, col: 'fence', group: o.group,
        });
      };
      if (rails === 'right' || rails === 'both') add(1);
      if (rails === 'left' || rails === 'both') add(-1);
    }
    return s;
  }

  /**
   * Generates wall segments along one side of a rectangle, leaving gaps for openings.
   * Doors get a lintel above; windows get a sill wall below and a lintel above.
   */
  private wallWithOpenings(
    kind: string, side: Side,
    x0: number, x1: number, z0: number, z1: number,
    y0: number, top: number, t: number,
    openings: Opening[], extra: Partial<Solid>,
  ): void {
    const alongX = side === 'n' || side === 's';
    // n/s walls span the full x range; e/w walls fit between them to avoid overlapping corners
    const a0 = alongX ? x0 : z0 + t;
    const a1 = alongX ? x1 : z1 - t;
    const list = openings.filter((o) => o.side === side).sort((p, q) => p.at - q.at);
    const seg = (s0: number, s1: number, b: number, tp: number, k = kind) => {
      if (s1 - s0 < 0.02 || tp - b < 0.02) return;
      const meta = { ...(extra.meta ?? {}), side };
      if (alongX) {
        const zz0 = side === 'n' ? z0 : z1 - t;
        this.box(k, s0, s1, zz0, zz0 + t, b, tp, { ...extra, meta });
      } else {
        const xx0 = side === 'w' ? x0 : x1 - t;
        this.box(k, xx0, xx0 + t, s0, s1, b, tp, { ...extra, meta });
      }
    };
    let cursor = a0;
    for (const o of list) {
      const left = Math.max(a0, o.at - o.w / 2);
      const right = Math.min(a1, o.at + o.w / 2);
      seg(cursor, left, y0, top);
      const oTop = y0 + (o.top ?? 2.3);
      const sill = o.sill ?? 0;
      if (sill > 0) seg(left, right, y0, y0 + sill);
      seg(left, right, oTop, top);
      cursor = right;
    }
    seg(cursor, a1, y0, top);
  }

  /** An enterable building: four walls with door/window openings and a roof slab. */
  shell(o: ShellOpts): void {
    const y0 = o.y0 ?? 0;
    const t = o.wallT ?? 0.3;
    const roofT = o.roofT ?? 0.3;
    const hasRoof = o.roof !== false;
    const wallTop = hasRoof ? o.h - roofT : o.h;
    const extra: Partial<Solid> = { style: o.style ?? 'brick', group: o.id, color: o.color };
    const openings = o.openings ?? [];
    for (const side of ['n', 's', 'w', 'e'] as Side[]) {
      this.wallWithOpenings('wall', side, o.x0, o.x1, o.z0, o.z1, y0, wallTop, t, openings, extra);
    }
    if (hasRoof) {
      const meta = o.awning ? { awning: o.awning.color, front: o.awning.side } : undefined;
      this.box('roof', o.x0, o.x1, o.z0, o.z1, wallTop, o.h, { style: o.style ?? 'brick', group: o.id, meta });
    }
    // interior floor patch (visual)
    this.areas.push({ kind: 'floor', x0: o.x0 + t, x1: o.x1 - t, z0: o.z0 + t, z1: o.z1 - t, layer: 3 });
    if (o.parapet) this.parapet(o.id, o.x0, o.x1, o.z0, o.z1, o.h, o.parapet.h ?? 0.9, o.parapet.gaps ?? [], o.style);
  }

  /** A solid (non-enterable) building block. */
  building(o: {
    id: string; x0: number; x1: number; z0: number; z1: number; h: number;
    style?: string; color?: number; roofStyle?: 'flat' | 'pitched';
    parapet?: { h?: number; gaps?: Array<{ side: Side; at: number; w: number }> };
  }): Solid {
    const s = this.box('building', o.x0, o.x1, o.z0, o.z1, 0, o.h, {
      style: o.style ?? 'brick', group: o.id, color: o.color,
      meta: { roof: o.roofStyle ?? 'flat' },
    });
    if (o.parapet) this.parapet(o.id, o.x0, o.x1, o.z0, o.z1, o.h, o.parapet.h ?? 0.9, o.parapet.gaps ?? [], o.style);
    return s;
  }

  /** Low wall around the edge of a roof. */
  parapet(
    group: string, x0: number, x1: number, z0: number, z1: number, y: number, h: number,
    gaps: Array<{ side: Side; at: number; w: number }>, style?: string,
  ): void {
    const t = 0.25;
    const openings: Opening[] = gaps.map((g) => ({ side: g.side, at: g.at, w: g.w, top: h + 1 }));
    for (const side of ['n', 's', 'w', 'e'] as Side[]) {
      this.wallWithOpenings('parapet', side, x0, x1, z0, z1, y, y + h, t, openings, { style, group });
    }
  }

  prop(type: PropType, x: number, z: number, ry = 0, variant = 0, y = 0, team?: TeamId): Prop {
    const p: Prop = { type, x, y, z, ry, variant, team };
    this.props.push(p);
    return p;
  }

  area(kind: string, x0: number, x1: number, z0: number, z1: number, layer = 1, color?: number): void {
    this.areas.push({ kind, x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), layer, color });
  }

  road(kind: RoadDef['kind'], points: Array<{ x: number; z: number }>, width: number, centerLine = true): void {
    this.roads.push({ kind, points, width, centerLine });
  }

  sign(s: SignDef): void {
    this.signs.push(s);
  }

  label(text: string, x: number, z: number): void {
    this.labels.push({ text, x, z });
  }

  spawn(team: TeamId, x: number, z: number, yaw: number, y = 0): void {
    this.spawns[team].push({ x, y, z, yaw });
  }

  zone(id: string, name: string, x: number, z: number, radius: number): void {
    this.zones.push({ id, name, x, z, radius });
  }

  hotspot(x: number, z: number): void {
    this.hotspots.push({ x, z });
  }

  /** A good place for loot (y = the floor it rests on). */
  loot(x: number, z: number, y = 0): void {
    this.lootSpots.push({ x, y, z });
  }

  build(id: string, name: string, bounds: MapDef['bounds']): MapDef {
    // Expand props into their collision solids (appended after hand-placed solids).
    const solids = this.solids.slice();
    this.props.forEach((p, i) => {
      for (const s of propSolids(p, i)) solids.push(s);
    });
    return {
      id, name, bounds, solids,
      props: this.props,
      spawns: this.spawns,
      zones: this.zones,
      areas: this.areas,
      roads: this.roads,
      signs: this.signs,
      labels: this.labels,
      hotspots: this.hotspots,
      ...(this.lootSpots.length ? { lootSpots: this.lootSpots } : {}),
      ...(this.districts.length ? { districts: this.districts } : {}),
      ...(this.backdrop ? { backdrop: this.backdrop } : {}),
    };
  }
}
