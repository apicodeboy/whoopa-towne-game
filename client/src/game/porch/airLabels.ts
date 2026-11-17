import * as THREE from 'three';
import type { MapDef } from '@shared/map/types';

const _p = new THREE.Vector3();

/**
 * JUMP OFF THE PORCH: the big area names floating over the map while you are up in the air,
 * so a squad can call where it is landing ("we going DOWNTOWN"). Each name is pinned to its
 * area and dims and shrinks as you get close to it, so it is out of the way by the time you
 * land there.
 */
export class AirLabels {
  readonly root: HTMLElement;
  private items: Array<{ el: HTMLElement; name: string; x: number; z: number; shown: boolean }> = [];
  private placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  private todo: Array<{ it: AirLabels['items'][number]; sx: number; sy: number; scale: number; alpha: number; dist: number }> = [];

  constructor(parent: HTMLElement, map: MapDef) {
    this.root = document.createElement('div');
    this.root.className = 'air-labels';
    for (const d of map.districts ?? []) {
      const el = document.createElement('div');
      el.className = 'air-label';
      el.innerHTML = `<span>${d.name}</span><i></i>`;
      this.root.appendChild(el);
      this.items.push({ el, name: d.name, x: d.x, z: d.z, shown: false });
    }
    parent.appendChild(this.root);
  }

  update(camera: THREE.PerspectiveCamera, show: boolean, width: number, height: number): void {
    this.root.classList.toggle('on', show);
    if (!show) return;
    const font = width < 760 ? 26 : 40;
    this.todo.length = 0;
    for (const it of this.items) {
      _p.set(it.x, 6, it.z);
      const dist = _p.distanceTo(camera.position);
      _p.project(camera);
      const visible = _p.z < 1 && Math.abs(_p.x) < 1.15 && Math.abs(_p.y) < 1.15;
      // full size far away, smaller and fainter the closer you get, gone just before you land on it
      const near = Math.min(1, Math.max(0, (dist - 28) / 170));
      const alpha = Math.min(1, Math.max(0, (dist - 24) / 80)) * 0.95;
      if (!visible || alpha <= 0.01) {
        if (it.shown) {
          it.el.style.opacity = '0';
          it.shown = false;
        }
        continue;
      }
      it.shown = true;
      this.todo.push({ it, sx: (_p.x * 0.5 + 0.5) * width, sy: (-_p.y * 0.5 + 0.5) * height, scale: 0.4 + 0.6 * near, alpha, dist });
    }
    // names that land on top of each other: the farther one moves up out of the way
    this.todo.sort((a, b) => a.dist - b.dist);
    this.placed.length = 0;
    for (const t of this.todo) {
      const w = t.it.name.length * font * 0.66 * t.scale, h = font * 1.25 * t.scale;
      let y1 = t.sy - 12 * t.scale;
      for (let guard = 0; guard < 6; guard++) {
        const hit = this.placed.find((r) => t.sx + w / 2 > r.x0 && t.sx - w / 2 < r.x1 && y1 > r.y0 && y1 - h < r.y1);
        if (!hit) break;
        y1 = hit.y0 - 4;
      }
      this.placed.push({ x0: t.sx - w / 2, x1: t.sx + w / 2, y0: y1 - h, y1 });
      const lift = t.sy - 12 * t.scale - y1;
      t.it.el.style.opacity = t.alpha.toFixed(3);
      t.it.el.style.transform = `translate(${t.sx.toFixed(1)}px, ${(t.sy - lift).toFixed(1)}px) translate(-50%, -100%) scale(${t.scale.toFixed(3)})`;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
