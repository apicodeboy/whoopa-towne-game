import * as THREE from 'three';
import { GUN_SKINS, cloneAppearance, decodeAppearance, encodeAppearance, gunSkinField, type Appearance } from '@shared/config/appearance';
import { GUN_SKIN_PRICES, formatGrams, gunSkinItemId, catalogItem, RARITY_COLORS } from '@shared/config/economy';
import {
  COLLECTION, MELEE_IDS, PRIMARY_IDS, SECONDARY_IDS, THROWABLES, THROWABLE_IDS, WEAPONS, weaponBars,
  type Loadout, type ThrowableId, type WeaponDef, type WeaponId,
} from '@shared/config/weapons';
import type { Profile } from '../core/profile';
import { CharacterPreview } from '../game/characters/characterPreview';
import type { CharacterVisual, HeldItem } from '../game/characters/characterTypes';
import type { Assets } from '../game/assets';
import { GunIcons } from '../game/gunIcons';
import type { DeviceKind } from '../input/types';
import { ApiError, type AccountService } from '../net/account';
import { button, clear, el } from './dom';
import { glyphHtml } from './prompts';
import { promoRow } from './promoRow';

/**
 * WHOOPA TOWNE weapon collection: the gun picker. Browse every gun (numbered like the
 * collection sheet; card 12 is a choice of four SMGs), see its numbers, put it in your
 * loadout, and buy and wear skins for it with GRAMS (cosmetic only: a skin never changes a gun).
 *
 * Purchases go through the account exactly like AJ'S: the server checks the price, takes the
 * GRAMS and records the skin in one step, and only lets you wear what you own.
 */

type Tab = 'primary' | 'secondary' | 'melee' | 'special';
const TABS: ReadonlyArray<{ id: Tab; name: string }> = [
  { id: 'primary', name: 'PRIMARY' }, { id: 'secondary', name: 'SECONDARY' }, { id: 'melee', name: 'MELEE' }, { id: 'special', name: 'SPECIAL' },
];

/** One card on the right: a numbered gun (or a choice of guns), a melee or throwable, or a locked slot. */
interface Card {
  key: string;
  no: number | null;
  ids: readonly string[];
  locked?: boolean;
}

export interface GunPickerDeps {
  profile: Profile;
  account: AccountService;
  /** Builds a character for the preview. */
  build: (look: Appearance) => CharacterVisual;
  /** The loadout changed (saved already; send it to the lobby / match). */
  onLoadout: (loadout: Loadout) => void;
  /** Puts a look on (profile, lobby, match). */
  applyLook: (look: Appearance) => void;
  /** Sign in first (buying needs an account). */
  signIn: (then: () => void) => void;
  openGrams: () => void;
  device: () => DeviceKind;
  /** The model files (for the throwables' pictures; the guns are built in code). */
  assets: () => Assets | null;
  onClose: () => void;
}

/** An element whose content is (trusted, fixed) markup. */
function html(tag: keyof HTMLElementTagNameMap, cls: string, markup: string): HTMLElement {
  const e = el(tag, cls);
  e.innerHTML = markup;
  return e;
}

const nameOf = (id: string): string => (id in WEAPONS ? WEAPONS[id as WeaponId].name : THROWABLES[id as ThrowableId]?.name ?? id);
const isWeapon = (id: string): id is WeaponId => id in WEAPONS;

export class GunPicker {
  readonly root: HTMLElement;
  private deps: GunPickerDeps;
  private preview = new CharacterPreview();
  private icons: GunIcons | null = null;
  private iconRenderer: THREE.WebGLRenderer | null = null;
  private tab: Tab = 'primary';
  /** The gun shown in the middle (a weapon or throwable id). */
  private sel = 'draco';
  /** The skin previewed on it ('' = what you wear). */
  private skinSel = '';
  private shownKey = '';
  private tabsEl: HTMLElement;
  private gridEl: HTMLElement;
  private bigEl: HTMLElement;
  private titleEl: HTMLElement;
  private optionsEl: HTMLElement;
  private skinsEl: HTMLElement;
  private statsEl: HTMLElement;
  private loadoutEl: HTMLElement;
  private actionsEl: HTMLElement;
  private noteEl: HTMLElement;
  private promptsEl: HTMLElement;
  private balanceEl: HTMLElement;
  private busy = false;

