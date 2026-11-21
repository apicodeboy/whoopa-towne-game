import * as THREE from 'three';
import { BOTTOM_COLORS, DEFAULT_APPEARANCE, LOOK_FIELD_KEYS, SHOE_COLORS, TOP_COLORS, type Appearance, type LookOption } from '@shared/config/appearance';
import type { CharacterTemplate } from '../../assets';
import { LIGHTING } from '../../lighting';
import { buildDetails, buildEarrings, buildFaceMarks, buildFacePiercing, buildFacialHair, buildGlasses, buildLipPiercing, buildMouth } from './face';
import { buildHair, transferHair, tuckHair } from './hair';
import { HeadRig, shapeHead, type HeadSurface } from './headRig';
import { buildHat } from './headwear';
import { buildBackpack, buildCrewBands, buildNecklace, buildWaistChain, buildWrist, type BodyQuery } from './jewelry';
import { PartLibrary, centroid, components, type Piece, type Rig } from './library';
import { buildLegPrint, printAtlas } from './legPrint';
import { ProcMesh, SLOT, smoothstep, style, v3, type V3 } from './meshKit';
import { EXPRESSION_PRESETS, PAINT_STRIDE, pack, type Expression } from './palette';

/**
 * Builds a character's body from an Appearance: picks and fits the model pieces, shapes the
 * body and face, adds the procedural hair / hats / jewelry, and merges everything into one
 * skinned geometry (one draw call per character, same as before the creator).
 */

/** One assembled character body (geometry is shared; colors are painted per character). */
export interface Assembled {
  key: string;
  rig: Rig;
  /** Position, normal, skinIndex, skinWeight, pbr, index (no color: see paint). */
  geometry: THREE.BufferGeometry;
  /** Per vertex: slot, slot B, mix, shade, packed fixed color (see palette.ts). */
  paint: Float32Array;
  /** Bind-pose positions in meters (AJ's prints are drawn from these). */
  rigPos: Float32Array;
  /** Lips position in the bind pose (meters), for things held in the mouth. */
  mouth: V3;
  /** Heights (bind pose, meters) the Character screen frames its camera on. */
  frame: { eyeY: number; topY: number; chestY: number };
  /** Uniform scale for the height preset. */
  heightScale: number;
}

// ------------------------------------------------------------------ material
/**
 * Flat cel shading, like a clean vector drawing: every surface is its own flat color in two
 * tones (lit side, shadow side) with a crisp edge between them; folds, seams and deep creases
 * are baked per vertex (`ao`) and drawn as hard shadow shapes and ink lines, never as soft
 * gradients; glossy things (nylon, leather, metal) get hard-edged highlights; and edges facing
 * away from the camera catch a cool light, which is what gives black clothes their shape.
 * Lights still count (sun, street lamps, rooms), but mostly as brightness: their color only
 * tints, so black stays black and white stays white.
 */
const TOON_DIRECT = (() => {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const fn = chunk.indexOf('void RE_Direct_Physical');
  const line = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  const at = chunk.indexOf(line, fn);
  if (fn < 0 || at < 0) return null;
  const ramp = `float dotNLraw = dot( geometryNormal, directLight.direction );
	// two tones with a crisp edge (a couple of degrees soft, so it never aliases)
	float dotNL = smoothstep( -0.04, 0.05, dotNLraw - inkShadow );
	inkDirect += directLight.color * dotNL;
	dotNL = 0.5 * dotNL;`;
  return chunk.slice(0, fn) + 'vec3 inkDirect = vec3( 0.0 );\nfloat inkShadow = 0.0;\n' + chunk.slice(fn, at) + ramp + chunk.slice(at + line.length);
})();

/** Vertex-colored, with per-vertex metalness / roughness (jewelry shines, cloth stays matte) and baked creases. */
export const LOOK_MATERIAL = new THREE.MeshStandardMaterial({ name: 'look', vertexColors: true, roughness: 1, metalness: 0 });
LOOK_MATERIAL.customProgramCacheKey = () => 'flat-cel-4';
LOOK_MATERIAL.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nattribute float ao;\nattribute vec2 printUv;\nvarying vec2 vPbr;\nvarying float vAo;\nvarying vec2 vPrintUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPbr = pbr;\n\tvAo = ao;\n\tvPrintUv = printUv;');
  // prints (the graphic on a pant leg) are laid over the cloth's own color from one shared atlas
  shader.uniforms.printMap = { value: printAtlas() };
  let f = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;\nvarying float vAo;\nvarying vec2 vPrintUv;\nuniform sampler2D printMap;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
	if ( vPrintUv.x >= 0.0 ) {
		vec4 pr = texture2D( printMap, vPrintUv );
		diffuseColor.rgb = diffuseColor.rgb * ( 1.0 - pr.a ) + pr.rgb;
	}`,
    )
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.y;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.x;');
  if (TOON_DIRECT) {
    f = f
      .replace('#include <lights_physical_pars_fragment>', TOON_DIRECT)
      // creased cloth is in shadow whichever way it faces
      .replace('#include <lights_fragment_begin>', 'inkShadow = 1.0 - smoothstep( 0.74, 0.8, vAo );\n#include <lights_fragment_begin>')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
	{
		vec3 lum = vec3( 0.299, 0.587, 0.114 );
		// direct light: mostly its brightness, a little of its color
		vec3 key = mix( vec3( dot( inkDirect, lum ) ), inkDirect, 0.3 );
		// ambient light: flat (the same from every side), so the shadow side is one even tone
		vec3 amb = vec3( 0.0 );
		#if defined( RE_IndirectDiffuse )
			amb = mix( vec3( dot( irradiance, lum ) ), irradiance, 0.25 );
		#endif
		vec3 base = diffuseColor.rgb;
		// the darkest darks are lifted a touch, so black cloth is charcoal (never the ink line's black)
		vec3 lit = base + vec3( 0.022, 0.023, 0.027 );
		reflectedLight.directDiffuse = lit * key * 0.2;
		reflectedLight.indirectDiffuse = lit * amb * 0.34;
		// seams and deep creases: an ink line
		float line = smoothstep( 0.58, 0.66, vAo );
		reflectedLight.directDiffuse *= mix( 0.25, 1.0, line );
		reflectedLight.indirectDiffuse *= mix( 0.3, 1.0, line );
		// highlights: hard-edged shapes instead of soft glows
		float sp = dot( reflectedLight.directSpecular, lum );
		reflectedLight.directSpecular *= smoothstep( 0.1, 0.16, sp ) * min( 1.0, 0.5 / max( sp, 1e-4 ) ) * smoothstep( 0.3, 0.46, 1.0 - vPbr.y );
		// a cool light along edges turned away from the camera, strongest on top
		float nv = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
		float rim = smoothstep( 0.62, 0.7, nv ) * ( 0.35 + 0.65 * saturate( normal.y * 0.6 + 0.5 ) ) * line;
		float bright = dot( key, lum ) * 0.2 + dot( amb, lum ) * 0.5;
		reflectedLight.directDiffuse += vec3( 0.62, 0.7, 0.85 ) * rim * bright * ( 0.26 + 0.5 * ( 1.0 - vPbr.y ) );
	}`,
      );
  }
  shader.fragmentShader = f.replace(
    '#include <emissivemap_fragment>',
    // a touch of self-light keeps players readable in the dark; metals get a little extra
    // so they read as shiny without an environment map
    `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * (${LIGHTING.characterGlow.toFixed(3)} + vPbr.x * 0.22);`,
  );
};

// ------------------------------------------------------------------ working pieces
interface Work {
  tag: string;
  pos: Float32Array;
  nrm: Float32Array;
  si: Uint16Array;
  sw: Float32Array;
  index: Uint32Array;
  paint: Float32Array;
  pbr: Float32Array;
  /** Baked creases and occlusion per vertex (1 = open cloth; low = a fold, a seam): drawn as shadow shapes and ink lines. */
  ao: Float32Array;
  /** Where each vertex is in the print atlas (only a printed patch has it). */
  uv?: Float32Array;
}

interface PaintSpec {
  slot: number;
  slotB?: number;
  mix?: number;
  shade?: number;
  /** Linear RGB for FIXED. */
  color?: [number, number, number];
}

const _col = new THREE.Color();
const lin = (hex: number): [number, number, number] => (_col.setHex(hex), [_col.r, _col.g, _col.b]);

/** Copies a model piece (optionally only some of its triangles) onto a rig, painted per vertex. */
function fromPiece(p: Piece, rig: Rig, tag: string, spec: PaintSpec | ((i: number) => PaintSpec), tris?: Uint32Array): Work {
  const src = tris ?? p.index;
  const map = new Map<number, number>();
  const order: number[] = [];
  for (const i of src) if (!map.has(i)) map.set(i, order.push(i) - 1);
  const n = order.length;
  const w: Work = {
    tag,
    pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), si: new Uint16Array(n * 4), sw: new Float32Array(n * 4),
    index: Uint32Array.from(src, (i) => map.get(i)!), paint: new Float32Array(n * PAINT_STRIDE), pbr: new Float32Array(n * 2), ao: new Float32Array(n).fill(1),
  };
  // the generated pieces bake their folds and seams as shading: kept apart from the color, so
  // it can be drawn as flat shadow shapes (the older models' shading is a tint of the color itself)
  const baked = p.rig.id === 'ink';
  // the piece was modelled on its own skeleton: move each vertex by how much its bones moved
  const delta: V3[] = p.rig.joints.map((k) => (rig.at.get(k) ?? v3()).clone().sub(p.rig.at.get(k)!));
  const same = p.rig === rig;
  const sp = typeof spec === 'function' ? spec : () => spec;
  order.forEach((s, d) => {
    let x = p.pos[s * 3], y = p.pos[s * 3 + 1], z = p.pos[s * 3 + 2];
    for (let k = 0; k < 4; k++) {
      const j = p.skinIndex[s * 4 + k];
      const wt = p.skinWeight[s * 4 + k];
      w.si[d * 4 + k] = rig.jointIndex.get(p.rig.joints[j]) ?? 0;
      w.sw[d * 4 + k] = wt;
      if (!same && wt > 0) {
        x += delta[j].x * wt;
        y += delta[j].y * wt;
        z += delta[j].z * wt;
      }
    }
    w.pos.set([x, y, z], d * 3);
    w.nrm.set([p.nrm[s * 3], p.nrm[s * 3 + 1], p.nrm[s * 3 + 2]], d * 3);
    const ps = sp(s);
    const c = ps.color ?? [1, 1, 1];
    w.paint.set([ps.slot, ps.slotB ?? ps.slot, ps.mix ?? 0, (ps.shade ?? 1) * (baked ? 1 : p.shade[s]), pack(c[0], c[1], c[2])], d * PAINT_STRIDE);
    w.pbr.set([0.04, 0.82], d * 2);
    if (baked) w.ao[d] = p.shade[s];
  });
  return w;
}

