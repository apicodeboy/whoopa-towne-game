/**
 * The one-piece character models (docs/CHARACTERS.md): downloaded from this game's own assets the
 * first time somebody wears one, prepared once, then shared by everyone wearing it.
 */
import * as THREE from 'three';
import { forCustomCharacter, type Appearance } from '@shared/config/appearance';
import { geometryKey, type LookBuilder } from '../look/assemble';
import { DEFAULT_GIRTH, bootTops, carryOutfit, carryTransforms, type BootTops, type Carry, type CarriedOutfit } from './outfit';
import { crewColorHex, type TeamId } from '@shared/config/crews';
import { CHARACTER_MESH, type Assets, type CharacterTemplate } from '../../assets';
import { lightUniforms } from '../../lighting';
import { SLOT } from '../look/meshKit';
import { PAINT_STRIDE } from '../look/palette';
import { FLIGHT_CLIPS, adoptClips, borrowClips, centerFeet, contactCurve, layOnGround, meanOrientation, strideOf } from './clips';
import { Region, findRegions, measureReference, recolorKey, recolorMaterial, tintGeometry, vertexKinds, type Reference, type Regions } from './recolor';
import { ClipSampler, SoleProbe, renameBones, skinnedMeshOf } from './rig';

/** How a model carries things: its arms are shorter and its head is bigger than the custom character's. */
export interface HoldFit {
  /** The grip from the right shoulder (right / up): from the hip and aimed. */
  hipX: number;
  hipY: number;
  aimX: number;
  aimY: number;
  /** The most and least the grip of a long gun sits in front of the shoulder. */
  near: number;
  far: number;
  /** How far the torso turns side-on behind a long gun, so the short left arm reaches it (radians). */
  blade: number;
}

export interface ModelSpec {
  id: string;
  url: string;
  /** Bind-pose heights in the file's meters. */
  frame: { eyeY: number; topY: number; chestY: number };
  hold: HoldFit;
  /** How far the hips drop crouched (meters in game), so the head lands on the crouched head hitbox. */
  crouchDrop: number;
  /** The face is a mask (left as delivered); otherwise it has braids that take a hair color. */
  masked: boolean;
}

// (fitted over every long gun: the left palm ends within 3 cm of its handguard)
const HOLD: HoldFit = { hipX: -0.02, hipY: -0.16, aimX: -0.03, aimY: -0.02, near: 0.16, far: 0.22, blade: 0.75 };

export const MODEL_SPECS: readonly ModelSpec[] = [
  {
    id: 'whoopa_tall_unmasked', url: 'characters/whoopa/whoopa_tall_unmasked.glb',
    frame: { eyeY: 1.53, topY: 1.75, chestY: 1.12 }, hold: HOLD, crouchDrop: 0.32, masked: false,
  },
  {
    id: 'whoopa_tall_hooded', url: 'characters/whoopa/whoopa_tall_hooded.glb',
    frame: { eyeY: 1.51, topY: 1.75, chestY: 1.12 }, hold: HOLD, crouchDrop: 0.32, masked: true,
  },
];

/** A look on a model: its own pieces in the look's colors, and the clothes carried onto it (if any). */
export interface Dressed {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Tops / bottoms from the clothing system (painted per character), or null when it wears its own. */
  outfit: CarriedOutfit | null;
  /** The look the outfit was built from (its colors and prints paint it). */
  outfitLook: Appearance | null;
  /** Wears its own jacket (the crew band goes on that sleeve). */
  ownTop: boolean;
}

/** Recolored versions kept per model (a full lobby's worth of different picks). */
const DRESS_CACHE = 48;

/** Seconds a model nobody is wearing keeps its GPU copy (previews rebuild on every click). */
const GPU_LINGER = 3;
/** Texture size on phones and tablets (the files' are 2048). */
const SMALL_TEXTURE = 1024;

