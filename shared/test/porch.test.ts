import {
  AIR_BALLOON, AIR_GROUND, AIR_RIDING, AIR_SKYDIVE, BTN, Q_PROJECTILE, EV, GameSim, ITEM, PHASE, PLAYER, PORCH, STAGE_RIOT, TICK_MS,
  copyPlayerState, makeInputCmd, makePlayerState, makeStepActions, stepPlayer, weaponInSlot, DEFAULT_LOADOUT,
  type InputCmd, type SimPlayer, type SquadMode,
} from '../src/index';
import { approx, assert, test } from './harness';
import { initRapier } from './env';

/** A battle royale with one human ('me') and bots (or nobody else). */
async function porchSim(opts: { bots?: number; squads?: SquadMode; seed?: number; humans?: number } = {}) {
  const R = await initRapier();
  const sim = new GameSim(R, { mode: 'porch', seed: opts.seed ?? 99, warmup: 0, squads: opts.squads ?? 'solo' });
  const size = { solo: 1, duos: 2, squads: 4 }[opts.squads ?? 'solo'];
  const humans: SimPlayer[] = [];
  for (let i = 0; i < (opts.humans ?? 1); i++) {
    humans.push(sim.addPlayer({ id: `h${i}`, name: `H${i}`, team: 0, squad: Math.floor(i / size) })!);
  }
  for (let i = 0; i < (opts.bots ?? 0); i++) {
    const k = humans.length + i;
    sim.addPlayer({ id: `b${i}`, name: `Bot${i}`, team: 1, squad: Math.floor(k / size), isBot: true });
  }
  sim.start();
  return { sim, me: humans[0], humans };
}

let seq = 0;
function step(sim: GameSim, p: SimPlayer, over: Partial<InputCmd> = {}): number[][] {
  const c = makeInputCmd();
  c.seq = ++seq;
  c.yaw = p.state.yaw;
  c.pitch = p.state.pitch;
  c.slot = p.state.slot;
  c.ox = p.state.x; c.oy = p.state.y + PLAYER.eyeHeight; c.oz = p.state.z;
  c.rt = sim.time;
  Object.assign(c, over);
  sim.queueInput(p.idx, c);
  sim.tick();
  return sim.drainEvents();
}

/** Lands a player on open ground at (x, z), unarmed. */
function land(p: SimPlayer, x: number, z: number, yaw = 0): void {
  const s = p.state;
  s.air = AIR_GROUND;
  s.x = x; s.y = 0.02; s.z = z; s.yaw = yaw; s.pitch = 0;
  s.vx = s.vy = s.vz = 0;
  s.grounded = 1;
  p.hCount = 0;
}

/** Runs the clock forward (everyone else idle). */
function wait(sim: GameSim, seconds: number, p?: SimPlayer, over: Partial<InputCmd> = {}): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < Math.round(seconds * 1000 / TICK_MS); i++) {
    if (p) out.push(...step(sim, p, over));
    else {
      sim.tick();
      out.push(...sim.drainEvents());
    }
  }
  return out;
}

const of = (evs: number[][], type: number) => evs.filter((e) => e[0] === type);

test('porch: 20-player lobby boards the transport; bags are placed with hidden loot', async () => {
  const { sim, me } = await porchSim({ bots: 19 });
  assert(sim.players.length === PORCH.lobbySize, `capacity ${sim.players.length}`);
  assert(sim.players.every((p) => p && p.alive && p.state.air === AIR_RIDING), 'everyone starts on the transport');
  assert(me.state.y > 60, 'transport flies high above the town');
  const porch = sim.porch!;
  assert(porch.bags.length >= PORCH.minBags, `only ${porch.bags.length} bags`);
  assert(porch.bags.every((b) => b.loot.length > 0), 'a bag with nothing in it');
  const init = porch.init();
  assert(init.bags.length === porch.bags.length * 7, 'bags in the match start payload');
  assert(!JSON.stringify(init).includes('loot'), 'loot leaked to clients');
  const snap = sim.snapshot(me.idx, []);
  assert(snap.b && snap.b.length === 14, 'battle royale state in snapshots');
  sim.dispose();
});

