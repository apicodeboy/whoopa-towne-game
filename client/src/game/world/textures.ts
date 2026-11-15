import * as THREE from 'three';

/**
 * Procedural textures, painted on canvases at startup (no image files, all original).
 * Wall textures are near-white so one texture can be tinted to any color per building.
 */

type Paint = (g: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(size: number, seed: number, paint: Paint, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  paint(g, size, seeded(seed));
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(g: CanvasRenderingContext2D, size: number, rnd: () => number, n: number, lo: number, hi: number, alpha: number, dot = 1.5): void {
  for (let i = 0; i < n; i++) {
    const v = Math.round(lo + rnd() * (hi - lo));
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(rnd() * size, rnd() * size, dot, dot);
  }
}

function crack(g: CanvasRenderingContext2D, size: number, rnd: () => number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  let x = rnd() * size, y = rnd() * size;
  g.moveTo(x, y);
  const n = 6 + Math.floor(rnd() * 8);
  let a = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    a += (rnd() - 0.5) * 1.2;
    x += Math.cos(a) * (6 + rnd() * 14);
    y += Math.sin(a) * (6 + rnd() * 14);
    g.lineTo(x, y);
  }
  g.stroke();
}

export interface TextureSet {
  asphalt: THREE.Texture;
  road: THREE.Texture;
  concrete: THREE.Texture;
  sidewalk: THREE.Texture;
  brick: THREE.Texture;
  stucco: THREE.Texture;
  siding: THREE.Texture;
  metal: THREE.Texture;
  wood: THREE.Texture;
  crate: THREE.Texture;
  grass: THREE.Texture;
  gravel: THREE.Texture;
  shingle: THREE.Texture;
  chain: THREE.Texture;
  bars: THREE.Texture;
  shelf: THREE.Texture;
  dispose(): void;
}

export function makeTextures(): TextureSet {
  const asphalt = make(512, 11, (g, s, r) => {
    g.fillStyle = '#5b5d63';
    g.fillRect(0, 0, s, s);
    speckle(g, s, r, 9000, 60, 135, 0.35);
    speckle(g, s, r, 500, 20, 40, 0.5, 2.5);
    // stains and patches
    for (let i = 0; i < 7; i++) {
      const x = r() * s, y = r() * s, rad = 20 + r() * 60;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(20,20,22,${0.1 + r() * 0.14})`);
      grad.addColorStop(1, 'rgba(20,20,22,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 5; i++) crack(g, s, r, 'rgba(18,18,20,0.55)');
  });

  const road = make(512, 12, (g, s, r) => {
    g.fillStyle = '#44464c';
    g.fillRect(0, 0, s, s);
    speckle(g, s, r, 8000, 45, 105, 0.3);
    for (let i = 0; i < 3; i++) crack(g, s, r, 'rgba(12,12,14,0.5)');
    // faint tire wear
    g.fillStyle = 'rgba(20,20,22,0.12)';
    g.fillRect(s * 0.18, 0, s * 0.14, s);
    g.fillRect(s * 0.68, 0, s * 0.14, s);
  });

  const concrete = make(512, 13, (g, s, r) => {
    g.fillStyle = '#e4e2dc';
    g.fillRect(0, 0, s, s);
    speckle(g, s, r, 7000, 150, 235, 0.3);
    for (let i = 0; i < 8; i++) {
      const x = r() * s, y = r() * s, rad = 30 + r() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(90,90,85,${0.06 + r() * 0.08})`);
      grad.addColorStop(1, 'rgba(90,90,85,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // form seams
    g.strokeStyle = 'rgba(70,70,66,0.35)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.beginPath();
    g.moveTo(0, s / 2);
    g.lineTo(s, s / 2);
    g.stroke();
    // water streaks
    for (let i = 0; i < 10; i++) {
      const x = r() * s;
      const grad = g.createLinearGradient(0, 0, 0, s * (0.3 + r() * 0.5));
      grad.addColorStop(0, 'rgba(60,60,56,0.16)');
      grad.addColorStop(1, 'rgba(60,60,56,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 2 + r() * 5, s);
    }
  });

  const sidewalk = make(512, 14, (g, s, r) => {
    g.fillStyle = '#8f9196';
    g.fillRect(0, 0, s, s);
    speckle(g, s, r, 8000, 90, 190, 0.3);
    g.strokeStyle = 'rgba(40,40,44,0.6)';
    g.lineWidth = 3;
    const n = 4;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo((i * s) / n, 0);
      g.lineTo((i * s) / n, s);
      g.moveTo(0, (i * s) / n);
      g.lineTo(s, (i * s) / n);
      g.stroke();
    }
    for (let i = 0; i < 3; i++) crack(g, s, r, 'rgba(40,40,44,0.4)');
  });

  const brick = make(512, 15, (g, s, r) => {
    g.fillStyle = '#8f8a84'; // mortar
    g.fillRect(0, 0, s, s);
    const rows = 16, cols = 8;
    const bh = s / rows, bw = s / cols;
    for (let y = 0; y < rows; y++) {
      const off = y % 2 ? bw / 2 : 0;
      for (let x = -1; x < cols; x++) {
        const v = 205 + Math.floor(r() * 50);
        const warm = Math.floor(r() * 14);
        g.fillStyle = `rgb(${v},${v - warm},${v - warm * 1.6})`;
        g.fillRect(x * bw + off + 1.5, y * bh + 1.5, bw - 3, bh - 3);
      }
    }
    speckle(g, s, r, 3000, 120, 200, 0.18);
    // soot from the top of the tile downward
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, 'rgba(40,36,34,0.16)');
    grad.addColorStop(0.5, 'rgba(40,36,34,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

  const stucco = make(256, 16, (g, s, r) => {
    g.fillStyle = '#ebe7df';
    g.fillRect(0, 0, s, s);
    speckle(g, s, r, 6000, 170, 245, 0.35, 2);
    for (let i = 0; i < 6; i++) {
      const x = r() * s;
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, 'rgba(70,64,58,0.14)');
      grad.addColorStop(0.6, 'rgba(70,64,58,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 3 + r() * 8, s);
    }
  });

  const siding = make(256, 17, (g, s, r) => {
    g.fillStyle = '#eeeeea';
    g.fillRect(0, 0, s, s);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const y = (i * s) / n;
      const grad = g.createLinearGradient(0, y, 0, y + s / n);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.8, 'rgba(120,120,116,0.18)');
      grad.addColorStop(1, 'rgba(40,40,38,0.6)');
      g.fillStyle = grad;
      g.fillRect(0, y, s, s / n);
    }
    speckle(g, s, r, 2500, 150, 230, 0.2);
  });

  const metal = make(256, 18, (g, s, r) => {
    g.fillStyle = '#dfe2e4';
    g.fillRect(0, 0, s, s);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = (i * s) / n;
      const grad = g.createLinearGradient(x, 0, x + s / n, 0);
      grad.addColorStop(0, 'rgba(40,44,48,0.45)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      grad.addColorStop(0.7, 'rgba(120,124,128,0.1)');
      grad.addColorStop(1, 'rgba(40,44,48,0.45)');
      g.fillStyle = grad;
      g.fillRect(x, 0, s / n, s);
    }
    // rust blooms
    for (let i = 0; i < 14; i++) {
      const x = r() * s, y = r() * s, rad = 6 + r() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(120,62,30,${0.18 + r() * 0.2})`);
      grad.addColorStop(1, 'rgba(120,62,30,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });

  const wood = make(256, 19, (g, s, r) => {
    g.fillStyle = '#e6dccb';
    g.fillRect(0, 0, s, s);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = (i * s) / n;
      const v = 200 + Math.floor(r() * 45);
      g.fillStyle = `rgb(${v},${v - 10},${v - 26})`;
      g.fillRect(x + 1, 0, s / n - 2, s);
      g.strokeStyle = 'rgba(70,50,30,0.25)';
      g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const gx = x + 3 + r() * (s / n - 6);
        g.beginPath();
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + 3, s * 0.3, gx - 3, s * 0.6, gx + 1, s);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,28,16,0.75)';
      g.fillRect(x, 0, 1.5, s);
    }
  });

  const crate = make(256, 20, (g, s, r) => {
    g.fillStyle = '#d9c9a8';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) {
      const v = 190 + Math.floor(r() * 40);
      g.fillStyle = `rgb(${v},${v - 14},${v - 40})`;
      g.fillRect(0, (i * s) / 5 + 1, s, s / 5 - 2);
    }
    g.strokeStyle = '#8a7350';
    g.lineWidth = 22;
    g.strokeRect(11, 11, s - 22, s - 22);
    g.beginPath();
    g.moveTo(16, 16);
    g.lineTo(s - 16, s - 16);
    g.stroke();
    g.strokeStyle = 'rgba(40,28,16,0.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.strokeRect(22, 22, s - 44, s - 44);
  }, false);

  const grass = make(256, 21, (g, s, r) => {
    g.fillStyle = '#4c7040';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      g.fillStyle = v > 0.5 ? `rgba(110,150,80,${0.25 + r() * 0.3})` : `rgba(30,60,30,${0.25 + r() * 0.3})`;
      g.fillRect(r() * s, r() * s, 1.5, 3);
    }
    // worn dirt patches
    for (let i = 0; i < 4; i++) {
      const x = r() * s, y = r() * s, rad = 14 + r() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(120,100,70,0.35)');
      grad.addColorStop(1, 'rgba(120,100,70,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });

  const gravel = make(512, 22, (g, s, r) => {
    g.fillStyle = '#7a7368';
    g.fillRect(0, 0, s, s);
    // lots of small stones, a few bigger ones, and soft darker drifts so it does not read as noise
    for (let i = 0; i < 16000; i++) {
      const v = 85 + Math.floor(r() * 95);
      g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.8)`;
      const d = 1 + r() * 1.8;
      g.fillRect(r() * s, r() * s, d, d);
    }
    for (let i = 0; i < 500; i++) {
      const v = 70 + Math.floor(r() * 120);
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.beginPath();
      g.arc(r() * s, r() * s, 1.2 + r() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * s, y = r() * s, rad = 30 + r() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(40,36,30,0.16)');
      grad.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });

  const shingle = make(256, 23, (g, s, r) => {
    g.fillStyle = '#3a3836';
    g.fillRect(0, 0, s, s);
    const rows = 10, cols = 8;
    for (let y = 0; y < rows; y++) {
      for (let x = -1; x < cols; x++) {
        const v = 52 + Math.floor(r() * 28);
        g.fillStyle = `rgb(${v},${v - 2},${v - 5})`;
        g.fillRect(x * (s / cols) + (y % 2 ? s / cols / 2 : 0) + 1, y * (s / rows) + 1, s / cols - 2, s / rows - 2);
      }
    }
  });

  const chain = make(64, 24, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(205,212,220,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s, s);
    g.moveTo(s, 0); g.lineTo(0, s);
    g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, s * 1.5);
    g.moveTo(s / 2, -s / 2); g.lineTo(s * 1.5, s / 2);
    g.stroke();
  });

  // hand-rail: a top bar and thin vertical balusters with gaps
  const bars = make(64, 25, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(40,44,50,1)';
    g.fillRect(0, 0, s, 7);
    g.fillRect(0, s - 5, s, 5);
    g.fillRect(4, 0, 5, s);
    g.fillRect(36, 0, 5, s);
  });

  const shelf = make(256, 26, (g, s, r) => {
    g.fillStyle = '#3b3329';
    g.fillRect(0, 0, s, s);
    const rows = 4;
    const colors = ['#c0392b', '#e9c46a', '#2a9d8f', '#e76f51', '#457b9d', '#f4a261', '#8ab17d', '#d4d4d4', '#9b5de5'];
    for (let y = 0; y < rows; y++) {
      const y0 = (y * s) / rows + 8;
      let x = 4;
      while (x < s - 8) {
        const w = 10 + r() * 22;
        g.fillStyle = colors[Math.floor(r() * colors.length)];
        g.fillRect(x, y0, w - 2, s / rows - 16);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x + 2, y0 + 5, w - 6, 5);
        x += w;
      }
      g.fillStyle = '#6b5a45';
      g.fillRect(0, (y * s) / rows, s, 7);
    }
  });

  const all = [asphalt, road, concrete, sidewalk, brick, stucco, siding, metal, wood, crate, grass, gravel, shingle, chain, bars, shelf];
  return {
    asphalt, road, concrete, sidewalk, brick, stucco, siding, metal, wood, crate, grass, gravel, shingle, chain, bars, shelf,
    dispose() {
      for (const t of all) t.dispose();
    },
  };
}