/** Turns a procedural mesh into a working piece bound to the rig. */
function fromProc(m: ProcMesh, rig: Rig, tag: string, nearestIn: Work[]): Work | null {
  const n = m.count;
  if (n === 0) return null;
  const w: Work = {
    tag,
    pos: Float32Array.from(m.pos), nrm: Float32Array.from(m.nrm), si: new Uint16Array(n * 4), sw: new Float32Array(n * 4),
    index: Uint32Array.from(m.idx), paint: new Float32Array(n * PAINT_STRIDE), pbr: new Float32Array(n * 2), ao: new Float32Array(n).fill(1),
  };
  for (let i = 0; i < n; i++) {
    const a = m.attr.slice(i * 9, i * 9 + 9);
    w.paint.set([a[0], a[1], a[2], a[3], pack(a[6], a[7], a[8])], i * PAINT_STRIDE);
    w.pbr.set([a[4], a[5]], i * 2);
  }
  if ('bone' in m.binding) {
    const j = rig.jointIndex.get(m.binding.bone) ?? 0;
    for (let i = 0; i < n; i++) {
      w.si[i * 4] = j;
      w.sw[i * 4] = 1;
    }
  } else {
    const grid = nearestGrid(nearestIn);
    const fb = rig.jointIndex.get(m.binding.fallback) ?? 0;
    const p = v3();
    for (let i = 0; i < n; i++) {
      p.fromArray(w.pos, i * 3);
      const hit = grid(p);
      if (!hit) {
        w.si[i * 4] = fb;
        w.sw[i * 4] = 1;
        continue;
      }
      for (let k = 0; k < 4; k++) {
        w.si[i * 4 + k] = hit.work.si[hit.i * 4 + k];
        w.sw[i * 4 + k] = hit.work.sw[hit.i * 4 + k];
      }
    }
  }
  return w;
}

/** Nearest-vertex lookup over some pieces (2 cm buckets). */
function nearestGrid(works: Work[]): (p: V3) => { work: Work; i: number } | null {
  const C = 0.02;
  const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const cells = new Map<number, number[]>();
  for (let wi = 0; wi < works.length; wi++) {
    const pos = works[wi].pos;
    for (let i = 0; i < pos.length / 3; i++) {
      const k = key(Math.floor(pos[i * 3] / C), Math.floor(pos[i * 3 + 1] / C), Math.floor(pos[i * 3 + 2] / C));
      let list = cells.get(k);
      if (!list) cells.set(k, (list = []));
      list.push(wi, i);
    }
  }
  return (p) => {
    let bw = -1, bi = -1, bd = Infinity;
    const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), cz = Math.floor(p.z / C);
    for (let r = 1; r <= 4 && bw < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const list = cells.get(key(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (let n = 0; n < list.length; n += 2) {
          const pos = works[list[n]].pos, i = list[n + 1];
          const d = (pos[i * 3] - p.x) ** 2 + (pos[i * 3 + 1] - p.y) ** 2 + (pos[i * 3 + 2] - p.z) ** 2;
          if (d < bd) {
            bd = d;
            bw = list[n];
            bi = i;
          }
        }
      }
    }
    return bw < 0 ? null : { work: works[bw], i: bi };
  };
}

/** Weight of a vertex on a set of joints (by index). */
function weightOnSet(w: Work, i: number, set: Uint8Array): number {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    const wt = w.sw[i * 4 + k];
    if (wt > 0 && set[w.si[i * 4 + k]]) s += wt;
  }
  return s;
}

function jointSet(rig: Rig, test: (key: string) => boolean): Uint8Array {
  return Uint8Array.from(rig.joints, (k) => (test(k) ? 1 : 0));
}

/** Total weight of a vertex on the joints whose key passes `test`. */
function weightOn(w: Work, i: number, rig: Rig, test: (key: string) => boolean): number {
  let s = 0;
  for (let k = 0; k < 4; k++) if (w.sw[i * 4 + k] > 0 && test(rig.joints[w.si[i * 4 + k]])) s += w.sw[i * 4 + k];
  return s;
}

// ------------------------------------------------------------------ body shape
/** Girth multipliers per bone (x = side to side, z = front to back for the spine). */
type Girth = Partial<Record<string, [number, number] | [number, number, number]>>;

const BUILDS: Record<string, Girth> = {
  slim: { Hips: [0.88, 0.88], Abdomen: [0.82, 0.8], Torso: [0.86, 0.85], Chest: [0.9, 0.88], Neck: [0.9, 0.9], Shoulder: [0.9, 0.9], UpperArm: [0.82, 0.82], LowerArm: [0.86, 0.86], UpperLeg: [0.85, 0.85], LowerLeg: [0.88, 0.88] },
  average: {},
  athletic: { Abdomen: [0.96, 0.97], Torso: [1.08, 1.06], Chest: [1.16, 1.12], Neck: [1.14, 1.14], Shoulder: [1.16, 1.16], UpperArm: [1.3, 1.3], LowerArm: [1.16, 1.16], UpperLeg: [1.12, 1.12], LowerLeg: [1.08, 1.08] },
  // [side, front, back]: the belly goes out the front
  heavy: { Hips: [1.2, 1.2, 1.14], Abdomen: [1.32, 1.62, 1.12], Torso: [1.24, 1.42, 1.1], Chest: [1.13, 1.2, 1.08], Neck: [1.2, 1.2], Shoulder: [1.1, 1.1], UpperArm: [1.26, 1.26], LowerArm: [1.14, 1.14], UpperLeg: [1.26, 1.26], LowerLeg: [1.12, 1.12] },
};
const NEUTRAL: Girth = { Chest: [0.93, 0.98], Shoulder: [0.92, 0.92], UpperArm: [0.94, 0.94], Hips: [1.07, 1.04], UpperLeg: [1.05, 1.05] };
/** Shoulder width (the deltoids and the top of the chest). */
const SHOULDER_GIRTH: Record<string, Girth> = {
  narrow: { Shoulder: [0.86, 0.9], UpperArm: [0.93, 0.93], Chest: [0.95, 1] },
  broad: { Shoulder: [1.16, 1.08], UpperArm: [1.07, 1.07], Chest: [1.06, 1.02] },
};
/** Head size: scales the whole head (hair, hats and face pieces are fitted to it after). */
const HEAD_SCALE: Record<string, number> = { small: 0.94, large: 1.07 };

/** Urban Ink feminine figure (one shared rig): narrower shoulders and waist, fuller hips. */
const FEM: Girth = { Chest: [0.9, 0.95], Torso: [0.88, 0.92], Abdomen: [0.9, 0.95], Shoulder: [0.85, 0.85], UpperArm: [0.84, 0.84], LowerArm: [0.88, 0.88], Neck: [0.88, 0.88], Hips: [1.12, 1.08], UpperLeg: [1.08, 1.08] };

/** The next joint down each bone (its direction). */
const CHILD: Record<string, string> = {
  Hips: 'Abdomen', Body: 'Abdomen', Abdomen: 'Torso', Torso: 'Chest', Chest: 'Neck', Neck: 'Head',
  ShoulderL: 'UpperArmL', ShoulderR: 'UpperArmR', UpperArmL: 'LowerArmL', UpperArmR: 'LowerArmR', LowerArmL: 'WristL', LowerArmR: 'WristR',
  UpperLegL: 'LowerLegL', UpperLegR: 'LowerLegR', LowerLegL: 'FootL', LowerLegR: 'FootR',
};

function combine(a: Girth, b: Girth): Girth {
  const out: Girth = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const o = out[k];
    out[k] = o ? (o.map((x, i) => x * (v![i] ?? v![1])) as [number, number, number]) : v;
  }
  return out;
}

/** Scales each vertex's distance from its bones (blended by skin weight): thinner or wider. */
function shapeBody(works: Work[], rig: Rig, girth: Girth): void {
  if (Object.keys(girth).length === 0) return;
  const per = rig.joints.map((key) => {
    const base = key.replace(/[LR]$/, '');
    const g = girth[base];
    const child = CHILD[key];
    if (!g || !child || !rig.at.has(child)) return null;
    const a = rig.at.get(key)!, b = rig.at.get(child)!;
    return { a, axis: v3().subVectors(b, a).normalize(), g, spine: !/[LR]$/.test(key) };
  });
  const p = v3(), q = v3(), r = v3(), acc = v3();
  for (const w of works) {
    for (let i = 0; i < w.pos.length / 3; i++) {
      p.fromArray(w.pos, i * 3);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const wt = w.sw[i * 4 + k];
        const s = wt > 0 ? per[w.si[i * 4 + k]] : null;
        if (!s) continue;
        // radial offset from the bone's line
        q.subVectors(p, s.a);
        r.copy(q).addScaledVector(s.axis, -q.dot(s.axis));
        if (s.spine) {
          // spine: separate side-to-side and front/back (the belly)
          const side = s.g[0], front = r.z >= 0 ? s.g[1] : s.g[2] ?? s.g[1];
          acc.x += r.x * (side - 1) * wt;
          acc.z += r.z * (front - 1) * wt;
        } else {
          acc.addScaledVector(r, (s.g[0] - 1) * wt);
        }
      }
      w.pos[i * 3] += acc.x;
      w.pos[i * 3 + 1] += acc.y;
      w.pos[i * 3 + 2] += acc.z;
    }
  }
}

