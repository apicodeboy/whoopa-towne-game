import {
  DEFAULT_APPEARANCE, EXTRA_FIELD_KEYS, GameSim, LOOK_FIELDS, LOOK_FIELD_KEYS, LOOK_PRESETS, TOPS, isPremiumOption, botAppearance, decodeAppearance, encodeAppearance,
  randomAppearance, sameAppearance, sanitizeAppearance, seededRandom, type Appearance, type TeamId,
} from '../src/index';
import { assert, test } from './harness';
import { initRapier } from './env';

/** Every field holds an id that exists and is available. */
function assertValid(a: Appearance, what: string): void {
  for (const key of LOOK_FIELD_KEYS) {
    const o = LOOK_FIELDS[key].find((x) => x.id === a[key]);
    assert(!!o && o.available !== false, `${what}: ${key}=${a[key]} is not a selectable option`);
  }
}

test('appearance: untrusted looks are cleaned field by field', () => {
  const junk = sanitizeAppearance({ hair: '<script>', skin: 42, top: { x: 1 }, details: 'freckles' });
  assert(sameAppearance(junk, DEFAULT_APPEARANCE), `junk not replaced: ${encodeAppearance(junk)}`);
  const partial = sanitizeAppearance({ hair: 'largeafro', hairColor: 'pink', nose: 'gigantic' });
  assert(partial.hair === 'largeafro' && partial.hairColor === 'pink', 'valid fields lost');
  assert(partial.nose === DEFAULT_APPEARANCE.nose, 'invalid field kept');
  for (const raw of [null, undefined, 'x', 5, [], 'L1zzzzzz']) assertValid(sanitizeAppearance(raw), `raw ${String(raw)}`);
});

test('appearance: options without art ("coming soon") can never be worn', () => {
  const soon = TOPS.find((t) => t.available === false)!;
  const a = sanitizeAppearance({ top: soon.id, tattoos: { larm: 'skull' } });
  assert(a.top === DEFAULT_APPEARANCE.top, `unavailable top ${soon.id} was accepted`);
  assert(Object.keys(a.tattoos).length === 0, 'unavailable tattoo was accepted');
  // the same holds for wire codes: force the "No Shirt" slot (index 0) into a code
  const code = encodeAppearance(DEFAULT_APPEARANCE);
  const topAt = 2 + LOOK_FIELD_KEYS.indexOf('top');
  const forged = code.slice(0, topAt) + '0' + code.slice(topAt + 1);
  assert(decodeAppearance(forged).top === DEFAULT_APPEARANCE.top, 'forged code put on an unavailable top');
});

test('appearance: saves from before the creator keep their outfit', () => {
  const punk = sanitizeAppearance({ body: 'punk', mouth: 'bottle' });
  assert(punk.bodyType === 'fem' && punk.hair === 'mohawk' && punk.top === 'crop' && punk.shoes === 'boots', 'punk outfit lost');
  assert(punk.mouthProp === 'bottle', 'mouth prop lost');
  const casual = sanitizeAppearance({ body: 'casual', mouth: 'none' });
  assert(casual.top === 'tee' && casual.bottom === 'jeans' && casual.hair === 'ponytail', 'casual outfit lost');
  assertValid(punk, 'legacy punk');
  assertValid(casual, 'legacy casual');
});

test('appearance: wire codes are short and round-trip exactly', () => {
  const rand = seededRandom(1234);
  for (let i = 0; i < 300; i++) {
    const a = randomAppearance(rand);
    assertValid(a, `random #${i}`);
    const code = encodeAppearance(a);
    assert(code.length <= 56, `code too long (${code.length})`);
    const b = decodeAppearance(code);
    assert(JSON.stringify(b) === JSON.stringify(a), `round trip changed look #${i}: ${code}`);
  }
  // codes and objects both sanitize to the same thing
  const a = randomAppearance(seededRandom(9));
  assert(sameAppearance(sanitizeAppearance(encodeAppearance(a)), sanitizeAppearance(a)), 'code and object disagree');
});

