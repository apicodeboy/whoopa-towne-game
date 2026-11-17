import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { LIGHTING } from './lighting';

/** A run of vertices: [first vertex, count]. */
export type VertexRange = [number, number];

/**
 * One draw call of a flattened model: every sub-mesh that can share a material is merged
 * into a single geometry, with the original material colors baked into vertex colors.
 */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Vertices that belonged to the model's recolorable "paint" material (e.g. a car body). */
  tint: VertexRange[];
}

/**
 * A static model, normalized so it is easy to place:
 *  - origin at the bottom-center of its bounding box
 *  - its longest horizontal axis along +Z (the "length" axis props use)
 *  - flattened to one mesh per texture (usually a single draw call)
 */
export interface ModelTemplate {
  root: THREE.Group;
  /** Bounding box size after normalization (x = width, y = height, z = length). */
  size: THREE.Vector3;
  parts: ModelPart[];
}

/**
 * One sub-mesh of a character as it came in the file (e.g. the hair, or the skin of the head),
 * kept as ranges into the merged geometry so the Character Creator can mix pieces.
 */
export interface CharacterPiece {
  /** Body part: 'Head' | 'Body' | 'Legs' | 'Feet'. */
  part: string;
  /** Source material name (e.g. 'Skin', 'Hair', 'Purple'). */
  material: string;
  /** Linear color of that material (the merged vertex colors are this times any per-vertex tint). */
  color: [number, number, number];
  start: number;
  count: number;
  indexStart: number;
  indexCount: number;
}

/** A rigged, animated character model. */
export interface CharacterTemplate {
  name: string;
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** Name of the material that gets recolored to the crew color (the top / hoodie). */
  tint: string;
  /**
   * Set when the character's sub-meshes could be merged into one skinned mesh (one draw call
   * and one skeleton instead of ~10 / 4): the vertices to repaint in the crew color.
   */
  merged: { tint: VertexRange[]; teamGeometry: Map<TeamId, THREE.BufferGeometry>; pieces: CharacterPiece[] } | null;
}

/** Name of the merged skinned mesh inside a character template. */
export const CHARACTER_MESH = 'CharacterMesh';

interface ModelSpec {
  url: string;
  /** Extra yaw applied after auto-alignment (radians), for models whose "front" is the other way. */
  yaw?: number;
  /** Keep the model's own axes (skip the "long axis to +Z" step). */
  keepAxes?: boolean;
  /** Name of the material that world props may recolor per copy. */
  tint?: string;
  /** Models with the same atlas tag share one texture image (and therefore one material). */
  atlas?: string;
}

const MODEL_SPECS: Record<string, ModelSpec> = {
  car: { url: 'vehicles/car.glb', tint: 'LightBlue' },
  taxi: { url: 'vehicles/taxi.glb' },
  van: { url: 'kenney/van.glb', atlas: 'kenney' },
  truck: { url: 'kenney/delivery.glb', atlas: 'kenney' },
  cone: { url: 'kenney/cone.glb', keepAxes: true, atlas: 'kenney' },
  dumpster: { url: 'props/dumpster.glb' },
  hydrant: { url: 'props/hydrant.glb', keepAxes: true },
  trashcan: { url: 'props/trashcan.glb', keepAxes: true },
  ar: { url: 'weapons/ar.glb' },
  smg: { url: 'weapons/smg.glb' },
  shotgun: { url: 'weapons/shotgun.glb' },
  pistol: { url: 'weapons/pistol.glb' },
  grenade: { url: 'weapons/grenade.glb', keepAxes: true },
};

const CHARACTER_SPECS: Array<{ name: string; url: string; tint: string }> = [
  { name: 'hoodie', url: 'characters/hoodie.glb', tint: 'Purple' },
  { name: 'punk', url: 'characters/punk.glb', tint: 'Pink' },
  { name: 'casual', url: 'characters/casual.glb', tint: 'LightBrown' },
];

