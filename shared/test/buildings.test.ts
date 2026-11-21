import {
  BTN, Buildings, EV, GameSim, Lot, MapBuilder, PhysicsWorld, PLAYER, TICK_DT, WIN_BROKEN, WIN_CLOSED, WIN_OPEN, construct, encodeInput,
  decodeInputs, makeInputCmd, type BuildingType, type InputCmd, type MapDef, type SimPlayer, type Side,
} from '../src/index';
import { approx, assert, test } from './harness';
import { initRapier } from './env';

// ------------------------------------------------------------------ fixtures
/** A flat lot with one building (front toward +z when facing south), and room around it. */
function lotMap(type: BuildingType, w: number, d: number, floors?: number, facing: Side = 's'): MapDef {
  const b = new MapBuilder();
  const far = Math.max(40, w + 20, d + 20);
  b.box('ground', -30, far, -30, far, -1, 0);
  construct(b, { id: 'bld', type, x0: 0, x1: w, z0: 0, z1: d, facing, floors, seed: 3 });
  b.spawn(0, 0, 20, 0);
  b.spawn(1, 0, 20, 0);
  return b.build('lot', 'lot', { minX: -30, maxX: far, minZ: -30, maxZ: far });
}

/** The reference house: 10 × 8.8, two floors, its front door on the south side (z = 8.8). */
const HOUSE = { w: 10, d: 8.8 };
const lot = new Lot(0, HOUSE.w, 0, HOUSE.d, 's');
const hallU = HOUSE.w - 2.5;
const doorX = HOUSE.w - 0.25 - 0.55;

async function houseSim(): Promise<GameSim> {
  const R = await initRapier();
  return new GameSim(R, { mode: 'tdm', seed: 1, warmup: 0, map: lotMap('house2', HOUSE.w, HOUSE.d), roam: { x: doorX, y: 0, z: 12, yaw: 0 } });
}

let seq = 0;
/** Runs one human player for `ticks` ticks with this input (buttons held the whole time). */
function drive(sim: GameSim, p: SimPlayer, ticks: number, over: Partial<InputCmd>, each?: () => boolean | void): void {
  for (let i = 0; i < ticks; i++) {
    const cmd = makeInputCmd();
    cmd.yaw = p.state.yaw;
    Object.assign(cmd, over);
    cmd.seq = ++seq;
    sim.queueInput(p.idx, cmd);
    sim.tick();
    if (each?.()) return;
  }
}

/** Walks toward (x, z), steering each tick, until within `tol` or out of time. Returns true if it got there. */
function walkTo(sim: GameSim, p: SimPlayer, x: number, z: number, tol = 0.35, maxTicks = 600): boolean {
  for (let i = 0; i < maxTicks; i++) {
    const s = p.state;
    const dx = x - s.x, dz = z - s.z;
    if (Math.hypot(dx, dz) < tol) return true;
    // forward is (-sin yaw, -cos yaw)
    drive(sim, p, 1, { yaw: Math.atan2(-dx, -dz), mz: 1 });
  }
  return false;
}

const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const isOpen = (sim: GameSim, i: number): number => sim.buildings.open[i];
const isLocked = (sim: GameSim, i: number): number => sim.buildings.locked[i];
const winState = (sim: GameSim, i: number): number => sim.buildings.win[i];

/** Events since the last call. */
function events(sim: GameSim): number[][] {
  return sim.drainEvents();
}

function spawnHuman(sim: GameSim, name = 'me'): SimPlayer {
  const p = sim.addPlayer({ id: name, name, team: 0 })!;
  if (!sim.started) sim.start();
  sim.tick();
  return p;
}

