import type { DeviceKind } from './types';

/**
 * Button assignments for keyboard and controllers, changeable in Settings → Controls and kept
 * in this browser. Movement (WASD / left stick), looking (mouse / right stick), the mouse
 * buttons, the number keys and the pause buttons stay fixed.
 */

/** Actions with a key (keyboard). */
export const KEY_ACTIONS = ['jump', 'crouch', 'crouchHold', 'sprint', 'reload', 'throw', 'shoulder', 'use', 'heal', 'drop', 'scores'] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

/** Actions with a button (controller). */
export const PAD_ACTIONS = ['fire', 'aim', 'jump', 'crouch', 'sprint', 'reload', 'swap', 'throw', 'shoulder', 'use', 'heal', 'scores'] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];

export const BINDING_LABELS: Record<KeyAction | PadAction, string> = {
  fire: 'Fire',
  aim: 'Aim',
  jump: 'Jump',
  crouch: 'Crouch (tap) · roll while sprinting',
  crouchHold: 'Crouch (hold)',
  sprint: 'Sprint',
  reload: 'Reload',
  swap: 'Next weapon',
  throw: 'Throw',
  shoulder: 'Swap shoulder',
  use: 'Use: doors, windows, search, pick up, talk',
  heal: 'Heal (hold)',
  drop: 'Drop weapon',
  scores: 'Scoreboard',
};

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  jump: 'Space',
  crouch: 'KeyC',
  crouchHold: 'ControlLeft',
  sprint: 'ShiftLeft',
  reload: 'KeyR',
  throw: 'KeyG',
  shoulder: 'KeyQ',
  use: 'KeyE',
  heal: 'KeyH',
  drop: 'KeyX',
  scores: 'Tab',
};

/** Standard Gamepad API button indices. */
export const PAD = {
  SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, TOUCHPAD: 17,
} as const;

export const DEFAULT_PAD: Record<PadAction, number> = {
  fire: PAD.R2,
  aim: PAD.L2,
  jump: PAD.SOUTH,
  crouch: PAD.EAST,
  sprint: PAD.L3,
  reload: PAD.WEST,
  swap: PAD.NORTH,
  throw: PAD.L1,
  shoulder: PAD.R1,
  // search and heal share the d-pad down by default (it picks up when there is something in
  // reach and heals otherwise); give heal its own button to split them
  use: PAD.DOWN,
  heal: PAD.DOWN,
  scores: PAD.SELECT,
};

/** Buttons a controller binding may not take (they always do the same thing). */
export const PAD_RESERVED: readonly number[] = [PAD.START, PAD.LEFT, PAD.RIGHT, PAD.UP];
/** Keys a keyboard binding may not take. */
export const KEY_RESERVED: readonly string[] = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Escape', 'KeyP', 'Enter',
];

const STORE_KEY = 'whoopa.bindings';

class BindingStore {
  keys: Record<KeyAction, string> = { ...DEFAULT_KEYS };
  /** True while Settings waits for a key / button (menus ignore controller presses meanwhile). */
  capturing = false;
  pad: Record<PadAction, number> = { ...DEFAULT_PAD };
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { keys?: Record<string, unknown>; pad?: Record<string, unknown> } | null;
      for (const a of KEY_ACTIONS) if (typeof raw?.keys?.[a] === 'string' && !KEY_RESERVED.includes(raw.keys[a] as string)) this.keys[a] = raw.keys[a] as string;
      for (const a of PAD_ACTIONS) {
        const v = raw?.pad?.[a];
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 20 && !PAD_RESERVED.includes(v)) this.pad[a] = v;
      }
    } catch {
      /* storage blocked or bad data: defaults */
    }
  }

  /** True while the keyboard layout is the default one (the extra F / V alternates stay on). */
  get defaultKeys(): boolean {
    return KEY_ACTIONS.every((a) => this.keys[a] === DEFAULT_KEYS[a]);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ keys: this.keys, pad: this.pad }));
    } catch {
      /* not saved: still applies until the tab closes */
    }
    for (const fn of this.listeners) fn();
  }

  /** Puts a key on an action. An action that had that key gets this action's old key (a swap). */
  setKey(action: KeyAction, code: string): boolean {
    if (KEY_RESERVED.includes(code)) return false;
    const old = this.keys[action];
    for (const a of KEY_ACTIONS) if (a !== action && this.keys[a] === code) this.keys[a] = old;
    this.keys[action] = code;
    this.save();
    return true;
  }

  /** Puts a button on an action (swapping like keys; use and heal may share a button). */
  setPad(action: PadAction, index: number): boolean {
    if (PAD_RESERVED.includes(index)) return false;
    const old = this.pad[action];
    const shareable = (a: PadAction) => (a === 'use' && action === 'heal') || (a === 'heal' && action === 'use');
    for (const a of PAD_ACTIONS) if (a !== action && this.pad[a] === index && !shareable(a)) this.pad[a] = old;
    this.pad[action] = index;
    this.save();
    return true;
  }

  reset(which: 'keys' | 'pad' | 'all' = 'all'): void {
    if (which !== 'pad') this.keys = { ...DEFAULT_KEYS };
    if (which !== 'keys') this.pad = { ...DEFAULT_PAD };
    this.save();
  }
}

export const bindings = new BindingStore();

// ------------------------------------------------------------------ names for the screen
const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'Alt', AltRight: 'R-Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Backspace: 'Bksp', MetaLeft: 'Cmd', MetaRight: 'Cmd',
};

/** "KeyH" → "H", "ShiftLeft" → "Shift", "Digit5" → "5". */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** A button's glyph text and style class per controller family. */
export function padGlyph(device: DeviceKind, index: number): { t: string; c: string } {
  const ps = device === 'playstation';
  const xb = device === 'xbox';
  switch (index) {
    case PAD.SOUTH: return ps ? { t: '✕', c: 'face ps-cross' } : { t: 'A', c: xb ? 'face xb-a' : 'face' };
    case PAD.EAST: return ps ? { t: '○', c: 'face ps-circle' } : { t: 'B', c: xb ? 'face xb-b' : 'face' };
    case PAD.WEST: return ps ? { t: '□', c: 'face ps-square' } : { t: 'X', c: xb ? 'face xb-x' : 'face' };
    case PAD.NORTH: return ps ? { t: '△', c: 'face ps-triangle' } : { t: 'Y', c: xb ? 'face xb-y' : 'face' };
    case PAD.L1: return { t: ps ? 'L1' : 'LB', c: 'bump' };
    case PAD.R1: return { t: ps ? 'R1' : 'RB', c: 'bump' };
    case PAD.L2: return { t: ps ? 'L2' : 'LT', c: 'trig' };
    case PAD.R2: return { t: ps ? 'R2' : 'RT', c: 'trig' };
    case PAD.SELECT: return { t: ps ? 'Create' : xb ? 'View' : 'Select', c: 'sys' };
    case PAD.START: return { t: ps ? 'Options' : xb ? 'Menu' : 'Start', c: 'sys' };
    case PAD.L3: return { t: ps ? 'L3' : 'LS', c: 'stick' };
    case PAD.R3: return { t: ps ? 'R3' : 'RS', c: 'stick' };
    case PAD.UP: return { t: '▲', c: 'sys' };
    case PAD.DOWN: return { t: '▼', c: 'sys' };
    case PAD.LEFT: return { t: '◀', c: 'sys' };
    case PAD.RIGHT: return { t: '▶', c: 'sys' };
    case PAD.TOUCHPAD: return { t: 'Pad', c: 'sys' };
    default: return { t: `B${index}`, c: 'sys' };
  }
}
