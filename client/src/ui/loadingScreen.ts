/**
 * Drives the boot loading screen (markup and styles are inline in index.html so the artwork is
 * up before any script runs). Real loading moves the bar part of the way; `finish` then keeps
 * the screen up a little longer so the artwork can be enjoyed, fills the rest, and fades out.
 */
export class LoadingScreen {
  private readonly fill: HTMLElement | null;
  /** Where the bar is heading (0..1) and where it is drawn now (eased toward the target). */
  private target = 0;
  private shown = 0;
  private hold: { from: number; start: number; ms: number } | null = null;
  private raf = 0;
  private last = performance.now();
  private lastAria = -1;

  constructor(private readonly root: HTMLElement | null) {
    this.fill = root?.querySelector<HTMLElement>('.ld-fill') ?? null;
    if (root) this.raf = requestAnimationFrame(this.frame);
  }

  /** Moves the bar to `fraction` (0..1). The bar never goes backwards. */
  set(fraction: number): void {
    this.target = Math.max(this.target, Math.min(1, fraction));
  }

  /** Keeps the screen up for `holdMs` while the bar fills to the end, then fades it out. */
  finish(holdMs: number): void {
    if (!this.root || this.hold) return;
    this.hold = { from: this.target, start: performance.now(), ms: Math.max(0, holdMs) };
    // timers, not animation frames, decide when it closes (frames pause in a background tab)
    window.setTimeout(() => {
      this.set(1);
      this.root!.classList.add('ld-done');
      window.setTimeout(() => this.remove(), 650);
    }, this.hold.ms + 250);
  }

  /** Removes the screen at once. */
  remove(): void {
    cancelAnimationFrame(this.raf);
    this.root?.remove();
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.hold) {
      const t = this.hold.ms > 0 ? Math.min(1, (now - this.hold.start) / this.hold.ms) : 1;
      this.set(this.hold.from + (1 - this.hold.from) * t);
    }
    this.shown += (this.target - this.shown) * Math.min(1, dt * 8);
    if (this.target - this.shown < 0.001) this.shown = this.target;
    if (this.fill) this.fill.style.width = `${(this.shown * 100).toFixed(2)}%`;
    const pct = Math.round(this.shown * 100);
    if (pct !== this.lastAria) {
      this.lastAria = pct;
      this.root?.setAttribute('aria-valuenow', String(pct));
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
