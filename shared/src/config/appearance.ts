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
  /**
   * Sold at AJ's: only players who own the item that unlocks it may wear it (the server strips
   * it from everyone else's look). Never offered in the free creator or to bots.
   */
  premium?: boolean;
  /** Premium finishes: shiny metal (0..1) and a procedural print (see the client's palette). */
  metal?: number;
  pattern?: string;
}

import { GUN_IDS, type WeaponId } from './weapons';

const opt = (id: string, name: string, extra: Partial<LookOption> = {}): LookOption => ({ id, name, ...extra });
/** An AJ's exclusive (premium) option. */
const aj = (id: string, name: string, extra: Partial<LookOption> = {}): LookOption => ({ id, name, premium: true, ...extra });
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
  opt('twists', 'Twists'),
  opt('locs', 'Locs'),
  opt('spikylocs', 'Spiky Locs'),
  opt('wicks', 'Wicks'),
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
  opt('ziphoodie', 'Zip-Up Hoodie'),
  soon('sweatshirt', 'Sweatshirt'),
  soon('buttonup', 'Button-Up Shirt'),
  opt('crop', 'Crop Top'),
  soon('jersey', 'Jersey'),
  soon('jacket', 'Jacket'),
  opt('puffer', 'Puffer Jacket'),
  opt('puffervest', 'Puffer Vest'),
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
  // AJ's exclusives
  aj('gold', 'Gold Foil', { color: '#d4a32a', metal: 0.75 }),
  aj('ice', 'Pearl White', { color: '#eef3f7', metal: 0.25 }),
  aj('camo', 'Woodland Camo', { color: '#5b6b3a', pattern: 'camo' }),
  aj('tiedye', 'Tie-Dye', { color: '#d45cc4', pattern: 'tiedye' }),
  aj('flames', 'Flames', { color: '#1e1e22', pattern: 'flames' }),
  aj('midnight', 'Midnight Sheen', { color: '#2a2146', metal: 0.45 }),
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
  // AJ's exclusives
  aj('camo', 'Woodland Camo', { color: '#5b6b3a', pattern: 'camo' }),
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
  // AJ's exclusives
  aj('gold24k', '24K Gold', { color: '#d4a32a', metal: 0.85 }),
  aj('bred', 'Bred', { color: '#c0232b', pattern: 'bred' }),
  aj('icy', 'Icy Blue', { color: '#9fd6f2', metal: 0.35 }),
  aj('volt', 'Volt', { color: '#c8ff2e' }),
  aj('galaxy', 'Galaxy', { color: '#3a2a6e', pattern: 'galaxy' }),
];

export const HATS = [
  opt('none', 'None'), opt('capfwd', 'Baseball Cap Forward'), opt('capback', 'Baseball Cap Backward'),
  opt('beanie', 'Beanie'), opt('bucket', 'Bucket Hat'), opt('durag', 'Durag'),
  opt('bandana', 'Bandana'), opt('headband', 'Headband'), opt('cowboy', 'Cowboy Hat'),
  opt('skimask', 'Ski Mask'), opt('hoodup', 'Hood Up'), opt('spikyhood', 'Spiky Hood'),
  opt('graffitibeanie', 'Graffiti Beanie'), opt('blackbucket', 'Black Bucket Hat'),
];
export const GLASSES = [
  opt('none', 'None'), opt('clear', 'Clear Glasses'), opt('sunglasses', 'Black Sunglasses'),
  opt('aviators', 'Aviators'), opt('round', 'Round Glasses'), opt('tinted', 'Tinted Glasses'),
];
export const EARRINGS = [
  opt('none', 'None'), opt('studs', 'Small Studs'), opt('diamondstuds', 'Diamond Studs'), opt('hoops', 'Hoops'), opt('dangling', 'Dangling Earrings'),
  aj('diamondhoops', 'Diamond Hoops'),
];
/** AJ's only: wraps for every gun you hold (cosmetic, no effect on any weapon). */
export const WEAPON_SKINS = [
  opt('none', 'Factory'),
  aj('gold', '24K Gold Wrap'), aj('camo', 'Woodland Wrap'), aj('neon', 'Neon Stripe'), aj('chrome', 'Mirror Chrome'), aj('graffiti', 'Graffiti Wrap'),
];
/** AJ's only: something on your back. */
export const BACKPACKS = [opt('none', 'None'), aj('schoolbag', 'Black School Pack'), aj('designer', 'Monogram Pack'), aj('camopack', 'Camo Pack')];
export const NECKLACES = [
  opt('none', 'None'), opt('thingold', 'Thin Gold Chain'), opt('thickgold', 'Thick Gold Chain'),
  opt('silver', 'Silver Chain'), opt('diamond', 'Diamond Chain'), opt('pendant', 'Pendant Necklace'),
  opt('choker', 'Choker'),
  aj('cuban', 'Cuban Link Chain'), aj('wtpendant', 'Iced WT Pendant'),
  opt('silverstack', 'Stacked Silver Chains'), opt('medallion', 'Silver Medallion'),
  opt('icedpendant', 'Chain + Round Pendant'),
];
export const WRIST = [
  opt('none', 'None'), opt('watch', 'Watch'), opt('goldwatch', 'Gold Watch'), opt('bracelet', 'Bracelet'), opt('wristbands', 'Wristbands'),
  aj('icedwatch', 'Iced-Out Watch'), aj('gloves', 'Shooter Gloves'),
  opt('blackgloves', 'Black Gloves'), opt('silverwatch', 'Silver Watch'),
  opt('glovewatches', 'Black Gloves + Two Watches'),
];
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

