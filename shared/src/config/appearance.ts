/**
 * CHARACTER APPEARANCE — everything the Character Creator can set.
 *
 * Purely cosmetic: it never touches the simulation. It rides along in the roster (as a short
 * code, see `encodeAppearance`) so every client draws the same character.
 *
 * Every option has a stable id (saved data and the network use ids, never labels). Options
 * marked `available: false` are on the menu but have no art yet: they show as "coming soon"
 * and are rejected by `sanitizeAppearance`, so nobody can end up wearing them. Adding a new
 * option = append it to its list (never reorder: the wire code stores list positions) and
 * teach the client renderer to draw it.
 */

export interface LookOption {
  id: string;
  name: string;
  /** False = shown on the menu as "coming soon", never selectable. */
  available?: boolean;
  /** Swatch color (CSS hex) for color pickers. */
  color?: string;
}

const opt = (id: string, name: string, extra: Partial<LookOption> = {}): LookOption => ({ id, name, ...extra });
const soon = (id: string, name: string): LookOption => ({ id, name, available: false });

// ------------------------------------------------------------------ option lists
export const BODY_TYPES = [opt('masc', 'Masculine'), opt('fem', 'Feminine'), opt('neutral', 'Neutral')];
export const BUILDS = [opt('slim', 'Slim'), opt('average', 'Average'), opt('athletic', 'Athletic'), opt('heavy', 'Heavy')];
export const HEIGHTS = [opt('short', 'Short'), opt('average', 'Average'), opt('tall', 'Tall')];
export const SKIN_TONES = [
  opt('s01', 'Porcelain', { color: '#f7e0cf' }),
  opt('s02', 'Ivory', { color: '#f0cfb4' }),
  opt('s03', 'Light', { color: '#e6bd9c' }),
  opt('s04', 'Warm Beige', { color: '#d9a882' }),
  opt('s05', 'Sand', { color: '#c9956c' }),
  opt('s06', 'Golden', { color: '#b98258' }),
  opt('s07', 'Tan', { color: '#a56e46' }),
  opt('s08', 'Caramel', { color: '#8f5a37' }),
  opt('s09', 'Brown', { color: '#77482b' }),
  opt('s10', 'Deep Brown', { color: '#603821' }),
  opt('s11', 'Espresso', { color: '#4a2a18' }),
  opt('s12', 'Ebony', { color: '#361e11' }),
];

export const HEAD_SHAPES = [opt('round', 'Round'), opt('oval', 'Oval'), opt('square', 'Square'), opt('narrow', 'Narrow')];
export const FACE_SHAPES = [opt('soft', 'Soft'), opt('defined', 'Defined'), opt('wide', 'Wide'), opt('slim', 'Slim')];
export const EYE_SHAPES = [opt('small', 'Small'), opt('average', 'Average'), opt('large', 'Large'), opt('narrow', 'Narrow')];
export const EYE_COLORS = [
  opt('brown', 'Brown', { color: '#6b4226' }),
  opt('darkbrown', 'Dark Brown', { color: '#33200f' }),
  opt('blue', 'Blue', { color: '#3d82d6' }),
  opt('green', 'Green', { color: '#3f9150' }),
  opt('hazel', 'Hazel', { color: '#8d6c2c' }),
  opt('gray', 'Gray', { color: '#8e979e' }),
];
export const BROWS = [opt('thin', 'Thin'), opt('natural', 'Natural'), opt('thick', 'Thick'), opt('arched', 'Arched')];
export const NOSES = [opt('small', 'Small'), opt('average', 'Average'), opt('wide', 'Wide'), opt('narrow', 'Narrow')];
export const EARS = [opt('small', 'Small'), opt('average', 'Average'), opt('large', 'Large')];

/** Previewed on the Character screen only (never saved). */
export const EXPRESSIONS = [
  opt('neutral', 'Neutral'), opt('happy', 'Happy'), opt('angry', 'Angry'), opt('sad', 'Sad'),
  opt('serious', 'Serious'), opt('smirk', 'Smirk'), opt('surprised', 'Surprised'),
];