/** Text painted on a board (store signs, graffiti, street names). */
/** Draws a sign / graffiti tag onto its own canvas (128 px tall); the world packs these into one atlas. */
export function makeSignCanvas(
  text: string, style: 'store' | 'graffiti' | 'street' | 'plain', color: string, bg: string | null, aspect: number,
): HTMLCanvasElement {
  const h = 128;
  const w = Math.min(1024, Math.max(128, Math.round(h * aspect)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 5;
    g.strokeRect(5, 5, w - 10, h - 10);
  }
  const font = style === 'graffiti' ? 'italic 900' : '900';
  const family = style === 'graffiti' ? '"Marker Felt", "Comic Sans MS", Impact, sans-serif' : 'Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif';
  let size = style === 'graffiti' ? 96 : 84;
  g.font = `${font} ${size}px ${family}`;
  const measured = g.measureText(text).width;
  const maxW = w - (bg ? 36 : 12);
  if (measured > maxW) {
    size = Math.floor((size * maxW) / measured);
    g.font = `${font} ${size}px ${family}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (style === 'graffiti') {
    g.save();
    g.translate(w / 2, h / 2 + 4);
    g.rotate(-0.035);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(8, size * 0.16);
    g.strokeStyle = 'rgba(10,10,12,0.9)';
    g.strokeText(text, 0, 0);
    g.lineWidth = Math.max(3, size * 0.05);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeText(text, 0, 0);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    // drips
    g.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const x = -measured * 0.4 + (i / 4) * measured * 0.8 * Math.min(1, maxW / measured);
      g.fillRect(x, size * 0.3, 3, 8 + ((i * 37) % 22));
    }
    g.restore();
  } else {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillText(text, w / 2 + 3, h / 2 + 7);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 4);
  }
  return c;
}

/** Rasterizes an inline SVG (crew logos) into a texture. Resolves once the image has decoded. */
export function svgTexture(svg: string, size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    c.getContext('2d')!.drawImage(img, 0, 0, size, size);
    tex.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return tex;
}

/** Soft round blob used for fake light pools under street lamps. */
export function glowTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,214,150,0.9)');
  grad.addColorStop(0.4, 'rgba(255,196,120,0.35)');
  grad.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