  constructor(parent: HTMLElement, deps: GunPickerDeps) {
    this.deps = deps;
    const close = button('', 'gp-close', () => this.show(false));
    close.innerHTML = '<span>‹</span> BACK';
    close.dataset.back = '1';
    this.balanceEl = el('div', 'gp-balance');
    this.tabsEl = el('div', 'gp-tabs');
    this.gridEl = el('div', 'gp-grid');
    this.titleEl = el('div', 'gp-wtitle');
    this.bigEl = el('div', 'gp-big');
    this.optionsEl = el('div', 'gp-options');
    this.skinsEl = el('div', 'gp-skins');
    this.statsEl = el('div', 'gp-stats');
    this.loadoutEl = el('div', 'gp-loadout');
    this.actionsEl = el('div', 'gp-actions');
    this.noteEl = el('div', 'gp-note');
    this.promptsEl = el('div', 'gp-prompts');
    const prev = button('‹', 'gp-arrow', () => this.step(-1));
    const next = button('›', 'gp-arrow', () => this.step(1));
    const stage = el('div', 'gp-stage', [this.preview.canvas]);
    const left = el('div', 'gp-left', [
      el('div', 'gp-brand', [html('div', 'gp-logo', 'WHOOPA<br><b>TOWNE</b>'), el('div', 'gp-sub', 'GUN PICKER')]),
      stage,
    ]);
    const mid = el('div', 'gp-mid', [
      el('div', 'gp-panel', [
        this.titleEl,
        el('div', 'gp-bigrow', [prev, this.bigEl, next]),
        this.optionsEl,
        this.skinsEl,
        this.statsEl,
        this.actionsEl,
        this.noteEl,
      ]),
      el('div', 'gp-panel gp-lo', [el('div', 'gp-h', 'EQUIPPED LOADOUT'), this.loadoutEl]),
    ]);
    const right = el('div', 'gp-right', [el('div', 'gp-ctitle', 'WHOOPA TOWNE WEAPON COLLECTION'), this.tabsEl, this.gridEl]);
    this.root = el('div', 'screen gunpicker hidden', [
      el('div', 'gp-top', [close, this.balanceEl]),
      el('div', 'gp-body', [left, mid, right]),
      this.promptsEl,
    ]);
    parent.append(this.root);
    deps.account.onChange(() => {
      if (this.visible) this.render();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    this.preview.setActive(v);
    if (!v) {
      this.deps.onClose();
      return;
    }
    void this.deps.account.refresh?.().catch(() => undefined);
    this.sel = this.deps.profile.loadout.primary;
    this.tab = 'primary';
    this.skinSel = '';
    this.render();
  }

  // ------------------------------------------------------------------ pictures
  private icon(id: string, skin = 'none'): string {
    if (!this.icons) {
      try {
        this.iconRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        this.iconRenderer.setSize(320, 160, false);
        this.icons = new GunIcons(this.iconRenderer, this.deps.assets());
      } catch {
        return '';
      }
    }
    return this.icons.get(id, skin);
  }

  // ------------------------------------------------------------------ the collection
  private cards(): Card[] {
    switch (this.tab) {
      case 'primary': {
        const out: Card[] = COLLECTION.map((c) => ({ key: `c${c.no}`, no: c.no, ids: c.ids }));
        for (const no of [13, 14, 15]) out.push({ key: `c${no}`, no, ids: [], locked: true });
        return out;
      }
      case 'secondary':
        return SECONDARY_IDS.map((id) => ({ key: id, no: COLLECTION.find((c) => c.ids.includes(id))?.no ?? null, ids: [id] }));
      case 'melee':
        return MELEE_IDS.map((id) => ({ key: id, no: null, ids: [id] }));
      default:
        return THROWABLE_IDS.map((id) => ({ key: id, no: null, ids: [id] }));
    }
  }

  /** Which of a card's guns it stands for right now (card 12: the one you carry, or the last one looked at). */
  private cardGun(c: Card): string {
    if (c.ids.includes(this.sel)) return this.sel;
    const lo = this.deps.profile.loadout;
    return c.ids.find((id) => id === lo.primary || id === lo.secondary) ?? c.ids[0];
  }

  private step(d: number): void {
    const list = this.cards().filter((c) => !c.locked).flatMap((c) => c.ids);
    const i = Math.max(0, list.indexOf(this.sel));
    this.pick(list[(i + d + list.length) % list.length]);
  }

  private pick(id: string): void {
    this.sel = id;
    this.skinSel = '';
    this.render();
  }

  // ------------------------------------------------------------------ what you wear and carry
  private look(): Appearance {
    return this.deps.profile.look;
  }

  private wornSkin(gun: string): string {
    return (this.look() as unknown as Record<string, string>)[gunSkinField(gun)] ?? 'none';
  }

  private owns(gun: string, skin: string): boolean {
    return skin === 'none' || this.deps.account.owns(gunSkinItemId(gun, skin));
  }

  /** The loadout slot a weapon goes in. */
  private slotOf(id: string): keyof Loadout | null {
    if (THROWABLE_IDS.includes(id as ThrowableId)) return 'throwable';
    if (!isWeapon(id)) return null;
    const k = WEAPONS[id].kind;
    return k === 'primary' ? 'primary' : k === 'secondary' ? 'secondary' : 'melee';
  }

  private equipped(id: string): boolean {
    const slot = this.slotOf(id);
    return !!slot && this.deps.profile.loadout[slot] === id;
  }

  private equip(id: string): void {
    const slot = this.slotOf(id);
    if (!slot) return;
    const lo = { ...this.deps.profile.loadout, [slot]: id } as Loadout;
    this.deps.profile.setLoadout(lo);
    this.deps.onLoadout(this.deps.profile.loadout);
    this.render();
  }

  private async wearSkin(gun: string, skin: string): Promise<void> {
    const look: Appearance = { ...cloneAppearance(this.look()), [gunSkinField(gun)]: skin };
    try {
      const code = this.deps.account.signedIn ? await this.deps.account.equip(encodeAppearance(look)) : encodeAppearance(look);
      this.deps.applyLook(decodeAppearance(code));
      this.skinSel = '';
    } catch (err) {
      this.noteEl.textContent = err instanceof ApiError ? err.message : 'Could not put that skin on.';
    }
    this.render();
  }

  private async buySkin(gun: string, skin: string): Promise<void> {
    if (!this.deps.account.signedIn) {
      this.deps.signIn(() => void this.buySkin(gun, skin));
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.noteEl.textContent = 'Buying…';
    try {
      // the server checks the price and your balance, and records the skin, all in one go
      await this.deps.account.buy(gunSkinItemId(gun, skin));
      await this.wearSkin(gun, skin);
      this.noteEl.textContent = `${GUN_SKINS.find((s) => s.id === skin)?.name ?? 'Skin'} is yours, and it's on.`;
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      this.noteEl.innerHTML = e?.code === 'insufficient_funds' ? `Not enough GRAMS. <button class="gp-link">Re-up</button>` : e?.message ?? 'That did not go through. You were not charged.';
      this.noteEl.querySelector('.gp-link')?.addEventListener('click', () => this.deps.openGrams());
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /** A skin for a promo code: sign in first if needed; on success it goes straight on. */
  private async redeemSkin(gun: string, skin: string, code: string): Promise<void> {
    if (!this.deps.account.signedIn) {
      this.deps.signIn(() => this.render());
      throw new ApiError('signed_out', 'Sign in first, then apply the code.', 401);
    }
    await this.deps.account.redeem(gunSkinItemId(gun, skin), code);
    await this.wearSkin(gun, skin);
    this.noteEl.textContent = `${GUN_SKINS.find((s) => s.id === skin)?.name ?? 'Skin'} unlocked with a promo code, and it's on.`;
    this.render();
  }

  // ------------------------------------------------------------------ drawing
  private render(): void {
    const a = this.deps.account.account;
    this.balanceEl.innerHTML = a ? `<b>${formatGrams(a.balance)}</b> GRAMS` : '<span>Sign in to buy skins</span>';

    // tabs
    clear(this.tabsEl);
    for (const t of TABS) {
      const b = button(t.name, `gp-tab${this.tab === t.id ? ' on' : ''}`, () => {
        this.tab = t.id;
        const first = this.cards().find((c) => !c.locked);
        if (first) this.sel = this.cardGun(first);
        this.render();
      });
      this.tabsEl.append(b);
    }

    // the cards
    clear(this.gridEl);
    for (const c of this.cards()) {
      if (c.locked) {
        const b = el('div', 'gp-card locked', [el('div', 'gp-lock', '🔒'), el('div', 'gp-cname', `${c.no}. LOCKED`)]);
        this.gridEl.append(b);
        continue;
      }
      const id = this.cardGun(c);
      const multi = c.ids.length > 1;
      const on = c.ids.includes(this.sel);
      const card = button('', `gp-card${on ? ' on' : ''}${c.ids.some((x) => this.equipped(x)) ? ' eq' : ''}`, () => this.pick(id));
      const img = this.icon(id, isWeapon(id) ? this.wornSkin(id) : 'none');
      card.innerHTML = `${img ? `<img src="${img}" alt="">` : ''}${multi && !c.ids.includes(this.deps.profile.loadout.primary) && !on ? '<span class="gp-q">?</span>' : ''}`
        + `<span class="gp-cname">${c.no ? `${c.no}. ` : ''}${multi && !on && !c.ids.includes(this.deps.profile.loadout.primary) ? 'SELECT WEAPON' : nameOf(id).toUpperCase()}</span>`;
      this.gridEl.append(card);
    }

    // the selected gun
    const id = this.sel;
    const gun = isWeapon(id) && WEAPONS[id].kind !== 'melee';
    const card = COLLECTION.find((c) => c.ids.includes(id as WeaponId));
    this.titleEl.innerHTML = card ? `WEAPON <i>${card.no}</i> – ${card.ids.length > 1 ? 'SELECT' : nameOf(id).toUpperCase()}` : nameOf(id).toUpperCase();
    const skin = this.skinSel || (gun ? this.wornSkin(id) : 'none');
    const big = this.icon(id, skin);
    this.bigEl.innerHTML = big ? `<img src="${big}" alt="${nameOf(id)}">` : '';

    // card 12: the four to choose from
    clear(this.optionsEl);
    if (card && card.ids.length > 1) {
      this.optionsEl.append(html('div', 'gp-h', `WEAPON ${card.no} <span>(OPTIONS)</span>`));
      const row = el('div', 'gp-row');
      for (const opt of card.ids) {
        const b = button('', `gp-opt${opt === id ? ' on' : ''}`, () => this.pick(opt));
        b.innerHTML = `<img src="${this.icon(opt, this.wornSkin(opt))}" alt=""><span>${nameOf(opt).toUpperCase()}</span>`;
        row.append(b);
      }
      this.optionsEl.append(row);
    }

    // skins (guns only)
    clear(this.skinsEl);
    if (gun) {
      this.skinsEl.append(html('div', 'gp-h', 'SKINS <span>(cosmetic only)</span>'));
      const row = el('div', 'gp-row gp-skinrow');
      for (const s of GUN_SKINS) {
        const owned = this.owns(id, s.id), worn = this.wornSkin(id) === s.id;
        const price = GUN_SKIN_PRICES[s.id];
        const b = button('', `gp-skin${skin === s.id ? ' on' : ''}${worn ? ' worn' : ''}`, () => {
          this.skinSel = s.id;
          this.render();
        });
        const tag = worn ? 'ON' : owned ? 'OWNED' : price ? `${formatGrams(price.grams * 10)} G` : '';
        b.innerHTML = `<img src="${this.icon(id, s.id)}" alt=""><span>${s.name}</span><em style="${price && !owned ? `color:${RARITY_COLORS[price.rarity]}` : ''}">${tag}</em>`;
        row.append(b);
      }
      this.skinsEl.append(row);
    }

    // stats
    clear(this.statsEl);
    if (isWeapon(id)) {
      const w = WEAPONS[id];
      const bars = weaponBars(w);
      const bar = (label: string, v: number) => el('div', 'gp-stat', [el('span', '', label), el('div', 'gp-bar', [Object.assign(el('i'), { style: `width:${Math.round(v * 100)}%` })])]);
      this.statsEl.append(bar('DAMAGE', bars.damage), bar('FIRE RATE', bars.fireRate), bar('ACCURACY', bars.accuracy), bar('RANGE', bars.range), bar('CONTROL', bars.control));
      this.statsEl.append(el('div', 'gp-facts', facts(w)));
      this.statsEl.append(el('div', 'gp-blurb', w.blurb));
    } else {
      this.statsEl.append(el('div', 'gp-blurb', THROWABLES[id as ThrowableId]?.blurb ?? ''));
    }

    // what you can do
    clear(this.actionsEl);
    const slot = this.slotOf(id);
    if (slot) {
      const eq = this.equipped(id);
      this.actionsEl.append(button(eq ? 'EQUIPPED' : `EQUIP AS ${slot.toUpperCase()}`, `gp-btn${eq ? ' done' : ''}`, () => this.equip(id)));
    }
    if (gun && this.skinSel && this.skinSel !== this.wornSkin(id)) {
      const s = this.skinSel;
      if (this.owns(id, s)) this.actionsEl.append(button(s === 'none' ? 'BACK TO FACTORY' : 'WEAR SKIN', 'gp-btn gold', () => void this.wearSkin(id, s)));
      else {
        const it = catalogItem(gunSkinItemId(id, s));
        this.actionsEl.append(button(`BUY · ${it ? formatGrams(it.price) : '?'} GRAMS`, 'gp-btn gold', () => void this.buySkin(id, s)));
        // a promo code gets the skin free (only where the server takes codes)
        if (this.deps.account.promos) this.actionsEl.append(promoRow((code) => this.redeemSkin(id, s, code), 'gp-promo'));
      }
    }
    if (!this.busy && !this.noteEl.textContent) this.noteEl.textContent = '';

    // the loadout
    clear(this.loadoutEl);
    const lo = this.deps.profile.loadout;
    const slots: Array<[string, string]> = [['1', lo.primary], ['2', lo.secondary], ['3', lo.throwable], ['4', lo.melee]];
    for (const [n, item] of slots) {
      const b = button('', `gp-slot${item === id ? ' on' : ''}`, () => this.pick(item));
      const img = this.icon(item, isWeapon(item) ? this.wornSkin(item) : 'none');
      b.innerHTML = `<i>${n}</i>${img ? `<img src="${img}" alt="">` : ''}<span>${nameOf(item)}</span>`;
      this.loadoutEl.append(b);
    }

    // the character holding it
    const shown: Appearance = gun ? { ...cloneAppearance(this.look()), [gunSkinField(id)]: skin } : cloneAppearance(this.look());
    const key = encodeAppearance(shown);
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.preview.setCharacter(this.deps.build(shown));
    }
    this.preview.setHeld((isWeapon(id) && id !== 'fists' ? id : THROWABLE_IDS.includes(id as ThrowableId) ? 'grenade' : 'none') as HeldItem);

    // prompts
    const d = this.deps.device();
    this.promptsEl.innerHTML = d === 'touch' ? '' : `<span>${glyphHtml(d, 'accept')} SELECT</span><span>${glyphHtml(d, 'back')} BACK</span>`;
  }
}

/** The plain numbers under the bars. */
function facts(w: WeaponDef): string {
  if (w.kind === 'melee') return `${w.damage} damage · ${w.range} m reach · ${Math.round(w.rpm)} swings a minute`;
  const dmg = w.pellets > 1 ? `${w.damage} × ${w.pellets} pellets` : `${w.damage} damage`;
  return `${dmg} · ${w.rpm} RPM${w.auto ? ' auto' : ''} · ${w.magSize} rounds · ${w.reloadTime.toFixed(1)} s reload · falls off ${w.falloffStart}–${w.falloffEnd} m${w.suppressed ? ' · suppressed' : ''}`;
}

void PRIMARY_IDS;