// ------------------------------------------------------------------ measuring the body
function bodyQuery(rig: Rig, works: Work[]): BodyQuery {
  const neck = rig.at.get('Neck')!.clone();
  const axis = v3(neck.x, 0, neck.z);
  const NA = 72, y0 = neck.y - 0.24, y1 = neck.y + 0.07, DY = 0.004;
  const NY = Math.ceil((y1 - y0) / DY) + 1;
  const field = new Float32Array(NA * NY);
  const limbish = jointSet(rig, (key) => /^(UpperArm|LowerArm|Wrist|Index|Middle|Ring|Pinky|Thumb|Head)/.test(key));
  const a = v3(), b = v3(), c = v3(), e1 = v3(), e2 = v3(), d = v3(), o = v3(), pv = v3(), tv = v3(), qv = v3();
  for (const w of works) {
    for (let t = 0; t < w.index.length; t += 3) {
      const ids = [w.index[t], w.index[t + 1], w.index[t + 2]];
      if (weightOnSet(w, ids[0], limbish) > 0.5 || weightOnSet(w, ids[1], limbish) > 0.5 || weightOnSet(w, ids[2], limbish) > 0.5) continue;
      a.fromArray(w.pos, ids[0] * 3);
      b.fromArray(w.pos, ids[1] * 3);
      c.fromArray(w.pos, ids[2] * 3);
      const ymin = Math.min(a.y, b.y, c.y), ymax = Math.max(a.y, b.y, c.y);
      if (ymax < y0 || ymin > y1) continue;
      const ang = [a, b, c].map((p) => Math.atan2(p.x - axis.x, p.z - axis.z));
      let lo = ang[0], hi = ang[0];
      for (const x0 of ang) {
        let x = x0;
        while (x - ang[0] > Math.PI) x -= Math.PI * 2;
        while (x - ang[0] < -Math.PI) x += Math.PI * 2;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      if (hi - lo > 2) continue;
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      const DA = (Math.PI * 2) / NA;
      for (let j = Math.max(0, Math.floor((ymin - y0) / DY)); j <= Math.min(NY - 1, Math.ceil((ymax - y0) / DY)); j++) {
        for (let k = Math.floor(lo / DA); k <= Math.ceil(hi / DA); k++) {
          const kk = ((k % NA) + NA) % NA;
          const al = kk * DA;
          d.set(Math.sin(al), 0, Math.cos(al));
          o.set(axis.x, y0 + j * DY, axis.z);
          pv.crossVectors(d, e2);
          const det = e1.dot(pv);
          if (Math.abs(det) < 1e-12) continue;
          tv.subVectors(o, a);
          const u = tv.dot(pv) / det;
          if (u < 0 || u > 1) continue;
          qv.crossVectors(tv, e1);
          const v = d.dot(qv) / det;
          if (v < 0 || u + v > 1) continue;
          const dist = e2.dot(qv) / det;
          if (dist > field[j * NA + kk]) field[j * NA + kk] = dist;
        }
      }
    }
  }
  // fill holes from the neighbours (rows and columns)
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < field.length; i++) {
      if (field[i] > 0) continue;
      const j = Math.floor(i / NA), k = i % NA;
      let s = 0, n = 0;
      for (const [dj, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const jj = j + dj;
        if (jj < 0 || jj >= NY) continue;
        const v = field[jj * NA + ((k + dk + NA) % NA)];
        if (v > 0) (s += v), n++;
      }
      if (n) field[i] = s / n;
    }
  }
  return {
    joint: (key) => (rig.at.get(key) ?? v3()).clone(),
    neckAxis: axis,
    torso: (alpha, y) => {
      let x = alpha / ((Math.PI * 2) / NA);
      x = ((x % NA) + NA) % NA;
      const fy = Math.min(NY - 1, Math.max(0, (y - y0) / DY));
      const k0 = Math.floor(x), k1 = (k0 + 1) % NA, j0 = Math.floor(fy), j1 = Math.min(NY - 1, j0 + 1);
      const tx = x - k0, ty = fy - j0;
      const v = (field[j0 * NA + k0] * (1 - tx) + field[j0 * NA + k1] * tx) * (1 - ty) + (field[j1 * NA + k0] * (1 - tx) + field[j1 * NA + k1] * tx) * ty;
      return v > 0 ? v : 0.06;
    },
    limb: (ka, kb, s, half) => {
      const A = rig.at.get(ka), B = rig.at.get(kb);
      if (!A || !B) return 0.04;
      const ax = v3().subVectors(B, A);
      const len = ax.length();
      ax.normalize();
      const at = A.clone().addScaledVector(ax, s * len);
      let best = 0;
      const p = v3();
      const set = jointSet(rig, (key) => key === ka || key === kb);
      for (const w of works) {
        for (let i = 0; i < w.pos.length / 3; i++) {
          p.fromArray(w.pos, i * 3).sub(at);
          const along = p.dot(ax);
          if (Math.abs(along) > half) continue;
          if (weightOnSet(w, i, set) < 0.3) continue;
          best = Math.max(best, p.addScaledVector(ax, -along).length());
        }
      }
      return best > 0 ? best : 0.04;
    },
  };
}

// ------------------------------------------------------------------ timing (debug)
const timing: Record<string, number> = {};
let tMark = 0;
function mark(label?: string): void {
  const now = performance.now();
  if (label) timing[label] = (timing[label] ?? 0) + now - tMark;
  tMark = now;
}
/** Per-phase build times so far (ms), for profiling. */
export function lookTimings(): Record<string, number> {
  return { ...timing };
}

// ------------------------------------------------------------------ the builder
const HEAD_SOURCE: Record<string, string> = { masc: 'hoodie', neutral: 'casual', fem: 'punk' };
const HEAD_MATS: Record<string, { brows: string; eyes: string; dark?: string }> = {
  ink: { brows: 'Eyebrows', eyes: 'Eye' },
  hoodie: { brows: 'Eyebrows', eyes: 'Eye' },
  casual: { brows: 'Eyebrows', eyes: 'Eye', dark: 'Skin_Darker' },
  punk: { brows: 'Hair_Brown', eyes: 'Brown' },
};
const ASSET_HAIR: Record<string, [string, string]> = { spiky: ['hoodie', 'Hair'], ponytail: ['casual', 'Hair'], mohawk: ['punk', 'Pink'] };
/**
 * Everyone stands the same height. (Looks saved with a height still carry it, but it no longer
 * changes the character; the option stays in the look's wire code so old codes still decode.)
 */
const HEIGHT_SCALE: Record<string, number> = {};

/** Fields that change the geometry (colors are painted per character and stay out of the key). */
const COLOR_FIELDS = new Set(['skin', 'eyeColor', 'hairColor', 'facialHairColor', 'topColor', 'bottomColor', 'shoeColor', 'teeth', 'mouthProp', 'height']);

/** AJ's metallic finishes (shine is in the geometry, so they are part of the key). */
function finishOf(list: readonly LookOption[], id: string): number {
  return list.find((o) => o.id === id)?.metal ?? 0;
}
function finishes(look: Readonly<Appearance>): number[] {
  const out: number[] = [];
  out[SLOT.TOP] = finishOf(TOP_COLORS, look.topColor);
  out[SLOT.BOTTOM] = finishOf(BOTTOM_COLORS, look.bottomColor);
  out[SLOT.SHOE] = finishOf(SHOE_COLORS, look.shoeColor);
  return out;
}

export function geometryKey(look: Readonly<Appearance>, expression = 'neutral'): string {
  return LOOK_FIELD_KEYS.filter((k) => !COLOR_FIELDS.has(k)).map((k) => look[k]).join('|') + `|${look.details.join(',')}|${expression}`
    + `|${look.backpack ?? 'none'}|${finishes(look).filter((x) => x !== undefined).join(',')}`
    // (the belt's color is paint: only whether there is one changes the mesh)
    + `|${look.shoulders}|${look.headSize}|${look.mask}|${look.waistChain}|${look.faceMark}|${look.belt === 'none' ? 0 : 1}|${look.legPrint}`;
}

export class LookBuilder {
  private lib: PartLibrary | null = null;
  private cache = new Map<string, Assembled>();
  /** Source heads (as modelled), measured once: hair is moved from these onto new heads. */
  private sourceHeads = new Map<string, HeadRig>();
  private templates: () => CharacterTemplate[];

  constructor(templates: () => CharacterTemplate[]) {
    this.templates = templates;
  }

  get ready(): boolean {
    return this.library()?.ready ?? false;
  }

  private library(): PartLibrary | null {
    if (!this.lib) {
      const t = this.templates();
      if (t.length === 0 || t.some((x) => !x.merged)) return null;
      this.lib = new PartLibrary(t);
    }
    return this.lib;
  }

  /** The (cached) body for a look; `expression` previews a face on the Character screen. */
  build(look: Readonly<Appearance>, expression = 'neutral'): Assembled | null {
    const lib = this.library();
    if (!lib?.ready) return null;
    const key = geometryKey(look, expression);
    const hit = this.cache.get(key);
    if (hit) {
      // keep recently used looks at the end (least recently used get dropped first)
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let made: Assembled | null = null;
    try {
      made = this.assemble(lib, look, key, EXPRESSION_PRESETS[expression] ?? EXPRESSION_PRESETS.neutral);
    } catch (err) {
      console.error('character build failed, using the default look', err);
      if (key !== geometryKey(DEFAULT_APPEARANCE)) return this.build(DEFAULT_APPEARANCE);
      return null;
    }
    this.cache.set(key, made);
    // geometry is small but there is no need to keep every look ever seen
    // (room for a full battle royale lobby's looks, so nobody's body is rebuilt mid-match)
    while (this.cache.size > 96) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
      // characters still using it keep their own references; GPU buffers go when they do
    }
    return made;
  }

  private sourceHead(lib: PartLibrary, template: string): HeadRig | null {
    let h = this.sourceHeads.get(template);
    if (h) return h;
    const mats = HEAD_MATS[template];
    const skin = lib.piece(template, 'Head', 'Skin'), eyes = lib.piece(template, 'Head', mats.eyes), brows = lib.piece(template, 'Head', mats.brows);
    const rig = lib.rigs.get(template);
    if (!skin || !eyes || !brows || !rig) return null;
    const w = fromPiece(skin, rig, 'src', { slot: SLOT.SKIN });
    const t0 = performance.now();
    h = new HeadRig(surfaceOf([w], rig), fromPiece(eyes, rig, 'e', { slot: 0 }).pos, fromPiece(brows, rig, 'b', { slot: 0 }).pos);
    timing['source heads'] = (timing['source heads'] ?? 0) + performance.now() - t0;
    tMark += performance.now() - t0;
    this.sourceHeads.set(template, h);
    return h;
  }

