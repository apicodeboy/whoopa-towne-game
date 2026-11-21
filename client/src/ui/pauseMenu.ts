import { button, el } from './dom';

export interface PauseActions {
  resume(): void;
  openLoadout(): void;
  openSettings(): void;
  /** Your items (TRAP): what you put on shows from your next life / match. */
  openTrap?(): void;
  leave(): void;
  /** Host of a private lobby only. */
  endMatch(): void;
}

/** In-match menu (Esc / Start). Online matches keep running while it is open. */
export class PauseMenu {
  readonly root: HTMLElement;
  private loadoutBtn: HTMLButtonElement;
  private leaveBtn: HTMLButtonElement;
  private endBtn: HTMLButtonElement;
  private confirm = false;
  private confirmEnd = false;
  private noteEl: HTMLElement;
  private legendEl: HTMLElement;

  constructor(parent: HTMLElement, actions: PauseActions) {
    this.leaveBtn = button('LEAVE MATCH', 'btn ghost danger', () => {
      if (!this.confirm) {
        this.confirm = true;
        this.leaveBtn.textContent = 'REALLY LEAVE?';
        return;
      }
      actions.leave();
    });
    this.endBtn = button('END MATCH FOR EVERYONE', 'btn ghost danger hidden', () => {
      if (!this.confirmEnd) {
        this.confirmEnd = true;
        this.endBtn.textContent = 'REALLY END IT?';
        return;
      }
      actions.endMatch();
    });
    this.noteEl = el('div', 'pause-note', '');
    this.legendEl = el('div', 'pause-legend', '');
    this.loadoutBtn = button('LOADOUT', 'btn', () => actions.openLoadout());
    const resume = button('RESUME', 'btn primary big', () => actions.resume());
    resume.dataset.back = '1';
    const panel = el('div', 'overlay-panel pause', [
      el('div', 'panel-title', 'PAUSED'),
      resume,
      this.loadoutBtn,
      button('SETTINGS', 'btn', () => actions.openSettings()),
      ...(actions.openTrap ? [button('TRAP', 'btn', () => actions.openTrap!())] : []),
      this.endBtn,
      this.leaveBtn,
      this.noteEl,
      this.legendEl,
    ]);
    this.root = el('div', 'screen overlay hidden', [panel]);
    parent.append(this.root);
  }

  /** Controls reference for the device in use (HTML from legendHtml). */
  setLegend(title: string, html: string): void {
    this.legendEl.innerHTML = html ? `<div class="lbl">${title}</div><div class="lg-grid">${html}</div>` : '';
  }

  /** JUMP OFF THE PORCH: no loadout to change (you find your guns). */
  setLoadoutAllowed(on: boolean): void {
    this.loadoutBtn.classList.toggle('hidden', !on);
  }

  show(v: boolean, online = false, canEndMatch = false): void {
    this.confirm = false;
    this.confirmEnd = false;
    this.leaveBtn.textContent = 'LEAVE MATCH';
    this.endBtn.textContent = 'END MATCH FOR EVERYONE';
    this.endBtn.classList.toggle('hidden', !canEndMatch);
    this.noteEl.textContent = online ? 'The match keeps going while this menu is open.' : '';
    this.root.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

export interface ResultsActions {
  playAgain(): void;
  mainMenu(): void;
}

/** Shown under the final scoreboard. */
export class ResultsBar {
  readonly root: HTMLElement;
  private text: HTMLElement;
  private again: HTMLButtonElement;
  private menu: HTMLButtonElement;

  constructor(parent: HTMLElement, actions: ResultsActions) {
    this.text = el('div', 'results-text', '');
    this.again = button('PLAY AGAIN', 'btn primary', () => actions.playAgain());
    this.menu = button('MAIN MENU', 'btn', () => actions.mainMenu());
    this.root = el('div', 'results-bar hidden', [this.text, el('div', 'row center', [this.again, this.menu])]);
    parent.append(this.root);
  }

  show(v: boolean, online = false): void {
    this.root.classList.toggle('hidden', !v);
    this.again.classList.toggle('hidden', online);
    this.text.textContent = online ? 'Heading back to the lobby…' : '';
    this.menu.textContent = online ? 'LEAVE LOBBY' : 'MAIN MENU';
  }
}

/** "Click to play" hint shown while the mouse is not captured. */
export class ClickToPlay {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'click-to-play hidden', [
      el('div', 'ctp-title', 'CLICK TO PLAY'),
      el('div', 'ctp-sub', 'WASD move · Mouse aim · LMB fire · RMB aim · R reload · Shift sprint · C crouch · Space jump · 1-3 weapons · G throw · Q swap shoulder · Tab scores · Esc menu'),
    ]);
    parent.append(this.root);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