test('appearance: bot looks are stable per name and slot, valid, and varied', () => {
  const a = botAppearance('Lil Skeet', 3), b = botAppearance('Lil Skeet', 3);
  assert(sameAppearance(a, b), 'same bot got different looks');
  const hair = new Set<string>(), tops = new Set<string>(), bodies = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const l = botAppearance(`Bot ${i}`, i);
    assertValid(l, `bot ${i}`);
    hair.add(l.hair);
    tops.add(l.top);
    bodies.add(l.bodyType);
  }
  assert(hair.size >= 10 && tops.size >= 3 && bodies.size === 3, `bots barely vary: ${hair.size} hairstyles, ${tops.size} tops`);
});

test('appearance: the roster carries every look and the sim RNG is untouched by it', async () => {
  const R = await initRapier();
  const mine = sanitizeAppearance({ hair: 'cornrows', top: 'tee', topColor: 'yellow', glasses: 'aviators' });
  const make = () => {
    const sim = new GameSim(R, { mode: 'tdm', seed: 77, warmup: 0 });
    sim.addPlayer({ id: 'me', name: 'Me', team: 0, look: mine });
    for (let i = 0; i < 3; i++) sim.addPlayer({ id: `b${i}`, name: `B${i}`, team: (i % 2) as TeamId, isBot: true });
    return sim;
  };
  const sim = make();
  const roster = sim.roster();
  const me = roster.find((r) => !r.bot)!;
  assert(typeof me.look === 'string' && sameAppearance(decodeAppearance(me.look), mine), 'human look missing from roster');
  for (const r of roster) assert(typeof r.look === 'string' && r.look.length > 0, `no look for ${r.name}`);
  // bot looks come from their names, not the match RNG: two sims with the same seed stay in step
  assert(make().rng.next() === sim.rng.next(), 'rng drifted');
  sim.dispose();
});

test('appearance: Urban Ink fields: codes saved before them decode unchanged, new fields round-trip', () => {
  // a code exactly as written before the new fields existed (it ends after the AJ's extras)
  const before: Appearance = { ...DEFAULT_APPEARANCE, tattoos: {}, details: [], hair: 'braids', topColor: 'red', weaponSkin: 'gold', backpack: 'designer' };
  const full = encodeAppearance(before);
  const extras = EXTRA_FIELD_KEYS.length;
  const oldCode = full.slice(0, full.length - (extras - 2)); // only weaponSkin + backpack after the mask
  const back = decodeAppearance(oldCode);
  assert(back.hair === 'braids' && back.topColor === 'red' && back.weaponSkin === 'gold' && back.backpack === 'designer', 'old fields read back');
  assert(back.shoulders === 'average' && back.headSize === 'average' && back.mask === 'none' && back.carry === 'none' && back.waistChain === 'none', 'new fields default');
  const look: Appearance = { ...before, shoulders: 'broad', headSize: 'large', mask: 'facemask', carry: 'phone', waistChain: 'silver', top: 'puffervest', hat: 'graffitibeanie', hair: 'locs' };
  assert(sameAppearance(decodeAppearance(encodeAppearance(look)), look), 'new fields round-trip');
  assert(sanitizeAppearance({ ...look, mask: 'nope', shoulders: 42 }).mask === 'none', 'bad values are cleaned');
});

