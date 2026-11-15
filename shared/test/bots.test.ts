import { EV, GameSim, MODES, PHASE, TICK_MS, type ModeId, type TeamId } from '../src/index';
import { assert, test } from './harness';
import { initRapier } from './env';

async function botMatch(mode: ModeId, seed: number, perTeam = 4): Promise<GameSim> {
  const R = await initRapier();
  const sim = new GameSim(R, { mode, seed, warmup: 0, botDifficulty: 'normal' });
  for (let i = 0; i < perTeam * 2; i++) {
    sim.addPlayer({ id: `bot${i}`, name: `Bot ${i}`, team: (i % 2) as TeamId, isBot: true });
  }
  sim.start();
  return sim;
}

test('nav grid: both bases, all zones and hotspots are connected', async () => {
  const sim = await botMatch('tdm', 1, 1);
  const { nav, map } = sim;
  let walkable = 0;
  for (let i = 0; i < nav.walk.length; i++) walkable += nav.walk[i];
  assert(walkable > nav.walk.length * 0.3, `too few walkable cells: ${walkable}/${nav.walk.length}`);
  const out: number[] = [];
  const blue = map.spawns[0][0], red = map.spawns[1][0];
  const across = nav.findPath(blue.x, blue.z, red.x, red.z, out);
  assert(across > 140, `base-to-base path exists (len ${across.toFixed(1)})`);
  for (const sp of [...map.spawns[0], ...map.spawns[1]]) assert(nav.isWalkable(sp.x, sp.z), `spawn ${sp.x},${sp.z} walkable`);
  for (const h of map.hotspots) {
    const len = nav.findPath(blue.x, blue.z, h.x, h.z, out);
    assert(len >= 0, `hotspot ${h.x},${h.z} reachable`);
  }
  sim.dispose();
});

test('map balance: mirrored routes from each base are within 8% of each other', async () => {
  const sim = await botMatch('turf', 1, 1);
  const { nav, map } = sim;
  const out: number[] = [];
  const avg = (team: TeamId, x: number, z: number): number => {
    let sum = 0;
    for (const sp of map.spawns[team]) sum += nav.findPath(sp.x, sp.z, x, z, out);
    return sum / map.spawns[team].length;
  };
  /** Average walking distance from a crew's spawns to the nearest spot inside a zone (time-to-contest). */
  const toZone = (team: TeamId, zi: number): number => {
    const zn = map.zones[zi];
    let sum = 0;
    for (const sp of map.spawns[team]) {
      let best = Infinity;
      for (let a = 0; a < 16; a++) {
        for (const rr of [0.25, 0.55, 0.85]) {
          const x = zn.x + Math.cos((a / 16) * Math.PI * 2) * zn.radius * rr;
          const z = zn.z + Math.sin((a / 16) * Math.PI * 2) * zn.radius * rr;
          if (!nav.isWalkable(x, z)) continue;
          const len = nav.findPath(sp.x, sp.z, x, z, out);
          if (len >= 0 && len < best) best = len;
        }
      }
      sum += best;
    }
    return sum / map.spawns[team].length;
  };
  const rows: Array<[string, number, number]> = [
    ['home zone   (blue->A / red->C)', toZone(0, 0), toZone(1, 2)],
    ['middle zone (blue->B / red->B)', toZone(0, 1), toZone(1, 1)],
    ['enemy zone  (blue->C / red->A)', toZone(0, 2), toZone(1, 0)],
    ['enemy base  (blue->red / red->blue)', avg(0, map.spawns[1][0].x, map.spawns[1][0].z), avg(1, map.spawns[0][0].x, map.spawns[0][0].z)],
  ];
  const lopsided: string[] = [];
  for (const [name, b, r] of rows) {
    const diff = Math.abs(b - r) / Math.max(b, r);
    console.log(`       ${name}: ${b.toFixed(1)}m vs ${r.toFixed(1)}m (${(diff * 100).toFixed(1)}% apart)`);
    if (diff >= 0.08) lopsided.push(`${name}: ${b.toFixed(1)} vs ${r.toFixed(1)}`);
  }
  assert(lopsided.length === 0, `lopsided routes: ${lopsided.join('; ')}`);
  sim.dispose();
});

test('bots fight a Team Deathmatch: kills happen, nobody gets stuck, sim stays fast', async () => {
  const sim = await botMatch('tdm', 42);
  const start = new Map<number, { x: number; z: number; dist: number }>();
  for (const p of sim.players) if (p) start.set(p.idx, { x: p.state.x, z: p.state.z, dist: 0 });
  let kills = 0, shots = 0, throws = 0;
  const t0 = performance.now();
  const ticks = 60 * 150; // 2.5 minutes
  for (let i = 0; i < ticks && sim.phase === PHASE.PLAYING; i++) {
    sim.tick();
    for (const e of sim.drainEvents()) {
      if (e[0] === EV.KILL) kills++;
      else if (e[0] === EV.SHOT) shots++;
      else if (e[0] === EV.THROW) throws++;
    }
    if (i % 30 === 0) {
      for (const p of sim.players) {
        if (!p) continue;
        const s = start.get(p.idx)!;
        const d = Math.hypot(p.state.x - s.x, p.state.z - s.z);
        if (d < 30) s.dist += d; // ignore respawn teleports
        s.x = p.state.x;
        s.z = p.state.z;
      }
    }
  }
  const ms = performance.now() - t0;
  const perTick = ms / ticks;
  console.log(`       ${kills} kills, ${shots} shots, ${throws} throws in 150s of play; score ${sim.scores.join('-')}; ${perTick.toFixed(3)} ms/tick`);
  assert(kills >= 12, `expected a real firefight, only ${kills} kills`);
  assert(shots > 200, 'bots shoot');
  for (const p of sim.players) {
    if (!p) continue;
    const s = start.get(p.idx)!;
    assert(s.dist > 150, `${p.name} barely moved (${s.dist.toFixed(0)}m): stuck?`);
    assert(p.kills + p.deaths > 0, `${p.name} never got into a fight`);
  }
  assert(sim.scores[0] + sim.scores[1] === kills || sim.scores[0] + sim.scores[1] <= kills, 'team score tracks kills');
  assert(perTick < 2, `sim too slow: ${perTick.toFixed(2)} ms per tick`);
  sim.dispose();
});

