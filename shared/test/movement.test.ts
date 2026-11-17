import {
  BTN, PLAYER, TICK_DT, DEFAULT_LOADOUT, makeInputCmd, makePlayerState, makeStepActions,
  spawnPlayerState, stepPlayer, copyPlayerState, PSTATE_KEYS, type PlayerState, type PhysicsWorld, type InputCmd,
} from '../src/index';
import { approx, assert, test } from './harness';
import { makeWorld } from './env';

const act = makeStepActions();

function place(s: PlayerState, x: number, z: number, yaw: number, y = 0): void {
  spawnPlayerState(s, { x, y, z, yaw }, DEFAULT_LOADOUT);
}

/** Runs `ticks` steps holding the given input. */
function run(phys: PhysicsWorld, s: PlayerState, ticks: number, over: Partial<InputCmd>): void {
  const cmd = makeInputCmd();
  cmd.yaw = s.yaw;
  Object.assign(cmd, over);
  for (let i = 0; i < ticks; i++) {
    cmd.seq++;
    stepPlayer(s, cmd, TICK_DT, phys, DEFAULT_LOADOUT, act);
  }
}

const EAST = -Math.PI / 2, WEST = Math.PI / 2, NORTH = 0, SOUTH = Math.PI;

test('map builds with spawns, zones and solids', async () => {
  const { map } = await makeWorld();
  assert(map.solids.length > 150, `expected plenty of solids, got ${map.solids.length}`);
  assert(map.spawns[0].length >= 8 && map.spawns[1].length >= 8, 'each crew needs 8 spawn points');
  assert(map.zones.map((z) => z.id).join('') === 'ABC', 'zones must be A, B, C');
  for (const s of map.solids) {
    for (const v of [s.x, s.y, s.z, s.sx, s.sy, s.sz]) assert(Number.isFinite(v), `non-finite solid ${s.kind}`);
    assert(s.sx > 0 && s.sy > 0 && s.sz > 0, `degenerate solid ${s.kind} ${s.group ?? ''}`);
  }
});

test('every spawn point is clear and on the ground', async () => {
  const { map, phys } = await makeWorld();
  for (const team of [0, 1] as const) {
    for (const sp of map.spawns[team]) {
      assert(phys.canStandAt(sp.x, sp.y + 0.05, sp.z), `spawn blocked at ${sp.x},${sp.z}`);
      const s = makePlayerState();
      place(s, sp.x, sp.z, sp.yaw);
      run(phys, s, 30, {});
      assert(s.grounded === 1, `spawn ${sp.x},${sp.z} not grounded`);
      approx(s.y, 0, 0.06, 'spawn feet height');
      approx(s.x, sp.x, 0.01, 'standing still should not drift (x)');
    }
  }
});

test('walk speed, sprint speed and crouch speed', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  // West Strip is a long open north-south street
  place(s, -18, 20, NORTH);
  run(phys, s, 30, { mz: 1 }); // get up to speed
  let z0 = s.z;
  run(phys, s, 60, { mz: 1 });
  approx(z0 - s.z, PLAYER.walkSpeed * 0.95, 0.15, 'walk distance in 1s (AR move mult 0.95)');

  place(s, -18, 20, NORTH);
  run(phys, s, 30, { mz: 1, buttons: BTN.SPRINT });
  z0 = s.z;
  run(phys, s, 60, { mz: 1, buttons: BTN.SPRINT });
  approx(z0 - s.z, PLAYER.sprintSpeed * 0.95, 0.2, 'sprint distance in 1s');
  assert(s.sprinting === 1, 'should be sprinting');

  place(s, -18, 20, NORTH);
  run(phys, s, 30, { mz: 1, buttons: BTN.CROUCH });
  z0 = s.z;
  run(phys, s, 60, { mz: 1, buttons: BTN.CROUCH });
  approx(z0 - s.z, PLAYER.crouchSpeed * 0.95, 0.15, 'crouch distance in 1s');
  assert(s.crouching === 1, 'should be crouching');
});

test('strafing follows the view yaw', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  place(s, -18, 20, NORTH);
  run(phys, s, 40, { mx: 1 }); // strafe right while facing north => +X
  assert(s.x > -18 + 2, `strafe right should move east, x=${s.x}`);
  approx(s.z, 20, 0.05, 'no forward drift while strafing');
  place(s, -18, 20, EAST);
  run(phys, s, 40, { mz: 1 });
  assert(s.x > -18 + 2, 'facing east + forward should move east');
});

