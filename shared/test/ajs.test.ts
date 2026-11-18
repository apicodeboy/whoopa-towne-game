import { GameSim, PHASE, PLAYER, makeInputCmd, type SimPlayer } from '../src/index';
import { AJS, getGreaterTowne } from '../src/map/greaterTowne';
import { assert, test } from './harness';
import { initRapier } from './env';

test("AJ'S: a walk-in store on Porch St (glass front, doors you walk through, a counter)", () => {
  const map = getGreaterTowne();
  const walls = map.solids.filter((s) => s.group === 'ajs' && s.kind === 'wall');
  assert(walls.length >= 8, `AJ'S has its walls (${walls.length})`);
  assert(map.signs.some((s) => s.text === "AJ'S"), 'the AJ\'S sign is up');
  const glass = map.solids.filter((s) => s.kind === 'glass' && s.col === 'fence');
  assert(glass.length >= 2, 'storefront windows are glass (block walking, not bullets)');
  const counter = map.solids.find((s) => s.kind === 'counter' && Math.abs(s.x - AJS.talk.x) < 4 && s.z < AJS.talk.z && s.z > AJS.npc.z);
  assert(counter, "AJ's counter stands between the customer and AJ");
  const r = AJS.rect;
  for (const p of [AJS.talk, AJS.npc]) assert(p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1, 'AJ and his counter are inside the shop');
  assert(map.labels.some((l) => l.text === "AJ'S"), 'AJ\'S is on the minimap');
});

test("free roam: spawn out front of AJ'S, walk in through the doors, reach AJ at the register", async () => {
  const R = await initRapier();
  const map = getGreaterTowne();
  const d = AJS.door;
  const sim = new GameSim(R, { mode: 'tdm', map, warmup: 0, maxPlayers: 1, seed: 7, roam: { x: d.x, y: 0, z: d.z, yaw: d.yaw } });
  const me: SimPlayer = sim.addPlayer({ id: 'me', name: 'Shopper', team: 0 })!;
  sim.start();
  assert(sim.phase === PHASE.PLAYING, 'no warm-up in free roam');
  assert(Math.hypot(me.state.x - d.x, me.state.z - d.z) < 0.01, 'spawned at the doors');
  let seq = 0;
  const t = AJS.talk;
  for (let i = 0; i < 60 * 6; i++) {
    const c = makeInputCmd();
    c.seq = ++seq;
    c.yaw = 0; // straight in (-Z)
    c.mz = Math.hypot(me.state.x - t.x, me.state.z - t.z) > 0.6 ? 1 : 0;
    c.ox = me.state.x; c.oy = me.state.y + PLAYER.eyeHeight; c.oz = me.state.z;
    sim.queueInput(me.idx, c);
    sim.tick();
  }
  const dist = Math.hypot(me.state.x - t.x, me.state.z - t.z);
  assert(dist <= t.radius, `walked up to the counter (${dist.toFixed(2)} m from the talk spot)`);
  assert(me.state.z > AJS.npc.z + 0.8, 'the counter kept the customer out from behind it');
  assert(sim.timeLeft > 3600, 'no clock in free roam');
  sim.dispose();
});