/** Every gun's own skin (`gs_<gun id>`: an option id of GUN_SKINS). */
type GunSkinFields = { [K in GunSkinField]: string };

export interface Appearance extends GunSkinFields {
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
  /** AJ's: weapon wrap (cosmetic only) and backpack. */
  weaponSkin: string;
  backpack: string;
  /** Shoulder width, head size, a face covering, something in hand in menus, a pants chain. */
  shoulders: string;
  headSize: string;
  mask: string;
  carry: string;
  waistChain: string;
  /** `face`: the color of the old blank face (no longer drawn; kept so saved looks read back); a face tattoo, a studded belt, a graphic on the pants. */
  face: string;
  faceMark: string;
  belt: string;
  legPrint: string;
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

/**
 * Fields added with AJ's. They are written after the original code (so looks saved before
 * them still read back exactly) and are not rows in the free creator: TRAP equips them.
 */
export const SHOULDERS = [opt('average', 'Average'), opt('narrow', 'Narrow'), opt('broad', 'Broad')];
export const HEAD_SIZES = [opt('average', 'Average'), opt('small', 'Small'), opt('large', 'Large')];
export const MASKS = [opt('none', 'None'), opt('facemask', 'Black Face Mask'), opt('bandanamask', 'Bandana Mask')];
export const CARRY = [opt('none', 'Nothing'), opt('phone', 'Smartphone')];
export const WAIST_CHAINS = [opt('none', 'None'), opt('silver', 'Silver Pants Chain')];
/** The color of the blank face from the faceless days (not drawn any more: the face is skin; kept for the wire code). */
export const FACES = [
  opt('gray', 'Gray', { color: '#b4b6bb' }), opt('white', 'Bone White', { color: '#ecebe6' }), opt('black', 'Black', { color: '#202024' }),
  opt('skin', 'Skin Tone', { color: '#8a5a3c' }), opt('red', 'Red', { color: '#b7262b' }), opt('blue', 'Blue', { color: '#2c5fd0' }),
];
/** A small face tattoo on the forehead or cheek. */
export const FACE_MARKS = [opt('none', 'None'), opt('star', 'Star'), opt('cross', 'Cross'), opt('tears', 'Teardrops'), opt('bolt', 'Lightning Bolt')];
/** A studded belt on the pants (with the boxers' waistband showing above it). */
export const BELTS = [
  opt('none', 'None'), opt('redstuds', 'Red Studded Belt'), opt('blackstuds', 'Black Studded Belt'), opt('whitestuds', 'White Studded Belt'),
];
/**
 * Skins for one gun at a time (bought with GRAMS in the gun picker; cosmetic only). Each gun
 * has its own field (`gs_<gun id>`); a gun with no skin of its own wears the AJ'S wrap.
 */
export const GUN_SKINS = [
  opt('none', 'Factory'),
  aj('gold', '24K Gold'), aj('chrome', 'Mirror Chrome'), aj('ice', 'Iced Out'), aj('graffiti', 'Graffiti'), aj('neon', 'Neon Stripe'), aj('camo', 'Woodland'),
];
export type GunSkinField = `gs_${Exclude<WeaponId, 'fists' | 'knife'>}`;
/** The look field holding a gun's own skin. */
export function gunSkinField(gun: string): GunSkinField {
  return `gs_${gun}` as GunSkinField;
}
const GUN_SKIN_FIELDS = Object.fromEntries(GUN_IDS.map((g) => [gunSkinField(g), GUN_SKINS])) as Record<GunSkinField, typeof GUN_SKINS>;

/** A graphic on the left thigh of long pants. */
export const LEG_PRINTS = [opt('none', 'None'), opt('gocrazy', 'Go Crazy + Scorpion'), opt('flames', 'Flames'), opt('stars', 'Stars')];

/**
 * Fields added after the original creator. They are written after the original code (so looks
 * saved before them still read back exactly); append new fields at the end, never reorder.
 * weaponSkin and backpack are AJ's items (equipped in TRAP); the rest are creator rows.
 */
export const EXTRA_FIELDS = {
  weaponSkin: WEAPON_SKINS, backpack: BACKPACKS, shoulders: SHOULDERS, headSize: HEAD_SIZES, mask: MASKS, carry: CARRY, waistChain: WAIST_CHAINS,
  face: FACES, faceMark: FACE_MARKS, belt: BELTS, legPrint: LEG_PRINTS,
  // one per gun, in GUN_IDS order (append only)
  ...GUN_SKIN_FIELDS,
} as const;
export type ExtraField = keyof typeof EXTRA_FIELDS;
export const EXTRA_FIELD_KEYS = Object.keys(EXTRA_FIELDS) as ExtraField[];

/** Every option list by field, the AJ's extras included. */
export function optionsOf(field: string): readonly LookOption[] | null {
  return (LOOK_FIELDS as Record<string, readonly LookOption[]>)[field] ?? (EXTRA_FIELDS as Record<string, readonly LookOption[]>)[field] ?? null;
}

/** Is this option an AJ's exclusive? */
export function isPremiumOption(field: string, option: string): boolean {
  return !!optionsOf(field)?.find((o) => o.id === option)?.premium;
}

/**
 * Takes off every AJ's exclusive the player does not own (`owned` = "field:option" keys).
 * Each stripped field goes back to the fallback look's value (or the default when that is
 * premium too), so nobody wears what they have not bought.
 */
export function stripUnowned(look: Readonly<Appearance>, owned: ReadonlySet<string>, fallback: Readonly<Appearance> = DEFAULT_APPEARANCE): Appearance {
  const out = cloneAppearance(look);
  const rec = out as unknown as Record<string, string>;
  for (const field of [...LOOK_FIELD_KEYS, ...EXTRA_FIELD_KEYS] as string[]) {
    const v = rec[field];
    if (!isPremiumOption(field, v) || owned.has(`${field}:${v}`)) continue;
    const fb = (fallback as unknown as Record<string, string>)[field];
    rec[field] = fb && (!isPremiumOption(field, fb) || owned.has(`${field}:${fb}`)) ? fb : (DEFAULT_APPEARANCE as unknown as Record<string, string>)[field];
  }
  return out;
}

/**
 * The look everyone starts with: the blank gray face, big spiky locs, a black hooded puffer,
 * very wide stacked black pants with the blue graphic, a red studded belt, a chain with a
 * round pendant, black gloves with a watch on each wrist, and clean white low-tops.
 */
export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({
  bodyType: 'masc',
  build: 'average',
  height: 'average',
  skin: 's10',
  headShape: 'oval',
  faceShape: 'defined',
  eyes: 'average',
  eyeColor: 'brown',
  brows: 'natural',
  nose: 'average',
  ears: 'average',
  hair: 'spikylocs',
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
  bottomColor: 'black',
  shoes: 'lowtops',
  shoeColor: 'white',
  hat: 'none',
  glasses: 'none',
  earrings: 'none',
  necklace: 'icedpendant',
  wrist: 'glovewatches',
  faceAcc: 'none',
  weaponSkin: 'none',
  backpack: 'none',
  shoulders: 'average',
  headSize: 'average',
  mask: 'none',
  carry: 'none',
  waistChain: 'none',
  face: 'gray',
  faceMark: 'none',
  belt: 'redstuds',
  legPrint: 'gocrazy',
  ...(Object.fromEntries(GUN_IDS.map((g) => [gunSkinField(g), 'none'])) as Record<GunSkinField, string>),
  tattoos: Object.freeze({}) as Record<string, string>,
  details: Object.freeze([]) as unknown as string[],
});

/**
 * The starter looks from before the faceless character (the old default, and what its two
 * presets set). A saved look that is still one of these was never really customized: it moves
 * to the new default look instead of keeping the old outfit. Customized looks are left alone.
 */
const OLD_STARTERS: ReadonlyArray<Record<string, string>> = [
  {
    bodyType: 'masc', build: 'average', height: 'average', skin: 's05', headShape: 'oval', faceShape: 'defined', eyes: 'average', eyeColor: 'brown',
    brows: 'natural', nose: 'average', ears: 'average', hair: 'shortdreads', hairColor: 'black', facialHair: 'none', lips: 'average', mouthAcc: 'none',
    top: 'puffer', topColor: 'black', bottom: 'baggyjeans', bottomColor: 'gray', shoes: 'chunky', shoeColor: 'white', hat: 'beanie', glasses: 'none',
    earrings: 'diamondstuds', necklace: 'diamond', wrist: 'none', faceAcc: 'none', shoulders: 'average', headSize: 'average', mask: 'none', waistChain: 'none',
  },
  {
    bodyType: 'masc', build: 'athletic', skin: 's08', hair: 'shortdreads', hairColor: 'black', facialHair: 'none',
    hat: 'blackbucket', mask: 'facemask', top: 'puffervest', topColor: 'black', necklace: 'medallion', wrist: 'blackgloves',
    bottom: 'cargo', bottomColor: 'black', shoes: 'chunky', shoeColor: 'black', earrings: 'none', glasses: 'none', waistChain: 'none',
  },
  {
    bodyType: 'masc', build: 'average', skin: 's09', hair: 'braids', hairColor: 'black', facialHair: 'goatee', facialHairColor: 'black',
    hat: 'graffitibeanie', mask: 'none', top: 'ziphoodie', topColor: 'black', necklace: 'silverstack', wrist: 'silverwatch', earrings: 'diamondstuds',
    bottom: 'baggyjeans', bottomColor: 'black', shoes: 'lowtops', shoeColor: 'red', glasses: 'none', waistChain: 'silver',
  },
];
function isOldStarter(look: Readonly<Appearance>): boolean {
  const rec = look as unknown as Record<string, string>;
  return OLD_STARTERS.some((st) => Object.entries(st).every(([k, v]) => rec[k] === v));
}
/** A look saved before the faceless character: an untouched old starter becomes the new default (AJ's items stay on). */
function upgradeOldLook(look: Appearance): Appearance {
  if (!isOldStarter(look)) return look;
  const out = cloneAppearance(DEFAULT_APPEARANCE);
  out.weaponSkin = look.weaponSkin;
  out.backpack = look.backpack;
  out.mouthProp = look.mouthProp;
  out.height = look.height;
  return out;
}

/**
 * Starter looks (the three reference fits): complete outfits to begin from. Picking one copies it into the
 * draft; everything stays customizable, nothing is locked and nothing premium is in them.
 */
export interface LookPreset {
  id: string;
  name: string;
  blurb: string;
  look: Partial<Appearance>;
}
export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    id: 'puffer', name: 'Hooded Puffer', blurb: 'Black hooded puffer, stacked black pants with the blue graphic, red studded belt, chain, gloves and watches.',
    look: {
      bodyType: 'masc', build: 'average', skin: 's10', hair: 'spikylocs', hairColor: 'black', hat: 'none', mask: 'none', glasses: 'none', earrings: 'none',
      face: 'gray', faceMark: 'none', top: 'puffer', topColor: 'black', necklace: 'icedpendant', wrist: 'glovewatches',
      bottom: 'baggyjeans', bottomColor: 'black', belt: 'redstuds', legPrint: 'gocrazy', shoes: 'lowtops', shoeColor: 'white', carry: 'none', waistChain: 'none',
    },
  },
  {
    id: 'vest', name: 'Puffer Vest', blurb: 'Black puffer vest over a long sleeve, a star on the forehead, the same drip.',
    look: {
      bodyType: 'masc', build: 'average', skin: 's10', hair: 'spikylocs', hairColor: 'black', hat: 'none', mask: 'none', glasses: 'none', earrings: 'none',
      face: 'gray', faceMark: 'star', top: 'puffervest', topColor: 'black', necklace: 'icedpendant', wrist: 'glovewatches',
      bottom: 'baggyjeans', bottomColor: 'black', belt: 'redstuds', legPrint: 'gocrazy', shoes: 'lowtops', shoeColor: 'white', carry: 'none', waistChain: 'none',
    },
  },
  {
    id: 'tee', name: 'White Tee', blurb: 'Plain white tee, brown stacked pants, white kicks. Nothing else.',
    look: {
      bodyType: 'masc', build: 'average', skin: 's10', hair: 'spikylocs', hairColor: 'black', hat: 'none', mask: 'none', glasses: 'none', earrings: 'none',
      face: 'gray', faceMark: 'none', top: 'tee', topColor: 'white', necklace: 'none', wrist: 'none',
      bottom: 'baggyjeans', bottomColor: 'brown', belt: 'none', legPrint: 'none', shoes: 'lowtops', shoeColor: 'white', carry: 'none', waistChain: 'none',
    },
  },
];

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
  for (const key of EXTRA_FIELD_KEYS) if (isPick(EXTRA_FIELDS[key], r[key])) out[key] = r[key] as string;
  if (r.tattoos && typeof r.tattoos === 'object' && !Array.isArray(r.tattoos)) {
    out.tattoos = {};
    for (const [spot, design] of Object.entries(r.tattoos as Record<string, unknown>)) {
      if (isPick(TATTOO_SPOTS, spot) && isPick(TATTOO_DESIGNS, design)) out.tattoos[spot] = design;
    }
  }
  if (Array.isArray(r.details)) {
    out.details = BODY_DETAILS.map((d) => d.id).filter((id) => (r.details as unknown[]).includes(id));
  }
  // saved before the faceless character (no `face` yet)
  return r.face === undefined && r.top !== undefined ? upgradeOldLook(out) : out;
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
  s += B36[mask];
  // AJ's fields after the original code: old codes simply end before them
  for (const key of EXTRA_FIELD_KEYS) s += B36[Math.max(0, EXTRA_FIELDS[key].findIndex((o) => o.id === a[key]))];
  return s;
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
  const mask = at(i++);
  out.details = mask > 0 ? BODY_DETAILS.filter((_d, k) => mask & (1 << k)).map((d) => d.id) : [];
  const faceAt = i + EXTRA_FIELD_KEYS.indexOf('face');
  for (const key of EXTRA_FIELD_KEYS) {
    const o = EXTRA_FIELDS[key][at(i++)];
    if (o && o.available !== false) out[key] = o.id;
  }
  // a code written before the faceless character ends before its `face` digit
  return digits.length >= LOOK_FIELD_KEYS.length && digits.length <= faceAt ? upgradeOldLook(out) : out;
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
  // AJ's exclusives are bought, never handed out at random
  const ok = list.filter((o) => o.available !== false && !o.premium);
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
  a.hair = pickFrom(HAIRSTYLES, rand, {
    spikylocs: 7, wicks: 4, locs: 2.5, longdreads: 2, shortdreads: 2, twists: 2, braids: 1.5, largeafro: 1, shortafro: 1,
    ...(fem ? { buzz: 0.3, lowfade: 0.3, highfade: 0.3, waves: 0.3, bald: 0.1 } : { bob: 0.2, bun: 0.3, ponytail: 0.4, bald: 0.3 }),
  });
  a.hairColor = pickFrom(HAIR_COLORS, rand, { black: 5, darkbrown: 5, lightbrown: 3, blonde: 2, red: 1, ginger: 1, gray: 0.6, white: 0.4, platinum: 0.6, blue: 0.5, pink: 0.5, purple: 0.5 });
  a.facialHair = fem ? 'none' : pickFrom(FACIAL_HAIR, rand, { none: 5 });
  a.facialHairColor = rand() < 0.8 && !['blue', 'pink', 'purple', 'platinum'].includes(a.hairColor) ? a.hairColor : pickFrom(HAIR_COLORS, rand, { black: 4, darkbrown: 4 });
  a.lips = pickFrom(LIPS, rand, { average: 3 });
  a.mouthAcc = pickFrom(MOUTH_ACCESSORIES, rand, { none: 14 });
  a.mouthProp = pickFrom(MOUTH_PROPS, rand, { none: 6 });
  a.teeth = pickFrom(TEETH, rand);
  // the street look: puffers and vests, tees and hoodies, very wide stacked pants, clean kicks
  a.top = pickFrom(TOPS, rand, { puffer: 5, puffervest: 3.5, tee: 3.5, hoodie: 2.5, ziphoodie: 1.5, tank: 0.5, crop: fem ? 0.8 : 0.1 });
  a.topColor = pickFrom(TOP_COLORS, rand, { black: 6, white: 3, gray: 2, red: 1.3, blue: 1, pink: 0.8, green: 0.8, brown: 1, beige: 1, yellow: 0.5, orange: 0.5, purple: 0.6 });
  a.bottom = pickFrom(BOTTOMS, rand, { baggyjeans: 9, cargo: 2, jeans: 0.8, slimjeans: 0.3, shorts: 0.4, leggings: fem ? 0.4 : 0.05 });
  a.bottomColor = pickFrom(BOTTOM_COLORS, rand, { black: 6, brown: 2.5, gray: 2, blue: 2, darkblue: 2, beige: 1.2, green: 0.6, pink: 0.3, white: 0.6, red: 0.4 });
  a.shoes = pickFrom(SHOES, rand, { lowtops: 6, chunky: 2, boots: 1, running: 1 });
  a.shoeColor = pickFrom(SHOE_COLORS, rand, { white: 7, black: 2.5, gray: 1, red: 0.8, blue: 0.5, brown: 0.3, green: 0.3, pink: 0.3 });
  a.hat = pickFrom(HATS, rand, { none: 14, beanie: 1.2, skimask: 0.8, hoodup: 0.8, spikyhood: 0.3, capfwd: 0.6, capback: 0.6, durag: 0.6, bucket: 0.5, blackbucket: 0.4, graffitibeanie: 0.4, bandana: 0.3, cowboy: 0.05, headband: 0.3 });
  a.glasses = pickFrom(GLASSES, rand, { none: 9, sunglasses: 1.5, tinted: 0.6, clear: 0.2, aviators: 0.4, round: 0.2 });
  a.earrings = pickFrom(EARRINGS, rand, { none: 8, diamondstuds: 1.5, studs: 0.6, hoops: fem ? 1 : 0.2, dangling: fem ? 0.5 : 0.05 });
  a.necklace = pickFrom(NECKLACES, rand, { none: 4, icedpendant: 4, diamond: 2, silver: 1.5, silverstack: 1.2, medallion: 1, thickgold: 1, thingold: 0.6, pendant: 0.6, choker: 0.2 });
  a.wrist = pickFrom(WRIST, rand, { none: 4, glovewatches: 3, blackgloves: 1.5, silverwatch: 1.5, watch: 0.8, goldwatch: 0.6, bracelet: 0.5, wristbands: 0.5 });
  a.faceAcc = 'none';
  a.details = [];
  a.face = pickFrom(FACES, rand, { gray: 10, white: 1.5, black: 1.5, skin: 1, red: 0.3, blue: 0.3 });
  a.faceMark = pickFrom(FACE_MARKS, rand, { none: 7, star: 2, cross: 0.8, tears: 0.8, bolt: 0.6 });
  const long = a.bottom !== 'shorts' && a.bottom !== 'leggings';
  a.belt = long ? pickFrom(BELTS, rand, { none: 3, redstuds: 3, blackstuds: 2, whitestuds: 1.5 }) : 'none';
  a.legPrint = long ? pickFrom(LEG_PRINTS, rand, { none: 5, gocrazy: 3, flames: 1, stars: 1 }) : 'none';
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
