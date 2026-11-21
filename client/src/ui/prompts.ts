import { bindings, keyName, padGlyph, type KeyAction, type PadAction } from '../input/bindings';
import type { DeviceKind } from '../input/types';

/** Things the player can do that have a button. */
export type Action =
  | 'move' | 'look' | 'fire' | 'aim' | 'reload' | 'jump' | 'crouch' | 'sprint'
  | 'swap' | 'prev' | 'weapons' | 'wheel' | 'throw' | 'shoulder' | 'scores' | 'pause' | 'accept' | 'back'
  // JUMP OFF THE PORCH
  | 'slots' | 'use' | 'heal' | 'drop';

interface Glyph {
  /** Text inside the glyph. */
  t: string;
  /** Extra class for shape / color. */
  c?: string;
}

type GlyphSet = Record<Action, Glyph>;

const KBM: GlyphSet = {
  move: { t: 'WASD' },
  look: { t: 'Mouse' },
  fire: { t: 'LMB' },
  aim: { t: 'RMB' },
  reload: { t: 'R' },
  jump: { t: 'Space' },
  crouch: { t: 'C' },
  sprint: { t: 'Shift' },
  swap: { t: '1 2 3' },
  prev: { t: 'Wheel' },
  weapons: { t: '1 2 3' },
  wheel: { t: 'B' },
  throw: { t: 'G' },
  shoulder: { t: 'Q' },
  scores: { t: 'Tab' },
  pause: { t: 'Esc' },
  accept: { t: 'Enter' },
  back: { t: 'Esc' },
  slots: { t: '1 2 3 4' },
  use: { t: 'E' },
  heal: { t: 'H' },
  drop: { t: 'X' },
};

const XBOX: GlyphSet = {
  move: { t: 'L', c: 'stick' },
  look: { t: 'R', c: 'stick' },
  fire: { t: 'RT', c: 'trig' },
  aim: { t: 'LB', c: 'bump' },
  reload: { t: 'X', c: 'face xb-x' },
  jump: { t: 'A', c: 'face xb-a' },
  crouch: { t: 'B', c: 'face xb-b' },
  sprint: { t: 'LS', c: 'stick' },
  swap: { t: 'RB', c: 'bump' },
  prev: { t: 'LT', c: 'trig' },
  weapons: { t: 'LT', c: 'trig' },
  wheel: { t: 'LT', c: 'trig' },
  throw: { t: 'Y', c: 'face xb-y' },
  shoulder: { t: 'RS', c: 'stick' },
  scores: { t: 'View', c: 'sys' },
  pause: { t: 'Menu', c: 'sys' },
  accept: { t: 'A', c: 'face xb-a' },
  back: { t: 'B', c: 'face xb-b' },
  slots: { t: 'RB', c: 'bump' },
  use: { t: '▼', c: 'sys' },
  heal: { t: '' },
  drop: { t: '' },
};

const PLAYSTATION: GlyphSet = {
  move: { t: 'L', c: 'stick' },
  look: { t: 'R', c: 'stick' },
  fire: { t: 'R2', c: 'trig' },
  aim: { t: 'L1', c: 'bump' },
  reload: { t: '□', c: 'face ps-square' },
  jump: { t: '✕', c: 'face ps-cross' },
  crouch: { t: '○', c: 'face ps-circle' },
  sprint: { t: 'L3', c: 'stick' },
  swap: { t: 'R1', c: 'bump' },
  prev: { t: 'L2', c: 'trig' },
  weapons: { t: 'L2', c: 'trig' },
  wheel: { t: 'L2', c: 'trig' },
  throw: { t: '△', c: 'face ps-triangle' },
  shoulder: { t: 'R3', c: 'stick' },
  scores: { t: 'Create', c: 'sys' },
  pause: { t: 'Options', c: 'sys' },
  accept: { t: '✕', c: 'face ps-cross' },
  back: { t: '○', c: 'face ps-circle' },
  slots: { t: 'R1', c: 'bump' },
  use: { t: '▼', c: 'sys' },
  heal: { t: '' },
  drop: { t: '' },
};

/** Unknown pads: positional names without platform colors. */
const GENERIC: GlyphSet = {
  ...XBOX,
  reload: { t: 'X', c: 'face' },
  jump: { t: 'A', c: 'face' },
  crouch: { t: 'B', c: 'face' },
  throw: { t: 'Y', c: 'face' },
  accept: { t: 'A', c: 'face' },
  back: { t: 'B', c: 'face' },
  scores: { t: 'Select', c: 'sys' },
  pause: { t: 'Start', c: 'sys' },
};

