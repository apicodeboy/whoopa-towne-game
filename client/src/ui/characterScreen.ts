import {
  BELTS, BODY_DETAILS, BODY_TYPES, BOTTOMS, BOTTOM_COLORS, BROWS, BUILDS, CARRY, DEFAULT_APPEARANCE, EARRINGS, EARS, EXPRESSIONS, EYE_COLORS,
  EYE_SHAPES, FACE_ACCESSORIES, FACE_MARKS, FACE_SHAPES, FACIAL_HAIR, GLASSES, HAIRSTYLES, HAIR_COLORS, HATS, HEAD_SHAPES, HEAD_SIZES, LEG_PRINTS,
  LIPS, MASKS, MODELS, MOUTH_ACCESSORIES, MOUTH_PROPS, NECKLACES, NOSES, SHOES, SHOE_COLORS, SHOULDERS, SKIN_TONES, TATTOO_DESIGNS, TATTOO_SPOTS, TEETH,
  TOPS, TOP_COLORS, WAIST_CHAINS, WRIST, LOOK_PRESETS, cloneAppearance, isPremiumOption, randomAppearance, sameAppearance,
  type Appearance, type LookField, type LookOption,
} from '@shared/config/appearance';
import type { Profile } from '../core/profile';
import { CharacterPreview, PREVIEW_FRAMES, type PreviewFrame } from '../game/characters/characterPreview';
import type { CharacterVisual } from '../game/characters/characterTypes';
import { button, clear, el } from './dom';
import { ED, SHORT, tool } from './editorKit';

/**
 * WHOOPA-TOWNE Character Creator.
 *
 * Left: categories. Center: the 3D character. Right: the selected category's items (each
 * can be cycled with its arrows, or opened as a full grid of options). Bottom: turn, zoom,
 * camera, randomize, reset and KEEP CHARACTER. Edits are a draft until kept.
 *
 * The menu structure comes from the shared appearance config; options with no art yet are
 * shown locked ("coming soon") and can never be picked.
 */

type Kind = 'cards' | 'swatches' | 'expression' | 'details' | 'locked' | 'presets';

interface Sub {
  id: string;
  name: string;
  field?: LookField | 'shoulders' | 'headSize' | 'mask' | 'carry' | 'waistChain' | 'face' | 'faceMark' | 'belt' | 'legPrint' | 'model';
  kind: Kind;
  options: readonly LookOption[];
  frame: PreviewFrame;
  note?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  subs: Sub[];
}

const ic = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICONS = {
  body: ic('<circle cx="12" cy="4.5" r="2.5"/><path d="M8 9.5h8l-1 6h-1.6l-.6 6.5h-1.6l-.6-6.5H9z"/>'),
  face: ic('<ellipse cx="12" cy="12" rx="7" ry="8.5" fill="none" stroke-width="1.8"/><circle cx="9.3" cy="11" r="1.1"/><circle cx="14.7" cy="11" r="1.1"/><path d="M10.2 15.5h3.6" stroke-width="1.6"/>'),
  hair: ic('<path d="M4.5 14c0-6 3.5-9.5 7.5-9.5S19.5 8 19.5 14c-1.3-2.4-3-3.6-4.4-4-1 1.6-3.4 2.4-6.2 2.4-1.6 0-3 .6-4.4 1.6z"/><path d="M6 15v4M18 15v4" stroke-width="1.6"/>'),
  top: ic('<path d="M8 3.5l-5 3 2 4 2.2-1.2V20h9.6V9.3L19 10.5l2-4-5-3c-.6 1.6-2.1 2.6-4 2.6S8.6 5.1 8 3.5z"/>'),
  pants: ic('<path d="M6.5 3h11l1 18h-4.2L12 9.5 9.7 21H5.5z"/>'),
  shoes: ic('<path d="M3 14.5c0-1.6.6-3.5 1.4-5h4.3c.6 1.6 2.4 2.4 4.3 2.6 3.3.4 6.4 1.4 7.4 3.4v1.5H3z"/><path d="M3 18h18" stroke-width="2"/>'),
  hat: ic('<path d="M4 15.5c0-5.2 3.6-9 8-9s8 3.8 8 9z"/><path d="M12 15.5h10.5c0 1.3-1.6 2-4 2H12z"/>'),
  jewelry: ic('<path d="M7 4h10l3.5 4.5L12 20 3.5 8.5z" fill="none" stroke-width="1.7"/><path d="M3.5 8.5h17M9.5 4L12 20M14.5 4L12 20" fill="none" stroke-width="1.1"/>'),
  ink: ic('<path d="M12 2.5l2.6 6 6.4.6-4.8 4.3 1.4 6.4L12 16.5l-5.6 3.3 1.4-6.4L3 9.1l6.4-.6z"/>'),
};

/** Small stroke icons for the controls (the display font has no arrow glyphs). */
const UI = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  turnL: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 3v5h5"/></svg>',
  turnR: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3v5h-5"/></svg>',
};

const sub = (id: string, name: string, field: Sub['field'], kind: Kind, options: readonly LookOption[], frame: PreviewFrame, note?: string): Sub => ({ id, name, field, kind, options, frame, note });

const MODEL_CATEGORY: Category = {
  id: 'model', name: 'Character', icon: ICONS.body, subs: [
    sub('model', 'Character', 'model', 'cards', MODELS, 'full',
      'Whoopa Tall (hood down or up), or the classic custom character. Switching keeps everything you set on the other one.'),
  ],
};

