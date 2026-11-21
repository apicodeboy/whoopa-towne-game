import * as THREE from 'three';
import { terrainHeight, terrainMesh, type TerrainDef } from '@shared/map/terrain';
import type { GeoBatch } from './geoBatch';

/**
 * Draws the hills: the same triangles the collision uses (so what you see is what you stand
 * on), smooth-shaded from the height function, grass textured in world space. The slopes go a
 * drier, rockier green the steeper they get; painted patches (the drive, the apron, the stones
 * round the fire pit) take their own ground.
 */
export function drawTerrain(t: TerrainDef, geo: (key: string) => GeoBatch): void {
  const { pos, idx } = terrainMesh(t);
  if (idx.length === 0) return;
  const LIFT = 0.012; // a hair over the level ground it meets, so the two never flicker
  const height = (x: number, z: number) => terrainHeight(t, x, z);
  const normalAt = (x: number, z: number, out: THREE.Vector3) => {
    const e = 0.35;
    return out.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
  };
  const paintAt = (x: number, z: number) => t.paint?.find((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)?.kind;
  const KEYS: Record<string, { key: string; tile: number }> = {
    grass: { key: 'ground:grass', tile: 5 },
    gravel: { key: 'ground:gravel', tile: 3 },
    dirt: { key: 'ground:gravel', tile: 3 },
    stone: { key: 'ground:concrete', tile: 2 },
  };
  const buckets = new Map<string, { pos: number[]; nrm: number[]; uv: number[]; col: number[]; tile: number }>();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const dry = new THREE.Color(0xc9b991), lush = new THREE.Color(0xffffff), rock = new THREE.Color(0xa89c88);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k], b = idx[k + 1], d = idx[k + 2];
    const cx = (pos[a * 3] + pos[b * 3] + pos[d * 3]) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[d * 3 + 2]) / 3;
    const kind = paintAt(cx, cz) ?? 'grass';
    const spec = KEYS[kind];
    let bucket = buckets.get(spec.key + kind);
    if (!bucket) buckets.set(spec.key + kind, (bucket = { pos: [], nrm: [], uv: [], col: [], tile: spec.tile }));
    for (const v of [a, b, d]) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      bucket.pos.push(x, y + LIFT, z);
      normalAt(x, z, n);
      bucket.nrm.push(n.x, n.y, n.z);
      bucket.uv.push(x / spec.tile, -z / spec.tile);
      if (kind === 'grass') {
        // steeper is drier and rockier
        const steep = 1 - n.y;
        c.copy(lush).lerp(dry, Math.min(1, steep * 2.2));
        if (steep > 0.22) c.lerp(rock, Math.min(1, (steep - 0.22) * 3));
      } else if (kind === 'stone') c.setHex(0xb3aa9c);
      else c.setHex(kind === 'dirt' ? 0xb49a74 : 0xe0d2b4);
      bucket.col.push(c.r, c.g, c.b);
    }
  }
  for (const [name, bk] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
    const key = name.startsWith('ground:grass') ? 'ground:grass' : name.startsWith('ground:gravel') ? 'ground:gravel' : 'ground:concrete';
    geo(key).addColored(g);
  }
}