const doorAt = (sim: GameSim, x: number, z: number, y = 0): number => {
  const ds = sim.buildings.doors;
  let best = -1, bd = Infinity;
  ds.forEach((d, i) => {
    if (Math.abs(d.y - y) > 0.1) return;
    const cx = d.x + Math.sin(d.a) * d.w / 2, cz = d.z + Math.cos(d.a) * d.w / 2;
    const dd = Math.hypot(cx - x, cz - z);
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
};

// ------------------------------------------------------------------ structure (every type)
const TYPES: Array<{ type: BuildingType; w: number; d: number; floors?: number }> = [
  { type: 'house2', w: 10, d: 8.8 }, { type: 'house2', w: 6.6, d: 8.8 }, { type: 'house1', w: 8.5, d: 8.8 }, { type: 'house1', w: 6.6, d: 8.8 },
  { type: 'apartment', w: 12, d: 12, floors: 3 }, { type: 'apartment', w: 10, d: 10, floors: 6 }, { type: 'apartment', w: 9.25, d: 11, floors: 4 },
  { type: 'tenement', w: 11, d: 11, floors: 4 },
  { type: 'store', w: 14, d: 11 }, { type: 'barbershop', w: 9, d: 10 }, { type: 'laundromat', w: 12, d: 10 },
  { type: 'restaurant', w: 12, d: 12, floors: 2 }, { type: 'office', w: 16, d: 14, floors: 3 }, { type: 'warehouse', w: 18, d: 16 }, { type: 'garage', w: 10, d: 10 },
  { type: 'workshop', w: 14, d: 12 }, { type: 'storage', w: 17, d: 14 },
  { type: 'townhouse', w: 8, d: 8.8 }, { type: 'duplex', w: 14, d: 8.8 },
  // CAP'S HOUSE: the barndominium and the barns
  { type: 'barndo', w: 50, d: 26 }, { type: 'barn', w: 16, d: 18 }, { type: 'barn', w: 18, d: 16 },
];

test('buildings: on every floor of every type, every room can be walked to (doors open)', async () => {
  const R = await initRapier();
  for (const t of TYPES) {
    const map = lotMap(t.type, t.w, t.d, t.floors);
    // no Buildings on this world: doors and windows have no collision (all open)
    const phys = new PhysicsWorld(R, map);
    const story = t.type === 'office' ? 3.4 : t.type === 'warehouse' ? 6.4 : t.type === 'garage' || t.type === 'workshop' || t.type === 'storage' || t.type === 'barndo' ? 4.4 : t.type === 'barn' ? 6.2 : 3.2;
    const nf = t.type === 'house2' || t.type === 'townhouse' || t.type === 'duplex' || t.type === 'barndo' ? 2 : t.floors ?? 1;
    const step = 0.1;
    for (let f = 0; f < nf; f++) {
      const y = f * story;
      const nx = Math.round((t.w - 0.5) / step), nz = Math.round((t.d - 0.5) / step);
      const ok = new Uint8Array(nx * nz);
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        const x = 0.25 + (i + 0.5) * step, z = 0.25 + (k + 0.5) * step;
        const down = phys.raycast(x, y + 0.3, z, 0, -1, 0, 0.45, 0x0001ffff);
        if (down < 0 || Math.abs(y + 0.3 - down - y) > 0.06) continue;
        if (phys.canStandAt(x, y + 0.01, z)) ok[i * nz + k] = 1;
      }
      // connected pieces of floor
      const comp = new Int32Array(nx * nz).fill(-1);
      const sizes: number[] = [];
      for (let c = 0; c < ok.length; c++) {
        if (!ok[c] || comp[c] >= 0) continue;
        const id = sizes.length;
        let n = 0;
        const stack = [c];
        comp[c] = id;
        while (stack.length) {
          const q = stack.pop()!;
          n++;
          const i = Math.floor(q / nz), k = q % nz;
          for (const [a, b2] of [[i + 1, k], [i - 1, k], [i, k + 1], [i, k - 1]]) {
            if (a < 0 || b2 < 0 || a >= nx || b2 >= nz) continue;
            const r = a * nz + b2;
            if (ok[r] && comp[r] < 0) {
              comp[r] = id;
              stack.push(r);
            }
          }
        }
        sizes.push(n);
      }
      // anything bigger than a spot behind a piece of furniture (0.5 m²) must be the one piece
      const big = sizes.filter((n) => n * step * step > 0.5).sort((a, b) => b - a);
      // (a duplex is two homes: two separate areas)
      const want = t.type === 'duplex' ? 2 : 1;
      assert(big.length === want, `${t.type} ${t.w}x${t.d} floor ${f}: ${big.length} separate areas (${big.map((n) => (n * step * step).toFixed(1)).join(', ')} m²)`);
    }
    phys.dispose();
  }
});

test('buildings: furniture stays clear of walls and of every doorway', async () => {
  for (const t of TYPES) {
    const map = lotMap(t.type, t.w, t.d, t.floors);
    const furn = map.solids.filter((s) => s.kind === 'furn' && s.col !== 'none');
    const walls = map.solids.filter((s) => s.kind === 'wall' && s.group === 'bld');
    const corners = (s: { x: number; z: number; sx: number; sz: number; ry?: number }, shrink = 0.02) => {
      const c = Math.cos(s.ry ?? 0), sn = Math.sin(s.ry ?? 0), hx = s.sx / 2 - shrink, hz = s.sz / 2 - shrink;
      return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => [s.x + a * c + b * sn, s.z - a * sn + b * c]);
    };
    const inBox = (px: number, pz: number, s: { x: number; z: number; sx: number; sz: number; ry?: number }) => {
      const c = Math.cos(s.ry ?? 0), sn = Math.sin(s.ry ?? 0);
      const dx = px - s.x, dz = pz - s.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      return Math.abs(lx) <= s.sx / 2 && Math.abs(lz) <= s.sz / 2;
    };
    for (const f of furn) {
      const fy0 = f.y - f.sy / 2, fy1 = f.y + f.sy / 2;
      for (const w of walls) {
        if (w.y + w.sy / 2 <= fy0 + 0.01 || w.y - w.sy / 2 >= fy1 - 0.01) continue;
        const hit = corners(f).some(([x, z]) => inBox(x, z, w)) || corners(w).some(([x, z]) => inBox(x, z, { ...f, sx: f.sx - 0.04, sz: f.sz - 0.04 }));
        assert(!hit, `${t.type}: ${f.meta?.t} at ${f.x.toFixed(2)},${f.z.toFixed(2)} is in a wall`);
      }
      // a doorway: the 1 m in front of and behind each door
      for (const d of map.doors ?? []) {
        if (Math.abs(d.y - fy0) > 0.1) continue;
        const along = { x: d.x + Math.sin(d.a) * d.w / 2, z: d.z + Math.cos(d.a) * d.w / 2, sx: 1.6, sz: d.w - 0.1, ry: d.a };
        const hit = corners(f, 0.05).some(([x, z]) => inBox(x, z, along)) || corners(along).some(([x, z]) => inBox(x, z, f));
        assert(!hit, `${t.type}: ${f.meta?.t} at ${f.x.toFixed(2)},${f.z.toFixed(2)} blocks a door`);
      }
    }
  }
});

