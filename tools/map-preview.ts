/**
 * Renders a top-down SVG of the map (collision solids, props, zones, spawns, roads)
 * so layout changes can be eyeballed without launching the game.
 *   npx tsx tools/map-preview.ts [out.svg]
 */
import { writeFileSync } from 'node:fs';
import { getGreaterTowne, getWhoopaTowne, CREWS, type Solid } from '../shared/src/index';

const map = process.argv.includes('--greater') ? getGreaterTowne() : getWhoopaTowne();
const S = process.argv.includes('--greater') ? 4 : 10; // px per meter
const pad = 4;
const { minX, maxX, minZ, maxZ } = map.bounds;
const W = (maxX - minX + pad * 2) * S;
const H = (maxZ - minZ + pad * 2) * S;
const X = (x: number) => (x - minX + pad) * S;
const Z = (z: number) => (z - minZ + pad) * S;

const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
out.push(`<rect width="${W}" height="${H}" fill="#2b2d31"/>`);

const areaColor: Record<string, string> = {
  grass: '#3d5a3a', path: '#8a8068', sidewalk: '#55585e', alley: '#33353a', lot: '#3a3c42', court: '#7a4a35',
  gravel: '#4f4a43', crossing: '#6b5a45', floor: '#4a4037', base0: '#243a63', base1: '#632424',
};
for (const a of [...map.areas].sort((p, q) => (p.layer ?? 1) - (q.layer ?? 1))) {
  out.push(`<rect x="${X(a.x0)}" y="${Z(a.z0)}" width="${(a.x1 - a.x0) * S}" height="${(a.z1 - a.z0) * S}" fill="${areaColor[a.kind] ?? '#444'}"/>`);
}
for (const r of map.roads) {
  const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Z(p.z).toFixed(1)}`).join(' ');
  if (r.kind === 'road') {
    out.push(`<path d="${d}" fill="none" stroke="#1f2023" stroke-width="${r.width * S}" stroke-linejoin="round"/>`);
    out.push(`<path d="${d}" fill="none" stroke="#c9b458" stroke-width="2" stroke-dasharray="14 14" opacity="0.7"/>`);
  } else {
    out.push(`<path d="${d}" fill="none" stroke="#3a342c" stroke-width="${r.width * S}"/>`);
    out.push(`<path d="${d}" fill="none" stroke="#9aa0a6" stroke-width="${1.5 * S}" stroke-dasharray="3 6" opacity="0.8"/>`);
  }
}

function solidColor(s: Solid): string {
  const col = s.col ?? 'solid';
  if (col === 'fence') return 'none';
  switch (s.kind) {
    case 'building': return '#8b6f5a';
    case 'wall': return '#b08968';
    case 'roof': return 'rgba(176,137,104,0.28)';
    case 'perimeter': return '#15161a';
    case 'basewall': return '#9aa3ad';
    case 'stairs': case 'fireescape': case 'ramp': return '#d9a441';
    case 'stairfill': return 'rgba(217,164,65,0.35)';
    case 'platform': case 'deck': return 'rgba(140,150,165,0.45)';
    case 'parapet': return '#c9c9c9';
    case 'prop': return '#5fa8d3';
    case 'fence_wood': return '#a9743a';
    case 'pillar': return '#777';
    default: return '#7d8590';
  }
}

// Draw low things first, tall things last.
const drawable = map.solids.filter((s) => s.kind !== 'ground').sort((a, b) => (a.y + a.sy / 2) - (b.y + b.sy / 2));
for (const s of drawable) {
  const col = s.col ?? 'solid';
  const deg = (-(s.ry ?? 0) * 180) / Math.PI;
  const len = s.rx ? Math.cos(s.rx) * s.sz : s.sz; // ramps: horizontal footprint
  const w = s.sx * S, h = len * S;
  const fill = solidColor(s);
  const stroke = col === 'fence' ? '#7fd1c7' : 'rgba(0,0,0,0.55)';
  const sw = col === 'fence' ? 2 : 1;
  out.push(`<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${Math.max(h, col === 'fence' ? 2 : 0.5)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="translate(${X(s.x).toFixed(1)} ${Z(s.z).toFixed(1)}) rotate(${deg.toFixed(2)})"/>`);
}

for (const zn of map.zones) {
  out.push(`<circle cx="${X(zn.x)}" cy="${Z(zn.z)}" r="${zn.radius * S}" fill="rgba(255,221,87,0.12)" stroke="#ffdd57" stroke-width="3" stroke-dasharray="10 6"/>`);
  out.push(`<text x="${X(zn.x)}" y="${Z(zn.z) + 14}" fill="#ffdd57" font-size="40" font-weight="bold" text-anchor="middle">${zn.id}</text>`);
}
for (const team of [0, 1] as const) {
  for (const sp of map.spawns[team]) {
    const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
    out.push(`<circle cx="${X(sp.x)}" cy="${Z(sp.z)}" r="5" fill="${CREWS[team].color}"/>`);
    out.push(`<line x1="${X(sp.x)}" y1="${Z(sp.z)}" x2="${X(sp.x + fx * 1.5)}" y2="${Z(sp.z + fz * 1.5)}" stroke="${CREWS[team].color}" stroke-width="2"/>`);
  }
}
for (const l of map.labels) {
  out.push(`<text x="${X(l.x)}" y="${Z(l.z)}" fill="#fff" font-size="13" text-anchor="middle" opacity="0.9" stroke="#000" stroke-width="3" paint-order="stroke">${l.text.replace(/&/g, '&amp;')}</text>`);
}
for (const h of map.hotspots) out.push(`<circle cx="${X(h.x)}" cy="${Z(h.z)}" r="3" fill="none" stroke="#f0f" stroke-width="1"/>`);
// 10m grid ticks
for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) out.push(`<text x="${X(x)}" y="14" fill="#888" font-size="11" text-anchor="middle">${x}</text><line x1="${X(x)}" y1="18" x2="${X(x)}" y2="${H}" stroke="rgba(255,255,255,0.05)"/>`);
for (let z = Math.ceil(minZ / 10) * 10; z <= maxZ; z += 10) out.push(`<text x="4" y="${Z(z) + 4}" fill="#888" font-size="11">${z}</text><line x1="0" y1="${Z(z)}" x2="${W}" y2="${Z(z)}" stroke="rgba(255,255,255,0.05)"/>`);
out.push('</svg>');

const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? new URL('./out/map.svg', import.meta.url).pathname;
writeFileSync(file, out.join('\n'));
console.log(`wrote ${file} (${map.solids.length} solids, ${map.props.length} props)`);
