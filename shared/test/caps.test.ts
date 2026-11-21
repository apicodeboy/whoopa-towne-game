import {
  AIR_GROUND, AIR_SKYDIVE, BTN, CAPS, EV, GameSim, MARK, PLAYER, POOL, Q_BULLET, Q_PROJECTILE, RANCH_FENCE_H, ROUND, TICK_MS,
  makeInputCmd, mapForMode, type InputCmd, type SimPlayer,
} from '../src/index';
import { approx, assert, test } from './harness';
import { initRapier } from './env';

async function porchSim() {
  const R = await initRapier();
  const sim = new GameSim(R, { mode: 'porch', seed: 7, warmup: 0, squads: 'solo' });
  const me = sim.addPlayer({ id: 'me', name: 'Me', team: 0, squad: 0 })!;
  sim.start();
  sim.tick();
  return { sim, me };
}

let seq = 0;
function wait(sim: GameSim, p: SimPlayer, seconds: number, over: Partial<InputCmd> = {}): void {
  for (let i = 0; i < Math.round((seconds * 1000) / TICK_MS); i++) {
    const c = makeInputCmd();
    c.seq = ++seq;
    c.yaw = p.state.yaw;
    c.slot = p.state.slot;
    Object.assign(c, over);
    sim.queueInput(p.idx, c);
    sim.tick();
    sim.drainEvents();
  }
}

function land(p: SimPlayer, x: number, z: number, yaw = 0, y = 0.02): void {
  const s = p.state;
  s.air = AIR_GROUND;
  s.x = x; s.y = y; s.z = z; s.yaw = yaw; s.pitch = 0;
  s.vx = s.vy = s.vz = 0;
  s.grounded = 1;
  p.hCount = 0;
}

/** Walks toward (x, z), steering every tick. */
function walkTo(sim: GameSim, p: SimPlayer, x: number, z: number, tol = 0.4, seconds = 8): boolean {
  for (let i = 0; i < (seconds * 1000) / TICK_MS; i++) {
    const dx = x - p.state.x, dz = z - p.state.z;
    if (Math.hypot(dx, dz) < tol) return true;
    wait(sim, p, TICK_MS / 1000, { yaw: Math.atan2(-dx, -dz), mz: 1 });
  }
  return false;
}

test("Cap's House: the battle royale map is round; the classic map is untouched", async () => {
  const big = mapForMode('porch');
  assert(!!big.round && big.round.r === ROUND.r, 'a round map');
  const r = big.round!;
  for (const l of big.lootSpots ?? []) {
    assert(Math.hypot(l.x - r.x, l.z - r.z) < r.r - 2 && l.z < big.bounds.maxZ, `loot spot inside the circle (${l.x.toFixed(1)}, ${l.z.toFixed(1)})`);
  }
  assert(!big.solids.some((s) => s.kind === 'perimeter'), 'the old square edge walls are gone');
  assert(big.districts?.some((d) => d.name === "CAP'S HOUSE") === true, "CAP'S HOUSE is called out from the blimp");
  assert(!big.districts?.some((d) => d.name === 'WHOOPA TOWNE'), 'the classic town is not in the battle royale map');
  assert(big.doors?.some((d) => Math.abs(d.x) < 26 && d.z > -19 && d.z < 9) === true, 'the barndominium has working doors');
  // the classic map: still the classic town, with its spawns and capture zones
  for (const mode of ['tdm', 'turf'] as const) {
    const m = mapForMode(mode);
    assert(m.id === 'whoopa-towne' && !m.round, `${mode} plays on the classic map`);
    assert(m.spawns[0].length > 0 && m.spawns[1].length > 0, 'both crews have spawns');
    assert(m.zones.map((z) => z.name).join() === 'The Court,Corner Store,Rail Yard', `turf zones unchanged (${m.zones.map((z) => z.name).join()})`);
  }
});

test("Cap's House: the rim stops you at the edge, and skydivers stay over the land", async () => {
  const { sim, me } = await porchSim();
  assert(Math.abs(sim.porch!.start0.r - (ROUND.r + 4)) < 1e-6 && sim.porch!.start0.x === ROUND.x && sim.porch!.start0.z === ROUND.z, 'the first riot circle takes in the whole round map');
  // walk north out of the NORTH FORTY: the rock stops you at the circle
  land(me, 0, -240, 0);
  wait(sim, me, 0.2);
  wait(sim, me, 6, { mz: 1 });
  const d = Math.hypot(me.state.x - ROUND.x, me.state.z - ROUND.z);
  assert(d < ROUND.r + 0.6 && d > ROUND.r - 3, `stopped at the rim (${d.toFixed(2)} from the middle)`);
  // and west, out of the jungle
  land(me, -225, 0, Math.PI / 2);
  wait(sim, me, 0.2);
  wait(sim, me, 6, { mz: 1 });
  const dw = Math.hypot(me.state.x - ROUND.x, me.state.z - ROUND.z);
  assert(dw < ROUND.r + 0.6, `stopped at the rim in the west (${dw.toFixed(2)})`);
  // a skydiver steering out past the edge is held over the land
  const s = me.state;
  s.air = AIR_SKYDIVE;
  s.x = 150; s.y = 160; s.z = -200; s.vx = s.vy = s.vz = 0; s.grounded = 0;
  me.hCount = 0;
  wait(sim, me, 4, { yaw: Math.atan2(-1, 1), mz: 1 }); // steering north-east, out of the circle
  const ds = Math.hypot(s.x - ROUND.x, s.z - ROUND.z);
  assert(ds <= ROUND.r - 1 + 1e-3, `held inside the circle (${ds.toFixed(2)})`);
  sim.dispose();
});

