import * as THREE from 'three';
import { el } from './dom';

interface Pop {
  node: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  drift: number;
}

const LIFE = 0.95;
const MAX = 24;
const _p = new THREE.Vector3();

/**
 * Floating damage numbers over whoever you hit: white for body shots, yellow for headshots,
 * red (and bigger) for the hit that knocks them off. They float up and fade out.
 */
export class DamageNumbers {
  readonly root: HTMLElement;
  private pops: Pop[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dmg-layer');
    parent.append(this.root);
  }

  /** `at` is the world point to float from (the victim's chest or head). */
  add(at: THREE.Vector3, damage: number, kind: 'hit' | 'head' | 'kill'): void {
    if (damage <= 0) return;
    if (this.pops.length >= MAX) this.remove(0);
    const node = el('div', `dmg-pop ${kind}`, String(Math.round(damage)));
    this.root.append(node);
    this.pops.push({ node, pos: at.clone(), age: 0, drift: (Math.random() - 0.5) * 0.5 });
  }

  private remove(i: number): void {
    this.pops[i].node.remove();
    this.pops.splice(i, 1);
  }

  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      if (p.age >= LIFE) {
        this.remove(i);
        continue;
      }
      const t = p.age / LIFE;
      _p.copy(p.pos);
      _p.y += 0.25 + t * 0.7;
      _p.project(camera);
      if (_p.z > 1 || _p.z < -1) {
        p.node.style.opacity = '0';
        continue;
      }
      const x = (_p.x * 0.5 + 0.5) * width + p.drift * 60 * t;
      const y = (-_p.y * 0.5 + 0.5) * height;
      const pop = t < 0.12 ? 0.7 + (t / 0.12) * 0.5 : 1.2 - Math.min(0.2, (t - 0.12) * 0.6);
      p.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      p.node.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
