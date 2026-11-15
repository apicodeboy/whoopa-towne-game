import * as THREE from 'three';

const PAD = 6;

interface Page {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
  rowH: number;
  /** Vertex data per layer: opaque shop signs and see-through decals (graffiti). */
  layers: Record<'sign' | 'decal', { pos: number[]; uv: number[]; idx: number[] }>;
}

/**
 * Packs every sign, label and graffiti tag into one shared texture and one merged mesh per
 * layer, so all the signage on the map costs two draw calls instead of one per sign.
 */
export class SignAtlas {
  private size: number;
  private pages: Page[] = [];

  constructor(size = 2048) {
    this.size = size;
  }

  private newPage(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    const page: Page = {
      canvas, g: canvas.getContext('2d')!, x: PAD, y: PAD, rowH: 0,
      layers: { sign: { pos: [], uv: [], idx: [] }, decal: { pos: [], uv: [], idx: [] } },
    };
    this.pages.push(page);
    return page;
  }

  /**
   * Adds a flat quad showing `image`, centered at (x, y, z), `width` x `height` meters,
   * facing along its normal at `yaw` (same convention as a rotated PlaneGeometry).
   */
  add(image: HTMLCanvasElement, layer: 'sign' | 'decal', x: number, y: number, z: number, yaw: number, width: number, height: number): void {
    const w = Math.min(image.width, this.size - PAD * 2), h = Math.min(image.height, this.size - PAD * 2);
    let page = this.pages[this.pages.length - 1] ?? this.newPage();
    if (page.x + w + PAD > this.size) {
      page.x = PAD;
      page.y += page.rowH + PAD;
      page.rowH = 0;
    }
    if (page.y + h + PAD > this.size) page = this.newPage();
    page.g.drawImage(image, page.x, page.y, w, h);
    const u0 = page.x / this.size, u1 = (page.x + w) / this.size;
    const v1 = 1 - page.y / this.size, v0 = 1 - (page.y + h) / this.size;
    page.x += w + PAD;
    page.rowH = Math.max(page.rowH, h);

    const L = page.layers[layer];
    const base = L.pos.length / 3;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hw = width / 2, hh = height / 2;
    // corners: bottom-left, bottom-right, top-right, top-left (as seen from the front)
    for (const [lx, ly, u, v] of [[-hw, -hh, u0, v0], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1]]) {
      L.pos.push(x + lx * c, y + ly, z - lx * s);
      L.uv.push(u, v);
    }
    L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Builds the meshes. Everything created is pushed to `disposables`. */
  build(disposables: Array<{ dispose(): void }>): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const page of this.pages) {
      const texture = new THREE.CanvasTexture(page.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      disposables.push(texture);
      for (const layer of ['sign', 'decal'] as const) {
        const L = page.layers[layer];
        if (L.idx.length === 0) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(L.uv, 2));
        geometry.setIndex(L.idx);
        geometry.computeBoundingSphere();
        // shop signs are lit boxes (they glow at night); graffiti is paint and takes the scene's light
        const material = layer === 'sign'
          ? new THREE.MeshBasicMaterial({ map: texture })
          : new THREE.MeshStandardMaterial({
              map: texture, transparent: true, depthWrite: false, roughness: 0.95,
              polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
            });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = layer === 'decal' ? 2 : 0;
        mesh.matrixAutoUpdate = false;
        disposables.push(geometry, material);
        out.push(mesh);
      }
    }
    return out;
  }
}
