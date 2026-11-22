import { el } from './dom';

/**
 * Short cinematic moments over the game, in the town's own poster style (bold slabs, sticker
 * stripes, Paytone lettering): never over the controls, always skippable, and they step
 * aside for reduced-motion settings. Motion ideas after MG Styles 15's flat-vector and
 * typography films: staggered letter slams, stripe wipes, a countdown that counts with the
 * game, eased in and out.
 */

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * JUMP OFF THE PORCH, as the transport takes off: stripes wipe in, the title slams in letter by
 * letter, the line under it, then 3-2-1 with the doors (the real countdown) and out. The blimp
 * and its controls carry on underneath; any key, click or tap skips it.
 */
export class MatchIntro {
  private root: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private count: HTMLElement;
  private timer = 0;
  private playing = false;
  private lastShown = '';
  private onSkip = () => this.skip();
  /** Eases the 3D view's cinematic vignette (0..1). */
  onCinematic: ((k: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.title = el('div', 'ci-title');
    this.sub = el('div', 'ci-sub');
    this.count = el('div', 'ci-count');
    this.root = el('div', 'ci-intro hidden', [
      el('div', 'ci-stripe a'), el('div', 'ci-stripe b'), this.title, this.sub, this.count,
      el('div', 'ci-skip', 'ANY KEY TO SKIP'),
    ]);
    parent.append(this.root);
  }

  /** Starts the intro. `subtitle`: the line under the title. */
  play(subtitle: string): void {
    if (this.playing) return;
    this.playing = true;
    this.timer = 0;
    this.lastShown = '';
    const text = 'JUMP OFF THE PORCH';
    this.title.innerHTML = [...text].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
    this.sub.textContent = subtitle;
    this.count.textContent = '';
    this.root.classList.remove('hidden', 'out');
    this.root.classList.toggle('reduced', REDUCED);
    // restart the CSS animations
    void this.root.offsetWidth;
    this.root.classList.add('on');
    this.onCinematic?.(1);
    window.addEventListener('keydown', this.onSkip, { once: true });
    window.addEventListener('pointerdown', this.onSkip, { once: true });
  }

  /** Every frame while it plays: `doorsIn` is the real countdown (s): to liftoff, or to the doors opening. */
  update(dt: number, doorsIn: number): void {
    if (!this.playing) return;
    this.timer += dt;
    // the countdown follows the game's own clock (3, 2, 1, GO), once the title is in
    let shown = '';
    if (this.timer > 0.9 && Number.isFinite(doorsIn)) {
      if (doorsIn > 3.05) shown = '';
      else if (doorsIn > 0) shown = String(Math.ceil(doorsIn));
      else shown = 'GO!';
    }
    if (shown !== this.lastShown) {
      this.lastShown = shown;
      this.count.textContent = shown;
      this.count.classList.remove('tick');
      void this.count.offsetWidth;
      if (shown) this.count.classList.add('tick');
    }
    // done: after GO (or after a while if the doors are already open)
    if ((shown === 'GO!' && this.timer > 2.2) || this.timer > 9) this.finish();
  }

  skip(): void {
    if (this.playing) this.finish();
  }

  private finish(): void {
    this.playing = false;
    this.root.classList.add('out');
    this.onCinematic?.(0);
    window.removeEventListener('keydown', this.onSkip);
    window.removeEventListener('pointerdown', this.onSkip);
    setTimeout(() => {
      if (!this.playing) this.root.classList.add('hidden');
      this.root.classList.remove('on');
    }, 450);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onSkip);
    window.removeEventListener('pointerdown', this.onSkip);
    this.onCinematic?.(0);
    this.root.remove();
  }
}