  private assemble(lib: PartLibrary, look: Readonly<Appearance>, key: string, expr: Expression): Assembled {
    mark();
    const rig = lib.rigFor(look.bodyType)!;
    const works: Work[] = [];
    const headSet = jointSet(rig, (k) => k === 'Head');
    const headW = (w: Work, i: number) => weightOnSet(w, i, headSet);

    // ---------------- head
    const ink = rig.id === 'ink';
    const src = ink ? 'ink' : HEAD_SOURCE[look.bodyType] ?? 'hoodie';
    const mats = HEAD_MATS[src];
    const srcHead = this.sourceHead(lib, src);
    const skinP = lib.piece(src, 'Head', 'Skin')!;
    // (the older CC0 heads carry soft masks: lips, and darker skin in the nostrils and ears)
    // (the Urban Ink head too: lips, nostrils and inner ears)
    const skinMask = skinP.mask;
    const skin = fromPiece(skinP, rig, 'head', skinMask
      ? (i) => (skinMask[i * 2 + 1] > skinMask[i * 2] ? { slot: SLOT.SKIN, slotB: SLOT.SKIN_DARK, mix: skinMask[i * 2 + 1] } : { slot: SLOT.SKIN, slotB: SLOT.LIPS, mix: skinMask[i * 2] })
      : { slot: SLOT.SKIN });
    const headParts: Work[] = [skin];
    const darkP = mats.dark ? lib.piece(src, 'Head', mats.dark) : null;
    if (darkP) headParts.push(fromPiece(darkP, rig, 'head-dark', { slot: SLOT.SKIN_DARK }));
    let eyes = fromPiece(lib.piece(src, 'Head', mats.eyes)!, rig, 'eyes', { slot: SLOT.IRIS });
    const irisCount = eyes.pos.length / 3;
    if (ink) {
      // whole eyeballs: the iris first (the head is measured on it), then the white and the pupil
      const sclera = lib.piece('ink', 'Head', 'Sclera'), pupil = lib.piece('ink', 'Head', 'Pupil');
      const parts = [eyes];
      if (sclera) parts.push(fromPiece(sclera, rig, 'eyes', { slot: SLOT.FIXED, color: lin(0xf2eee6) }));
      if (pupil) parts.push(fromPiece(pupil, rig, 'eyes', { slot: SLOT.FIXED, color: lin(0x070707) }));
      eyes = concatWorks('eyes', parts);
      setPbr(eyes, 0.05, 0.25);
    }
    const brows = fromPiece(lib.piece(src, 'Head', mats.brows)!, rig, 'brows', { slot: SLOT.BROW });

    if (srcHead) {
      // head shape + face shape (everything that sits on the head moves together)
      const f = { center: srcHead.center, eyeY: srcHead.eyeY, chinY: srcHead.chinY, half: v3(srcHead.halfWidth, 0.1, (srcHead.frontZ - srcHead.backZ) / 2) };
      const p = v3();
      for (const w of [...headParts, eyes, brows]) {
        for (let i = 0; i < w.pos.length / 3; i++) {
          shapeHead(p.fromArray(w.pos, i * 3), headW(w, i), f, look.headShape, look.faceShape);
          w.pos.set([p.x, p.y, p.z], i * 3);
        }
      }
      const moved = (q: V3) => shapeHead(q.clone(), 1, f, look.headShape, look.faceShape);
      tweakFeatures(look, srcHead, moved, headParts, eyes, brows);
      const hs = HEAD_SCALE[look.headSize];
      if (hs) {
        // about the base of the skull, so the neck stays put and the head grows up and out
        const pivot = v3(srcHead.center.x, srcHead.chinY, srcHead.center.z);
        for (const w of [...headParts, eyes, brows]) {
          for (let i = 0; i < w.pos.length / 3; i++) {
            const k = headW(w, i);
            if (k <= 0) continue;
            p.fromArray(w.pos, i * 3).sub(pivot).multiplyScalar(1 + (hs - 1) * k).add(pivot);
            w.pos.set([p.x, p.y, p.z], i * 3);
          }
        }
      }
    }
    mark('head pieces + shape');
    // measured on the neutral face, so every expression builds exactly the same pieces
    const h = new HeadRig(surfaceOf(headParts, rig), eyes.pos.subarray(0, irisCount * 3), brows.pos);
    if (ink) inkChin(h, headParts);
    mark('head measure');
    applyExpression(expr, h, eyes, brows);
    works.push(...headParts, eyes, brows);

    // an open skull (the punk model's hair covered it): close it with skin
    const cap = new ProcMesh({ bone: 'Head' });
    if (!ink) skullCap(h, cap); // (Urban Ink heads are closed)
    pushProc(works, cap, rig, 'skullcap', []);

    mark('skull cap');
    // ---------------- hair (+ hat)
    const hairWorks: Work[] = [];
    const procHair = new ProcMesh({ bone: 'Head' });
    const asset = ASSET_HAIR[look.hair];
    if (asset) {
      const p = lib.piece(asset[0], 'Head', asset[1]);
      const from = this.sourceHead(lib, asset[0]);
      if (p && from) {
        const w = fromPiece(p, rig, 'hair', { slot: SLOT.HAIR });
        transferHair(w.pos, from, h);
        hairWorks.push(w);
      }
    }
    const hat = new ProcMesh({ bone: 'Head' });
    const fit = buildHat(look.hat, h, hat);
    if (!asset) buildHair(look.hair, h, procHair, fit?.covered);
    if (fit) {
      for (const w of hairWorks) tuckHair(w.pos, h, fit.covered, fit.room);
      tuckHair(procHair.pos, h, fit.covered, fit.room);
    }
    works.push(...hairWorks);
    pushProc(works, procHair, rig, 'hair', []);
    pushProc(works, hat, rig, 'hat', []);

    mark('hair + hat');
    // ---------------- face pieces
    const bits = new ProcMesh({ bone: 'Head' });
    const grill = look.mouthAcc.endsWith('grill') ? look.mouthAcc.replace('grill', '') : 'none';
    const mouth = new ProcMesh({ bone: 'Head' });
    // Urban Ink heads have sculpted lips: the procedural mouth is only for grills
    if (!ink || grill !== 'none') buildMouth(h, mouth, look.lips, expr, grill);
    pushProc(works, mouth, rig, 'mouth', []);
    const beard = new ProcMesh({ nearest: true, fallback: 'Head' });
    buildFacialHair(look.facialHair, h, beard, look.lips);
    pushProc(works, beard, rig, 'beard', headParts);
    buildLipPiercing(look.mouthAcc, h, bits, look.lips);
    buildFacePiercing(look.faceAcc, h, bits);
    buildDetails(look.details, h, bits);
    // a face tattoo, if picked (a star or cross on the forehead, teardrops, a lightning bolt)
    if (look.faceMark !== 'none') {
      const marks = new ProcMesh({ bone: 'Head' });
      buildFaceMarks(look.faceMark, h, marks);
      pushProc(works, marks, rig, 'facemark', []);
    }
    buildEarrings(look.earrings, h, bits);
    buildGlasses(look.glasses, h, bits);
    pushProc(works, bits, rig, 'face', []);
    if (look.mask && look.mask !== 'none') {
      const mask = maskFromSkin(headParts, h, look.mask);
      if (mask) works.push(mask);
    }

    mark('face');
    // ---------------- outfit
    const body: Work[] = [];
    const add = (t: string, part: string, mat: string, spec: PaintSpec | ((i: number) => PaintSpec), tag: string, tris?: Uint32Array) => {
      const p = lib.piece(t, part, mat);
      if (p) body.push(fromPiece(p, rig, tag, spec, tris));
      return p;
    };
    const SKIN = { slot: SLOT.SKIN };
    let legs: Work[] = [];
    if (ink) {
      buildInkOutfit(look, add, body, rig);
      legs = body.filter((w) => w.tag.startsWith('bottom'));
      let girth = BUILDS[look.build] ?? {};
      if (look.bodyType === 'neutral') girth = combine(girth, NEUTRAL);
      if (look.bodyType === 'fem') girth = combine(girth, FEM);
      girth = combine(girth, SHOULDER_GIRTH[look.shoulders] ?? {});
      // everything built so far moves with the body (a thicker neck carries the beard and mask
      // with it; pieces riding rigidly on the head bone are not changed)
      shapeBody([...body, ...works], rig, girth);
      if (look.wrist === 'gloves' || look.wrist === 'blackgloves' || look.wrist === 'glovewatches') paintGloves(body, rig, look.wrist === 'gloves');
      if (look.bodyType === 'fem') shapeBust(body, 1);
      else if (look.bodyType === 'neutral') shapeBust(body, 0.35);
      works.push(...body);
      // the graphic on the left thigh: a patch of the pants' own cloth that carries the print
      const patch = LONG_PANTS.has(look.bottom) ? buildLegPrint(look.legPrint, legs, rig) : null;
      if (patch && legs.length) {
        const n = patch.pos.length / 3;
        const w: Work = {
          tag: 'print', pos: patch.pos, nrm: patch.nrm, si: new Uint16Array(n * 4), sw: new Float32Array(n * 4), index: patch.index,
          paint: new Float32Array(n * PAINT_STRIDE), pbr: new Float32Array(n * 2), ao: new Float32Array(n).fill(1), uv: patch.uv,
        };
        const grid = nearestGrid(legs);
        const p = v3();
        for (let i = 0; i < n; i++) {
          const near = grid(p.fromArray(w.pos, i * 3));
          if (near) {
            // it moves, is colored and shines exactly like the cloth under it
            w.si.set(near.work.si.subarray(near.i * 4, near.i * 4 + 4), i * 4);
            w.sw.set(near.work.sw.subarray(near.i * 4, near.i * 4 + 4), i * 4);
            w.paint.set(near.work.paint.subarray(near.i * PAINT_STRIDE, (near.i + 1) * PAINT_STRIDE), i * PAINT_STRIDE);
            w.pbr.set(near.work.pbr.subarray(near.i * 2, near.i * 2 + 2), i * 2);
          } else {
            w.si[i * 4] = rig.jointIndex.get('UpperLegL') ?? 0;
            w.sw[i * 4] = 1;
            w.paint.set([SLOT.BOTTOM, SLOT.BOTTOM, 0, 1, 0], i * PAINT_STRIDE);
            w.pbr.set(FABRIC.denim, i * 2);
          }
        }
        works.push(w);
      }
    } else {
    switch (look.top) {
      case 'tee':
      case 'tank':
        add('casual', 'Body', 'LightBrown', { slot: SLOT.TOP }, 'top');
        add('casual', 'Body', 'Skin', SKIN, 'top-skin');
        if (look.top === 'tank') makeTank(body, rig);
        break;
      case 'crop': {
        add('punk', 'Body', 'Pink', { slot: SLOT.TOP }, 'top');
        add('punk', 'Body', 'Skin', SKIN, 'top-skin');
        // the black band of the crop top (its wristbands are separate options now)
        const black = lib.piece('punk', 'Body', 'Black');
        if (black) {
          const keep = components(black).filter((tris) => {
            const c = centroid(black, tris);
            return Math.abs(c.x - (black.rig.at.get('Neck')?.x ?? 0)) < 0.17 && c.y > 1.0;
          });
          for (const tris of keep) body.push(fromPiece(black, rig, 'top-trim', { slot: SLOT.FIXED, color: lin(0x111114) }, tris));
        }
        break;
      }
      default:
        add('hoodie', 'Body', 'Purple', { slot: SLOT.TOP }, 'top');
        add('hoodie', 'Body', 'Skin', SKIN, 'top-skin');
    }
    switch (look.bottom) {
      case 'jeans':
      case 'baggyjeans':
      case 'cargo':
        add('casual', 'Legs', 'LightBlue', { slot: SLOT.BOTTOM }, 'bottom');
        break;
      case 'slimjeans':
      case 'leggings':
        add('punk', 'Legs', 'Black', { slot: SLOT.BOTTOM }, 'bottom');
        add('punk', 'Legs', 'Skin', look.bottom === 'leggings' ? { slot: SLOT.BOTTOM, shade: 0.86 } : SKIN, 'bottom-skin');
        break;
      default:
        add('hoodie', 'Legs', 'LightBlue', { slot: SLOT.BOTTOM }, 'bottom');
        add('hoodie', 'Legs', 'Skin', SKIN, 'bottom-skin');
    }
    switch (look.shoes) {
      case 'running':
        add('casual', 'Feet', 'Red_Dark', { slot: SLOT.SHOE }, 'shoes');
        add('casual', 'Feet', 'White', { slot: SLOT.FIXED, color: lin(0xf0efe9) }, 'soles');
        break;
      case 'boots':
        add('punk', 'Feet', 'Black', { slot: SLOT.SHOE }, 'shoes');
        add('punk', 'Feet', 'Grey', { slot: SLOT.FIXED, color: lin(0x2b2c30) }, 'soles');
        break;
      default:
        add('hoodie', 'Feet', 'Purple', { slot: SLOT.SHOE }, 'shoes');
        add('hoodie', 'Feet', 'White', { slot: SLOT.FIXED, color: lin(0xf0efe9) }, 'soles');
    }
    // pants and shoes have to meet: hems that were made to hide in the punk's boots come down
    // to the shoe, and wide jeans get tucked into boots
    const legs = body.filter((w) => w.tag.startsWith('bottom'));
    const feet = body.filter((w) => w.tag === 'shoes' || w.tag === 'soles');
    if (look.shoes !== 'boots' && (look.bottom === 'slimjeans' || look.bottom === 'leggings')) lowerHems(legs, rig, 0.13);
    const baggy = look.bottom === 'baggyjeans' || look.bottom === 'cargo';
    if (look.shoes === 'boots' && look.bottom === 'jeans') tuckIntoBoots(legs, feet, rig);

    // build and body type: the head's own skin takes part too (its neck)
    let girth = BUILDS[look.build] ?? {};
    if (look.bodyType === 'neutral') girth = combine(girth, NEUTRAL);
    shapeBody([...body, skin], rig, girth);
    if (look.wrist === 'gloves' || look.wrist === 'blackgloves') paintGloves(body, rig, look.wrist === 'gloves');
    // streetwear cuts on top of the body shape
    if (look.top === 'puffer') makePuffer(body, rig);
    if (baggy) makeBaggy(legs, rig);
    if (look.shoes === 'chunky') makeChunky(feet, rig);
    works.push(...body);
    if (look.bottom === 'cargo') {
      const pockets = new ProcMesh({ nearest: true, fallback: 'Hips' });
      cargoPockets(pockets, rig);
      pushProc(works, pockets, rig, 'pockets', legs);
    }

    }
    void legs;
    mark('outfit + shape');
    // ---------------- pieces fitted to the body
    const bq = bodyQuery(rig, [...body, skin]);
    mark('body measure');
    const jew = new ProcMesh({ nearest: true, fallback: 'Chest' });
    const fine = new ProcMesh({ nearest: true, fallback: 'Chest' });
    buildNecklace(look.necklace, bq, jew, fine);
    buildWrist(look.wrist, bq, jew, fine);
    if (!ink) buildCrewBands(bq, jew);
    pushProc(works, jew, rig, 'jewelry', [...body, skin]);
    pushProc(works, fine, rig, 'fine', [...body, skin]);
    if (look.waistChain && look.waistChain !== 'none') {
      // from the front belt loop on the right hip, round to the back pocket
      const hipR = rig.at.get('UpperLegR') ?? v3(-0.12, 0.96, 0.04);
      const waistY = (rig.at.get('Hips')?.y ?? 0.9) + 0.06;
      const xOut = hipR.x - 0.11;
      const chainMesh = new ProcMesh({ nearest: true, fallback: 'Hips' });
      buildWaistChain(look.waistChain, v3(xOut - 0.03, waistY - 0.02, hipR.z - 0.01), v3(xOut + 0.045, waistY, hipR.z + 0.1), v3(xOut + 0.035, waistY - 0.03, hipR.z - 0.11), chainMesh);
      pushProc(works, chainMesh, rig, 'jewelry', body);
    }
    const pack = new ProcMesh({ bone: 'Chest' });
    buildBackpack(look.backpack ?? 'none', bq, pack);
    pushProc(works, pack, rig, 'backpack', []);
    mark('jewelry');
    // Urban Ink: the procedural hats, hair and beards were faceted (low-poly) by design; on the
    // smooth bodies they are shaded smooth too
    if (rig.id === 'ink') for (const w of works) if (w.tag === 'hat' || w.tag === 'hair' || w.tag === 'beard' || w.tag === 'skullcap') w.nrm = weldedNormals(w.pos, w.nrm);
    const out = this.merge(key, rig, works, h, look);
    mark('merge');
    return out;
  }