export const HAIRSTYLES = [
  opt('bald', 'Bald'),
  opt('buzz', 'Buzz Cut'),
  opt('lowfade', 'Low Fade'),
  opt('highfade', 'High Fade'),
  opt('waves', 'Waves'),
  opt('shortafro', 'Short Afro'),
  opt('largeafro', 'Large Afro'),
  opt('shortdreads', 'Short Dreads'),
  opt('longdreads', 'Long Dreads'),
  opt('braids', 'Braids'),
  opt('cornrows', 'Cornrows'),
  opt('curly', 'Curly Hair'),
  opt('straight', 'Straight Hair'),
  opt('ponytail', 'Ponytail'),
  opt('bun', 'Bun'),
  opt('bob', 'Bob Cut'),
  opt('spiky', 'Spiky Crop'),
  opt('mohawk', 'Mohawk'),
];
export const HAIR_COLORS = [
  opt('black', 'Black', { color: '#1b1714' }),
  opt('darkbrown', 'Dark Brown', { color: '#3d2617' }),
  opt('lightbrown', 'Light Brown', { color: '#7d5535' }),
  opt('blonde', 'Blonde', { color: '#d9b66d' }),
  opt('platinum', 'Platinum', { color: '#ece5d2' }),
  opt('red', 'Red', { color: '#a5251d' }),
  opt('ginger', 'Ginger', { color: '#c45a22' }),
  opt('gray', 'Gray', { color: '#8d8c89' }),
  opt('white', 'White', { color: '#f1f1ec' }),
  opt('blue', 'Blue', { color: '#2f5ed9' }),
  opt('pink', 'Pink', { color: '#ea5daa' }),
  opt('purple', 'Purple', { color: '#7d3fca' }),
];
export const FACIAL_HAIR = [
  opt('none', 'None'), opt('mustache', 'Mustache'), opt('goatee', 'Goatee'),
  opt('shortbeard', 'Short Beard'), opt('fullbeard', 'Full Beard'), opt('chinstrap', 'Chin Strap'),
];

export const LIPS = [opt('small', 'Small Lips'), opt('average', 'Average Lips'), opt('full', 'Full Lips'), opt('wide', 'Wide Mouth')];
export const MOUTH_ACCESSORIES = [
  opt('none', 'None'), opt('silvergrill', 'Silver Grill'), opt('goldgrill', 'Gold Grill'),
  opt('diamondgrill', 'Diamond Grill'), opt('lippiercing', 'Lip Piercing'), opt('lipring', 'Lip Ring'),
];
/** Something held in the mouth (lit smokes have a glowing tip and a trail of smoke). */
export const MOUTH_PROPS = [opt('none', 'Nothing'), opt('cigarette', 'Cigarette'), opt('darkmild', 'Dark & Mild'), opt('bottle', 'Baby Bottle')];
export const TEETH = [opt('natural', 'Natural'), opt('white', 'Bright White')];

export const TOPS = [
  soon('none', 'No Shirt'),
  opt('tee', 'Plain T-Shirt'),
  soon('oversized', 'Oversized T-Shirt'),
  opt('tank', 'Tank Top'),
  soon('longsleeve', 'Long Sleeve'),
  soon('polo', 'Polo'),
  opt('hoodie', 'Hoodie'),
  soon('ziphoodie', 'Zip-Up Hoodie'),
  soon('sweatshirt', 'Sweatshirt'),
  soon('buttonup', 'Button-Up Shirt'),
  opt('crop', 'Crop Top'),
  soon('jersey', 'Jersey'),
  soon('jacket', 'Jacket'),
  opt('puffer', 'Puffer Jacket'),
];
export const TOP_COLORS = [
  opt('black', 'Black', { color: '#1e1e22' }),
  opt('white', 'White', { color: '#ececea' }),
  opt('gray', 'Gray', { color: '#8b8e93' }),
  opt('red', 'Red', { color: '#c52c2c' }),
  opt('blue', 'Blue', { color: '#2f66d8' }),
  opt('green', 'Green', { color: '#2f8c49' }),
  opt('yellow', 'Yellow', { color: '#f2c232' }),
  opt('orange', 'Orange', { color: '#ee7b24' }),
  opt('purple', 'Purple', { color: '#7b43c7' }),
  opt('pink', 'Pink', { color: '#e86ba7' }),
  opt('brown', 'Brown', { color: '#6f4b30' }),
  opt('beige', 'Beige', { color: '#d7c3a1' }),
];
export const BOTTOMS = [
  opt('slimjeans', 'Slim Jeans'),
  opt('baggyjeans', 'Baggy Jeans'),
  opt('jeans', 'Regular Jeans'),
  opt('cargo', 'Cargo Pants'),
  soon('sweatpants', 'Sweatpants'),
  soon('joggers', 'Joggers'),
  opt('shorts', 'Shorts'),
  soon('bballshorts', 'Basketball Shorts'),
  opt('leggings', 'Leggings'),
  soon('skirt', 'Skirt'),
];
export const BOTTOM_COLORS = [
  opt('black', 'Black', { color: '#1e1e22' }),
  opt('white', 'White', { color: '#ececea' }),
  opt('gray', 'Gray', { color: '#8b8e93' }),
  opt('blue', 'Blue', { color: '#3e67b4' }),
  opt('darkblue', 'Dark Blue', { color: '#1f2d52' }),
  opt('brown', 'Brown', { color: '#6f4b30' }),
  opt('beige', 'Beige', { color: '#d7c3a1' }),
  opt('red', 'Red', { color: '#c52c2c' }),
  opt('green', 'Green', { color: '#2f8c49' }),
  opt('pink', 'Pink', { color: '#e86ba7' }),
];
export const SHOES = [
  soon('barefoot', 'Barefoot'),
  opt('lowtops', 'Low-Top Sneakers'),
  soon('hightops', 'High-Top Sneakers'),
  soon('bball', 'Basketball Sneakers'),
  opt('running', 'Running Shoes'),
  opt('boots', 'Boots'),
  soon('workboots', 'Work Boots'),
  soon('slides', 'Slides'),
  soon('sandals', 'Sandals'),
  soon('dress', 'Dress Shoes'),
  opt('chunky', 'Chunky Sneakers'),
];
export const SHOE_COLORS = [
  opt('black', 'Black', { color: '#1e1e22' }),
  opt('white', 'White', { color: '#ececea' }),
  opt('red', 'Red', { color: '#c52c2c' }),
  opt('blue', 'Blue', { color: '#2f66d8' }),
  opt('gray', 'Gray', { color: '#8b8e93' }),
  opt('brown', 'Brown', { color: '#6f4b30' }),
  opt('green', 'Green', { color: '#2f8c49' }),
  opt('pink', 'Pink', { color: '#e86ba7' }),
];

