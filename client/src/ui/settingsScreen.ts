import { DEFAULT_SETTINGS, type GraphicsQuality, type Settings, type SettingsStore } from '../core/settings';
import { button, el } from './dom';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** Settings menu: sensitivity, invert Y, FOV, graphics quality, volume, controller and touch options. */
export class SettingsScreen {
  readonly root: HTMLElement;
  private store: SettingsStore;
  private refreshers: Array<() => void> = [];

  constructor(parent: HTMLElement, store: SettingsStore, onClose: () => void) {
    this.store = store;

    const slider = (label: string, key: NumKey, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement => {
      const input = el('input', 'slider');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.setAttribute('aria-label', label);
      const out = el('span', 'sval', '');
      const refresh = () => {
        input.value = String(store.values[key]);
        out.textContent = fmt(store.values[key]);
      };
      input.addEventListener('input', () => {
        store.set(key, Number(input.value));
        out.textContent = fmt(store.values[key]);
      });
      this.refreshers.push(refresh);
      return el('div', 'srow', [el('span', 'slabel', label), input, out]);
    };

    const toggle = (label: string, key: BoolKey, hint = ''): HTMLElement => {
      const b = button('', 'toggle', () => {
        store.set(key, !store.values[key]);
        refresh();
      });
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-label', label);
      const refresh = () => {
        const on = store.values[key];
        b.classList.toggle('on', on);
        b.textContent = on ? 'ON' : 'OFF';
        b.setAttribute('aria-checked', String(on));
      };
      this.refreshers.push(refresh);
      const lab = el('span', 'slabel', label);
      if (hint) lab.append(el('small', '', hint));
      return el('div', 'srow', [lab, b]);
    };

    const quality = (): HTMLElement => {
      const seg = el('div', 'segmented small');
      const buttons = new Map<GraphicsQuality, HTMLButtonElement>();
      for (const q of ['low', 'medium', 'high'] as GraphicsQuality[]) {
        const b = button(q.toUpperCase(), 'seg', () => {
          store.set('quality', q);
          refresh();
        });
        buttons.set(q, b);
        seg.append(b);
      }
      const refresh = () => {
        for (const [q, b] of buttons) b.classList.toggle('on', q === store.values.quality);
      };
      this.refreshers.push(refresh);
      return el('div', 'srow', [el('span', 'slabel', 'Graphics quality'), seg]);
    };

    const x = (v: number) => `${v.toFixed(2)}x`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const group = (title: string, rows: HTMLElement[]) => el('div', 'sgroup', [el('div', 'lbl', title), ...rows]);

    const body = el('div', 'settings-body', [
      group('AIM', [
        slider('Mouse sensitivity', 'mouseSens', 0.1, 4, 0.05, x),
        slider('Aiming sensitivity', 'aimSensMult', 0.2, 1.5, 0.05, x),
        toggle('Invert Y axis', 'invertY'),
        toggle('Crouch toggles', 'crouchToggle', 'off = hold to crouch'),
        toggle('Camera over right shoulder', 'rightShoulder', 'swap in game any time'),
      ]),
      group('CONTROLLER', [
        slider('Stick sensitivity', 'stickSens', 0.1, 4, 0.05, x),
        slider('Left stick deadzone', 'deadzoneLeft', 0, 0.5, 0.01, pct),
        slider('Right stick deadzone', 'deadzoneRight', 0, 0.5, 0.01, pct),
        toggle('Aim assist', 'aimAssist', 'slows the reticle near enemies'),
        toggle('Vibration', 'vibration'),
      ]),
      group('TOUCH', [
        slider('Touch look sensitivity', 'touchSens', 0.1, 4, 0.05, x),
        toggle('Auto-fire', 'autoFire', 'shoots when the reticle is on an enemy'),
      ]),
      group('VIDEO', [
        slider('Field of view', 'fov', 70, 110, 1, (v) => `${Math.round(v)}°`),
        quality(),
        toggle('Performance mode', 'performanceMode', 'for low-end phones: lower resolution, no shadows'),
        toggle('Dynamic resolution', 'dynamicRes', 'drops resolution a little when needed to hold the frame rate'),
        toggle('Show FPS and ping', 'showFps'),
      ]),
      group('AUDIO', [
        slider('Master volume', 'volume', 0, 1, 0.01, pct),
        slider('City ambience', 'ambience', 0, 1, 0.01, pct),
      ]),
    ]);

    const done = button('DONE', 'btn primary', onClose);
    done.dataset.back = '1';
    const panel = el('div', 'overlay-panel settings', [
      el('div', 'panel-title', 'SETTINGS'),
      body,
      el('div', 'row center', [
        button('RESET TO DEFAULTS', 'btn ghost', () => {
          store.reset();
          this.refresh();
        }),
        done,
      ]),
    ]);
    this.root = el('div', 'screen overlay hidden', [panel]);
    parent.append(this.root);
    this.refresh();
    void DEFAULT_SETTINGS;
  }

  refresh(): void {
    for (const r of this.refreshers) r();
  }

  show(v: boolean): void {
    if (v) this.refresh();
    this.root.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
