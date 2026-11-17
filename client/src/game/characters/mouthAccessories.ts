import * as THREE from 'three';
import { LIGHTING } from '../lighting';

/**
 * Mouth accessories (cigarette, Dark & Mild cigarillo, baby bottle). Each one is built in
 * "mouth space": origin on the lips, -Z pointing out of the face, +Y up, sizes in meters.
 * The character attaches `object` to its head; smokes also put a few smoke puffs on the
 * character root that rise from the lit tip.
 */

/** Things a character can hold in the mouth (Appearance.mouthProp). */
export type MouthPropId = 'none' | 'cigarette' | 'darkmild' | 'bottle';

/** Drawn a bit larger than life so they read on a 1.8 m character at gameplay distance. */
export const MOUTH_SCALE = 1.6;

// ---- shared geometry + materials (built on first use, never disposed: they are tiny) ----
function mat(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  // same faint self-light as the characters so the props stay readable at night
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, emissive: color, emissiveIntensity: LIGHTING.characterGlow * 2, ...extra });
}

let shared: ReturnType<typeof buildShared> | null = null;
function buildShared() {
  return {
    filter: mat(0xc98038),
    paper: mat(0xf1eee6),
    ember: mat(0x3a1408, { emissive: 0xff4a12, emissiveIntensity: 1.8, roughness: 1 }),
    ash: mat(0x8d8a86, { roughness: 1 }),
    wood: mat(0xd6a66a, { roughness: 0.55 }),
    leaf: mat(0x3b2215, { roughness: 0.6 }),
    rubber: mat(0xe4bd93, { roughness: 0.5 }),
    collar: mat(0x6fc3ff, { roughness: 0.35 }),
    plastic: new THREE.MeshStandardMaterial({
      color: 0xe8f3ff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false,
      emissive: 0xe8f3ff, emissiveIntensity: LIGHTING.characterGlow * 2,
    }),
    milk: mat(0xfbfaf3, { roughness: 0.4 }),
    cylinders: new Map<string, THREE.CylinderGeometry>(),
  };
}
function S() {
  return (shared ??= buildShared());
}

/** A round rod running from z = `from` toward -Z for `length` (radius `rFar` at the far end). */
function rod(rNear: number, rFar: number, length: number, from: number, material: THREE.Material, segs = 10): THREE.Mesh {
  const key = `${rNear}|${rFar}|${length}|${segs}`;
  const cache = S().cylinders;
  let g = cache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rFar, rNear, length, segs);
    g.rotateX(-Math.PI / 2); // +Y (the rFar end) -> -Z
    cache.set(key, g);
  }
  const m = new THREE.Mesh(g, material);
  m.position.z = from - length / 2;
  m.castShadow = false;
  return m;
}

// ---- smoke ----
let puffTexture: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  puffTexture.colorSpace = THREE.SRGBColorSpace;
  return puffTexture;
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  start: THREE.Vector3;
  drift: THREE.Vector3;
}