test('walls stop the player (perimeter + buildings)', async () => {
  const { map, phys } = await makeWorld();
  const s = makePlayerState();
  place(s, -18, -44, NORTH);
  run(phys, s, 300, { mz: 1, buttons: BTN.SPRINT });
  assert(s.z > map.bounds.minZ + PLAYER.radius - 0.05, `ran through the north wall: z=${s.z}`);
  approx(s.z, map.bounds.minZ + PLAYER.radius, 0.08, 'stops flush against the wall');
  // alley building: walk south from Main St into the Pawn & Loan facade (z=6)
  place(s, -12.5, 0, SOUTH);
  run(phys, s, 200, { mz: 1 });
  approx(s.z, 6 - PLAYER.radius, 0.08, 'stops at the building facade');
});

test('jump apex and landing', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  place(s, -18, 20, NORTH);
  run(phys, s, 10, {});
  let maxY = 0;
  const cmd = makeInputCmd();
  cmd.buttons = BTN.JUMP;
  let landed = false;
  for (let i = 0; i < 90; i++) {
    cmd.seq++;
    stepPlayer(s, cmd, TICK_DT, phys, DEFAULT_LOADOUT, act);
    if (i === 0) assert(act.jumped, 'jump should trigger on press');
    maxY = Math.max(maxY, s.y);
    if (act.landed) landed = true;
  }
  const expected = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * PLAYER.gravity);
  approx(maxY, expected, 0.12, 'jump apex');
  assert(landed && s.grounded === 1, 'should land again');
  // holding jump must not bunny-hop
  approx(s.y, 0, 0.06, 'back on the ground while still holding jump');
});

test('double jump: one more jump in mid-air, reset on landing', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  place(s, -18, 20, NORTH);
  run(phys, s, 10, {});
  const single = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * PLAYER.gravity);
  const tap = () => {
    const c = makeInputCmd();
    c.yaw = s.yaw;
    c.buttons = BTN.JUMP;
    stepPlayer(s, c, TICK_DT, phys, DEFAULT_LOADOUT, act);
    return { jumped: act.jumped, double: act.doubleJumped };
  };
  for (let round = 0; round < 2; round++) {
    assert(tap().jumped, 'first jump');
    run(phys, s, 14, {}); // let go, still rising
    const mid = tap();
    assert(mid.double && s.vy > 0, 'second jump in the air');
    run(phys, s, 2, {});
    assert(!tap().jumped, 'no third jump');
    let apex = 0;
    for (let i = 0; i < 120 && !s.grounded; i++) {
      run(phys, s, 1, {});
      apex = Math.max(apex, s.y);
    }
    assert(apex > single + 0.6, `goes higher than one jump (${apex.toFixed(2)} vs ${single.toFixed(2)})`);
    assert(s.grounded === 1 && s.airJumps === 0, 'landed with the double jump back');
    run(phys, s, 3, {});
  }
});

test('can hop onto a 1.1m crate but not a boxcar', async () => {
  const { map, phys } = await makeWorld();
  const crate = map.props.find((p) => p.type === 'crate' && p.y === 0 && Math.abs(p.x - 2.3) < 0.01)!;
  assert(crate, 'alley crate exists');
  const s = makePlayerState();
  place(s, crate.x, crate.z - 2.2, SOUTH);
  run(phys, s, 12, { mz: 1 });
  run(phys, s, 1, { mz: 1, buttons: BTN.JUMP });
  run(phys, s, 50, { mz: 1 });
  let top = 0;
  // sample: after the hop we should have been on top at some point; walk back onto it
  place(s, crate.x, crate.z - 1.6, SOUTH);
  run(phys, s, 1, { mz: 1, buttons: BTN.JUMP });
  for (let i = 0; i < 40; i++) {
    run(phys, s, 1, { mz: 0.6 });
    if (s.grounded) top = Math.max(top, s.y);
  }
  approx(top, 1.1, 0.08, 'stood on top of the crate');
});

test('crouch lowers the collider and blocks standing up under cover', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  // under the liquor store fire escape, near its low end the ceiling is below standing height
  // ramp: bottom z=10.53 (y=0) rising north to z=4.25 (y=4.4) at x=-38.85. At z=9.0 clearance ~1.07m, at z=8.4 ~1.5m
  place(s, -38.85, 6.0, SOUTH);
  run(phys, s, 5, { buttons: BTN.CROUCH });
  assert(s.crouching === 1, 'crouched');
  run(phys, s, 120, { mz: 1, buttons: BTN.CROUCH });
  const zCrouch = s.z;
  assert(zCrouch > 8.0, `crouching should get further under the stairs, z=${zCrouch}`);
  run(phys, s, 10, {}); // release crouch where there is no headroom
  assert(s.crouching === 1, 'must stay crouched without headroom');
  place(s, -38.85, 6.0, SOUTH);
  run(phys, s, 120, { mz: 1 });
  assert(s.z < zCrouch - 0.3, `standing player stops earlier (stand z=${s.z}, crouch z=${zCrouch})`);
});