test('porch: jump off the transport, skydive, balloons up, steer, land and pop', async () => {
  const { sim, me } = await porchSim();
  sim.tick(); // pregame over (warmup 0): live
  assert(sim.phase === PHASE.PLAYING, 'live');
  // doors open after a couple of seconds; jumping before that does nothing
  step(sim, me, { buttons: BTN.JUMP });
  assert(me.state.air === AIR_RIDING, 'jumped before the doors opened');
  wait(sim, PORCH.transport.doorsOpen, me);
  const evs = step(sim, me, { buttons: BTN.JUMP });
  assert((me.state.air as number) === AIR_SKYDIVE && of(evs, EV.JUMP_OUT).length === 1, 'jumped out into a skydive');
  // free fall: picks up speed fast, flies forward with the move keys
  const y0 = me.state.y, x0 = me.state.x, z0 = me.state.z;
  wait(sim, 1.5, me, { mz: 1 });
  assert((me.state.air as number) === AIR_SKYDIVE, 'still falling');
  assert(y0 - me.state.y > 10, `falls fast (${(y0 - me.state.y).toFixed(1)} m in 1.5 s)`);
  assert(Math.hypot(me.state.x - x0, me.state.z - z0) > 8, 'steering moves you through the air');
  // a fresh jump press puts the balloons up
  step(sim, me, { mz: 1 });
  const up = step(sim, me, { buttons: BTN.JUMP });
  assert((me.state.air as number) === AIR_BALLOON, 'balloons up on jump');
  void up;
  const y1 = me.state.y;
  wait(sim, 2, me, { mz: 1 });
  const sink = (y1 - me.state.y) / 2;
  assert(sink < PORCH.skydive.fallSpeed * 0.6, `the balloons slow the fall (${sink.toFixed(2)} m/s)`);
  wait(sim, 2, me, { mz: 1 });
  assert(Math.abs(me.state.vy + PORCH.balloon.fallSpeed) < 0.5, `then sinks slowly (${(-me.state.vy).toFixed(2)} m/s)`);
  // dive to the ground
  let landed: number[][] = [];
  for (let i = 0; i < 60 * 40 && (me.state.air as number) !== AIR_GROUND; i++) landed = step(sim, me, { buttons: BTN.CROUCH });
  assert((me.state.air as number) === AIR_GROUND && me.state.grounded === 1, 'landed');
  assert(of(landed, EV.TOUCHDOWN).length === 1, 'balloon popped');
  sim.dispose();
});

test('porch: the balloons go up by themselves near the ground', async () => {
  const { sim, me } = await porchSim();
  sim.tick();
  wait(sim, PORCH.transport.doorsOpen, me);
  step(sim, me, { buttons: BTN.JUMP });
  let deployedAt = -1;
  for (let i = 0; i < 60 * 20 && (me.state.air as number) === AIR_SKYDIVE; i++) {
    step(sim, me, { buttons: BTN.CROUCH });
    if ((me.state.air as number) === AIR_BALLOON) deployedAt = me.state.y;
  }
  assert((me.state.air as number) === AIR_BALLOON, 'balloons went up');
  // whatever is under you is within the deploy height (roofs count)
  const below = sim.phys.raycast(me.state.x, me.state.y, me.state.z, 0, -1, 0, 200, Q_PROJECTILE);
  assert(below >= 0 && below <= PORCH.skydive.deployHeight + 1, `deployed ${below.toFixed(1)} m up (y ${deployedAt.toFixed(1)})`);
  sim.dispose();
});