export const HATS = [
  opt('none', 'None'), opt('capfwd', 'Baseball Cap Forward'), opt('capback', 'Baseball Cap Backward'),
  opt('beanie', 'Beanie'), opt('bucket', 'Bucket Hat'), opt('durag', 'Durag'),
  opt('bandana', 'Bandana'), opt('headband', 'Headband'), opt('cowboy', 'Cowboy Hat'),
  opt('skimask', 'Ski Mask'), opt('hoodup', 'Hood Up'), opt('spikyhood', 'Spiky Hood'),
];
export const GLASSES = [
  opt('none', 'None'), opt('clear', 'Clear Glasses'), opt('sunglasses', 'Black Sunglasses'),
  opt('aviators', 'Aviators'), opt('round', 'Round Glasses'), opt('tinted', 'Tinted Glasses'),
];
export const EARRINGS = [opt('none', 'None'), opt('studs', 'Small Studs'), opt('diamondstuds', 'Diamond Studs'), opt('hoops', 'Hoops'), opt('dangling', 'Dangling Earrings')];
export const NECKLACES = [
  opt('none', 'None'), opt('thingold', 'Thin Gold Chain'), opt('thickgold', 'Thick Gold Chain'),
  opt('silver', 'Silver Chain'), opt('diamond', 'Diamond Chain'), opt('pendant', 'Pendant Necklace'),
  opt('choker', 'Choker'),
];
export const WRIST = [opt('none', 'None'), opt('watch', 'Watch'), opt('goldwatch', 'Gold Watch'), opt('bracelet', 'Bracelet'), opt('wristbands', 'Wristbands')];
export const FACE_ACCESSORIES = [opt('none', 'None'), opt('nosestud', 'Nose Stud'), opt('nosering', 'Nose Ring'), opt('browpiercing', 'Eyebrow Piercing')];

export const TATTOO_SPOTS = [
  opt('larm', 'Left Arm'), opt('rarm', 'Right Arm'), opt('neck', 'Neck'),
  opt('chest', 'Chest'), opt('lleg', 'Left Leg'), opt('rleg', 'Right Leg'),
];
export const TATTOO_DESIGNS = [
  soon('tribal', 'Tribal'), soon('lettering', 'Lettering'), soon('star', 'Star'),
  soon('rose', 'Rose'), soon('skull', 'Skull'), soon('abstract', 'Abstract'),
];
export const BODY_DETAILS = [opt('freckles', 'Freckles'), opt('scar', 'Facial Scar'), opt('beautymark', 'Beauty Mark')];

// ------------------------------------------------------------------ the saved configuration

