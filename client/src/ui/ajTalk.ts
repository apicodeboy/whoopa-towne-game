import { button, el } from './dom';
import { gIcon } from './economyArt';
import { glyphHtml } from './prompts';
import type { DeviceKind } from '../input/types';

export interface AjTalkActions {
  shop: () => void;
  grams: () => void;
  preview: () => void;
  leave: () => void;
}

const LINES = [
  "Welcome to AJ's! What you tryna cop today?",
];

/**
 * Talking to AJ at the register: the "Press E" prompt in the world, then his greeting and the
 * four things you can do. Shop / Buy GRAMS / Preview Outfits open the real store screens.
 */
export class AjTalk {
  readonly root: HTMLElement;
  private promptEl: HTMLElement;
  private line: HTMLElement;
  private lastPrompt = '';

  constructor(parent: HTMLElement, actions: AjTalkActions, onPromptTap: () => void) {
    // the prompt (a button too, so it works by touch)
    this.promptEl = button('', 'aj-prompt hidden', onPromptTap);
    parent.append(this.promptEl);

    this.line = el('p', 'aj-line', LINES[0]);
    const badge = el('div', 'aj-badge');
    badge.innerHTML = `<span class="aj-cap">AJ</span>`;
    const leave = button('Leave', 'aj-opt ghost', actions.leave);
    leave.dataset.back = '1';
    const shop = button('Shop', 'aj-opt gold primary', actions.shop);
    const grams = button('', 'aj-opt', actions.grams);
    grams.innerHTML = `${gIcon(18)}<span>Buy GRAMS</span>`;
    const box = el('div', 'aj-box', [
      el('div', 'aj-who', [badge, el('div', 'aj-name', [el('b', '', 'AJ'), el('span', '', "Owner, AJ'S")])]),
      this.line,
      el('div', 'aj-opts', [shop, grams, button('Preview Outfits', 'aj-opt', actions.preview), leave]),
    ]);
    this.root = el('div', 'screen aj-talk hidden', [box]);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** "Press E to Talk to AJ" while you are at the counter (the key follows the device). */
  prompt(show: boolean, device: string): void {
    const state = show && !this.visible ? device : '';
    if (state === this.lastPrompt) return;
    this.lastPrompt = state;
    this.promptEl.classList.toggle('hidden', !state);
    // controllers: d-pad down (the same button that searches bags in JUMP OFF THE PORCH)
    this.promptEl.innerHTML = device === 'touch'
      ? 'Tap to <b>Talk to AJ</b>'
      : `Press ${glyphHtml(device as DeviceKind, 'use')} to <b>Talk to AJ</b>`;
  }

  open(): void {
    this.line.textContent = LINES[Math.floor(Math.random() * LINES.length)];
    this.root.classList.remove('hidden');
    this.prompt(false, '');
    (this.root.querySelector('.aj-opt.primary') as HTMLElement | null)?.focus();
  }

  close(): void {
    this.root.classList.add('hidden');
  }
}
