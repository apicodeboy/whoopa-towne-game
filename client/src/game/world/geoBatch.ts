import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/**
 * Collects arbitrary small geometries (cylinders, cones, blobs...) with a transform and a
 * tint, and merges them into one draw call. The curved-shape companion to BoxBatch.
 */
export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // keep only what every part has in common
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    this.parts.push(g);
  }

  /** Adds a geometry that already carries its own per-vertex colors (non-indexed, world space). */
  addColored(geo: THREE.BufferGeometry): void {
    this.parts.push(geo);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (merged) {
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
    }
    return merged;
  }
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

/** Translation + yaw (+ optional tilt) + non-uniform scale as a matrix. */
export function trs(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  _pos.set(x, y, z);
  _quat.setFromEuler(_euler.set(rx, ry, rz, 'YXZ'));
  _scale.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_pos, _quat, _scale);
}