test('porch: everyone still aboard is dropped before the transport leaves town', async () => {
  const { sim, me } = await porchSim({ bots: 3 });
  const all = sim.players.filter((p): p is SimPlayer => !!p);
  for (let i = 0; i < 60 * 60 && all.some((p) => p.state.air === AIR_RIDING); i++) step(sim, me);
  assert(all.every((p) => p.state.air !== AIR_RIDING), 'still aboard after a minute');
  const b = sim.map.bounds;
  assert(me.state.x > b.minX && me.state.x < b.maxX && me.state.z > b.minZ && me.state.z < b.maxZ, 'dropped over the town');
  sim.dispose();
});

test('porch: balloon flight predicts exactly (client replay == server)', async () => {
  const { sim, me } = await porchSim();
  sim.tick();
  wait(sim, PORCH.transport.doorsOpen, me);
  step(sim, me, { buttons: BTN.JUMP });
  const a = copyPlayerState(makePlayerState(), me.state);
  const b = copyPlayerState(makePlayerState(), me.state);
  const act = makeStepActions();
  for (let i = 0; i < 300; i++) {
    const c = makeInputCmd();
    c.mx = Math.sin(i / 20);
    c.mz = 1;
    c.yaw = i / 100;
    c.buttons = i % 90 < 30 ? BTN.CROUCH : 0;
    stepPlayer(a, c, 1 / 60, sim.phys, DEFAULT_LOADOUT, act);
    stepPlayer(b, c, 1 / 60, sim.phys, DEFAULT_LOADOUT, act);
  }
  assert(a.x === b.x && a.y === b.y && a.z === b.z && a.air === b.air, 'diverged');
  sim.dispose();
});

test('porch: search a bookbag — the server hands out the loot once', async () => {
  const { sim, me } = await porchSim();
  sim.tick();
  const porch = sim.porch!;
  const bag = porch.bags.find((b) => b.loot.some((it) => it.kind === ITEM.WEAPON))!;
  assert(!!bag, 'no bag with a gun in this seed');
  land(me, bag.x + 1, bag.z);
  me.state.y = bag.y + 0.02;
  step(sim, me);
  const evs = step(sim, me, { buttons: BTN.USE });
  assert(of(evs, EV.BAG_OPEN).length === 1 && bag.opened, 'bag searched');
  assert(of(evs, EV.LOOT).length > 0, 'loot handed out');
  const armed = [0, 1, 3].some((slot) => weaponInSlot(me.state, slot)!.id !== 'fists');
  assert(armed, 'got the gun');
  // a second press does not open it again
  step(sim, me);
  const again = step(sim, me, { buttons: BTN.USE });
  assert(of(again, EV.BAG_OPEN).length === 0, 'opened twice');
  sim.dispose();
});

test('porch: fists reach 2 m, guns draw from the ammo pools, drops land as pickups', async () => {
  const { sim, me, humans } = await porchSim({ humans: 2 });
  sim.tick();
  const [a, b] = humans;
  land(a, -18, 30, 0);
  land(b, -18, 28.3, Math.PI);
  step(sim, a);
  const pitch = Math.atan2(1.1 - PLAYER.eyeHeight, 1.7);
  const evs = step(sim, a, { buttons: BTN.FIRE, pitch });
  const hit = of(evs, EV.HIT)[0];
  assert(hit && hit[2] === b.idx && hit[3] === WEAPON_FIST_DAMAGE, `punch: ${JSON.stringify(of(evs, EV.HIT))}`);
  land(b, -18, 26, Math.PI);
  wait(sim, 1, a);
  const miss = step(sim, a, { buttons: BTN.FIRE, pitch: Math.atan2(1.1 - PLAYER.eyeHeight, 4) });
  assert(of(miss, EV.HIT).length === 0, 'punched from 4 m away');

  // a pistol with 3 in the clip and 20 light rounds in the pool
  sim.porch!.give(a, { kind: ITEM.WEAPON, code: 3, count: 3 });
  sim.porch!.give(a, { kind: ITEM.AMMO, code: 0, count: 20 });
  assert(a.state.wH === 4 && a.state.mag1 === 3 && a.state.ammoL === 20, 'pistol + ammo in the inventory');
  step(sim, a, { slot: 1 });
  wait(sim, 0.4, a, { slot: 1 });
  step(sim, a, { slot: 1, buttons: BTN.RELOAD });
  wait(sim, 1.6, a, { slot: 1 });
  assert((a.state.mag1 as number) === 12 && (a.state.ammoL as number) === 11, `reload from the pool: ${a.state.mag1} / ${a.state.ammoL}`);
  // drop it
  const dropped = step(sim, a, { slot: 1, buttons: BTN.DROP });
  assert((a.state.wH as number) === 0 && of(dropped, EV.PICKUP_ADD).length === 1, 'dropped as a pickup');
  // and pick it back up
  step(sim, a, { slot: 1 });
  const took = step(sim, a, { slot: 1, buttons: BTN.USE });
  assert((a.state.wH as number) === 4 && (a.state.mag1 as number) === 12 && of(took, EV.PICKUP_GONE).length === 1, 'picked back up');
  sim.dispose();
});
const WEAPON_FIST_DAMAGE = 22;

