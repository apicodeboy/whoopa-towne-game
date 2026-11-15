import {
  PRIMARY_IDS, SECONDARY_IDS, THROWABLES, THROWABLE_IDS, WEAPONS,
  type Loadout, type ThrowableId, type WeaponDef, type WeaponId,
} from '@shared/config/weapons';
import type { Profile } from '../core/profile';
import { button, el } from './dom';

const ICONS: Record<string, string> = {
  smg: '<svg viewBox="0 0 96 40"><path d="M4 12h60v6h20v4H64v4H48v12h-8V26H28l-6 12h-8l4-12H4z"/></svg>',
  ar: '<svg viewBox="0 0 96 40"><path d="M2 14h16l4-4h40v4h28v4H62v6H50l-2 14h-8l2-14H26l-6 10h-8l4-10H2z"/></svg>',
  shotgun: '<svg viewBox="0 0 96 40"><path d="M2 16h20l4-4h66v4H52v4h40v4H48v4H26l-4 8H12l2-8H2z"/></svg>',
  pistol: '<svg viewBox="0 0 96 40"><path d="M24 8h48v10H48l-2 6h-8l-4 14H24l4-16h-4z"/></svg>',
  grenade: '<svg viewBox="0 0 96 40"><circle cx="48" cy="24" r="13"/><path d="M42 4h14v8H42z"/><path d="M56 6h12v4H56z"/></svg>',
  smoke: '<svg viewBox="0 0 96 40"><rect x="38" y="10" width="20" height="28" rx="3"/><path d="M42 3h12v7H42z"/><path d="M58 12h10v4H58z"/></svg>',
};

function stat(label: string, value: number): string {
  const pct = Math.round(Math.max(0.04, Math.min(1, value)) * 100);
  return `<div class="stat"><span>${label}</span><div class="sbar"><i style="width:${pct}%"></i></div></div>`;
}

function weaponStats(w: WeaponDef): string {
  const perShot = w.damage * w.pellets;
  return (
    stat('DAMAGE', perShot / 120) +
    stat('FIRE RATE', w.rpm / 900) +
    stat('RANGE', w.falloffEnd / 70) +
    stat('ACCURACY', 1 - w.spreadAim / 4) +
    stat('CONTROL', 1 - w.recoilPitch / 3)
  );
}

/**
 * Pick a primary, a secondary and a throwable. No XP or unlocks: everything is available.
 * The choice is saved locally and sent to the server (it applies on your next spawn).
 */
export class LoadoutScreen {
  readonly root: HTMLElement;
  private cards = new Map<string, HTMLButtonElement>();
  private note: HTMLElement;
  private profile: Profile;
  private onChange: (loadout: Loadout) => void;

  constructor(parent: HTMLElement, profile: Profile, onChange: (loadout: Loadout) => void, onClose: () => void) {
    this.profile = profile;
    this.onChange = onChange;

    const section = (title: string, ids: readonly string[], slot: keyof Loadout): HTMLElement => {
      const grid = el('div', `cards n${ids.length}`);
      for (const id of ids) {
        const isGun = id in WEAPONS;
        const name = isGun ? WEAPONS[id as WeaponId].name : THROWABLES[id as ThrowableId].name;
        const blurb = isGun ? WEAPONS[id as WeaponId].blurb : THROWABLES[id as ThrowableId].blurb;
        const card = button('', 'card', () => this.pick(slot, id));
        card.innerHTML =
          `<div class="cicon">${ICONS[id] ?? ''}</div><div class="cname">${name}</div><div class="cblurb">${blurb}</div>` +
          (isGun ? `<div class="stats">${weaponStats(WEAPONS[id as WeaponId])}</div>` : '');
        this.cards.set(`${slot}:${id}`, card);
        grid.append(card);
      }
      return el('div', 'lo-section', [el('div', 'lbl', title), grid]);
    };

    this.note = el('div', 'lo-note', 'Saved on this device. Changes apply the next time you spawn.');
    const done = button('DONE', 'btn primary', onClose);
    done.dataset.back = '1';
    const panel = el('div', 'overlay-panel loadout', [
      el('div', 'panel-title', 'LOADOUT'),
      section('PRIMARY', PRIMARY_IDS, 'primary'),
      el('div', 'lo-two', [section('SECONDARY', SECONDARY_IDS, 'secondary'), section('THROWABLE', THROWABLE_IDS, 'throwable')]),
      this.note,
      el('div', 'row center', [done]),
    ]);
    this.root = el('div', 'screen overlay hidden', [panel]);
    parent.append(this.root);
    this.refresh();
  }

  private pick(slot: keyof Loadout, id: string): void {
    const next = { ...this.profile.loadout, [slot]: id } as Loadout;
    this.profile.setLoadout(next);
    this.refresh();
    this.onChange(this.profile.loadout);
  }

  private refresh(): void {
    const l = this.profile.loadout;
    for (const [key, card] of this.cards) {
      const [slot, id] = key.split(':');
      card.classList.toggle('on', l[slot as keyof Loadout] === id);
    }
  }

  show(v: boolean): void {
    if (v) this.refresh();
    this.root.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
