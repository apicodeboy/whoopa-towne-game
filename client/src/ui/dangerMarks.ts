import * as THREE from 'three';
import { MARK } from '@shared/config/game';
import { el } from './dom';

interface Mark {
  node: HTMLElement;
  dist: HTMLElement;
  pos: THREE.Vector3;
  /** Who put it up (one mark each: a new one replaces their old one). */
  by: number;
  age: number;
}

const _p = new THREE.Vector3();
const EDGE = 34;

/**
 * Danger marks: when you or a squad mate marks danger, a red marker hangs over the spot for a
 * few seconds with who called it and how far away it is. Off screen, it sits at the edge of the
 * screen pointing the way.
 */
export class DangerMarks {
  readonly root: HTMLElement;
  private marks: Mark[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'mark-layer');
    parent.append(this.root);
  }

  add(by: number, name: string, x: number, y: number, z: number, mine: boolean): void {
    const old = this.marks.findIndex((m) => m.by === by);
    if (old >= 0) this.remove(old);
    const dist = el('span', 'mk-dist', '');
    const node = el('div', `danger-mark${mine ? ' mine' : ''}`, [el('b', 'mk-icon', [el('i', '', '!')]), el('span', 'mk-name', mine ? 'DANGER' : name.toUpperCase()), dist]);
    this.root.append(node);
    this.marks.push({ node, dist, pos: new THREE.Vector3(x, y, z), by, age: 0 });
  }

  /** Where the marks are (for the minimap). */
  points(): Array<{ x: number; z: number; age: number }> {
    return this.marks.map((m) => ({ x: m.pos.x, z: m.pos.z, age: m.age }));
  }

  private remove(i: number): void {
    this.marks[i].node.remove();
    this.marks.splice(i, 1);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, width: number, height: number, me: { x: number; y: number; z: number }): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.age += dt;
      if (m.age >= MARK.life) {
        this.remove(i);
        continue;
      }
      _p.copy(m.pos);
      _p.y += 0.6;
      // in front of or behind the camera
      const behind = _p.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())) < 0;
      _p.project(camera);
      let x = (_p.x * 0.5 + 0.5) * width, y = (-_p.y * 0.5 + 0.5) * height;
      if (behind) {
        x = width - x;
        y = height - EDGE;
      }
      const off = behind || x < EDGE || x > width - EDGE || y < EDGE || y > height - EDGE;
      x = Math.min(width - EDGE, Math.max(EDGE, x));
      y = Math.min(height - EDGE, Math.max(EDGE, y));
      const d = Math.hypot(m.pos.x - me.x, m.pos.y - me.y, m.pos.z - me.z);
      m.dist.textContent = `${Math.round(d)}m`;
      const fade = m.age > MARK.life - 1 ? MARK.life - m.age : 1;
      m.node.style.opacity = fade.toFixed(2);
      m.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      m.node.classList.toggle('edge', off);
      m.node.classList.toggle('fresh', m.age < 1.2);
    }
  }

  clear(): void {
    while (this.marks.length) this.remove(0);
  }

  dispose(): void {
    this.root.remove();
  }
}