test('Team Deathmatch ends at the kill limit and names the winner', async () => {
  const sim = await botMatch('tdm', 7, 1);
  sim.scores[1] = MODES.tdm.scoreLimit - 1;
  const [a, b] = [sim.players[0]!, sim.players[1]!];
  assert(a.team === 0 && b.team === 1, 'teams');
  a.protectedUntil = 0;
  sim.damage(a, 500, b.idx, 0, false, 0, 0);
  sim.tick();
  const evs = sim.drainEvents();
  const phase = evs.find((e) => e[0] === EV.PHASE && e[1] === PHASE.ENDED);
  assert(sim.phase === PHASE.ENDED && phase && phase[2] === 1, 'Cross Track wins at 50');
  assert(sim.winner === 1, 'winner recorded');
  // nobody respawns or takes damage after the match ends
  for (let i = 0; i < 60 * 6; i++) sim.tick();
  assert(!a.alive, 'no respawn after the final whistle');
  sim.dispose();
});

test('Team Deathmatch ends on the 10 minute timer with the higher score winning', async () => {
  const sim = await botMatch('tdm', 9, 1);
  sim.scores[0] = 3;
  sim.scores[1] = 2;
  sim.phaseEndsAt = sim.time + 5 * TICK_MS;
  for (let i = 0; i < 10; i++) sim.tick();
  assert(sim.phase === PHASE.ENDED && sim.winner === 0, 'S-Curve wins on time');
  sim.dispose();
});

test('Turf War: zones get captured, points tick up every 3s per held zone', async () => {
  const R = await initRapier();
  const sim = new GameSim(R, { mode: 'turf', seed: 5, warmup: 0 });
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0 })!;
  sim.start();
  const zoneA = sim.map.zones[0];
  a.state.x = zoneA.x + 1; a.state.z = zoneA.z + 1; a.state.y = 0.02;
  let captured: number[] | undefined;
  let ticks = 0;
  for (; ticks < 600 && !captured; ticks++) {
    sim.tick();
    captured = sim.drainEvents().find((e) => e[0] === EV.ZONE);
  }
  assert(captured && captured[1] === 0 && captured[2] === 0, 'zone A captured by S-Curve');
  assert(Math.abs(ticks / 60 - 6) < 0.2, `solo capture takes ~6s (took ${(ticks / 60).toFixed(2)}s)`);
  assert(sim.zones[0].owner === 0 && a.score === 1, 'ownership + capture credit');
  const before = sim.scores[0];
  for (let i = 0; i < 60 * 9; i++) sim.tick();
  const gained = sim.scores[0] - before;
  assert(gained === 3, `one zone pays 1 point per 3s: gained ${gained} in 9s`);
  // an enemy standing in the zone contests it (no progress either way)
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 1 })!;
  b.state.x = zoneA.x - 1; b.state.z = zoneA.z - 1; b.state.y = 0.02;
  for (let i = 0; i < 120; i++) sim.tick();
  assert(sim.zones[0].contested && sim.zones[0].owner === 0 && sim.zones[0].progress === 0, 'contested zone holds');
  // owner leaves: the enemy flips it
  a.state.x = -70; a.state.z = 0;
  let flipped = false;
  for (let i = 0; i < 600 && !flipped; i++) {
    sim.tick();
    flipped = sim.drainEvents().some((e) => e[0] === EV.ZONE && e[2] === 1);
  }
  assert(flipped && Number(sim.zones[0].owner) === 1, 'Cross Track takes the zone');
  // rooftops above the zone do not count
  sim.zones[0].owner = -1;
  for (let i = 0; i < 300; i++) {
    b.state.y = 5.5;
    b.state.vy = 0;
    sim.tick();
  }
  assert(sim.zones[0].owner === -1 && sim.zones[0].progress === 0, 'no capturing from above');
  sim.dispose();
});

test('bots play Turf War to a result', async () => {
  const sim = await botMatch('turf', 11);
  let zoneFlips = 0, kills = 0;
  let ticks = 0;
  const maxTicks = 60 * (MODES.turf.timeLimit + 5);
  for (; ticks < maxTicks && sim.phase === PHASE.PLAYING; ticks++) {
    sim.tick();
    for (const e of sim.drainEvents()) {
      if (e[0] === EV.ZONE) zoneFlips++;
      else if (e[0] === EV.KILL) kills++;
    }
  }
  console.log(`       ended after ${(ticks / 60).toFixed(0)}s: ${sim.scores.join('-')}, ${zoneFlips} zone flips, ${kills} kills, winner ${sim.winner}`);
  assert(sim.phase === PHASE.ENDED, 'match reached a result');
  assert(zoneFlips >= 3, `zones should change hands (${zoneFlips} flips)`);
  assert(Math.max(...sim.scores) === MODES.turf.scoreLimit || ticks >= 60 * MODES.turf.timeLimit, `ended by score or time (${sim.scores.join('-')})`);
  sim.dispose();
});
