/**
 * The weapon and gadget wheel: hold L2 (B on the keyboard), point at a slot with the right stick
 * (or the mouse), let go to pick it. The top of the ring is the guns, the bottom the gadgets
 * (throwables, healing items, Perc 29); the two halves are fenced off by a gap.
 */
import { FIST_SHAPES } from './handIcon';

/** One slot on the ring. */
export interface WheelItem {
  /** What it is ("Kingpin AR"). */
  label: string;
  /** Short line under it ("30 / 90", "×3"). */
  count: string;
  /** What picking it does, shown in the middle ("+25 armor"). */
  detail: string;
  /** Picture: an image URL (guns) or one of the drawn icons below. */
  img?: string;
  icon?: 'bandage' | 'medkit' | 'drink' | 'ibuprofen' | 'fists';
  /** Can be picked right now. */
  ok: boolean;
  /** In hand now. */
  active: boolean;
}

/** Segments clockwise from the top; which ones are guns (the rest are gadgets). */
export const WHEEL_SEGMENTS = 8;
export const WHEEL_WEAPONS: readonly number[] = [7, 0, 1];

const R_OUT = 186, R_IN = 82, GAP = 0.035;
/** Extra gap where the guns meet the gadgets (the fence between the two halves). */
const FENCE = 0.075;

const ICONS: Record<NonNullable<WheelItem['icon']>, string> = {
  bandage: '<rect x="-20" y="-9" width="40" height="18" rx="9" fill="#efe6d2"/><rect x="-7" y="-9" width="14" height="18" fill="#d9cdb3"/><g fill="#b9ab90"><circle cx="-3" cy="-3" r="1.4"/><circle cx="3" cy="-3" r="1.4"/><circle cx="-3" cy="3" r="1.4"/><circle cx="3" cy="3" r="1.4"/></g>',
  medkit: '<rect x="-19" y="-14" width="38" height="28" rx="5" fill="#e03a3a"/><rect x="-8" y="-20" width="16" height="7" rx="2" fill="none" stroke="#e03a3a" stroke-width="3"/><path d="M-3 -9h6v6h6v6h-6v6h-6v-6h-6v-6h6z" fill="#fff"/>',
  // an orange (the item's wire id is still 'drink')
  drink: '<circle cy="3" r="16" fill="#f5891f" stroke="#16171a" stroke-width="2.2"/><circle cx="-6" cy="-3" r="4" fill="#ffc27d" opacity=".75"/><path d="M0 -13v-4" stroke="#5a3a1a" stroke-width="2.4"/><path d="M1 -15c2-5 7-7 12-6-2 5-7 7-12 6z" fill="#4c9a3a" stroke="#16171a" stroke-width="1.6"/>',
  // Perc 29: an orange pill bottle, 29 on the label (wire id 'ibuprofen')
  ibuprofen: '<rect x="-11" y="-14" width="22" height="32" rx="4" fill="#f08a1c"/><rect x="-11" y="-2" width="22" height="13" fill="#fff"/><rect x="-13" y="-22" width="26" height="9" rx="2.5" fill="#fff"/><text y="8.5" text-anchor="middle" font-size="10" font-weight="900" font-family="sans-serif" fill="#c2410c">29</text>',
  fists: `<g transform="translate(-20 -20) scale(0.625)">${FIST_SHAPES}</g>`,
};

