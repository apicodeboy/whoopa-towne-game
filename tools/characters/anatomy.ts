/**
 * The character's anatomy: a stylized adult body sculpted as blended masses on the rig's
 * joints: ribcage, pecs, lats, obliques, pelvis, glutes, trapezius, deltoids, biceps, triceps,
 * forearm flexors, a real hand with five jointed fingers, quads, hamstrings, calves, and a
 * faceless head: a smooth egg with plain ears and a blank face plate over the front.
 *
 * Everything is in the T-pose bind space: meters, +Y up, facing +Z, the character's left at +X.
 */
import {
  type SDF, add, blend, chain, clamp, ellipsoid, ellipsoidIn, frame, intersect, lerp3, len, norm, plane, roundBoxIn, roundCone,
  scale, smax, smin, sphere, sub, subtract,
} from './sdf';
import type { InkSkeleton, V3 } from './skeleton';

export type Side = 'L' | 'R';
export const SIDES: Side[] = ['L', 'R'];
const sx = (s: Side) => (s === 'L' ? 1 : -1);

/** Body regions (pieces of skin that clothing hides or shows). */
export type Region = 'neck' | 'torso' | 'hips' | 'upperarm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot' | 'head';

export interface Anatomy {
  /** The whole skin (head and hands included), for clothing to be shaped around. */
  skin: SDF;
  /** The body without head and hands (meshed coarser), neck shrunk under the head's own neck. */
  body: SDF;
  head: SDF;
  hand: Record<Side, SDF>;
  /** Eyeball centers and radius, and where the iris looks. */
  eyes: { center: Record<Side, V3>; radius: number; look: V3 };
  /** Which region a point of the body belongs to. */
  region(x: number, y: number, z: number): Region;
  /** Which side (for limbs), 0 for the middle. */
  sideOf(x: number): number;
  j: (k: string) => V3;
  /** The blank face: a shell over the whole head above the neckline (its own piece and color). */
  face: SDF;
  /** The skin of the head piece that shows: the neck, up to the face shell's edge. */
  neckSkin: SDF;
  /** Head center and size, for the clothing and the face. */
  headCenter: V3;
  /** The neck (outer, as the head piece has it). */
  neck: SDF;
}

