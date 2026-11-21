import * as THREE from 'three';
import type { WeaponId } from '@shared/config/weapons';

/**
 * The WHOOPA TOWNE weapon collection as 3D models, built from parts: each gun's body is its
 * own side outline (extruded, with softened edges), plus barrels, suppressors, scopes, sights,
 * stocks and magazines. So every gun has its real silhouette (the Vector's angled body, the
 * P90's top magazine, the Bizon's helical mag, the revolver's cylinder), and one set of models
 * serves the hands, the HUD and menu pictures, and the guns lying on the ground.
 *
 * Model space (meters): the origin is the middle of the pistol grip (where the firing hand
 * closes), the muzzle points down -Z, +Y is up, +X the gun's right side. Outlines are written
 * as (f, y): f is forward from the grip (toward the muzzle), y up.
 */

/** Where things are on a gun, in its own space (f forward, y up; meters before `scale`). */
export interface GunSockets {
  /** The muzzle (shots and the flash come from here). */
  muzzle: [number, number];
  /** Where the support hand cups the gun (two-handed guns), and the nearest it may come to the grip. */
  fore?: [number, number];
  foreMin?: number;
  /** The magazine (the support hand goes there to reload). */
  mag?: [number, number];
  /** How far back the stock reaches (negative f), for the shoulder. */
  butt: number;
  /** The grip's lean back from upright (radians). */
  tilt: number;
  /** Size the model is drawn at (a touch oversized reads better from behind the shoulder). */
  scale: number;
}

type Mat = 'steel' | 'black' | 'dark' | 'wood' | 'walnut' | 'tan' | 'chrome' | 'pink' | 'glass' | 'smoke' | 'brass' | 'rubber' | 'blade';

const MATS: Record<Mat, () => THREE.MeshStandardMaterial> = {
  steel: () => new THREE.MeshStandardMaterial({ name: 'gun-steel', color: 0x4a4e55, metalness: 0.55, roughness: 0.42 }),
  black: () => new THREE.MeshStandardMaterial({ name: 'gun-black', color: 0x2a2c31, metalness: 0.1, roughness: 0.72 }),
  dark: () => new THREE.MeshStandardMaterial({ name: 'gun-dark', color: 0x363940, metalness: 0.35, roughness: 0.55 }),
  wood: () => new THREE.MeshStandardMaterial({ name: 'gun-wood', color: 0x8a5230, metalness: 0, roughness: 0.68 }),
  walnut: () => new THREE.MeshStandardMaterial({ name: 'gun-walnut', color: 0x5e3520, metalness: 0, roughness: 0.62 }),
  tan: () => new THREE.MeshStandardMaterial({ name: 'gun-tan', color: 0xa88c62, metalness: 0.05, roughness: 0.75 }),
  chrome: () => new THREE.MeshStandardMaterial({ name: 'gun-chrome', color: 0xc9ced4, metalness: 0.75, roughness: 0.22, emissive: 0x2a2d31 }),
  pink: () => new THREE.MeshStandardMaterial({ name: 'gun-pink', color: 0xf27db8, metalness: 0.15, roughness: 0.45 }),
  glass: () => new THREE.MeshStandardMaterial({ name: 'gun-glass', color: 0x2a6f8f, metalness: 0.3, roughness: 0.1, emissive: 0x0b2733 }),
  smoke: () => new THREE.MeshStandardMaterial({ name: 'gun-smoke', color: 0x3b3a33, metalness: 0.1, roughness: 0.3, transparent: true, opacity: 0.85 }),
  brass: () => new THREE.MeshStandardMaterial({ name: 'gun-brass', color: 0xc99a3a, metalness: 0.7, roughness: 0.35 }),
  rubber: () => new THREE.MeshStandardMaterial({ name: 'gun-rubber', color: 0x101012, metalness: 0, roughness: 0.92 }),
  blade: () => new THREE.MeshStandardMaterial({ name: 'gun-blade', color: 0xb8bec6, metalness: 0.8, roughness: 0.25, emissive: 0x202328 }),
};
const matCache = new Map<Mat, THREE.MeshStandardMaterial>();
const mat = (m: Mat) => {
  let x = matCache.get(m);
  if (!x) matCache.set(m, (x = MATS[m]()));
  return x;
};

/** Builds one gun's parts into a group. */
class Kit {
  readonly g = new THREE.Group();