function arc(a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(R_OUT, a0)} A${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, a1)} L${p(R_IN, a1)} A${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, a0)}Z`;
}

/** Center angle of a segment (screen space, y down; segment 0 at the top). */
function angleOf(i: number): number {
  return -Math.PI / 2 + (i * Math.PI * 2) / WHEEL_SEGMENTS;
}

/** The segment a pointer (x right, y down) is over, or -1 near the middle. */
export function segmentAt(x: number, y: number): number {
  if (Math.hypot(x, y) < 0.35) return -1;
  const a = Math.atan2(y, x) + Math.PI / 2;
  return ((Math.round(a / ((Math.PI * 2) / WHEEL_SEGMENTS)) % WHEEL_SEGMENTS) + WHEEL_SEGMENTS) % WHEEL_SEGMENTS;
}

export class WeaponWheel {
  readonly root: HTMLElement;
  private segs: SVGGElement[] = [];
  private centerName: HTMLElement;
  private centerDetail: HTMLElement;
  private hint: HTMLElement;
  private dot: HTMLElement;
  private lastKey = '';
  private open = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'wwheel hidden';
    const step = (Math.PI * 2) / WHEEL_SEGMENTS;
    let paths = '';
    for (let i = 0; i < WHEEL_SEGMENTS; i++) {
      const c = angleOf(i);
      // the fence: a wider gap on the sides of a segment that border the other half
      const prevOther = WHEEL_WEAPONS.includes(i) !== WHEEL_WEAPONS.includes((i + WHEEL_SEGMENTS - 1) % WHEEL_SEGMENTS);
      const nextOther = WHEEL_WEAPONS.includes(i) !== WHEEL_WEAPONS.includes((i + 1) % WHEEL_SEGMENTS);
      const a0 = c - step / 2 + (prevOther ? FENCE : GAP), a1 = c + step / 2 - (nextOther ? FENCE : GAP);
      const ix = Math.cos(c) * (R_IN + R_OUT) / 2, iy = Math.sin(c) * (R_IN + R_OUT) / 2;
      paths += `<g class="seg" data-i="${i}" data-kind="${WHEEL_WEAPONS.includes(i) ? 'gun' : 'gadget'}">`
        + `<path d="${arc(a0, a1)}"/>`
        + `<g class="pic" transform="translate(${ix.toFixed(1)} ${(iy - 12).toFixed(1)})"></g>`
        + `<text class="lbl" x="${ix.toFixed(1)}" y="${(iy + 30).toFixed(1)}"></text>`
        + `<text class="cnt" x="${ix.toFixed(1)}" y="${(iy + 47).toFixed(1)}"></text></g>`;
    }
    // fence posts where the two halves meet
    let posts = '';
    for (let i = 0; i < WHEEL_SEGMENTS; i++) {
      const j = (i + 1) % WHEEL_SEGMENTS;
      if (WHEEL_WEAPONS.includes(i) === WHEEL_WEAPONS.includes(j)) continue;
      const a = angleOf(i) + step / 2, c = Math.cos(a), sn = Math.sin(a);
      posts += `<line class="fence" x1="${(c * (R_IN - 10)).toFixed(1)}" y1="${(sn * (R_IN - 10)).toFixed(1)}" x2="${(c * (R_OUT + 14)).toFixed(1)}" y2="${(sn * (R_OUT + 14)).toFixed(1)}"/>`;
    }
    this.root.innerHTML = `
      <div class="ww-sec top">WEAPONS</div>
      <svg viewBox="-215 -215 430 430" class="ww-ring">${paths}${posts}</svg>
      <div class="ww-sec bottom">GADGETS</div>
      <div class="ww-center"><b></b><span></span><i></i></div>
      <div class="ww-dot"></div>`;
    parent.appendChild(this.root);
    this.segs = Array.from(this.root.querySelectorAll<SVGGElement>('g.seg'));
    this.centerName = this.root.querySelector('.ww-center b')!;
    this.centerDetail = this.root.querySelector('.ww-center span')!;
    this.hint = this.root.querySelector('.ww-center i')!;
    this.dot = this.root.querySelector('.ww-dot')!;
  }

  /**
   * Shows the wheel with its slots (index = segment, clockwise from the top; null = nothing
   * there) and where the pointer is. Returns the segment pointed at (-1 = none).
   */
  update(open: boolean, items: ReadonlyArray<WheelItem | null>, aim: { x: number; y: number }, hintHtml: string): number {
    if (open !== this.open) {
      this.open = open;
      this.root.classList.toggle('hidden', !open);
    }
    if (!open) return -1;
    const key = items.map((it) => (it ? `${it.label}|${it.count}|${it.ok ? 1 : 0}|${it.active ? 1 : 0}|${it.img ?? it.icon ?? ''}` : '-')).join(';');
    if (key !== this.lastKey) {
      this.lastKey = key;
      items.forEach((it, i) => {
        const g = this.segs[i];
        if (!g) return;
        g.classList.toggle('empty', !it || !it.ok);
        g.classList.toggle('active', !!it?.active);
        const pic = g.querySelector('.pic')!;
        pic.innerHTML = !it ? '' : it.img ? `<image href="${it.img}" x="-34" y="-17" width="68" height="34"/>` : it.icon ? ICONS[it.icon] : '';
        g.querySelector('.lbl')!.textContent = it ? it.label : '';
        g.querySelector('.cnt')!.textContent = it ? it.count : '';
      });
    }
    const hover = segmentAt(aim.x, aim.y);
    this.segs.forEach((g, i) => g.classList.toggle('hover', i === hover));
    const it = hover >= 0 ? items[hover] : null;
    this.centerName.textContent = it ? it.label : hover >= 0 ? 'EMPTY' : '';
    this.centerDetail.textContent = it ? (it.ok ? it.detail : it.detail || 'Nothing to use') : '';
    this.hint.innerHTML = hintHtml;
    this.dot.style.transform = `translate(${(aim.x * 150).toFixed(1)}px, ${(aim.y * 150).toFixed(1)}px)`;
    return hover;
  }

  dispose(): void {
    this.root.remove();
  }
}
