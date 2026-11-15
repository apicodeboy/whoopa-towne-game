import RAPIER from '@dimforge/rapier3d-compat';
import { matchMaker, type Server } from '@colyseus/core';
import { pack } from 'msgpackr';
import { LobbyConnection, NetClient, OnlineSession, describeJoinError } from '../../client/src/net/online.ts';
import { Predictor } from '../../client/src/game/predictor.ts';
import {
  BTN, DEFAULT_LOADOUT, EV, INTERP_DELAY_MS, INVITE_CODE_ALPHABET, PF, PHASE, PhysicsWorld, PLAYER, TICK_MS,
  getWhoopaTowne, makeInputCmd, makePlayerState, playerStateFromArray, quantizeInput, yawToward,
  type GameSim, type InputCmd, type Loadout, type MatchEndMsg, type Snapshot,
} from '../../shared/src/index.ts';
import { approx, assert, test } from '../../shared/test/harness.ts';
import { startServer } from '../src/index.ts';

const PORT = 2590 + Math.floor(Math.random() * 300);
const URL = `http://localhost:${PORT}`;
let server: Server;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

/** The server-side sim of a room (the test runs in the same process as the server). */
function simOf(code: string): GameSim {
  const room = matchMaker.getLocalRoomById(code) as unknown as { sim: GameSim | null };
  assert(room && room.sim, 'room has a running sim');
  return room.sim!;
}

const open: LobbyConnection[] = [];
async function leaveAll(): Promise<void> {
  await Promise.all(open.splice(0).map((l) => l.leave()));
  await sleep(120);
}
function track<T extends LobbyConnection>(l: T): T {
  open.push(l);
  return l;
}

/** A headless player: lobby connection + session + snapshot log, with a tiny input loop. */
class Bot {
  lobby!: LobbyConnection;
  session: OnlineSession | null = null;
  snaps: Snapshot[] = [];
  events: number[][] = [];
  ended: MatchEndMsg | null = null;
  notices: string[] = [];
  seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  attach(lobby: LobbyConnection): this {
    this.lobby = track(lobby);
    lobby.onNotice = (t) => this.notices.push(t);
    lobby.onMatchEnd = (m) => (this.ended = m);
    lobby.onMatchStart = (s) => {
      this.session = s;
      s.handlers.onSnapshot = (snap) => {
        this.snaps.push(snap);
        for (const e of snap.events) this.events.push(e);
      };
    };
    return this;
  }

  get last(): Snapshot {
    return this.snaps[this.snaps.length - 1];
  }

  me(snap = this.last) {
    return snap.players.find((p) => p.idx === this.session!.myIdx)!;
  }