export interface Appearance {
  bodyType: string;
  build: string;
  height: string;
  skin: string;
  headShape: string;
  faceShape: string;
  eyes: string;
  eyeColor: string;
  brows: string;
  nose: string;
  ears: string;
  hair: string;
  hairColor: string;
  facialHair: string;
  facialHairColor: string;
  lips: string;
  mouthAcc: string;
  mouthProp: string;
  teeth: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoeColor: string;
  hat: string;
  glasses: string;
  earrings: string;
  necklace: string;
  wrist: string;
  faceAcc: string;
  /** One design per body spot (spot id -> design id). */
  tattoos: Record<string, string>;
  /** Freckles / scar / beauty mark (any combination). */
  details: string[];
}

/** Every single-choice field with its option list, in wire order (append only). */
export const LOOK_FIELDS = {
  bodyType: BODY_TYPES,
  build: BUILDS,
  height: HEIGHTS,
  skin: SKIN_TONES,
  headShape: HEAD_SHAPES,
  faceShape: FACE_SHAPES,
  eyes: EYE_SHAPES,
  eyeColor: EYE_COLORS,
  brows: BROWS,
  nose: NOSES,
  ears: EARS,
  hair: HAIRSTYLES,
  hairColor: HAIR_COLORS,
  facialHair: FACIAL_HAIR,
  facialHairColor: HAIR_COLORS,
  lips: LIPS,
  mouthAcc: MOUTH_ACCESSORIES,
  mouthProp: MOUTH_PROPS,
  teeth: TEETH,
  top: TOPS,
  topColor: TOP_COLORS,
  bottom: BOTTOMS,
  bottomColor: BOTTOM_COLORS,
  shoes: SHOES,
  shoeColor: SHOE_COLORS,
  hat: HATS,
  glasses: GLASSES,
  earrings: EARRINGS,
  necklace: NECKLACES,
  wrist: WRIST,
  faceAcc: FACE_ACCESSORIES,
} as const;
export type LookField = keyof typeof LOOK_FIELDS;
export const LOOK_FIELD_KEYS = Object.keys(LOOK_FIELDS) as LookField[];

export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({
  bodyType: 'masc',
  build: 'average',
  height: 'average',
  skin: 's05',
  headShape: 'oval',
  faceShape: 'defined',
  eyes: 'average',
  eyeColor: 'brown',
  brows: 'natural',
  nose: 'average',
  ears: 'average',
  hair: 'shortdreads',
  hairColor: 'black',
  facialHair: 'none',
  facialHairColor: 'darkbrown',
  lips: 'average',
  mouthAcc: 'none',
  mouthProp: 'none',
  teeth: 'natural',
  top: 'puffer',
  topColor: 'black',
  bottom: 'baggyjeans',
  bottomColor: 'gray',
  shoes: 'chunky',
  shoeColor: 'white',
  hat: 'beanie',
  glasses: 'none',
  earrings: 'diamondstuds',
  necklace: 'diamond',
  wrist: 'none',
  faceAcc: 'none',
  tattoos: Object.freeze({}) as Record<string, string>,
  details: Object.freeze([]) as unknown as string[],
});

export function cloneAppearance(a: Readonly<Appearance>): Appearance {
  return { ...a, tattoos: { ...a.tattoos }, details: [...a.details] };
}

function isPick(list: readonly LookOption[], id: unknown): id is string {
  return typeof id === 'string' && list.some((o) => o.id === id && o.available !== false);
}

/** The three outfits players had before the Character Creator (old saves name one of them). */
const LEGACY_BODIES: Record<string, Partial<Appearance>> = {
  hoodie: {},
  punk: {
    bodyType: 'fem', hair: 'mohawk', hairColor: 'pink', top: 'crop', topColor: 'pink', bottom: 'slimjeans',
    bottomColor: 'black', shoes: 'boots', shoeColor: 'black', necklace: 'choker', wrist: 'wristbands', lips: 'small',
  },
  casual: { hair: 'ponytail', top: 'tee', topColor: 'beige', bottom: 'jeans', bottomColor: 'darkblue', shoes: 'running', shoeColor: 'red' },
};

/**
 * Cleans an untrusted appearance (from storage or the network). Unknown or unavailable ids
 * fall back field by field, so a partly valid look keeps its valid parts. Also accepts the
 * pre-creator `{ body, mouth }` format and wire codes.
 */