// ------------------------------------------------------------------ the reference house
test('house: a closed front door stops you; USE opens it (swinging in) and you walk inside', async () => {
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const d = doorAt(sim, doorX, HOUSE.d);
  assert(d >= 0 && isOpen(sim, d) === 0, 'front door starts closed');
  drive(sim, me, 90, { mz: 1 });
  assert(me.state.z > HOUSE.d + 0.2, `stopped by the closed door (z ${me.state.z.toFixed(2)})`);
  drive(sim, me, 1, { buttons: BTN.USE });
  const ev = events(sim);
  assert(ev.some((e) => e[0] === EV.DOOR && e[1] === d && (e[2] & 1) === 1 && e[3] === me.idx), 'a DOOR event says it opened');
  assert(isOpen(sim, d) === 1, 'open');
  // it swings away from you, into the hall
  assert(sim.buildings.swing[d] === -sim.buildings.doorSide(d, me.state.x, me.state.z), 'swings away from the opener');
  drive(sim, me, 2, {});
  drive(sim, me, 60, { mz: 1 });
  assert(me.state.z < HOUSE.d - 1, `walked in (z ${me.state.z.toFixed(2)})`);
  sim.dispose();
});

test('house: up the stairs to the bedrooms and back down; walls and glass stop you', async () => {
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const d = doorAt(sim, doorX, HOUSE.d);
  sim.bld.b.setDoor(d, true, false, 1);
  // in, to the foot of the stairs (u 8.75..9.75 from v 1.5 up toward the back)
  const [sx, sz] = lot.pt(HOUSE.w - 0.25 - 0.5, 1.0);
  assert(walkTo(sim, me, doorX, HOUSE.d + 0.6) && walkTo(sim, me, doorX, HOUSE.d - 0.6), 'in the front door');
  assert(walkTo(sim, me, sx, sz), `reached the foot of the stairs (at ${me.state.x.toFixed(2)},${me.state.z.toFixed(2)})`);
  const [tx, tz] = lot.pt(HOUSE.w - 0.25 - 0.5, 6.4);
  assert(walkTo(sim, me, tx, tz, 0.35, 300), `climbed the stairs (at ${me.state.x.toFixed(2)},${me.state.y.toFixed(2)},${me.state.z.toFixed(2)})`);
  approx(me.state.y, 3.2, 0.06, 'upstairs');
  // into the back bedroom through its door (open it first if it is shut)
  const [bx, bz] = lot.pt(hallU + 0.6, HOUSE.d - 0.25 - 0.75);
  assert(walkTo(sim, me, bx, bz), 'at the back bedroom door');
  const bd = doorAt(sim, ...lot.pt(hallU, HOUSE.d - 0.25 - 0.75), 3.2);
  assert(bd >= 0, 'found the bedroom door');
  if (!isOpen(sim, bd)) {
    drive(sim, me, 1, { yaw: yawTo(-1, 0), buttons: BTN.USE });
    drive(sim, me, 1, {});
  }
  assert(isOpen(sim, bd) === 1, 'bedroom door open');
  const [rx, rz] = lot.pt(3.5, HOUSE.d - 1.6);
  assert(walkTo(sim, me, rx, rz), `in the back bedroom (at ${me.state.x.toFixed(2)},${me.state.z.toFixed(2)})`);
  approx(me.state.y, 3.2, 0.06, 'still upstairs');
  // the outside wall stops you
  drive(sim, me, 60, { yaw: yawTo(0, -1), mz: 1 });
  assert(me.state.z > 0.25, `the back wall held (z ${me.state.z.toFixed(2)})`);
  // the closed back window stops you too
  const [wx, wz] = lot.pt(Math.max(1.5, (0.25 + hallU) / 2), HOUSE.d - 1.2);
  walkTo(sim, me, wx, wz);
  drive(sim, me, 60, { yaw: yawTo(0, -1), mz: 1 });
  assert(me.state.z > 0.2, `the glass held (z ${me.state.z.toFixed(2)})`);
  // and back down the stairs to the front door
  assert(walkTo(sim, me, ...lot.pt(hallU + 0.6, HOUSE.d - 1.0)), 'back on the landing');
  assert(walkTo(sim, me, tx, tz), 'top of the stairs');
  assert(walkTo(sim, me, sx, sz, 0.35, 300), 'down the stairs');
  approx(me.state.y, 0, 0.06, 'downstairs');
  sim.dispose();
});

