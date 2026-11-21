import { DEFAULT_APPEARANCE, cloneAppearance, decodeAppearance, encodeAppearance, isPremiumOption, type Appearance } from '@shared/config/appearance';
import {
  RARITIES, STORE_CATEGORIES, TRAP_CATEGORIES, formatGrams, formatUsd, trapCategory,
  type ItemRarity, type StoreCategory, type StoreItem, type TrapCategory,
} from '@shared/config/economy';
import type { Profile } from '../core/profile';
import { CharacterPreview } from '../game/characters/characterPreview';
import type { CharacterVisual } from '../game/characters/characterTypes';
import { ApiError, type AccountService } from '../net/account';
import { button, clear, el } from './dom';
import { ED, tool } from './editorKit';
import { gIcon, gramsHtml, itemArt, rarityTag } from './economyArt';

export interface EconomyDeps {
  account: AccountService;
  profile: Profile;
  /** Builds a character for a look (3D preview). */
  build: (look: Appearance) => CharacterVisual;
  /** The player now wears this look (saved to the profile, sent to the lobby). */
  applyLook: (look: Appearance) => void;
}

/** A look with an item put on. */
export function wearing(look: Readonly<Appearance>, item: StoreItem): Appearance {
  return { ...cloneAppearance(look), ...(item.equip as Partial<Appearance>) };
}

/** A look with an item taken off (each of its fields back to a free default). */
export function without(look: Readonly<Appearance>, item: StoreItem): Appearance {
  const out = cloneAppearance(look) as unknown as Record<string, string>;
  for (const field of Object.keys(item.equip)) {
    const def = (DEFAULT_APPEARANCE as unknown as Record<string, string>)[field];
    if (out[field] === (item.equip as Record<string, string>)[field] || isPremiumOption(field, out[field])) out[field] = def;
  }
  return out as unknown as Appearance;
}

/** Is everything this item puts on currently worn? */
export function isWorn(look: Readonly<Appearance>, item: StoreItem): boolean {
  return Object.entries(item.equip).every(([f, v]) => (look as unknown as Record<string, string>)[f] === v);
}

/** The gun a weapon-skin preview holds. */
const SKIN_PREVIEW_GUN = 'draco' as const;

// ===================================================================== pieces shared by the screens
function header(title: string, sub: string, onBack: () => void, account: AccountService, onGrams: () => void): { root: HTMLElement; balance: HTMLElement } {
  const back = button('', 'eco-back', onBack);
  back.innerHTML = '<span aria-hidden="true">←</span> Back';
  back.dataset.back = '1';
  const balance = button('', 'eco-bal', onGrams);
  balance.title = 'Your GRAMS (buy more)';
  const root = el('header', 'eco-head', [back, el('div', 'eco-title', [el('h1', '', title), el('p', '', sub)]), balance]);
  const fill = () => {
    balance.innerHTML = account.account ? `${gramsHtml(account.account.balance, 20)}<span class="eco-plus">+</span>` : `${gIcon(20)}<span>Sign in</span>`;
  };
  fill();
  account.onChange(fill);
  return { root, balance };
}

/** Puts a screen on top of whatever else is open (AJ's can open GRAMS, TRAP can open AJ's...). */
function toFront(root: HTMLElement): void {
  if (root.parentElement && root.parentElement.lastElementChild !== root) root.parentElement.append(root);
}

/** A small modal inside a screen. */
class Dialog {
  readonly root: HTMLElement;
  private box: HTMLElement;
  constructor(parent: HTMLElement) {
    this.box = el('div', 'eco-dialog');
    this.root = el('div', 'eco-dim hidden', [this.box]);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.append(this.root);
  }
  open(content: Array<HTMLElement | string>, actions: HTMLButtonElement[]): void {
    clear(this.box);
    for (const c of content) this.box.append(typeof c === 'string' ? el('p', '', c) : c);
    this.box.append(el('div', 'eco-dialog-actions', actions));
    if (actions[0]) actions[0].dataset.back = '1';
    this.root.classList.remove('hidden');
    actions[actions.length - 1]?.focus();
  }
  close(): void {
    this.root.classList.add('hidden');
  }
}