export function sanitizeAppearance(raw: unknown, fallback: Readonly<Appearance> = DEFAULT_APPEARANCE): Appearance {
  if (typeof raw === 'string') return decodeAppearance(raw, fallback);
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = cloneAppearance(fallback);
  if (typeof r.body === 'string' && LEGACY_BODIES[r.body] && r.top === undefined) {
    Object.assign(out, cloneAppearance(DEFAULT_APPEARANCE), LEGACY_BODIES[r.body]);
  }
  if (r.mouth !== undefined && r.mouthProp === undefined && isPick(MOUTH_PROPS, r.mouth)) out.mouthProp = r.mouth;
  for (const key of LOOK_FIELD_KEYS) if (isPick(LOOK_FIELDS[key], r[key])) out[key] = r[key] as string;
  if (r.tattoos && typeof r.tattoos === 'object' && !Array.isArray(r.tattoos)) {
    out.tattoos = {};
    for (const [spot, design] of Object.entries(r.tattoos as Record<string, unknown>)) {
      if (isPick(TATTOO_SPOTS, spot) && isPick(TATTOO_DESIGNS, design)) out.tattoos[spot] = design;
    }
  }
  if (Array.isArray(r.details)) {
    out.details = BODY_DETAILS.map((d) => d.id).filter((id) => (r.details as unknown[]).includes(id));
  }
  return out;
}

export function sameAppearance(a: Readonly<Appearance>, b: Readonly<Appearance>): boolean {
  return encodeAppearance(a) === encodeAppearance(b);
}

// ------------------------------------------------------------------ compact wire code
const CODE_PREFIX = 'L1';
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A short code for the network (~40 characters): one base-36 digit per field (its position in
 * the option list), then one per tattoo spot (0 = none) and a bitmask of the body details.
 */
export function encodeAppearance(a: Readonly<Appearance>): string {
  let s = CODE_PREFIX;
  for (const key of LOOK_FIELD_KEYS) s += B36[Math.max(0, LOOK_FIELDS[key].findIndex((o) => o.id === a[key]))];
  for (const spot of TATTOO_SPOTS) s += B36[TATTOO_DESIGNS.findIndex((d) => d.id === a.tattoos[spot.id]) + 1];
  let mask = 0;
  BODY_DETAILS.forEach((d, i) => {
    if (a.details.includes(d.id)) mask |= 1 << i;
  });
  return s + B36[mask];
}

/** Reads a wire code back; anything malformed or unavailable falls back (field by field). */
export function decodeAppearance(code: unknown, fallback: Readonly<Appearance> = DEFAULT_APPEARANCE): Appearance {
  const out = cloneAppearance(fallback);
  if (typeof code !== 'string' || !code.startsWith(CODE_PREFIX) || code.length > 80) return out;
  const digits = code.slice(CODE_PREFIX.length);
  const at = (i: number): number => (i < digits.length ? B36.indexOf(digits[i]) : -1);
  LOOK_FIELD_KEYS.forEach((key, i) => {
    const o = LOOK_FIELDS[key][at(i)];
    if (o && o.available !== false) out[key] = o.id;
  });
  let i = LOOK_FIELD_KEYS.length;
  out.tattoos = {};
  for (const spot of TATTOO_SPOTS) {
    const d = TATTOO_DESIGNS[at(i++) - 1];
    if (d && d.available !== false) out.tattoos[spot.id] = d.id;
  }
  const mask = at(i);
  out.details = mask > 0 ? BODY_DETAILS.filter((_d, k) => mask & (1 << k)).map((d) => d.id) : [];
  return out;
}