/** A thin trail of smoke puffs rising from a point (in the coordinates of `group`'s parent). */
class Smoke {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];

  constructor(count = 5) {
    const map = smokeTexture();
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xd4d4d4, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.renderOrder = 2;
      const life = 1.5 + Math.random() * 0.5;
      this.puffs.push({ sprite, age: (i / count) * life, life, start: new THREE.Vector3(), drift: new THREE.Vector3() });
      this.group.add(sprite);
    }
  }

  update(dt: number, from: THREE.Vector3): void {
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age >= p.life) {
        p.age -= p.life;
        p.start.copy(from);
        p.drift.set((Math.random() - 0.5) * 0.12, 0.3 + Math.random() * 0.12, (Math.random() - 0.5) * 0.12);
      }
      const t = p.age / p.life;
      p.sprite.position.copy(p.start).addScaledVector(p.drift, t);
      p.sprite.position.y += Math.sin(t * 9 + p.life * 7) * 0.012 * t;
      p.sprite.scale.setScalar(0.035 + 0.12 * t);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.3 * Math.min(1, t * 6) * (1 - t);
    }
  }

  dispose(): void {
    for (const p of this.puffs) (p.sprite.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

const _tip = new THREE.Vector3();

export class MouthAccessory {
  /** Goes on the head, positioned at the lips (see the module comment for its axes). */
  readonly object = new THREE.Group();
  /** Lit end of a smoke (null for the bottle). */
  private tip: THREE.Object3D | null = null;
  private smoke: Smoke | null = null;
  private smokeParent: THREE.Object3D | null = null;

  constructor(readonly id: Exclude<MouthPropId, 'none'>) {
    const s = S();
    const body = new THREE.Group();
    this.object.add(body);
    if (id === 'cigarette') {
      // filter in the corner of the mouth, drooping a little and angled out
      const r = 0.0046;
      body.add(rod(r, r, 0.026, 0.006, s.filter), rod(r, r, 0.058, -0.02, s.paper), rod(r, r * 0.95, 0.004, -0.078, s.ash), rod(r * 0.95, r * 0.85, 0.005, -0.082, s.ember, 8));
      body.position.x = 0.016;
      body.rotation.set(-0.24, -0.22, 0);
      this.tip = new THREE.Object3D();
      this.tip.position.z = -0.087;
      body.add(this.tip);
    } else if (id === 'darkmild') {
      // plastic-free wood tip, dark leaf body
      body.add(
        rod(0.0042, 0.0058, 0.03, 0.008, s.wood),
        rod(0.0064, 0.0064, 0.084, -0.022, s.leaf),
        rod(0.0064, 0.0062, 0.004, -0.106, s.ash),
        rod(0.0062, 0.0055, 0.005, -0.11, s.ember, 8),
      );
      body.position.x = 0.01;
      body.rotation.set(-0.14, -0.16, 0);
      this.tip = new THREE.Object3D();
      this.tip.position.z = -0.115;
      body.add(this.tip);
    } else {
      // nipple in the mouth, bottle tipped up as if mid-sip
      body.add(
        rod(0.0045, 0.006, 0.012, 0.004, s.rubber),
        rod(0.007, 0.014, 0.01, -0.008, s.rubber),
        rod(0.024, 0.024, 0.015, -0.016, s.collar, 16),
        rod(0.0195, 0.0195, 0.056, -0.031, s.milk, 14),
        rod(0.022, 0.022, 0.092, -0.031, s.plastic, 16),
        rod(0.022, 0.022, 0.005, -0.123, s.collar, 16),
      );
      body.rotation.set(0.42, 0, 0);
    }
  }

  /** Smokes: puts the smoke trail on `parent` (the character root, so it is not tied to head bobbing). */
  attachSmoke(parent: THREE.Object3D): void {
    if (!this.tip || this.smoke) return;
    this.smoke = new Smoke();
    this.smokeParent = parent;
    parent.add(this.smoke.group);
  }

  update(dt: number): void {
    if (this.tip) {
      // shared ember material: breathe slowly, with a brighter pull every few seconds
      const t = performance.now() / 1000;
      const drag = Math.max(0, Math.sin((t % 6) / 6 * Math.PI * 2 - 1.2)) ** 6;
      S().ember.emissiveIntensity = 1.4 + 0.35 * Math.sin(t * 6.3) + 0.2 * Math.sin(t * 15.1) + 2.2 * drag;
    }
    if (this.smoke && this.tip && this.smokeParent) {
      this.tip.getWorldPosition(_tip);
      this.smokeParent.worldToLocal(_tip);
      this.smoke.update(dt, _tip);
    }
  }

  setSmokeVisible(v: boolean): void {
    if (this.smoke) this.smoke.group.visible = v;
  }

  dispose(): void {
    this.smoke?.dispose();
    this.object.removeFromParent();
  }
}

export function createMouthAccessory(id: string | undefined): MouthAccessory | null {
  return id === 'cigarette' || id === 'darkmild' || id === 'bottle' ? new MouthAccessory(id) : null;
}