// ===================================================================== sign in
export class AuthModal {
  readonly root: HTMLElement;
  private mode: 'login' | 'register' = 'login';
  private user: HTMLInputElement;
  private pass: HTMLInputElement;
  private msg: HTMLElement;
  private title: HTMLElement;
  private submit: HTMLButtonElement;
  private switcher: HTMLButtonElement;
  private done: (() => void) | null = null;
  private account: AccountService;

  constructor(parent: HTMLElement, account: AccountService) {
    this.account = account;
    this.title = el('h2', '', 'Sign in');
    this.user = el('input', 'eco-input');
    this.user.placeholder = 'Username';
    this.user.autocomplete = 'username';
    this.user.maxLength = 12;
    this.user.addEventListener('input', () => (this.user.value = this.user.value.replace(/[^A-Za-z0-9]/g, '')));
    this.pass = el('input', 'eco-input');
    this.pass.type = 'password';
    this.pass.placeholder = 'Password (8+ characters)';
    this.pass.autocomplete = 'current-password';
    this.msg = el('p', 'eco-msg');
    this.submit = button('Sign in', 'eco-btn gold', () => void this.go());
    this.switcher = button('New here? Create an account', 'eco-link', () => this.setMode(this.mode === 'login' ? 'register' : 'login'));
    const cancel = button('Not now', 'eco-btn ghost', () => this.show(false));
    cancel.dataset.back = '1';
    for (const i of [this.user, this.pass]) i.addEventListener('keydown', (e) => e.key === 'Enter' && void this.go());
    const box = el('form', 'eco-dialog eco-auth', [
      el('div', 'eco-auth-mark', []), this.title,
      el('p', 'eco-note', 'Your GRAMS, your TRAP and your fits live on your account, on any device.'),
      this.user, this.pass, this.msg,
      el('div', 'eco-dialog-actions', [cancel, this.submit]),
      this.switcher,
    ]);
    (box.firstChild as HTMLElement).innerHTML = gIcon(44);
    box.addEventListener('submit', (e) => e.preventDefault());
    this.root = el('div', 'screen eco-dim eco-auth-wrap hidden', [box]);
    parent.append(this.root);
  }

  private setMode(m: 'login' | 'register'): void {
    this.mode = m;
    this.title.textContent = m === 'login' ? 'Sign in' : 'Create your account';
    this.submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
    this.switcher.textContent = m === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
    this.pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    this.msg.textContent = m === 'register' ? 'Username: 3 to 12 letters and numbers. It is also your name in matches.' : '';
  }

  private async go(): Promise<void> {
    this.submit.disabled = true;
    this.msg.textContent = '…';
    try {
      if (this.mode === 'login') await this.account.login(this.user.value, this.pass.value);
      else await this.account.register(this.user.value, this.pass.value);
      this.pass.value = '';
      this.show(false);
      const d = this.done;
      this.done = null;
      d?.();
    } catch (err) {
      this.msg.textContent = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      this.submit.disabled = false;
    }
  }

  /** Opens; `then` runs after a successful sign-in. */
  open(then?: () => void, mode: 'login' | 'register' = 'login'): void {
    this.done = then ?? null;
    this.setMode(mode);
    this.show(true);
    setTimeout(() => this.user.focus(), 30);
  }

  show(v: boolean): void {
    if (v) toFront(this.root);
    this.root.classList.toggle('hidden', !v);
  }
}

// ===================================================================== GRAMS
export class GramsScreen {
  readonly root: HTMLElement;
  private deps: EconomyDeps & { auth: AuthModal };
  private status: HTMLElement;
  private cards: HTMLElement;
  private banner: HTMLElement;
  private busy = false;
  private abort: AbortController | null = null;

