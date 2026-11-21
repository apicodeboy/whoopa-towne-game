import * as THREE from 'three';
import type { Assets } from './assets';
import { applyWeaponSkin } from './characters/weaponSkins';
import { makeGunModel } from './gunKit';

/** Which model each held thing uses, and which way its muzzle points after loading. */
const MODELS: Record<string, { model: string; muzzleNegZ: boolean; stretch?: number }> = {
  // (the guns themselves come from gunKit; only the throwables are model files)
  grenade: { model: 'grenade', muzzleNegZ: true },
  smoke: { model: 'grenade', muzzleNegZ: true },
};

const W = 320;
const H = 160;

/**
 * Side-on pictures of the guns (with the player's wrap on), rendered once from the real 3D
 * models into transparent PNGs: the equipped-weapon panel and the pickup cards use them.
 */
export class GunIcons {
  private cache = new Map<string, string>();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 20);
  private target: THREE.WebGLRenderTarget;

  constructor(private renderer: THREE.WebGLRenderer, private assets: Assets | null) {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a76, 3.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(1.5, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd9ff, 1.8);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);
    this.target = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Data URL of the picture ('' when there is no model, e.g. fists or models still loading). */
  get(id: string, skin = 'none'): string {
    const key = `${id}|${skin}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const url = this.render(id, skin);
    if (url) this.cache.set(key, url);
    return url;
  }

  private render(id: string, skin: string): string {
    const holder = new THREE.Group();
    const kit = makeGunModel(id);
    if (kit) {
      // the weapon collection's own models (muzzle down -Z): muzzle to the right
      applyWeaponSkin(kit, skin, new THREE.Box3().setFromObject(kit).getSize(new THREE.Vector3()));
      kit.rotation.y = -Math.PI / 2;
      holder.add(kit);
    } else {
      const spec = MODELS[id];
      const tpl = spec && this.assets ? this.assets.model(spec.model) : null;
      if (!spec || !tpl) return '';
      const g = tpl.root.clone(true);
      if (id !== 'grenade' && id !== 'smoke') applyWeaponSkin(g, skin, tpl.size);
      // muzzle to the right (+X), seen from the side, a little from above
      g.rotation.y = (spec.muzzleNegZ ? 0 : Math.PI) - Math.PI / 2;
      if (spec.stretch) g.scale.set(1, 1, spec.stretch);
      holder.add(g);
    }
    holder.rotation.set(0.18, 0, -0.04);
    this.scene.add(holder);
    // fit the box in the frame
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.x / 2 / (W / H), size.y / 2) * 1.12;
    const cam = this.camera;
    cam.left = -half * (W / H);
    cam.right = half * (W / H);
    cam.top = half;
    cam.bottom = -half;
    cam.position.set(c.x, c.y, c.z + 10);
    cam.lookAt(c);
    cam.updateProjectionMatrix();

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const pixels = new Uint8Array(W * H * 4);
    try {
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(this.scene, cam);
      r.readRenderTargetPixels(this.target, 0, 0, W, H, pixels);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevColor, prevAlpha);
      this.scene.remove(holder);
    }
    // flip (GL rows run bottom-up) into a canvas
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  dispose(): void {
    this.target.dispose();
  }
}
