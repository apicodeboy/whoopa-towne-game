import {
  BODY_DETAILS, BODY_TYPES, BOTTOMS, BOTTOM_COLORS, BROWS, BUILDS, DEFAULT_APPEARANCE, EARRINGS, EARS, EXPRESSIONS, EYE_COLORS,
  EYE_SHAPES, FACE_ACCESSORIES, FACE_SHAPES, FACIAL_HAIR, GLASSES, HAIRSTYLES, HAIR_COLORS, HATS, HEAD_SHAPES, HEIGHTS, LIPS,
  MOUTH_ACCESSORIES, MOUTH_PROPS, NECKLACES, NOSES, SHOES, SHOE_COLORS, SKIN_TONES, TATTOO_DESIGNS, TATTOO_SPOTS, TEETH, TOPS,
  TOP_COLORS, WRIST, cloneAppearance, randomAppearance, sameAppearance, type Appearance, type LookField, type LookOption,
} from '@shared/config/appearance';
import type { Profile } from '../core/profile';
import { CharacterPreview, PREVIEW_FRAMES, type PreviewFrame } from '../game/characters/characterPreview';
import type { CharacterVisual } from '../game/characters/characterTypes';
import { button, clear, el } from './dom';

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

type Kind = 'cards' | 'swatches' | 'expression' | 'details' | 'locked';

