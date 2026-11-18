import { bindings } from '../input/bindings';
import type { InputFrame } from '../input/types';

const FOCUSABLE = 'button:not(:disabled), input:not([type="hidden"]), [role="switch"]';

/**
 * Controller navigation for the DOM menus: d-pad / left stick moves a focus ring to the
 * nearest control in that direction, A / Cross activates it, B / Circle goes back, and
 * left/right nudges sliders.
 */
export class MenuNav {
  private root: HTMLElement;
  private current: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // the mouse takes over: drop the controller focus ring
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.clear();
    });
    // capture phase: a handled Escape never reaches the game (where it would also mean "pause")
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.repeat && this.escape()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  /** Topmost visible menu surface. */
  private scope(): HTMLElement | null {
    const screens = [...this.root.querySelectorAll<HTMLElement>('.screen:not(.hidden)')];
    if (screens.length > 0) {
      const top = screens[screens.length - 1];
      // a dialog open inside the screen is the only thing to navigate
      return top.querySelector<HTMLElement>('.eco-dim:not(.hidden)') ?? top;
    }
    return this.root.querySelector<HTMLElement>('.results-bar:not(.hidden)');
  }

  /** Escape on a keyboard: the same as B on a controller, for the store screens. */
  escape(): boolean {
    const screens = [...this.root.querySelectorAll<HTMLElement>('.screen:not(.hidden)')];
    const top = screens[screens.length - 1];
    if (!top || !(top.classList.contains('eco') || top.classList.contains('eco-auth-wrap') || top.classList.contains('aj-talk'))) return false;
    const dialog = top.querySelector<HTMLElement>('.eco-dim:not(.hidden)');
    if (dialog) {
      dialog.classList.add('hidden');
      return true;
    }
    top.querySelector<HTMLElement>('[data-back]:not(:disabled)')?.click();
    this.clear();
    return true;
  }

  private candidates(scope: HTMLElement): HTMLElement[] {
    return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null && !e.closest('.hidden'));
  }

  clear(): void {
    this.current?.classList.remove('nav-focus');
    this.current = null;
  }

  private focus(elm: HTMLElement): void {
    this.current?.classList.remove('nav-focus');
    this.current = elm;
    elm.classList.add('nav-focus');
    elm.focus({ preventScroll: true });
    elm.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Feed one frame of input. Returns true if it consumed a navigation action. */
  handle(f: InputFrame): boolean {
    if (bindings.capturing) return false; // Settings is waiting for a button to bind
    if (f.navX === 0 && f.navY === 0 && !f.accept && !f.back) return false;
    const scope = this.scope();
    if (!scope) return false;
    const list = this.candidates(scope);
    if (list.length === 0) return false;
    let cur = this.current;
    if (!cur || !list.includes(cur)) {
      cur = null;
      this.current?.classList.remove('nav-focus');
      this.current = null;
    }

    if (f.back) {
      const back = scope.querySelector<HTMLElement>('[data-back]:not(:disabled)');
      if (back) {
        back.click();
        this.clear();
      }
      return true;
    }

    if (!cur) {
      // first press just shows the ring on the most important control
      const first = list.find((e) => e.classList.contains('primary')) ?? list[0];
      this.focus(first);
      return true;
    }

    if (f.accept) {
      if (cur instanceof HTMLInputElement && cur.type !== 'range') cur.focus();
      else cur.click();
      return true;
    }

    // sliders: left / right changes the value
    if (cur instanceof HTMLInputElement && cur.type === 'range' && f.navX !== 0 && f.navY === 0) {
      const min = Number(cur.min), max = Number(cur.max);
      const step = Math.max(Number(cur.step) || 1, (max - min) / 40);
      cur.value = String(Math.min(max, Math.max(min, Number(cur.value) + step * f.navX)));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // spatial search: nearest control in the pressed direction
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const dx = ex - cx, dy = ey - cy;
      let along: number, across: number;
      if (f.navY !== 0) {
        along = dy * f.navY;
        // overlapping columns count as perfectly aligned
        across = r.right < r0.left ? r0.left - r.right : r.left > r0.right ? r.left - r0.right : 0;
      } else {
        along = dx * f.navX;
        across = r.bottom < r0.top ? r0.top - r.bottom : r.top > r0.bottom ? r.top - r0.bottom : 0;
      }
      if (along < 4) continue;
      const score = along + across * 3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.focus(best);
    return true;
  }
}
