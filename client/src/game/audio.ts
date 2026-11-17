import type * as THREE from 'three';
import type { SettingsStore } from '../core/settings';
import type { GameAudio } from './game';

/**
 * All sound in the game is synthesized here with WebAudio (no audio files, all original):
 * gunshots per weapon, impacts, reloads, footsteps, hit markers, explosions, UI clicks and a
 * quiet city ambience. Positional sounds are attenuated, panned and muffled by distance.
 */

type Fn = (t: number, i: number) => number;

const MAX_VOICES = 28;

function expDecay(t: number, tau: number): number {
  return Math.exp(-t / tau);
}

export class AudioEngine implements GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private settings: SettingsStore;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private ambienceTimer: ReturnType<typeof setTimeout> | null = null;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdLevel = 0;
  private unsub: () => void;
  private lastStep = 0;
  /** Synthesis jobs still to run (spread over a few frames so the first click never hitches). */
  private jobs: Array<() => void> = [];
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  /** Number of sounds started (diagnostics / tests). */
  played = 0;

  constructor(settings: SettingsStore) {
    this.settings = settings;
    this.unsub = settings.onChange(() => this.applyVolumes());
    // a hidden tab stops rendering; stop the city bed with it
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };

  /** True once the browser has let us start audio. */
  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Browsers only allow audio after a user gesture. Call this from any input handler;
   * it is cheap to call repeatedly.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    // gentle limiter so stacked gunfire does not clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);
    this.applyVolumes();
    this.buildBuffers(ctx);
    this.pump();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  /** Runs queued synthesis jobs for a few milliseconds at a time. */
  private pump = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = performance.now();
    while (this.jobs.length > 0 && performance.now() - t0 < 6) this.jobs.shift()!();
    if (this.jobs.length > 0) setTimeout(this.pump, 0);
    else this.startAmbience(ctx);
  };

  /** True once every sound has been synthesized. */
  get ready(): boolean {
    return this.ctx !== null && this.jobs.length === 0;
  }

  /** Peak output level right now, 0..1 (diagnostics / tests). */
  level(): number {
    const ctx = this.ctx;
    if (!ctx || !this.master) return 0;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
      this.meterBuf = new Float32Array(this.analyser.fftSize);
    }
    const d = this.meterBuf!;
    this.analyser.getFloatTimeDomainData(d);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    return peak;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.ambience) return;
    const s = this.settings.values;
    this.master.gain.setTargetAtTime(s.volume * 0.9, this.ctx.currentTime, 0.03);
    this.ambience.gain.setTargetAtTime(s.ambience * 0.24, this.ctx.currentTime, 0.2);
  }

  // ------------------------------------------------------------------ synthesis
  private make(ctx: AudioContext, name: string, seconds: number, fn: Fn): void {
    this.jobs.push(() => {
      const n = Math.floor(seconds * ctx.sampleRate);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < n; i++) {
        d[i] = fn(i / ctx.sampleRate, i);
        peak = Math.max(peak, Math.abs(d[i]));
      }
      // normalize and fade the last few ms so buffers never click
      const k = peak > 0 ? 0.95 / peak : 1;
      const fade = Math.min(n, Math.floor(ctx.sampleRate * 0.008));
      for (let i = 0; i < n; i++) d[i] *= k * (i > n - fade ? (n - i) / fade : 1);
      this.buffers.set(name, b);
    });
  }

  private buildBuffers(ctx: AudioContext): void {
    const sr = ctx.sampleRate;
    const TAU = Math.PI * 2;
    const rnd = () => Math.random() * 2 - 1;
    /** White noise through a one-pole low-pass (state kept in the closure). */
    const lpNoise = (cutoff: number) => {
      let y = 0;
      const a = 1 - Math.exp((-TAU * cutoff) / sr);
      return () => (y += a * (rnd() - y));
    };
    /** Sine whose frequency glides from f0 to f1 with time constant tau. */
    const sweep = (f0: number, f1: number, tau: number) => {
      let phase = 0;
      return (t: number) => {
        phase += (TAU * (f1 + (f0 - f1) * Math.exp(-t / tau))) / sr;
        return Math.sin(phase);
      };
    };

    // --- gunshots: crack (bright noise) + body (mid noise) + thump (pitch-dropping sine) + tail ---
    const gun = (name: string, len: number, bodyTau: number, bodyCut: number, thumpF: [number, number], thumpGain: number, tailTau: number, crack: number) => {
      const body = lpNoise(bodyCut), tail = lpNoise(bodyCut * 0.35), th = sweep(thumpF[0], thumpF[1], 0.03);
      this.make(ctx, name, len, (t) => {
        const c = rnd() * expDecay(t, 0.004) * crack;
        const bdy = body() * expDecay(t, bodyTau) * 1.6;
        const thump = th(t) * expDecay(t, bodyTau * 1.6) * thumpGain;
        const tl = tail() * expDecay(t, tailTau) * 0.5 * Math.min(1, t / 0.02);
        return c + bdy + thump + tl;
      });
    };
    gun('gun_smg', 0.26, 0.028, 5200, [240, 95], 0.7, 0.07, 0.9);
    gun('gun_ar', 0.34, 0.04, 3800, [170, 62], 1.0, 0.1, 1.0);
    gun('gun_shotgun', 0.62, 0.085, 2400, [120, 42], 1.5, 0.18, 0.8);
    gun('gun_pistol', 0.3, 0.032, 4400, [200, 75], 0.85, 0.08, 1.1);

    const imp = lpNoise(5000);
    this.make(ctx, 'impact', 0.12, (t) => imp() * expDecay(t, 0.018) + Math.sin(TAU * 2300 * t) * expDecay(t, 0.01) * 0.3);
    this.make(ctx, 'ricochet', 0.28, (t) => Math.sin(TAU * (3400 - 2200 * t / 0.28) * t) * expDecay(t, 0.07) * 0.6 + rnd() * expDecay(t, 0.006) * 0.5);

    const click = (t: number, at: number, f: number, tau = 0.008) => (t < at ? 0 : Math.sin(TAU * f * (t - at)) * expDecay(t - at, tau) + rnd() * expDecay(t - at, 0.003) * 0.6);
    this.make(ctx, 'reload', 0.62, (t) => click(t, 0.0, 900) * 0.8 + click(t, 0.2, 620, 0.012) + click(t, 0.5, 1400) * 0.9);
    this.make(ctx, 'reload_done', 0.14, (t) => click(t, 0.0, 1500) + click(t, 0.05, 1900) * 0.8);
    this.make(ctx, 'dry', 0.07, (t) => click(t, 0, 2100, 0.005));
    this.make(ctx, 'swap', 0.16, (t) => click(t, 0, 700, 0.014) * 0.7 + click(t, 0.07, 1100) * 0.6);

    for (let v = 0; v < 3; v++) {
      const st = lpNoise(380 + v * 130);
      this.make(ctx, `step${v}`, 0.11, (t) => st() * expDecay(t, 0.022) * Math.min(1, t / 0.003) + Math.sin(TAU * (95 + v * 12) * t) * expDecay(t, 0.02) * 0.5);
    }
    const jn = lpNoise(900);
    this.make(ctx, 'jump', 0.14, (t) => jn() * Math.sin(Math.PI * Math.min(1, t / 0.14)) * 0.6);
    const ln = lpNoise(260);
    this.make(ctx, 'land', 0.2, (t) => ln() * expDecay(t, 0.04) + Math.sin(TAU * 70 * t) * expDecay(t, 0.05) * 0.8);

    this.make(ctx, 'hit', 0.07, (t) => (Math.sin(TAU * 1750 * t) + Math.sin(TAU * 2620 * t) * 0.5) * expDecay(t, 0.014));
    this.make(ctx, 'hit_head', 0.16, (t) => (Math.sin(TAU * 2350 * t) + Math.sin(TAU * 3520 * t) * 0.6) * expDecay(t, 0.04));
    this.make(ctx, 'hit_kill', 0.3, (t) => Math.sin(TAU * 1320 * t) * expDecay(t, 0.03) + (t > 0.08 ? Math.sin(TAU * 1980 * (t - 0.08)) * expDecay(t - 0.08, 0.06) : 0));
    // JUMP OFF THE PORCH: balloon pop, loot zip, punch, riot siren
    this.make(ctx, 'pop', 0.16, (t) => rnd() * expDecay(t, 0.012) * 1.2 + Math.sin(TAU * 1200 * t) * expDecay(t, 0.02) * 0.4);
    this.make(ctx, 'loot', 0.22, (t) => Math.sin(TAU * (700 + 900 * Math.min(1, t / 0.1)) * t) * expDecay(t, 0.07) * 0.7);
    const pn = lpNoise(600);
    this.make(ctx, 'punch', 0.16, (t) => pn() * expDecay(t, 0.02) + Math.sin(TAU * 90 * t) * expDecay(t, 0.04) * 0.9);
    this.make(ctx, 'riot_siren', 1.6, (t) => {
      const f = 620 + 260 * Math.sin(TAU * 1.4 * t);
      return (Math.sin(TAU * f * t) * 0.6 + Math.sin(TAU * f * 2 * t) * 0.15) * Math.min(1, t / 0.2) * Math.min(1, (1.6 - t) / 0.3);
    });
    const hn = lpNoise(320);
    this.make(ctx, 'hurt', 0.18, (t) => hn() * expDecay(t, 0.035) + Math.sin(TAU * 110 * t) * expDecay(t, 0.05));
    this.make(ctx, 'death', 0.7, (t) => Math.sin(TAU * (220 - 150 * Math.min(1, t / 0.6)) * t) * expDecay(t, 0.25) * 0.8 + hn() * expDecay(t, 0.12));
    this.make(ctx, 'respawn', 0.4, (t) => Math.sin(TAU * 520 * t) * expDecay(t, 0.09) * 0.6 + (t > 0.1 ? Math.sin(TAU * 780 * (t - 0.1)) * expDecay(t - 0.1, 0.12) * 0.6 : 0));

    const wn = lpNoise(1400);
    this.make(ctx, 'throw', 0.22, (t) => wn() * Math.sin(Math.PI * Math.min(1, t / 0.22)) ** 2);
    this.make(ctx, 'bounce', 0.09, (t) => Math.sin(TAU * 1250 * t) * expDecay(t, 0.012) + rnd() * expDecay(t, 0.004) * 0.5);
    const en = lpNoise(900), en2 = lpNoise(140), sub = sweep(75, 28, 0.25);
    this.make(ctx, 'explosion', 1.6, (t) => rnd() * expDecay(t, 0.012) + en() * expDecay(t, 0.18) * 1.4 + en2() * expDecay(t, 0.55) * 2.2 + sub(t) * expDecay(t, 0.35) * 1.6);
    const sn = lpNoise(3200);
    this.make(ctx, 'smoke', 1.3, (t) => sn() * Math.min(1, t / 0.05) * expDecay(t, 0.45) * 0.8 + click(t, 0, 800, 0.02));

    const tone = (t: number, at: number, f: number, tau: number) => (t < at ? 0 : (Math.sin(TAU * f * (t - at)) + Math.sin(TAU * f * 2 * (t - at)) * 0.25) * expDecay(t - at, tau));
    this.make(ctx, 'zone_good', 0.6, (t) => tone(t, 0, 523, 0.1) + tone(t, 0.11, 659, 0.1) + tone(t, 0.22, 784, 0.18));
    this.make(ctx, 'zone_bad', 0.6, (t) => tone(t, 0, 440, 0.1) + tone(t, 0.13, 349, 0.2));
    this.make(ctx, 'tick', 0.12, (t) => tone(t, 0, 880, 0.03));
    this.make(ctx, 'start', 0.7, (t) => tone(t, 0, 392, 0.09) + tone(t, 0.1, 523, 0.09) + tone(t, 0.2, 784, 0.25));
    this.make(ctx, 'win', 1.2, (t) => tone(t, 0, 523, 0.12) + tone(t, 0.15, 659, 0.12) + tone(t, 0.3, 784, 0.12) + tone(t, 0.45, 1047, 0.4));
    this.make(ctx, 'lose', 1.2, (t) => tone(t, 0, 392, 0.16) + tone(t, 0.2, 330, 0.16) + tone(t, 0.4, 262, 0.45));
    this.make(ctx, 'ui', 0.05, (t) => Math.sin(TAU * 1200 * t) * expDecay(t, 0.008) * 0.7);

    // --- the riot: a crowd roaring and chanting (looped; volume follows how close it is) ---
    {
      const lo = lpNoise(380), hi = lpNoise(1500), rumble = lpNoise(120);
      const len = 6;
      const voices = Array.from({ length: 7 }, (_, i) => ({ f: 150 + i * 37 + Math.random() * 20, ph: Math.random() * TAU, at: Math.random() }));
      this.make(ctx, 'crowd', len, (t) => {
        // a chant on the beat ("HEY! ... HEY!") over a constant roar of many voices
        const beat = (t * 1.6) % 1;
        const chant = Math.max(0, 1 - beat * 3.2) ** 1.5;
        const band = hi() - lo(); // voices live in the mids
        let v = 0;
        for (const vo of voices) v += Math.sin(TAU * vo.f * t * (1 + 0.04 * Math.sin(TAU * 0.3 * t + vo.ph))) * (0.5 + 0.5 * Math.sin(TAU * (0.2 + vo.at) * t + vo.ph));
        const roar = band * 2.2 * (0.75 + 0.25 * Math.sin(TAU * t / len * 2)) + rumble() * 1.4;
        const edge = Math.min(1, t / 0.4, (len - t) / 0.4);
        return (roar + band * chant * 3.2 + v * 0.05 * (0.4 + chant)) * edge;
      });
    }

    // --- ambience bed: low city rumble with slow swells (looped) ---
    const r1 = lpNoise(110), r2 = lpNoise(700);
    const loopLen = 8;
    this.make(ctx, 'city', loopLen, (t) => {
      const swell = 0.75 + 0.25 * Math.sin((TAU * t) / loopLen) * Math.sin((TAU * 3 * t) / loopLen);
      const edge = Math.min(1, t / 0.4, (loopLen - t) / 0.4); // fade at the loop seam
      return (r1() * 2.2 + r2() * 0.22) * swell * edge;
    });
    // distant two-tone siren and a train horn, played occasionally and very quietly
    this.make(ctx, 'siren', 3.2, (t) => {
      const f = 620 + 180 * Math.sign(Math.sin(TAU * 0.9 * t));
      return Math.sin(TAU * f * t) * Math.min(1, t / 0.5, (3.2 - t) / 0.8) * 0.5;
    });
    this.make(ctx, 'horn', 2.4, (t) => {
      const e = Math.min(1, t / 0.15, (2.4 - t) / 0.5) * (t > 0.9 && t < 1.15 ? 0 : 1);
      return (Math.sin(TAU * 277 * t) + Math.sin(TAU * 349 * t) * 0.8 + Math.sin(TAU * 440 * t) * 0.5) * e * 0.4;
    });
  }

  private startAmbience(ctx: AudioContext): void {
    const b = this.buffers.get('city');
    if (b && this.ambience) {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(this.ambience);
      src.start();
    }
    const schedule = () => {
      this.ambienceTimer = setTimeout(() => {
        if (this.ctx && this.ambience && this.ctx.state === 'running') {
          const name = Math.random() < 0.55 ? 'siren' : 'horn';
          const buf = this.buffers.get(name);
          if (buf) {
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            const g = this.ctx.createGain();
            g.gain.value = 0.05 + Math.random() * 0.05;
            const lp = this.ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 900;
            const pan = this.ctx.createStereoPanner();
            pan.pan.value = name === 'horn' ? 0.6 : Math.random() * 1.6 - 0.8;
            src.connect(lp).connect(g).connect(pan).connect(this.ambience);
            src.start();
          }
        }
        schedule();
      }, 14000 + Math.random() * 26000);
    };
    schedule();
  }

  // ------------------------------------------------------------------ playback
  /**
   * Plays a buffer. With a position the sound is attenuated / panned / muffled relative
   * to the listener; without one it plays "in the player's head" (own actions, UI).
   */
  private play(name: string, gain: number, pos: THREE.Vector3 | null = null, rate = 1, refDist = 12): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !this.master || !buf || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    let g = gain;
    let pan = 0;
    let cutoff = 0;
    if (pos) {
      const dx = pos.x - this.lx, dy = pos.y - this.ly, dz = pos.z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      g *= 1 / (1 + (d / refDist) ** 1.6);
      if (g < 0.004) return;
      // listener's right axis from its yaw
      const rx = Math.cos(this.lyaw), rz = -Math.sin(this.lyaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / d) * 0.85)) : 0;
      if (d > 14) cutoff = Math.max(900, 9000 - d * 95);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const gn = ctx.createGain();
    gn.gain.value = g;
    let node: AudioNode = src;
    if (cutoff > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      node.connect(lp);
      node = lp;
    }
    node.connect(gn);
    if (pos && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gn.connect(p);
      p.connect(this.master);
    } else {
      gn.connect(this.master);
    }
    this.voices++;
    this.played++;
    src.onended = () => {
      this.voices--;
    };
    src.start();
  }

  // ------------------------------------------------------------------ GameAudio
  setListener(pos: THREE.Vector3, yaw: number): void {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    this.lyaw = yaw;
  }

  gunshot(weapon: number, pos: THREE.Vector3 | null, own: boolean): void {
    // index = WEAPON_IDS order (the sniper is a slowed-down rifle crack, fists a thump)
    const name = ['gun_smg', 'gun_ar', 'gun_shotgun', 'gun_pistol', 'gun_shotgun', 'punch'][weapon] ?? 'gun_ar';
    this.play(name, own ? 0.6 : 0.75, own ? null : pos, weapon === 4 ? 0.72 : 1, weapon === 4 ? 40 : 22);
  }

  /** A balloon popping on landing. */
  pop(pos: THREE.Vector3 | null): void {
    this.play('pop', 0.5, pos, 0.9 + Math.random() * 0.2, 14);
  }

  /** Something went into your inventory. */
  loot(): void {
    this.play('loot', 0.3);
  }

  /** The riot crowd's roar: 0 = silent, 1 = right in the middle of it. */
  crowd(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (level > 0.01 && !this.crowdSrc) {
      const buf = this.buffers.get('crowd');
      if (!buf) return;
      this.crowdGain = ctx.createGain();
      this.crowdGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.crowdFilter = lp;
      this.crowdSrc = ctx.createBufferSource();
      this.crowdSrc.buffer = buf;
      this.crowdSrc.loop = true;
      this.crowdSrc.connect(lp).connect(this.crowdGain).connect(this.master);
      this.crowdSrc.start();
    }
    if (!this.crowdGain || !this.crowdFilter) return;
    if (Math.abs(level - this.crowdLevel) < 0.01 && level > 0) return;
    this.crowdLevel = level;
    // far away it is a muffled rumble; up close it is loud and bright
    this.crowdGain.gain.setTargetAtTime(level * 0.55, ctx.currentTime, 0.25);
    this.crowdFilter.frequency.setTargetAtTime(500 + 2400 * level, ctx.currentTime, 0.25);
    if (level <= 0.001 && this.crowdSrc) {
      const src = this.crowdSrc;
      this.crowdSrc = null;
      this.crowdGain = null;
      this.crowdFilter = null;
      try {
        src.stop(ctx.currentTime + 0.5);
      } catch {
        // already stopped
      }
    }
  }

  /** The riot is coming (stage changes). */
  riot(): void {
    this.play('riot_siren', 0.32);
  }

  impact(pos: THREE.Vector3): void {
    this.play(Math.random() < 0.18 ? 'ricochet' : 'impact', 0.35, pos, 1, 7);
  }

  reload(pos: THREE.Vector3 | null): void {
    this.play('reload', pos ? 0.5 : 0.45, pos, 1, 6);
  }

  reloadDone(): void {
    this.play('reload_done', 0.4);
  }

  dryFire(): void {
    this.play('dry', 0.4);
  }

  swap(): void {
    this.play('swap', 0.35);
  }

  footstep(pos: THREE.Vector3 | null, sprint: boolean): void {
    // own steps are rate-limited by the caller; remote ones can bunch up, so guard here too
    const now = performance.now();
    if (!pos && now - this.lastStep < 120) return;
    if (!pos) this.lastStep = now;
    this.play(`step${Math.floor(Math.random() * 3)}`, (pos ? 0.5 : 0.13) * (sprint ? 1.25 : 1), pos, sprint ? 1.08 : 1, 6);
  }

  jump(): void {
    this.play('jump', 0.25);
  }

  land(speed: number): void {
    this.play('land', Math.min(0.6, 0.15 + speed * 0.04));
  }

  hitMarker(kind: 'hit' | 'head' | 'kill'): void {
    this.play(kind === 'kill' ? 'hit_kill' : kind === 'head' ? 'hit_head' : 'hit', kind === 'hit' ? 0.4 : 0.5);
  }

  hurt(amount: number): void {
    this.play('hurt', Math.min(0.8, 0.35 + amount / 120));
  }

  death(): void {
    this.play('death', 0.6);
  }

  respawn(): void {
    this.play('respawn', 0.4);
  }

  throwItem(pos: THREE.Vector3 | null): void {
    this.play('throw', 0.4, pos, 1, 6);
  }

  bounce(pos: THREE.Vector3): void {
    this.play('bounce', 0.5, pos, 1, 8);
  }

  explosion(pos: THREE.Vector3): void {
    this.play('explosion', 1.0, pos, 1, 30);
  }

  smoke(pos: THREE.Vector3): void {
    this.play('smoke', 0.6, pos, 1, 12);
  }

  zone(kind: 'captured' | 'lost' | 'neutral'): void {
    this.play(kind === 'lost' ? 'zone_bad' : 'zone_good', 0.4);
  }

  phase(kind: 'start' | 'win' | 'lose' | 'draw' | 'tick'): void {
    this.play(kind === 'tick' ? 'tick' : kind === 'start' ? 'start' : kind === 'win' ? 'win' : 'lose', kind === 'tick' ? 0.35 : 0.5);
  }

  /** Menu feedback. */
  ui(): void {
    this.play('ui', 0.25);
  }

  dispose(): void {
    this.unsub();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.jobs.length = 0;
    if (this.ambienceTimer) clearTimeout(this.ambienceTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
