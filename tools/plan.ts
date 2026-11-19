/**
 * Floor plans of the explorable buildings (one drawing per floor): walls, doors (with their
 * swing), windows, stairs and stairwells, furniture, loot spots. For checking layouts by eye.
 *
 *   npx tsx tools/plan.ts [type ...] [--out=tools/out/plan.html]
 *   node tools/shot.mjs tools/out/plan.html tools/out/plan.png 1800 1400
 */
import { writeFileSync } from 'node:fs';
import { MapBuilder, construct, type BuildingType, type MapDef, type Solid, type Side } from '../shared/src/index';

const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'tools/out/plan.html';
const types = (args.filter((a) => !a.startsWith('--')) as BuildingType[]);
const SAMPLES: Array<{ type: BuildingType; w: number; d: number; floors?: number; facing?: Side }> = [
  { type: 'house2', w: 10, d: 8.8 },
  { type: 'house2', w: 6.8, d: 8.8 },
  { type: 'house1', w: 8.5, d: 8.8 },
  { type: 'apartment', w: 12, d: 12, floors: 3 },
  { type: 'tenement', w: 11, d: 11, floors: 4 },
  { type: 'store', w: 14, d: 11 },
  { type: 'barbershop', w: 9, d: 10 },
  { type: 'laundromat', w: 12, d: 10 },
  { type: 'restaurant', w: 12, d: 12, floors: 2 },
  { type: 'office', w: 16, d: 14, floors: 3 },
  { type: 'warehouse', w: 18, d: 16 },
  { type: 'garage', w: 10, d: 10 },
];
const list = types.length ? SAMPLES.filter((s) => types.includes(s.type)) : SAMPLES;

const S = 34; // px per meter
const html: string[] = [`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1d1f23;color:#ddd;font:12px Helvetica">`];

for (const spec of list) {
  const b = new MapBuilder();
  const facing = spec.facing ?? 's';
  // the lot sits at the origin, its front toward +z (facing south)
  construct(b, { id: 'x', type: spec.type, x0: 0, x1: spec.w, z0: 0, z1: spec.d, facing, floors: spec.floors, seed: 7 });
  const map = b.build('plan', 'plan', { minX: -5, maxX: spec.w + 5, minZ: -5, maxZ: spec.d + 5 });
  const floors = Math.round(Math.max(...map.solids.filter((s) => s.kind === 'wall').map((s) => s.y + s.sy / 2)) / 3.2);
  html.push(`<h3 style="margin:12px">${spec.type} ${spec.w}×${spec.d} — ${map.doors?.length ?? 0} doors, ${map.windows?.length ?? 0} windows, ${map.solids.length} solids</h3><div style="display:flex;gap:14px;flex-wrap:wrap;padding:0 12px">`);
  for (let f = 0; f < Math.max(1, floors); f++) html.push(floorSvg(map, spec.w, spec.d, f));
  html.push('</div>');
}
writeFileSync(out, html.join('\n'));
console.log(`wrote ${out}`);