// ------------------------------------------------------------------ random looks
/** Small seeded PRNG (mulberry32) so bot looks are stable without touching the match RNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom(list: readonly LookOption[], rand: () => number, weights?: Record<string, number>): string {
  const ok = list.filter((o) => o.available !== false);
  let total = 0;
  for (const o of ok) total += weights?.[o.id] ?? 1;
  let r = rand() * total;
  for (const o of ok) {
    r -= weights?.[o.id] ?? 1;
    if (r <= 0) return o.id;
  }
  return ok[ok.length - 1].id;
}

/** A complete random character that looks put together (accessories are the exception, not the rule). */
export function randomAppearance(rand: () => number = Math.random): Appearance {
  const a = cloneAppearance(DEFAULT_APPEARANCE);
  a.bodyType = pickFrom(BODY_TYPES, rand, { masc: 4, fem: 4, neutral: 2 });
  const fem = a.bodyType === 'fem';
  a.build = pickFrom(BUILDS, rand, { slim: 2, average: 4, athletic: 3, heavy: 2 });
  a.height = pickFrom(HEIGHTS, rand, { short: 1, average: 2, tall: 1 });
  a.skin = pickFrom(SKIN_TONES, rand);
  a.headShape = pickFrom(HEAD_SHAPES, rand);
  a.faceShape = pickFrom(FACE_SHAPES, rand);
  a.eyes = pickFrom(EYE_SHAPES, rand, { average: 3 });
  a.eyeColor = pickFrom(EYE_COLORS, rand, { brown: 4, darkbrown: 4 });
  a.brows = pickFrom(BROWS, rand, { natural: 3 });
  a.nose = pickFrom(NOSES, rand, { average: 3 });
  a.ears = pickFrom(EARS, rand, { average: 3 });
  a.hair = pickFrom(HAIRSTYLES, rand, fem ? { buzz: 0.4, lowfade: 0.4, highfade: 0.4, waves: 0.4, bald: 0.2 } : { bob: 0.3, bun: 0.4, ponytail: 0.6 });
  a.hairColor = pickFrom(HAIR_COLORS, rand, { black: 5, darkbrown: 5, lightbrown: 3, blonde: 2, red: 1, ginger: 1, gray: 0.6, white: 0.4, platinum: 0.6, blue: 0.5, pink: 0.5, purple: 0.5 });
  a.facialHair = fem ? 'none' : pickFrom(FACIAL_HAIR, rand, { none: 5 });
  a.facialHairColor = rand() < 0.8 && !['blue', 'pink', 'purple', 'platinum'].includes(a.hairColor) ? a.hairColor : pickFrom(HAIR_COLORS, rand, { black: 4, darkbrown: 4 });
  a.lips = pickFrom(LIPS, rand, { average: 3 });
  a.mouthAcc = pickFrom(MOUTH_ACCESSORIES, rand, { none: 14 });
  a.mouthProp = pickFrom(MOUTH_PROPS, rand, { none: 6 });
  a.teeth = pickFrom(TEETH, rand);
  // street sketchbook: puffers and hoodies, baggy denim and cargos, chunky sneakers, masks and hoods
  a.top = pickFrom(TOPS, rand, { puffer: 4, hoodie: 3.5, tee: 2, tank: 0.8, crop: fem ? 1 : 0.2 });
  a.topColor = pickFrom(TOP_COLORS, rand, { black: 5, white: 2, gray: 2.5, red: 1.5, pink: 1.2, green: 1, brown: 1, beige: 1 });
  a.bottom = pickFrom(BOTTOMS, rand, { baggyjeans: 5, cargo: 3.5, jeans: 1, slimjeans: 0.8, shorts: 0.5, leggings: fem ? 0.6 : 0.1 });
  a.bottomColor = pickFrom(BOTTOM_COLORS, rand, { black: 4, gray: 3, blue: 2.5, darkblue: 2.5, beige: 1.2, green: 0.8, pink: 0.4, white: 0.6 });
  a.shoes = pickFrom(SHOES, rand, { chunky: 5, boots: 2, lowtops: 1, running: 1 });
  a.shoeColor = pickFrom(SHOE_COLORS, rand, { white: 4, black: 4, gray: 1.5, red: 1 });
  a.hat = pickFrom(HATS, rand, { none: 5, beanie: 3, skimask: 1.4, hoodup: 1.8, spikyhood: 0.8, capfwd: 1, capback: 1, durag: 1, bucket: 0.8, cowboy: 0.1, headband: 0.3 });
  a.glasses = pickFrom(GLASSES, rand, { none: 7, sunglasses: 2.5, tinted: 1 });
  a.earrings = pickFrom(EARRINGS, rand, { none: fem ? 3 : 5, diamondstuds: 3 });
  a.necklace = pickFrom(NECKLACES, rand, { none: 4, diamond: 2.5, silver: 2, thickgold: 1.2 });
  a.wrist = pickFrom(WRIST, rand, { none: 6 });
  a.faceAcc = pickFrom(FACE_ACCESSORIES, rand, { none: 14 });
  a.details = BODY_DETAILS.filter(() => rand() < 0.12).map((d) => d.id);
  return a;
}

/**
 * A stable look for a bot, derived from its name and slot (not the match RNG, so adding
 * looks leaves the simulation's random sequence untouched).
 */
export function botAppearance(name: string, idx: number): Appearance {
  let h = 2166136261 ^ idx;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return randomAppearance(seededRandom(h >>> 0));
}