/** Whoopa Tall's own swatches: "Original" shows the color it was made in. */
const asMade = (list: readonly LookOption[], hex: string): LookOption[] => {
  const orig = list.find((o) => o.id === 'original');
  return [...(orig ? [{ ...orig, color: hex }] : []), ...list.filter((o) => o.id !== 'original')];
};
/** Whoopa Tall's garments: his own sculpted jacket / cargos first, then the clothing system's. */
const wtGarments = (list: readonly LookOption[], own: string): LookOption[] => [
  ...list.filter((o) => o.id === own), ...list.filter((o) => o.id !== own && !o.modelOnly),
];
const OWN_NOTE = 'His own jacket and cargos are sculpted into the model; the rest are fitted to him from the clothing rack.';
/** What can really be changed on Whoopa Tall (its maps are recolored; see imported/recolor.ts). */
const WT_CATEGORIES: Category[] = [
  {
    id: 'wt-head', name: 'Skin & Head', icon: ICONS.face, subs: [
      sub('skin', 'Skin Tone', 'skin', 'swatches', asMade(SKIN_TONES, '#4a2618'), 'upper'),
      sub('hairColor', 'Braids Color', 'hairColor', 'swatches', HAIR_COLORS, 'face', 'Black is how the braids were made.'),
      sub('headSize', 'Head Size', 'headSize', 'cards', HEAD_SIZES, 'upper', 'Looks only: everybody is hit in the same place.'),
    ],
  },
  {
    id: 'wt-top', name: 'Tops', icon: ICONS.top, subs: [
      sub('top', 'Top', 'top', 'cards', wtGarments(TOPS, 'wtjacket'), 'upper', OWN_NOTE),
      sub('topColor', 'Top Color', 'topColor', 'swatches', asMade(TOP_COLORS, '#cfcfcb'), 'upper', 'Original: his jacket as it was made.'),
    ],
  },
  {
    id: 'wt-bottom', name: 'Bottoms', icon: ICONS.pants, subs: [
      sub('bottom', 'Bottom', 'bottom', 'cards', wtGarments(BOTTOMS, 'wtcargos'), 'full', OWN_NOTE),
      sub('bottomColor', 'Bottom Color', 'bottomColor', 'swatches', asMade(BOTTOM_COLORS, '#cfcfcb'), 'full', 'Original: his cargos as they were made.'),
    ],
  },
  { id: 'wt-boots', name: 'Boots', icon: ICONS.shoes, subs: [sub('shoeColor', 'Boot Color', 'shoeColor', 'swatches', asMade(SHOE_COLORS, '#d6d6d2'), 'full', 'His own boots, in any color.')] },
];
/** Models with a mask and no hair showing. */
const HAIRLESS = new Set(['whoopa_tall_hooded']);

