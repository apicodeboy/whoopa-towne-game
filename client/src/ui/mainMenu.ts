import { CLASSIC_MODES, GAME_NAME, INVITE_CODE_LENGTH, MODES, NAME_MAX_LENGTH, type ModeId } from '@shared/config/game';
import { PORCH, SQUAD_MODES, SQUAD_MODE_IDS, type SquadMode } from '@shared/config/porch';
import type { BotDifficulty } from '@shared/protocol';
import type { Profile } from '../core/profile';
import type { DeviceKind } from '../input/types';
import { button, el } from './dom';
import { gIcon, gramsHtml } from './economyArt';
import { glyphHtml } from './prompts';

export interface MainMenuActions {
  quickPlay(mode: ModeId): void;
  createPrivate(mode: ModeId): void;
  joinWithCode(code: string): void;
  practice(mode: ModeId, difficulty: BotDifficulty): void;
  openCharacter(): void;
  openLoadout(): void;
  openSettings(): void;
  /** GRAMS / AJ's / TRAP / account. */
  openStore(): void;
  openTrap(): void;
  openGrams(): void;
  signIn(): void;
  signOut(): void;
}

/** Small line icons (stroke = currentColor). */
const ICONS = {
  arrow: '<path d="M7 17L17 7M9 7h8v8"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pad: '<path d="M6.5 8h11c2 0 3.2 1.2 3.5 3.1l.6 4c.3 1.9-1.9 2.9-3.1 1.3L17 14.5H7l-1.5 1.9c-1.2 1.6-3.4.6-3.1-1.3l.6-4C3.3 9.2 4.5 8 6.5 8z"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="16" cy="11" r=".6" fill="currentColor"/><circle cx="17.6" cy="12.6" r=".6" fill="currentColor"/>',
  menu: '<path d="M5 9h14M9 15h10"/>',
  balloon: '<path d="M12 3a5 5 0 0 1 5 5c0 3.6-3 6.5-5 7-2-.5-5-3.4-5-7a5 5 0 0 1 5-5z"/><path d="M12 15l-1 2h2l-1-2zM12 17c0 2-1.5 2.5-1.5 4"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  flag: '<path d="M6 21V4M6 5h10l-2 3.5 2 3.5H6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><circle cx="9.5" cy="13.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.2" fill="currentColor"/><path d="M12 8V5"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};
const icon = (name: keyof typeof ICONS, cls = 'hm-ico'): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

interface ModeCopy {
  /** Headline words; the last gets the accent dot. */
  head: [string, string];
  sub: string;
  card: string;
  icon: keyof typeof ICONS;
  stat: string;
  statCap: string;
  meta: string;
}

const COPY: Record<ModeId, ModeCopy> = {
  porch: {
    head: ['Jump off', 'the porch'],
    sub: PORCH.tagline,
    card: PORCH.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: 'balloon',
    stat: String(PORCH.lobbySize),
    statCap: 'players drop in.<br>One makes it out.',
    meta: 'Battle royale · New',
  },
  tdm: {
    head: ['Run', 'the block'],
    sub: MODES.tdm.blurb,
    card: MODES.tdm.name,
    icon: 'target',
    stat: '4v4',
    statCap: 'crew against crew<br>first to 50',
    meta: 'Crews · Respawns',
  },
  turf: {
    head: ['Hold', 'the corners'],
    sub: MODES.turf.blurb,
    card: MODES.turf.name,
    icon: 'flag',
    stat: '3',
    statCap: 'corners to hold<br>across the Towne',
    meta: 'Crews · Zones',
  },
};

/**
 * Title screen over the live city: a nav bar (pills, the logo in a notch, the controller tip
 * and Quick Play), a big headline for the selected mode, your name with a stat on the left,
 * and a row of cards along the bottom: the selected mode wide with its play button, the
 * other modes and the private lobby as picture cards.
 */
export class MainMenu {
  readonly root: HTMLElement;
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private squadButtons = new Map<SquadMode, HTMLButtonElement>();
  private diffButtons = new Map<BotDifficulty, HTMLButtonElement>();
  private squadPill: HTMLElement;
  private loadoutPill: HTMLButtonElement;
  private diffPill: HTMLElement;
  private headEl: HTMLElement;
  private subEl: HTMLElement;
  private statEl: HTMLElement;
  private statCapEl: HTMLElement;
  private avatarEl: HTMLElement;
  private feature: HTMLElement;
  private featureThumb: HTMLElement;
  private featureTitle: HTMLElement;
  private featureMeta: HTMLElement;
  private featureStat: HTMLElement;
  private modeCards = new Map<ModeId, HTMLButtonElement>();
  private lobbyCard: HTMLButtonElement;
  private lobbyPop: HTMLElement;
  private busyEl: HTMLElement;
  private promptsEl: HTMLElement;
  private actionButtons: HTMLButtonElement[] = [];
  private thumbs: Partial<Record<ModeId | 'lobby', string>> = {};
  private gramsChip: HTMLButtonElement;
  private authLink: HTMLButtonElement;
  private meCap: HTMLElement;
  private signedIn = false;
  private profile: Profile;

  constructor(parent: HTMLElement, profile: Profile, actions: MainMenuActions) {
    this.profile = profile;

    // ---- nav: pills, the logo notch, the controller tip, Quick Play ----
    const pill = (label: string, onClick: () => void) => button(label, 'hm-pill', onClick);
    const store = pill("AJ's", () => actions.openStore());
    store.classList.add('hm-aj');
    const trap = pill('TRAP', () => actions.openTrap());
    trap.classList.add('hm-trap');
    // (JUMP OFF THE PORCH has no loadout: you find your guns)
    this.loadoutPill = pill('Loadout', () => actions.openLoadout());
    const navLeft = el('nav', 'hm-nav-left', [
      store,
      trap,
      pill('Character', () => actions.openCharacter()),
      this.loadoutPill,
      pill('Settings', () => actions.openSettings()),
    ]);
    const logo = el('img');
    logo.src = `${import.meta.env.BASE_URL}assets/ui/logo.png`;
    logo.alt = GAME_NAME;
    logo.width = 960;
    logo.height = 219;
    logo.draggable = false;
    const notch = el('div', 'hm-notch', [logo]);
    const pad = el('div', 'hm-pill hm-tip');
    pad.innerHTML = `${icon('pad')}<span>To connect PS5 controller on PC, plug into PC and hold <b>SELECT</b> and <b>PS</b> button together</span>`;
    const quickTop = button('', 'hm-cta', () => actions.quickPlay(profile.mode));
    quickTop.innerHTML = `<span>Quick play</span><i>${icon('arrow')}</i>`;
    const more = button('', 'hm-burger', () => actions.openSettings());
    more.innerHTML = icon('menu');
    more.setAttribute('aria-label', 'Settings');
    this.gramsChip = button('', 'hm-grams', () => actions.openGrams());
    this.gramsChip.title = 'GRAMS (buy more)';
    const navRight = el('div', 'hm-nav-right', [pad, this.gramsChip, quickTop, more]);
    const nav = el('header', 'hm-nav', [navLeft, notch, navRight]);

    // ---- the headline ----
    this.headEl = el('h1', 'hm-title');
    this.subEl = el('p', 'hm-sub');
    const hero = el('section', 'hm-hero', [this.headEl, this.subEl]);

    // ---- bottom left: a stat and your name ----
    this.statEl = el('div', 'hm-stat');
    this.statCapEl = el('div', 'hm-stat-cap');
    this.nameInput = el('input', 'hm-name');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NAME_MAX_LENGTH;
    this.nameInput.value = profile.name;
    this.nameInput.placeholder = 'Your name';
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.setAttribute('aria-label', 'Player name (letters and numbers, up to 12)');
    this.nameInput.addEventListener('input', () => {
      const clean = this.nameInput.value.replace(/[^A-Za-z0-9]/g, '').slice(0, NAME_MAX_LENGTH);
      if (clean !== this.nameInput.value) this.nameInput.value = clean;
      this.updateAvatar();
    });
    this.nameInput.addEventListener('change', () => (this.nameInput.value = profile.setName(this.nameInput.value)));
    this.nameInput.addEventListener('blur', () => {
      this.nameInput.value = profile.setName(this.nameInput.value);
      this.updateAvatar();
    });
    this.avatarEl = el('span', 'hm-avatar');
    this.meCap = el('span', 'hm-me-cap', 'Player');
    this.authLink = button('Sign in', 'hm-auth', () => (this.signedIn ? actions.signOut() : actions.signIn()));
    // sign in / out sits on the caption line, so the pill keeps its size next to the mode cards
    const me = el('div', 'hm-me', [this.avatarEl, el('label', 'hm-me-text', [el('span', 'hm-me-row', [this.meCap, this.authLink]), this.nameInput])]);
    this.promptsEl = el('div', 'hm-prompts');
    const left = el('div', 'hm-left', [this.statEl, this.statCapEl, me, this.promptsEl]);

    // ---- options pill above the cards (teams for the battle royale, bot level otherwise) ----
    const squads = el('div', 'hm-seg');
    for (const id of SQUAD_MODE_IDS) {
      const b = button(SQUAD_MODES[id].name, 'hm-seg-b', () => this.setSquads(id));
      this.squadButtons.set(id, b);
      squads.append(b);
    }
    this.squadPill = el('div', 'hm-float', [el('span', 'hm-float-dot'), el('span', 'hm-float-cap', 'Teams'), squads]);
    const diffs = el('div', 'hm-seg');
    for (const d of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const b = button(d[0].toUpperCase() + d.slice(1), 'hm-seg-b', () => this.setDifficulty(d));
      this.diffButtons.set(d, b);
      diffs.append(b);
    }
    this.diffPill = el('div', 'hm-float', [el('span', 'hm-float-dot'), el('span', 'hm-float-cap', 'Practice bots'), diffs]);

    // ---- the featured card: the selected mode, ready to play ----
    this.featureThumb = el('div', 'hm-thumb');
    this.featureTitle = el('div', 'hm-f-title');
    this.featureMeta = el('div', 'hm-f-meta');
    this.featureStat = el('div', 'hm-f-stat');
    const practice = button('', 'hm-ghost', () => actions.practice(profile.mode, profile.difficulty));
    practice.innerHTML = `${icon('bot')}<span>Practice</span>`;
    const go = button('', 'hm-go', () => actions.quickPlay(profile.mode));
    go.innerHTML = icon('right');
    go.setAttribute('aria-label', 'Quick play');
    go.classList.add('primary');
    this.busyEl = el('div', 'hm-busy hidden', 'Connecting…');
    this.feature = el('div', 'hm-card hm-feature', [
      this.featureThumb,
      el('div', 'hm-f-body', [
        this.featureTitle,
        this.featureMeta,
        el('div', 'hm-f-foot', [this.featureStat, el('div', 'hm-f-actions', [practice, go])]),
        this.busyEl,
      ]),
    ]);

    // ---- picture cards: the other modes, and a private lobby ----
    for (const id of ['porch', ...CLASSIC_MODES] as ModeId[]) {
      const b = button('', `hm-card hm-pic mode-${id}`, () => this.setMode(id));
      b.innerHTML = `<span class="hm-pic-img"></span><span class="hm-pic-label">${icon(COPY[id].icon)}${COPY[id].card}</span>`;
      this.modeCards.set(id, b);
    }
    this.lobbyCard = button('', 'hm-card hm-pic hm-lobby', () => this.toggleLobby());
    this.lobbyCard.innerHTML = `<span class="hm-pic-img"></span><span class="hm-pic-label">${icon('lock')}Private lobby</span>`;
    const create = button('Create lobby', 'hm-pop-b', () => actions.createPrivate(profile.mode));
    this.codeInput = el('input', 'hm-code');
    this.codeInput.type = 'text';
    this.codeInput.maxLength = INVITE_CODE_LENGTH;
    this.codeInput.placeholder = 'Invite code';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('aria-label', 'Invite code');
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitCode(actions);
    });
    const join = button('Join', 'hm-pop-b dark', () => this.submitCode(actions));
    this.lobbyPop = el('div', 'hm-pop hidden', [
      el('div', 'hm-pop-cap', 'Play with friends'),
      create,
      el('div', 'hm-pop-row', [this.codeInput, join]),
    ]);
    this.actionButtons = [quickTop, go, practice, create, join];

    const cards = el('div', 'hm-cards', [this.feature, ...this.modeCards.values(), this.lobbyCard, this.lobbyPop]);
    const right = el('div', 'hm-right', [el('div', 'hm-floats', [this.squadPill, this.diffPill]), cards]);
    const bottom = el('section', 'hm-bottom', [left, right]);

    const frame = el('div', 'hm-frame', [nav, hero, bottom]);
    this.root = el('div', 'screen menu hm', [frame]);
    parent.append(this.root);

    this.setMode(profile.mode);
    this.setSquads(profile.squads);
    this.setDifficulty(profile.difficulty);
    this.updateAvatar();
    this.setDevice('kbm');
    this.applyThumbs();
    this.setAccount(null);
  }

  /** Signed in: the account name is your name (and the GRAMS balance shows); signed out: free name. */
  setAccount(a: { username: string; balance: number } | null): void {
    this.signedIn = !!a;
    this.gramsChip.innerHTML = a ? gramsHtml(a.balance, 22) : `${gIcon(22)}<span>GRAMS</span>`;
    this.authLink.textContent = a ? 'Sign out' : 'Sign in';
    this.meCap.textContent = a ? 'Signed in' : 'Player · guest';
    this.nameInput.readOnly = !!a;
    if (a) this.nameInput.value = a.username;
    else this.nameInput.value = this.profile.name;
    this.updateAvatar();
  }

  /** Pictures of the town for the cards (the app renders them once the art has loaded). */
  setThumbs(t: Partial<Record<ModeId | 'lobby', string>>): void {
    this.thumbs = { ...this.thumbs, ...t };
    this.applyThumbs();
  }

  private thumbFor(id: ModeId | 'lobby'): string {
    const t = this.thumbs[id];
    if (t) return `url("${t}")`;
    return id === 'porch' ? `url("${import.meta.env.BASE_URL}assets/ui/loading-screen-1920.jpg")` : '';
  }

  private applyThumbs(): void {
    for (const [id, card] of this.modeCards) {
      const img = card.querySelector<HTMLElement>('.hm-pic-img')!;
      const bg = this.thumbFor(id);
      if (bg) img.style.backgroundImage = bg;
      img.classList.toggle('art', !bg);
    }
    const lobby = this.lobbyCard.querySelector<HTMLElement>('.hm-pic-img')!;
    const lb = this.thumbFor('lobby');
    if (lb) lobby.style.backgroundImage = lb;
    const fb = this.thumbFor(this.profile.mode);
    this.featureThumb.style.backgroundImage = fb;
    this.featureThumb.classList.toggle('art', !fb);
    this.featureThumb.dataset.mode = this.profile.mode;
  }

  /** Button prompts for the device in use. */
  setDevice(device: DeviceKind): void {
    if (device === 'touch' || device === 'kbm') {
      this.promptsEl.innerHTML = '';
      return;
    }
    this.promptsEl.innerHTML = `<span>${glyphHtml(device, 'accept')} Select</span><span>${glyphHtml(device, 'back')} Back</span>`;
  }

  private updateAvatar(): void {
    const n = (this.nameInput.value || 'P').toUpperCase();
    this.avatarEl.textContent = n[0];
    let h = 0;
    for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
    this.avatarEl.style.background = `linear-gradient(135deg, hsl(${h} 70% 62%), hsl(${(h + 40) % 360} 70% 45%))`;
  }

  private toggleLobby(show = this.lobbyPop.classList.contains('hidden')): void {
    this.lobbyPop.classList.toggle('hidden', !show);
    this.lobbyCard.classList.toggle('on', show);
  }

  private submitCode(actions: MainMenuActions): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== INVITE_CODE_LENGTH) {
      this.codeInput.classList.add('shake');
      setTimeout(() => this.codeInput.classList.remove('shake'), 400);
      this.codeInput.focus();
      return;
    }
    actions.joinWithCode(code);
  }

  private setMode(mode: ModeId): void {
    this.profile.setMode(mode);
    const c = COPY[mode];
    this.headEl.innerHTML = `<span>${c.head[0]}</span> <span>${c.head[1]}<i class="hm-dot"></i></span>`;
    this.subEl.textContent = c.sub;
    this.statEl.textContent = c.stat;
    this.statCapEl.innerHTML = c.statCap;
    this.featureTitle.innerHTML = `${icon(c.icon)}<span>${c.card}</span>`;
    this.featureMeta.textContent = c.meta;
    this.featureStat.innerHTML = mode === 'porch' ? `${PORCH.lobbySize}<small>/lobby</small>` : `10<small>min</small>`;
    // the selected mode is the wide card; the others are picture cards beside it
    for (const [id, card] of this.modeCards) card.classList.toggle('hidden', id === mode);
    const porch = mode === 'porch';
    this.squadPill.classList.toggle('hidden', !porch);
    this.loadoutPill.classList.toggle('hidden', porch);
    // JUMP OFF THE PORCH has no bot settings: bot levels vary on their own
    this.diffPill.classList.toggle('hidden', porch);
    this.root.dataset.mode = mode;
    this.toggleLobby(false);
    this.applyThumbs();
  }

  private setSquads(squads: SquadMode): void {
    this.profile.setSquads(squads);
    for (const [id, b] of this.squadButtons) b.classList.toggle('on', id === squads);
  }

  private setDifficulty(d: BotDifficulty): void {
    this.profile.setDifficulty(d);
    for (const [id, b] of this.diffButtons) b.classList.toggle('on', id === d);
  }

  /** Commit whatever is typed in the name box (called before any action that uses the name). */
  commitName(): string {
    this.nameInput.value = this.profile.setName(this.nameInput.value);
    this.updateAvatar();
    return this.profile.name;
  }

  setCode(code: string): void {
    this.codeInput.value = code.toUpperCase().slice(0, INVITE_CODE_LENGTH);
    if (code) this.toggleLobby(true);
  }

  setBusy(busy: boolean, text = 'Connecting…'): void {
    this.busyEl.textContent = text;
    this.busyEl.classList.toggle('hidden', !busy);
    for (const b of this.actionButtons) b.disabled = busy;
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