/** A prepared model: what every character wearing it shares. */
export class ImportedBody {
  /** The running clips' ground contact (see contactCurve). */
  readonly contact = new Map<string, Float32Array>();
  /** Lift that puts the standing pose's soles on the ground (file meters). */
  restLift = 0;
  /** Width, height and depth standing in the idle pose (file meters). */
  readonly standing = new THREE.Box3();
  /** Ground covered by one cycle of Walk and of Run (file meters; 0 = not measurable). */
  strideWalk = 0;
  strideRun = 0;
  /** The torso's orientation behind a raised gun, standing and moving (model space). */
  readonly aimTorso = new THREE.Quaternion();
  readonly aimTorsoMoving = new THREE.Quaternion();
  /** The crew arm band: the sleeve's own triangles, drawn again in the crew's color. */
  readonly bandGeometry: THREE.BufferGeometry;
  private bandRange: THREE.Vector2;
  private bandMaterials = new Map<TeamId, THREE.MeshStandardMaterial>();
  /** Garments of the mesh and the delivered brightness of its texels (for recoloring). */
  readonly regions: Regions;
  readonly reference: Reference;
  private dressed = new Map<string, Dressed>();
  /** The pieces of the model each combination of own / carried garments shows (triangle lists). */
  private cuts = new Map<string, THREE.BufferAttribute>();
  /** Per vertex: the head as it shows above a carried top (no collar), and the hands past the cuffs. */
  private bareHead: Uint8Array;
  private hands: Uint8Array;
  private carries = new Map<string, Carry>();
  private boots: BootTops;
  private users = 0;
  private linger: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly spec: ModelSpec,
    readonly template: CharacterTemplate,
    readonly soles: SoleProbe,
    private mesh: THREE.SkinnedMesh,
    private textures: ReadonlySet<THREE.Texture>,
  ) {
    const band = sleeveBand(mesh);
    this.bandGeometry = band.geometry;
    this.bandRange = band.range;
    this.regions = findRegions(mesh, spec.masked);
    const map = (mesh.material as THREE.MeshStandardMaterial).map;
    this.reference = map ? measureReference(map) : { cloth: 0.35, skin: 0.025, hair: 0.012, skinColor: [0.06, 0.02, 0.012] };
    ({ head: this.bareHead, hands: this.hands } = barePieces(mesh));
    this.boots = bootTops(mesh, (i) => this.regions.garment[i] === Region.Shoe, this.regions.cuffY);
  }

  /** Does a look wear the model's own top / bottom? (The hooded model's hood is its hoodie's: always its own top.) */
  ownTop(look: Readonly<Appearance>): boolean {
    return this.spec.masked || look.top === 'wtjacket';
  }

  ownBottom(look: Readonly<Appearance>): boolean {
    return look.bottom === 'wtcargos';
  }

  /** The triangles of the model's own pieces a combination shows. */
  private cut(ownTop: boolean, ownBottom: boolean): THREE.BufferAttribute {
    const key = `${ownTop}|${ownBottom}`;
    let c = this.cuts.get(key);
    if (c) return c;
    const g = this.regions.garment, index = this.mesh.geometry.index!;
    const keep = (i: number) => g[i] === Region.Shoe
      || (ownTop ? g[i] === Region.Top || g[i] === Region.None : this.bareHead[i] === 1 || this.hands[i] === 1)
      || (ownBottom && g[i] === Region.Bottom);
    const out: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t), b = index.getX(t + 1), d = index.getX(t + 2);
      if (keep(a) && keep(b) && keep(d)) out.push(a, b, d);
    }
    c = new THREE.Uint32BufferAttribute(out, 1);
    this.cuts.set(key, c);
    return c;
  }

  /** The clothing system's look for the carried garments: just the clothes (and the skin under them). */
  private clothesOf(look: Readonly<Appearance>, ownTop: boolean, ownBottom: boolean): Appearance {
    const l = forCustomCharacter({ ...look, model: 'custom' });
    Object.assign(l, {
      bodyType: 'masc', build: 'average', shoulders: 'average', headSize: 'average', height: 'average',
      hat: 'none', mask: 'none', glasses: 'none', earrings: 'none', necklace: 'none', wrist: 'none', faceAcc: 'none', mouthAcc: 'none', mouthProp: 'none',
      belt: 'none', legPrint: 'none', waistChain: 'none', backpack: 'none', carry: 'none', details: [], tattoos: {},
    });
    // (the half the model wears its own of is dropped: share one build for it)
    if (ownTop) Object.assign(l, { top: 'tee', topColor: 'black' });
    if (ownBottom) Object.assign(l, { bottom: 'jeans', bottomColor: 'black' });
    return l;
  }

  private carryFor(builder: LookBuilder, look: Appearance): { carry: Carry; built: NonNullable<ReturnType<LookBuilder['build']>> } | null {
    const built = builder.build(look);
    if (!built) return null;
    let carry = this.carries.get(built.rig.id);
    if (!carry) {
      this.mesh.parent?.updateMatrixWorld(true);
      carry = carryTransforms(built.rig.joints, built.rig.at, this.mesh.skeleton.bones, DEFAULT_GIRTH, this.regions.cuffY);
      this.carries.set(built.rig.id, carry);
    }
    return { carry, built };
  }

  /** The model in a look's clothes and colors: shared by everyone wearing the same. */
  dress(look: Readonly<Appearance>, builder: LookBuilder | null): Dressed {
    let ownTop = this.ownTop(look), ownBottom = this.ownBottom(look);
    // (no clothing system to carry from: its own garments)
    if (!builder?.ready) ownTop = ownBottom = true;
    const clothes = ownTop && ownBottom ? null : this.clothesOf(look, ownTop, ownBottom);
    const key = `${recolorKey(look)}|${ownTop}|${ownBottom}|${clothes ? geometryKey(clothes) : ''}`;
    let d = this.dressed.get(key);
    if (d) {
      // (most recently used last: the oldest go first)
      this.dressed.delete(key);
      this.dressed.set(key, d);
      return d;
    }
    let outfit: CarriedOutfit | null = null;
    if (clothes && builder) {
      const c = this.carryFor(builder, clothes);
      const ink = c?.built.rig.at;
      outfit = c && ink ? carryOutfit(c.built, c.carry, {
        top: !ownTop, bottom: !ownBottom,
        waistY: (ink.get('Hips')?.y ?? 0.9) + 0.02, neckTopY: (ink.get('Head')?.y ?? 1.59) + 0.01,
        flare: { from: 0.34, to: this.regions.cuffY, boots: this.boots },
      }) : null;
      // (the carried layers: a top just outside what it covers, so the pants' waist never shows through)
      if (outfit) liftLayer(outfit, 0.012);
    }
    if (clothes && !outfit) ownTop = ownBottom = true;
    const geometry = tintGeometry(this.mesh.geometry, this.regions, look);
    geometry.setIndex(this.cut(ownTop, ownBottom));
    d = {
      geometry,
      material: recolorMaterial(this.mesh.material as THREE.MeshStandardMaterial, this.reference, look, lightUniforms.charGlow),
      outfit, outfitLook: outfit ? clothes : null, ownTop,
    };
    this.dressed.set(key, d);
    while (this.dressed.size > DRESS_CACHE) {
      const [oldest, gone] = this.dressed.entries().next().value!;
      this.dressed.delete(oldest);
      // (a character still wearing it keeps it: freed here, it is simply uploaded again if drawn)
      gone.geometry.dispose();
      gone.material.dispose();
      gone.outfit?.geometry.dispose();
    }
    return d;
  }

  bandMaterial(team: TeamId): THREE.MeshStandardMaterial {
    let m = this.bandMaterials.get(team);
    if (m) return m;
    const color = crewColorHex(team);
    m = new THREE.MeshStandardMaterial({ name: 'crew-band', color, emissive: color, emissiveIntensity: 0.2, roughness: 0.6, side: THREE.DoubleSide });
    const range = { value: this.bandRange };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBand = range;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vBand;')
        .replace('#include <skinning_vertex>', 'vBand = abs( position.x );\n\ttransformed += normalize( normal ) * 0.006;\n\t#include <skinning_vertex>');
      // (cut across the triangles for a straight edge)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBand;\nuniform vec2 uBand;')
        .replace('#include <clipping_planes_fragment>', 'if ( vBand < uBand.x || vBand > uBand.y ) discard;\n\t#include <clipping_planes_fragment>');
    };
    m.customProgramCacheKey = () => 'crew-band';
    this.bandMaterials.set(team, m);
    return m;
  }

  acquire(): void {
    this.users++;
    if (this.linger) clearTimeout(this.linger);
    this.linger = null;
  }

  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users || this.linger) return;
    this.linger = setTimeout(() => {
      this.linger = null;
      if (this.users) return;
      this.freeGpu();
      for (const m of this.bandMaterials.values()) m.dispose();
      for (const d of this.dressed.values()) d.material.dispose();
    }, GPU_LINGER * 1000);
  }

  /**
   * Frees the GPU copies in every WebGL context (each menu preview has its own). The decoded
   * model stays cached, so whatever still draws it just uploads it again.
   */
  freeGpu(): void {
    // (the band shares the body's buffers: always both)
    this.bandGeometry.dispose();
    for (const d of this.dressed.values()) {
      d.geometry.dispose();
      d.outfit?.geometry.dispose();
    }
    this.mesh.geometry.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** Pushes a carried outfit's top a few millimeters out along its normals (over the pants' waist). */
