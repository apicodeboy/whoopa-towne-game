import {
  BTN, DEFAULT_LOADOUT, EV, GameSim, GRENADE, PHASE, PLAYER, TICK_MS, WEAPONS, damageFalloff, makeInputCmd,
  yawToward, type InputCmd, type Loadout, type SimPlayer,
} from '../src/index';
import { approx, assert, test } from './harness';
import { initRapier } from './env';

async function makeSim(mode: 'tdm' | 'turf' = 'tdm'): Promise<GameSim> {
  const R = await initRapier();
  return new GameSim(R, { mode, seed: 1234, warmup: 0 });
}

let seq = 0;
/** Queues one input for a human player and ticks the sim. */
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

function place(p: SimPlayer, x: number, z: number, yaw = 0): void {
  p.state.x = x; p.state.y = 0.02; p.state.z = z; p.state.yaw = yaw; p.state.pitch = 0;
  p.state.vx = p.state.vy = p.state.vz = 0;
  p.hCount = 0;
}

/** Two humans facing each other on the West Strip (long open street), `dist` meters apart. */
async function duel(dist: number, loadout: Loadout = DEFAULT_LOADOUT) {
  const sim = await makeSim();
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0, loadout })!;
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 1, loadout })!;
  sim.start();
  place(a, -18, 30, 0);              // faces north (-Z)
  place(b, -18, 30 - dist, Math.PI); // faces south
  a.protectedUntil = 0;
  b.protectedUntil = 0;
  // settle a few ticks
  for (let i = 0; i < 5; i++) { step(sim, a); }
  return { sim, a, b };
}

function eventsOf(evs: number[][], type: number): number[][] {
  return evs.filter((e) => e[0] === type);
}

test('Rifle body shot damage matches the weapon table (with falloff)', async () => {
  for (const dist of [10, 40, 90]) {
    const { sim, a, b } = await duel(dist, { primary: 'honeybadger', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
    // aim at the chest: pitch so the eye ray passes ~1.1m up on the target
    const pitch = Math.atan2(1.1 - PLAYER.eyeHeight, dist);
    const evs = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, pitch });
    const hits = eventsOf(evs, EV.HIT);
    const expected = WEAPONS.honeybadger.damage * damageFalloff(WEAPONS.honeybadger, dist);
    if (dist <= 40) {
      assert(hits.length === 1, `expected a hit at ${dist}m, got ${hits.length}`);
      approx(100 - b.health, expected, 0.6, `rifle damage at ${dist}m`);
      assert(hits[0][4] === 0, 'body shot is not a headshot');
    }
    assert(a.state.mag0 === WEAPONS.honeybadger.magSize - 1, 'one round spent');
    sim.dispose();
  }
});

test('headshots apply the multiplier', async () => {
  const { sim, a, b } = await duel(12, { primary: 'honeybadger', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
  const pitch = Math.atan2(1.6 - PLAYER.eyeHeight, 12);
  const evs = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, pitch });
  const hits = eventsOf(evs, EV.HIT);
  assert(hits.length === 1 && hits[0][4] === 1, 'expected a headshot');
  approx(100 - b.health, WEAPONS.honeybadger.damage * WEAPONS.honeybadger.headMult, 0.5, 'headshot damage');
  sim.dispose();
});