/** These low-poly packs are flat colored: one matte vertex-colored material draws all of them. */
const FLAT_MATERIAL = new THREE.MeshStandardMaterial({ name: 'flat', vertexColors: true, roughness: 0.78, metalness: 0.12 });
const CHARACTER_MATERIAL = new THREE.MeshStandardMaterial({ name: 'character', vertexColors: true, roughness: 0.8, metalness: 0.05 });
// a touch of self-light (proportional to each part's own color) so players read in the dark
CHARACTER_MATERIAL.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${LIGHTING.characterGlow.toFixed(3)};`,
  );
};
/** One material per shared texture atlas (see ModelSpec.atlas). */
const atlasMaterials = new Map<string, THREE.Material>();

/** Strips the "CharacterArmature|" prefix exporters add to clip names. */
function clipKey(name: string): string {
  const i = name.lastIndexOf('|');
  return i >= 0 ? name.slice(i + 1) : name;
}

function prepareMeshes(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      // these low-poly packs are flat colored: keep them matte so they sit in the scene
      if (std.isMeshStandardMaterial) {
        std.metalness = Math.min(std.metalness, 0.25);
        std.roughness = Math.max(std.roughness, 0.7);
      }
    }
  });
}

/**
 * Loads the CC0 model set (characters, weapons, vehicles, props). Everything is optional:
 * a model that fails to load is simply absent and the game uses its procedural stand-in.
 */
export class Assets {
  readonly models = new Map<string, ModelTemplate>();
  readonly characters: CharacterTemplate[] = [];
  loaded = false;
  /** Names that failed to load (for diagnostics). */
  failed: string[] = [];
  private base: string;

  constructor(base = `${import.meta.env.BASE_URL}assets/`) {
    this.base = base;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const jobs: Array<Promise<void>> = [];
    const total = Object.keys(MODEL_SPECS).length + CHARACTER_SPECS.length;
    let done = 0;
    const tick = () => onProgress?.(++done, total);

    for (const [name, spec] of Object.entries(MODEL_SPECS)) {
      jobs.push(
        loader.loadAsync(this.base + spec.url).then(
          (gltf) => {
            this.models.set(name, normalizeModel(gltf.scene, spec));
            tick();
          },
          () => {
            this.failed.push(name);
            tick();
          },
        ),
      );
    }
    for (const spec of CHARACTER_SPECS) {
      jobs.push(
        loader.loadAsync(this.base + spec.url).then(
          (gltf) => {
            prepareMeshes(gltf.scene);
            const clips = new Map<string, THREE.AnimationClip>();
            for (const c of gltf.animations) clips.set(clipKey(c.name), c);
            const merged = mergeSkinnedMeshes(gltf.scene, spec.tint);
            this.characters.push({
              name: spec.name, scene: gltf.scene, clips, tint: spec.tint,
              merged: merged ? { tint: merged.tint, pieces: merged.pieces, teamGeometry: new Map() } : null,
            });
            tick();
          },
          () => {
            this.failed.push(spec.name);
            tick();
          },
        ),
      );
    }
    await Promise.all(jobs);
    // stable order regardless of which download finished first
    this.characters.sort((a, b) => CHARACTER_SPECS.findIndex((s) => s.name === a.name) - CHARACTER_SPECS.findIndex((s) => s.name === b.name));
    this.loaded = true;
  }

  model(name: string): ModelTemplate | null {
    return this.models.get(name) ?? null;
  }

  get hasCharacters(): boolean {
    return this.characters.length > 0;
  }
}

/** Centers a loaded scene on its footprint, drops it onto y=0 and aligns its long axis with +Z. */
export function normalizeModel(scene: THREE.Object3D, spec: ModelSpec): ModelTemplate {
  prepareMeshes(scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  scene.position.x -= center.x;
  scene.position.y -= box.min.y;
  scene.position.z -= center.z;
  pivot.add(scene);
  const root = new THREE.Group();
  root.add(pivot);
  let yaw = spec.yaw ?? 0;
  if (!spec.keepAxes && size.x > size.z) {
    yaw += Math.PI / 2;
    const t = size.x;
    size.x = size.z;
    size.z = t;
  }
  pivot.rotation.y = yaw;
  root.updateMatrixWorld(true);

  // flatten: bake every sub-mesh into the root's space, one mesh per shared material
  const parts = flattenModel(root, spec);
  const flat = new THREE.Group();
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    flat.add(mesh);
  }
  return { root: flat, size, parts };
}

/** Copies an attribute into a plain Float32 one (handles interleaved / quantized glTF data). */
function toFloat32(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number): THREE.BufferAttribute {
  const n = attr.count;
  const out = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
    if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

/** Material color (times the mesh's own vertex colors, if any) as a per-vertex color attribute. */
function bakedColors(src: THREE.BufferGeometry, material: THREE.Material): THREE.BufferAttribute {
  const n = src.attributes.position.count;
  const out = new Float32Array(n * 3);
  const c = (material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
  const own = (material as THREE.MeshStandardMaterial).vertexColors ? src.attributes.color : undefined;
  for (let i = 0; i < n; i++) {
    out[i * 3] = c.r * (own ? own.getX(i) : 1);
    out[i * 3 + 1] = c.g * (own ? own.getY(i) : 1);
    out[i * 3 + 2] = c.b * (own ? own.getZ(i) : 1);
  }
  return new THREE.BufferAttribute(out, 3);
}

/** A lean copy of a geometry: position, normal, baked color, optional uv, always indexed. */
function bakeGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material, keepUv: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = src.attributes.position.count;
  g.setAttribute('position', toFloat32(src.attributes.position, 3));
  if (src.attributes.normal) g.setAttribute('normal', toFloat32(src.attributes.normal, 3));
  if (keepUv) g.setAttribute('uv', src.attributes.uv ? toFloat32(src.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  let index: number[];
  if (src.index) {
    index = Array.from(src.index.array as ArrayLike<number>);
  } else {
    index = new Array<number>(n);
    for (let i = 0; i < n; i++) index[i] = i;
  }
  // a mirroring transform flips the winding: flip it back so faces keep pointing outward
  if (matrix.determinant() < 0) {
    for (let i = 0; i + 2 < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
  }
  g.setIndex(index);
  if (!src.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  g.setAttribute('color', bakedColors(src, material));
  return g;
}

/**
 * Merges all meshes under `root` into as few draw calls as possible: untextured materials
 * collapse into one vertex-colored mesh, textured ones into one mesh per texture.
 */
function flattenModel(root: THREE.Object3D, spec: ModelSpec): ModelPart[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m4 = new THREE.Matrix4();
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; tint: VertexRange[]; count: number }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    let key: string;
    let material: THREE.Material;
    if (src.map) {
      key = spec.atlas ? `atlas:${spec.atlas}` : `tex:${src.map.uuid}`;
      const make = (): THREE.Material => {
        const m = src.clone();
        m.vertexColors = true;
        m.color.setRGB(1, 1, 1); // the tint lives in the vertex colors now
        return m;
      };
      if (spec.atlas) {
        let shared = atlasMaterials.get(spec.atlas);
        if (!shared) atlasMaterials.set(spec.atlas, (shared = make()));
        material = shared;
      } else {
        material = groups.get(key)?.material ?? make();
      }
    } else if (src.transparent || src.opacity < 1) {
      key = `alpha:${src.uuid}`;
      material = src;
      src.vertexColors = false;
    } else {
      key = 'flat';
      material = FLAT_MATERIAL;
    }
    let grp = groups.get(key);
    if (!grp) groups.set(key, (grp = { material, geos: [], tint: [], count: 0 }));
    m4.multiplyMatrices(inv, mesh.matrixWorld);
    const g = bakeGeometry(mesh.geometry, m4, src, !!src.map);
    if (key.startsWith('alpha:')) g.deleteAttribute('color');
    if (spec.tint && src.name === spec.tint) grp.tint.push([grp.count, g.attributes.position.count]);
    grp.count += g.attributes.position.count;
    grp.geos.push(g);
  });
  const parts: ModelPart[] = [];
  for (const grp of groups.values()) {
    const geometry = grp.geos.length === 1 ? grp.geos[0] : mergeGeometries(grp.geos, false);
    if (!geometry) continue;
    if (grp.geos.length > 1) for (const g of grp.geos) g.dispose();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    parts.push({ geometry, material: grp.material, tint: grp.tint });
  }
  return parts;
}

/**
 * Characters arrive as ~10 skinned sub-meshes (one per material) on 4 identical skeletons.
 * This merges them into a single skinned mesh with baked vertex colors: one draw call and one
 * skeleton update per character. Returns the vertex ranges of the crew-tinted material, or
 * null when the model cannot be merged safely (it is then drawn as loaded).
 */
function mergeSkinnedMeshes(scene: THREE.Object3D, tintName: string): { tint: VertexRange[]; pieces: CharacterPiece[] } | null {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  if (meshes.length === 0) return null;
  const base = meshes[0];
  const bones = base.skeleton.bones;
  const inv0 = base.skeleton.boneInverses;
  const D = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  const tint: VertexRange[] = [];
  const pieces: CharacterPiece[] = [];
  let count = 0;
  let indexCount = 0;
  for (const m of meshes) {
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const sk = m.skeleton;
    if (mat.map || mat.transparent || sk.bones.length !== bones.length || !m.bindMatrix.equals(base.bindMatrix)) return null;
    for (let i = 0; i < bones.length; i++) if (sk.bones[i] !== bones[i]) return null;
    // D carries this mesh's bind space into the base mesh's: inv0[j] * D must equal its own inverse for every joint
    D.copy(inv0[0]).invert().multiply(sk.boneInverses[0]);
    for (let j = 0; j < bones.length; j++) {
      T.multiplyMatrices(inv0[j], D);
      const a = T.elements, b = sk.boneInverses[j].elements;
      for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-3 + 1e-4 * Math.abs(b[k])) return null;
    }
    const src = m.geometry;
    if (!src.attributes.skinIndex || !src.attributes.skinWeight) return null;
    const g = bakeGeometry(src, D, mat, false);
    const n = src.attributes.position.count;
    const si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = si.getX(i); idx[i * 4 + 1] = si.getY(i); idx[i * 4 + 2] = si.getZ(i); idx[i * 4 + 3] = si.getW(i);
      wgt[i * 4] = sw.getX(i); wgt[i * 4 + 1] = sw.getY(i); wgt[i * 4 + 2] = sw.getZ(i); wgt[i * 4 + 3] = sw.getW(i);
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
    if (mat.name === tintName) tint.push([count, n]);
    const part = /(Head|Body|Legs|Feet)/.exec(`${m.name} ${m.parent?.name ?? ''}`)?.[1] ?? 'Other';
    const ni = g.index!.count;
    pieces.push({ part, material: mat.name, color: [mat.color.r, mat.color.g, mat.color.b], start: count, count: n, indexStart: indexCount, indexCount: ni });
    count += n;
    indexCount += ni;
    geos.push(g);
  }
  const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!geometry) return null;
  if (geos.length > 1) for (const g of geos) g.dispose();

  const merged = new THREE.SkinnedMesh(geometry, CHARACTER_MATERIAL);
  merged.name = CHARACTER_MESH;
  merged.castShadow = true;
  merged.receiveShadow = true;
  base.parent!.add(merged);
  merged.bind(new THREE.Skeleton(bones, inv0.map((m) => m.clone())), base.bindMatrix);
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  return { tint, pieces };
}

/** The merged character geometry with the tinted vertices painted in a crew's color (cached per crew). */
export function characterGeometry(template: CharacterTemplate, team: TeamId): THREE.BufferGeometry | null {
  const merged = template.merged;
  if (!merged) return null;
  let g = merged.teamGeometry.get(team);
  if (g) return g;
  const src = (template.scene.getObjectByName(CHARACTER_MESH) as THREE.SkinnedMesh | undefined)?.geometry;
  if (!src) return null;
  // share every buffer with the template except the colors
  g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const [name, attr] of Object.entries(src.attributes)) if (name !== 'color') g.setAttribute(name, attr);
  const color = (src.attributes.color as THREE.BufferAttribute).clone();
  const c = new THREE.Color(crewColorHex(team));
  for (const [start, n] of merged.tint) for (let i = start; i < start + n; i++) color.setXYZ(i, c.r, c.g, c.b);
  g.setAttribute('color', color);
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  g.boundingBox = src.boundingBox?.clone() ?? null;
  merged.teamGeometry.set(team, g);
  return g;
}

const _color = new THREE.Color();

/**
 * Bakes many placed copies of static models (parked cars, dumpsters, hydrants...) into a few
 * merged meshes: one per material per map cell. Compared with drawing every copy (or every
 * sub-mesh of an instanced copy) this is a handful of draw calls for the whole map, and the
 * cells outside the view or the shadow range are culled as a unit.
 */
export class StaticModelBatch {
  private chunks = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  private cell: number;

  constructor(cellSize = 40) {
    this.cell = cellSize;
  }

  /** Adds one copy of `template` at `matrix`; `color` repaints the model's tint material. */
  add(template: ModelTemplate, matrix: THREE.Matrix4, color?: number): void {
    const cx = Math.floor(matrix.elements[12] / this.cell), cz = Math.floor(matrix.elements[14] / this.cell);
    for (const part of template.parts) {
      const g = part.geometry.clone();
      g.applyMatrix4(matrix);
      if (color !== undefined && part.tint.length > 0) {
        const col = g.attributes.color as THREE.BufferAttribute;
        _color.setHex(color);
        for (const [start, n] of part.tint) for (let i = start; i < start + n; i++) col.setXYZ(i, _color.r, _color.g, _color.b);
      }
      const key = `${part.material.uuid}|${cx},${cz}`;
      let chunk = this.chunks.get(key);
      if (!chunk) this.chunks.set(key, (chunk = { material: part.material, geos: [] }));
      chunk.geos.push(g);
    }
  }

  /** Merged meshes, ready to add to the scene. The caller owns (and disposes) their geometries. */
  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const chunk of this.chunks.values()) {
      const geometry = chunk.geos.length === 1 ? chunk.geos[0] : mergeGeometries(chunk.geos, false);
      if (!geometry) continue;
      if (chunk.geos.length > 1) for (const g of chunk.geos) g.dispose();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, chunk.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    this.chunks.clear();
    return out;
  }
}