test('house: lock the front door from inside (hold USE); outside it only rattles; a tap inside unlocks and opens it', async () => {
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const d = doorAt(sim, doorX, HOUSE.d);
  // stand inside facing the door
  me.state.x = doorX; me.state.z = HOUSE.d - 1.0;
  drive(sim, me, 5, { yaw: yawTo(0, 1) });
  drive(sim, me, Math.ceil(0.7 / TICK_DT), { yaw: yawTo(0, 1), buttons: BTN.USE });
  assert(isLocked(sim, d) === 1 && isOpen(sim, d) === 0, 'held USE locked it (and it stayed shut)');
  drive(sim, me, 2, {});
  // outside: a press only rattles it
  me.state.x = doorX; me.state.z = HOUSE.d + 1.0;
  drive(sim, me, 2, { yaw: yawTo(0, -1) });
  drive(sim, me, 1, { yaw: yawTo(0, -1), buttons: BTN.USE });
  assert(events(sim).some((e) => e[0] === EV.DENIED && e[1] === d), 'DENIED from outside');
  assert(isOpen(sim, d) === 0 && isLocked(sim, d) === 1, 'still shut and locked');
  drive(sim, me, 2, {});
  // inside again: a tap unlocks and opens it
  me.state.x = doorX; me.state.z = HOUSE.d - 1.0;
  drive(sim, me, 2, { yaw: yawTo(0, 1) });
  drive(sim, me, 2, { yaw: yawTo(0, 1), buttons: BTN.USE });
  drive(sim, me, 1, { yaw: yawTo(0, 1) });
  assert(isOpen(sim, d) === 1 && isLocked(sim, d) === 0, 'a tap from inside unlocked and opened it');
  sim.dispose();
});

