import { CREWS, crewLogoSvg } from '@shared/config/crews';
import { GAME_NAME, INVITE_CODE_LENGTH, MODES, MODE_IDS, NAME_MAX_LENGTH, type ModeId } from '@shared/config/game';
import type { BotDifficulty } from '@shared/protocol';
import type { Profile } from '../core/profile';
import { button, el } from './dom';

export interface MainMenuActions {
  quickPlay(mode: ModeId): void;
  createPrivate(mode: ModeId): void;
  joinWithCode(code: string): void;
  practice(mode: ModeId, difficulty: BotDifficulty): void;
  openLoadout(): void;
  openSettings(): void;
}

/** Title screen: name, mode, Quick Play / Create Private Lobby / Join with Code / Practice. */
export class MainMenu {
  readonly root: HTMLElement;
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private modeButtons = new Map<ModeId, HTMLButtonElement>();
  private diffButtons = new Map<BotDifficulty, HTMLButtonElement>();
  private blurb: HTMLElement;
  private busyEl: HTMLElement;
  private actionButtons: HTMLButtonElement[] = [];
  private profile: Profile;

  constructor(parent: HTMLElement, profile: Profile, actions: MainMenuActions) {
    this.profile = profile;

    const title = el('div', 'wordmark');
    title.innerHTML = `<span class="w1">WHOOPA</span><span class="w2">TOWNE</span>`;
    title.setAttribute('aria-label', GAME_NAME);
    const versus = el('div', 'versus');
    versus.innerHTML =
      `<span class="crew c0"><i>${crewLogoSvg(0)}</i>${CREWS[0].name}</span><b>VS</b>` +
      `<span class="crew c1">${CREWS[1].name}<i>${crewLogoSvg(1)}</i></span>`;

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

    // ---- mode ----
    const modes = el('div', 'segmented');
    for (const id of MODE_IDS) {
      const b = button(MODES[id].name, 'seg', () => this.setMode(id));
      this.modeButtons.set(id, b);
      modes.append(b);
    }
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
    const loadout = button('LOADOUT', 'btn ghost', () => actions.openLoadout());
    const settings = button('SETTINGS', 'btn ghost', () => actions.openSettings());
    this.actionButtons = [quick, create, join, practice];
    this.busyEl = el('div', 'busy hidden', 'Connecting…');

    const panel = el('div', 'menu-panel', [
      title,
      versus,
      el('label', 'lbl', 'DISPLAY NAME'),
      this.nameInput,
      el('label', 'lbl', 'MODE'),
      modes,
      this.blurb,
      quick,
      create,
      el('div', 'row', [this.codeInput, join]),
      el('div', 'divider', 'OFFLINE'),
      el('div', 'row', [practice, diffs]),
      el('div', 'row', [loadout, settings]),
      this.busyEl,
      el('div', 'menu-footer', 'Keyboard + mouse, controllers and touch supported · No account needed'),
    ]);
    this.root = el('div', 'screen menu', [panel]);
    parent.append(this.root);
    this.setMode(profile.mode);
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
    this.blurb.textContent = MODES[mode].blurb;
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