export const CATEGORIES: Category[] = [
  {
    id: 'presets', name: 'Starter Looks', icon: ICONS.ink, subs: [
      sub('preset', 'Starter Looks', undefined, 'presets', LOOK_PRESETS.map((p) => ({ id: p.id, name: p.name })), 'full', 'A complete fit to start from. Change anything after.'),
    ],
  },
  {
    id: 'body', name: 'Body', icon: ICONS.body, subs: [
      sub('bodyType', 'Body Type', 'bodyType', 'cards', BODY_TYPES, 'full', 'Body types are looks only: every outfit and accessory fits all of them.'),
      sub('build', 'Body Build', 'build', 'cards', BUILDS, 'full'),
      sub('shoulders', 'Shoulder Width', 'shoulders', 'cards', SHOULDERS, 'full'),
      sub('skin', 'Skin Tone', 'skin', 'swatches', SKIN_TONES, 'upper'),
      sub('headSize', 'Head Size', 'headSize', 'cards', HEAD_SIZES, 'upper'),
    ],
  },
  {
    id: 'head', name: 'Head & Face', icon: ICONS.face, subs: [
      sub('headShape', 'Head Shape', 'headShape', 'cards', HEAD_SHAPES, 'face'),
      sub('faceShape', 'Face Shape', 'faceShape', 'cards', FACE_SHAPES, 'face'),
      sub('eyes', 'Eyes', 'eyes', 'cards', EYE_SHAPES, 'face'),
      sub('eyeColor', 'Eye Color', 'eyeColor', 'swatches', EYE_COLORS, 'face'),
      sub('brows', 'Eyebrows', 'brows', 'cards', BROWS, 'face'),
      sub('nose', 'Nose', 'nose', 'cards', NOSES, 'face'),
      sub('lips', 'Mouth', 'lips', 'cards', LIPS, 'face'),
      sub('teeth', 'Teeth', 'teeth', 'cards', TEETH, 'face', 'Teeth show when you smile (try Expression) or wear a grill.'),
      sub('ears', 'Ears', 'ears', 'cards', EARS, 'face'),
      sub('facialHair', 'Facial Hair', 'facialHair', 'cards', FACIAL_HAIR, 'face'),
      sub('facialHairColor', 'Facial Hair Color', 'facialHairColor', 'swatches', HAIR_COLORS, 'face', 'Eyebrows use this color too.'),
      sub('details', 'Freckles & Marks', undefined, 'details', BODY_DETAILS, 'face', 'Pick any combination.'),
      sub('faceMark', 'Face Tattoo', 'faceMark', 'cards', FACE_MARKS, 'face'),
      sub('expression', 'Expression', undefined, 'expression', EXPRESSIONS, 'face', 'Preview only: your character goes back to a relaxed face.'),
    ],
  },
  {
    id: 'hair', name: 'Hair', icon: ICONS.hair, subs: [
      sub('hair', 'Hairstyle', 'hair', 'cards', HAIRSTYLES, 'face'),
      sub('hairColor', 'Hair Color', 'hairColor', 'swatches', HAIR_COLORS, 'face'),
    ],
  },
  {
    id: 'top', name: 'Shirts & Tops', icon: ICONS.top, subs: [
      sub('top', 'Shirt Style', 'top', 'cards', TOPS, 'upper'),
      sub('topColor', 'Shirt Color', 'topColor', 'swatches', TOP_COLORS, 'upper'),
    ],
  },
  {
    id: 'bottom', name: 'Pants & Bottoms', icon: ICONS.pants, subs: [
      sub('bottom', 'Bottom Style', 'bottom', 'cards', BOTTOMS, 'full'),
      sub('bottomColor', 'Bottom Color', 'bottomColor', 'swatches', BOTTOM_COLORS, 'full'),
      sub('belt', 'Belt', 'belt', 'cards', BELTS, 'full'),
      sub('legPrint', 'Pants Graphic', 'legPrint', 'cards', LEG_PRINTS, 'full', 'On the left leg of long pants.'),
      sub('waistChain', 'Pants Chain', 'waistChain', 'cards', WAIST_CHAINS, 'full'),
    ],
  },
  {
    id: 'shoes', name: 'Shoes', icon: ICONS.shoes, subs: [
      sub('shoes', 'Shoe Style', 'shoes', 'cards', SHOES, 'full'),
      sub('shoeColor', 'Shoe Color', 'shoeColor', 'swatches', SHOE_COLORS, 'full'),
    ],
  },
  {
    id: 'headacc', name: 'Head Accessories', icon: ICONS.hat, subs: [
      sub('hat', 'Hats & Headwear', 'hat', 'cards', HATS, 'face', 'Hats tuck your hair in so nothing pokes through.'),
      sub('glasses', 'Glasses', 'glasses', 'cards', GLASSES, 'face'),
      sub('mask', 'Masks', 'mask', 'cards', MASKS, 'face'),
      sub('mouthAcc', 'Grills & Lip Piercings', 'mouthAcc', 'cards', MOUTH_ACCESSORIES, 'face'),
      sub('faceAcc', 'Face Piercings', 'faceAcc', 'cards', FACE_ACCESSORIES, 'face'),
      sub('mouthProp', 'In Mouth', 'mouthProp', 'cards', MOUTH_PROPS, 'face'),
    ],
  },
  {
    id: 'jewelry', name: 'Jewelry & Accessories', icon: ICONS.jewelry, subs: [
      sub('necklace', 'Necklaces', 'necklace', 'cards', NECKLACES, 'upper'),
      sub('wrist', 'Wrists & Gloves', 'wrist', 'cards', WRIST, 'upper'),
      sub('earrings', 'Earrings', 'earrings', 'cards', EARRINGS, 'face'),
      sub('carry', 'In Hand', 'carry', 'cards', CARRY, 'upper', 'Shows in menus and the creator (put away in matches).'),
    ],
  },
  {
    id: 'tattoos', name: 'Tattoos', icon: ICONS.ink, subs: [
      sub('tattooSpot', 'Tattoo Location', undefined, 'locked', [{ id: 'none', name: 'None' }, ...TATTOO_SPOTS.map((o) => ({ ...o, available: false }))], 'upper', 'Tattoos are coming in a later update.'),
      sub('tattooDesign', 'Tattoo Design', undefined, 'locked', TATTOO_DESIGNS, 'upper', 'Tattoos are coming in a later update.'),
    ],
  },
];

const SOON = 'Coming soon';

export interface CharacterScreenDeps {
  profile: Profile;
  /** Builds a character for the preview (null while the models are loading). */
  build: (look: Appearance) => CharacterVisual;
  /** Downloads a one-piece model: false when it could not be loaded. */
  loadModel: (id: string) => Promise<boolean>;
  /** The player kept a new look. */
  onKeep: (look: Appearance) => void;
  onClose: () => void;
  /** AJ's exclusives: may this player wear it? (field, option). Unowned ones show locked. */
  owns?: (field: string, option: string) => boolean;
  /** Opens AJ's (an unowned exclusive was picked) and TRAP. */
  openStore?: () => void;
  openTrap?: () => void;
}

export class CharacterScreen {
  readonly root: HTMLElement;
  private deps: CharacterScreenDeps;
  private preview = new CharacterPreview();
  private draft: Appearance;
  private shownSig = '';
  private rebuildQueued = false;

  private category = CATEGORIES[0];
  /** Open option grid (null = the category's item list). */
  private open: Sub | null = null;