test('appearance: the faceless character: new fields round-trip, old starter looks move to the new default, customized looks stay', () => {
  const look: Appearance = { ...DEFAULT_APPEARANCE, tattoos: {}, details: [], face: 'black', faceMark: 'star', belt: 'blackstuds', legPrint: 'flames', hair: 'wicks', necklace: 'icedpendant', wrist: 'glovewatches' };
  assert(sameAppearance(decodeAppearance(encodeAppearance(look)), look), 'new fields round-trip');
  assert(sanitizeAppearance({ ...look, face: 'plaid', belt: 7 }).face === DEFAULT_APPEARANCE.face, 'bad values are cleaned');
  assert(DEFAULT_APPEARANCE.hair === 'spikylocs' && DEFAULT_APPEARANCE.face === 'gray' && DEFAULT_APPEARANCE.top === 'puffer' && DEFAULT_APPEARANCE.bottom === 'baggyjeans', 'the default is the faceless look');
  // the default look as it was saved before (an object without the new fields, and its wire code)
  const old = {
    bodyType: 'masc', build: 'average', height: 'average', skin: 's05', headShape: 'oval', faceShape: 'defined', eyes: 'average', eyeColor: 'brown',
    brows: 'natural', nose: 'average', ears: 'average', hair: 'shortdreads', hairColor: 'black', facialHair: 'none', facialHairColor: 'darkbrown',
    lips: 'average', mouthAcc: 'none', mouthProp: 'none', teeth: 'natural', top: 'puffer', topColor: 'black', bottom: 'baggyjeans', bottomColor: 'gray',
    shoes: 'chunky', shoeColor: 'white', hat: 'beanie', glasses: 'none', earrings: 'diamondstuds', necklace: 'diamond', wrist: 'none', faceAcc: 'none',
    weaponSkin: 'gold', backpack: 'none', shoulders: 'average', headSize: 'average', mask: 'none', carry: 'none', waistChain: 'none', tattoos: {}, details: [],
  };
  const moved = sanitizeAppearance(old);
  assert(moved.hair === 'spikylocs' && moved.hat === 'none' && moved.shoes === 'lowtops' && moved.belt === 'redstuds', 'an untouched old default becomes the new default');
  assert(moved.weaponSkin === 'gold', 'what was bought at AJ\'S stays on');
  // its wire code, as written before the new fields existed (it ends after the pants chain)
  const full = encodeAppearance({ ...DEFAULT_APPEARANCE, ...old } as Appearance);
  const oldCode = full.slice(0, full.length - 4);
  const viaCode = decodeAppearance(oldCode);
  assert(viaCode.hair === 'spikylocs' && viaCode.weaponSkin === 'gold', 'the same through an old wire code');
  // a look somebody made their own is left exactly as it was (it only gains the new fields' defaults)
  const mine = sanitizeAppearance({ ...old, hair: 'cornrows', topColor: 'red' });
  assert(mine.hair === 'cornrows' && mine.topColor === 'red' && mine.hat === 'beanie' && mine.shoes === 'chunky', 'a customized old look is kept');
  const mineCode = encodeAppearance({ ...DEFAULT_APPEARANCE, ...old, hair: 'cornrows' } as Appearance);
  assert(decodeAppearance(mineCode.slice(0, mineCode.length - 4)).hair === 'cornrows', 'and through an old wire code');
  // a new-format look that happens to match the old default's clothes is not touched either
  const kept = sanitizeAppearance({ ...old, face: 'gray', faceMark: 'none', belt: 'none', legPrint: 'none' });
  assert(kept.hair === 'shortdreads' && kept.hat === 'beanie', 'a look saved after the change is never moved');
});

test('appearance: the starter looks are complete, valid, and free (nothing from AJ\'S)', () => {
  assert(LOOK_PRESETS.length >= 2, 'two starter looks');
  for (const p of LOOK_PRESETS) {
    const look = sanitizeAppearance({ ...DEFAULT_APPEARANCE, ...p.look });
    for (const [k, v] of Object.entries(p.look)) {
      assert((look as unknown as Record<string, unknown>)[k] === v, `${p.id}: ${k}=${String(v)} survives sanitizing`);
      assert(!isPremiumOption(k, String(v)), `${p.id}: ${k}=${String(v)} is an AJ's item`);
    }
    assertValid(look, p.id);
  }
});
