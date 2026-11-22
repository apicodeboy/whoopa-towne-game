import * as THREE from 'three';

/**
 * Animated billboard content: a playlist per ad, shown on the board's own screen (a real
 * surface on the existing frame, not an overlay). Each item is one of
 *
 *  - `image`: a picture (any web image; `asset/billboards/...`)
 *  - `video`: a looping muted video (WebM / MP4, e.g. exported from EffectCraft's render queue)
 *  - `sequence`: an image sequence packed in a sprite sheet (cols x rows frames at `fps`)
 *  - `motion`: one of the motion-graphics loops below, drawn in code frame by frame
 *    (`renderAt(t)`), so they cost no download and stay crisp at any size
 *  - `painted`: the board's original painted ad (also what shows if anything fails to load)
 *
 * Items rotate on their own timers; each board has a brightness. Boards far from the camera
 * (or behind it) stop redrawing and their videos pause. The live scoreboards are not part of
 * this: they keep their own data-driven screens.
 */
export type BoardItem =
  | { kind: 'painted'; seconds: number }
  | { kind: 'image'; url: string; seconds: number }
  | { kind: 'video'; url: string; seconds: number }
  | { kind: 'sequence'; url: string; cols: number; rows: number; frames: number; fps: number; seconds: number }
  | { kind: 'motion'; id: MotionId; seconds: number };

export interface BoardConfig {
  items: BoardItem[];
  /** 0..1.5: how bright the screen is (1 = as authored). */
  brightness?: number;
}

export type MotionId = 'ajsLogo' | 'gramsOffer' | 'jotpLoop' | 'kicksCarousel' | 'martWords' | 'hkMarket' | 'shackNeon';

/**
 * Which ads animate, and with what. (Ads not listed stay as painted, in the shared sign
 * atlas.) Media files dropped into `client/public/assets/billboards/` can be added here as
 * `image`, `video` or `sequence` items.
 */
export const BOARDS: Record<string, BoardConfig> = {
  ajs: { items: [{ kind: 'motion', id: 'ajsLogo', seconds: 8 }, { kind: 'painted', seconds: 5 }] },
  grams: { items: [{ kind: 'motion', id: 'gramsOffer', seconds: 9 }, { kind: 'painted', seconds: 4 }] },
  jotp: { items: [{ kind: 'motion', id: 'jotpLoop', seconds: 10 }, { kind: 'painted', seconds: 4 }] },
  kicks: { items: [{ kind: 'motion', id: 'kicksCarousel', seconds: 12 }, { kind: 'painted', seconds: 4 }] },
  mart: { items: [{ kind: 'motion', id: 'martWords', seconds: 9 }, { kind: 'painted', seconds: 4 }] },
  hk: { items: [{ kind: 'motion', id: 'hkMarket', seconds: 10 }, { kind: 'painted', seconds: 4 }], brightness: 1.1 },
  shack: { items: [{ kind: 'motion', id: 'shackNeon', seconds: 10 }], brightness: 1.05 },
};

const W = 512, H = 256;
/** How far away a board keeps animating (m), and how often it redraws (per second). */
const ANIMATE_RANGE = 75;
const FPS = 20;