  constructor(parent: HTMLElement, deps: EconomyDeps & { auth: AuthModal }) {
    this.deps = deps;
    const head = header('GRAMS', 'The official currency of WHOOPA TOWNE', () => this.show(false), deps.account, () => undefined);
    this.banner = el('div', 'eco-banner hidden');
    this.cards = el('div', 'grams-cards');
    this.status = el('p', 'grams-status');
    const fine = el('p', 'eco-fine', 'GRAMS are for digital items in WHOOPA TOWNE only. They have no cash value, cannot be traded or transferred, and are tied to your account.');
    this.root = el('div', 'screen eco grams hidden', [head.root, el('div', 'eco-main grams-main', [this.banner, this.cards, this.status, fine])]);
    parent.append(this.root);
    this.render();
    deps.account.onChange(() => this.render());
  }

  private render(): void {
    const a = this.deps.account;
    const p = a.provider;
    this.banner.classList.toggle('hidden', p === 'stripe');
    this.banner.textContent = p === 'dev' ? 'TEST PAYMENTS: this server takes no real money. Use it to try the flow.' : 'Buying GRAMS is not set up on this server yet.';
    this.banner.classList.toggle('warn', p !== 'dev');
    clear(this.cards);
    a.packages.forEach((pkg, i) => {
      const buy = button('Buy', 'eco-btn gold', () => void this.buy(pkg.id));
      buy.disabled = !p || this.busy;
      const card = el('div', `grams-card tier${i}`, [
        el('div', 'grams-coins'),
        el('div', 'grams-qty'),
        el('div', 'grams-price', formatUsd(pkg.priceCents)),
        buy,
      ]);
      (card.children[0] as HTMLElement).innerHTML = Array.from({ length: i + 1 }, () => gIcon(46 - i * 4)).join('');
      (card.children[1] as HTMLElement).innerHTML = `<b>${formatGrams(pkg.units)}</b> GRAMS`;
      if (pkg.badge) card.prepend(el('span', 'grams-badge', pkg.badge));
      this.cards.append(card);
    });
  }