  private merge(key: string, rig: Rig, works: Work[], h: HeadRig, look: Readonly<Appearance>): Assembled {
    let nv = 0, ni = 0;
    for (const w of works) {
      nv += w.pos.length / 3;
      ni += w.index.length;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const paint = new Float32Array(nv * PAINT_STRIDE), pbr = new Float32Array(nv * 2), rigPos = new Float32Array(nv * 3), ao = new Float32Array(nv);
    const printUv = new Float32Array(nv * 2).fill(-1);
    const shine = finishes(look);
    // ink line width per vertex (stones and engraving would drown in the full outline)
    const ink = new Float32Array(nv).fill(1);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const nm = new THREE.Matrix3().getNormalMatrix(rig.Finv);
    const p = v3();
    let ov = 0, oi = 0;
    for (const w of works) {
      const n = w.pos.length / 3;
      for (let i = 0; i < n; i++) {
        p.fromArray(w.pos, i * 3).applyMatrix4(rig.Finv);
        pos.set([p.x, p.y, p.z], (ov + i) * 3);
        p.fromArray(w.nrm, i * 3).applyMatrix3(nm).normalize();
        nrm.set([p.x, p.y, p.z], (ov + i) * 3);
      }
      rigPos.set(w.pos, ov * 3);
      // the ink line is thinner on small, detailed parts (a face would drown in a thick one)
      const width = INK_WIDTH[w.tag] ?? (look.top && rig.id === 'ink' ? 1 : 1);
      if (width !== 1) ink.fill(width, ov, ov + n);
      si.set(w.si, ov * 4);
      sw.set(w.sw, ov * 4);
      paint.set(w.paint, ov * PAINT_STRIDE);
      pbr.set(w.pbr, ov * 2);
      ao.set(w.ao, ov);
      if (w.uv) printUv.set(w.uv, ov * 2);
      // AJ's metallic cloth (gold foil tops, 24K kicks...)
      for (let i = 0; i < n; i++) {
        const m = shine[w.paint[i * PAINT_STRIDE]];
        if (m) pbr.set([m, 0.42 - m * 0.22], (ov + i) * 2);
      }
      for (let k = 0; k < w.index.length; k++) index[oi + k] = w.index[k] + ov;
      ov += n;
      oi += w.index.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
    g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    g.setAttribute('printUv', new THREE.BufferAttribute(printUv, 2));
    g.setAttribute('ink', new THREE.BufferAttribute(ink, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const shapeLift = look.build === 'heavy' ? 0.01 : 0;
    return {
      key, rig, geometry: g, paint, rigPos,
      mouth: h.mouth.clone(),
      frame: { eyeY: h.eyeY, topY: h.crownY + (look.hat !== 'none' ? 0.04 : 0), chestY: (rig.at.get('Chest')?.y ?? 1.35) + shapeLift },
      heightScale: HEIGHT_SCALE[look.height] ?? 1,
    };
  }
}

/** AJ's shooter gloves: the hands (skin on the wrist and finger bones) turn into black leather. */
/**
 * Gloves: the hands (skin on the wrist and finger bones) turn into black leather. AJ's shooter
 * gloves are fingerless (the last two finger joints stay bare); plain black gloves cover all.
 */
function paintGloves(body: Work[], rig: Rig, fingerless = false): void {
  const hand = jointSet(rig, (k) => /^(Wrist|Index|Middle|Ring|Pinky|Thumb)/.test(k) && !(fingerless && /^(Index|Middle|Ring|Pinky)[34]|^Thumb3/.test(k)));
  const leather = pack(...lin(0x17171b));
  for (const w of body) {
    // full gloves run up the wrist to the sleeve (the hand piece carries a stub of forearm)
    const whole = !fingerless && w.tag === 'hand-skin';
    for (let i = 0; i < w.pos.length / 3; i++) {
      const a = i * PAINT_STRIDE;
      if (w.paint[a] !== SLOT.SKIN || (!whole && weightOnSet(w, i, hand) < 0.5)) continue;
      w.paint[a] = SLOT.FIXED;
      w.paint[a + 1] = SLOT.FIXED;
      w.paint[a + 4] = leather;
      w.pbr.set([0.12, 0.5], i * 2);
    }
  }
}

/** Ink line width per working piece (1 = the full outline). */
const INK_WIDTH: Record<string, number> = {
  fine: 0.12, head: 0.45, facemark: 0, eyes: 0, brows: 0, mouth: 0.15, face: 0.15, beard: 0.3, skullcap: 0.2,
  hair: 0.7, 'hand-skin': 0.45, 'top-trim': 0.25, laces: 0.25, jewelry: 0.3, mask: 0.4, print: 0, belt: 0.45, studs: 0.12, waistband: 0.4,
};

// ------------------------------------------------------------------ Urban Ink outfits
type AddPiece = (t: string, part: string, mat: string, spec: PaintSpec | ((i: number) => PaintSpec), tag: string) => Piece | null;

/** Fabric feel per material: [metalness, roughness]. Cotton is matte, nylon has a sheen, leather a soft gloss. */
const FABRIC: Record<string, [number, number]> = {
  cotton: [0.02, 0.92], fleece: [0.02, 0.95], nylon: [0.05, 0.52], denim: [0.02, 0.88], stretch: [0.04, 0.62],
  leather: [0.05, 0.45], mesh: [0.03, 0.7], rubber: [0.02, 0.62], metal: [0.85, 0.32], cord: [0.02, 0.8],
};
function setPbr(w: Work, metal: number, rough: number): void {
  for (let i = 0; i < w.pbr.length; i += 2) {
    w.pbr[i] = metal;
    w.pbr[i + 1] = rough;
  }
}

/**
 * The Urban Ink outfit: the generated garments for the chosen top, bottom and shoes, plus the
 * skin each outfit leaves showing (everything else under the clothes is left out).
 */
function buildInkOutfit(look: Readonly<Appearance>, add: AddPiece, body: Work[], rig: Rig): void {
  void rig;
  const put = (mat: string, spec: PaintSpec, tag: string, fabric: keyof typeof FABRIC, part = 'Body') => {
    const n = body.length;
    const p = add('ink', part, mat, spec, tag);
    if (p && body.length > n) setPbr(body[body.length - 1], ...FABRIC[fabric]);
    return p;
  };
  const TOP = { slot: SLOT.TOP }, BOTTOM = { slot: SLOT.BOTTOM }, SHOE = { slot: SLOT.SHOE }, SKIN = { slot: SLOT.SKIN };
  const ZIP = { slot: SLOT.FIXED, color: lin(0xc9ced5) };
  const skins = new Set<string>(['Skin_Hand']);
  switch (look.top) {
    case 'tee':
    case 'oversized':
      put('Top_Tee', TOP, 'top', 'cotton');
      skins.add('Skin_UpperArm').add('Skin_Forearm');
      break;
    case 'tank':
      put('Top_Tank', TOP, 'top', 'cotton');
      skins.add('Skin_UpperArm').add('Skin_Forearm').add('Skin_Torso');
      break;
    case 'crop':
      put('Top_Crop', TOP, 'top', 'cotton');
      skins.add('Skin_UpperArm').add('Skin_Forearm').add('Skin_Torso');
      break;
    case 'ziphoodie':
      put('Top_ZipHoodie', TOP, 'top', 'fleece');
      put('Top_ZipHoodie_Under', { slot: SLOT.FIXED, color: lin(0xeceae4) }, 'top-under', 'cotton');
      put('Top_ZipHoodie_Trim', { slot: SLOT.FIXED, color: lin(0xb8bcc2) }, 'top-trim', 'metal');
      break;
    case 'puffer':
      // hooded puffer jacket, silver zip
      put('Top_Puffer', TOP, 'top', 'nylon');
      put('Top_Puffer_Zip', ZIP, 'top-trim', 'metal');
      break;
    case 'puffervest':
      // puffer vest over a black long sleeve
      put('Top_PufferVest', TOP, 'top', 'nylon');
      put('Top_PufferVest_Zip', ZIP, 'top-trim', 'metal');
      put('Top_PufferVest_Under', { slot: SLOT.FIXED, color: lin(0x1b1b1f) }, 'top-under', 'cotton');
      break;
    default:
      put('Top_Hoodie', TOP, 'top', 'fleece');
      put('Top_Hoodie_Trim', { slot: SLOT.FIXED, color: lin(0xe9e7e1) }, 'top-trim', 'cord');
  }
  const BOTTOMS: Record<string, [string, keyof typeof FABRIC]> = {
    jeans: ['Bottom_Jeans', 'denim'], baggyjeans: ['Bottom_BaggyJeans', 'denim'], slimjeans: ['Bottom_SlimJeans', 'denim'],
    cargo: ['Bottom_Cargo', 'cotton'], leggings: ['Bottom_Leggings', 'stretch'], shorts: ['Bottom_Shorts', 'cotton'],
  };
  const [bottom, fabric] = BOTTOMS[look.bottom] ?? BOTTOMS.baggyjeans;
  put(bottom, BOTTOM, 'bottom', fabric, 'Legs');
  if (look.bottom === 'shorts') skins.add('Skin_Thigh').add('Skin_Shin');
  if (look.bottom !== 'leggings') {
    // pants are worn low: the boxers' waistband shows above them, and a studded belt if picked
    put('Waistband', { slot: SLOT.FIXED, color: lin(0xf1efea) }, 'waistband', 'cotton', 'Legs');
    if (look.belt !== 'none') {
      put('Belt', { slot: SLOT.BELT }, 'belt', 'leather', 'Legs');
      put('Belt_Metal', { slot: SLOT.FIXED, color: lin(0xd9dde2) }, 'studs', 'metal', 'Legs');
    }
  }
  const SHOES: Record<string, [string, number, keyof typeof FABRIC]> = {
    lowtops: ['Lowtop', 0xf2f1ec, 'leather'], running: ['Running', 0xf0efe9, 'mesh'], chunky: ['Chunky', 0xf4f3ee, 'leather'], boots: ['Boot', 0x2a2b2f, 'leather'],
  };
  const [shoe, sole, upper] = SHOES[look.shoes] ?? SHOES.lowtops;
  put(`Shoe_${shoe}`, SHOE, 'shoes', upper, 'Feet');
  put(`Shoe_${shoe}_Sole`, { slot: SLOT.FIXED, color: lin(sole) }, 'soles', 'rubber', 'Feet');
  put(`Shoe_${shoe}_Lace`, { slot: SLOT.FIXED, color: lin(look.shoes === 'boots' ? 0x5a4632 : 0xf4f3ef) }, 'laces', 'cord', 'Feet');
  for (const m of skins) put(m, SKIN, m === 'Skin_Hand' ? 'hand-skin' : 'top-skin', 'cotton', m === 'Skin_Thigh' || m === 'Skin_Shin' ? 'Legs' : 'Body');
  // a long top hangs over the top of the pants: what is under it is left out, so wide pants
  // (and the belt) never poke through the shirt
  const hem = TOP_HEM[look.top] ?? 0.86;
  if (hem < 0.95) {
    for (const w of body) {
      if (!/^(bottom|belt|studs|waistband)$/.test(w.tag)) continue;
      const keep: number[] = [];
      for (let t = 0; t < w.index.length; t += 3) {
        const a = w.index[t], b = w.index[t + 1], c = w.index[t + 2];
        if (Math.min(w.pos[a * 3 + 1], w.pos[b * 3 + 1], w.pos[c * 3 + 1]) < hem + 0.004) keep.push(a, b, c);
      }
      w.index = Uint32Array.from(keep);
    }
  }
}

/** Where each top's hem is (bind pose, meters up): tops not listed end at the hips. */
const TOP_HEM: Record<string, number> = { tee: 0.875, oversized: 0.875, tank: 0.93, crop: 1.13, puffer: 0.985, puffervest: 0.985 };

/** Pants long enough to carry the thigh graphic. */
const LONG_PANTS = new Set(['baggyjeans', 'jeans', 'slimjeans', 'cargo']);

/**
 * The chin on a smooth Urban Ink head: HeadRig finds it by a sudden step in the face profile,
 * which a sculpted (blended) chin does not have. Here: the lowest point down the middle of the
 * face that still stands out in front, near the lips' depth.
 */
function inkChin(h: HeadRig, skins: Work[]): void {
  const cx = h.mouth.x, zMin = h.mouth.z - 0.032;
  let low = h.chinY;
  for (const w of skins) {
    for (let i = 0; i < w.pos.length / 3; i++) {
      const x = w.pos[i * 3], y = w.pos[i * 3 + 1], z = w.pos[i * 3 + 2];
      if (Math.abs(x - cx) < 0.014 && z > zMin && y < h.mouth.y && y < low) low = y;
    }
  }
  h.chinY = Math.min(h.chinY, low + 0.004);
}

/**
 * A face covering cut from the head's own skin: every triangle of the lower face (under the
 * eyes, round to the ears, down under the jaw) copied and pushed out a few millimetres along
 * its normal. It follows the chin, jaw and lips exactly and bends with the head.
 */
function maskFromSkin(skins: Work[], h: HeadRig, kind: string): Work | null {
  const top = h.eyeY - 0.022, bottom = h.chinY - 0.04;
  const c = h.center;
  const inside = (x: number, y: number, z: number) => {
    if (y > top || y < bottom) return false;
    const theta = Math.atan2(x - c.x, z - c.z);
    // round the cheeks to just in front of the ears; under the jaw it narrows to the throat
    const lim = y < h.chinY ? 1.25 : 1.62;
    return Math.abs(theta) < lim;
  };
  const bandana = kind === 'bandanamask';
  const base = bandana ? 0x1b2a55 : 0x111114;
  const parts: Work[] = [];
  for (const w of skins) {
    const map = new Map<number, number>();
    const keep: number[] = [];
    for (let t = 0; t < w.index.length; t += 3) {
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const v = w.index[t + k];
        if (!inside(w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2])) ok = false;
      }
      if (ok) keep.push(w.index[t], w.index[t + 1], w.index[t + 2]);
    }
    if (!keep.length) continue;
    for (const v of keep) if (!map.has(v)) map.set(v, map.size);
    const n = map.size;
    const out: Work = {
      tag: 'mask', pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), si: new Uint16Array(n * 4), sw: new Float32Array(n * 4),
      index: Uint32Array.from(keep, (v) => map.get(v)!), paint: new Float32Array(n * PAINT_STRIDE), pbr: new Float32Array(n * 2), ao: new Float32Array(n).fill(1),
    };
    for (const [v, i] of map) {
      const nx = w.nrm[v * 3], ny = w.nrm[v * 3 + 1], nz = w.nrm[v * 3 + 2];
      // thicker over the nose and chin, where cloth stands off the face
      const x = w.pos[v * 3], y = w.pos[v * 3 + 1], z = w.pos[v * 3 + 2];
      const off = 0.0045 + 0.003 * Math.max(0, nz) * smoothstep(c.z, c.z + 0.1, z);
      out.pos.set([x + nx * off, y + ny * off, z + nz * off], i * 3);
      out.nrm.set([nx, ny, nz], i * 3);
      out.si.set(w.si.subarray(v * 4, v * 4 + 4), i * 4);
      out.sw.set(w.sw.subarray(v * 4, v * 4 + 4), i * 4);
      // a bandana's print: scattered pale dots; a mask: plain knit
      const dot = bandana && Math.sin(x * 260) * Math.sin(y * 230) * Math.sin(z * 210) > 0.42;
      const col = lin(dot ? 0xe9e6de : base);
      out.paint.set([SLOT.FIXED, SLOT.FIXED, 0, 1, pack(col[0], col[1], col[2])], i * PAINT_STRIDE);
      out.pbr.set([0.02, 0.88], i * 2);
    }
    parts.push(out);
  }
  if (!parts.length) return null;
  const mask = concatWorks('mask', parts);
  // stretched cloth: it bridges hollows (under the nose, between the lips, under the lower lip)
  // but never sinks into the face. Each pass moves a vertex toward its neighbours' average only
  // when that takes it further out from the head's middle.
  const n = mask.pos.length / 3;
  const nbr: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < mask.index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = mask.index[t + k], b = mask.index[t + ((k + 1) % 3)];
      nbr[a].push(b);
      nbr[b].push(a);
    }
  }
  // the cut edge: a clean hem instead of a triangle staircase (edges used by one triangle)
  const edgeCount = new Map<number, number>();
  for (let t = 0; t < mask.index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = mask.index[t + k], b = mask.index[t + ((k + 1) % 3)];
      const key = Math.min(a, b) * n + Math.max(a, b);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const hem: number[][] = Array.from({ length: n }, () => []);
  for (const [key, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(key / n), b = key % n;
    hem[a].push(b);
    hem[b].push(a);
  }
  const p = v3(), q = v3();
  for (let pass = 0; pass < 8; pass++) {
    const next = Float32Array.from(mask.pos);
    for (let i = 0; i < n; i++) {
      if (hem[i].length !== 2) continue;
      q.fromArray(mask.pos, hem[i][0] * 3).add(p.fromArray(mask.pos, hem[i][1] * 3)).multiplyScalar(0.5);
      next.set(p.fromArray(mask.pos, i * 3).lerp(q, 0.5).toArray(), i * 3);
    }
    mask.pos.set(next);
  }
  const cc = v3(h.center.x, h.center.y - 0.02, h.center.z - 0.01);
  for (let pass = 0; pass < 14; pass++) {
    const next = Float32Array.from(mask.pos);
    for (let i = 0; i < n; i++) {
      if (hem[i].length || nbr[i].length < 3) continue; // the hem stays where it was cut
      q.set(0, 0, 0);
      for (const v of nbr[i]) q.add(p.fromArray(mask.pos, v * 3));
      q.multiplyScalar(1 / nbr[i].length);
      p.fromArray(mask.pos, i * 3);
      if (q.distanceTo(cc) > p.distanceTo(cc)) next.set(p.lerp(q, 0.6).toArray(), i * 3);
    }
    mask.pos.set(next);
  }
  return mask;
}

/** Merges working pieces into one (same order; used for whole eyeballs). */
function concatWorks(tag: string, parts: Work[]): Work {
  let n = 0, ni = 0;
  for (const w of parts) {
    n += w.pos.length / 3;
    ni += w.index.length;
  }
  const out: Work = {
    tag, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), si: new Uint16Array(n * 4), sw: new Float32Array(n * 4),
    index: new Uint32Array(ni), paint: new Float32Array(n * PAINT_STRIDE), pbr: new Float32Array(n * 2), ao: new Float32Array(n),
  };
  let ov = 0, oi = 0;
  for (const w of parts) {
    const c = w.pos.length / 3;
    out.pos.set(w.pos, ov * 3);
    out.nrm.set(w.nrm, ov * 3);
    out.si.set(w.si, ov * 4);
    out.sw.set(w.sw, ov * 4);
    out.paint.set(w.paint, ov * PAINT_STRIDE);
    out.pbr.set(w.pbr, ov * 2);
    out.ao.set(w.ao, ov);
    for (let k = 0; k < w.index.length; k++) out.index[oi + k] = w.index[k] + ov;
    ov += c;
    oi += w.index.length;
  }
  return out;
}

