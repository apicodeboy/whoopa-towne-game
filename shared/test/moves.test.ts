import {
  BTN, LEDGE, PLAYER, ROLL, TICK_DT, DEFAULT_LOADOUT, MapBuilder, PhysicsWorld, makeInputCmd, makePlayerState, makeStepActions,
  spawnPlayerState, stepPlayer, type InputCmd, type PlayerState,
} from '../src/index';
import { approx, assert, test } from './harness';
import { initRapier } from './env';

/** A flat lot with a 2 m wall (grabbable) and a 4 m wall (too high), both facing south. */
async function lot(): Promise<PhysicsWorld> {
  const R = await initRapier();
  const b = new MapBuilder();
  b.box('ground', -40, 40, -40, 40, -1, 0);
  b.box('wall', -4, 4, -12, -8, 0, 2.0); // top at 2.0, front face at z = -8
  b.box('wall', 10, 18, -12, -8, 0, 4.0); // top at 4.0
  return new PhysicsWorld(R, b.build('moves', 'moves', { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }));
}

const act = makeStepActions();
let seq = 0;
function run(phys: PhysicsWorld, s: PlayerState, ticks: number, over: Partial<InputCmd>, each?: () => void): void {
  const cmd = makeInputCmd();
  cmd.yaw = s.yaw;
  Object.assign(cmd, over);
  for (let i = 0; i < ticks; i++) {
    cmd.seq = ++seq;
    stepPlayer(s, cmd, TICK_DT, phys, DEFAULT_LOADOUT, act);
    each?.();
  }
}

test('ledge grab: jump at a wall with its top in reach, grab it and pull up onto it', async () => {
  const phys = await lot();
  const s = makePlayerState();
  spawnPlayerState(s, { x: 0, y: 0, z: -6.6, yaw: 0 }, DEFAULT_LOADOUT); // facing north (-Z), 1.4 m from the wall
  run(phys, s, 10, {});
  let grabbed = false;
  run(phys, s, 1, { mz: 1, buttons: BTN.JUMP });
  run(phys, s, Math.round(1.6 / TICK_DT), { mz: 1 }, () => (grabbed ||= act.climbed));
  assert(grabbed, 'grabbed the edge');
  approx(s.y, 2.0, 0.08, 'standing on top of the wall');
  assert(s.grounded === 1 && s.z < -8.05, `up and over the edge (z ${s.z.toFixed(2)})`);
});

test('ledge grab: only when close: a 4 m wall is out of reach, and no grab without pushing forward', async () => {
  const phys = await lot();
  const s = makePlayerState();
  spawnPlayerState(s, { x: 14, y: 0, z: -7.4, yaw: 0 }, DEFAULT_LOADOUT);
  run(phys, s, 10, {});
  let grabbed = false;
  run(phys, s, 1, { mz: 1, buttons: BTN.JUMP });
  run(phys, s, Math.round(1.6 / TICK_DT), { mz: 1 }, () => (grabbed ||= act.climbed));
  assert(!grabbed && s.y < 0.1, `no grab on a 4 m wall (y ${s.y.toFixed(2)})`);
  // next to the 2 m wall but just jumping in place
  spawnPlayerState(s, { x: 0, y: 0, z: -7.3, yaw: 0 }, DEFAULT_LOADOUT);
  run(phys, s, 10, {});
  run(phys, s, 1, { buttons: BTN.JUMP });
  run(phys, s, Math.round(1.2 / TICK_DT), {}, () => (grabbed ||= act.climbed));
  assert(!grabbed && s.y < 0.1, 'standing jumps do not grab');
  void LEDGE;
});

test('roll: crouch while sprinting rolls you forward fast and low, no shooting, then back up', async () => {
  const phys = await lot();
  const s = makePlayerState();
  spawnPlayerState(s, { x: -20, y: 0, z: 20, yaw: 0 }, DEFAULT_LOADOUT);
  run(phys, s, 60, { mz: 1, buttons: BTN.SPRINT });
  assert(s.sprinting === 1, 'sprinting');
  const z0 = s.z;
  let rolled = false, shots = 0;
  const startShots = s.shots;
  run(phys, s, 1, { mz: 1, buttons: BTN.SPRINT | BTN.ROLL }, () => (rolled ||= act.rolled));
  assert(rolled && s.rollT > 0 && s.crouching === 1, 'rolling, low');
  run(phys, s, Math.round((ROLL.time - 0.05) / TICK_DT), { mz: 1, buttons: BTN.FIRE });
  shots = s.shots - startShots;
  assert(shots === 0, 'no shooting mid-roll');
  const dist = z0 - s.z;
  assert(dist > ROLL.time * ROLL.endSpeed, `covered ground (${dist.toFixed(2)} m)`);
  run(phys, s, Math.round(0.1 / TICK_DT), { mz: 1 });
  const after = { rollT: s.rollT, crouching: s.crouching as number };
  assert(after.rollT <= 0 && after.crouching === 0, 'stood back up');
  // no rolling from a standstill
  run(phys, s, 60, {});
  run(phys, s, 1, { buttons: BTN.ROLL }, () => (rolled = act.rolled));
  assert(!rolled, 'standing still does not roll');
  void PLAYER;
});