  private add(geo: THREE.BufferGeometry, m: Mat): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat(m));
    mesh.castShadow = true;
    this.g.add(mesh);
    return mesh;
  }

  /** A side outline (f, y points, counter-clockwise or not), `w` wide, centered on x (or at `x`). */
  prof(pts: Array<[number, number]>, w: number, m: Mat, opts: { x?: number; bevel?: number; holes?: Array<Array<[number, number]>> } = {}): this {
    const shape = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
    for (const h of opts.holes ?? []) shape.holes.push(new THREE.Path(h.map(([f, y]) => new THREE.Vector2(f, y))));
    const bevel = Math.min(opts.bevel ?? 0.004, w * 0.3);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, w - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 6 });
    // shape space (f, y, depth) -> model space (x = depth, y, z = -f)
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    geo.translate((opts.x ?? 0) - (w - bevel * 2) / 2, 0, 0);
    this.add(geo, m);
    return this;
  }

  /** A box from f0 to f1, y0 to y1, `w` wide. */
  box(f0: number, f1: number, y0: number, y1: number, w: number, m: Mat, x = 0): this {
    return this.prof([[f0, y0], [f1, y0], [f1, y1], [f0, y1]], w, m, { x, bevel: Math.min(0.003, (y1 - y0) * 0.25, (f1 - f0) * 0.25) });
  }

  /** A round part along the barrel axis (barrels, suppressors, scopes, tubes). */
  cyl(f0: number, f1: number, y: number, r: number, m: Mat, opts: { x?: number; r1?: number; seg?: number } = {}): this {
    const geo = new THREE.CylinderGeometry(opts.r1 ?? r, r, Math.abs(f1 - f0), opts.seg ?? 12);
    // along y by default: lay it along -Z (f forward), `r1` at the front
    geo.rotateX(-Math.PI / 2);
    geo.translate(opts.x ?? 0, y, -(f0 + f1) / 2);
    this.add(geo, m);
    return this;
  }

  /** A round part across the gun (drum magazines, knobs). */
  cylX(f: number, y: number, r: number, w: number, m: Mat, x = 0): this {
    const geo = new THREE.CylinderGeometry(r, r, w, 18);
    geo.rotateZ(Math.PI / 2);
    geo.translate(x, y, -f);
    this.add(geo, m);
    return this;
  }

  /** A ring standing across the barrel axis (ring sights). */
  ring(f: number, y: number, r: number, t: number, m: Mat): this {
    const geo = new THREE.TorusGeometry(r, t, 6, 18);
    geo.translate(0, y, -f);
    this.add(geo, m);
    return this;
  }

  /** A short rail of ridges along the top (Picatinny). */
  rail(f0: number, f1: number, y: number, w = 0.022): this {
    this.box(f0, f1, y - 0.006, y, w, 'dark');
    for (let f = f0 + 0.004; f < f1 - 0.004; f += 0.011) this.box(f, f + 0.005, y, y + 0.005, w * 0.92, 'dark');
    return this;
  }

  /** A scope: tube, bells at both ends, turrets and two rings down to the rail. */
  scope(f0: number, f1: number, y: number, r: number, railY: number): this {
    const L = f1 - f0;
    this.cyl(f0 + L * 0.22, f1 - L * 0.26, y, r, 'black');
    this.cyl(f1 - L * 0.26, f1, y, r * 1.45, 'black', { r1: r * 1.45 });
    this.cyl(f1 - L * 0.3, f1 - L * 0.26, y, r * 1.45, 'black', { r1: r });
    this.cyl(f0, f0 + L * 0.18, y, r * 1.3, 'black');
    this.cyl(f0 + L * 0.18, f0 + L * 0.22, y, r, 'black', { r1: r * 1.3 });
    this.cyl(f1 - 0.004, f1, y, r * 1.25, 'glass');
    this.cyl(f0, f0 + 0.004, y, r * 1.1, 'glass');
    const mid = f0 + L * 0.48;
    this.cyl(mid - 0.012, mid + 0.012, y + r + 0.008, 0.011, 'black', { seg: 8 });
    this.box(mid - 0.012, mid + 0.012, y - 0.008, y + 0.008, 0.012, 'black', r + 0.008);
    for (const ff of [f0 + L * 0.3, f1 - L * 0.36]) this.box(ff - 0.012, ff + 0.012, railY, y - r * 0.6, r * 1.3, 'dark');
    return this;
  }

  /** A red-dot / holographic sight on the rail. */
  holo(f: number, railY: number): this {
    this.box(f - 0.03, f + 0.03, railY, railY + 0.018, 0.034, 'black');
    this.prof([[f - 0.028, railY + 0.016], [f + 0.03, railY + 0.016], [f + 0.03, railY + 0.058], [f - 0.022, railY + 0.058]], 0.036, 'black', {
      holes: [[[f - 0.018, railY + 0.024], [f + 0.022, railY + 0.024], [f + 0.022, railY + 0.05], [f - 0.014, railY + 0.05]]],
    });
    this.box(f + 0.018, f + 0.02, railY + 0.024, railY + 0.05, 0.026, 'glass');
    return this;
  }

  /** A trigger guard and a trigger under the receiver, just in front of the grip. */
  trigger(f0: number, f1: number, y: number): this {
    const t = 0.006;
    this.prof([[f0, y], [f1, y], [f1, y - 0.045], [f0 + 0.006, y - 0.05], [f0 + 0.006, y - 0.05 + t], [f1 - t, y - 0.045 + t], [f1 - t, y - t], [f0, y - t]], 0.01, 'black');
    this.box((f0 + f1) / 2 - 0.004, (f0 + f1) / 2 + 0.002, y - 0.032, y, 0.006, 'steel');
    return this;
  }
}