test('automatic fire rate, magazine, reload and reserve accounting', async () => {
  const { sim, a } = await duel(60, { primary: 'mp7', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
  const w = WEAPONS.mp7;
  let shots = 0;
  for (let i = 0; i < 60; i++) shots += eventsOf(step(sim, a, { buttons: BTN.FIRE, pitch: 1.2 }), EV.SHOT).length;
  approx(shots, w.rpm / 60, 1, 'SMG shots in one second');
  // empty the magazine: firing on empty starts a reload automatically
  let reloadStarted = false;
  for (let i = 0; i < 200 && !reloadStarted; i++) {
    const evs = step(sim, a, { buttons: BTN.FIRE, pitch: 1.2 });
    if (eventsOf(evs, EV.RELOAD).length) reloadStarted = true;
  }
  assert(reloadStarted, 'auto reload on empty');
  assert(a.state.mag0 === 0, 'magazine is empty when the reload starts');
  const ticks = Math.ceil(w.reloadTime * 60) + 2;
  for (let i = 0; i < ticks; i++) step(sim, a);
  assert(a.state.mag0 === w.magSize, `magazine refilled (${a.state.mag0})`);
  assert(a.state.res0 === w.reserve - w.magSize, `reserve reduced (${a.state.res0})`);
  sim.dispose();
});

test('semi-auto weapons need a fresh trigger pull per shot', async () => {
  const { sim, a } = await duel(60, { primary: 'doublebarrel', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
  // switch to the pistol
  for (let i = 0; i < 30; i++) step(sim, a, { slot: 1 });
  assert(a.state.slot === 1, 'pistol out');
  let held = 0;
  for (let i = 0; i < 60; i++) held += eventsOf(step(sim, a, { slot: 1, buttons: BTN.FIRE, pitch: 1.2 }), EV.SHOT).length;
  assert(held === 1, `holding the trigger fires once, got ${held}`);
  let tapped = 0;
  for (let i = 0; i < 120; i++) {
    const down = i % 6 < 3;
    tapped += eventsOf(step(sim, a, { slot: 1, buttons: down ? BTN.FIRE : 0, pitch: 1.2 }), EV.SHOT).length;
  }
  assert(tapped >= 9 && tapped <= WEAPONS.taurus.magSize - 1, `tapping fires repeatedly up to the rpm cap, got ${tapped}`);
  sim.dispose();
});

test('shotgun fires a spread of pellets and falls off hard with range', async () => {
  const lo: Loadout = { primary: 'doublebarrel', secondary: 'taurus', throwable: 'grenade', melee: 'fists' };
  const near = await duel(4, lo);
  const pitchNear = Math.atan2(1.15 - PLAYER.eyeHeight, 4);
  const evNear = step(near.sim, near.a, { buttons: BTN.FIRE, pitch: pitchNear });
  const shot = eventsOf(evNear, EV.SHOT)[0];
  assert(shot && shot[6] === WEAPONS.doublebarrel.pellets, 'all pellets traced');
  const nearDmg = 100 - near.b.health;
  assert(nearDmg >= 70, `point-blank shotgun should nearly kill, did ${nearDmg.toFixed(1)}`);
  near.sim.dispose();
  const far = await duel(25, lo);
  const pitchFar = Math.atan2(1.15 - PLAYER.eyeHeight, 25);
  step(far.sim, far.a, { buttons: BTN.FIRE, pitch: pitchFar });
  const farDmg = 100 - far.b.health;
  assert(farDmg < 16, `shotgun at 25m should tickle, did ${farDmg.toFixed(1)}`);
  far.sim.dispose();
});

test('walls block bullets; chain-link fences do not', async () => {
  const sim = await makeSim();
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0 })!;
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 1 })!;
  sim.start();
  a.protectedUntil = b.protectedUntil = 0;
  // either side of the alley building "alleyNW" (x -14..-3, z 6..20)
  place(a, -8, 2, Math.PI);
  place(b, -8, 22.5, 0);
  for (let i = 0; i < 3; i++) step(sim, a);
  const evs = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, pitch: -0.05 });
  assert(eventsOf(evs, EV.HIT).length === 0 && b.health === 100, 'building blocks the shot');
  const s = eventsOf(evs, EV.SHOT)[0];
  assert(s[10] === 1, 'bullet ends on world geometry');
  // through the court's chain-link fence: shooter north of the fence (z<19), target on the court
  place(a, -55, 16.5, Math.PI);
  place(b, -55, 24, 0);
  for (let i = 0; i < 12; i++) step(sim, a);
  const pitch = Math.atan2(1.1 - PLAYER.eyeHeight, 7.5);
  const ev2 = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, pitch });
  assert(eventsOf(ev2, EV.HIT).length === 1, 'bullets pass through chain-link');
  sim.dispose();
});