const SETS: Record<DeviceKind, GlyphSet | null> = {
  kbm: KBM,
  xbox: XBOX,
  playstation: PLAYSTATION,
  gamepad: GENERIC,
  touch: null,
};

export const ACTION_LABELS: Record<Action, string> = {
  move: 'Move',
  look: 'Look',
  fire: 'Fire',
  aim: 'Aim',
  reload: 'Reload',
  jump: 'Jump',
  crouch: 'Crouch',
  sprint: 'Sprint',
  swap: 'Next weapon',
  prev: 'Previous weapon',
  weapons: 'Weapons',
  wheel: 'Wheel (hold)',
  throw: 'Throw',
  shoulder: 'Swap shoulder',
  scores: 'Scores',
  pause: 'Menu',
  accept: 'Select',
  back: 'Back',
  slots: 'Weapons',
  use: 'Search / pick up',
  heal: 'Heal',
  drop: 'Drop',
};

/** Which binding an on-screen action reads its key / button from (Settings → Controls). */
const KEY_OF: Partial<Record<Action, KeyAction>> = {
  jump: 'jump', crouch: 'crouch', sprint: 'sprint', reload: 'reload', throw: 'throw', shoulder: 'shoulder',
  use: 'use', heal: 'heal', drop: 'drop', wheel: 'wheel', scores: 'scores',
};
const PAD_OF: Partial<Record<Action, PadAction>> = {
  fire: 'fire', aim: 'aim', jump: 'jump', crouch: 'crouch', sprint: 'sprint', reload: 'reload', swap: 'swap', slots: 'swap',
  prev: 'prev', wheel: 'prev', throw: 'throw', shoulder: 'shoulder', use: 'use', heal: 'heal', scores: 'scores',
};

/** The glyph for an action on a device, following the player's own bindings. */
function glyphOf(device: DeviceKind, action: Action): Glyph | null {
  const set = SETS[device];
  if (!set) return null;
  if (device === 'kbm') {
    const k = KEY_OF[action];
    return k ? { t: keyName(bindings.keys[k]) } : set[action];
  }
  const pa = PAD_OF[action];
  if (pa) return padGlyph(device, bindings.pad[pa]);
  return set[action];
}

/** HTML for the button glyph of an action on the given device ('' on touch). */
export function glyphHtml(device: DeviceKind, action: Action): string {
  // previous / next weapon: both buttons on a controller
  if ((action === 'weapons' || action === 'slots') && device !== 'kbm' && device !== 'touch') return glyphHtml(device, 'prev') + glyphHtml(device, 'swap');
  const g = glyphOf(device, action);
  if (!g) return '';
  const kind = device === 'kbm' ? 'key' : 'pad';
  return `<kbd class="glyph ${kind}${g.c ? ` ${g.c}` : ''}">${g.t}</kbd>`;
}

/** Plain text name of an action's key / button ('' on touch). */
export function glyphText(device: DeviceKind, action: Action): string {
  return glyphOf(device, action)?.t ?? '';
}

/** "glyph Label" pairs for a list of actions. */
export function legendHtml(device: DeviceKind, actions: readonly Action[]): string {
  if (!SETS[device]) return '';
  // actions without a button on this device are left out
  return actions.filter((a) => glyphOf(device, a)?.t).map((a) => `<span class="lg">${glyphHtml(device, a)}<span>${ACTION_LABELS[a]}</span></span>`).join('');
}

export const GAMEPLAY_LEGEND: readonly Action[] = ['fire', 'aim', 'reload', 'jump', 'crouch', 'sprint', 'weapons', 'wheel', 'throw', 'shoulder', 'scores', 'pause'];
/** JUMP OFF THE PORCH: inventory slots, searching, healing and dropping instead of the classic swap. */
export const PORCH_LEGEND: readonly Action[] = ['fire', 'aim', 'reload', 'jump', 'crouch', 'sprint', 'slots', 'wheel', 'use', 'heal', 'drop', 'throw', 'scores', 'pause'];
export const FULL_LEGEND: readonly Action[] = ['move', 'look', ...GAMEPLAY_LEGEND];

export function deviceName(device: DeviceKind): string {
  switch (device) {
    case 'xbox': return 'Xbox controller';
    case 'playstation': return 'PlayStation controller';
    case 'gamepad': return 'Controller';
    case 'touch': return 'Touch';
    default: return 'Keyboard + mouse';
  }
}