  private async buy(packageId: string): Promise<void> {
    const a = this.deps.account;
    if (!a.signedIn) {
      this.deps.auth.open(() => void this.buy(packageId), 'register');
      return;
    }
    this.busy = true;
    this.render();
    this.abort = new AbortController();
    this.status.textContent = 'Opening checkout…';
    try {
      const before = a.account!.balance;
      const result = await a.buyGrams(packageId, () => {
        this.status.textContent = 'Finish paying in the new tab. Your GRAMS land here as soon as the payment is confirmed.';
      }, this.abort.signal);
      if (result === 'paid') this.status.innerHTML = `Paid. ${gramsHtml(a.account!.balance - before)} added to your account.`;
      else if (result === 'pending') this.status.textContent = 'Still waiting on the payment. It will show up when it is confirmed.';
      else this.status.textContent = 'Checkout did not go through. You were not charged.';
    } catch (err) {
      this.status.textContent = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  show(v: boolean): void {
    if (v) toFront(this.root);
    this.root.classList.toggle('hidden', !v);
    if (v) this.deps.account.refresh().catch(() => undefined);
    else this.abort?.abort();
  }
}

// ===================================================================== a grid + preview screen (AJ's and TRAP)
abstract class ShopLike {
  readonly root: HTMLElement;
  protected deps: EconomyDeps & { auth: AuthModal; openGrams: () => void };
  protected preview = new CharacterPreview();
  protected grid: HTMLElement;
  protected side: HTMLElement;
  protected selected: StoreItem | null = null;
  protected dialog: Dialog;
  /** Category tabs / filters (filled in by the subclass once its own fields exist). */
  protected filterBox = el('div', 'eco-filters');
  /** The look shown in the preview. */
  protected shown: Appearance;
  private shownKey = '';

  constructor(parent: HTMLElement, deps: EconomyDeps & { auth: AuthModal; openGrams: () => void }, cls: string, title: string, sub: string) {
    this.deps = deps;
    this.shown = cloneAppearance(deps.profile.look);
    const head = header(title, sub, () => this.show(false), deps.account, () => (deps.account.signedIn ? deps.openGrams() : deps.auth.open()));
    this.grid = el('div', 'eco-grid');
    this.side = el('aside', 'eco-side');
    const stage = el('div', 'eco-stage', [this.preview.canvas]);
    const turn = (d: number, label: string) => {
      const b = button(label, 'eco-round', () => this.preview.turnStep(d));
      b.setAttribute('aria-label', d < 0 ? 'Turn left' : 'Turn right');
      return b;
    };
    stage.append(el('div', 'eco-stage-ctrl', [turn(-1, '⟲'), button('−', 'eco-round', () => this.preview.zoomBy(-1)), button('+', 'eco-round', () => this.preview.zoomBy(1)), turn(1, '⟳')]));
    this.root = el('div', `screen eco ${cls} hidden`, [head.root, el('div', 'eco-main', [this.filterBox, this.grid, el('div', 'eco-right', [stage, this.side])])]);
    this.dialog = new Dialog(this.root);
    parent.append(this.root);
    deps.account.onChange(() => {
      if (!this.root.classList.contains('hidden')) this.render();
    });
  }

  protected abstract filters(): HTMLElement;
  protected abstract items(): StoreItem[];
  protected abstract cardExtra(item: StoreItem): HTMLElement | null;
  protected abstract renderSide(): void;

  protected render(): void {
    clear(this.grid);
    const list = this.items();
    if (list.length === 0) this.grid.append(this.empty());
    for (const it of list) {
      const card = button('', `eco-card r-${it.rarity}${this.selected?.id === it.id ? ' on' : ''}`, () => this.select(it));
      card.innerHTML = `<span class="eco-art">${itemArt(it)}</span><span class="eco-cname">${it.name}</span><span class="eco-cmeta">${rarityTag(it)}</span>`;
      const extra = this.cardExtra(it);
      if (extra) card.append(extra);
      if (it.placeholder) card.title = `${it.name} (placeholder art)`;
      this.grid.append(card);
    }
    this.renderSide();
  }

  protected empty(): HTMLElement {
    return el('p', 'eco-empty', 'Nothing here yet.');
  }

  protected select(it: StoreItem | null): void {
    this.selected = it;
    this.previewLook(it ? wearing(this.deps.profile.look, it) : this.deps.profile.look, it?.category === 'weapons');
    this.render();
  }

  protected previewLook(look: Appearance, gun = false): void {
    this.shown = look;
    this.preview.setHeld(gun ? SKIN_PREVIEW_GUN : null);
    const key = encodeAppearance(look);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.preview.setCharacter(this.deps.build(look));
  }

  show(v: boolean): void {
    if (v) toFront(this.root);
    this.root.classList.toggle('hidden', !v);
    this.preview.setActive(v);
    if (v) {
      this.shownKey = '';
      this.select(this.selected);
      this.deps.account.refresh().catch(() => undefined);
    } else {
      this.dialog.close();
    }
  }
}

// ===================================================================== AJ's
export class StoreScreen extends ShopLike {
  private category: StoreCategory = 'outfits';
  private tabs = new Map<StoreCategory, HTMLButtonElement>();

  constructor(parent: HTMLElement, deps: EconomyDeps & { auth: AuthModal; openGrams: () => void; openTrap: () => void }) {
    super(parent, deps, 'store', "AJ'S", 'Fits, kicks, ice and wraps. Cosmetic only: nothing here changes how you play.');
    this.openTrap = deps.openTrap;
    this.filterBox.append(this.filters());
    // "walk in": visit the shop in the world (free roam) instead of the menu
    this.walkBtn = button('', 'eco-btn ghost eco-walk hidden', () => this.walkIn?.());
    this.walkBtn.innerHTML = '<span aria-hidden="true">🚶</span> Walk to AJ\'S';
    this.walkBtn.title = 'Walk around town and into the store: AJ is at the register';
    this.root.querySelector('.eco-bal')?.before(this.walkBtn);
  }

  private openTrap: () => void = () => undefined;
  private walkBtn: HTMLButtonElement;
  private walkIn: (() => void) | null = null;
  private canWalkIn: () => boolean = () => true;

  /** Offers a "Walk to AJ'S" button (free roam) when `available` says so (not mid-match). */
  setWalkIn(fn: () => void, available: () => boolean = () => true): void {
    this.walkIn = fn;
    this.canWalkIn = available;
  }

  override show(v: boolean): void {
    this.walkBtn.classList.toggle('hidden', !this.walkIn || !this.canWalkIn());
    super.show(v);
  }

  protected filters(): HTMLElement {
    const nav = el('nav', 'eco-tabs');
    for (const c of STORE_CATEGORIES) {
      const b = button(c.name, 'eco-tab', () => {
        this.category = c.id;
        for (const [id, t] of this.tabs) t.classList.toggle('on', id === c.id);
        this.select(this.items()[0] ?? null);
      });
      this.tabs.set(c.id, b);
      nav.append(b);
    }
    this.tabs.get(this.category)?.classList.add('on');
    return nav;
  }

  protected items(): StoreItem[] {
    return this.deps.account.catalog.filter((i) => i.category === this.category);
  }

  protected cardExtra(it: StoreItem): HTMLElement {
    const owned = this.deps.account.owns(it.id);
    const tag = el('span', `eco-price${owned ? ' owned' : ''}`);
    tag.innerHTML = owned ? 'OWNED' : gramsHtml(it.price, 15);
    return tag;
  }

  /** Opens on a category (or an item). */
  openAt(category?: StoreCategory): void {
    if (category) {
      this.category = category;
      for (const [id, t] of this.tabs) t.classList.toggle('on', id === category);
    }
    if (!this.selected || this.selected.category !== this.category) this.selected = this.items()[0] ?? null;
    this.show(true);
  }

  protected renderSide(): void {
    clear(this.side);
    const it = this.selected;
    if (!it) return;
    const a = this.deps.account;
    const owned = a.owns(it.id);
    const worn = isWorn(this.deps.profile.look, it);
    const info = el('div', 'eco-info');
    info.innerHTML = `<div class="eco-iname">${it.name}</div><div class="eco-imeta">${rarityTag(it)}<span>${STORE_CATEGORIES.find((c) => c.id === it.category)?.name}</span>${it.limited ? '<span class="eco-limited">LIMITED</span>' : ''}</div>
<p>${it.blurb}</p>${it.collection ? `<p class="eco-coll">${it.collection}</p>` : ''}${it.placeholder ? '<p class="eco-ph">Placeholder art</p>' : ''}`;
    const price = el('div', 'eco-bigprice');
    price.innerHTML = owned ? '<span class="owned">OWNED</span>' : gramsHtml(it.price, 26);
    const actions = el('div', 'eco-actions');
    const preview = button('Preview', 'eco-btn ghost', () => this.select(it));
    if (owned) {
      const equip = button(worn ? 'Equipped' : 'Equip', 'eco-btn gold', () => void this.equip(it));
      equip.disabled = worn;
      actions.append(preview, equip, button('Open TRAP', 'eco-btn ghost', () => this.openTrap()));
    } else {
      actions.append(preview, button('Buy', 'eco-btn gold', () => this.confirmBuy(it)));
    }
    this.side.append(info, price, actions);
  }

  private confirmBuy(it: StoreItem): void {
    const a = this.deps.account;
    if (!a.signedIn) {
      this.deps.auth.open(() => this.confirmBuy(it));
      return;
    }
    const bal = a.account!.balance;
    if (bal < it.price) {
      const msg = el('div', 'eco-dialog-art');
      msg.innerHTML = gIcon(54);
      this.dialog.open([msg, el('h2', '', 'Not enough GRAMS. Want to re-up?'), `You have ${formatGrams(bal)} GRAMS. ${it.name} is ${formatGrams(it.price)}.`], [
        button('Not now', 'eco-btn ghost', () => this.dialog.close()),
        button('Get GRAMS', 'eco-btn gold', () => {
          this.dialog.close();
          this.deps.openGrams();
        }),
      ]);
      return;
    }
    const art = el('div', 'eco-dialog-art');
    art.innerHTML = itemArt(it);
    const yes = button('', 'eco-btn gold', () => void this.buy(it, yes));
    yes.innerHTML = `Buy for ${gramsHtml(it.price, 16)}`;
    this.dialog.open([art, el('h2', '', it.name), `You have ${formatGrams(bal)} GRAMS. After this: ${formatGrams(bal - it.price)}.`], [
      button('Cancel', 'eco-btn ghost', () => this.dialog.close()),
      yes,
    ]);
  }

  private async buy(it: StoreItem, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      await this.deps.account.buy(it.id);
      const art = el('div', 'eco-dialog-art pop');
      art.innerHTML = itemArt(it);
      this.dialog.open([art, el('h2', '', 'Purchase Successful!'), `${it.name} is in your TRAP.`], [
        button('Later', 'eco-btn ghost', () => this.dialog.close()),
        button('Equip now', 'eco-btn gold', () => {
          this.dialog.close();
          void this.equip(it);
        }),
      ]);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.code === 'insufficient_funds') {
        this.confirmBuy(it);
        return;
      }
      this.dialog.open([el('h2', '', 'That did not go through'), e?.message ?? 'Something went wrong. You were not charged.'], [button('OK', 'eco-btn gold', () => this.dialog.close())]);
    } finally {
      btn.disabled = false;
      this.render();
    }
  }