function floorSvg(map: MapDef, w: number, d: number, f: number): string {
  const story = map.solids.some((s) => s.kind === 'wall' && Math.abs(s.y + s.sy / 2 - 3.4) < 0.01) ? 3.4 : map.solids.some((s) => s.kind === 'wall' && s.y + s.sy / 2 > 5.5 && s.y - s.sy / 2 < 0.1) ? 6.4 : 3.2;
  const y0 = f * story, y1 = y0 + story;
  const pad = 3.2;
  const Wp = (w + pad * 2) * S, Hp = (d + pad * 2) * S;
  const X = (x: number) => (x + pad) * S, Z = (z: number) => (z + pad) * S;
  const o: string[] = [`<div><div>floor ${f}</div><svg width="${Wp}" height="${Hp}" style="background:#2b2d31">`];
  // a solid's footprint polygon (oriented box)
  const poly = (s: Solid, fill: string, stroke = 'none', op = 1) => {
    const ry = s.ry ?? 0, c = Math.cos(ry), sn = Math.sin(ry);
    // local x -> world (cos, -sin), local z -> world (sin, cos)
    const hx = s.sx / 2, hz = (s.rx ? Math.cos(s.rx) : 1) * s.sz / 2;
    const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, bb]) => `${X(s.x + a * c + bb * sn).toFixed(1)},${Z(s.z - a * sn + bb * c).toFixed(1)}`);
    o.push(`<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" opacity="${op}"/>`);
  };
  const within = (s: Solid) => s.y + s.sy / 2 > y0 + 0.3 && s.y - s.sy / 2 < y0 + 2.0;
  for (const s of map.solids) {
    if (s.kind === 'floorslab' || s.kind === 'roof') {
      // the floor we stand on (its top at y0)
      if (Math.abs(s.y + s.sy / 2 - y0) < 0.05) poly(s, '#3a3d44');
    }
  }
  for (const s of map.solids) {
    if (s.kind === 'stairs' || s.kind === 'stairfill') {
      const top = s.y + s.sy / 2;
      if (s.kind === 'stairs' && (s.meta?.y0 === y0 || Math.abs((s.meta?.y0 as number) + (s.meta?.rise as number) - y0) < 0.05)) poly(s, s.meta?.y0 === y0 ? '#7d6a4c' : '#5a4d3a', '#c8a86a');
      void top;
    }
  }
  for (const s of map.solids) {
    if (!within(s)) continue;
    if (s.kind === 'wall') poly(s, s.meta?.int ? '#c9c2b5' : '#e8e2d6');
    else if (s.kind === 'furn') {
      poly(s, s.col === 'none' ? '#3c6e8f' : '#4f86b0', '#9ccbf0', 0.9);
      const t = String(s.meta?.t ?? '');
      o.push(`<text x="${X(s.x)}" y="${Z(s.z) + 3}" fill="#fff" font-size="8" text-anchor="middle">${t}</text>`);
    } else if (s.kind === 'rail') poly(s, '#e0a030');
    else if (s.kind === 'platform' || s.kind === 'deck') poly(s, '#666b75', '#999', 0.8);
  }
  for (const dd of map.doors ?? []) {
    if (Math.abs(dd.y - y0) > 0.1) continue;
    const ux = Math.sin(dd.a), uz = Math.cos(dd.a), nx = Math.cos(dd.a) * (dd.inside ?? 1), nz = -Math.sin(dd.a) * (dd.inside ?? 1);
    o.push(`<line x1="${X(dd.x)}" y1="${Z(dd.z)}" x2="${X(dd.x + ux * dd.w)}" y2="${Z(dd.z + uz * dd.w)}" stroke="#ff5a4f" stroke-width="4"/>`);
    // swing arc toward the inside
    o.push(`<path d="M${X(dd.x + nx * dd.w)} ${Z(dd.z + nz * dd.w)} A${dd.w * S} ${dd.w * S} 0 0 ${nx * uz - nz * ux > 0 ? 0 : 1} ${X(dd.x + ux * dd.w)} ${Z(dd.z + uz * dd.w)}" fill="none" stroke="#ff5a4f" stroke-dasharray="3 3"/>`);
    o.push(`<line x1="${X(dd.x)}" y1="${Z(dd.z)}" x2="${X(dd.x + nx * dd.w)}" y2="${Z(dd.z + nz * dd.w)}" stroke="#ff5a4f" stroke-width="1"/>`);
    if (dd.lockable) o.push(`<circle cx="${X(dd.x + ux * dd.w * 0.85)}" cy="${Z(dd.z + uz * dd.w * 0.85)}" r="3" fill="${dd.locked ? '#ff0' : '#fa0'}"/>`);
  }
  for (const wd of map.windows ?? []) {
    if (wd.y < y0 - 0.1 || wd.y > y0 + 2.5) continue;
    const ux = Math.sin(wd.a), uz = Math.cos(wd.a);
    o.push(`<line x1="${X(wd.x - ux * wd.w / 2)}" y1="${Z(wd.z - uz * wd.w / 2)}" x2="${X(wd.x + ux * wd.w / 2)}" y2="${Z(wd.z + uz * wd.w / 2)}" stroke="${wd.breakable ? '#5fd8ff' : '#2a7fa0'}" stroke-width="5"/>`);
  }
  for (const l of map.lootSpots ?? []) {
    if (Math.abs(l.y - y0) > 0.1) continue;
    o.push(`<circle cx="${X(l.x)}" cy="${Z(l.z)}" r="5" fill="#7dff6b"/>`);
  }
  o.push(`<text x="6" y="${Hp - 8}" fill="#888">front (street) ↓</text></svg></div>`);
  return o.join('');
}