test('house: a door will not close on someone standing in the doorway', async () => {
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const other = spawnHuman(sim, 'other');
  const d = doorAt(sim, doorX, HOUSE.d);
  sim.bld.b.setDoor(d, true, false, -1);
  other.state.x = doorX; other.state.z = HOUSE.d - 0.12;
  me.state.x = doorX; me.state.z = HOUSE.d + 1.0;
  drive(sim, me, 2, { yaw: yawTo(0, -1) });
  drive(sim, me, 1, { yaw: yawTo(0, -1), buttons: BTN.USE });
  assert(isOpen(sim, d) === 1, 'stayed open');
  sim.dispose();
});

test('house: open a window from inside and climb out through it; shooting breaks glass', async () => {
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const d = doorAt(sim, doorX, HOUSE.d);
  sim.bld.b.setDoor(d, true, false, 1);
  // the living room's side window (left wall, x = 0)
  const split = Math.round(HOUSE.d * 0.52 * 10) / 10;
  const [wx, wz] = lot.pt(0, split * 0.5);
  const wi = sim.buildings.windows.findIndex((w) => Math.abs(w.x - 0.125) < 0.2 && Math.abs(w.z - wz) < 0.2 && w.y < 1.5);
  assert(wi >= 0, 'found the window');
  me.state.x = 1.0; me.state.z = wz;
  drive(sim, me, 3, { yaw: yawTo(-1, 0) });
  // closed: jumping at it does nothing
  drive(sim, me, 1, { yaw: yawTo(-1, 0), mz: 1, buttons: BTN.JUMP });
  drive(sim, me, 40, { yaw: yawTo(-1, 0), mz: 1 });
  assert(me.state.x > 0.25, `the closed window held (x ${me.state.x.toFixed(2)})`);
  drive(sim, me, 1, { yaw: yawTo(-1, 0), buttons: BTN.USE });
  assert(winState(sim, wi) === WIN_OPEN, 'USE opened it');
  assert(events(sim).some((e) => e[0] === EV.WINDOW && e[1] === wi && e[2] === WIN_OPEN), 'a WINDOW event');
  drive(sim, me, 2, { yaw: yawTo(-1, 0) });
  let climbed = false;
  drive(sim, me, 1, { yaw: yawTo(-1, 0), mz: 1, buttons: BTN.JUMP });
  drive(sim, me, Math.ceil(0.8 / TICK_DT), { yaw: yawTo(-1, 0), mz: 1 }, () => {
    climbed ||= me.state.climbT > 0;
  });
  assert(climbed || me.state.x < 0, 'vaulted');
  assert(me.state.x < -0.3, `out through the window (x ${me.state.x.toFixed(2)})`);
  approx(me.state.y, 0, 0.08, 'on the ground outside');
  void wx;
  // shoot the front window from the street: it breaks
  const fw = sim.buildings.windows.findIndex((w) => Math.abs(w.z - (HOUSE.d - 0.125)) < 0.2 && w.y < 1.5);
  assert(fw >= 0 && winState(sim, fw) === WIN_CLOSED, 'front window intact');
  const f = sim.buildings.windows[fw];
  me.state.x = f.x; me.state.z = HOUSE.d + 4;
  drive(sim, me, 5, { yaw: yawTo(0, -1), pitch: -0.03 });
  drive(sim, me, 20, { yaw: yawTo(0, -1), pitch: -0.03, buttons: BTN.FIRE });
  assert(winState(sim, fw) === WIN_BROKEN, 'the shot broke it');
  // broken glass can't be closed again, and you can climb in through it
  drive(sim, me, 2, {});
  sim.dispose();
});

