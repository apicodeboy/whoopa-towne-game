/**
 * Dynamic resolution: watches the frame rate and trades render resolution for speed.
 *
 * Every couple of seconds it looks at the average frame rate:
 *  - below the target  -> render 10% fewer pixels per axis (down to `minScale`)
 *  - comfortably at it -> try 10% more again (up to 1)
 * and it protects against its own mistakes:
 *  - if lowering the resolution did not help (the game is CPU-bound, or the display simply
 *    refreshes slower than the target) the step is undone and the governor rests for a while
 *  - if raising it pushed the frame rate back under the target, it goes back down and stops
 *    probing upward for a while, so the image does not pulse.
 *
 * Pure logic (no DOM / WebGL) so it can be tested; the renderer applies `scale`.
 */
export interface GovernorOptions {
  /** Frame rate to hold (60 on desktop, 30 on phones). */
  targetFps: number;
  /** Lowest allowed fraction of the full resolution. */
  minScale?: number;
}

const STEP = 0.1;
/** Seconds of frames averaged per decision. */
const WINDOW = 2;
/** Seconds ignored after a change (resizing the frame buffer causes a hitch of its own). */
const SETTLE = 0.6;
const REST_AFTER_USELESS_STEP = 45;
const REST_AFTER_FAILED_PROBE = 30;

export class ResolutionGovernor {
  /** Fraction of the full resolution to render at (per axis). */
  scale = 1;
  private target: number;
  private minScale: number;
  private time = 0;
  private settle = SETTLE;
  private winTime = 0;
  private winFrames = 0;
  private last: 'none' | 'down' | 'up' = 'none';
  private fpsBefore = 0;
  private scaleBefore = 1;
  private restUntil = 0;
  private noProbeUntil = 0;
  /** Consecutive down-steps that did not help (each one doubles the rest that follows). */
  private useless = 0;
  /** Consecutive upward probes that failed (each one doubles the wait before the next). */
  private failedProbes = 0;

  constructor(opts: GovernorOptions) {
    this.target = opts.targetFps;
    this.minScale = opts.minScale ?? 0.6;
  }

  setTarget(fps: number): void {
    if (fps === this.target) return;
    this.target = fps;
    this.reset(this.scale);
  }

  /** Forget the history (after a quality change, a pause, or the tab being hidden). */
  reset(scale = 1): void {
    this.scale = scale;
    this.settle = SETTLE;
    this.winTime = 0;
    this.winFrames = 0;
    this.last = 'none';
    this.restUntil = 0;
    this.noProbeUntil = 0;
    this.useless = 0;
    this.failedProbes = 0;
  }

  /**
   * Feed one frame (seconds since the previous one). Returns true when `scale` changed and
   * the renderer should resize its frame buffer.
   */
  frame(dt: number): boolean {
    // a long gap is a hidden tab, a breakpoint or a loading hitch: not a measurement
    if (!(dt > 0) || dt > 0.25) {
      this.winTime = 0;
      this.winFrames = 0;
      this.settle = SETTLE;
      return false;
    }
    this.time += dt;
    if (this.settle > 0) {
      this.settle -= dt;
      return false;
    }
    this.winTime += dt;
    this.winFrames++;
    if (this.winTime < WINDOW) return false;
    const fps = this.winFrames / this.winTime;
    this.winTime = 0;
    this.winFrames = 0;
    if (this.time < this.restUntil) return false;

    const low = this.target * 0.87;
    const last = this.last;
    this.last = 'none';
    if (fps < low) {
      if (last === 'down' && fps < this.fpsBefore * 1.05) {
        // fewer pixels changed nothing: resolution is not the bottleneck. Give them back and
        // rest, longer each time this happens in a row.
        this.restUntil = this.time + REST_AFTER_USELESS_STEP * 2 ** Math.min(this.useless, 4);
        this.useless++;
        return this.set(this.scaleBefore);
      }
      if (last === 'down') this.useless = 0;
      // an upward probe that failed: go back down and wait (longer each time) before probing again
      const afterProbe = last === 'up';
      if (afterProbe) {
        this.noProbeUntil = this.time + REST_AFTER_FAILED_PROBE * 2 ** Math.min(this.failedProbes, 4);
        this.failedProbes++;
      }
      if (this.scale <= this.minScale + 1e-6) return false;
      this.last = afterProbe ? 'none' : 'down';
      this.fpsBefore = fps;
      this.scaleBefore = this.scale;
      // far below the target: take a double step
      return this.set(this.scale - (!afterProbe && fps < low * 0.7 ? STEP * 2 : STEP));
    }
    if (last === 'down') this.useless = 0;
    if (last === 'up') this.failedProbes = 0;
    // "comfortably at the target": for a 60 fps target the display caps what we can observe,
    // so near-target counts; for 30 we ask for real headroom before spending it
    const comfortable = this.target >= 50 ? fps >= this.target * 0.965 : fps >= this.target * 1.45;
    if (comfortable && this.scale < 1 - 1e-6 && this.time >= this.noProbeUntil) {
      this.last = 'up';
      return this.set(this.scale + STEP);
    }
    return false;
  }

  private set(scale: number): boolean {
    const next = Math.round(Math.min(1, Math.max(this.minScale, scale)) * 100) / 100;
    if (next === this.scale) return false;
    this.scale = next;
    this.settle = SETTLE;
    return true;
  }
}