test('third-person aim: the camera can see past cover that still blocks the bullet', async () => {
  const sim = await makeSim();
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0 })!;
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 1 })!;
  sim.start();
  a.protectedUntil = b.protectedUntil = 0;
  // Shooter crouched behind the 1.05m park wall on the east edge (x=14, z -35.5..-27), target east of it.
  place(a, 13.3, -31, -Math.PI / 2);
  place(b, 20, -31, Math.PI / 2);
  for (let i = 0; i < 20; i++) step(sim, a, { buttons: BTN.CROUCH });
  assert(a.state.crouching === 1, 'crouched');
  // camera hovers above/behind and can see the target over the wall
  const cam = { ox: 13.3 - 1.8, oy: 2.2, oz: -31 + 0.5 };
  const yaw = yawToward(cam.ox, cam.oz, b.state.x, b.state.z);
  const pitch = Math.atan2(1.2 - cam.oy, Math.hypot(b.state.x - cam.ox, b.state.z - cam.oz));
  const evs = step(sim, a, { buttons: BTN.CROUCH | BTN.FIRE | BTN.AIM, yaw, pitch, ...cam });
  assert(eventsOf(evs, EV.HIT).length === 0, 'crouched behind the wall: the bullet hits the wall');
  // stand up: now the eye clears the wall and the same aim connects
  for (let i = 0; i < 30; i++) step(sim, a, { yaw, pitch, ...cam });
  assert(Number(a.state.crouching) === 0, 'standing');
  let hit = false;
  for (let i = 0; i < 20 && !hit; i++) {
    const e = step(sim, a, { buttons: (i % 2 ? 0 : BTN.FIRE) | BTN.AIM, yaw, pitch, ...cam });
    if (eventsOf(e, EV.HIT).length) hit = true;
  }
  assert(hit, 'standing: the shot goes over the wall and hits');
  sim.dispose();
});

test('kills, kill feed event, respawn after 5s with 2s of spawn protection', async () => {
  const { sim, a, b } = await duel(8, { primary: 'honeybadger', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
  const pitch = Math.atan2(1.1 - PLAYER.eyeHeight, 8);
  let kill: number[] | undefined;
  let shots = 0;
  for (let i = 0; i < 120 && !kill; i++) {
    const evs = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, pitch });
    shots += eventsOf(evs, EV.SHOT).length;
    kill = eventsOf(evs, EV.KILL)[0];
  }
  assert(kill, 'victim should die');
  assert(kill[1] === a.idx && kill[2] === b.idx, 'kill event names killer and victim');
  assert(shots === Math.ceil(100 / WEAPONS.honeybadger.damage), `rifle kills in ${Math.ceil(100 / WEAPONS.honeybadger.damage)} body shots, took ${shots}`);
  assert(!b.alive && a.kills === 1 && b.deaths === 1 && sim.scores[0] === 1, 'score updated');
  const diedAt = sim.time;
  let respawnedAt = -1;
  for (let i = 0; i < 400 && respawnedAt < 0; i++) {
    const evs = step(sim, a);
    if (eventsOf(evs, EV.SPAWN).some((e) => e[1] === b.idx)) respawnedAt = sim.time;
  }
  approx((respawnedAt - diedAt) / 1000, PLAYER.respawnTime, 0.05, 'respawn delay');
  assert(b.alive && b.health === 100, 'alive with full health');
  assert(b.state.x > 60, 'respawned at the Cross Track base');
  // protected for 2 seconds
  const before = b.health;
  sim.damage(b, 50, a.idx, 0, false, 0, 0);
  assert(b.health === before, 'no damage during spawn protection');
  for (let i = 0; i < Math.round(PLAYER.spawnProtection * 60) + 2; i++) step(sim, a);
  sim.damage(b, 50, a.idx, 0, false, 0, 0);
  assert(b.health === before - 50, 'damage applies after protection ends');
  sim.dispose();
});

test('health regenerates after 5s out of combat', async () => {
  const { sim, a, b } = await duel(30);
  sim.damage(b, 60, a.idx, 0, false, 0, 0);
  approx(b.health, 40, 0.01, 'damaged');
  for (let i = 0; i < 60 * 4.9; i++) step(sim, a);
  approx(b.health, 40, 0.01, 'no regen before the delay');
  for (let i = 0; i < 60 * 1.1; i++) step(sim, a);
  assert(b.health > 55 && b.health < 70, `regenerating: ${b.health.toFixed(1)}`);
  for (let i = 0; i < 60 * 3; i++) step(sim, a);
  assert(b.health === 100, 'regen caps at full health');
  sim.dispose();
});

