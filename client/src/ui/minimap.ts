import { CREWS } from '@shared/config/crews';
import type { MapDef } from '@shared/map/types';
import { terrainHeight } from '@shared/map/terrain';
import type { HudState } from './hud';

const W = 232;
/** Squad members on the minimap: one color each, numbered (you are 1). */
const SQUAD_COLORS = ['#ffd24a', '#4ad8ff', '#8cff5a', '#ff7ad9'];

/**
 * Manim's `smooth` rate function (a normalized sigmoid, the default easing of its animations):
 * starts and ends gently, quickest in the middle.
 */
function smooth(t: number, inflection = 10): number {
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const err = sig(-inflection / 2);
  return Math.min(1, Math.max(0, (sig(inflection * (t - 0.5)) - err) / (1 - 2 * err)));
}
const AREA_FILL: Record<string, string> = {
  grass: '#2f4a2d', path: '#5c5647', sidewalk: '#3b3e44', alley: '#26282c', lot: '#2c2e33', court: '#6a3d2c',
  gravel: '#3a362f', crossing: '#4c4233', floor: '#3a332b', base0: '#16264a', base1: '#4a1616',
  jungle: '#25391f', dirt: '#4a3b28', sand: '#8c7b55', surf: '#9cc4c8', ocean: '#1c4a66', plaza: '#47484c', towel: '#8c7b55',
  desert: '#6e5c3e', oasis: '#2f6f86',
  // CAP'S HOUSE and the country
  corn: '#4f6e2c', wheat: '#8a7436', sunflower: '#8f7a1c', soil: '#4a3826', stubble: '#6e6238', mud: '#3c2e22',
};