test('porch: healing items take time, heal up to their cap, and armor soaks gunfire', async () => {
  const { sim, me } = await porchSim();
  sim.tick();
  land(me, -18, 30);
  me.health = 40;
  sim.porch!.give(me, { kind: ITEM.HEAL, code: 0, count: 3 });
  wait(sim, 0.1, me);
  step(sim, me, { buttons: BTN.HEAL });
  assert(me.state.healT > 0, 'started healing');
  const evs = wait(sim, PORCH.heals.bandage.time + 0.2, me);
  assert(of(evs, EV.HEALED).length === 1 && me.health === 55 && me.state.bandages === 2, `bandage: ${me.health} hp`);
  // armor
  sim.porch!.give(me, { kind: ITEM.ARMOR, code: 50, count: 1 });
  sim.damage(me, 30, 5, 1, false, 0, 0);
  approx(me.armor, 20, 0.01, 'armor took the hit');
  approx(me.health, 55, 0.01, 'health untouched');
  sim.damage(me, 30, 5, 1, false, 0, 0);
  approx(me.health, 45, 0.01, 'the rest goes through');
  sim.dispose();
});

test('porch: the riot spreads from the edge, slows and hurts anyone caught in it', async () => {
  const { sim, me } = await porchSim({ humans: 1 });
  sim.tick();
  land(me, 0, 0);
  const porch = sim.porch!;
  // fast-forward to the first riot phase's spread
  const toShrink = PORCH.deploySeconds + PORCH.earlySeconds + PORCH.riotPhases[0].warn + 1;
  for (let i = 0; i < toShrink * 60; i++) {
    me.state.y = 0.02;
    sim.tick();
  }
  sim.drainEvents();
  assert(porch.stage === STAGE_RIOT && porch.shrinking, `stage ${porch.stage}`);
  assert(porch.next.r < porch.start0.r && porch.zone.r < porch.start0.r, 'safe area shrinking');
  // stand just outside the safe area
  const z = porch.zone;
  const ang = Math.atan2(-z.z, -z.x);
  let x = z.x - Math.cos(ang) * (z.r + 4), zz = z.z - Math.sin(ang) * (z.r + 4);
  if (!sim.nav.isWalkable(x, zz)) {
    const idx = sim.nav.nearestWalkable(x, zz, 20);
    x = sim.nav.cellX(idx);
    zz = sim.nav.cellZ(idx);
  }
  land(me, x, zz);
  me.health = 100;
  const evs = wait(sim, 3, me);
  if ((me.state.x - porch.zone.x) ** 2 + (me.state.z - porch.zone.z) ** 2 > porch.zone.r ** 2) {
    assert(me.state.riot === 1, 'caught in the riot');
    assert(me.health < 100 && of(evs, EV.HIT).some((e) => e[1] === -1), `riot damage (${me.health})`);
  }
  sim.dispose();
});