interface Sub {
  id: string;
  name: string;
  field?: LookField;
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
  expr: ic('<circle cx="12" cy="12" r="8.5" fill="none" stroke-width="1.8"/><circle cx="9" cy="10" r="1.1"/><circle cx="15" cy="10" r="1.1"/><path d="M8.3 14c2 2.6 5.4 2.6 7.4 0" fill="none" stroke-width="1.7"/>'),
  hair: ic('<path d="M4.5 14c0-6 3.5-9.5 7.5-9.5S19.5 8 19.5 14c-1.3-2.4-3-3.6-4.4-4-1 1.6-3.4 2.4-6.2 2.4-1.6 0-3 .6-4.4 1.6z"/><path d="M6 15v4M18 15v4" stroke-width="1.6"/>'),
  mouth: ic('<path d="M3 12c3-3.5 6-4 9-2 3-2 6-1.5 9 2-3 4-6 5.5-9 5.5S6 16 3 12z"/><path d="M5 12h14" stroke="#14161d" stroke-width="1.2"/>'),
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

const sub = (id: string, name: string, field: LookField | undefined, kind: Kind, options: readonly LookOption[], frame: PreviewFrame, note?: string): Sub => ({ id, name, field, kind, options, frame, note });

export const CATEGORIES: Category[] = [
  {
    id: 'body', name: 'Body', icon: ICONS.body, subs: [
      sub('bodyType', 'Body Type', 'bodyType', 'cards', BODY_TYPES, 'full', 'Body types are looks only: every outfit and accessory fits all of them.'),
      sub('build', 'Body Build', 'build', 'cards', BUILDS, 'full'),
      sub('height', 'Height', 'height', 'cards', HEIGHTS, 'full', 'Height is visual only: everyone has the same hitbox.'),
      sub('skin', 'Skin Tone', 'skin', 'swatches', SKIN_TONES, 'upper'),
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
      sub('ears', 'Ears', 'ears', 'cards', EARS, 'face'),
    ],
  },
  {
    id: 'expr', name: 'Expressions', icon: ICONS.expr, subs: [
      sub('expression', 'Expression', undefined, 'expression', EXPRESSIONS, 'face', 'Preview only: your character goes back to a relaxed face.'),
    ],
  },
  {
    id: 'hair', name: 'Hair', icon: ICONS.hair, subs: [
      sub('hair', 'Hairstyle', 'hair', 'cards', HAIRSTYLES, 'face'),
      sub('hairColor', 'Hair Color', 'hairColor', 'swatches', HAIR_COLORS, 'face'),
      sub('facialHair', 'Facial Hair', 'facialHair', 'cards', FACIAL_HAIR, 'face'),
      sub('facialHairColor', 'Facial Hair Color', 'facialHairColor', 'swatches', HAIR_COLORS, 'face', 'Eyebrows use this color too.'),
    ],
  },
  {
    id: 'mouth', name: 'Mouth & Teeth', icon: ICONS.mouth, subs: [
      sub('lips', 'Mouth', 'lips', 'cards', LIPS, 'face'),
      sub('mouthAcc', 'Mouth Accessory', 'mouthAcc', 'cards', MOUTH_ACCESSORIES, 'face'),
      sub('mouthProp', 'In Mouth', 'mouthProp', 'cards', MOUTH_PROPS, 'face'),
      sub('teeth', 'Teeth', 'teeth', 'cards', TEETH, 'face', 'Teeth show when you smile (try Expressions) or wear a grill.'),
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
    ],
  },
  {
    id: 'jewelry', name: 'Jewelry & Accessories', icon: ICONS.jewelry, subs: [
      sub('earrings', 'Earrings', 'earrings', 'cards', EARRINGS, 'face'),
      sub('necklace', 'Necklaces', 'necklace', 'cards', NECKLACES, 'upper'),
      sub('wrist', 'Wrist', 'wrist', 'cards', WRIST, 'upper'),
      sub('faceAcc', 'Face Accessories', 'faceAcc', 'cards', FACE_ACCESSORIES, 'face'),
    ],
  },
  {
    id: 'tattoos', name: 'Tattoos & Details', icon: ICONS.ink, subs: [
      sub('tattooSpot', 'Tattoo Location', undefined, 'locked', [{ id: 'none', name: 'None' }, ...TATTOO_SPOTS.map((o) => ({ ...o, available: false }))], 'upper', 'Tattoos are coming in a later update.'),
      sub('tattooDesign', 'Tattoo Design', undefined, 'locked', TATTOO_DESIGNS, 'upper', 'Tattoos are coming in a later update.'),
      sub('details', 'Other Details', undefined, 'details', BODY_DETAILS, 'face', 'Pick any combination.'),
    ],
  },
];

const SOON = 'Coming soon';

export interface CharacterScreenDeps {
  profile: Profile;
  /** Builds a character for the preview (null while the models are loading). */
  build: (look: Appearance) => CharacterVisual;
  /** The player kept a new look. */
  onKeep: (look: Appearance) => void;
  onClose: () => void;
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
  private panelTitle: HTMLElement;
  private panelBack: HTMLButtonElement;
  private panelBody: HTMLElement;
  private panelNote: HTMLElement;
  private viewButtons = new Map<PreviewFrame, HTMLButtonElement>();
  private headerBack: HTMLButtonElement;
  private dirtyMark: HTMLElement;
  private modal: HTMLElement;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(parent: HTMLElement, deps: CharacterScreenDeps) {
    this.deps = deps;
    this.draft = cloneAppearance(deps.profile.look);

    // ---- header
    this.headerBack = button('', 'btn small ghost cc-exit', () => this.requestClose());
    this.headerBack.innerHTML = `${UI.left}<span>BACK</span>`;
    this.headerBack.dataset.back = '1';
    this.dirtyMark = el('span', 'cc-dirty hidden', 'UNSAVED CHANGES');
    const header = el('div', 'cc-head', [
      this.headerBack,
      el('div', 'cc-title', [el('b', '', 'CHARACTER'), el('span', '', ' CREATOR')]),
      this.dirtyMark,
    ]);

    // ---- left: categories
    this.catList = el('nav', 'cc-cats');
    this.catList.setAttribute('aria-label', 'Customization categories');
    for (const c of CATEGORIES) {
      const b = button('', 'cc-cat', () => this.selectCategory(c));
      b.innerHTML = `<i>${c.icon}</i><span>${c.name}</span>`;
      b.title = c.name;
      this.catButtons.set(c.id, b);
      this.catList.append(b);
    }

    // ---- center: preview + view / rotate / zoom
    const views = el('div', 'segmented small cc-views');
    for (const f of PREVIEW_FRAMES) {
      const b = button(f === 'full' ? 'BODY' : f === 'upper' ? 'UPPER' : 'FACE', 'seg', () => this.setView(f));
      b.title = `${f === 'full' ? 'Full body' : f === 'upper' ? 'Upper body' : 'Face close-up'} (${PREVIEW_FRAMES.indexOf(f) + 1})`;
      this.viewButtons.set(f, b);
      views.append(b);
    }
    const hold = (icon: string, title: string, dir: number) => {
      const b = button('', 'btn small ghost cc-round', () => undefined);
      b.innerHTML = icon;
      b.title = title;
      b.setAttribute('aria-label', title);
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
    const zoomBtn = (label: string, title: string, steps: number) => {
      const b = button(label, 'btn small ghost cc-round', () => this.preview.zoomBy(steps));
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };
    const stage = el('div', 'cc-stage', [
      this.preview.canvas,
      el('div', 'cc-hint', 'Drag to turn · scroll or pinch to zoom'),
    ]);
    this.preview.onUserTurn = () => stage.classList.add('touched');

    // ---- right: items / options
    this.panelBack = button('', 'btn small ghost cc-pback', () => this.closeOptions());
    this.panelBack.innerHTML = UI.left;
    this.panelBack.setAttribute('aria-label', 'Back');
    this.panelTitle = el('div', 'cc-ptitle');
    this.panelBody = el('div', 'cc-pbody');
    this.panelNote = el('div', 'cc-pnote');
    const panel = el('section', 'cc-panel', [el('div', 'cc-phead', [this.panelBack, this.panelTitle]), this.panelBody, this.panelNote]);

    // ---- bottom bar
    const keep = button('KEEP CHARACTER', 'btn primary big cc-keep', () => this.confirmKeep());
    const bar = el('div', 'cc-bar', [
      el('div', 'cc-group', [hold(UI.turnL, 'Turn left (Q)', -1), hold(UI.turnR, 'Turn right (E)', 1)]),
      el('div', 'cc-group', [zoomBtn('−', 'Zoom out (Z)', -1), zoomBtn('+', 'Zoom in (X)', 1)]),
      views,
      el('div', 'cc-group cc-tools', [
        button('RANDOMIZE', 'btn small', () => this.randomize()),
        button('RESET', 'btn small', () => this.reset()),
      ]),
      keep,
    ]);

    this.modal = el('div', 'cc-modal hidden');
    this.root = el('div', 'screen overlay creator hidden', [
      el('div', 'cc-shell', [header, el('div', 'cc-main', [this.catList, stage, panel]), bar]),
      this.modal,
    ]);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Character Creator');
    parent.append(this.root);
    this.selectCategory(CATEGORIES[0]);
  }

  // ------------------------------------------------------------------ navigation
  private selectCategory(c: Category): void {
    this.category = c;
    for (const [id, b] of this.catButtons) {
      b.classList.toggle('on', id === c.id);
      b.setAttribute('aria-pressed', String(id === c.id));
    }
    // single-item categories go straight to their options
    if (c.subs.length === 1) this.openOptions(c.subs[0]);
    else {
      this.open = null;
      this.renderPanel();
      this.setView(c.subs[0].frame);
    }
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
    if (this.category.subs.length === 1 || !this.open) return;
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
    const nested = s !== null && this.category.subs.length > 1;
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
      for (const item of this.category.subs) this.panelBody.append(this.itemRow(item));
      return;
    }
    this.panelBody.className = `cc-pbody ${s.kind === 'swatches' ? 'swatches' : 'cards'}`;
    for (const o of s.options) this.panelBody.append(this.optionButton(s, o));
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
        const ok = s.options.filter((o) => o.available !== false);
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

  private optionButton(s: Sub, o: LookOption): HTMLButtonElement {
    const locked = o.available === false;
    const selected = this.isSelected(s, o);
    const b = button('', `cc-opt ${s.kind === 'swatches' ? 'swatch' : 'card'}${selected ? ' on' : ''}${locked ? ' locked' : ''}`, () => {
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
      b.title = `${o.name} · ${SOON}`;
    }
    if (s.kind === 'swatches') {
      b.style.setProperty('--sw', o.color ?? '#888');
      b.title = o.name;
      b.setAttribute('aria-label', o.name);
      b.append(el('i', 'cc-sw'), el('span', 'cc-swname', o.name));
    } else {
      b.append(el('span', 'cc-oname', o.name));
      if (locked) b.append(el('span', 'cc-soon', 'SOON'));
      if (s.kind === 'details') b.append(el('span', 'cc-check', selected ? '✓' : ''));
    }
    return b;
  }

  private isSelected(s: Sub, o: LookOption): boolean {
    if (s.kind === 'details') return this.draft.details.includes(o.id);
    if (s.kind === 'locked') return o.id === 'none';
    if (s.kind === 'expression') return o.id === 'neutral';
    return !!s.field && this.draft[s.field] === o.id;
  }

  private choose(s: Sub, o: LookOption): void {
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
  }

  // ------------------------------------------------------------------ draft
  private changed(): void {
    this.dirtyMark.classList.toggle('hidden', sameAppearance(this.draft, this.deps.profile.look));
    this.queueRebuild();
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
    this.preview.setActive(v);
    if (v) {
      window.addEventListener('keydown', this.onKey);
      this.refreshCharacter(false);
    } else {
      window.removeEventListener('keydown', this.onKey);
    }
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
