import { el } from './dom';

/** Small transient messages (errors, notices) stacked at the top of the screen. */
export class Toasts {
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts');
    parent.append(this.root);
  }

  show(text: string, tone: 'info' | 'error' | 'good' = 'info', ms = 3800): void {
    if (!text) return;
    const t = el('div', `toast ${tone}`, text);
    this.root.append(t);
    while (this.root.childElementCount > 4) this.root.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }
}