test('porch duos: no respawns, eliminated players drop their gear, last squad standing wins', async () => {
  const { sim, humans } = await porchSim({ humans: 4, squads: 'duos' });
  sim.tick();
  const [a1, a2, b1, b2] = humans;
  for (const [i, p] of humans.entries()) land(p, -18, 20 + i * 3);
  assert(a1.squad === a2.squad && b1.squad === b2.squad && a1.squad !== b1.squad, 'squads');
  sim.porch!.give(b1, { kind: ITEM.WEAPON, code: 1, count: 30 });
  // friendly fire is off between squad mates
  sim.damage(a2, 0, a1.idx, 1, false, 0, 0);
  let evs: number[][] = [];
  sim.damage(b1, 200, a1.idx, 1, false, 0, 0);
  evs = sim.drainEvents();
  assert(!b1.alive && of(evs, EV.ELIM).length === 1, 'eliminated');
  assert(of(evs, EV.PICKUP_ADD).some((e) => e[2] === ITEM.WEAPON), 'dropped the rifle');
  wait(sim, PLAYER.respawnTime + 1);
  assert(!b1.alive, 'respawned in a battle royale');
  assert(sim.phase === PHASE.PLAYING, 'ended while a squad mate lives');
  sim.damage(b2, 200, a2.idx, 1, false, 0, 0);
  wait(sim, 0.1);
  assert((sim.phase as number) === PHASE.ENDED && sim.winner === a1.squad, `winner ${sim.winner}`);
  const st = sim.standings();
  assert(st.find((r) => r.idx === a1.idx)!.place === 1 && st.find((r) => r.idx === b1.idx)!.place === 2, 'placements');
  assert(st.find((r) => r.idx === a1.idx)!.kills === 1, 'kill credit');
  sim.dispose();
});

test('porch: 20 bots play a whole match to a single winner', async () => {
  const { sim } = await porchSim({ humans: 0, bots: 20, seed: 7 });
  const t0 = performance.now();
  let jumped = 0, opened = 0, kills = 0, landed = 0, riot = 0;
  const limit = 20 * 60 * 60;
  for (let i = 0; i < limit && sim.phase !== PHASE.ENDED; i++) {
    sim.tick();
    for (const e of sim.drainEvents()) {
      if (e[0] === EV.JUMP_OUT) jumped++;
      if (e[0] === EV.BAG_OPEN) opened++;
      if (e[0] === EV.KILL) kills++;
      if (e[0] === EV.TOUCHDOWN) {
        landed++;
        // nobody brings anything down with them: weapons only come from bookbags and drops on the ground
        const ls = sim.players[e[1]]!.state;
        assert(!ls.wA && !ls.wB && !ls.wH && !ls.thr && !(ls.ammoL + ls.ammoM + ls.ammoS + ls.ammoH) && !ls.bandages && !ls.medkits && !ls.drinks, `${sim.players[e[1]]!.name} landed carrying something`);
        // (health can be lower: whoever landed first and found a gun may shoot people still in the air)
        assert(sim.players[e[1]]!.armor === 0, 'landed with no armor');
      }
      if (e[0] === EV.KILL && e[3] === 12) riot++;
    }
  }
  const ms = (performance.now() - t0) / (sim.tickCount || 1);
  const minutes = sim.time / 60000;
  console.log(`       ${minutes.toFixed(1)} min, ${jumped} jumps, ${landed} landings, ${opened} bags searched, ${kills} eliminations (${riot} by the riot); ${ms.toFixed(3)} ms/tick`);
  assert(sim.phase === PHASE.ENDED, 'no winner after 20 minutes');
  assert(jumped === 20 && landed >= 17, `everyone jumped and (nearly everyone) landed: ${landed}`);
  assert(opened > 10, 'bots barely looted');
  assert(sim.winner >= 0, 'draw');
  assert(sim.players.filter((p) => p && p.alive).every((p) => p!.squad === sim.winner), 'winner is the last one standing');
  sim.dispose();
});
