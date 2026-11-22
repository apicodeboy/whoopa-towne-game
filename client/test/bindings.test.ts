import { assert, test } from '../../shared/test/harness';
import { BindingStore, KEY_ACTIONS, PAD, PAD_ACTIONS } from '../src/input/bindings';

/** Buttons / keys on more than one action (reload + use on one button is allowed). */
function clashes(b: BindingStore): string[] {
  const out: string[] = [];
  const pads = new Map<number, string[]>();
  for (const a of PAD_ACTIONS) pads.set(b.pad[a], [...(pads.get(b.pad[a]) ?? []), a]);
  for (const [btn, as] of pads) {
    const rest = as.filter((a) => !(as.includes('reload') && as.includes('use') && (a === 'reload' || a === 'use')));
    if (as.length > 1 && !(as.length === 2 && rest.length === 0)) out.push(`button ${btn}: ${as.join(', ')}`);
  }
  const keys = new Map<string, string[]>();
  for (const a of KEY_ACTIONS) keys.set(b.keys[a], [...(keys.get(b.keys[a]) ?? []), a]);
  for (const [k, as] of keys) if (as.length > 1) out.push(`key ${k}: ${as.join(', ')}`);
  return out;
}

test('bindings: one key or button per action (the multipurpose square stays one button)', () => {
  const store: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k],
  };
  const b = new BindingStore();
  assert(clashes(b).length === 0, `defaults: ${clashes(b).join('; ')}`);
  assert(b.padLinked && b.pad.reload === PAD.WEST, 'square does reload + use');
  // moving the multipurpose button onto triangle: both move, throw gets square, nothing doubled
  b.setPad('reload', PAD.NORTH);
  const pad = (): Record<string, number> => b.pad;
  assert(pad().reload === PAD.NORTH && pad().use === PAD.NORTH && pad().throw === PAD.WEST, `linked move (${JSON.stringify(b.pad)})`);
  assert(clashes(b).length === 0, `after moving square: ${clashes(b).join('; ')}`);
  // a plain swap
  b.setPad('jump', PAD.R2);
  assert(b.pad.jump === PAD.R2 && b.pad.fire === PAD.SOUTH && clashes(b).length === 0, 'jump onto fire swaps them');
  b.setKey('jump', 'KeyR');
  assert(b.keys.jump === 'KeyR' && b.keys.reload === 'Space' && clashes(b).length === 0, 'keys swap too');
  // a saved layout with buttons and keys on two actions is put right when it loads
  store['whoopa.bindings'] = JSON.stringify({ v: 3, keys: { jump: 'KeyE', use: 'KeyE' }, pad: { jump: PAD.SOUTH, crouch: PAD.SOUTH, heal: PAD.WEST } });
  const c = new BindingStore();
  assert(clashes(c).length === 0, `repaired on load: ${clashes(c).join('; ')}`);
});
