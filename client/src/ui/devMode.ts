import { button, el } from './dom';

/**
 * DEV MODE: a JUMP OFF THE PORCH practice session to test things in (on foot in the town, no
 * riot, one of everything laid out, the day/night clock under your control). It runs only in
 * this browser (a local session, never online), so the passcode is a door to keep players out
 * of a testing tool, not a security boundary: nothing in it touches accounts, GRAMS or matches.
 */

/** FNV-1a (32 bit): the passcode is compared by hash, so it is not sitting in the code as text. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const PASS_HASH = 0x44d9993a;

export function checkDevPasscode(code: string): boolean {
  return fnv1a(code.trim()) === PASS_HASH;
}

/** The passcode prompt: calls `onOk` with a correct code, shakes on a wrong one. */
export class DevPasscodePrompt {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private msg: HTMLElement;

  constructor(parent: HTMLElement, private onOk: () => void) {
    this.input = document.createElement('input');
    this.input.type = 'password';
    this.input.inputMode = 'numeric';
    this.input.autocomplete = 'off';
    this.input.maxLength = 12;
    this.input.className = 'dev-code';
    this.input.placeholder = 'Passcode';
    this.input.setAttribute('aria-label', 'Dev mode passcode');
    this.msg = el('div', 'dev-msg', '');
    const go = button('ENTER', 'btn primary', () => this.submit());
    const cancel = button('CANCEL', 'btn ghost', () => this.show(false));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.show(false);
    });
    const panel = el('div', 'overlay-panel dev-panel', [
      el('div', 'panel-title', 'DEV MODE'),
      el('p', 'dev-note', 'Free roam in JUMP OFF THE PORCH with every gun and item laid out, for testing. Offline, just you.'),
      this.input,
      this.msg,
      el('div', 'row center', [cancel, go]),
    ]);
    this.root = el('div', 'screen overlay hidden dev-overlay', [panel]);
    parent.append(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) {
      this.input.value = '';
      this.msg.textContent = '';
      setTimeout(() => this.input.focus(), 30);
    }
  }

  private submit(): void {
    if (checkDevPasscode(this.input.value)) {
      this.show(false);
      this.onOk();
      return;
    }
    this.msg.textContent = 'Wrong passcode.';
    this.input.value = '';
    this.root.querySelector('.dev-panel')?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
      { duration: 240 },
    );
  }
}

/** In a dev session: a small panel (top right) with the testing controls and their keys. */
export class DevPanel {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, actions: { skipTime(): void; relayout(): void }) {
    const skip = button('SKIP 3:00 (N)', 'dev-b', () => actions.skipTime());
    const lay = button('LAY OUT GEAR (L)', 'dev-b', () => actions.relayout());
    this.root = el('div', 'dev-hud', [el('div', 'dev-tag', 'DEV MODE'), skip, lay]);
    parent.append(this.root);
  }

  dispose(): void {
    this.root.remove();
  }
}