/**
 * The minimap (top left). Static geometry is drawn once to an offscreen canvas; on top of it,
 * about 30 times a second: the riot and the next safe area (animated, with the motion ideas of
 * Manim: eased Transforms, Create draw-ons, smooth rate functions), your squad, danger marks,
 * you with your view cone, upright labels, north and a scale bar. North up, or turning with
 * your view (Settings). Everything comes from the live game state: nothing is pre-rendered.
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
  /** Seconds since the minimap started (drives the motion). */
  private clock = 0;
  /** Eased: where you are drawn and which way you face. */
  private meX = 0;
  private meZ = 0;
  private meInit = false;
  private viewYaw = 0;
  /** Eased: the riot's safe area as drawn; the next one's draw-on progress (0..1). */
  private zoneShown = { x: 0, z: 0, r: 0 };
  private zoneInit = false;
  private nextKey = '';
  private nextT = 0;
  /** 0 calm .. 1 you are outside the safe area (the edge pulses with it). */
  private danger = 0;
  private lastR = Infinity;
  private shrinkSeen = -10;
  /** Bigger text where the box is drawn small (phones). */
  private textBoost = 1;

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
    const small = typeof matchMedia === 'function' && matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    this.textBoost = small ? 1.35 : 1;
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
    // (see-through where there is nothing: the box itself is glass over the game)
    g.fillStyle = 'rgba(24,26,31,0.82)';
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
      g.fillStyle = 'rgba(14,15,18,0.7)';
      g.fill('evenodd');
      g.beginPath();
      g.arc(this.X(R.x), this.Z(R.z), R.r * s, 0, Math.PI * 2);
      g.strokeStyle = '#5a5248';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
    // (district names are drawn on top every frame, so they stay upright and sharp)
  }

  draw(st: HudState): void {
    // ~30 fps: smooth enough for the motion below, cheap enough for phones
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastT) / 1000);
    this.timer += now - this.lastT;
    this.lastT = now;
    this.clock += dt;
    this.animate(st, dt);
    if (this.timer < 33) return;
    this.timer = 0;

    const g = this.ctx;
    const d = this.dpr;
    const follow = this.fullW > W;
    const rotate = follow && !!st.minimapRotate;
    const cx = this.viewW / 2, cy = this.h / 2;
    // where the view is centered (the player, eased so the map glides instead of jumping)
    const px = this.X(this.meX), pz = this.Z(this.meZ);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // world -> minimap: north up and scrolled (clamped to the edges), or turned with the view
    const toView = (): void => {
      if (rotate) {
        g.setTransform(d, 0, 0, d, 0, 0);
        g.translate(cx, cy);
        g.rotate(this.viewYaw);
        g.translate(-px, -pz);
      } else {
        const clampOff = (v: number, max: number) => Math.max(0, Math.min(max, v));
        this.offX = follow ? clampOff(px - cx, this.fullW - this.viewW) : 0;
        this.offY = follow ? clampOff(pz - cy, this.fullH - this.h) : 0;
        g.setTransform(d, 0, 0, d, -this.offX * d, -this.offY * d);
      }
    };
    toView();
    if (rotate) g.drawImage(this.bg, 0, 0, this.fullW, this.fullH);
    else g.drawImage(this.bg, this.offX * d, this.offY * d, this.viewW * d, this.h * d, this.offX, this.offY, this.viewW, this.h);
    // a world point -> its spot in the box (for things drawn upright: labels, edge arrows)
    const m = g.getTransform();
    const screen = (wx: number, wz: number): [number, number] => {
      const x = this.X(wx), y = this.Z(wz);
      return [(m.a * x + m.c * y + m.e) / d, (m.b * x + m.d * y + m.f) / d];
    };

    // place names, upright, under everything that moves
    if (follow) {
      g.save();
      g.setTransform(d, 0, 0, d, 0, 0);
      this.drawLabels(g, screen);
      g.restore();
    }

    // turf zones
    if (st.mode === 'turf') this.drawTurf(g, st);

    // JUMP OFF THE PORCH: the riot (everything outside the safe area) and where it is heading
    if (st.porch) this.drawRiot(g, st);

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
      if (rotate) g.rotate(-this.viewYaw);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#ff3b2f';
      g.fillRect(-4, -4, 8, 8);
      g.lineWidth = 1.4;
      g.strokeStyle = '#ffffff';
      g.strokeRect(-4, -4, 8, 8);
      g.restore();
    }

    // squad: a numbered disc each (their own color), with the way they face
    let n = 0;
    for (const p of st.players) {
      if (p.me || p.team !== st.myTeam || !p.alive) continue;
      // (JUMP OFF THE PORCH squads: a color each; the classic modes: your crew's color)
      const color = st.porch ? SQUAD_COLORS[n % SQUAD_COLORS.length] : CREWS[p.team].color;
      n++;
      const x = this.X(p.x), y = this.Z(p.z);
      g.beginPath();
      g.moveTo(x - Math.sin(p.yaw) * 4, y - Math.cos(p.yaw) * 4);
      g.lineTo(x - Math.sin(p.yaw) * 9, y - Math.cos(p.yaw) * 9);
      g.lineWidth = 2;
      g.strokeStyle = color;
      g.stroke();
      g.beginPath();
      g.arc(x, y, 4.6, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = '#101114';
      g.stroke();
      g.save();
      g.translate(x, y);
      if (rotate) g.rotate(-this.viewYaw);
      g.fillStyle = '#101114';
      g.font = `bold ${Math.round(7 * this.textBoost)}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n + 1), 0, 0.5);
      g.restore();
    }

    // me: a soft cone where you are looking and an arrow along the view
    if (st.alive) {
      g.save();
      g.translate(px, pz);
      g.rotate(-this.viewYaw);
      const cone = g.createRadialGradient(0, 0, 2, 0, 0, 34);
      cone.addColorStop(0, 'rgba(255,255,255,0.32)');
      cone.addColorStop(1, 'rgba(255,255,255,0)');
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 34, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
      g.closePath();
      g.fillStyle = cone;
      g.fill();
      g.beginPath();
      g.moveTo(0, -8.5);
      g.lineTo(5.6, 6);
      g.lineTo(0, 3);
      g.lineTo(-5.6, 6);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = '#101114';
      g.stroke();
      g.restore();
    }

    // ---- upright overlays (in box pixels)
    g.setTransform(d, 0, 0, d, 0, 0);
    if (st.porch && st.alive) this.drawNextPointer(g, st, screen);
    this.drawFrame(g, rotate);
  }

  /** Eased values the drawing uses: where you are, which way you face, the riot's circles. */
  private animate(st: HudState, dt: number): void {
    // you: glide to the latest position (snaps if far, e.g. a respawn)
    const k = 1 - Math.exp(-dt * 18);
    if (!this.meInit || Math.hypot(st.myX - this.meX, st.myZ - this.meZ) > 25) {
      this.meX = st.myX;
      this.meZ = st.myZ;
      this.meInit = true;
    } else {
      this.meX += (st.myX - this.meX) * k;
      this.meZ += (st.myZ - this.meZ) * k;
    }
    let dy = st.viewYaw - this.viewYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.viewYaw += dy * (1 - Math.exp(-dt * 20));
    if (!st.porch) return;
    const z = st.porch.zone, nx = st.porch.next;
    // the safe area follows the server's continuously (it shrinks smoothly); a sudden change
    // (a new match, a late join) is tweened like a Manim Transform
    const zr = this.zoneShown;
    if (!this.zoneInit) {
      Object.assign(zr, z);
      this.zoneInit = true;
    } else {
      const jump = Math.hypot(z.x - zr.x, z.z - zr.z) + Math.abs(z.r - zr.r);
      const kz = jump > 8 ? 1 - Math.exp(-dt * 4) : 1 - Math.exp(-dt * 14);
      zr.x += (z.x - zr.x) * kz;
      zr.z += (z.z - zr.z) * kz;
      zr.r += (z.r - zr.r) * kz;
    }
    // a new "next" circle is drawn on (Manim's Create): its stroke grows round over a second
    const key = `${nx.x.toFixed(0)},${nx.z.toFixed(0)},${nx.r.toFixed(0)}`;
    if (key !== this.nextKey) {
      this.nextKey = key;
      this.nextT = 0;
    }
    this.nextT = Math.min(1, this.nextT + dt / 1.1);
    // getting dangerous (the riot is moving in, or you are outside it): the edge pulses
    const outside = Math.hypot(st.myX - z.x, st.myZ - z.z) > z.r;
    const nearEdge = Math.hypot(st.myX - z.x, st.myZ - z.z) > z.r - 12;
    const want = outside ? 1 : (this.shrinking(st) || nearEdge) ? 0.55 : 0;
    this.danger += (want - this.danger) * (1 - Math.exp(-dt * 5));
  }

  /** Whether the safe area is closing in right now (its radius dropping). */
  private shrinking(st: HudState): boolean {
    const r = st.porch!.zone.r;
    const was = this.lastR;
    this.lastR = r;
    if (r < was - 0.001) this.shrinkSeen = this.clock;
    return this.clock - this.shrinkSeen < 0.6;
  }

  private drawTurf(g: CanvasRenderingContext2D, st: HudState): void {
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

  /**
   * The riot: red over everything outside the safe area, with a hatch that drifts inward (so
   * it reads as moving, not just colored), a bold edge that pulses when it is closing in or
   * you are outside, and the next safe area drawn on in white.
   */
  private drawRiot(g: CanvasRenderingContext2D, st: HudState): void {
    const z = this.zoneShown, nx = st.porch!.next;
    const zx = this.X(z.x), zy = this.Z(z.z), zr = z.r * this.scale;
    const pulse = this.danger * (0.5 + 0.5 * Math.sin(this.clock * 6));
    g.save();
    // outside the safe area
    g.beginPath();
    g.rect(-2000, -2000, this.fullW + 4000, this.fullH + 4000);
    g.arc(zx, zy, zr, 0, Math.PI * 2, true);
    g.fillStyle = `rgba(230, 40, 30, ${(0.28 + 0.1 * pulse).toFixed(3)})`;
    g.fill('evenodd');
    // the hatch: rings just outside the edge, marching inward
    g.save();
    g.clip('evenodd');
    const gap = 7;
    const shift = (this.clock * 6) % gap;
    for (let i = 0; i < 4; i++) {
      const r = zr + gap * (i + 1) - shift;
      g.beginPath();
      g.arc(zx, zy, Math.max(0.5, r), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255, 120, 90, ${(0.4 * (1 - i / 4)).toFixed(3)})`;
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.restore();
    // the edge
    g.beginPath();
    g.arc(zx, zy, zr, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(20, 6, 4, 0.55)';
    g.lineWidth = 4 + 2 * pulse;
    g.stroke();
    g.strokeStyle = `rgb(255, ${Math.round(84 - 30 * pulse)}, ${Math.round(64 - 30 * pulse)})`;
    g.lineWidth = 2 + 1.4 * pulse;
    g.stroke();
    // the next safe area: drawn on (its stroke grows round), a soft fill, "NEXT" on top
    if (nx.r < z.r - 0.5) {
      const nr = Math.max(1.5, nx.r * this.scale), ncx = this.X(nx.x), ncy = this.Z(nx.z);
      const t = smooth(this.nextT);
      g.beginPath();
      g.arc(ncx, ncy, nr, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,255,255,${(0.07 * t).toFixed(3)})`;
      g.fill();
      g.beginPath();
      g.arc(ncx, ncy, nr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      g.setLineDash([5, 3]);
      g.lineDashOffset = -this.clock * 8;
      g.strokeStyle = 'rgba(16,17,20,0.6)';
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.7;
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  /**
   * Outside the next safe area: a dashed line from you to its nearest edge with the distance
   * on it, and an arrow on the frame when that edge is off the map view.
   */
  private drawNextPointer(g: CanvasRenderingContext2D, st: HudState, screen: (x: number, z: number) => [number, number]): void {
    const nx = st.porch!.next;
    const dx = this.meX - nx.x, dz = this.meZ - nx.z;
    const dist = Math.hypot(dx, dz);
    const gapM = dist - nx.r;
    if (gapM <= 2) return;
    const ex = nx.x + (dx / dist) * nx.r, ez = nx.z + (dz / dist) * nx.r;
    const [ax, ay] = screen(this.meX, this.meZ);
    const [bx, by] = screen(ex, ez);
    const inBox = (x: number, y: number) => x >= 4 && y >= 4 && x <= this.viewW - 4 && y <= this.h - 4;
    g.save();
    g.beginPath();
    g.rect(0, 0, this.viewW, this.h);
    g.clip();
    g.setLineDash([3, 3]);
    g.lineDashOffset = -this.clock * 10;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokeStyle = 'rgba(16,17,20,0.6)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);
    // the distance, along the line a little way from you
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const lx = ax + ((bx - ax) / L) * Math.min(L * 0.5, 34), ly = ay + ((by - ay) / L) * Math.min(L * 0.5, 34);
    const label = `${Math.round(gapM)} m`;
    g.font = `bold ${Math.round(9 * this.textBoost)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(label).width + 8;
    g.fillStyle = 'rgba(16,17,20,0.8)';
    g.beginPath();
    g.roundRect(lx - w / 2, ly - 7 * this.textBoost, w, 14 * this.textBoost, 4);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillText(label, lx, ly + 0.5);
    g.restore();
    // off the view: an arrow on the frame pointing at it
    if (!inBox(bx, by)) {
      const ang = Math.atan2(by - this.h / 2, bx - this.viewW / 2);
      const hx = this.viewW / 2 - 9, hy = this.h / 2 - 9;
      const t = Math.min(hx / Math.max(1e-6, Math.abs(Math.cos(ang))), hy / Math.max(1e-6, Math.abs(Math.sin(ang))));
      const fx = this.viewW / 2 + Math.cos(ang) * t, fy = this.h / 2 + Math.sin(ang) * t;
      g.save();
      g.translate(fx, fy);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-4, -5.5);
      g.lineTo(-1.5, 0);
      g.lineTo(-4, 5.5);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.strokeStyle = 'rgba(16,17,20,0.8)';
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
    }
  }

  /** District names, upright, only those in view; a little bigger on phones. */
  private drawLabels(g: CanvasRenderingContext2D, screen: (x: number, z: number) => [number, number]): void {
    g.font = `bold ${Math.round(9 * this.textBoost)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.72)';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const l of this.map.labels) {
      if (l.text.endsWith(' BASE')) continue;
      const [x, y] = screen(l.x, l.z);
      if (x < -40 || y < -10 || x > this.viewW + 40 || y > this.h + 10) continue;
      g.strokeText(l.text, x, y);
      g.fillText(l.text, x, y);
    }
  }

  /** The frame: a clean double line, north on it, and a scale bar. */
  private drawFrame(g: CanvasRenderingContext2D, rotate: boolean): void {
    const w = this.viewW, h = this.h;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.roundRect(0.5, 0.5, w - 1, h - 1, 5);
    g.stroke();
    // north: fixed at the top, or riding round the frame as the map turns
    const a = rotate ? -Math.PI / 2 + this.viewYaw : -Math.PI / 2;
    const hx = w / 2 - 8, hy = h / 2 - 8;
    const t = Math.min(hx / Math.max(1e-6, Math.abs(Math.cos(a))), hy / Math.max(1e-6, Math.abs(Math.sin(a))));
    const nx = w / 2 + Math.cos(a) * t, ny = h / 2 + Math.sin(a) * t;
    g.beginPath();
    g.arc(nx, ny, 6.5 * this.textBoost, 0, Math.PI * 2);
    g.fillStyle = 'rgba(16,17,20,0.85)';
    g.fill();
    g.fillStyle = '#ffd24a';
    g.font = `bold ${Math.round(8 * this.textBoost)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
    // scale bar (a round number of meters about 40 px long)
    const m = [10, 20, 25, 50, 100, 200].find((v) => v * this.scale >= 34) ?? 200;
    const len = m * this.scale;
    const x0 = 8, y0 = h - 8;
    g.strokeStyle = 'rgba(16,17,20,0.8)';
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(x0, y0 - 3); g.lineTo(x0, y0); g.lineTo(x0 + len, y0); g.lineTo(x0 + len, y0 - 3);
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.3;
    g.stroke();
    g.font = `bold ${Math.round(7.5 * this.textBoost)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(`${m} m`, x0 + len + 4, y0 + 2);
    g.fillStyle = '#ffffff';
    g.fillText(`${m} m`, x0 + len + 4, y0 + 2);
  }
}