  private catList: HTMLElement;
  private catButtons = new Map<string, HTMLButtonElement>();
  /** Everything that only edits the custom character (hidden while a one-piece model is picked)... */
  private customOnly: HTMLElement[] = [];
  /** ...and what only edits the one-piece models. */
  private modelOnly: HTMLElement[] = [];
  private panelTitle: HTMLElement;
  private panelBack: HTMLButtonElement;
  private panelBody: HTMLElement;
  private panelNote: HTMLElement;
  private viewButtons = new Map<PreviewFrame, HTMLButtonElement>();
  private headerBack: HTMLButtonElement;
  private dirtyMark: HTMLElement;
  private modal: HTMLElement;
  /** The editor look: the color row, the front view's measured box, the view (split or not). */
  private colorRow: HTMLElement;
  private colorTool: HTMLElement;
  private frontBox: HTMLElement;
  private view: HTMLElement;
  private spinBtn!: HTMLButtonElement;
  private splitWanted = true;
  private onResize = () => this.applySplit();
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(parent: HTMLElement, deps: CharacterScreenDeps) {
    this.deps = deps;
    this.draft = cloneAppearance(deps.profile.look);

    // ================================================================ top left: back, the name
    this.headerBack = tool(ED.back, 'Back', () => this.requestClose(), 'solo');
    this.headerBack.dataset.back = '1';
    this.dirtyMark = el('span', 'cc-dirty hidden', 'Unsaved changes');
    const titleBtn = button('', 'ed-title', () => this.selectCategory(this.draft.model === 'custom' ? CATEGORIES[0] : MODEL_CATEGORY));
    titleBtn.innerHTML = `<b>${(deps.profile.name || 'Character').replace(/[<>&"]/g, '')}</b><span class="ed-chev">${ED.chevron}</span>`;
    titleBtn.title = 'Character';
    const topLeft = el('div', 'ed-tl', [this.headerBack, el('div', 'ed-name', [titleBtn, this.dirtyMark])]);

    // ================================================================ top middle: the framings, zoom
    const views = el('div', 'ed-pill');
    for (const f of PREVIEW_FRAMES) {
      const [label, icon] = f === 'full' ? ['Body', ED.full] : f === 'upper' ? ['Upper', ED.upper] : ['Face', ED.faceView];
      const b = tool(icon, label, () => this.setView(f));
      b.title = `${label} (${PREVIEW_FRAMES.indexOf(f) + 1})`;
      this.viewButtons.set(f, b);
      views.append(b);
    }
    const zoom = el('div', 'ed-pill', [
      tool(ED.zoomOut, 'Zoom out', () => this.preview.zoomBy(-1)),
      tool(ED.zoomIn, 'Zoom in', () => this.preview.zoomBy(1)),
    ]);
    const topMid = el('div', 'ed-tm', [views, zoom]);

    // ================================================================ top right: TRAP, randomize / reset, keep
    const remix = el('div', 'ed-pill', [tool(ED.dice, 'Randomize', () => this.randomize()), tool(ED.reset, 'Reset', () => this.reset())]);
    const topRight = el('div', 'ed-tr', [
      ...(deps.openTrap ? [tool(ED.trap, 'TRAP', () => deps.openTrap!(), 'solo')] : []),
      remix,
      tool(ED.keep, 'Keep', () => this.confirmKeep(), 'solo primary cc-keep'),
    ]);

    // ================================================================ the views: front (measured) | 3D
    this.frontBox = el('div', 'ed-box hidden');
    this.frontBox.innerHTML = `<i class="h tl"></i><i class="h tm"></i><i class="h tr"></i><i class="h ml"></i><i class="h mr"></i><i class="h bl"></i><i class="h bm"></i><i class="h br"></i>
<span class="ed-rot">${ED.rotate}</span><span class="ed-dim w"></span><span class="ed-dim hgt"></span>`;
    const divider = button('', 'ed-divider', () => {
      this.splitWanted = !this.splitWanted;
      this.applySplit();
    });
    divider.innerHTML = ED.split;
    divider.title = 'Front view on / off';
    divider.setAttribute('aria-label', 'Front view on or off');
    const cube = button('', 'ed-cube', () => this.preview.faceFront());
    cube.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3l15 8.5v17L20 37 5 28.5v-17z" fill="#3a3a3e"/><path d="M20 3l15 8.5L20 20 5 11.5z" fill="#55555a"/><path d="M20 20l15-8.5v17L20 37z" fill="#2a2a2d"/></svg><span>Front</span>`;
    cube.title = 'Turn to the front';
    this.view = el('div', 'ed-view', [
      this.preview.canvas, this.frontBox, divider, cube,
      el('div', 'cc-hint', 'Drag to turn · scroll or pinch to zoom'),
    ]);
    this.preview.onUserTurn = () => this.view.classList.add('touched');
    this.preview.onFrontBox = (b) => this.placeFrontBox(b);

    // ================================================================ the inspector (the category's items, their options)
    this.panelBack = button('', 'ed-pback', () => this.closeOptions());
    this.panelBack.innerHTML = ED.back;
    this.panelBack.setAttribute('aria-label', 'Back');
    this.panelTitle = el('div', 'cc-ptitle');
    this.panelBody = el('div', 'cc-pbody');
    this.panelNote = el('div', 'cc-pnote');
    const panel = el('section', 'cc-panel ed-panel', [el('div', 'cc-phead', [this.panelBack, this.panelTitle]), this.panelBody, this.panelNote]);

    // ================================================================ bottom: turn | categories | color | spin, wave
    const turn = (icon: string, label: string, dir: number) => {
      const b = tool(icon, label, () => undefined);
      const stop = () => this.preview.turn(0);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.preview.turn(dir);
      });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('pointercancel', stop);
      // keyboard / controller activation: one step
      b.addEventListener('click', (e) => {
        if ((e as PointerEvent).pointerType === '' || e.detail === 0) this.preview.turnStep(dir);
      });
      return b;
    };
    const bottomLeft = el('div', 'ed-pill ed-bl', [turn(ED.turnL, 'Turn left', -1), turn(ED.turnR, 'Turn right', 1)]);
    this.catList = el('nav', 'ed-cats');
    this.catList.setAttribute('aria-label', 'Customization categories');
    const pill = el('div', 'ed-pill');
    for (const c of [MODEL_CATEGORY, ...CATEGORIES]) {
      const [label, icon] = SHORT[c.id] ?? [c.name, ED.starter];
      const solo = c.id === 'presets' || c === MODEL_CATEGORY;
      const b = tool(icon, label, () => this.selectCategory(c), solo ? 'solo' : '');
      b.title = c.name;
      this.catButtons.set(c.id, b);
      if (solo) this.catList.append(b);
      else pill.append(b);
      if (c.id === 'presets') this.customOnly.push(b);
    }
    this.catList.append(pill);
    this.customOnly.push(pill);
    const wtPill = el('div', 'ed-pill');
    for (const c of WT_CATEGORIES) {
      const [label, icon] = SHORT[c.id] ?? [c.name, ED.starter];
      const b = tool(icon, label, () => this.selectCategory(c));
      b.title = c.name;
      this.catButtons.set(c.id, b);
      wtPill.append(b);
    }
    this.catList.append(wtPill);
    this.modelOnly.push(wtPill);
    this.colorRow = el('div', 'ed-pill ed-colors');
    this.colorTool = el('div', 'ed-colortool', [this.colorRow, el('span', 'ed-cl', 'Color')]);
    this.spinBtn = tool(ED.play, 'Spin', () => {
      this.preview.setSpin(!this.preview.spinning);
      this.spinBtn.classList.toggle('on', this.preview.spinning);
    });
    const bottomRight = el('div', 'ed-pill ed-br', [this.spinBtn, tool(ED.wave, 'Wave', () => this.preview.character?.wave?.())]);
    const bottom = el('div', 'ed-bottom', [bottomLeft, el('div', 'ed-bmid', [this.catList, this.colorTool]), bottomRight]);

    this.modal = el('div', 'cc-modal hidden');
    this.root = el('div', 'screen overlay creator ed hidden', [
      el('div', 'ed-shell', [this.view, panel, topLeft, topMid, topRight, bottom]),
      this.modal,
    ]);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Character Creator');
    parent.append(this.root);
    this.selectCategory(CATEGORIES[0]);
  }

  // ------------------------------------------------------------------ the editor look
  /** Front view beside the 3D view where there is room for both (and the player wants it). */
  private applySplit(): void {
    const roomy = window.innerWidth >= 1000 && window.innerHeight >= 560;
    const on = this.splitWanted && roomy;
    this.preview.setSplit(on);
    this.view.classList.toggle('split', on);
    this.root.classList.toggle('roomy', roomy);
  }

  /** The dashed box round the character in the front view, with its real size on it. */
  private placeFrontBox(b: { x: number; y: number; w: number; h: number; widthM: number; heightM: number } | null): void {
    this.frontBox.classList.toggle('hidden', !b);
    if (!b) return;
    const pad = 10;
    Object.assign(this.frontBox.style, { left: `${b.x - pad}px`, top: `${b.y - pad}px`, width: `${b.w + pad * 2}px`, height: `${b.h + pad * 2}px` });
    const cm = (m: number) => `${Math.round(m * 100)}<small>CM</small>`;
    this.frontBox.querySelector('.ed-dim.w')!.innerHTML = cm(b.widthM);
    this.frontBox.querySelector('.ed-dim.hgt')!.innerHTML = cm(b.heightM);
  }

  /** The color row: the swatches of what you are editing (its first color pick). */
  private renderColors(): void {
    clear(this.colorRow);
    const s = (this.open && this.open.kind === 'swatches' ? this.open : null) ?? this.subsOf(this.category).find((x) => x.kind === 'swatches') ?? null;
    this.colorTool.classList.toggle('none', !s);
    if (!s || !s.field) return;
    const cur = this.draft[s.field];
    const ok = s.options.filter((o) => o.available !== false);
    let shown = ok.slice(0, 4);
    const sel = ok.find((o) => o.id === cur);
    if (sel && !shown.includes(sel)) shown = [...shown.slice(0, 3), sel];
    for (const o of shown) {
      const premium = this.lockedPremium(s, o);
      const b = button('', `ed-sw${o.id === cur ? ' on' : ''}${premium ? ' aj' : ''}`, () => {
        if (premium) return this.deps.openStore?.();
        this.choose(s, o);
        this.renderColors();
      });
      b.style.setProperty('--sw', o.color ?? '#888');
      b.title = premium ? `${o.name} · sold at AJ's` : o.name;
      b.setAttribute('aria-label', `${s.name}: ${o.name}`);
      b.setAttribute('aria-pressed', String(o.id === cur));
      this.colorRow.append(b);
    }
    const more = button('', 'ed-sw more', () => this.openOptions(s));
    more.innerHTML = ED.more;
    more.title = `All ${s.name.toLowerCase()}s`;
    more.setAttribute('aria-label', `All ${s.name}`);
    this.colorRow.append(more);
  }

  // ------------------------------------------------------------------ navigation
  /** Shows the controls for the body being edited (custom character or one-piece model). */
  private syncMode(): boolean {
    const custom = this.draft.model === 'custom';
    for (const e of this.customOnly) e.hidden = !custom;
    for (const e of this.modelOnly) e.hidden = custom;
    return custom;
  }

  /** A category's items for the body being edited. */
  private subsOf(c: Category): Sub[] {
    // (the hooded model's hood and mask are part of its hoodie: it keeps its own top)
    return HAIRLESS.has(this.draft.model) ? c.subs.filter((s) => s.field !== 'hairColor' && s.field !== 'top') : c.subs;
  }

  private selectCategory(c: Category): void {
    const custom = this.syncMode();
    const ok = c === MODEL_CATEGORY || (custom ? CATEGORIES : WT_CATEGORIES).includes(c);
    if (!ok) c = custom ? CATEGORIES[0] : MODEL_CATEGORY;
    this.category = c;
    for (const [id, b] of this.catButtons) {
      b.classList.toggle('on', id === c.id);
      b.setAttribute('aria-pressed', String(id === c.id));
    }
    // single-item categories go straight to their options
    const subs = this.subsOf(c);
    if (subs.length === 1) this.openOptions(subs[0]);
    else {
      this.open = null;
      this.renderPanel();
      this.setView(subs[0].frame);
    }
    this.renderColors();
  }

  private openOptions(s: Sub): void {
    this.open = s;
    this.setView(s.frame);
    this.renderPanel();
    // the current option gets keyboard focus (and is scrolled to) so arrows / Enter work right away
    const first = this.panelBody.querySelector<HTMLButtonElement>('button.on') ?? this.panelBody.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])');
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: 'nearest' });
  }

  private closeOptions(): void {
    if (this.subsOf(this.category).length === 1 || !this.open) return;
    const was = this.open;
    this.open = null;
    this.renderPanel();
    this.panelBody.querySelector<HTMLButtonElement>(`[data-sub="${was.id}"]`)?.focus({ preventScroll: true });
  }

  private setView(f: PreviewFrame): void {
    this.preview.setFrame(f);
    for (const [id, b] of this.viewButtons) b.classList.toggle('on', id === f);
  }

  // ------------------------------------------------------------------ panel
  private renderPanel(): void {
    clear(this.panelBody);
    const s = this.open;
    const nested = s !== null && this.subsOf(this.category).length > 1;
    this.panelBack.classList.toggle('hidden', !nested);
    // Escape / controller B: closes the option grid first, then the creator
    if (nested) {
      this.panelBack.dataset.back = '1';
      delete this.headerBack.dataset.back;
    } else {
      delete this.panelBack.dataset.back;
      this.headerBack.dataset.back = '1';
    }
    this.panelTitle.textContent = s ? (nested ? `${this.category.name} · ${s.name}` : s.name) : this.category.name;
    this.panelNote.textContent = s?.note ?? '';
    if (!s) {
      this.panelBody.className = 'cc-pbody items';
      for (const item of this.subsOf(this.category)) this.panelBody.append(this.itemRow(item));
      return;
    }
    this.panelBody.className = `cc-pbody ${s.kind === 'swatches' ? 'swatches' : 'cards'}`;
    for (const o of this.optionsOf(s)) this.panelBody.append(this.optionButton(s, o));
  }

  /** A row in a category's item list: name, current value, quick arrows; click opens the grid. */
  private itemRow(s: Sub): HTMLElement {
    const value = el('span', 'cc-ival');
    const fill = () => {
      clear(value);
      if (s.kind === 'details') {
        value.textContent = this.draft.details.length ? this.draft.details.map((d) => BODY_DETAILS.find((x) => x.id === d)?.name).join(', ') : 'None';
        return;
      }
      if (s.kind === 'locked') {
        value.textContent = 'None';
        return;
      }
      const cur = s.field ? s.options.find((o) => o.id === this.draft[s.field!]) : null;
      if (cur?.color) value.append(el('i', 'cc-dot'));
      if (cur?.color) (value.lastChild as HTMLElement).style.background = cur.color;
      value.append(document.createTextNode(cur?.name ?? '—'));
    };
    fill();
    const openBtn = button('', 'cc-item', () => this.openOptions(s));
    openBtn.dataset.sub = s.id;
    openBtn.append(el('span', 'cc-iname', s.name), value);
    const row = el('div', 'cc-irow', [openBtn]);
    if (s.field) {
      const cycle = (dir: number) => {
        const ok = this.optionsOf(s).filter((o) => o.available !== false && !this.lockedPremium(s, o));
        const i = ok.findIndex((o) => o.id === this.draft[s.field!]);
        const next = ok[(i + dir + ok.length) % ok.length];
        this.pick(s, next.id, false);
        fill();
      };
      const prev = button('', 'btn small ghost cc-arrow', () => cycle(-1));
      const next = button('', 'btn small ghost cc-arrow', () => cycle(1));
      prev.innerHTML = UI.left;
      next.innerHTML = UI.right;
      prev.setAttribute('aria-label', `Previous ${s.name}`);
      next.setAttribute('aria-label', `Next ${s.name}`);
      row.prepend(prev);
      row.append(next);
    }
    return row;
  }

  /** A list's options for the body being edited (the models' own garments only on them). */
  private optionsOf(s: Sub): readonly LookOption[] {
    return this.draft.model === 'custom' ? s.options.filter((o) => !o.modelOnly) : s.options;
  }

  /** An AJ's exclusive this player does not own. */
  private lockedPremium(s: Sub, o: LookOption): boolean {
    return !!o.premium && !(s.field && this.deps.owns?.(s.field, o.id));
  }

  private optionButton(s: Sub, o: LookOption): HTMLButtonElement {
    const premium = this.lockedPremium(s, o);
    const locked = o.available === false || premium;
    const selected = this.isSelected(s, o);
    const b = button('', `cc-opt ${s.kind === 'swatches' ? 'swatch' : 'card'}${selected ? ' on' : ''}${locked ? ' locked' : ''}${o.premium ? ' aj' : ''}`, () => {
      if (premium) {
        this.deps.openStore?.();
        return;
      }
      if (locked) {
        b.classList.remove('shake');
        void b.offsetWidth;
        b.classList.add('shake');
        return;
      }
      this.choose(s, o);
    });
    b.setAttribute('aria-pressed', String(selected));
    if (locked) {
      b.setAttribute('aria-disabled', 'true');
      b.title = premium ? `${o.name} · sold at AJ's` : `${o.name} · ${SOON}`;
    }
    if (s.kind === 'swatches') {
      b.style.setProperty('--sw', o.color ?? '#888');
      b.title = o.name;
      b.setAttribute('aria-label', o.name);
      b.append(el('i', 'cc-sw'), el('span', 'cc-swname', o.name));
      if (premium) b.append(el('span', 'cc-aj', "AJ's"));
    } else {
      b.append(el('span', 'cc-oname', o.name));
      if (locked) b.append(el('span', premium ? 'cc-aj' : 'cc-soon', premium ? "AJ's" : 'SOON'));
      if (s.kind === 'details') b.append(el('span', 'cc-check', selected ? '✓' : ''));
    }
    return b;
  }

  private isSelected(s: Sub, o: LookOption): boolean {
    if (s.kind === 'presets') {
      const p = LOOK_PRESETS.find((x) => x.id === o.id);
      return !!p && Object.entries(p.look).every(([k, v]) => (this.draft as unknown as Record<string, unknown>)[k] === v);
    }
    if (s.kind === 'details') return this.draft.details.includes(o.id);
    if (s.kind === 'locked') return o.id === 'none';
    if (s.kind === 'expression') return o.id === 'neutral';
    return !!s.field && this.draft[s.field] === o.id;
  }

  private choose(s: Sub, o: LookOption): void {
    if (s.kind === 'presets') {
      const p = LOOK_PRESETS.find((x) => x.id === o.id);
      if (!p) return;
      // only what the player may wear (a preset never contains AJ's items, but be safe)
      for (const [k, v] of Object.entries(p.look)) {
        if (isPremiumOption(k, String(v)) && !this.deps.owns?.(k, String(v))) continue;
        (this.draft as unknown as Record<string, unknown>)[k] = v;
      }
      this.changed();
      this.renderPanel();
      this.setView('full');
      return;
    }
    if (s.kind === 'expression') {
      this.setView('face');
      this.preview.showcaseFace(0.3);
      this.preview.character?.previewExpression?.(o.id);
      for (const b of this.panelBody.querySelectorAll('.cc-opt')) b.classList.toggle('on', b === this.panelBody.children[s.options.indexOf(o)]);
      return;
    }
    if (s.kind === 'details') {
      const has = this.draft.details.includes(o.id);
      this.draft.details = BODY_DETAILS.map((d) => d.id).filter((id) => (id === o.id ? !has : this.draft.details.includes(id)));
      this.changed();
      this.renderPanel();
      this.setView('face');
      return;
    }
    this.pick(s, o.id, true);
  }

  private pick(s: Sub, id: string, rerender: boolean): void {
    if (!s.field) return;
    this.draft[s.field] = id;
    // "Original" is the color of his own garments: another garment starts out brown
    if (s.field === 'top' && id !== 'wtjacket' && this.draft.topColor === 'original') this.draft.topColor = 'brown';
    if (s.field === 'bottom' && id !== 'wtcargos' && this.draft.bottomColor === 'original') this.draft.bottomColor = 'brown';
    // (and on the custom character, the models' own garments are its nearest ones)
    if (this.draft.model === 'custom' && s.field === 'model') {
      if (this.draft.top === 'wtjacket') this.draft.top = 'ziphoodie';
      if (this.draft.bottom === 'wtcargos') this.draft.bottom = 'cargo';
    }
    this.changed();
    if (rerender) {
      for (const b of this.panelBody.querySelectorAll<HTMLButtonElement>('.cc-opt')) {
        const on = b.querySelector('.cc-oname, .cc-swname')?.textContent === s.options.find((o) => o.id === id)?.name;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
    this.setView(s.frame);
    if (s.frame === 'face') this.preview.showcaseFace();
    if (s.field === 'model') this.modelPicked(s);
  }

  /** A model was picked: only its controls stay, and the note follows the download. */
  private modelPicked(s: Sub): void {
    const id = this.draft.model;
    this.syncMode();
    this.panelNote.textContent = s.note ?? '';
    if (id === 'custom') return;
    this.panelNote.textContent = 'Loading the model (about 12 MB the first time)…';
    void this.deps.loadModel(id).then((ok) => {
      if (this.draft.model !== id || this.open !== s) return;
      this.panelNote.textContent = ok ? (s.note ?? '') : 'That model did not load, so your custom character is showing. Pick it again to retry.';
    });
  }

  // ------------------------------------------------------------------ draft
  private changed(): void {
    this.dirtyMark.classList.toggle('hidden', sameAppearance(this.draft, this.deps.profile.look));
    this.queueRebuild();
    this.renderColors();
  }

  /** Rebuilds the preview once per frame at most (quick arrow clicks stay smooth). */
  private queueRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.refreshCharacter(false);
    });
  }

  private refreshCharacter(force: boolean): void {
    if (!this.visible) return;
    const sig = JSON.stringify(this.draft);
    if (!force && sig === this.shownSig) return;
    this.shownSig = sig;
    this.preview.setCharacter(this.deps.build(cloneAppearance(this.draft)));
  }

  private randomize(): void {
    if (this.draft.model !== 'custom') {
      // a one-piece model: new colors (free ones), the same model
      const pick = (list: readonly LookOption[]) => {
        const ok = list.filter((o) => o.available !== false && !o.premium);
        return ok[Math.floor(Math.random() * ok.length)].id;
      };
      Object.assign(this.draft, { skin: pick(SKIN_TONES), topColor: pick(TOP_COLORS), bottomColor: pick(BOTTOM_COLORS), shoeColor: pick(SHOE_COLORS), hairColor: pick(HAIR_COLORS) });
      this.changed();
      this.renderPanel();
      return;
    }
    this.draft = randomAppearance();
    this.changed();
    this.renderPanel();
    this.preview.showcaseFace();
  }

  private reset(): void {
    this.draft = cloneAppearance(DEFAULT_APPEARANCE);
    this.changed();
    this.renderPanel();
  }

  // ------------------------------------------------------------------ keep / leave
  private confirmKeep(): void {
    this.showModal('Are you ready to keep this character?', 'It becomes your character in every match. You can change it here any time.', [
      ['CONTINUE EDITING', 'btn', () => this.hideModal(), true],
      ['KEEP CHARACTER', 'btn primary', () => this.keep(), false],
    ]);
  }

  private keep(): void {
    this.deps.profile.setLook(this.draft);
    this.deps.onKeep(cloneAppearance(this.deps.profile.look));
    this.hideModal();
    this.dirtyMark.classList.add('hidden');
    this.deps.onClose();
  }

  private requestClose(): void {
    if (!this.modal.classList.contains('hidden')) return this.hideModal();
    if (sameAppearance(this.draft, this.deps.profile.look)) return this.deps.onClose();
    this.showModal('Leave without keeping your changes?', 'Your character stays as it was the last time you kept it.', [
      ['CONTINUE EDITING', 'btn primary', () => this.hideModal(), true],
      ['LEAVE', 'btn danger', () => {
        this.hideModal();
        this.deps.onClose();
      }, false],
    ]);
  }

  private showModal(title: string, text: string, buttons: Array<[string, string, () => void, boolean]>): void {
    clear(this.modal);
    const row = el('div', 'row center');
    for (const [label, cls, fn, back] of buttons) {
      const b = button(label, cls, fn);
      if (back) b.dataset.back = '1';
      row.append(b);
    }
    delete this.headerBack.dataset.back;
    delete this.panelBack.dataset.back;
    this.modal.append(el('div', 'overlay-panel cc-confirm', [el('div', 'panel-title', title), el('p', 'cc-confirm-text', text), row]));
    this.modal.classList.remove('hidden');
    (row.querySelector('.primary') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private hideModal(): void {
    this.modal.classList.add('hidden');
    clear(this.modal);
    this.renderPanel();
  }

  // ------------------------------------------------------------------ keyboard
  private key(e: KeyboardEvent): void {
    if (!this.visible || !this.modal.classList.contains('hidden')) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    switch (e.code) {
      case 'KeyQ':
        this.preview.turnStep(-1);
        break;
      case 'KeyE':
        this.preview.turnStep(1);
        break;
      case 'KeyZ':
      case 'Minus':
        this.preview.zoomBy(-1);
        break;
      case 'KeyX':
      case 'Equal':
        this.preview.zoomBy(1);
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
        this.setView(PREVIEW_FRAMES[Number(e.code.slice(-1)) - 1]);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------------ lifecycle
  /** Rebuild the preview (e.g. once the 3D models finish loading). */
  rebuild(): void {
    this.refreshCharacter(true);
  }

  show(v: boolean): void {
    if (v && !this.visible) {
      // every visit starts from the kept character
      this.draft = cloneAppearance(this.deps.profile.look);
      this.dirtyMark.classList.add('hidden');
      this.hideModal();
      this.selectCategory(this.category);
    }
    this.root.classList.toggle('hidden', !v);
    if (v) this.applySplit();
    this.preview.setActive(v);
    if (v) {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('resize', this.onResize);
      this.refreshCharacter(false);
    } else {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('resize', this.onResize);
    }
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