test('buildings: a bot walking into a closed door opens it', async () => {
  const sim = await houseSim();
  spawnHuman(sim);
  const bot = sim.addPlayer({ id: 'b', name: 'Bot', team: 1, isBot: true })!;
  sim.tick();
  const d = doorAt(sim, doorX, HOUSE.d);
  assert(!isOpen(sim, d), 'closed');
  bot.state.x = doorX; bot.state.z = HOUSE.d + 0.9; bot.state.y = 0;
  const cmd = makeInputCmd();
  cmd.yaw = 0;
  cmd.mz = 1;
  sim.bld.botAssist(bot.idx, cmd);
  assert(isOpen(sim, d) === 1, 'the bot opened it');
  sim.dispose();
});

test('buildings: a client copy fed the events (or the join state) matches the server, collision included', async () => {
  const R = await initRapier();
  const sim = await houseSim();
  const me = spawnHuman(sim);
  const map = sim.map;
  const clientPhys = new PhysicsWorld(R, map);
  const client = new Buildings(map, clientPhys);
  const d = doorAt(sim, doorX, HOUSE.d);
  me.state.x = doorX; me.state.z = HOUSE.d + 1;
  drive(sim, me, 2, { yaw: yawTo(0, -1) });
  drive(sim, me, 1, { yaw: yawTo(0, -1), buttons: BTN.USE });
  for (const e of events(sim)) client.applyEvent(e);
  assert(client.open[d] === 1, 'client sees it open');
  // the doorway is walkable on the client's world too
  assert(clientPhys.canStandAt(doorX, 0, HOUSE.d - 0.42), 'client collision: open doorway');
  sim.bld.breakWindow(0, me.idx);
  for (const e of events(sim)) client.applyEvent(e);
  assert(client.win[0] === WIN_BROKEN, 'client sees the broken window');
  // someone joining late gets the whole state
  const late = new Buildings(map, new PhysicsWorld(R, map));
  late.decode(sim.buildings.encode());
  assert(late.encode().join() === sim.buildings.encode().join(), 'join state round-trips');
  // and a closed door is solid for them
  sim.bld.b.setDoor(d, false, false, 1);
  const late2Phys = new PhysicsWorld(R, map);
  const late2 = new Buildings(map, late2Phys);
  late2.decode(sim.buildings.encode());
  assert(!late2Phys.canStandAt(doorX, 0, HOUSE.d - 0.42), 'client collision: closed door');
  sim.dispose();
});