  private async equip(it: StoreItem): Promise<void> {
    await equipLook(this.deps, wearing(this.deps.profile.look, it));
    this.select(it);
  }
}

/** Saves a look on the account (server checks ownership) and puts it on. */
async function equipLook(deps: EconomyDeps, look: Appearance): Promise<void> {
  const code = deps.account.signedIn ? await deps.account.equip(encodeAppearance(look)) : encodeAppearance(look);
  deps.applyLook(decodeAppearance(code));
}

// ===================================================================== TRAP
export class TrapScreen extends ShopLike {
  private category: TrapCategory | 'all' = 'all';
  private rarity: ItemRarity | 'all' = 'all';
  private tabs = new Map<string, HTMLButtonElement>();
  private rarities = new Map<string, HTMLButtonElement>();
  private openStore: () => void;

  constructor(parent: HTMLElement, deps: EconomyDeps & { auth: AuthModal; openGrams: () => void; openStore: () => void }) {
    super(parent, deps, 'trap', 'TRAP', 'Everything you own. Pick it, preview it, put it on.');
    this.openStore = deps.openStore;
    this.filterBox.append(this.filters());
    this.editorLook();
  }

  /** The editor look (as the Character Creator): round tools with labels, the studio floor. */
  private editorLook(): void {
    const back = this.root.querySelector<HTMLButtonElement>('.eco-back');
    if (back) {
      back.className = 'eco-back ed-b solo';
      back.innerHTML = `<span class="ed-i">${ED.back}</span><span class="ed-l">Back</span>`;
      back.setAttribute('aria-label', 'Back');
    }
    const ctrl = this.root.querySelector('.eco-stage-ctrl');
    if (ctrl) {
      ctrl.className = 'eco-stage-ctrl ed-pill';
      ctrl.replaceChildren(
        tool(ED.turnL, 'Turn left', () => this.preview.turnStep(-1)),
        tool(ED.zoomOut, 'Zoom out', () => this.preview.zoomBy(-1)),
        tool(ED.zoomIn, 'Zoom in', () => this.preview.zoomBy(1)),
        tool(ED.turnR, 'Turn right', () => this.preview.turnStep(1)),
      );
    }
    this.preview.setStudio(true);
    // the whole character, standing in the middle of the view
    this.preview.setZoom(1.5);
  }

