/** Player settings, persisted to localStorage. */

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Mouse look sensitivity multiplier. */
  mouseSens: number;
  /** Controller right-stick sensitivity multiplier. */
  stickSens: number;
  /** Touch look sensitivity multiplier. */
  touchSens: number;
  /** Extra sensitivity multiplier while aiming down sights. */
  aimSensMult: number;
  invertY: boolean;
  /** Horizontal field of view in degrees (measured at 16:9). */
  fov: number;
  quality: GraphicsQuality;
  /** Low-end phone mode: caps resolution, kills shadows and most particles. */
  performanceMode: boolean;
  /** Lower the render resolution automatically when the frame rate drops under the target. */
  dynamicRes: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** Ambient city bed volume 0..1 (multiplied by master). */
  ambience: number;
  /** Controller / touch aim assist (slows the reticle near enemies). */
  aimAssist: boolean;
  /** Stick deadzones 0..0.5. */
  deadzoneLeft: number;
  deadzoneRight: number;
  /** Crouch key toggles instead of hold. */
  crouchToggle: boolean;
  /** Which shoulder the camera starts over. */
  rightShoulder: boolean;
  showFps: boolean;
  /** Controller vibration on hits. */
  vibration: boolean;
  /** The minimap turns with you (your view always points up) instead of keeping north up. */
  minimapRotate: boolean;
  /** Bloom, color grading and the rest of the finishing passes (Medium and High quality). */
  postFx: boolean;
  /** Screen-space ambient occlusion (High quality only; it costs a second pass over the scene). */
  ambientOcclusion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSens: 1,
  stickSens: 1,
  touchSens: 1,
  aimSensMult: 0.7,
  invertY: false,
  fov: 95,
  quality: 'high',
  performanceMode: false,
  dynamicRes: true,
  volume: 0.8,
  ambience: 0.6,
  aimAssist: true,
  deadzoneLeft: 0.15,
  deadzoneRight: 0.12,
  crouchToggle: true,
  rightShoulder: true,
  showFps: false,
  vibration: true,
  minimapRotate: false,
  postFx: true,
  ambientOcclusion: false,
};

const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  mouseSens: [0.1, 4],
  stickSens: [0.1, 4],
  touchSens: [0.1, 4],
  aimSensMult: [0.2, 1.5],
  fov: [70, 110],
  volume: [0, 1],
  ambience: [0, 1],
  deadzoneLeft: [0, 0.5],
  deadzoneRight: [0, 0.5],
};

const STORAGE_KEY = 'whoopa.settings.v1';

type Listener = (settings: Settings, changed: keyof Settings | null) => void;

export function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse && (navigator.maxTouchPoints ?? 0) > 0;
}

export class SettingsStore {
  readonly values: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.values = { ...DEFAULT_SETTINGS };
    let hadSaved = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        hadSaved = true;
        const saved = JSON.parse(raw) as Partial<Settings>;
        for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
          if (key in saved) this.assign(key, saved[key] as never);
        }
      }
    } catch {
      /* corrupted or unavailable storage: fall back to defaults */
    }
    if (!hadSaved && isLikelyMobile()) {
      // sensible first-run defaults for phones
      this.values.quality = 'low';
      this.values.performanceMode = true;
    }
  }

  private assign<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === 'number') {
      let n = Number(value);
      if (!Number.isFinite(n)) return;
      const range = RANGES[key];
      if (range) n = Math.min(range[1], Math.max(range[0], n));
      (this.values[key] as number) = n;
    } else if (typeof def === 'boolean') {
      (this.values[key] as boolean) = !!value;
    } else if (key === 'quality') {
      if (value === 'low' || value === 'medium' || value === 'high') this.values.quality = value;
    }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const before = this.values[key];
    this.assign(key, value);
    if (this.values[key] === before) return;
    this.save();
    for (const l of this.listeners) l(this.values, key);
  }

  reset(): void {
    Object.assign(this.values, DEFAULT_SETTINGS);
    this.save();
    for (const l of this.listeners) l(this.values, null);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
  }
}