// ------------------------------------------------------------------ apartments: lobby to roof
test('apartments: from the lobby up every flight to the roof, out through the bulkhead door', async () => {
  const R = await initRapier();
  const W = 12, D = 12, F = 3;
  const sim = new GameSim(R, { mode: 'tdm', seed: 1, warmup: 0, map: lotMap('apartment', W, D, F), roam: { x: W - 2.0, y: 0, z: D + 3, yaw: 0 } });
  const me = spawnHuman(sim);
  const L = new Lot(0, W, 0, D, 's');
  const front = doorAt(sim, ...L.pt(W - 0.25 - 3.0 + 0.95, 0));
  sim.bld.b.setDoor(front, true, false, 1);
  const su = W - 0.25 - 1.2, lv = 0.25 + 1.3, run = 4.0;
  const mid = su + 0.6, corridor = (W - 0.25 - 3.0 + su) / 2;
  const doorU = W - 0.25 - 3.0 + 0.95;
  assert(walkTo(sim, me, ...L.pt(doorU, -0.6)) && walkTo(sim, me, ...L.pt(doorU, 0.8)), 'in the front door');
  for (let f = 0; f < F; f++) {
    assert(walkTo(sim, me, ...L.pt(mid, lv - 0.5)), `floor ${f}: at the foot of the flight (${me.state.x.toFixed(2)},${me.state.y.toFixed(2)},${me.state.z.toFixed(2)})`);
    assert(walkTo(sim, me, ...L.pt(mid, lv + run + 0.6), 0.35, 300), `floor ${f}: up the flight (${me.state.x.toFixed(2)},${me.state.y.toFixed(2)},${me.state.z.toFixed(2)})`);
    approx(me.state.y, (f + 1) * 3.2, 0.08, `arrived on floor ${f + 1}`);
    if (f < F - 1) {
      // back along the hall beside the stairwell to the next flight
      assert(walkTo(sim, me, ...L.pt(corridor, lv + run + 0.6)), 'into the hall');
      assert(walkTo(sim, me, ...L.pt(corridor, lv - 0.6)), 'along the hall');
    }
  }
  // the roof door in the bulkhead
  const rd = sim.buildings.doors.findIndex((d) => Math.abs(d.y - F * 3.2) < 0.1);
  assert(rd >= 0, 'bulkhead door exists');
  const rdd = sim.buildings.doors[rd];
  const cx = rdd.x + Math.sin(rdd.a) * rdd.w / 2, cz = rdd.z + Math.cos(rdd.a) * rdd.w / 2;
  assert(walkTo(sim, me, cx + 0.7, cz), `next to the roof door (${me.state.x.toFixed(2)},${me.state.z.toFixed(2)})`);
  drive(sim, me, 1, { yaw: yawTo(-1, 0), buttons: BTN.USE });
  drive(sim, me, 1, {});
  assert(isOpen(sim, rd) === 1, 'roof door open');
  assert(walkTo(sim, me, ...L.pt(3, 3)), `out on the roof (${me.state.x.toFixed(2)},${me.state.y.toFixed(2)},${me.state.z.toFixed(2)})`);
  approx(me.state.y, F * 3.2, 0.08, 'on the roof');
  sim.dispose();
});

test('input: unknown button bits are dropped, roll survives the wire', () => {
  const c = makeInputCmd();
  c.buttons = BTN.ROLL | BTN.SPRINT;
  const out = decodeInputs(encodeInput(c, []));
  assert(out[0].buttons === (BTN.ROLL | BTN.SPRINT), `roll + sprint arrive as sent (${out[0].buttons})`);
  const raw = encodeInput(c, []);
  raw[5] = 1 << 20 | BTN.JUMP;
  assert(decodeInputs(raw)[0].buttons === BTN.JUMP, 'junk bits dropped');
  // the healing item picked on the wheel travels too, and nothing out of range gets through
  c.heal = 4;
  assert(decodeInputs(encodeInput(c, []))[0].heal === 4, 'heal choice arrives');
  const bad = encodeInput(c, []);
  bad[11] = 99;
  assert(decodeInputs(bad)[0].heal <= 4, 'heal choice clamped');
  void PLAYER;
});