function liftLayer(outfit: CarriedOutfit, by: number): void {
  const pos = outfit.geometry.attributes.position, nrm = outfit.geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    if (outfit.paint[i * PAINT_STRIDE] !== SLOT.TOP) continue;
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * by, pos.getY(i) + nrm.getY(i) * by, pos.getZ(i) + nrm.getZ(i) * by);
  }
}

/**
 * The model's own head and hands, as they show with a carried top: the head without the jacket's
 * collar (its cloth-colored vertices; the eyes, painted white, stay), and the hands past the cuffs.
 */
function barePieces(mesh: THREE.SkinnedMesh): { head: Uint8Array; hands: Uint8Array } {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;
  const kinds = vertexKinds(mesh);
  const isHead = bones.map((b) => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent) if (/^(Neck|Head)/.test(o.name)) return true;
    return false;
  });
  const isHand = bones.map((b) => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent) if (/^(Wrist|Index|Middle|Ring|Pinky|Thumb)/.test(o.name)) return true;
    return false;
  });
  const head = bones.find((b) => b.name === 'Head')!.getWorldPosition(new THREE.Vector3());
  const wristX = Math.abs(bones.find((b) => b.name === 'WristL')!.getWorldPosition(new THREE.Vector3()).x);
  const n = position.count, headOut = new Uint8Array(n), handOut = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let h = 0, k = 0;
    for (let j = 0; j < 4; j++) {
      const b = skinIndex.getComponent(i, j), w = skinWeight.getComponent(i, j);
      if (isHead[b]) h += w;
      if (isHand[b]) k += w;
    }
    const x = position.getX(i), up = position.getY(i) - head.y, front = position.getZ(i) - head.z;
    const eyes = front > 0.06 && up > 0.02 && up < 0.24 && Math.abs(x) < 0.17;
    if (h > 0.5 && up > -0.02 && (eyes || kinds[i] !== 0)) headOut[i] = 1;
    // (the jacket's cuffs reach past the wrists: only what is painted skin)
    if (k > 0.5 && Math.abs(x) > wristX - 0.03 && kinds[i] !== 0) handOut[i] = 1;
  }
  return { head: headOut, hands: handOut };
}

