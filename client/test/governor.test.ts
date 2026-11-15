import { approx, assert, test } from '../../shared/test/harness';
import { ResolutionGovernor } from '../src/game/resolutionGovernor';

/**
 * Runs the governor against a simulated machine for `seconds`. `fpsAt(scale, t)` is the frame
 * rate that machine reaches at a given resolution scale. Returns how often the scale changed.
 */
function simulate(g: ResolutionGovernor, seconds: number, fpsAt: (scale: number, t: number) => number, log?: number[]): number {
  let t = 0;
  let changes = 0;
  while (t < seconds) {
    const dt = 1 / fpsAt(g.scale, t);
    t += dt;
    if (g.frame(dt)) {
      changes++;
      log?.push(g.scale);
    }
  }
  return changes;
}

/** GPU-bound: frame rate grows as pixels shrink, capped by the display refresh. */
const gpuBound = (fpsAtFull: number, hz = 60) => (scale: number) => Math.min(hz, fpsAtFull / (scale * scale));

test('governor: a machine that holds 60 fps is left alone', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  const changes = simulate(g, 120, () => 60);
  assert(changes === 0 && g.scale === 1, `expected no changes, got ${changes} (scale ${g.scale})`);
});

test('governor: a GPU-bound desktop sheds pixels until it holds 60, then stays put', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  const log: number[] = [];
  simulate(g, 20, gpuBound(40), log); // 40 fps at full resolution
  approx(g.scale, 0.8, 0.001, `should settle at 80% (steps: ${log.join(' > ')})`);
  assert(gpuBound(40)(g.scale) >= 52, 'settled below the target');
  // the one upward probe failed: it must now hold still for a good while...
  const soon = simulate(g, 15, gpuBound(40));
  assert(soon === 0, `scale kept changing right after settling (${soon} changes)`);
  // ...and across ten minutes probe only a handful of times (each failed probe doubles the wait)
  let under = 0;
  let probes = 0;
  let t = 0;
  while (t < 600) {
    const fps = gpuBound(40)(g.scale);
    const dt = 1 / fps;
    t += dt;
    if (fps < 52) under += dt;
    if (g.frame(dt) && g.scale > 0.8) probes++;
  }
  assert(probes <= 5, `probed upward ${probes} times in ten minutes`);
  assert(under < 20, `spent ${under.toFixed(1)}s under the target in ten minutes`);
  approx(g.scale, 0.8, 0.001, 'should still be at 80%');
});

test('governor: a CPU-bound machine gets its resolution back (lowering it does not help)', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  const log: number[] = [];
  simulate(g, 12, () => 45, log); // 45 fps no matter the resolution
  assert(g.scale === 1, `resolution should be restored, is ${g.scale} (steps: ${log.join(' > ')})`);
  assert(log.length === 2, `expected one probe down and one undo, got ${log.join(' > ')}`);
  // ... and it does not try again every few seconds
  const later = simulate(g, 30, () => 45);
  assert(later === 0, `it should rest after a useless step, changed ${later} times`);
  // across ten minutes the image is degraded only for a few seconds in total
  let degraded = 0;
  let t = 0;
  while (t < 600) {
    const dt = 1 / 45;
    t += dt;
    g.frame(dt);
    if (g.scale < 1) degraded += dt;
  }
  assert(degraded < 15, `spent ${degraded.toFixed(1)}s at reduced resolution on a CPU-bound machine`);
});

test('governor: a 50 Hz display is not mistaken for a slow GPU', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  simulate(g, 30, gpuBound(200, 50));
  assert(g.scale === 1, `scale should be back at 1 on a 50 Hz display, is ${g.scale}`);
});

test('governor: phones target 30 fps and only spend real headroom', () => {
  const g = new ResolutionGovernor({ targetFps: 30 });
  const log: number[] = [];
  simulate(g, 30, gpuBound(22), log); // 22 fps at full resolution
  approx(g.scale, 0.9, 0.001, `should settle at 90% (steps: ${log.join(' > ')})`);
  assert(gpuBound(22)(g.scale) >= 26, 'settled under 30-ish fps');
  const later = simulate(g, 60, gpuBound(22));
  assert(later === 0, 'must not probe upward without headroom');

  const fast = new ResolutionGovernor({ targetFps: 30 });
  assert(simulate(fast, 60, () => 60) === 0 && fast.scale === 1, 'a phone running at 60 fps is left alone');
  const mid = new ResolutionGovernor({ targetFps: 30 });
  assert(simulate(mid, 60, () => 31) === 0 && mid.scale === 1, 'a phone holding 31 fps is left alone');
});

test('governor: never goes below the minimum scale', () => {
  const g = new ResolutionGovernor({ targetFps: 60, minScale: 0.6 });
  simulate(g, 60, gpuBound(12));
  approx(g.scale, 0.6, 0.001, 'very slow GPU should sit at the floor');
});

test('governor: resolution comes back when the load goes away', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  simulate(g, 20, gpuBound(40));
  assert(g.scale < 1, 'should have dropped under load');
  // the heavy scene ends: 60 fps at any resolution
  simulate(g, 60, () => 60);
  assert(g.scale === 1, `should climb back to full resolution, is ${g.scale}`);
});

test('governor: long gaps (hidden tab, loading hitch) are not treated as slow frames', () => {
  const g = new ResolutionGovernor({ targetFps: 60 });
  for (let i = 0; i < 200; i++) {
    g.frame(1 / 60);
    if (i % 20 === 0) g.frame(1.5);
  }
  assert(g.scale === 1, 'hitches must not lower the resolution');
  assert(g.frame(Number.NaN) === false && g.frame(-1) === false && g.frame(0) === false, 'bad frame times are ignored');
});