/** Feminine figure on the Urban Ink body: a bust (skin and the clothes over it move together). */
function shapeBust(works: Work[], amount: number): void {
  const cz = 0.035;
  for (const w of works) {
    for (let i = 0; i < w.pos.length / 3; i++) {
      const x = w.pos[i * 3], y = w.pos[i * 3 + 1], z = w.pos[i * 3 + 2];
      if (z < cz) continue;
      let push = 0;
      for (const side of [1, -1]) {
        const dx = x - side * 0.068, dy = y - 1.29;
        push = Math.max(push, Math.exp(-(dx * dx + dy * dy * 1.6) / (0.052 * 0.052)));
      }
      if (push < 1e-3) continue;
      const k = push * 0.032 * amount * smoothstep(cz, cz + 0.08, z);
      w.pos[i * 3 + 2] += k;
      w.pos[i * 3 + 1] -= k * 0.25;
    }
  }
}

function pushProc(works: Work[], m: ProcMesh, rig: Rig, tag: string, nearestIn: Work[]): void {
  const w = fromProc(m, rig, tag, nearestIn);
  if (w) works.push(w);
}

function surfaceOf(parts: Work[], rig: Rig): HeadSurface {
  let n = 0, ni = 0;
  for (const w of parts) {
    n += w.pos.length / 3;
    ni += w.index.length;
  }
  const pos = new Float32Array(n * 3), index = new Uint32Array(ni), headWeight = new Float32Array(n);
  let ov = 0, oi = 0;
  for (const w of parts) {
    const c = w.pos.length / 3;
    pos.set(w.pos, ov * 3);
    const headSet = jointSet(rig, (k) => k === 'Head');
    for (let i = 0; i < c; i++) headWeight[ov + i] = weightOnSet(w, i, headSet);
    for (let k = 0; k < w.index.length; k++) index[oi + k] = w.index[k] + ov;
    ov += c;
    oi += w.index.length;
  }
  return { pos, index, headWeight };
}