/** The triangles of both upper sleeves that the band crosses. */
function sleeveBand(mesh: THREE.SkinnedMesh): { geometry: THREE.BufferGeometry; range: THREE.Vector2 } {
  const src = mesh.geometry, { position } = src.attributes;
  const bones = mesh.skeleton.bones;
  const at = (name: string) => bones.find((b) => b.name === name)!.getWorldPosition(new THREE.Vector3());
  const shoulder = at('UpperArmL'), elbow = at('LowerArmL');
  // low on the upper arm, clear of the epaulette and of the jacket's sides
  const middle = Math.abs(shoulder.x) + (Math.abs(elbow.x) - Math.abs(shoulder.x)) * 0.8;
  const range = new THREE.Vector2(middle - 0.018, middle + 0.018);
  // (the bind pose is a T: that far out and that high up there is only sleeve)
  const arm = (i: number): boolean => position.getY(i) > shoulder.y - 0.25;
  const index = src.index;
  if (!index) throw new Error('the mesh has no index');
  const picked: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const xa = Math.abs(position.getX(a)), xb = Math.abs(position.getX(b)), xc = Math.abs(position.getX(c));
    if (Math.max(xa, xb, xc) < range.x || Math.min(xa, xb, xc) > range.y) continue;
    if (arm(a) && arm(b) && arm(c)) picked.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) geometry.setAttribute(name, src.attributes[name]);
  geometry.setIndex(picked);
  return { geometry, range };
}

function texturesOf(material: THREE.MeshStandardMaterial): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>();
  for (const t of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) if (t) out.add(t);
  return out;
}