/** A gun's grip outline around the origin: `lean` back, `h` tall, `w` deep at the top. */
function grip(k: Kit, top: number, h: number, depth: number, lean: number, m: Mat, wide = 0.03): void {
  const back = -depth / 2, front = depth / 2;
  const dx = Math.tan(lean) * h;
  k.prof([[back, top], [front, top], [front - dx, top - h], [back - dx - 0.006, top - h], [back - dx - 0.008, top - h + 0.012]], wide, m, { bevel: 0.006 });
}

interface GunDef {
  build: (k: Kit) => void;
  sockets: GunSockets;
}

const GUNS: Partial<Record<WeaponId, GunDef>> = {
  // ------------------------------------------------------------------ 1. Draco SR. (AK pistol, folding stock)
  draco: {
    sockets: { muzzle: [0.5, 0.082], fore: [0.29, 0.045], foreMin: 0.2, mag: [0.13, -0.06], butt: -0.4, tilt: 0.35, scale: 1.1 },
    build: (k) => {
      k.prof([[-0.11, 0.035], [0.19, 0.035], [0.19, 0.1], [0.16, 0.112], [-0.06, 0.118], [-0.11, 0.105]], 0.04, 'steel');
      k.cyl(-0.06, 0.16, 0.112, 0.019, 'steel', { seg: 14 }); // the rounded top cover
      grip(k, 0.035, 0.1, 0.035, 0.38, 'black');
      k.trigger(0.02, 0.075, 0.035);
      // the banana magazine
      k.prof([[0.065, 0.04], [0.118, 0.04], [0.15, -0.03], [0.185, -0.1], [0.2, -0.15], [0.15, -0.165], [0.13, -0.11], [0.098, -0.04]], 0.026, 'wood');
      k.box(0.19, 0.37, 0.045, 0.11, 0.046, 'wood');
      k.cyl(0.19, 0.35, 0.127, 0.012, 'wood');
      k.cyl(0.18, 0.47, 0.082, 0.011, 'steel');
      k.cyl(0.46, 0.5, 0.082, 0.015, 'steel');
      k.box(0.44, 0.455, 0.09, 0.135, 0.008, 'steel');
      k.box(0.15, 0.17, 0.12, 0.138, 0.016, 'steel');
      // the folded-out wire stock
      k.box(-0.38, -0.1, 0.085, 0.097, 0.01, 'steel', 0.012).box(-0.38, -0.1, 0.085, 0.097, 0.01, 'steel', -0.012);
      k.box(-0.36, -0.1, 0.01, 0.022, 0.01, 'steel');
      k.box(-0.41, -0.37, -0.02, 0.105, 0.034, 'rubber');
    },
  },
  // ------------------------------------------------------------------ 2. DMR (AR-style marksman rifle, scope)
  dmr: {
    sockets: { muzzle: [0.84, 0.085], fore: [0.38, 0.045], foreMin: 0.26, mag: [0.11, -0.07], butt: -0.43, tilt: 0.3, scale: 1.05 },
    build: (k) => {
      k.prof([[-0.09, 0.03], [0.2, 0.03], [0.2, 0.11], [-0.09, 0.11]], 0.042, 'black');
      k.rail(-0.08, 0.2, 0.118);
      grip(k, 0.03, 0.1, 0.036, 0.3, 'black');
      k.trigger(0.02, 0.07, 0.03);
      k.box(0.07, 0.135, -0.14, 0.035, 0.032, 'dark'); // 20-round box mag
      k.cyl(-0.27, -0.09, 0.075, 0.016, 'black'); // buffer tube
      k.prof([[-0.44, -0.04], [-0.26, 0.03], [-0.26, 0.11], [-0.44, 0.12]], 0.04, 'black');
      k.prof([[0.2, 0.035], [0.56, 0.035], [0.56, 0.115], [0.2, 0.115]], 0.05, 'dark');
      k.rail(0.2, 0.56, 0.123);
      k.cyl(0.56, 0.8, 0.085, 0.011, 'steel');
      k.cyl(0.78, 0.85, 0.085, 0.016, 'black');
      k.scope(-0.02, 0.3, 0.17, 0.022, 0.123);
    },
  },
  // ------------------------------------------------------------------ 3. Honey Badger (integrally suppressed PDW)
  honeybadger: {
    sockets: { muzzle: [0.55, 0.082], fore: [0.3, 0.05], foreMin: 0.22, mag: [0.1, -0.06], butt: -0.33, tilt: 0.3, scale: 1.08 },
    build: (k) => {
      k.prof([[-0.08, 0.03], [0.18, 0.03], [0.18, 0.11], [-0.08, 0.11]], 0.042, 'black');
      k.rail(-0.08, 0.42, 0.118);
      grip(k, 0.03, 0.1, 0.036, 0.3, 'tan');
      k.trigger(0.02, 0.07, 0.03);
      k.prof([[0.065, 0.035], [0.128, 0.035], [0.14, -0.02], [0.155, -0.11], [0.098, -0.12], [0.085, -0.03]], 0.03, 'tan');
      k.prof([[0.18, 0.035], [0.42, 0.035], [0.42, 0.112], [0.18, 0.112]], 0.05, 'tan'); // the handguard over the can
      k.cyl(0.36, 0.56, 0.08, 0.023, 'dark'); // the integral suppressor
      k.cyl(0.545, 0.56, 0.08, 0.019, 'black');
      k.cyl(-0.22, -0.08, 0.072, 0.009, 'steel', { x: 0.014 }).cyl(-0.22, -0.08, 0.072, 0.009, 'steel', { x: -0.014 });
      k.box(-0.34, -0.21, 0.01, 0.105, 0.032, 'tan');
      k.holo(0.03, 0.123);
    },
  },
  // ------------------------------------------------------------------ 4. Intervention (.408 bolt-action sniper)
  intervention: {
    sockets: { muzzle: [1.08, 0.085], fore: [0.42, 0.04], foreMin: 0.28, mag: [0.15, -0.05], butt: -0.48, tilt: 0.32, scale: 1.0 },
    build: (k) => {
      k.prof([[-0.06, 0.03], [0.32, 0.03], [0.32, 0.115], [-0.06, 0.115]], 0.044, 'dark');
      k.rail(-0.06, 0.34, 0.123);
      grip(k, 0.03, 0.1, 0.034, 0.32, 'black');
      k.trigger(0.02, 0.07, 0.03);
      k.box(0.12, 0.19, -0.07, 0.035, 0.03, 'dark');
      // the skeleton stock with its cheek rest and a monopod
      k.prof([[-0.06, 0.04], [-0.06, 0.11], [-0.49, 0.125], [-0.5, -0.06], [-0.43, -0.065], [-0.38, 0.0], [-0.1, 0.03]], 0.036, 'black', {
        holes: [[[-0.36, 0.035], [-0.12, 0.05], [-0.12, 0.09], [-0.42, 0.1], [-0.44, -0.02]]],
      });
      k.box(-0.42, -0.24, 0.12, 0.15, 0.03, 'black');
      k.box(-0.31, -0.3, -0.11, 0.03, 0.012, 'steel');
      // the barrel shroud, the fluted barrel and the big muzzle brake
      k.cyl(0.32, 0.66, 0.08, 0.032, 'dark', { seg: 10 });
      k.cyl(0.66, 1.0, 0.085, 0.015, 'steel');
      k.box(0.99, 1.09, 0.068, 0.102, 0.05, 'dark');
      // bolt handle
      k.cyl(0.07, 0.09, 0.09, 0.006, 'steel', { x: 0.04 });
      k.cylX(0.08, 0.09, 0.012, 0.018, 'black', 0.062);
      // folded bipod under the shroud
      k.box(0.5, 0.64, 0.035, 0.045, 0.012, 'steel', 0.018).box(0.5, 0.64, 0.035, 0.045, 0.012, 'steel', -0.018);
      k.scope(-0.04, 0.36, 0.185, 0.026, 0.123);
    },
  },
  // ------------------------------------------------------------------ 5. VSS Vintorez (suppressed, wooden thumbhole stock, PSO scope)
  vss: {
    sockets: { muzzle: [0.56, 0.075], fore: [0.3, 0.045], foreMin: 0.2, mag: [0.1, -0.05], butt: -0.42, tilt: 0.34, scale: 1.08 },
    build: (k) => {
      k.prof([[-0.08, 0.035], [0.12, 0.035], [0.12, 0.105], [-0.08, 0.11]], 0.04, 'steel');
      k.box(0.065, 0.125, -0.07, 0.04, 0.028, 'dark'); // 10-round mag
      k.trigger(0.01, 0.06, 0.035);
      // the wooden skeleton stock with its thumbhole, joined to the grip
      k.prof([[-0.08, 0.1], [-0.43, 0.115], [-0.44, -0.07], [-0.36, -0.07], [-0.2, -0.02], [-0.04, -0.07], [0.02, -0.07], [0.02, 0.035], [-0.08, 0.04]], 0.034, 'wood', {
        holes: [[[-0.33, 0.04], [-0.19, 0.02], [-0.1, 0.0], [-0.06, 0.05], [-0.32, 0.085]]],
      });
      k.box(0.12, 0.3, 0.04, 0.1, 0.044, 'wood'); // the wooden handguard
      k.cyl(0.12, 0.56, 0.075, 0.024, 'dark'); // the integral suppressor
      k.cyl(0.545, 0.56, 0.075, 0.02, 'black');
      // the PSO-1 scope on its side mount (offset a little to the left, as on the real thing)
      k.box(-0.04, 0.08, 0.105, 0.125, 0.012, 'dark', -0.024);
      k.scope(-0.06, 0.18, 0.16, 0.019, 0.12);
    },
  },
  // ------------------------------------------------------------------ 6. UZI
  uzi: {
    sockets: { muzzle: [0.26, 0.07], fore: [0.13, 0.03], foreMin: 0.08, mag: [0.0, -0.14], butt: -0.15, tilt: 0.12, scale: 1.12 },
    build: (k) => {
      k.prof([[-0.14, 0.03], [0.2, 0.03], [0.2, 0.105], [-0.14, 0.105]], 0.05, 'steel', { bevel: 0.006 });
      k.box(-0.13, 0.19, 0.105, 0.112, 0.03, 'steel');
      grip(k, 0.03, 0.11, 0.04, 0.12, 'black', 0.036);
      k.box(-0.012, 0.016, -0.25, -0.07, 0.026, 'dark'); // the magazine through the grip
      k.trigger(0.025, 0.075, 0.03);
      k.cyl(0.2, 0.25, 0.07, 0.012, 'steel');
      k.cyl(0.245, 0.27, 0.07, 0.016, 'steel');
      k.box(0.17, 0.185, 0.11, 0.135, 0.008, 'steel', 0.012).box(0.17, 0.185, 0.11, 0.135, 0.008, 'steel', -0.012);
      k.cylX(-0.02, 0.118, 0.01, 0.014, 'black');
      // the folded stock under the receiver
      k.box(-0.15, 0.08, 0.0, 0.012, 0.01, 'steel', 0.026).box(-0.15, 0.08, 0.0, 0.012, 0.01, 'steel', -0.026);
      k.box(-0.16, -0.14, -0.01, 0.08, 0.06, 'steel');
    },
  },
  // ------------------------------------------------------------------ 7. MP7
  mp7: {
    sockets: { muzzle: [0.27, 0.075], fore: [0.17, -0.02], foreMin: 0.12, mag: [0.0, -0.13], butt: -0.27, tilt: 0.1, scale: 1.12 },
    build: (k) => {
      k.prof([[-0.12, 0.03], [0.17, 0.03], [0.2, 0.06], [0.2, 0.1], [0.08, 0.115], [-0.12, 0.112]], 0.046, 'black', { bevel: 0.007 });
      k.rail(-0.1, 0.12, 0.122);
      grip(k, 0.03, 0.1, 0.04, 0.1, 'black', 0.036);
      k.box(-0.012, 0.018, -0.2, -0.06, 0.026, 'dark');
      k.trigger(0.025, 0.07, 0.03);
      // the folding foregrip, folded down
      k.prof([[0.13, 0.035], [0.17, 0.035], [0.18, -0.05], [0.15, -0.055]], 0.03, 'black');
      k.cyl(0.2, 0.26, 0.075, 0.01, 'steel');
      k.cyl(0.25, 0.275, 0.075, 0.013, 'dark');
      // the pulled-out stock rods and pad
      k.box(-0.26, -0.12, 0.08, 0.09, 0.01, 'steel', 0.016).box(-0.26, -0.12, 0.08, 0.09, 0.01, 'steel', -0.016);
      k.box(-0.28, -0.25, 0.0, 0.11, 0.05, 'rubber');
      k.holo(0.0, 0.127);
    },
  },
  // ------------------------------------------------------------------ 8. Double-barrel
  doublebarrel: {
    sockets: { muzzle: [0.74, 0.06], fore: [0.27, 0.02], foreMin: 0.18, mag: [0.06, 0.05], butt: -0.42, tilt: 0.4, scale: 1.04 },
    build: (k) => {
      k.prof([[-0.04, -0.005], [0.09, -0.005], [0.09, 0.07], [0.0, 0.075], [-0.04, 0.07]], 0.05, 'steel');
      k.cyl(0.08, 0.74, 0.06, 0.014, 'steel', { x: 0.0145 }).cyl(0.08, 0.74, 0.06, 0.014, 'steel', { x: -0.0145 });
      k.box(0.09, 0.73, 0.072, 0.078, 0.012, 'steel');
      k.prof([[0.1, 0.0], [0.4, 0.0], [0.42, 0.03], [0.4, 0.045], [0.1, 0.045]], 0.05, 'walnut');
      // the stock, from the wrist (around the grip) back and down to the butt
      k.prof([[-0.04, 0.07], [-0.44, 0.045], [-0.45, -0.115], [-0.4, -0.12], [-0.12, -0.045], [-0.03, -0.06], [0.01, -0.06], [0.0, 0.0], [-0.04, 0.0]], 0.042, 'walnut', { bevel: 0.008 });
      k.trigger(0.0, 0.06, -0.005);
      k.box(0.03, 0.045, 0.075, 0.095, 0.01, 'steel', 0.012).box(0.03, 0.045, 0.075, 0.095, 0.01, 'steel', -0.012); // hammers
    },
  },
  // ------------------------------------------------------------------ 9. Bammer 1997 (trench pump gun)
  bammer: {
    sockets: { muzzle: [0.76, 0.065], fore: [0.38, 0.02], foreMin: 0.3, mag: [0.1, 0.0], butt: -0.42, tilt: 0.4, scale: 1.04 },
    build: (k) => {
      k.prof([[-0.04, -0.01], [0.17, -0.01], [0.17, 0.085], [0.0, 0.092], [-0.04, 0.08]], 0.05, 'steel');
      k.cyl(0.17, 0.76, 0.065, 0.012, 'steel');
      k.cyl(0.17, 0.62, 0.028, 0.011, 'steel'); // magazine tube
      // the ribbed wooden pump
      for (let f = 0.3; f < 0.47; f += 0.02) k.cyl(f, f + 0.014, 0.03, 0.025, 'wood', { seg: 10 });
      k.cyl(0.3, 0.47, 0.03, 0.022, 'wood', { seg: 10 });
      // the perforated heat shield over the barrel
      k.cyl(0.22, 0.62, 0.068, 0.019, 'dark', { seg: 10 });
      for (let f = 0.25; f < 0.6; f += 0.04) k.cylX(f, 0.088, 0.006, 0.034, 'black');
      k.prof([[-0.04, 0.08], [-0.44, 0.06], [-0.45, -0.11], [-0.4, -0.115], [-0.12, -0.04], [-0.03, -0.065], [0.01, -0.06], [0.0, 0.0], [-0.04, 0.0]], 0.042, 'wood', { bevel: 0.008 });
      k.trigger(0.0, 0.06, -0.01);
      k.box(-0.035, -0.015, 0.085, 0.11, 0.01, 'steel'); // the hammer
    },
  },
  // ------------------------------------------------------------------ 10. Taurus – Mia Edition
  taurus: {
    sockets: { muzzle: [0.16, 0.07], butt: -0.05, tilt: 0.28, scale: 1.15 },
    build: (k) => {
      k.prof([[-0.06, 0.045], [0.16, 0.045], [0.16, 0.088], [-0.05, 0.092], [-0.062, 0.08]], 0.03, 'black');
      for (let f = -0.045; f < -0.01; f += 0.008) k.box(f, f + 0.003, 0.05, 0.088, 0.031, 'pink');
      k.prof([[-0.03, 0.03], [0.14, 0.03], [0.14, 0.048], [-0.03, 0.048]], 0.028, 'black');
      grip(k, 0.035, 0.11, 0.042, 0.28, 'pink', 0.032);
      k.trigger(0.01, 0.06, 0.035);
      k.box(0.145, 0.155, 0.088, 0.098, 0.006, 'steel');
      k.box(-0.055, -0.045, 0.088, 0.098, 0.014, 'steel');
      k.cyl(0.155, 0.165, 0.07, 0.006, 'dark');
    },
  },
  // ------------------------------------------------------------------ 11. Magnum .44 (revolver)
  magnum: {
    sockets: { muzzle: [0.3, 0.072], butt: -0.06, tilt: 0.35, scale: 1.12 },
    build: (k) => {
      k.prof([[-0.04, 0.03], [0.07, 0.03], [0.075, 0.095], [-0.02, 0.1], [-0.045, 0.085]], 0.026, 'chrome');
      k.cyl(0.0, 0.07, 0.06, 0.026, 'chrome', { seg: 6 }); // the cylinder (six-sided reads as fluted)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.cyl(0.066, 0.071, 0.06 + Math.sin(a) * 0.015, 0.0045, 'black', { x: Math.cos(a) * 0.015, seg: 6 });
      }
      k.cyl(0.07, 0.3, 0.072, 0.011, 'chrome');
      k.box(0.07, 0.3, 0.078, 0.09, 0.012, 'chrome'); // top rib
      k.box(0.07, 0.24, 0.04, 0.062, 0.016, 'chrome'); // ejector shroud
      k.box(0.285, 0.298, 0.09, 0.106, 0.006, 'steel');
      k.box(-0.05, -0.025, 0.09, 0.115, 0.01, 'chrome'); // hammer spur
      grip(k, 0.035, 0.105, 0.04, 0.42, 'walnut', 0.034);
      k.trigger(0.0, 0.05, 0.035);
    },
  },
  // ------------------------------------------------------------------ 12. Kriss Vector (angled body, drum, suppressor)
  vector: {
    sockets: { muzzle: [0.46, 0.08], fore: [0.2, -0.01], foreMin: 0.14, mag: [0.15, -0.12], butt: -0.32, tilt: 0.05, scale: 1.1 },
    build: (k) => {
      k.prof([[-0.08, 0.035], [0.03, 0.035], [0.08, -0.05], [0.2, -0.05], [0.24, 0.0], [0.24, 0.115], [-0.08, 0.115]], 0.046, 'black', { bevel: 0.006 });
      k.rail(-0.06, 0.22, 0.122);
      grip(k, 0.035, 0.1, 0.038, 0.05, 'black', 0.034);
      k.trigger(0.025, 0.07, 0.035);
      k.cylX(0.15, -0.12, 0.068, 0.05, 'dark'); // the drum
      k.cylX(0.15, -0.12, 0.03, 0.054, 'black');
      k.box(0.125, 0.175, -0.07, -0.05, 0.03, 'dark');
      k.cyl(0.24, 0.29, 0.08, 0.011, 'steel');
      k.cyl(0.28, 0.46, 0.08, 0.021, 'dark'); // suppressor
      // the folding skeleton stock
      k.prof([[-0.08, 0.04], [-0.33, 0.02], [-0.34, 0.11], [-0.08, 0.11]], 0.03, 'black', { holes: [[[-0.29, 0.04], [-0.12, 0.055], [-0.12, 0.095], [-0.3, 0.095]]] });
      k.holo(0.02, 0.127);
    },
  },
  // ------------------------------------------------------------------ 12. P90 (bullpup, top magazine, ring sight)
  p90: {
    sockets: { muzzle: [0.28, 0.055], fore: [0.14, -0.015], foreMin: 0.1, mag: [-0.05, 0.12], butt: -0.3, tilt: 0.25, scale: 1.12 },
    build: (k) => {
      // the whole body is one rounded shell with a thumbhole around the grip
      k.prof([[-0.31, -0.06], [-0.2, -0.07], [-0.06, -0.05], [0.04, -0.06], [0.12, -0.04], [0.2, 0.0], [0.24, 0.05], [0.24, 0.1], [-0.31, 0.105]], 0.056, 'black', {
        bevel: 0.01,
        holes: [[[-0.035, -0.035], [0.04, -0.035], [0.065, 0.02], [-0.02, 0.025]]],
      });
      k.box(-0.24, 0.16, 0.105, 0.13, 0.046, 'smoke'); // the translucent top magazine
      k.box(-0.24, 0.16, 0.112, 0.124, 0.047, 'brass');
      k.ring(0.04, 0.16, 0.022, 0.004, 'black');
      k.box(0.02, 0.06, 0.13, 0.142, 0.012, 'black');
      k.cyl(0.24, 0.29, 0.055, 0.011, 'steel');
      k.trigger(0.01, 0.05, 0.03);
    },
  },
  // ------------------------------------------------------------------ 12. Scorpion EVO
  scorpion: {
    sockets: { muzzle: [0.26, 0.075], fore: [0.17, 0.03], foreMin: 0.12, mag: [0.1, -0.07], butt: -0.3, tilt: 0.25, scale: 1.12 },
    build: (k) => {
      k.prof([[-0.1, 0.03], [0.18, 0.03], [0.2, 0.05], [0.2, 0.1], [-0.1, 0.112]], 0.048, 'black', { bevel: 0.006 });
      for (let f = 0.06; f < 0.18; f += 0.025) k.box(f, f + 0.012, 0.04, 0.09, 0.05, 'dark');
      k.rail(-0.08, 0.18, 0.12);
      grip(k, 0.03, 0.1, 0.038, 0.28, 'black', 0.034);
      k.prof([[0.065, 0.035], [0.12, 0.035], [0.13, -0.02], [0.14, -0.15], [0.09, -0.155], [0.08, -0.03]], 0.026, 'smoke');
      k.trigger(0.02, 0.065, 0.03);
      k.cyl(0.2, 0.25, 0.075, 0.011, 'steel');
      k.cyl(0.24, 0.27, 0.075, 0.015, 'dark');
      k.prof([[-0.1, 0.04], [-0.3, 0.02], [-0.31, 0.11], [-0.1, 0.105]], 0.03, 'black', { holes: [[[-0.27, 0.04], [-0.13, 0.05], [-0.13, 0.09], [-0.28, 0.095]]] });
    },
  },
  // ------------------------------------------------------------------ 12. PP-19 Bizon (helical magazine)
  bizon: {
    sockets: { muzzle: [0.42, 0.085], fore: [0.24, -0.02], foreMin: 0.16, mag: [0.2, -0.01], butt: -0.38, tilt: 0.35, scale: 1.08 },
    build: (k) => {
      k.prof([[-0.12, 0.035], [0.17, 0.035], [0.17, 0.1], [0.14, 0.112], [-0.06, 0.118], [-0.12, 0.105]], 0.04, 'steel');
      k.cyl(-0.06, 0.15, 0.11, 0.019, 'steel', { seg: 14 });
      grip(k, 0.035, 0.1, 0.035, 0.38, 'black');
      k.trigger(0.02, 0.07, 0.035);
      // the helical magazine under the barrel, with its ridges
      k.cyl(0.06, 0.4, 0.0, 0.034, 'black', { seg: 14 });
      for (let f = 0.09; f < 0.39; f += 0.03) k.cyl(f, f + 0.01, 0.0, 0.037, 'dark', { seg: 14 });
      k.box(0.17, 0.32, 0.045, 0.1, 0.04, 'black');
      k.cyl(0.17, 0.42, 0.085, 0.011, 'steel');
      k.box(0.36, 0.375, 0.095, 0.13, 0.008, 'steel');
      // the folding metal stock
      k.box(-0.39, -0.12, 0.085, 0.097, 0.01, 'steel', 0.012).box(-0.39, -0.12, 0.085, 0.097, 0.01, 'steel', -0.012);
      k.box(-0.38, -0.12, 0.0, 0.012, 0.01, 'steel');
      k.box(-0.41, -0.37, -0.02, 0.105, 0.034, 'steel');
    },
  },
  // ------------------------------------------------------------------ the knife
  knife: {
    sockets: { muzzle: [0.2, 0.0], butt: -0.05, tilt: 0, scale: 1.0 },
    build: (k) => {
      k.prof([[0.045, -0.012], [0.2, -0.002], [0.23, 0.012], [0.19, 0.018], [0.045, 0.016]], 0.004, 'blade', { bevel: 0.0012 });
      k.box(0.035, 0.048, -0.02, 0.024, 0.02, 'steel');
      k.prof([[-0.075, -0.013], [0.036, -0.012], [0.036, 0.016], [-0.07, 0.014], [-0.08, 0.0]], 0.022, 'rubber', { bevel: 0.006 });
    },
  },
};

const built = new Map<WeaponId, THREE.Group>();

/** True when there is a model for this gun. */
export function hasGunModel(id: string): boolean {
  return !!GUNS[id as WeaponId];
}

/** A gun's sockets (null for anything without a model). */
export function gunSockets(id: string): GunSockets | null {
  return GUNS[id as WeaponId]?.sockets ?? null;
}

/**
 * A fresh copy of a gun's model (shared geometry and materials), already at its drawing
 * scale: origin at the grip, muzzle down -Z.
 */
export function makeGunModel(id: string): THREE.Group | null {
  const def = GUNS[id as WeaponId];
  if (!def) return null;
  let tpl = built.get(id as WeaponId);
  if (!tpl) {
    const k = new Kit();
    def.build(k);
    k.g.scale.setScalar(def.sockets.scale);
    k.g.name = `gun-${id}`;
    tpl = k.g;
    built.set(id as WeaponId, tpl);
  }
  return tpl.clone(true);
}

/** The muzzle in model space (after the drawing scale). */
export function muzzleOf(id: string): THREE.Vector3 | null {
  const s = gunSockets(id);
  return s ? new THREE.Vector3(0, s.muzzle[1] * s.scale, -s.muzzle[0] * s.scale) : null;
}