// ------------------------------------------------------------------ motion helpers
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Ease out (back): overshoots a touch and settles, like a spring. */
const easeOutBack = (t: number) => {
  const c1 = 1.7, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeInOut = (t: number) => t * t * (3 - 2 * t);
/** 0 -> 1 between seconds a and b. */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function bigText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxW = 470): void {
  g.font = `900 ${size}px Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif`;
  const w = g.measureText(text).width;
  if (w > maxW) g.font = `900 ${Math.floor((size * maxW) / w)}px Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillText(text, x + 3, y + 3);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

function smallText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center'): void {
  g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y);
}

function bg(g: CanvasRenderingContext2D, c0: string, c1: string): void {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, c0);
  grad.addColorStop(1, c1);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function frame(g: CanvasRenderingContext2D, color = 'rgba(255,255,255,0.5)'): void {
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(9, 9, W - 18, H - 18);
}

/** A sneaker silhouette (side view), `s` px long. */
function shoe(g: CanvasRenderingContext2D, x: number, y: number, s: number, upper: string, sole: string): void {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.fillStyle = upper;
  g.beginPath();
  g.moveTo(-50, 8); g.lineTo(-48, -14); g.quadraticCurveTo(-40, -30, -22, -30); g.lineTo(-8, -18);
  g.quadraticCurveTo(10, -14, 30, -6); g.quadraticCurveTo(50, 0, 50, 8); g.closePath();
  g.fill();
  g.fillStyle = sole;
  g.fillRect(-52, 8, 104, 9);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(-30, -12); g.lineTo(10, -4);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ the motion designs
type Renderer = (g: CanvasRenderingContext2D, t: number) => void;

export const MOTION: Record<MotionId, Renderer> = {
  /** Animated brand logo: AJ'S springs in, a shine sweeps across, the tagline writes on. */
  ajsLogo(g, t) {
    t %= 8;
    bg(g, '#17120a', '#4a3210');
    // slow diagonal stripes drifting behind
    g.save();
    g.globalAlpha = 0.08;
    g.fillStyle = '#f6b73c';
    for (let i = -4; i < 14; i++) {
      const x = i * 48 + ((t * 18) % 48);
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + 22, 0); g.lineTo(x - 78, H); g.lineTo(x - 100, H); g.closePath();
      g.fill();
    }
    g.restore();
    const k = easeOutBack(span(t, 0.1, 0.9));
    g.save();
    g.translate(W / 2, 104);
    g.scale(0.4 + 0.6 * k, 0.4 + 0.6 * k);
    g.globalAlpha = span(t, 0.1, 0.4);
    bigText(g, "AJ'S", 0, 0, 120, '#f6b73c');
    g.restore();
    // shine sweep
    const sx = -120 + ((t - 1.2) / 1.1) * (W + 240);
    if (t > 1.2 && t < 2.3) {
      const sh = g.createLinearGradient(sx - 60, 0, sx + 60, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(0, 40, W, 130);
    }
    // the tagline types on
    const tag = 'FRESH FITS · PORCH ST';
    const n = Math.floor(span(t, 1.6, 3.2) * tag.length);
    smallText(g, tag.slice(0, n) + (n < tag.length && Math.floor(t * 4) % 2 ? '|' : ''), W / 2, 190, 28, 'rgba(255,255,255,0.92)');
    // fade out to loop
    g.fillStyle = `rgba(23,18,10,${span(t, 7.4, 8)})`;
    g.fillRect(0, 0, W, H);
    frame(g, 'rgba(246,183,60,0.6)');
  },

  /** Animated promotional offer: a GRAMS bundle with a pulsing burst and a counter ticking up. */
  gramsOffer(g, t) {
    t %= 9;
    bg(g, '#101012', '#2a2a30');
    // rotating rays
    g.save();
    g.translate(380, 128);
    g.rotate(t * 0.25);
    g.fillStyle = 'rgba(255,210,63,0.08)';
    for (let i = 0; i < 12; i++) {
      g.rotate(Math.PI / 6);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(300, -26); g.lineTo(300, 26); g.closePath();
      g.fill();
    }
    g.restore();
    const inK = easeOutBack(span(t, 0, 0.7));
    g.save();
    g.translate(180 - (1 - inK) * 300, 0);
    bigText(g, 'GRAMS', 0, 96, 96, '#ffd23f', 330);
    smallText(g, "GET YOURS AT AJ'S", 0, 160, 24, 'rgba(255,255,255,0.9)');
    g.restore();
    // the burst badge with a number counting up
    const pulse = 1 + 0.06 * Math.sin(t * 6);
    const bk = easeOutBack(span(t, 0.8, 1.5));
    g.save();
    g.translate(380, 120);
    g.scale(bk * pulse, bk * pulse);
    g.fillStyle = '#ffd23f';
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const r = i % 2 ? 62 : 78, a = (i / 24) * Math.PI * 2;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    const count = Math.round(500 + 500 * easeInOut(span(t, 1.5, 3.5)));
    g.fillStyle = '#101012';
    g.font = '900 34px Impact, "Arial Narrow Bold", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(count), 0, -6);
    g.font = '800 14px "Helvetica Neue", Arial, sans-serif';
    g.fillText(t > 3.5 ? '+ BONUS' : 'GRAMS', 0, 22);
    g.restore();
    g.fillStyle = `rgba(16,16,18,${span(t, 8.4, 9)})`;
    g.fillRect(0, 0, W, H);
    frame(g, 'rgba(255,210,63,0.55)');
  },

  /** Digital ad loop: JUMP OFF THE PORCH: 3, 2, 1, the blimp crosses, the title slams in. */
  jotpLoop(g, t) {
    t %= 10;
    bg(g, '#1a1206', '#f0a020');
    // the sky band and the blimp gliding across
    const bx = -140 + (t / 10) * (W + 280);
    g.save();
    g.translate(bx, 62);
    g.fillStyle = '#e8e2d4';
    g.beginPath();
    g.ellipse(0, 0, 70, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2b2b';
    g.fillRect(-18, 18, 36, 10);
    g.fillStyle = '#f0a020';
    g.fillRect(-60, -4, 120, 8);
    g.restore();
    if (t < 3) {
      const n = 3 - Math.floor(t);
      const k = t % 1;
      g.save();
      g.translate(W / 2, 150);
      g.scale(1.6 - 0.6 * easeOutBack(clamp01(k * 2.5)), 1.6 - 0.6 * easeOutBack(clamp01(k * 2.5)));
      g.globalAlpha = 1 - span(k, 0.75, 1);
      bigText(g, String(n), 0, 0, 120, '#ffffff');
      g.restore();
    } else {
      const k = easeOutBack(span(t, 3, 3.5));
      g.save();
      g.translate(W / 2, 140);
      g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
      bigText(g, 'JUMP OFF THE PORCH', 0, 0, 64, '#ffffff');
      g.restore();
      g.globalAlpha = span(t, 3.6, 4.2);
      smallText(g, 'LAST SQUAD STANDING · DAY AND NIGHT', W / 2, 204, 22, '#1a1206');
      g.globalAlpha = 1;
    }
    g.fillStyle = `rgba(26,18,6,${span(t, 9.4, 10)})`;
    g.fillRect(0, 0, W, H);
    frame(g);
  },

  /** Rotating product advertisement: KICKS, three pairs on a turntable with their prices. */
  kicksCarousel(g, t) {
    t %= 12;
    bg(g, '#3a0f0f', '#7a1f1f');
    bigText(g, 'KICKS', 112, 54, 56, '#ffffff', 200);
    smallText(g, 'NEW DROPS · DOWNTOWN', 112, 98, 16, 'rgba(255,255,255,0.8)');
    const items = [['AIR LOW', '$120', '#f2f2f2', '#c9c9c9'], ['RUNNER', '$95', '#2f6fe0', '#f2f2f2'], ['HIGH TOP', '$140', '#111111', '#e8e8e8']] as const;
    const i = Math.floor(t / 4) % 3;
    const k = t % 4;
    const enter = easeInOut(span(k, 0, 0.6)), leave = easeInOut(span(k, 3.4, 4));
    const x = 360 + (1 - enter) * 260 - leave * 260;
    const [name, price, upper, sole] = items[i];
    // the turntable
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(360, 196, 120, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(x, 150 + Math.sin(t * 2) * 4);
    shoe(g, 0, 0, 190 * (0.95 + 0.05 * Math.cos(t * 2)), upper, sole);
    g.restore();
    g.globalAlpha = enter * (1 - leave);
    smallText(g, name, 112, 160, 26, '#ffffff');
    g.fillStyle = '#ffd23f';
    g.fillRect(62, 182, 100, 36);
    smallText(g, price, 112, 200, 24, '#3a0f0f');
    g.globalAlpha = 1;
    frame(g);
  },

  /** Smooth text transitions: the Food Mart's lines slide and fade through. */
  martWords(g, t) {
    t %= 9;
    bg(g, '#8c1414', '#c2261e');
    bigText(g, 'TOWNE FOOD MART', W / 2, 74, 58, '#ffe14d');
    const words = ['COLD DRINKS', 'HOT FOOD', 'OPEN LATE'];
    const i = Math.floor(t / 3) % 3;
    const k = t % 3;
    const inK = easeInOut(span(k, 0, 0.45)), outK = easeInOut(span(k, 2.55, 3));
    g.save();
    g.beginPath();
    g.rect(0, 120, W, 100);
    g.clip();
    g.globalAlpha = inK * (1 - outK);
    bigText(g, words[i], W / 2, 172 + (1 - inK) * 40 - outK * 40, 64, '#ffffff');
    g.restore();
    // a progress tick for each line
    for (let j = 0; j < 3; j++) {
      g.fillStyle = j === i ? '#ffe14d' : 'rgba(255,255,255,0.35)';
      g.fillRect(W / 2 - 54 + j * 40, 224, 28, 5);
    }
    frame(g);
  },

  /** Moving graphic patterns: the Hong Kong night market, lanterns drifting over a scrolling pattern. */
  hkMarket(g, t) {
    t %= 10;
    bg(g, '#24101a', '#5c1438');
    // scrolling lattice
    g.save();
    g.strokeStyle = 'rgba(63,240,255,0.12)';
    g.lineWidth = 2;
    const off = (t * 22) % 32;
    for (let x = -32; x < W + 32; x += 32) {
      g.beginPath();
      g.moveTo(x + off, 0); g.lineTo(x + off - 64, H);
      g.moveTo(x - off, 0); g.lineTo(x - off + 64, H);
      g.stroke();
    }
    g.restore();
    // lanterns bobbing
    for (let i = 0; i < 6; i++) {
      const x = 46 + i * 84, y = 38 + Math.sin(t * 1.6 + i) * 6;
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x, y - 16);
      g.stroke();
      const glow = 0.75 + 0.25 * Math.sin(t * 3 + i * 1.7);
      g.fillStyle = `rgba(255,${Math.round(60 + 40 * glow)},40,${glow})`;
      g.beginPath();
      g.ellipse(x, y, 14, 18, 0, 0, Math.PI * 2);
      g.fill();
    }
    bigText(g, '唐人街 HONG KONG', W / 2, 136, 58, '#3ff0ff');
    const flick = Math.sin(t * 20) > -0.92 ? 1 : 0.4;
    g.globalAlpha = flick;
    smallText(g, 'NIGHT MARKET · EVERY NIGHT', W / 2, 198, 24, 'rgba(255,255,255,0.92)');
    g.globalAlpha = 1;
    frame(g, 'rgba(63,240,255,0.5)');
  },

  /** A subtle glowing sign: the Shrimp Shack in neon, tubes humming with the odd flicker. */
  shackNeon(g, t) {
    t %= 10;
    g.fillStyle = '#071c1f';
    g.fillRect(0, 0, W, H);
    const flicker = (k: number) => (Math.sin(t * 31 + k) > 0.97 ? 0.35 : 1);
    const neon = (text: string, y: number, size: number, color: string, k: number) => {
      g.font = `900 ${size}px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const a = flicker(k) * (0.85 + 0.15 * Math.sin(t * 2 + k));
      g.shadowColor = color;
      g.shadowBlur = 22 * a;
      g.lineWidth = 4;
      g.strokeStyle = color;
      g.globalAlpha = a;
      g.strokeText(text, W / 2, y);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(text, W / 2, y);
      g.globalAlpha = 1;
    };
    neon('SHRIMP SHACK', 100, 66, '#ff5ea8', 0);
    neon('ON THE BOARDWALK · OPEN', 182, 26, '#4ff7ff', 2);
    // a little neon shrimp outline that draws itself on
    const p = easeInOut(span(t, 0.3, 2.3));
    g.save();
    g.translate(66, 186);
    g.strokeStyle = '#ffb347';
    g.shadowColor = '#ffb347';
    g.shadowBlur = 12;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, 24, Math.PI * 0.2, Math.PI * 0.2 + Math.PI * 1.5 * p);
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(79,247,255,0.35)';
    g.lineWidth = 3;
    g.strokeRect(9, 9, W - 18, H - 18);
  },
};

