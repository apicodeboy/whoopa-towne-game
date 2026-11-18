import { optionsOf } from '@shared/config/appearance';
import { RARITY_COLORS, formatGrams, type StoreItem } from '@shared/config/economy';

let coinIds = 0;

/** The GRAMS mark: a gold coin with a G. */
export function gIcon(size = 18, cls = 'g-ico'): string {
  // every coin gets its own gradient id (a shared id breaks once the first coin is hidden)
  const id = `gg${++coinIds}`;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7a1"/><stop offset=".5" stop-color="#f6b73c"/><stop offset="1" stop-color="#b9781a"/></linearGradient></defs>
<circle cx="12" cy="12" r="11" fill="url(#${id})" stroke="#6b4310" stroke-width="1.2"/>
<circle cx="12" cy="12" r="8.4" fill="none" stroke="#fff3c4" stroke-opacity=".55" stroke-width=".9"/>
<path d="M15.9 9.1a4.6 4.6 0 1 0 .5 4.6H12.4" fill="none" stroke="#5a3608" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** "3.5" with the coin in front. */
export function gramsHtml(units: number, size = 16): string {
  return `<span class="g-amt">${gIcon(size)}<b>${formatGrams(units)}</b></span>`;
}

const PATTERNS: Record<string, string> = {
  camo: `<pattern id="p-camo" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#5b6b3a"/><path d="M2 4c4-3 8 1 6 5s-8 2-6-5zM14 2c5 0 8 4 5 7s-8-3-5-7zM10 14c5-2 9 2 6 6s-9 0-6-6zM0 16c3 0 5 4 2 6s-4-4-2-6z" fill="#3b4524"/><path d="M8 10c2-1 4 1 3 3s-4 0-3-3zM18 12c2 0 3 2 1 3s-3-2-1-3z" fill="#8a7a4a"/></pattern>`,
  tiedye: `<pattern id="p-tiedye" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#d45cc4"/><circle cx="20" cy="20" r="16" fill="#4fc3f7"/><circle cx="20" cy="20" r="11" fill="#ffe14d"/><circle cx="20" cy="20" r="6" fill="#7dff6b"/></pattern>`,
  flames: `<pattern id="p-flames" width="30" height="40" patternUnits="userSpaceOnUse"><rect width="30" height="40" fill="#1e1e22"/><path d="M0 40c4-10 2-16 8-22 0 8 6 8 6 16 3-6 2-10 7-16 2 8 6 12 9 22z" fill="#ff7a1a"/><path d="M5 40c3-6 2-9 5-12 1 5 4 6 4 12z" fill="#ffd23f"/></pattern>`,
  galaxy: `<pattern id="p-galaxy" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="#2b1f5e"/><circle cx="6" cy="8" r="6" fill="#7a3fd1" opacity=".7"/><circle cx="22" cy="20" r="8" fill="#1f6fd1" opacity=".55"/><circle cx="4" cy="22" r="1" fill="#fff"/><circle cx="18" cy="5" r=".8" fill="#fff"/><circle cx="26" cy="12" r=".7" fill="#fff"/></pattern>`,
  bred: `<pattern id="p-bred" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#c0232b"/><rect y="12" width="20" height="8" fill="#141416"/></pattern>`,
  graffiti: `<pattern id="p-graffiti" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="#ff3fd2"/><path d="M0 10h30v6H0z" fill="#4dff3a"/><path d="M0 22l30-8v6L0 28z" fill="#3aa0ff"/><circle cx="8" cy="5" r="3" fill="#ffe14d"/></pattern>`,
  monogram: `<pattern id="p-monogram" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#6b4a2c"/><text x="3" y="11" font-size="8" font-family="Georgia" fill="#e3c27a">W</text></pattern>`,
  neon: `<pattern id="p-neon" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#121214"/><path d="M0 4h20v3H0z" fill="#4dff3a"/><path d="M0 13h20v3H0z" fill="#ff3fd2"/></pattern>`,
};

/** A fill for an option: a color, a gold / chrome gradient, or a print. */
function fillFor(field: string, option: string): { fill: string; defs: string } {
  const o = optionsOf(field)?.find((x) => x.id === option);
  const pat = o?.pattern ?? (field === 'weaponSkin' ? ({ camo: 'camo', neon: 'neon', graffiti: 'graffiti' } as Record<string, string>)[option] : field === 'backpack' ? ({ camopack: 'camo', designer: 'monogram' } as Record<string, string>)[option] : undefined);
  if (pat && PATTERNS[pat]) return { fill: `url(#p-${pat})`, defs: PATTERNS[pat] };
  const metal = (o?.metal ?? 0) > 0.5 || option === 'gold' || option === 'gold24k' || option === 'chrome';
  if (metal) {
    const [a, b, c] = option === 'chrome' ? ['#ffffff', '#9fb4c4', '#e8f0f6'] : ['#fff0b3', '#d4a32a', '#8a5e10'];
    return { fill: 'url(#p-metal)', defs: `<linearGradient id="p-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>` };
  }
  return { fill: o?.color ?? (option === 'schoolbag' ? '#1d1d22' : '#8b8e93'), defs: '' };
}

const SHAPES = {
  hoodie: 'M30 18l14-8h12l14 8 14 22-12 6-6-10v54H34V36l-6 10-12-6z M44 10c0 8 12 8 12 0',
  puffer: 'M28 20l16-10h12l16 10 14 22-12 6-6-8v52H32V40l-6 8-12-6z M32 46h36 M32 60h36 M32 74h36',
  tee: 'M30 16l14-6h12l14 6 14 16-12 8-6-6v52H34V34l-6 6-12-8z',
  shoe: 'M10 62c0-12 10-22 24-24l12-12 16 10c8 5 16 8 26 10 6 2 8 8 6 14H10z M10 62h84v8H10z',
  gun: 'M8 40h60l6-6h12v14H66l-4 6H48l-6 22H30l6-22H8z',
  pack: 'M30 26c0-10 8-16 20-16s20 6 20 16v52c0 6-4 10-10 10H40c-6 0-10-4-10-10z M38 50h24v22H38z',
  chain: 'M30 22c0 30 10 46 20 46s20-16 20-46',
  watch: 'M38 20h24v14H38z M38 66h24v14H38z M50 32a18 18 0 1 0 .1 0z',
  hoops: 'M36 30a12 12 0 1 0 .1 0z M64 30a12 12 0 1 0 .1 0z',
  gloves: 'M30 80V44l-6-14c-2-5 4-8 7-3l5 9V18c0-5 7-5 7 0v20-26c0-5 7-5 7 0v26-22c0-5 7-5 7 0v24-16c0-5 7-5 7 0v38c0 12-8 18-18 18H40c-6 0-10-4-10-10z',
  person: 'M50 8a10 10 0 1 1-.1 0z M34 30h32l8 30-8 2-4-16v50H54V70h-8v26H38V46l-4 16-8-2z',
};

function svg(path: string, fill: string, defs: string, extra = ''): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${defs}</defs><path d="${path}" fill="${fill}" stroke="#0b0b0d" stroke-width="2.4" stroke-linejoin="round"/>${extra}</svg>`;
}

let artIds = 0;

/** Placeholder art for an item card (drawn; final art comes later). Pattern ids are unique per drawing. */
export function itemArt(item: StoreItem): string {
  const u = `i${++artIds}`;
  return drawItem(item).replace(/(id="|url\(#)([pb])-/g, `$1$2${u}-`);
}

function drawItem(item: StoreItem): string {
  const e = item.equip;
  switch (item.category) {
    case 'outfits': {
      const top = fillFor('topColor', e.topColor ?? 'black');
      const bot = fillFor('bottomColor', e.bottomColor ?? 'black');
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${top.defs}${bot.defs.replace('id="p-', 'id="b-').replace(/url\(#p-/g, 'url(#b-')}</defs>
<path d="${SHAPES.person}" fill="${top.fill}" stroke="#0b0b0d" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M38 70h24v26H54V74h-8v22h-8z" fill="${bot.fill.replace('#p-', '#b-')}" stroke="#0b0b0d" stroke-width="2.4"/></svg>`;
    }
    case 'tops': {
      const f = fillFor('topColor', e.topColor ?? 'black');
      return svg(e.top === 'puffer' ? SHAPES.puffer : e.top === 'tee' ? SHAPES.tee : SHAPES.hoodie, f.fill, f.defs);
    }
    case 'sneakers': {
      const f = fillFor('shoeColor', e.shoeColor ?? 'white');
      return svg(SHAPES.shoe, f.fill, f.defs);
    }
    case 'weapons': {
      const f = fillFor('weaponSkin', e.weaponSkin ?? 'none');
      return svg(SHAPES.gun, f.fill, f.defs);
    }
    case 'backpacks': {
      const f = fillFor('backpack', e.backpack ?? 'schoolbag');
      return svg(SHAPES.pack, f.fill, f.defs);
    }
    default: {
      const gold = 'url(#p-metal)';
      const defs = '<linearGradient id="p-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b3"/><stop offset=".5" stop-color="#d4a32a"/><stop offset="1" stop-color="#8a5e10"/></linearGradient>';
      if (e.necklace) {
        const iced = e.necklace === 'wtpendant';
        return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${defs}</defs><path d="${SHAPES.chain}" fill="none" stroke="${iced ? '#dff3ff' : gold}" stroke-width="${iced ? 5 : 8}" stroke-dasharray="${iced ? '3 2' : '7 3'}" stroke-linecap="round"/>${iced ? '<path d="M38 66h24l-4 20H42z" fill="#e6f6ff" stroke="#0b0b0d" stroke-width="2"/><text x="50" y="81" font-size="11" font-weight="900" text-anchor="middle" fill="#3a6aa0">WT</text>' : ''}</svg>`;
      }
      if (e.wrist === 'icedwatch') return svg(SHAPES.watch, gold, defs, '<circle cx="50" cy="50" r="11" fill="#e6f6ff" stroke="#9ec9ea" stroke-width="2"/>');
      if (e.wrist === 'gloves') return svg(SHAPES.gloves, '#17171b', '');
      return svg(SHAPES.hoops, 'none', defs).replace('fill="none"', 'fill="none" stroke-width="5"').replace('stroke="#0b0b0d"', 'stroke="#dff3ff"');
    }
  }
}

/** A small "COMMON / RARE / EPIC / LEGENDARY" tag. */
export function rarityTag(item: StoreItem): string {
  return `<span class="rarity" style="--r:${RARITY_COLORS[item.rarity]}">${item.rarity}</span>`;
}