/** Scales the embedded textures down in memory (phones); the files are untouched. */
async function shrinkTextures(textures: ReadonlySet<THREE.Texture>): Promise<void> {
  if (typeof createImageBitmap !== 'function') return;
  for (const t of textures) {
    const img = t.image as (CanvasImageSource & { width: number; height: number; close?: () => void }) | null;
    if (!img || img.width <= SMALL_TEXTURE) continue;
    try {
      const small = await createImageBitmap(img as ImageBitmapSource, {
        resizeWidth: SMALL_TEXTURE, resizeHeight: Math.round((img.height * SMALL_TEXTURE) / img.width), resizeQuality: 'high',
        premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
      t.image = small;
      t.needsUpdate = true;
      img.close?.();
    } catch {
      /* no resize options in this browser: keep the full size */
    }
  }
}

export class ImportedModels {
  private bodies = new Map<string, ImportedBody>();
  private pending = new Map<string, Promise<ImportedBody | null>>();

  /**
   * @param ready resolves once the game's own models (the source of the borrowed clips) are in
   * @param small load with smaller textures (phones)
   */
  constructor(private assets: Assets, private ready: () => Promise<unknown>, private small: () => boolean) {}

  has(id: string): boolean {
    return MODEL_SPECS.some((s) => s.id === id);
  }

  /** The model, if it is already here. */
  get(id: string): ImportedBody | null {
    return this.bodies.get(id) ?? null;
  }

  /** Downloads and prepares a model once; null when that failed (asking again retries). */
  load(id: string): Promise<ImportedBody | null> {
    const have = this.bodies.get(id);
    if (have) return Promise.resolve(have);
    let job = this.pending.get(id);
    if (job) return job;
    const spec = MODEL_SPECS.find((s) => s.id === id);
    if (!spec) return Promise.resolve(null);
    job = this.prepare(spec)
      .then((body) => {
        this.bodies.set(id, body);
        return body;
      })
      .catch((err: unknown) => {
        console.error(`character model ${id} could not be loaded`, err);
        return null;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  /** Between screens and matches: drop every context's GPU copy. */
  freeGpu(): void {
    for (const b of this.bodies.values()) b.freeGpu();
  }

  private async prepare(spec: ModelSpec): Promise<ImportedBody> {
    const [gltf] = await Promise.all([this.assets.loadExtra(spec.url), this.ready()]);
    const source = this.assets.characters.find((c) => c.name === 'ink');
    if (!source) throw new Error('the animation source is not loaded');
    const scene = gltf.scene;
    const names = renameBones(scene);
    scene.updateMatrixWorld(true);
    const mesh = skinnedMeshOf(scene);
    mesh.name = CHARACTER_MESH;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // the file's own material and maps (each look draws with a copy that recolors: see recolor.ts)
    const material = mesh.material as THREE.MeshStandardMaterial;
    const textures = texturesOf(material);
    if (this.small()) await shrinkTextures(textures);

    const soles = new SoleProbe(mesh);
    const clips = adoptClips(gltf.animations, names, scene);
    for (const [name, clip] of borrowClips(scene, clips.get('Run')!, source)) clips.set(name, clip);
    for (const name of ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right']) {
      const clip = clips.get(name);
      if (clip) centerFeet(scene, clip, soles);
    }
    const death = clips.get('Death');
    if (death) layOnGround(scene, death);

    const template: CharacterTemplate = { name: spec.id, scene, clips, tint: '', merged: null };
    const body = new ImportedBody(spec, template, soles, mesh, textures);
    for (const name of FLIGHT_CLIPS) {
      const clip = clips.get(name);
      if (clip) body.contact.set(name, contactCurve(scene, clip, soles));
    }
    const stand = new ClipSampler(scene, clips.get('Idle')!);
    stand.at(0);
    body.restLift = -soles.lowest(stand.mesh.skeleton.bones);
    stand.mesh.skeleton.update();
    const v = new THREE.Vector3(), position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 3) body.standing.expandByPoint(stand.mesh.getVertexPosition(i, v));
    stand.dispose();
    body.strideWalk = strideOf(scene, clips.get('Walk')!, soles);
    body.strideRun = strideOf(scene, clips.get('Run')!, soles);
    body.standing.translate(v.set(0, body.restLift, 0));

    const aim = clips.get('Idle_Gun_Pointing') ?? clips.get('Idle')!;
    body.aimTorso.copy(meanOrientation(scene, aim, 'Abdomen'));
    body.aimTorsoMoving.copy(meanOrientation(scene, clips.get('Run_Shoot') ?? aim, 'Abdomen'));
    return body;
  }
}