export function makeAnatomy(sk: InkSkeleton): Anatomy {
  const j = (k: string): V3 => sk.at(k);
  const P = (x: number, y: number, z: number): V3 => [x, y, z];

  // ---------------------------------------------------------------- torso
  const hips = j('Hips'), chest = j('Chest'), neckJ = j('Neck'), headJ = j('Head');
  const cz = 0.035; // the body's middle front-to-back (the spine runs a little behind it)
  const torsoParts: Array<[SDF, number]> = [
    [ellipsoid(P(0, 0.935, cz - 0.005), P(0.158, 0.105, 0.103)), 0], // pelvis
    [ellipsoid(P(0, 1.02, cz + 0.01), P(0.137, 0.1, 0.098)), 0.05], // lower belly
    [ellipsoid(P(0, 1.1, cz), P(0.128, 0.09, 0.09)), 0.05], // waist
    [ellipsoid(P(0, 1.255, cz - 0.006), P(0.142, 0.15, 0.098)), 0.06], // ribcage
    [ellipsoid(P(0, 1.36, cz - 0.004), P(0.152, 0.085, 0.096)), 0.05], // upper chest
  ];
  for (const s of SIDES) {
    const k = sx(s);
    torsoParts.push(
      [ellipsoidIn(frame(P(k * 0.07, 1.33, cz + 0.05), P(-k * 0.35, 1, 0.05)), P(0.078, 0.05, 0.032)), 0.04], // pec
      [ellipsoidIn(frame(P(k * 0.106, 1.265, cz - 0.04), P(k * 0.25, 1, 0)), P(0.045, 0.1, 0.06)), 0.05], // lat
      [ellipsoid(P(k * 0.112, 1.075, cz + 0.005), P(0.035, 0.07, 0.07)), 0.05], // oblique
      [ellipsoid(P(k * 0.07, 0.886, cz - 0.07), P(0.083, 0.088, 0.068)), 0.05], // glute
      [roundCone(P(0, 1.475, cz - 0.03), P(k * 0.15, 1.44, cz - 0.02), 0.05, 0.034), 0.05], // trapezius
      [roundCone(P(k * 0.018, 1.445, cz + 0.065), P(k * 0.145, 1.455, cz + 0.03), 0.015, 0.018), 0.03], // collarbone
    );
  }
  let torso = blend(torsoParts);
  // the spine's groove down the back and the line down the middle of the belly
  torso = subtract(torso, roundCone(P(0, 0.98, cz - 0.107), P(0, 1.42, cz - 0.1), 0.007, 0.007), 0.025);
  torso = subtract(torso, roundCone(P(0, 1.03, cz + 0.112), P(0, 1.2, cz + 0.11), 0.004, 0.004), 0.02);

  // ---------------------------------------------------------------- neck
  const neckOuter = roundCone(P(0, 1.39, cz - 0.008), P(0, 1.63, cz + 0.012), 0.056, 0.051);
  const neckInner = roundCone(P(0, 1.4, cz - 0.006), P(0, 1.5, cz + 0.004), 0.056, 0.047);

  // ---------------------------------------------------------------- arms
  const arm = (s: Side): SDF => {
    const k = sx(s);
    const sh = j(`UpperArm${s}`), el = j(`LowerArm${s}`), wr = j(`Wrist${s}`);
    const along = (a: V3, b: V3, t: number) => lerp3(a, b, t);
    const ax = norm(sub(el, sh));
    const deltoid = ellipsoidIn(frame(add(sh, P(k * 0.012, 0.006, -0.002)), ax, P(0, 0, 1)), P(0.062, 0.07, 0.058));
    const upper = roundCone(sh, el, 0.05, 0.039);
    const biceps = ellipsoidIn(frame(add(along(sh, el, 0.48), P(0, -0.004, 0.017)), ax), P(0.035, 0.085, 0.036));
    const triceps = ellipsoidIn(frame(add(along(sh, el, 0.42), P(0, 0.006, -0.016)), ax), P(0.037, 0.09, 0.036));
    const elbow = sphere(add(el, P(0, 0, -0.008)), 0.036);
    const fax = norm(sub(wr, el));
    const fore = roundCone(el, add(wr, scale(fax, -0.01)), 0.04, 0.025);
    const flexor = ellipsoidIn(frame(add(along(el, wr, 0.27), P(0, -0.006, 0.006)), fax), P(0.042, 0.08, 0.034));
    const extensor = ellipsoidIn(frame(add(along(el, wr, 0.3), P(0, 0.01, -0.004)), fax), P(0.032, 0.075, 0.03));
    const wrist = ellipsoidIn(frame(add(wr, scale(fax, -0.012)), fax, P(0, 0, 1)), P(0.028, 0.022, 0.018));
    return blend([[deltoid, 0], [upper, 0.03], [biceps, 0.03], [triceps, 0.03], [elbow, 0.03], [fore, 0.035], [flexor, 0.035], [extensor, 0.03], [wrist, 0.025]]);
  };

  // ---------------------------------------------------------------- hands
  const hand = (s: Side): SDF => {
    const wr = j(`Wrist${s}`), el = j(`LowerArm${s}`);
    const fax = norm(sub(wr, el));
    const kn = (f: string) => j(`${f}2${s}`);
    const mid = j(`Middle2${s}`);
    const palmC = lerp3(wr, mid, 0.5);
    const palmLen = len(sub(mid, wr));
    // the palm's width runs from the index knuckle to the pinky knuckle
    const across = norm(sub(kn('Index'), kn('Pinky')));
    const palmF = frame(palmC, fax, across);
    const palm = roundBoxIn(palmF, P(0.017, palmLen * 0.52, 0.041), 0.016);
    const heel = ellipsoidIn(frame(add(lerp3(wr, mid, 0.22), scale(across, -0.012)), fax, across), P(0.02, 0.035, 0.033));
    const thenar = ellipsoidIn(frame(lerp3(j(`Thumb1${s}`), j(`Thumb2${s}`), 0.55), norm(sub(j(`Thumb2${s}`), j(`Thumb1${s}`))), across), P(0.019, 0.032, 0.02));
    const finger = (f: string, r: number): SDF => {
      const a = j(`${f}2${s}`), b = j(`${f}3${s}`), c = j(`${f}4${s}`);
      const tip = add(c, scale(norm(sub(c, b)), len(sub(c, b)) * 0.85));
      // knuckles a touch fatter than the bones between them
      return blend([[chain([a, b, c, tip], [r * 1.08, r, r * 0.92, r * 0.78], 0.004), 0], [sphere(b, r * 1.02), 0.004], [sphere(c, r * 0.95), 0.004]]);
    };
    const t1 = j(`Thumb1${s}`), t2 = j(`Thumb2${s}`), t3 = j(`Thumb3${s}`);
    const ttip = add(t3, scale(norm(sub(t3, t2)), 0.026));
    const thumb = chain([lerp3(t1, t2, 0.35), t2, t3, ttip], [0.014, 0.0115, 0.0105, 0.009], 0.004);
    const fingers = [finger('Index', 0.0098), finger('Middle', 0.0102), finger('Ring', 0.0096), finger('Pinky', 0.0084)];
    const parts: Array<[SDF, number]> = [[palm, 0], [heel, 0.012], [thenar, 0.012], [thumb, 0.012], ...fingers.map((f): [SDF, number] => [f, 0.009])];
    // a stub of forearm, so the hand piece tucks into the arm
    parts.push([roundCone(add(wr, scale(fax, -0.05)), add(wr, scale(fax, 0.005)), 0.026, 0.024), 0.015]);
    return blend(parts);
  };

  // ---------------------------------------------------------------- legs
  const leg = (s: Side): SDF => {
    const k = sx(s);
    const hip = j(`UpperLeg${s}`), knee = j(`LowerLeg${s}`), foot = j(`Foot${s}`);
    const ax = norm(sub(knee, hip));
    const ankle = P(foot[0], 0.09, foot[2] - 0.005);
    const hipTop = add(hip, P(k * 0.005, 0.02, -0.01));
    const thigh = roundCone(hipTop, knee, 0.088, 0.05);
    const quad = ellipsoidIn(frame(add(lerp3(hip, knee, 0.42), P(k * 0.006, 0, 0.026)), ax), P(0.06, 0.16, 0.05));
    const vmo = ellipsoidIn(frame(add(lerp3(hip, knee, 0.8), P(-k * 0.026, 0, 0.012)), ax), P(0.03, 0.055, 0.033));
    const ham = ellipsoidIn(frame(add(lerp3(hip, knee, 0.45), P(0, 0, -0.03)), ax), P(0.056, 0.15, 0.048));
    const adductor = ellipsoidIn(frame(add(lerp3(hip, knee, 0.22), P(-k * 0.035, -0.01, 0)), ax), P(0.045, 0.1, 0.05));
    const kneecap = ellipsoid(add(knee, P(0, 0.005, 0.038)), P(0.027, 0.03, 0.02));
    const sax = norm(sub(ankle, knee));
    const shin = roundCone(knee, ankle, 0.048, 0.031);
    const calf = ellipsoidIn(frame(add(lerp3(knee, ankle, 0.28), P(0, 0, -0.03)), sax), P(0.048, 0.1, 0.044));
    const calfIn = ellipsoidIn(frame(add(lerp3(knee, ankle, 0.32), P(-k * 0.016, 0, -0.026)), sax), P(0.03, 0.08, 0.034));
    const ankleBone = sphere(ankle, 0.034);
    const footShape = ellipsoidIn(frame(P(foot[0], 0.045, foot[2] + 0.05), P(0, 0, 1), P(0, 1, 0)), P(0.043, 0.12, 0.04));
    return blend([[thigh, 0], [quad, 0.04], [vmo, 0.03], [ham, 0.04], [adductor, 0.04], [kneecap, 0.025], [shin, 0.03], [calf, 0.035], [calfIn, 0.03], [ankleBone, 0.02], [footShape, 0.03]]);
  };

  // ---------------------------------------------------------------- head
  // The faceless head: a smooth egg (cranium, face, a soft chin and jaw) with plain ears and
  // no features at all. The face is a separate smooth plate over the front of it (`face`),
  // painted its own color: a blank mask.
  const HS = 1.07;
  const HC = P(0, headJ[1] + 0.1 * HS, cz + 0.012);
  const at = (x: number, y: number, z: number): V3 => [HC[0] + x * HS, HC[1] + y * HS, HC[2] + z * HS];
  const R = (x: number, y: number, z: number): V3 => [x * HS, y * HS, z * HS];
  // (no eyes are drawn: these mark where they would be, so hats, glasses and hair can be fitted)
  const eyeR = 0.0105 * HS;
  const eyeC: Record<Side, V3> = { L: at(0.031, 0.008, 0.066), R: at(-0.031, 0.008, 0.066) };
  const headParts: Array<[SDF, number]> = [
    [ellipsoid(at(0, 0.03, -0.012), R(0.075, 0.094, 0.095)), 0], // cranium
    [ellipsoid(at(0, -0.036, 0.022), R(0.063, 0.08, 0.077)), 0.04], // face
    [ellipsoid(at(0, -0.094, 0.056), R(0.031, 0.024, 0.028)), 0.034], // chin
  ];
  for (const s of SIDES) {
    const k = sx(s);
    headParts.push([ellipsoid(at(k * 0.042, -0.064, 0.008), R(0.02, 0.03, 0.038)), 0.045]); // jaw angle
  }
  let head = blend(headParts);
  // ears: plain shells (they carry earrings; most hair covers them)
  for (const s of SIDES) {
    const k = sx(s);
    const ec = at(k * 0.075, -0.006, -0.008);
    const ear = ellipsoidIn(frame(ec, P(0, 1, -0.2), P(k * 1, 0, 0.14)), R(0.018, 0.03, 0.0085));
    head = ((h) => (x: number, y: number, z: number) => smin(h(x, y, z), ear(x, y, z), 0.007))(head);
  }
  const headWithNeck = blend([[head, 0], [neckOuter, 0.035]]);
  // the head piece's neck runs down and rounds off inside the chest (its end never shows)
  const headPiece = headWithNeck;

  // the blank face: a smooth shell over the whole head down to the jaw and the nape (the neck
  // under it stays skin), standing a couple of millimetres proud with a clean edge
  const neckline = (x: number, y: number, z: number): number => {
    const ly = (y - HC[1]) / HS, lz = (z - HC[2]) / HS;
    // under the chin in front, rising under the jaw to the ear lobes, then level round the back
    const cut = lz >= -0.02 ? -0.113 + 0.82 * (0.062 - lz) : -0.046 - 0.25 * (-0.02 - lz);
    void x;
    return (cut - ly) * 0.75 * HS;
  };
  const face: SDF = (x, y, z) => {
    const h = head(x, y, z);
    return Math.max(h - 0.0026, -(h + 0.0014), neckline(x, y, z));
  };
  // the skin that shows: the neck, up to just inside the face shell's edge (nothing under the shell)
  const neckSkin: SDF = (x, y, z) => Math.max(headWithNeck(x, y, z), -neckline(x, y, z) - 0.004);

  // ---------------------------------------------------------------- assembly
  const armL = arm('L'), armR = arm('R'), legL = leg('L'), legR = leg('R');
  const handL = hand('L'), handR = hand('R');
  const shoulderBlend = 0.045, hipBlend = 0.05;
  const body: SDF = (x, y, z) => {
    let d = torso(x, y, z);
    d = smin(d, neckInner(x, y, z), 0.04);
    d = smin(d, x > 0 ? armL(x, y, z) : armR(x, y, z), shoulderBlend);
    // legs blend into the pelvis but not into each other
    const l = legL(x, y, z), r = legR(x, y, z);
    d = smin(d, x > 0 ? smin(l, r + 0.03, 0) : smin(r, l + 0.03, 0), hipBlend);
    return d;
  };
  const skin: SDF = (x, y, z) => {
    let d = smin(body(x, y, z), headWithNeck(x, y, z), 0.03);
    d = Math.min(d, x > 0 ? handL(x, y, z) : handR(x, y, z));
    return d;
  };

  // regions: nearest named part, with the limb boundaries at the joints
  const wrists: Record<Side, V3> = { L: j('WristL'), R: j('WristR') };
  const elbows: Record<Side, V3> = { L: j('LowerArmL'), R: j('LowerArmR') };
  const shoulders: Record<Side, V3> = { L: j('UpperArmL'), R: j('UpperArmR') };
  const knees: Record<Side, V3> = { L: j('LowerLegL'), R: j('LowerLegR') };
  const region = (x: number, y: number, z: number): Region => {
    const s: Side = x >= 0 ? 'L' : 'R';
    const k = sx(s);
    const ax = Math.abs(x);
    if (y > 1.445 && ax < 0.075) return y > headJ[1] + 0.01 && z > cz - 0.06 ? 'head' : 'neck';
    // along the arm
    if (ax > Math.abs(shoulders[s][0]) - 0.01 && y > 1.25) {
      if (ax * 1 >= Math.abs(wrists[s][0]) - 0.018) return 'hand';
      if (ax >= Math.abs(elbows[s][0])) return 'forearm';
      return ax > Math.abs(shoulders[s][0]) + 0.03 ? 'upperarm' : 'torso';
    }
    void k;
    if (y < 0.115) return 'foot';
    if (y < knees[s][1] + 0.01) return 'shin';
    // thighs start below the crotch / glute fold
    const legTop = 0.83 + Math.max(0, ax - 0.1) * 0.6;
    if (y < legTop) return 'thigh';
    return y < 0.99 ? 'hips' : 'torso';
  };
  void clamp;
  void smax;
  void intersect;
  void plane;
  void sphere;
  return {
    skin, body, head: headPiece, hand: { L: handL, R: handR },
    eyes: { center: eyeC, radius: eyeR, look: norm(P(0, -0.02, 1)) },
    region, sideOf: (x) => (x > 0.01 ? 1 : x < -0.01 ? -1 : 0), j, face, neckSkin, headCenter: HC, neck: neckOuter,
  };
  void chest; void neckJ; void hips;
}
