import { DEFAULT_SETTINGS, type GraphicsQuality, type Settings, type SettingsStore } from '../core/settings';
import {
  BINDING_LABELS, KEY_ACTIONS, KEY_RESERVED, PAD_ACTIONS, PAD_RESERVED, bindings, keyName, padGlyph,
  type KeyAction, type PadAction,
} from '../input/bindings';
import { button, clear, el } from './dom';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** Settings menu: sensitivity, invert Y, FOV, graphics quality, volume, controller and touch options. */
export class SettingsScreen {
  readonly root: HTMLElement;
  private store: SettingsStore;
  private refreshers: Array<() => void> = [];
  /** Which controller family to draw button names for (set by the app). */
  padKind: 'xbox' | 'playstation' | 'gamepad' = 'xbox';

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

    // ---- controls: press a key / button to put it on an action ----
    const controls = (): HTMLElement => {
      const box = el('div', 'binds');
      const status = el('p', 'bind-status', 'Click an action, then press the key or button you want for it.');
      const tabs = el('div', 'segmented small');
      let mode: 'keys' | 'pad' = 'keys';
      const list = el('div', 'bind-list');
      const tabBtn = (m: 'keys' | 'pad', label: string) => {
        const b = button(label, 'seg', () => {
          mode = m;
          render();
        });
        b.dataset.mode = m;
        return b;
      };
      tabs.append(tabBtn('keys', 'KEYBOARD'), tabBtn('pad', 'CONTROLLER'));
      const reset = button('RESET CONTROLS', 'btn ghost small', () => {
        bindings.reset(mode);
        status.textContent = mode === 'keys' ? 'Keyboard back to the default keys.' : 'Controller back to the default buttons.';
        render();
      });
      const render = () => {
        for (const b of tabs.querySelectorAll<HTMLElement>('.seg')) b.classList.toggle('on', b.dataset.mode === mode);
        clear(list);
        const actions = (mode === 'keys' ? KEY_ACTIONS : PAD_ACTIONS) as readonly (KeyAction | PadAction)[];
        for (const a of actions) {
          const cur = el('button', 'bind-key');
          if (mode === 'keys') {
            cur.innerHTML = `<kbd class="glyph key">${keyName(bindings.keys[a as KeyAction])}</kbd>`;
          } else {
            const g = padGlyph(this.padKind, bindings.pad[a as PadAction]);
            cur.innerHTML = `<kbd class="glyph pad ${g.c}">${g.t}</kbd>`;
          }
          cur.addEventListener('click', () => void capture(a, cur));
          list.append(el('div', 'srow bind-row', [el('span', 'slabel', BINDING_LABELS[a]), cur]));
        }
      };
      const capture = async (action: KeyAction | PadAction, btnEl: HTMLElement): Promise<void> => {
        if (bindings.capturing) return;
        bindings.capturing = true;
        btnEl.classList.add('listening');
        btnEl.innerHTML = mode === 'keys' ? '<span>Press a key…</span>' : '<span>Press a button…</span>';
        status.textContent = 'Esc to cancel.';
        const result = mode === 'keys' ? await captureKey() : await captureButton();
        if (result === null) status.textContent = 'Nothing changed.';
        else if (mode === 'keys') {
          const ok = bindings.setKey(action as KeyAction, result as string);
          status.textContent = ok ? `${BINDING_LABELS[action]}: ${keyName(result as string)}` : `${keyName(result as string)} can't be changed (movement, numbers, menu).`;
        } else {
          const ok = bindings.setPad(action as PadAction, result as number);
          status.textContent = ok ? `${BINDING_LABELS[action]}: ${padGlyph(this.padKind, result as number).t}` : 'That button stays on weapon slots / the menu.';
        }
        render();
        // let go of the button before menus react to it again
        setTimeout(() => (bindings.capturing = false), 350);
      };
      const captureKey = () => new Promise<string | null>((resolve) => {
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.removeEventListener('keydown', onKey, true);
          resolve(e.code === 'Escape' ? null : e.code);
        };
        window.addEventListener('keydown', onKey, true);
      });
      const captureButton = () => new Promise<number | null>((resolve) => {
        const held = new Set<number>();
        const read = () => [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected) ?? null;
        const first = read();
        first?.buttons.forEach((b, i) => b.pressed && held.add(i));
        const t0 = performance.now();
        const onKey = (e: KeyboardEvent) => {
          if (e.code !== 'Escape') return;
          e.preventDefault();
          e.stopImmediatePropagation();
          done(null);
        };
        let raf = 0;
        const done = (v: number | null) => {
          cancelAnimationFrame(raf);
          window.removeEventListener('keydown', onKey, true);
          resolve(v);
        };
        window.addEventListener('keydown', onKey, true);
        const tick = () => {
          const pad = read();
          if (!pad) status.textContent = 'Connect a controller and press a button (Esc to cancel).';
          const buttons = pad?.buttons ?? [];
          for (let i = 0; i < buttons.length; i++) {
            const down = buttons[i].pressed || buttons[i].value > 0.5;
            if (!down) held.delete(i);
            else if (!held.has(i) && i !== 16) return done(i); // (16 = the PS / Xbox button)
          }
          if (performance.now() - t0 > 8000) return done(null);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
      bindings.onChange(render);
      this.refreshers.push(render);
      void KEY_RESERVED;
      void PAD_RESERVED;
      box.append(el('div', 'srow', [el('span', 'slabel', 'Buttons'), tabs]), list, el('div', 'row bind-foot', [status, reset]));
      return box;
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
      group('CONTROLS', [controls()]),
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