  protected filters(): HTMLElement {
    const nav = el('nav', 'eco-tabs');
    const pill = el('div', 'ed-pill eco-catpill');
    const ICON: Record<string, [string, string]> = {
      all: [ED.all, 'Everything'], characters: [ED.body, 'Characters'], clothing: [ED.top, 'Clothing'], sneakers: [ED.shoes, 'Sneakers'],
      accessories: [ED.gem, 'Accessories'], weapons: [ED.gun, 'Skins'], backpacks: [ED.bag, 'Backpacks'], special: [ED.star, 'Special'],
    };
    for (const c of [{ id: 'all', name: 'Everything' }, ...TRAP_CATEGORIES]) {
      const [icon, label] = ICON[c.id] ?? [ED.star, c.name];
      const b = tool(icon, label, () => {
        this.category = c.id as TrapCategory | 'all';
        for (const [id, t] of this.tabs) t.classList.toggle('on', id === c.id);
        this.render();
      }, 'eco-tab');
      b.title = c.name;
      this.tabs.set(c.id, b);
      pill.append(b);
    }
    nav.append(pill);
    this.tabs.get('all')?.classList.add('on');
    const chips = el('div', 'eco-chips');
    for (const r of ['all', ...RARITIES]) {
      const b = button(r === 'all' ? 'All rarities' : r, `eco-chip r-${r}`, () => {
        this.rarity = r as ItemRarity | 'all';
        for (const [id, t] of this.rarities) t.classList.toggle('on', id === r);
        this.render();
      });
      this.rarities.set(r, b);
      chips.append(b);
    }
    this.rarities.get('all')?.classList.add('on');
    nav.append(chips);
    return nav;
  }