// ------------------------------------------------------------------ the player
interface Loaded { image?: HTMLImageElement; video?: HTMLVideoElement; failed?: boolean }

/** One animated screen: its own canvas texture on a quad over the board's face. */
export class AnimatedBoard {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private media = new Map<number, Loaded>();
  private nextDraw = 0;
  private index = -1;
  private itemStart = 0;
  private visible = true;
  private center: THREE.Vector3;
  private normal: THREE.Vector3;

  constructor(
    private cfg: BoardConfig, private painted: HTMLCanvasElement,
    pos: THREE.Vector3, yaw: number, w: number, h: number,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    mat.color.setScalar(cfg.brightness ?? 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = yaw;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.center = pos.clone();
    this.normal = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.g.drawImage(painted, 0, 0, W, H);
    this.tex.needsUpdate = true;
  }

  /** `time` in seconds; `cam` is the camera position. */
  update(time: number, cam: THREE.Vector3, night: number): void {
    const dx = cam.x - this.center.x, dz = cam.z - this.center.z;
    const d = Math.hypot(dx, dz);
    // in range and the camera on the screen's side: animate; else hold the last frame
    const facing = dx * this.normal.x + dz * this.normal.z > -2;
    const active = d < ANIMATE_RANGE && facing;
    if (active !== this.visible) {
      this.visible = active;
      for (const m of this.media.values()) if (m.video) active ? void m.video.play().catch(() => {}) : m.video.pause();
    }
    // screens are a little dimmer after dark (bright, not blinding)
    this.mesh.material.color.setScalar((this.cfg.brightness ?? 1) * (1 - 0.18 * night));
    if (!active || time < this.nextDraw) return;
    this.nextDraw = time + 1 / FPS;
    // which item is up (each runs for its seconds, the list loops)
    const total = this.cfg.items.reduce((s, it) => s + it.seconds, 0) || 1;
    let at = time % total, i = 0;
    while (i < this.cfg.items.length - 1 && at >= this.cfg.items[i].seconds) at -= this.cfg.items[i++].seconds;
    if (i !== this.index) {
      this.index = i;
      this.itemStart = time - at;
      this.prepare(i);
    }
    this.draw(this.cfg.items[i], i, time - this.itemStart);
    this.tex.needsUpdate = true;
  }

  private prepare(i: number): void {
    const it = this.cfg.items[i];
    if (this.media.has(i) || it.kind === 'motion' || it.kind === 'painted') return;
    const m: Loaded = {};
    this.media.set(i, m);
    if (it.kind === 'video') {
      const v = document.createElement('video');
      v.src = it.url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.onerror = () => (m.failed = true);
      void v.play().catch(() => {});
      m.video = v;
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onerror = () => (m.failed = true);
      img.src = it.url;
      m.image = img;
    }
  }

  private draw(it: BoardItem, i: number, t: number): void {
    const g = this.g;
    g.save();
    try {
      const m = this.media.get(i);
      if (it.kind === 'motion') MOTION[it.id](g, t);
      else if (it.kind === 'painted' || !m || m.failed) g.drawImage(this.painted, 0, 0, W, H);
      else if (it.kind === 'video') {
        if (m.video && m.video.readyState >= 2) g.drawImage(m.video, 0, 0, W, H);
        else g.drawImage(this.painted, 0, 0, W, H);
      } else if (it.kind === 'image') {
        if (m.image?.complete && m.image.naturalWidth) g.drawImage(m.image, 0, 0, W, H);
        else g.drawImage(this.painted, 0, 0, W, H);
      } else if (it.kind === 'sequence') {
        const img = m.image;
        if (img?.complete && img.naturalWidth) {
          const f = Math.floor(t * it.fps) % it.frames;
          const fw = img.naturalWidth / it.cols, fh = img.naturalHeight / it.rows;
          g.drawImage(img, (f % it.cols) * fw, Math.floor(f / it.cols) * fh, fw, fh, 0, 0, W, H);
        } else g.drawImage(this.painted, 0, 0, W, H);
      }
    } catch {
      // anything wrong with an item: the painted ad
      g.drawImage(this.painted, 0, 0, W, H);
    }
    g.restore();
  }

  dispose(): void {
    for (const m of this.media.values()) {
      if (m.video) {
        m.video.pause();
        m.video.removeAttribute('src');
        m.video.load();
      }
    }
    this.media.clear();
    this.tex.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