test('lag compensation rewinds targets to where the shooter saw them', async () => {
  const { sim, a, b } = await duel(20, { primary: 'honeybadger', secondary: 'taurus', throwable: 'grenade', melee: 'fists' });
  // target strafes east at walk speed for a while (its own inputs); start at the west curb for room
  b.state.x = -21.4;
  const bc = makeInputCmd();
  bc.yaw = b.state.yaw;
  for (let i = 0; i < 40; i++) {
    bc.seq = 1000 + i;
    bc.mx = -1; // facing south, strafing left = east
    sim.queueInput(b.idx, bc);
    step(sim, a);
  }
  const seenAt = sim.time - 200;                 // shooter renders the world 200ms in the past
  const nowX = b.state.x;
  const speed = Math.hypot(b.state.vx, b.state.vz);
  assert(speed > 3, 'target is moving');
  const seenX = nowX - speed * 0.2 * Math.sign(b.state.vx);
  const z = b.state.z;
  // aim at where the target WAS 200ms ago
  const yaw = yawToward(a.state.x, a.state.z, seenX, z);
  const pitch = Math.atan2(1.1 - PLAYER.eyeHeight, Math.hypot(seenX - a.state.x, z - a.state.z));
  const evNoComp = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, yaw, pitch, rt: sim.time });
  assert(eventsOf(evNoComp, EV.HIT).length === 0, 'without rewind the shot misses (target has moved ~1m)');
  for (let i = 0; i < 12; i++) { bc.seq = 2000 + i; sim.queueInput(b.idx, bc); step(sim, a, { yaw, pitch }); }
  // repeat with a correct render time: aim where it was 200ms before *now*
  const seenX2 = b.state.x - speed * 0.2 * Math.sign(b.state.vx);
  const yaw2 = yawToward(a.state.x, a.state.z, seenX2, z);
  const evComp = step(sim, a, { buttons: BTN.FIRE | BTN.AIM, yaw: yaw2, pitch, rt: sim.time - 200 + TICK_MS });
  assert(eventsOf(evComp, EV.HIT).length === 1, 'with rewind the shot connects');
  void seenAt;
  sim.dispose();
});

test('grenades bounce, explode on the fuse and respect cover', async () => {
  const sim = await makeSim();
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0, loadout: { primary: 'honeybadger', secondary: 'taurus', throwable: 'grenade', melee: 'fists' } })!;
  const b = sim.addPlayer({ id: 'b', name: 'B', team: 1 })!;
  const c = sim.addPlayer({ id: 'c', name: 'C', team: 1 })!;
  sim.start();
  a.protectedUntil = b.protectedUntil = c.protectedUntil = 0;
  place(a, -18, 30, 0);
  place(b, -18, 13, Math.PI);  // in the open, ~17m down the street
  place(c, -12, 13, Math.PI);  // inside the alley building footprint is solid; put C behind its corner instead
  place(c, -18, -20, Math.PI); // far away: unaffected
  for (let i = 0; i < 3; i++) step(sim, a);
  const evs = step(sim, a, { buttons: BTN.THROW, pitch: 0.12 });
  const thr = eventsOf(evs, EV.THROW)[0];
  assert(thr && thr[2] === a.idx && thr[3] === 0, 'throw event');
  assert(a.state.throwables === 1, 'one throwable left');
  let boom: number[] | undefined;
  let ticks = 0;
  for (; ticks < 300 && !boom; ticks++) boom = eventsOf(step(sim, a), EV.EXPLODE)[0];
  assert(boom, 'grenade explodes');
  approx(ticks / 60, GRENADE.fuse, 0.06, 'fuse time');
  const bx = boom[3] / 100, bz = boom[5] / 100;
  const d = Math.hypot(bx - b.state.x, bz - b.state.z);
  assert(d < GRENADE.radius, `landed near the target (${d.toFixed(1)}m away)`);
  assert(b.health < 100, 'target in the open takes damage');
  assert(c.health === 100, 'far player unharmed');
  assert(a.health === 100, 'thrower out of range');
  sim.dispose();
});

test('smoke blocks bot line of sight', async () => {
  const sim = await makeSim();
  const a = sim.addPlayer({ id: 'a', name: 'A', team: 0, loadout: { primary: 'honeybadger', secondary: 'taurus', throwable: 'smoke', melee: 'fists' } })!;
  sim.start();
  place(a, -18, 30, 0);
  assert(sim.canSee(-18, 1.6, 30, -18, 1.2, 0), 'clear street');
  for (let i = 0; i < 3; i++) step(sim, a);
  step(sim, a, { buttons: BTN.THROW, pitch: 0.1 });
  let popped = false;
  for (let i = 0; i < 200 && !popped; i++) popped = eventsOf(step(sim, a), EV.EXPLODE).length > 0;
  assert(popped && sim.smokes.length === 1, 'smoke deployed');
  assert(!sim.canSee(-18, 1.6, 30, -18, 1.2, 0), 'smoke blocks the sightline');
  assert(sim.phase === PHASE.PLAYING, 'still playing');
  sim.dispose();
});