  protected items(): StoreItem[] {
    const a = this.deps.account;
    return a.catalog.filter((i) => a.owns(i.id))
      .filter((i) => this.category === 'all' || (this.category === 'special' ? !!i.limited || !!i.collection : trapCategory(i) === this.category))
      .filter((i) => this.rarity === 'all' || i.rarity === this.rarity);
  }

  protected override empty(): HTMLElement {
    const a = this.deps.account;
    const box = el('div', 'eco-empty');
    if (!a.signedIn) {
      box.append(el('p', '', 'Sign in to open your TRAP.'), button('Sign in', 'eco-btn gold', () => this.deps.auth.open(() => this.render())));
    } else {
      box.append(el('p', '', a.account!.owned.length ? 'Nothing matches those filters.' : 'Your TRAP is empty. Everything you cop at AJ\'s lands here.'), button("Go to AJ's", 'eco-btn gold', () => this.openStore()));
    }
    return box;
  }

  protected cardExtra(it: StoreItem): HTMLElement | null {
    return isWorn(this.deps.profile.look, it) ? el('span', 'eco-price owned', 'EQUIPPED') : null;
  }

  protected renderSide(): void {
    clear(this.side);
    const it = this.selected && this.deps.account.owns(this.selected.id) ? this.selected : null;
    if (!it) {
      this.side.append(el('p', 'eco-note', 'Pick something from your TRAP to see it on you.'));
      return;
    }
    const worn = isWorn(this.deps.profile.look, it);
    const info = el('div', 'eco-info');
    info.innerHTML = `<div class="eco-iname">${it.name}</div><div class="eco-imeta">${rarityTag(it)}${worn ? '<span class="eco-limited">EQUIPPED</span>' : ''}</div><p>${it.blurb}</p>`;
    const equip = button('Equip', 'eco-btn gold', () => void this.wear(it, true));
    const unequip = button('Unequip', 'eco-btn ghost', () => void this.wear(it, false));
    const preview = button('Preview', 'eco-btn ghost', () => this.previewLook(wearing(this.deps.profile.look, it), it.category === 'weapons'));
    equip.disabled = worn;
    unequip.disabled = !worn;
    this.side.append(info, el('div', 'eco-actions trap-actions', [equip, unequip, preview]));
  }

  private async wear(it: StoreItem, on: boolean): Promise<void> {
    try {
      await equipLook(this.deps, on ? wearing(this.deps.profile.look, it) : without(this.deps.profile.look, it));
    } catch (err) {
      this.dialog.open([el('h2', '', 'Could not change that'), err instanceof ApiError ? err.message : 'Something went wrong.'], [button('OK', 'eco-btn gold', () => this.dialog.close())]);
    }
    this.select(it);
  }
}
