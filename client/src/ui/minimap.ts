import { CREWS } from '@shared/config/crews';
import type { MapDef } from '@shared/map/types';
import type { HudState } from './hud';

const W = 232;
const AREA_FILL: Record<string, string> = {
  grass: '#2f4a2d', path: '#5c5647', sidewalk: '#3b3e44', alley: '#26282c', lot: '#2c2e33', court: '#6a3d2c',
  gravel: '#3a362f', crossing: '#4c4233', floor: '#3a332b', base0: '#16264a', base1: '#4a1616',
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
  private h: number;
  private dpr: number;
  private timer = 0;
  private lastT = 0;

  constructor(map: MapDef) {
    this.map = map;
    const b = map.bounds;
    this.scale = W / (b.maxX - b.minX);
    this.h = Math.round((b.maxZ - b.minZ) * this.scale);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = W * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
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
    g.fillRect(0, 0, W, this.h);
    for (const a of [...this.map.areas].sort((p, q) => (p.layer ?? 1) - (q.layer ?? 1))) {
      g.fillStyle = AREA_FILL[a.kind] ?? '#2a2c31';
      g.fillRect(this.X(a.x0), this.Z(a.z0), (a.x1 - a.x0) * s, (a.z1 - a.z0) * s);
    }
    for (const r of this.map.roads) {
      g.beginPath();
      r.points.forEach((p, i) => (i ? g.lineTo(this.X(p.x), this.Z(p.z)) : g.moveTo(this.X(p.x), this.Z(p.z))));
      g.lineJoin = 'round';
      if (r.kind === 'road') {
        g.strokeStyle = '#15161a';
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
      .filter((x) => x.kind !== 'ground' && x.kind !== 'perimeter' && (x.col ?? 'solid') !== 'none')
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
      else if (x.prop !== undefined) fill = top > 2 ? '#5b7f9a' : '#4a6478';
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
  }

  draw(st: HudState): void {
    // ~12 fps is plenty for a minimap
    const now = performance.now();
    this.timer += now - this.lastT;
    this.lastT = now;
    if (this.timer < 80) return;
    this.timer = 0;

    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

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