test("Cap's House: drop into the pool, wade to the steps and climb out", async () => {
  const { sim, me } = await porchSim();
  // the deck between the back of the house and the pool, facing the water (north)
  land(me, 0, -22, 0);
  wait(sim, me, 0.2);
  approx(me.state.y, 0, 0.05, 'standing on the deck');
  wait(sim, me, 1.5, { mz: 1 });
  assert(me.state.z < POOL.z1 - 0.5 && me.state.y < POOL.floor + 0.1 && me.state.grounded === 1, `in the pool, on the bottom (y = ${me.state.y.toFixed(2)})`);
  // the walls are too high to just walk out
  wait(sim, me, 1.0, { yaw: Math.PI, mz: 1 });
  assert(me.state.y < POOL.floor + 0.1, 'the side of the pool stops you');
  // up the steps at the east end and out onto the deck
  assert(walkTo(sim, me, 6.5, -32), 'to the foot of the steps');
  assert(walkTo(sim, me, 11.5, -32, 0.5), `up the steps (stuck at ${me.state.x.toFixed(2)}, y ${me.state.y.toFixed(2)})`);
  approx(me.state.y, 0, 0.06, 'out on the deck');
  // the water is only something to look at: bullets cross it like air
  assert(sim.phys.raycast(-8.5, -0.5, -32, 1, 0, 0, 16, Q_BULLET) < 0, 'nothing solid in the water');
  sim.dispose();
});

test("Cap's House: the pens are fenced: you walk into the rails and jump them", async () => {
  const { sim, me } = await porchSim();
  // the horse paddock's east fence (x = -50)
  const top = sim.phys.raycast(-50, 3, -20, 0, -1, 0, 4, Q_PROJECTILE);
  approx(3 - top, RANCH_FENCE_H, 0.02, 'a ranch fence on the line');
  land(me, -47.6, -20, Math.PI / 2); // facing west
  wait(sim, me, 0.2);
  wait(sim, me, 1.5, { mz: 1 });
  assert(me.state.x > -50 + PLAYER.radius - 0.05, `stopped by the fence (x = ${me.state.x.toFixed(2)})`);
  land(me, -47, -20, Math.PI / 2);
  wait(sim, me, 0.2);
  wait(sim, me, 0.35, { mz: 1 });
  wait(sim, me, 1.2, { mz: 1, buttons: BTN.JUMP });
  wait(sim, me, 0.5, { mz: 1 });
  assert(me.state.x < -51 && me.state.grounded === 1, `jumped it (x = ${me.state.x.toFixed(2)})`);
  // the farm sits inside its square, clear of the border roads
  assert(CAPS.x0 > -86 && CAPS.x1 < 86, 'between the Line Roads');
  sim.dispose();
});

test('marking danger: it goes where you look, your squad sees it, nobody else does', async () => {
  const R = await initRapier();
  const sim = new GameSim(R, { mode: 'porch', seed: 11, warmup: 0, squads: 'duos' });
  const me = sim.addPlayer({ id: 'me', name: 'Me', team: 0, squad: 0 })!;
  const mate = sim.addPlayer({ id: 'mate', name: 'Mate', team: 0, squad: 0 })!;
  const other = sim.addPlayer({ id: 'other', name: 'Other', team: 1, squad: 1 })!;
  sim.start();
  sim.tick();
  sim.drainEvents();
  // standing in the yard in front of the barndominium, looking at its front wall (north)
  land(me, 0, 20, 0);
  land(mate, 3, 20, 0);
  land(other, -3, 22, 0);
  const press = (buttons: number, pitch = 0) => {
    const c = makeInputCmd();
    c.seq = ++seq;
    c.yaw = 0;
    c.pitch = pitch;
    c.buttons = buttons;
    c.ox = me.state.x; c.oy = me.state.y + 1.6; c.oz = me.state.z;
    sim.queueInput(me.idx, c);
    sim.tick();
    return sim.drainEvents();
  };
  press(0);
  const ev = press(BTN.MARK);
  const mark = ev.find((e) => e[0] === EV.MARK);
  assert(!!mark && mark[1] === me.idx, 'a MARK event');
  // the porch and the front wall of the house are about 12 m ahead (z = 8 and the porch posts in front)
  const mz = mark![4] / 100;
  assert(mz > 3 && mz < 9, `marked on the house front (z = ${mz.toFixed(2)})`);
  // holding the button does not mark again; pressing again within the cooldown does not either
  assert(!press(BTN.MARK).some((e) => e[0] === EV.MARK), 'held: one mark');
  press(0);
  assert(!press(BTN.MARK).some((e) => e[0] === EV.MARK), 'too soon: no mark');
  for (let i = 0; i < Math.ceil((MARK.cooldown * 1000) / TICK_MS); i++) press(0);
  const again = press(BTN.MARK);
  assert(again.some((e) => e[0] === EV.MARK), 'after the cooldown: marks again');
  // who is sent it
  const sentTo = (p: SimPlayer) => sim.snapshot(p.idx, again).e.some((e) => e[0] === EV.MARK);
  assert(sentTo(me) && sentTo(mate), 'you and your squad mate see it');
  assert(!sentTo(other), 'the other squad is never sent it');
  assert(!sim.snapshot(-1, again).e.some((e) => e[0] === EV.MARK), 'nor is a spectator');
  // looking at the sky: nothing to mark
  for (let i = 0; i < Math.ceil((MARK.cooldown * 1000) / TICK_MS); i++) press(0);
  assert(!press(BTN.MARK, 1.3).some((e) => e[0] === EV.MARK), 'the sky cannot be marked');
  sim.dispose();
});