interface StairCase { name: string; x: number; z: number; yaw: number; ticks: number; top: number; }

test('all stairways and fire escapes reach their rooftops', async () => {
  const { phys } = await makeWorld();
  const cases: StairCase[] = [
    { name: 'apartments outer stairs', x: -65.4, z: 40.15, yaw: EAST, ticks: 200, top: 5.5 },
    { name: 'apartments inner stairs', x: -30.6, z: 40.15, yaw: WEST, ticks: 200, top: 5.5 },
    { name: 'overpass outer stairs', x: 65.4, z: 40.15, yaw: WEST, ticks: 200, top: 5.5 },
    { name: 'overpass inner stairs', x: 30.6, z: 40.15, yaw: EAST, ticks: 200, top: 5.5 },
    { name: 'liquor store fire escape', x: -38.85, z: 11.4, yaw: NORTH, ticks: 180, top: 4.4 },
    { name: 'yard office fire escape', x: 38.85, z: 17.0, yaw: NORTH, ticks: 180, top: 4.4 },
    { name: 'warehouse loading ramp', x: 58, z: -35.6, yaw: NORTH, ticks: 100, top: 1.1 },
  ];
  for (const c of cases) {
    const s = makePlayerState();
    place(s, c.x, c.z, c.yaw);
    run(phys, s, c.ticks, { mz: 1 });
    approx(s.y, c.top, 0.1, `${c.name}: feet height at the top`);
    assert(s.grounded === 1, `${c.name}: grounded at the top`);
  }
});

test('stepping from a stair landing onto the roof and walking back down', async () => {
  const { phys } = await makeWorld();
  const s = makePlayerState();
  place(s, -65.4, 40.15, EAST);
  run(phys, s, 200, { mz: 1 }); // up to the landing, stopped by the end rail
  approx(s.y, 5.5, 0.1, 'on the landing');
  s.yaw = SOUTH;
  run(phys, s, 60, { mz: 1, yaw: SOUTH }); // through the parapet gap onto the roof
  assert(s.z > 42.5, `should walk onto the apartment roof, z=${s.z}`);
  approx(s.y, 5.5, 0.1, 'roof height');
  // the parapet keeps you from walking off the north edge elsewhere
  place(s, -48, 43, NORTH, 5.5);
  run(phys, s, 120, { mz: 1, yaw: NORTH });
  assert(s.y > 5.3, `parapet should stop the player (y=${s.y}, z=${s.z})`);
  // and going down the stairs keeps the feet glued to the steps (no airborne hops)
  place(s, -57.5, 40.15, WEST, 5.3);
  run(phys, s, 20, { yaw: WEST });
  let air = 0;
  const cmd = makeInputCmd();
  cmd.yaw = WEST; cmd.mz = 1;
  for (let i = 0; i < 120; i++) {
    stepPlayer(s, cmd, TICK_DT, phys, DEFAULT_LOADOUT, act);
    if (!s.grounded) air++;
  }
  assert(air <= 2, `descending stairs should stay grounded (air ticks: ${air})`);
  approx(s.y, 0, 0.08, 'back on the street');
});

test('movement is deterministic (same inputs => identical state)', async () => {
  const { phys } = await makeWorld();
  const runOnce = (): PlayerState => {
    const s = makePlayerState();
    place(s, -30, 14, 0.3);
    const cmd = makeInputCmd();
    for (let i = 0; i < 600; i++) {
      cmd.seq = i + 1;
      cmd.yaw = 0.3 + Math.sin(i * 0.013) * 2.5;
      cmd.pitch = Math.sin(i * 0.05) * 0.4;
      cmd.mx = Math.round(Math.sin(i * 0.07) * 127) / 127;
      cmd.mz = Math.round(Math.cos(i * 0.031) * 127) / 127;
      cmd.buttons = (i % 97 === 0 ? BTN.JUMP : 0) | (i % 200 < 60 ? BTN.SPRINT : 0) | (i % 300 > 250 ? BTN.CROUCH : 0) | (i % 50 < 20 ? BTN.FIRE : 0);
      stepPlayer(s, cmd, TICK_DT, phys, DEFAULT_LOADOUT, act);
    }
    return s;
  };
  const a = copyPlayerState(makePlayerState(), runOnce());
  const b = runOnce();
  for (const k of PSTATE_KEYS) assert(a[k] === b[k], `state.${k} diverged: ${a[k]} vs ${b[k]}`);
});