/** Closes a skull that was left open under the model's own hair. */
function skullCap(h: HeadRig, out: ProcMesh): void {
  const step = (3 * Math.PI) / 180;
  const pts: Array<Array<V3 | null>> = [];
  const nt = Math.round((Math.PI * 2) / step);
  let any = false;
  for (let phi = Math.PI / 2; phi > 0.1; phi -= step) {
    const row: Array<V3 | null> = [];
    for (let k = 0; k < nt; k++) {
      const t = (k / nt) * Math.PI * 2 - Math.PI;
      // the gap, plus a cell of overlap under the skin around it
      let near = false;
      for (const [dt, dp] of [[0, 0], [step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        if (!h.measured(t + dt, phi + dp)) near = true;
      }
      if (near) any = true;
      row.push(near ? h.surface(t, phi, h.measured(t, phi) ? -0.0012 : -0.0004) : null);
    }
    pts.push(row);
  }
  if (any) out.grid(pts, () => ({ slot: SLOT.SKIN }), { flat: false, wrap: true });
}

/** Eyes, brows, nose and ears presets. */
function tweakFeatures(look: Readonly<Appearance>, src: HeadRig, moved: (p: V3) => V3, skins: Work[], eyes: Work, brows: Work): void {
  const cx = moved(src.mouth).x;
  const p = v3();
  // eyes: scale each eye around its own center
  const eyeScale = { small: [0.78, 0.78], large: [1.28, 1.28], narrow: [1.1, 0.55] }[look.eyes] ?? [1, 1];
  const centers = [moved(src.eyeL), moved(src.eyeR)];
  for (let i = 0; i < eyes.pos.length / 3; i++) {
    p.fromArray(eyes.pos, i * 3);
    const c = p.x >= cx ? centers[0] : centers[1];
    p.x = c.x + (p.x - c.x) * eyeScale[0];
    p.y = c.y + (p.y - c.y) * eyeScale[1];
    eyes.pos.set([p.x, p.y, p.z], i * 3);
  }
  // brows: thickness, an arch, and the expression lifting the inner / outer ends
  const bc = [moved(src.browL), moved(src.browR)];
  const extent = [0, 0];
  for (let i = 0; i < brows.pos.length / 3; i++) {
    const x = brows.pos[i * 3];
    const s = x >= cx ? 0 : 1;
    extent[s] = Math.max(extent[s], Math.abs(x - bc[s].x));
  }
  for (let i = 0; i < brows.pos.length / 3; i++) {
    p.fromArray(brows.pos, i * 3);
    const s = p.x >= cx ? 0 : 1;
    const c = bc[s];
    // 0 at the inner end (toward the nose), 1 at the outer end
    const u = Math.min(1, Math.max(0, ((p.x - c.x) * (s === 0 ? 1 : -1)) / Math.max(1e-4, extent[s]) * 0.5 + 0.5));
    const thick = { thin: 0.5, thick: 1.8 }[look.brows] ?? 1;
    p.y = c.y + (p.y - c.y) * thick;
    if (look.brows === 'thick') p.x = c.x + (p.x - c.x) * 1.06;
    if (look.brows === 'arched') p.y += 0.0055 * Math.sin(Math.PI * Math.pow(u, 0.75)) - 0.0012;
    brows.pos.set([p.x, p.y, p.z], i * 3);
  }
  // nose: everything near the nose, fading out smoothly
  const tip = moved(src.noseTip);
  const root = v3(cx, (moved(v3(cx, src.noseBaseY, 0)).y + tip.y) / 2 + 0.004, tip.z - 0.014);
  const ns = { small: [0.8, 0.85, 0.8], wide: [1.38, 1, 1], narrow: [0.74, 1, 1.02] }[look.nose];
  const earScale = { small: 0.72, large: 1.32 }[look.ears];
  const ears = [moved(src.earL.center), moved(src.earR.center)];
  for (const w of skins) {
    for (let i = 0; i < w.pos.length / 3; i++) {
      p.fromArray(w.pos, i * 3);
      if (ns && p.z > root.z - 0.012) {
        const d = p.distanceTo(root.clone().setZ(tip.z - 0.006));
        const k = smoothstep(0.034, 0.014, d);
        if (k > 0) {
          const q = p.clone().sub(root);
          q.set(q.x * ns[0], q.y * ns[1], q.z * ns[2]);
          p.lerp(q.add(root), k);
        }
      }
      if (earScale) {
        const s = p.x >= cx ? 0 : 1;
        const e = ears[s];
        const out = Math.abs(p.x - cx) - (Math.abs(e.x - cx) - 0.012);
        const k = smoothstep(0, 0.009, out) * smoothstep(0.06, 0.035, p.distanceTo(e));
        if (k > 0) {
          const anchor = e.clone().setX(cx + (e.x - cx) * 0.86);
          p.lerp(p.clone().sub(anchor).multiplyScalar(earScale).add(anchor), k);
        }
      }
      w.pos.set([p.x, p.y, p.z], i * 3);
    }
  }
}

/** An expression on the eyes (open / squint) and brows (inner and outer ends up or down). */
function applyExpression(expr: Expression, h: HeadRig, eyes: Work, brows: Work): void {
  if (expr === EXPRESSION_PRESETS.neutral) return;
  const cx = h.mouth.x;
  const p = v3();
  for (let i = 0; i < eyes.pos.length / 3; i++) {
    p.fromArray(eyes.pos, i * 3);
    const c = p.x >= cx ? h.eyeL : h.eyeR;
    eyes.pos[i * 3 + 1] = c.y + (p.y - c.y) * expr.eyeOpen;
  }
  const bc = [h.browL, h.browR];
  for (let i = 0; i < brows.pos.length / 3; i++) {
    p.fromArray(brows.pos, i * 3);
    const s = p.x >= cx ? 0 : 1;
    const half = Math.max(0.01, Math.abs(bc[s].x - cx));
    // 0 at the inner end (toward the nose), 1 at the outer end
    const u = Math.min(1, Math.max(0, Math.abs(p.x - cx) / (half * 2)));
    brows.pos[i * 3 + 1] = p.y + expr.browIn * (1 - u) + expr.browOut * u;
    brows.pos[i * 3 + 2] = p.z + 0.0008 * Math.max(0, expr.browIn) * (1 - u);
  }
}

/** Position along a leg's shin (0 = knee, 1 = ankle) and distance from it. */
function shin(rig: Rig, side: string): { A: V3; axis: V3; len: number } {
  const A = rig.at.get(`LowerLeg${side}`)!, B = rig.at.get(`Foot${side}`)!;
  const axis = v3().subVectors(B, A);
  const len = axis.length();
  return { A, axis: axis.normalize(), len };
}

/** Stretches the lower legs of pants down so their hems reach `hemY` (meters). */
function lowerHems(legs: Work[], rig: Rig, hemY: number): void {
  for (const side of ['L', 'R']) {
    const { A, axis, len } = shin(rig, side);
    const onShin = (w: Work, i: number) => weightOn(w, i, rig, (k) => k === `LowerLeg${side}` || k === `Foot${side}`) > 0.5;
    let hem = 0;
    for (const w of legs) for (let i = 0; i < w.pos.length / 3; i++) if (onShin(w, i)) hem = Math.max(hem, v3().fromArray(w.pos, i * 3).sub(A).dot(axis) / len);
    const target = Math.min(0.97, (A.y - hemY) / (A.y - (A.y + axis.y * len)));
    const from = 0.2;
    if (hem <= from || target <= hem) continue;
    for (const w of legs) {
      for (let i = 0; i < w.pos.length / 3; i++) {
        if (!onShin(w, i)) continue;
        const p = v3().fromArray(w.pos, i * 3);
        const s = p.clone().sub(A).dot(axis) / len;
        if (s <= from) continue;
        const s2 = from + ((s - from) * (target - from)) / (hem - from);
        p.addScaledVector(axis, (s2 - s) * len);
        w.pos.set([p.x, p.y, p.z], i * 3);
      }
    }
  }
}

/** Squeezes pant legs inside boot shafts. */
function tuckIntoBoots(legs: Work[], boots: Work[], rig: Rig): void {
  for (const side of ['L', 'R']) {
    const { A, axis, len } = shin(rig, side);
    const radial = (p: V3) => {
      const q = p.clone().sub(A);
      const s = q.dot(axis);
      return { s: s / len, r: q.addScaledVector(axis, -s) };
    };
    // the shaft's narrowest cross-section (boots are not round): widest point per direction, then the smallest
    let top = 1;
    const bins = new Float32Array(16);
    const ref = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(0, 0, 1);
    const e1 = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize(), e2 = axis.clone().cross(e1);
    for (const w of boots) {
      for (let i = 0; i < w.pos.length / 3; i++) {
        if (weightOn(w, i, rig, (k) => k === `LowerLeg${side}`) < 0.5) continue;
        const { s, r } = radial(v3().fromArray(w.pos, i * 3));
        top = Math.min(top, s);
        if (s > 0.35 && s < 0.75) {
          const b = Math.floor(((Math.atan2(r.dot(e2), r.dot(e1)) / (Math.PI * 2) + 1) % 1) * 16);
          bins[b] = Math.max(bins[b], r.length());
        }
      }
    }
    const filled = [...bins].filter((v) => v > 0);
    if (filled.length < 8) continue;
    const shaft = Math.min(...filled);
    for (const w of legs) {
      for (let i = 0; i < w.pos.length / 3; i++) {
        const p = v3().fromArray(w.pos, i * 3);
        const { s, r } = radial(p);
        if (s < top + 0.02 || weightOn(w, i, rig, (k) => k === `LowerLeg${side}`) < 0.5) continue;
        const max = shaft - 0.006, cur = r.length();
        if (cur <= max) continue;
        p.addScaledVector(r, max / cur - 1);
        w.pos.set([p.x, p.y, p.z], i * 3);
      }
    }
  }
}

/** T-shirt -> tank top: the sleeves become bare upper arms. */
function makeTank(body: Work[], rig: Rig): void {
  const top = body.find((w) => w.tag === 'top'), skin = body.find((w) => w.tag === 'top-skin');
  if (!top || !skin) return;
  for (const side of ['L', 'R']) {
    const up = `UpperArm${side}`, sh = `Shoulder${side}`;
    const A = rig.at.get(up)!, B = rig.at.get(`LowerArm${side}`)!;
    const axis = v3().subVectors(B, A);
    const len = axis.length();
    axis.normalize();
    const radial = (w: Work, i: number) => {
      const q = v3().fromArray(w.pos, i * 3).sub(A);
      const along = q.dot(axis);
      return { along, r: q.addScaledVector(axis, -along) };
    };
    // the bare arm under the sleeve's hem sets how thick the arm is
    let armR = 0, armN = 0, hem = 0;
    for (let i = 0; i < top.pos.length / 3; i++) if (weightOn(top, i, rig, (k) => k === up) > 0.5) hem = Math.max(hem, radial(top, i).along);
    for (let i = 0; i < skin.pos.length / 3; i++) {
      if (weightOn(skin, i, rig, (k) => k === up) < 0.5) continue;
      const { along, r } = radial(skin, i);
      if (along > hem && along < hem + 0.06) (armR += r.length()), armN++;
    }
    armR = armN ? armR / armN : 0.04;
    for (let i = 0; i < top.pos.length / 3; i++) {
      const wUp = weightOn(top, i, rig, (k) => k === up), wSh = weightOn(top, i, rig, (k) => k === sh);
      if (wUp < 0.25) continue;
      const { along, r } = radial(top, i);
      const t = Math.min(1, Math.max(0, along / (len * 0.5)));
      const target = armR * (1.0 + 0.12 * (1 - t));
      const cur = r.length();
      const k = Math.min(1, wUp * 2.2);
      if (cur > target) {
        const shrink = cur - (cur - target) * k;
        const q = v3().fromArray(top.pos, i * 3).addScaledVector(r, (shrink - cur) / cur);
        top.pos.set([q.x, q.y, q.z], i * 3);
      }
      if (wUp > 0.4) top.paint[i * PAINT_STRIDE] = SLOT.SKIN, (top.paint[i * PAINT_STRIDE + 1] = SLOT.SKIN);
      void wSh;
    }
  }
}

// ------------------------------------------------------------------ streetwear cuts
/** Hoodie -> puffer jacket: puffed out everywhere it covers, quilted into baffles, with a sheen. */
function makePuffer(body: Work[], rig: Rig): void {
  const top = body.find((w) => w.tag === 'top');
  if (!top) return;
  const torso = jointSet(rig, (k) => /^(Hips|Body|Abdomen|Torso|Chest|Shoulder[LR])$/.test(k));
  const upper = jointSet(rig, (k) => /^UpperArm[LR]$/.test(k));
  const lower = jointSet(rig, (k) => /^LowerArm[LR]$/.test(k));
  const neck = jointSet(rig, (k) => k === 'Neck' || k === 'Head');
  const wrist = jointSet(rig, (k) => /^Wrist[LR]$/.test(k));
  const shL = rig.at.get('UpperArmL'), shR = rig.at.get('UpperArmR');
  // the models are flat-shaded (corners split per face): push along the averaged normal so it stays closed
  const smooth = weldedNormals(top.pos, top.nrm);
  const p = v3();
  for (let i = 0; i < top.pos.length / 3; i++) {
    p.fromArray(top.pos, i * 3);
    const wt = weightOnSet(top, i, torso), wu = weightOnSet(top, i, upper), wl = weightOnSet(top, i, lower);
    const wn = weightOnSet(top, i, neck), ww = weightOnSet(top, i, wrist);
    let puff = (0.05 * wt + 0.042 * wu + 0.034 * wl + 0.014 * wn) * (1 - ww);
    // baffles: horizontal rings on the body, rings around the sleeves
    const sleeve = wu + wl > 0.5;
    const sh = sleeve && shL && shR ? (p.distanceTo(shL) < p.distanceTo(shR) ? shL : shR) : null;
    const q = sh ? p.distanceTo(sh) : p.y;
    const seam = Math.abs(Math.cos((Math.PI * q) / 0.105)) ** 8;
    puff *= 1 - 0.5 * seam;
    top.pos[i * 3] += smooth[i * 3] * puff;
    top.pos[i * 3 + 1] += smooth[i * 3 + 1] * puff;
    top.pos[i * 3 + 2] += smooth[i * 3 + 2] * puff;
    top.paint[i * PAINT_STRIDE + 3] *= 1 - 0.3 * seam;
    // a satin nylon sheen (glossier than this catches every flat facet as a white blotch)
    top.pbr[i * 2] = 0.02;
    top.pbr[i * 2 + 1] = 0.62;
  }
}

/** Per-vertex normals averaged over every corner at the same spot (flat-shaded meshes split them). */
export function weldedNormals(pos: ArrayLike<number>, nrm: ArrayLike<number>): Float32Array {
  const n = pos.length / 3;
  const key = (i: number) => `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += nrm[i * 3];
    s[1] += nrm[i * 3 + 1];
    s[2] += nrm[i * 3 + 2];
    sums.set(k, s);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sums.get(key(i))!;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  return out;
}

/** Jeans -> baggy: wide legs that flare toward the ankle and stack up over the shoes. */
function makeBaggy(legs: Work[], rig: Rig): void {
  for (const side of ['L', 'R']) {
    const hip = rig.at.get(`UpperLeg${side}`), knee = rig.at.get(`LowerLeg${side}`), ankle = rig.at.get(`Foot${side}`);
    if (!hip || !knee || !ankle) continue;
    const thigh = v3().subVectors(knee, hip), shinV = v3().subVectors(ankle, knee);
    const thighLen = thigh.length(), shinLen = shinV.length();
    thigh.normalize();
    shinV.normalize();
    const p = v3(), q = v3(), r = v3();
    for (const w of legs) {
      for (let i = 0; i < w.pos.length / 3; i++) {
        const wTh = weightOn(w, i, rig, (k) => k === `UpperLeg${side}`);
        const wSh = weightOn(w, i, rig, (k) => k === `LowerLeg${side}` || k === `Foot${side}`);
        if (wTh + wSh < 0.3) continue;
        p.fromArray(w.pos, i * 3);
        let f: number;
        if (wSh >= wTh) {
          q.subVectors(p, knee);
          const along = q.dot(shinV);
          r.copy(q).addScaledVector(shinV, -along);
          const s = Math.min(1, Math.max(0, along / shinLen));
          f = 1.26 + 0.62 * s ** 1.15;
          // stacked denim: soft creases near the bottom
          if (s > 0.5) w.paint[i * PAINT_STRIDE + 3] *= 1 - 0.2 * Math.abs(Math.sin(s * Math.PI * 7)) ** 6;
        } else {
          q.subVectors(p, hip);
          const along = q.dot(thigh);
          r.copy(q).addScaledVector(thigh, -along);
          f = 1.2 + 0.06 * Math.min(1, Math.max(0, along / thighLen));
        }
        p.addScaledVector(r, (f - 1) * Math.min(1, wTh + wSh));
        w.pos.set([p.x, p.y, p.z], i * 3);
      }
    }
  }
  // the hems come all the way down over the shoes
  lowerHems(legs, rig, 0.03);
}

/** Big flap pockets on the outside of each thigh. */
function cargoPockets(out: ProcMesh, rig: Rig): void {
  for (const side of ['L', 'R']) {
    const hip = rig.at.get(`UpperLeg${side}`), knee = rig.at.get(`LowerLeg${side}`);
    if (!hip || !knee) continue;
    const axis = v3().subVectors(knee, hip);
    const len = axis.length();
    axis.normalize();
    const outward = v3(Math.sign(hip.x) || (side === 'L' ? 1 : -1), 0, 0);
    const c = hip.clone().addScaledVector(axis, len * 0.58).addScaledVector(outward, 0.118);
    const fwd = v3(0, 0, 1);
    const st = style(SLOT.BOTTOM, { shade: 0.86 });
    out.box(c, v3(0.012, 0.07, 0.052), st, [outward, axis.clone().negate(), fwd]);
    // the flap
    out.box(c.clone().addScaledVector(axis, -0.058).addScaledVector(outward, 0.006), v3(0.01, 0.016, 0.056), style(SLOT.BOTTOM, { shade: 0.72 }), [outward, axis.clone().negate(), fwd]);
  }
}

/** Sneakers -> chunky: bigger all round, with thick soles. */
function makeChunky(feet: Work[], rig: Rig): void {
  const fl = rig.at.get('FootL'), fr = rig.at.get('FootR');
  if (!fl || !fr) return;
  for (const side of [fl, fr]) {
    const other = side === fl ? fr : fl;
    const mine = (p: V3) => (p.x - side.x) ** 2 + (p.z - side.z) ** 2 < (p.x - other.x) ** 2 + (p.z - other.z) ** 2;
    let minY = Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const p = v3();
    for (const w of feet) {
      for (let i = 0; i < w.pos.length / 3; i++) {
        p.fromArray(w.pos, i * 3);
        if (!mine(p)) continue;
        minY = Math.min(minY, p.y);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      }
    }
    if (!Number.isFinite(minY)) continue;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2 + (z1 - z0) * 0.08;
    for (const w of feet) {
      const sole = w.tag === 'soles';
      for (let i = 0; i < w.pos.length / 3; i++) {
        p.fromArray(w.pos, i * 3);
        if (!mine(p)) continue;
        p.x = cx + (p.x - cx) * 1.34;
        p.z = cz + (p.z - cz) * 1.2;
        p.y = minY + (p.y - minY) * (sole ? 1.9 : 1.32);
        w.pos.set([p.x, p.y, p.z], i * 3);
      }
    }
  }
}

