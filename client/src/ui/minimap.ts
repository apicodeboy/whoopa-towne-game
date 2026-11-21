import { CREWS } from '@shared/config/crews';
import type { MapDef } from '@shared/map/types';
import { terrainHeight } from '@shared/map/terrain';
import type { HudState } from './hud';

const W = 232;
const AREA_FILL: Record<string, string> = {
  grass: '#2f4a2d', path: '#5c5647', sidewalk: '#3b3e44', alley: '#26282c', lot: '#2c2e33', court: '#6a3d2c',
  gravel: '#3a362f', crossing: '#4c4233', floor: '#3a332b', base0: '#16264a', base1: '#4a1616',
  jungle: '#25391f', dirt: '#4a3b28', sand: '#8c7b55', surf: '#9cc4c8', ocean: '#1c4a66', plaza: '#47484c', towel: '#8c7b55',
  desert: '#6e5c3e', oasis: '#2f6f86',
  // CAP'S HOUSE and the country
  corn: '#4f6e2c', wheat: '#8a7436', sunflower: '#8f7a1c', soil: '#4a3826', stubble: '#6e6238', mud: '#3c2e22',
};

/**
 * North-up minimap of the whole map: static geometry is drawn once to an offscreen canvas,
 * then teammates, yourself and zone status are drawn on top a few times per second.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private map: MapDef;
  private scale: number;
  /** Visible size (CSS px). */
  private h: number;
  private viewW = W;
  /** Size of the whole map at this scale; larger than the view when following the player. */
  private fullW: number;
  private fullH: number;
  private offX = 0;
  private offY = 0;
  private dpr: number;
  private timer = 0;
  private lastT = 0;

  /**
   * `follow` = a big map: draw it at `pxPerM` and scroll a `height`-tall window that keeps
   * the player in the middle. Otherwise the whole map fits the box.
   */
  constructor(map: MapDef, follow?: { pxPerM: number; height: number }) {
    this.map = map;
    const b = map.bounds;
    this.scale = follow ? follow.pxPerM : W / (b.maxX - b.minX);
    this.fullW = Math.round((b.maxX - b.minX) * this.scale);
    this.fullH = Math.round((b.maxZ - b.minZ) * this.scale);
    this.h = follow ? follow.height : this.fullH;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = W * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = this.fullW * this.dpr;
    this.bg.height = this.fullH * this.dpr;
    this.renderBackground();
  }

  private X(x: number): number {
    return (x - this.map.bounds.minX) * this.scale;
  }

  private Z(z: number): number {
    return (z - this.map.bounds.minZ) * this.scale;
  }

  private renderBackground(): void {
    const g = this.bg.getContext('2d')!;
    const s = this.scale;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#1d1f24';
    g.fillRect(0, 0, this.fullW, this.fullH);
    const R = this.map.round;
    if (R) {
      // a round map: grass out to the circle, the paved square in the middle
      g.fillStyle = '#2f4a2d';
      g.beginPath();
      g.arc(this.X(R.x), this.Z(R.z), R.r * s, 0, Math.PI * 2);
      g.fill();
      if (R.paved) {
        g.fillStyle = '#1d1f24';
        g.fillRect(this.X(R.paved.x0), this.Z(R.paved.z0), (R.paved.x1 - R.paved.x0) * s, (R.paved.z1 - R.paved.z0) * s);
      }
    }
    for (const a of [...this.map.areas].sort((p, q) => (p.layer ?? 1) - (q.layer ?? 1))) {
      g.fillStyle = AREA_FILL[a.kind] ?? '#2a2c31';
      g.fillRect(this.X(a.x0), this.Z(a.z0), (a.x1 - a.x0) * s, (a.z1 - a.z0) * s);
    }
    // hills: lighter the higher they are, a darker rim at the foot
    const T = this.map.terrain;
    if (T) {
      const top = Math.max(...T.hills.map((h) => h.height));
      for (let x = T.x0; x < T.x1; x += 1) {
        for (let z = T.z0; z < T.z1; z += 1) {
          const y = terrainHeight(T, x + 0.5, z + 0.5);
          if (y < 0.15) continue;
          const k = y / top;
          g.fillStyle = `rgba(${Math.round(60 + 70 * k)},${Math.round(84 + 70 * k)},${Math.round(52 + 40 * k)},0.9)`;
          g.fillRect(this.X(x), this.Z(z), s + 0.5, s + 0.5);
        }
      }
    }
    for (const r of this.map.roads) {
      g.beginPath();
      r.points.forEach((p, i) => (i ? g.lineTo(this.X(p.x), this.Z(p.z)) : g.moveTo(this.X(p.x), this.Z(p.z))));
      g.lineJoin = 'round';
      if (r.kind === 'road') {
        g.strokeStyle = '#15161a';
        g.lineWidth = r.width * s;
        g.stroke();
      } else if (r.kind === 'trail' || r.kind === 'creek') {
        g.strokeStyle = r.kind === 'trail' ? '#5b4a32' : '#2f6f86';
        g.lineWidth = r.width * s;
        g.stroke();
      } else {
        g.strokeStyle = '#4a443a';
        g.lineWidth = r.width * s;
        g.stroke();
        g.strokeStyle = '#8a8f96';
        g.lineWidth = 1;
        g.setLineDash([2, 2]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // solids, low to high so roofs end up on top
    const solids = this.map.solids
      .filter((x) => x.kind !== 'ground' && x.kind !== 'perimeter' && x.kind !== 'bound' && (x.col ?? 'solid') !== 'none')
      .sort((p, q) => p.y + p.sy / 2 - (q.y + q.sy / 2));
    for (const x of solids) {
      const fence = (x.col ?? 'solid') === 'fence';
      const top = x.y + x.sy / 2;
      let fill = '#6b6f78';
      if (x.kind === 'building' || x.kind === 'roof') fill = '#7d6a5c';
      else if (x.kind === 'wall' || x.kind === 'parapet') fill = '#a08a78';
      else if (x.kind === 'deck') fill = '#6f7680';
      else if (x.kind === 'stairs' || x.kind === 'fireescape' || x.kind === 'ramp') fill = '#c9a04a';
      else if (x.kind === 'stairfill') continue;
      else if (x.kind === 'cliff') fill = '#4d4740';
      else if (x.kind === 'ruin') fill = '#7a7864';
      else if (x.prop !== undefined) {
        const t = this.map.props[x.prop]?.type;
        if (t === 'tree' || t === 'palm') {
          // canopy, not trunk
          g.fillStyle = '#3d6a34';
          g.beginPath();
          g.arc(this.X(x.x), this.Z(x.z), Math.max(1, 2 * s), 0, Math.PI * 2);
          g.fill();
          continue;
        }
        fill = top > 2 ? '#5b7f9a' : '#4a6478';
      }
      else if (top < 1.4) fill = '#565a62';
      g.save();
      g.translate(this.X(x.x), this.Z(x.z));
      g.rotate(-(x.ry ?? 0));
      const len = x.rx ? Math.cos(x.rx) * x.sz : x.sz;
      if (fence) {
        g.fillStyle = 'rgba(160,210,205,0.55)';
        g.fillRect((-x.sx * s) / 2, (-len * s) / 2, Math.max(1, x.sx * s), Math.max(1, len * s));
      } else {
        g.fillStyle = fill;
        g.fillRect((-x.sx * s) / 2, (-len * s) / 2, Math.max(0.8, x.sx * s), Math.max(0.8, len * s));
      }
      g.restore();
    }
    if (R) {
      // everything past the rim is out of bounds: dark, with the rim drawn round it
      g.save();
      g.beginPath();
      g.rect(0, 0, this.fullW, this.fullH);
      g.arc(this.X(R.x), this.Z(R.z), R.r * s, 0, Math.PI * 2, true);
      g.fillStyle = '#121316';
      g.fill('evenodd');
      g.beginPath();
      g.arc(this.X(R.x), this.Z(R.z), R.r * s, 0, Math.PI * 2);
      g.strokeStyle = '#5a5248';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
    // district names on big maps
    if (this.fullW > W) {
      g.font = 'bold 9px Helvetica, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (const l of this.map.labels) {
        if (l.text.endsWith(' BASE')) continue;
        g.strokeText(l.text, this.X(l.x), this.Z(l.z));
        g.fillText(l.text, this.X(l.x), this.Z(l.z));
      }
    }
  }

  draw(st: HudState): void {
    // ~12 fps is plenty for a minimap
    const now = performance.now();
    this.timer += now - this.lastT;
    this.lastT = now;
    if (this.timer < 80) return;
    this.timer = 0;

    const g = this.ctx;
    // scroll so the player stays in the middle (clamped to the map's edges)
    const clampOff = (v: number, max: number) => Math.max(0, Math.min(max, v));
    this.offX = clampOff(this.X(st.myX) - this.viewW / 2, this.fullW - this.viewW);
    this.offY = clampOff(this.Z(st.myZ) - this.h / 2, this.fullH - this.h);
    const d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, this.offX * d, this.offY * d, this.viewW * d, this.h * d, 0, 0, this.viewW * d, this.h * d);
    g.setTransform(d, 0, 0, d, -this.offX * d, -this.offY * d);

    // zones
    if (st.mode === 'turf') {
      this.map.zones.forEach((z, i) => {
        const zs = st.zones[i];
        if (!zs) return;
        const cx = this.X(z.x), cy = this.Z(z.z), r = z.radius * this.scale;
        const color = zs.owner >= 0 ? CREWS[zs.owner as 0 | 1].color : '#e8e8e8';
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fillStyle = zs.owner >= 0 ? color + '55' : 'rgba(255,255,255,0.14)';
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = zs.contested ? '#ffd23f' : color;
        g.stroke();
        if (zs.progress > 0 && zs.capTeam >= 0) {
          g.beginPath();
          g.arc(cx, cy, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * zs.progress);
          g.strokeStyle = CREWS[zs.capTeam as 0 | 1].light;
          g.lineWidth = 2.5;
          g.stroke();
        }
        g.fillStyle = '#fff';
        g.font = 'bold 11px Helvetica, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(z.id, cx, cy + 0.5);
      });
    }

    // JUMP OFF THE PORCH: the riot (everything outside the safe area) and where it is heading
    if (st.porch) {
      const z = st.porch.zone, n = st.porch.next;
      g.save();
      g.beginPath();
      g.rect(this.offX, this.offY, this.viewW, this.h);
      g.arc(this.X(z.x), this.Z(z.z), z.r * this.scale, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(230, 40, 30, 0.32)';
      g.fill('evenodd');
      g.beginPath();
      g.arc(this.X(z.x), this.Z(z.z), z.r * this.scale, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255, 80, 60, 0.95)';
      g.lineWidth = 1.6;
      g.stroke();
      if (n.r < z.r - 0.5) {
        g.beginPath();
        g.arc(this.X(n.x), this.Z(n.z), Math.max(1.5, n.r * this.scale), 0, Math.PI * 2);
        g.setLineDash([4, 3]);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.4;
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    }

    // teammates
    for (const p of st.players) {
      if (p.me || p.team !== st.myTeam || !p.alive) continue;
      const x = this.X(p.x), y = this.Z(p.z);
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fillStyle = CREWS[p.team].color;
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = '#fff';
      g.stroke();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - Math.sin(p.yaw) * 6.5, y - Math.cos(p.yaw) * 6.5);
      g.stroke();
    }

    // danger marks: a red diamond, with a ring pulsing out for its first moments
    for (const m of st.marks ?? []) {
      const x = this.X(m.x), y = this.Z(m.z);
      g.save();
      g.translate(x, y);
      if (m.age < 1.5) {
        g.beginPath();
        g.arc(0, 0, 5 + (m.age % 0.75) * 16, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255,70,50,${(1 - (m.age % 0.75) / 0.75).toFixed(2)})`;
        g.lineWidth = 2;
        g.stroke();
      }
      g.rotate(Math.PI / 4);
      g.fillStyle = '#ff3b2f';
      g.fillRect(-4, -4, 8, 8);
      g.lineWidth = 1.4;
      g.strokeStyle = '#ffffff';
      g.strokeRect(-4, -4, 8, 8);
      g.restore();
    }

    // me: arrow pointing along the view yaw
    if (st.alive) {
      const x = this.X(st.myX), y = this.Z(st.myZ);
      g.save();
      g.translate(x, y);
      g.rotate(-st.viewYaw);
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(4.6, 5);
      g.lineTo(0, 2.4);
      g.lineTo(-4.6, 5);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = CREWS[st.myTeam].color;
      g.stroke();
      g.restore();
    }
  }
}