  /** Sends inputs at 60 Hz produced by `make` until stopped. */
  drive(make: (cmd: InputCmd) => void): void {
    this.stop();
    this.timer = setInterval(() => {
      const s = this.session;
      if (!s) return;
      const cmd = makeInputCmd();
      cmd.seq = ++this.seq;
      cmd.rt = Math.max(0, s.serverTime() - INTERP_DELAY_MS);
      make(cmd);
      quantizeInput(cmd);
      s.sendInput(cmd);
      s.update(TICK_MS / 1000);
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

async function privateMatch(n: number, opts: { fillBots?: boolean; mode?: 'tdm' | 'turf' } = {}): Promise<Bot[]> {
  const bots: Bot[] = [];
  const net = new NetClient(URL);
  const host = new Bot().attach(await net.createPrivate(opts.mode ?? 'tdm', 'Host', DEFAULT_LOADOUT));
  bots.push(host);
  for (let i = 1; i < n; i++) {
    bots.push(new Bot().attach(await new NetClient(URL).joinByCode(host.lobby.code, `P${i}`, DEFAULT_LOADOUT)));
  }
  await until(() => host.lobby.view().players.length === n, 'everyone in the lobby');
  host.lobby.configure({ fillBots: opts.fillBots ?? false });
  for (const b of bots.slice(1)) b.lobby.setReady(true);
  await until(() => host.lobby.view().players.every((p) => p.ready || p.id === host.lobby.myId), 'ready flags');
  await until(() => host.lobby.view().fillBots === (opts.fillBots ?? false), 'config applied');
  host.lobby.start();
  await until(() => bots.every((b) => b.session !== null), 'match start');
  await until(() => bots.every((b) => b.snaps.length > 2), 'first snapshots');
  return bots;
}

test('server boots and reports health', async () => {
  server = await startServer(PORT);
  const res = await fetch(`${URL}/healthz`);
  const body = (await res.json()) as { ok: boolean; rooms: number };
  assert(res.ok && body.ok && body.rooms === 0, 'healthz ok');
});

test('create private lobby: 6-character invite code, creator is host', async () => {
  const net = new NetClient(URL);
  const lobby = track(await net.createPrivate('turf', '  Big   Mike!!  ', DEFAULT_LOADOUT));
  await until(() => lobby.view().players.length === 1, 'lobby state');
  const v = lobby.view();
  assert(v.code.length === 6 && [...v.code].every((c) => INVITE_CODE_ALPHABET.includes(c)), `bad code "${v.code}"`);
  assert(lobby.code === v.code, 'room id is the invite code');
  assert(v.isPrivate && v.mode === 'turf' && v.phase === 'lobby', 'private turf lobby');
  assert(v.hostId === lobby.myId, 'creator is host');
  assert(v.players[0].name === 'Big Mike', `name sanitized: "${v.players[0].name}"`);
  await leaveAll();
});

test('join with code: crews auto-balance, duplicate names get a suffix, bad codes fail cleanly', async () => {
  const host = track(await new NetClient(URL).createPrivate('tdm', 'Ace', DEFAULT_LOADOUT));
  const guest = track(await new NetClient(URL).joinByCode(host.code.toLowerCase(), 'Ace', DEFAULT_LOADOUT));
  await until(() => host.view().players.length === 2 && guest.view().players.length === 2, 'both see both');
  const v = guest.view();
  const names = v.players.map((p) => p.name).sort();
  assert(names[0] === 'Ace' && names[1] === 'Ace 2', `names: ${names.join(', ')}`);
  assert(v.players[0].team !== v.players[1].team, 'second player lands on the other crew');
  assert(v.hostId === host.myId, 'host unchanged');
  let err = '';
  try {
    await new NetClient(URL).joinByCode('ZZZZZZ', 'Nope', DEFAULT_LOADOUT);
  } catch (e) {
    err = describeJoinError(e);
  }
  assert(err === 'No lobby found with that code.', `friendly error, got "${err}"`);
  // switching crews
  guest.setTeam(v.players.find((p) => p.id === host.myId)!.team);
  await until(() => new Set(host.view().players.map((p) => p.team)).size === 1, 'team switch');
  await leaveAll();
});

test('quick play joins an open public lobby of the same mode and skips private ones', async () => {
  const priv = track(await new NetClient(URL).createPrivate('tdm', 'Hidden', DEFAULT_LOADOUT));
  const a = track(await new NetClient(URL).quickPlay('tdm', 'A', DEFAULT_LOADOUT));
  const b = track(await new NetClient(URL).quickPlay('tdm', 'B', DEFAULT_LOADOUT));
  const c = track(await new NetClient(URL).quickPlay('turf', 'C', DEFAULT_LOADOUT));
  assert(a.code !== priv.code, 'quick play never lands in a private lobby');
  assert(a.code === b.code, 'same mode => same lobby');
  assert(c.code !== a.code, 'different mode => different lobby');
  await until(() => a.view().players.length === 2, 'two players');
  assert(!a.view().isPrivate && a.view().mode === 'tdm' && c.view().mode === 'turf', 'modes');
  // host leaves: the other player inherits host
  await a.leave();
  await until(() => b.view().hostId === b.myId, 'host migration');
  await leaveAll();
});

test('ready-up: only the host can start, and only when everyone is ready', async () => {
  const net = new NetClient(URL);
  const host = new Bot().attach(await net.createPrivate('tdm', 'Host', DEFAULT_LOADOUT));
  const guest = new Bot().attach(await new NetClient(URL).joinByCode(host.lobby.code, 'Guest', DEFAULT_LOADOUT));
  await until(() => host.lobby.view().players.length === 2, 'lobby');
  guest.lobby.start(); // not the host: ignored
  host.lobby.start(); // guest not ready: refused with a notice
  await until(() => host.notices.length > 0, 'notice');
  assert(/ready up/i.test(host.notices[0]), `notice: ${host.notices[0]}`);
  await sleep(100);
  assert(host.session === null && guest.session === null, 'no match yet');
  guest.lobby.setReady(true);
  await until(() => host.lobby.view().players.some((p) => p.ready), 'ready');
  host.lobby.start();
  await until(() => host.session !== null && guest.session !== null, 'match start');
  assert(host.lobby.view().phase === 'playing' || (await until(() => host.lobby.view().phase === 'playing', 'phase')) === undefined, 'playing');
  // default lobby fills empty slots with bots: 4v4
  assert(host.session!.roster.length === 8, `roster of 8, got ${host.session!.roster.length}`);
  assert(host.session!.roster.filter((r) => r.bot).length === 6, '6 bots');
  assert(host.session!.myIdx !== guest.session!.myIdx, 'distinct player slots');
  // a locked (in-progress) lobby cannot be joined
  let err = '';
  try {
    await new NetClient(URL).joinByCode(host.lobby.code, 'Late', DEFAULT_LOADOUT);
  } catch (e) {
    err = describeJoinError(e);
  }
  assert(/in progress/i.test(err), `late join refused: "${err}"`);
  await leaveAll();
});

test('2-player sync: movement replicates, inputs are acked, snapshots arrive at 30 Hz', async () => {
  const [a, b] = await privateMatch(2);
  const sim = simOf(a.lobby.code);
  await until(() => a.last.phase === PHASE.PLAYING, 'warm-up over', 8000);
  const startA = { ...a.me() };
  const n0 = b.snaps.length;
  const t0 = Date.now();
  a.drive((cmd) => {
    cmd.yaw = sim.players[a.session!.myIdx]!.state.yaw;
    cmd.mz = 1;
  });
  b.drive((cmd) => {
    cmd.yaw = 1.0;
  });
  await sleep(1500);
  a.stop();
  b.stop();
  const dt = (Date.now() - t0) / 1000;
  const rate = (b.snaps.length - n0) / dt;
  approx(rate, 30, 3, 'snapshot rate');
  // A moved ~ walk speed * 1.5s as seen by B
  const seenByB = b.last.players.find((p) => p.idx === a.session!.myIdx)!;
  const moved = Math.hypot(seenByB.x - startA.x, seenByB.z - startA.z);
  assert(moved > 4 && moved < 9, `B saw A move ${moved.toFixed(2)}m`);
  // B's yaw replicated to A
  const bSeenByA = a.last.players.find((p) => p.idx === b.session!.myIdx)!;
  approx(bSeenByA.yaw, 1.0, 0.01, 'yaw replicated');
  // acks keep up with what was sent
  assert(a.seq - a.last.ack < 12, `ack lag ${a.seq - a.last.ack}`);
  // server truth matches what the owner is told about itself
  const self = playerStateFromArray(a.last.self!, makePlayerState());
  approx(self.x, a.me().x, 0.011, 'self state agrees with public state');
  assert(a.session!.ping >= 0 && a.session!.ping < 60, `ping measured (${a.session!.ping.toFixed(1)}ms)`);
  await leaveAll();
});

test('client prediction matches the server exactly over a laggy connection (no corrections)', async () => {
  server.simulateLatency(120);
  try {
    const [a] = await privateMatch(2);
    await until(() => a.last.phase === PHASE.PLAYING, 'warm-up over', 9000);
    await RAPIER.init();
    const phys = new PhysicsWorld(RAPIER, getWhoopaTowne());
    const pred = new Predictor();
    let synced = false;
    let corrections = 0;
    let lateCorrections = 0;
    let startedAt = 0;
    let life = -1;
    const s = a.session!;
    s.handlers.onSnapshot = (snap) => {
      a.snaps.push(snap);
      if (!snap.self) return;
      const srv = playerStateFromArray(snap.self, makePlayerState());
      const frozen = snap.phase !== PHASE.PLAYING;
      if (snap.life !== life || !synced) {
        life = snap.life;
        pred.reconcile(snap.ack, srv, phys, DEFAULT_LOADOUT, frozen, true);
        synced = true;
      } else if (pred.reconcile(snap.ack, srv, phys, DEFAULT_LOADOUT, frozen)) {
        corrections++;
        if (startedAt > 0 && performance.now() - startedAt > 500) lateCorrections++;
      }
    };
    await until(() => synced, 'first sync');
    const yaw0 = pred.state.yaw;
    let i = 0;
    startedAt = performance.now();
    const timer = setInterval(() => {
      i++;
      const cmd = makeInputCmd();
      cmd.seq = ++a.seq;
      pred.seq = cmd.seq;
      // wander: sprint, strafe, jump, crouch, fire, reload, swap weapons
      cmd.yaw = yaw0 + Math.sin(i * 0.02) * 1.2;
      cmd.pitch = Math.sin(i * 0.05) * 0.3;
      cmd.mz = Math.cos(i * 0.01);
      cmd.mx = Math.sin(i * 0.033);
      cmd.buttons =
        (i % 90 === 0 ? BTN.JUMP : 0) | (i % 200 < 80 ? BTN.SPRINT : 0) | (i % 260 > 220 ? BTN.CROUCH : 0) |
        (i % 40 < 14 ? BTN.FIRE : 0) | (i % 300 === 150 ? BTN.RELOAD : 0) | (i % 170 < 30 ? BTN.AIM : 0);
      cmd.slot = i % 400 > 330 ? 1 : 0;
      cmd.ox = pred.state.x; cmd.oy = pred.state.y + PLAYER.eyeHeight; cmd.oz = pred.state.z;
      cmd.rt = Math.max(0, s.serverTime() - INTERP_DELAY_MS);
      quantizeInput(cmd);
      pred.step(cmd, phys, DEFAULT_LOADOUT, false);
      s.sendInput(cmd);
      s.update(TICK_MS / 1000);
    }, TICK_MS);
    await sleep(6000);
    clearInterval(timer);
    await sleep(500);
    const sim = simOf(a.lobby.code);
    const truth = sim.players[s.myIdx]!.state;
    console.log(`       ${i} inputs, ping ${s.ping.toFixed(0)}ms, ${pred.pendingCount} still in flight, ${corrections} corrections, shots ${truth.shots}`);
    assert(s.ping > 90, `latency is being simulated (ping ${s.ping.toFixed(0)}ms)`);
    assert(corrections <= 1, `prediction diverged from the server ${corrections} times`);
    assert(lateCorrections === 0, `prediction diverged ${lateCorrections} times after start-up`);
    approx(pred.state.x, truth.x, 0.001, 'final x');
    approx(pred.state.z, truth.z, 0.001, 'final z');
    assert(pred.state.mag0 === truth.mag0 && pred.state.shots === truth.shots && truth.shots > 8, 'ammo + shot counters agree');
    phys.dispose();
  } finally {
    server.simulateLatency(0);
    await leaveAll();
  }
});

test('shooting over the network: hits, damage and kill events reach both players (with lag compensation)', async () => {
  server.simulateLatency(80);
  try {
    const [a, b] = await privateMatch(2);
    await until(() => a.last.phase === PHASE.PLAYING, 'warm-up over', 9000);
    const sim = simOf(a.lobby.code);
    const pa = sim.players[a.session!.myIdx]!, pb = sim.players[b.session!.myIdx]!;
    // face off on the West Strip, 12m apart; B strafes so only a lag-compensated shot can connect
    pa.state.x = -18; pa.state.z = 30; pa.state.y = 0.02; pa.hCount = 0;
    pb.state.x = -21; pb.state.z = 18; pb.state.y = 0.02; pb.hCount = 0;
    pa.protectedUntil = pb.protectedUntil = 0;
    b.drive((cmd) => {
      cmd.yaw = Math.PI;
      cmd.mx = Math.sin(Date.now() / 400) > 0 ? 1 : -1; // strafe left/right
    });
    await sleep(400);
    // A aims at where it SEES B (the interpolated, delayed position from its own snapshots)
    a.drive((cmd) => {
      const s = a.session!;
      const rt = s.serverTime() - INTERP_DELAY_MS;
      // interpolate B from A's snapshot buffer at render time, exactly like the game client does
      const snaps = a.snaps;
      let seen = snaps[snaps.length - 1].players.find((p) => p.idx === b.session!.myIdx)!;
      for (let k = snaps.length - 1; k > 0; k--) {
        if (snaps[k - 1].t <= rt) {
          const p0 = snaps[k - 1].players.find((p) => p.idx === b.session!.myIdx)!;
          const p1 = snaps[k].players.find((p) => p.idx === b.session!.myIdx)!;
          const f = Math.min(1, Math.max(0, (rt - snaps[k - 1].t) / (snaps[k].t - snaps[k - 1].t)));
          seen = { ...p0, x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f };
          break;
        }
      }
      const me = a.me();
      cmd.yaw = yawToward(me.x, me.z, seen.x, seen.z);
      cmd.pitch = Math.atan2(1.1 - PLAYER.eyeHeight, Math.hypot(seen.x - me.x, seen.z - me.z));
      cmd.ox = me.x; cmd.oy = me.y + PLAYER.eyeHeight; cmd.oz = me.z;
      cmd.buttons = BTN.FIRE | BTN.AIM;
    });
    await until(() => a.events.some((e) => e[0] === EV.KILL && e[1] === a.session!.myIdx), 'A kills B', 6000);
    a.stop();
    b.stop();
    const shots = a.events.filter((e) => e[0] === EV.SHOT && e[1] === a.session!.myIdx).length;
    const hits = a.events.filter((e) => e[0] === EV.HIT && e[1] === a.session!.myIdx).length;
    console.log(`       ${hits}/${shots} shots hit a strafing target at 80ms round-trip`);
    assert(hits / shots > 0.6, `lag compensation should make most aimed shots land (${hits}/${shots})`);
    await until(() => b.events.some((e) => e[0] === EV.KILL && e[2] === b.session!.myIdx), 'victim learns of its death');
    await until(() => (b.me().flags & PF.ALIVE) === 0 || b.snaps.some((s) => s.respawnIn > 0), 'B dead in snapshots');
    assert(a.last.scores[pa.team] >= 1, 'team score went up');
    assert(b.events.some((e) => e[0] === EV.HIT && e[2] === b.session!.myIdx), 'victim received hit events (damage direction)');
  } finally {
    server.simulateLatency(0);
    await leaveAll();
  }
});

test('8 human players in one match: everyone stays in sync, server holds 60 Hz', async () => {
  const bots = await privateMatch(8, { fillBots: false });
  const sim = simOf(bots[0].lobby.code);
  assert(bots[0].session!.roster.length === 8 && bots[0].session!.roster.every((r) => !r.bot), '8 humans, no bots');
  const teams = bots[0].session!.roster.reduce((acc, r) => (acc[r.team]++, acc), [0, 0]);
  assert(teams[0] === 4 && teams[1] === 4, `4v4, got ${teams.join('v')}`);
  await until(() => bots[0].last.phase === PHASE.PLAYING, 'warm-up over', 9000);
  const tick0 = sim.tickCount;
  const t0 = performance.now();
  bots.forEach((bot, i) =>
    bot.drive((cmd) => {
      cmd.yaw = sim.players[bot.session!.myIdx]!.state.yaw + Math.sin(Date.now() / 500 + i) * 0.5;
      cmd.mz = 1;
      cmd.buttons = (Date.now() % 1000 < 300 ? BTN.FIRE : 0) | (i % 2 ? BTN.SPRINT : 0);
    }),
  );
  // sample encoded snapshot sizes while everyone is running and shooting
  let bytes = 0, samples = 0;
  const sampler = setInterval(() => {
    bytes += pack(sim.snapshot(0, bots[0].last.events)).length;
    samples++;
  }, 100);
  await sleep(3000);
  clearInterval(sampler);
  bots.forEach((b) => b.stop());
  const secs = (performance.now() - t0) / 1000;
  const tickRate = (sim.tickCount - tick0) / secs;
  const perSnap = bytes / Math.max(1, samples);
  console.log(`       server tick rate ${tickRate.toFixed(1)} Hz; snapshot ~${perSnap.toFixed(0)} bytes => ~${((perSnap * 30) / 1024).toFixed(1)} KB/s down per client`);
  approx(tickRate, 60, 2.5, 'server tick rate');
  for (const bot of bots) {
    assert(bot.last.players.length === 8, 'each client sees all 8 players');
    const me = bot.me();
    const truth = sim.players[bot.session!.myIdx]!.state;
    assert(Math.hypot(me.x - truth.x, me.z - truth.z) < 1.2, 'client view tracks the server');
    assert(bot.seq - bot.last.ack < 14, `inputs acked (lag ${bot.seq - bot.last.ack})`);
  }
  // everyone moved away from their spawn
  const moved = bots.filter((b) => {
    const first = b.snaps[0].players.find((p) => p.idx === b.session!.myIdx)!;
    const now = b.me();
    return Math.hypot(now.x - first.x, now.z - first.z) > 1.5;
  }).length;
  assert(moved === 8, `all 8 players moved (${moved})`);
  await leaveAll();
});

test('leaving mid-match hands the slot to a bot; match end returns everyone to the lobby', async () => {
  const [a, b] = await privateMatch(2, { fillBots: true });
  const sim = simOf(a.lobby.code);
  const bIdx = b.session!.myIdx;
  let roster = a.session!.roster;
  a.session!.handlers.onRoster = (r) => (roster = r);
  await b.lobby.leave();
  await until(() => roster.find((r) => r.idx === bIdx)?.bot === true, 'slot converted to a bot');
  assert(sim.players[bIdx]!.isBot && sim.players[bIdx]!.brain !== null, 'bot brain attached');
  assert(roster.length === 8, 'still 4v4');
  // force the finish: push the score to the limit
  await until(() => a.last.phase === PHASE.PLAYING, 'warm-up over', 9000);
  sim.scores[0] = 50;
  await until(() => a.ended !== null, 'match end message');
  assert(a.ended!.winner === 0 && a.ended!.scores[0] === 50, 'S-Curve wins 50');
  assert(a.ended!.players.length === 8, 'final standings for all players');
  await until(() => a.last.phase === PHASE.ENDED, 'ended snapshot');
  sim.phaseEndsAt = sim.time + 200; // skip the scoreboard timer
  await until(() => a.lobby.view().phase === 'lobby', 'back in the lobby', 5000);
  // the lobby is joinable again
  const late = track(await new NetClient(URL).joinByCode(a.lobby.code, 'Late', DEFAULT_LOADOUT));
  await until(() => a.lobby.view().players.length === 2, 'late joiner in lobby');
  assert(late.view().players.every((p) => !p.ready), 'ready flags reset');
  await leaveAll();
});

test('the server shrugs off malformed messages', async () => {
  const [a, b] = await privateMatch(2);
  const room = a.lobby.room;
  const junk: unknown[] = [null, 'x', { a: 1 }, [NaN, Infinity, -1e30], new Array(500).fill(1e9), [[1, 2, 3]], 12345];
  for (const j of junk) {
    room.send('i', j);
    room.send('loadout', j);
    room.send('team', j);
    room.send('config', j);
    room.send('ready', j);
    room.send('ping', j);
  }
  const loadout: Loadout = { primary: 'shotgun', secondary: 'pistol', throwable: 'smoke' };
  a.lobby.setLoadout(loadout);
  await sleep(300);
  const sim = simOf(a.lobby.code);
  const pa = sim.players[a.session!.myIdx]!;
  assert(Number.isFinite(pa.state.x) && Number.isFinite(pa.state.yaw), 'state stays finite');
  assert(pa.nextLoadout?.primary === 'shotgun', 'valid loadout change accepted for next spawn');
  const n = b.snaps.length;
  await sleep(200);
  assert(b.snaps.length > n, 'server still ticking');
  await leaveAll();
});

test('server shuts down cleanly', async () => {
  await leaveAll();
  await server.gracefullyShutdown(false);
});
