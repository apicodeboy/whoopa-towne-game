import { CLASSIC_MODES, GAME_NAME, INVITE_CODE_LENGTH, MODES, NAME_MAX_LENGTH, type ModeId } from '@shared/config/game';
import { PORCH, SQUAD_MODES, SQUAD_MODE_IDS, type SquadMode } from '@shared/config/porch';
import type { BotDifficulty } from '@shared/protocol';
import type { Profile } from '../core/profile';
import { button, el } from './dom';

export interface MainMenuActions {
  quickPlay(mode: ModeId): void;
  createPrivate(mode: ModeId): void;
  joinWithCode(code: string): void;
  practice(mode: ModeId, difficulty: BotDifficulty): void;
  openCharacter(): void;
  openLoadout(): void;
  openSettings(): void;
}

/** Title screen: name, mode, Quick Play / Create Private Lobby / Join with Code / Practice. */
export class MainMenu {
  readonly root: HTMLElement;
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private modeButtons = new Map<ModeId, HTMLButtonElement>();
  private squadButtons = new Map<SquadMode, HTMLButtonElement>();
  private squadRow: HTMLElement;
  private diffButtons = new Map<BotDifficulty, HTMLButtonElement>();
  private blurb: HTMLElement;
  private busyEl: HTMLElement;
  private actionButtons: HTMLButtonElement[] = [];
  private profile: Profile;

  constructor(parent: HTMLElement, profile: Profile, actions: MainMenuActions) {
    this.profile = profile;

    const title = el('div', 'wordmark');
    const logo = el('img');
    logo.src = `${import.meta.env.BASE_URL}assets/ui/logo.png`;
    logo.alt = GAME_NAME;
    logo.width = 960;
    logo.height = 219;
    logo.draggable = false;
    title.append(logo);

    // ---- name ----
    this.nameInput = el('input', 'field');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NAME_MAX_LENGTH;
    this.nameInput.value = profile.name;
    this.nameInput.placeholder = 'Your name';
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.setAttribute('aria-label', 'Display name');
    this.nameInput.addEventListener('change', () => (this.nameInput.value = profile.setName(this.nameInput.value)));
    this.nameInput.addEventListener('blur', () => (this.nameInput.value = profile.setName(this.nameInput.value)));

    // ---- mode: the two crew modes, and the battle royale (featured) ----
    const modes = el('div', 'segmented');
    for (const id of CLASSIC_MODES) {
      const b = button(MODES[id].name, 'seg', () => this.setMode(id));
      this.modeButtons.set(id, b);
      modes.append(b);
    }
    const porch = button('', 'porch-mode', () => this.setMode('porch'));
    porch.innerHTML = `<span class="pm-tag">NEW</span><span class="pm-name">${PORCH.name}</span><span class="pm-sub">BATTLE ROYALE · ${PORCH.lobbySize} PLAYERS</span>`;
    this.modeButtons.set('porch', porch);
    const squads = el('div', 'segmented small');
    for (const id of SQUAD_MODE_IDS) {
      const b = button(SQUAD_MODES[id].name.toUpperCase(), 'seg', () => this.setSquads(id));
      this.squadButtons.set(id, b);
      squads.append(b);
    }
    this.squadRow = el('div', 'squad-row hidden', [el('span', 'lbl', 'TEAMS'), squads]);
    this.blurb = el('div', 'blurb', '');

    // ---- actions ----
    const quick = button('QUICK PLAY', 'btn primary big', () => actions.quickPlay(profile.mode));
    const create = button('CREATE PRIVATE LOBBY', 'btn', () => actions.createPrivate(profile.mode));
    this.codeInput = el('input', 'field code');
    this.codeInput.type = 'text';
    this.codeInput.maxLength = INVITE_CODE_LENGTH;
    this.codeInput.placeholder = 'CODE';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('aria-label', 'Invite code');
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    const join = button('JOIN WITH CODE', 'btn', () => this.submitCode(actions));
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitCode(actions);
    });

    const diffs = el('div', 'segmented small');
    for (const d of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const b = button(d.toUpperCase(), 'seg', () => this.setDifficulty(d));
      this.diffButtons.set(d, b);
      diffs.append(b);
    }
    const practice = button('PRACTICE VS BOTS', 'btn', () => actions.practice(profile.mode, profile.difficulty));
    const character = button('CHARACTER', 'btn ghost', () => actions.openCharacter());
    const loadout = button('LOADOUT', 'btn ghost', () => actions.openLoadout());
    const settings = button('SETTINGS', 'btn ghost', () => actions.openSettings());
    this.actionButtons = [quick, create, join, practice];
    this.busyEl = el('div', 'busy hidden', 'Connecting…');

    const panel = el('div', 'menu-panel', [
      title,
      el('label', 'lbl', 'DISPLAY NAME'),
      this.nameInput,
      el('label', 'lbl', 'MODE'),
      porch,
      modes,
      this.squadRow,
      this.blurb,
      quick,
      create,
      el('div', 'row', [this.codeInput, join]),
      el('div', 'divider', 'OFFLINE'),
      el('div', 'row', [practice, diffs]),
      el('div', 'row', [character, loadout, settings]),
      this.busyEl,
      el('div', 'menu-footer', 'Keyboard + mouse, controllers and touch supported · No account needed'),
    ]);
    this.root = el('div', 'screen menu', [panel]);
    parent.append(this.root);
    this.setMode(profile.mode);
    this.setSquads(profile.squads);
    this.setDifficulty(profile.difficulty);
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
    for (const [id, b] of this.modeButtons) b.classList.toggle('on', id === mode);
    this.squadRow.classList.toggle('hidden', mode !== 'porch');
    this.blurb.textContent = mode === 'porch' ? `“${PORCH.tagline}”` : MODES[mode].blurb;
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
    return this.profile.name;
  }

  setCode(code: string): void {
    this.codeInput.value = code.toUpperCase().slice(0, INVITE_CODE_LENGTH);
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
