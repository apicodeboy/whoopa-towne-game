import type { TeamId } from '../config/crews';
import {
  ENDED_SECONDS, GRENADE, MAX_PLAYERS, MAX_REWIND_MS, MODES, NET, PLAYER, SMOKE, THROW, TICK_DT, TICK_MS, TURF,
  WARMUP_SECONDS, type ModeId,
} from '../config/game';
import {
  SLOT_PRIMARY, SLOT_SECONDARY, sanitizeLoadout, throwableIndex, weaponForSlot, weaponIndex,
  type Loadout,
} from '../config/weapons';
import { getWhoopaTowne } from '../map/whoopaTowne';
import type { MapDef, SpawnPoint } from '../map/types';
import { Rng, clamp, forwardFromYawPitch, rightFromYaw, type Vec3 } from '../math';
import {
  EV, HELD_GRENADE, HELD_SMOKE, KILL_GRENADE, KILL_WORLD, PF, PHASE,
  type BotDifficulty, type Phase, type RosterEntry, type WireSnapshot,
} from '../protocol';
import { BotBrain, randomBotLoadout } from './bots';
import { HIT_PLAYER, makeShotResult, pelletDamage, shotSeed, spreadDirection, traceShot, type ShotTarget } from './combat';
import { NavGrid } from './nav';
import { PhysicsWorld, Q_PROJECTILE, type Rapier } from './physics';
import {
  copyInputCmd, eyeHeight, makeInputCmd, makePlayerState, makeStepActions, playerStateToArray, spawnPlayerState,
  stepPlayer, type InputCmd, type PlayerState, type StepActions,
} from './player';

const HISTORY = 64;

export interface SimPlayer {
  idx: number;
  /** External id (session id, or bot id). */
  id: string;
  name: string;
  team: TeamId;
  isBot: boolean;
  loadout: Loadout;
  /** Applied on the next spawn. */
  nextLoadout: Loadout | null;
  state: PlayerState;
  alive: boolean;
  health: number;
  lastDamageAt: number;
  respawnAt: number;
  protectedUntil: number;
  lastAttacker: number;
  lastAttackedAt: number;
  kills: number;
  deaths: number;
  score: number;
  life: number;
  ping: number;
  lastSeq: number;
  inputs: InputCmd[];
  budget: number;
  idleTicks: number;
  lastCmd: InputCmd;
  brain: BotBrain | null;
  // lag compensation history (ring buffer)
  hT: Float64Array;
  hX: Float32Array;
  hY: Float32Array;
  hZ: Float32Array;
  hFlags: Uint8Array;
  hHead: number;
  hCount: number;
}

export interface Projectile {
  id: number;
  owner: number;
  /** 0 = grenade, 1 = smoke */
  type: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds until it goes off. */
  fuse: number;
  resting: boolean;
}

export interface SmokeCloud {
  x: number;
  y: number;
  z: number;
  until: number;
}

export interface ZoneState {
  owner: number;
  capTeam: number;
  progress: number;
  contested: boolean;
  count: [number, number];
}

export interface GameSimOptions {
  mode: ModeId;
  seed?: number;
  botDifficulty?: BotDifficulty;
  /** Override warm-up length in seconds (tests). */
  warmup?: number;
  map?: MapDef;
}

export interface AddPlayerInfo {
  id: string;
  name: string;
  team: TeamId;
  loadout?: Loadout;
  isBot?: boolean;
}

/**
 * Advances a thrown grenade/smoke by one tick: gravity, bounce off the world, come to rest.
 * Deterministic and shared, so clients can run it for visuals from the THROW event alone.
 */
export function stepProjectile(p: Projectile, dt: number, phys: PhysicsWorld): void {
  p.fuse -= dt;
  if (p.resting) return;
  p.vy -= THROW.gravity * dt;
  let remaining = dt;
  for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    if (speed < 1e-4) break;
    const dx = p.vx / speed, dy = p.vy / speed, dz = p.vz / speed;
    const want = speed * remaining;
    const t = phys.raycast(p.x, p.y, p.z, dx, dy, dz, want + THROW.radius, Q_PROJECTILE, true);
    if (t < 0) {
      p.x += dx * want;
      p.y += dy * want;
      p.z += dz * want;
      break;
    }
    const travel = Math.max(0, t - THROW.radius);
    p.x += dx * travel;
    p.y += dy * travel;
    p.z += dz * travel;
    remaining -= travel / speed;
    // reflect about the surface normal, lose energy
    const n = phys.hitNormal;
    const vn = p.vx * n.x + p.vy * n.y + p.vz * n.z;
    if (vn < 0) {
      const tx = p.vx - vn * n.x, ty = p.vy - vn * n.y, tz = p.vz - vn * n.z;
      p.vx = tx * THROW.friction - vn * n.x * THROW.bounce;
      p.vy = ty * THROW.friction - vn * n.y * THROW.bounce;
      p.vz = tz * THROW.friction - vn * n.z * THROW.bounce;
    }
    if (n.y > 0.7 && Math.hypot(p.vx, p.vy, p.vz) < 1.1) {
      p.vx = p.vy = p.vz = 0;
      p.resting = true;
      break;
    }
  }
  if (p.y < -5) {
    p.y = -5;
    p.resting = true;
  }
}

/** Initial position and velocity of a throw from a player's view. */
export function throwLaunch(
  s: PlayerState, phys: PhysicsWorld, out: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
): void {
  const f: Vec3 = { x: 0, y: 0, z: 0 };
  const r: Vec3 = { x: 0, y: 0, z: 0 };
  forwardFromYawPitch(s.yaw, s.pitch, f);
  rightFromYaw(s.yaw, r);
  const ex = s.x, ey = s.y + eyeHeight(s.crouching), ez = s.z;
  let hx = ex + f.x * 0.55 + r.x * 0.25;
  let hy = ey + f.y * 0.55 - 0.05;
  let hz = ez + f.z * 0.55 + r.z * 0.25;
  // do not start inside a wall when hugging cover
  if (!phys.lineOfSight(ex, ey, ez, hx, hy, hz, Q_PROJECTILE)) {
    hx = ex;
    hy = ey;
    hz = ez;
  }
  out.x = hx;
  out.y = hy;
  out.z = hz;
  out.vx = f.x * THROW.speed + s.vx * 0.5;
  out.vy = f.y * THROW.speed + THROW.upBoost;
  out.vz = f.z * THROW.speed + s.vz * 0.5;
}

/**
 * The authoritative match simulation: players, weapons, health, respawns, throwables,
 * bots and both game modes. Runs on the server inside a Colyseus room and, unchanged,
 * in the browser for offline practice.
 */
export class GameSim {
  readonly map: MapDef;
  readonly phys: PhysicsWorld;
  readonly nav: NavGrid;
  readonly mode: ModeId;
  readonly rng: Rng;
  readonly botDifficulty: BotDifficulty;
  readonly players: Array<SimPlayer | null> = new Array(MAX_PLAYERS).fill(null);
  readonly projectiles: Projectile[] = [];
  readonly smokes: SmokeCloud[] = [];
  readonly zones: ZoneState[];
  readonly scores: [number, number] = [0, 0];

  /** Milliseconds since the sim was created. */
  time = 0;
  tickCount = 0;
  phase: Phase = PHASE.WARMUP;
  /** Sim time when the current phase ends. */
  phaseEndsAt = 0;
  winner = -1;
  started = false;

  private events: number[][] = [];
  private act: StepActions = makeStepActions();
  private warmupMs: number;
  private pointTimer = 0;
  private nextProjectileId = 1;
  private targets: ShotTarget[] = [];
  private targetPool: ShotTarget[] = [];
  private shot = makeShotResult();
  private dir: Vec3 = { x: 0, y: 0, z: 0 };
  private launch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private stateArr: number[] = [];
  private dmgByTarget = new Float32Array(MAX_PLAYERS);
  private headByTarget = new Uint8Array(MAX_PLAYERS);

  constructor(R: Rapier, opts: GameSimOptions) {
    this.map = opts.map ?? getWhoopaTowne();
    this.phys = new PhysicsWorld(R, this.map);
    this.nav = new NavGrid(this.phys, this.map);
    this.mode = opts.mode;
    this.rng = new Rng(opts.seed ?? (Date.now() & 0x7fffffff));
    this.botDifficulty = opts.botDifficulty ?? 'normal';
    this.warmupMs = (opts.warmup ?? WARMUP_SECONDS) * 1000;
    this.zones = this.map.zones.map(() => ({ owner: -1, capTeam: -1, progress: 0, contested: false, count: [0, 0] }));
  }

  // ------------------------------------------------------------------ roster
  addPlayer(info: AddPlayerInfo): SimPlayer | null {
    const idx = this.players.indexOf(null);
    if (idx < 0) return null;
    const p: SimPlayer = {
      idx,
      id: info.id,
      name: info.name,
      team: info.team,
      isBot: !!info.isBot,
      loadout: info.isBot && !info.loadout ? randomBotLoadout(this.rng) : sanitizeLoadout(info.loadout),
      nextLoadout: null,
      state: makePlayerState(),
      alive: false,
      health: 0,
      lastDamageAt: -1e9,
      respawnAt: 0,
      protectedUntil: 0,
      lastAttacker: -1,
      lastAttackedAt: -1e9,
      kills: 0,
      deaths: 0,
      score: 0,
      life: 0,
      ping: 0,
      lastSeq: 0,
      inputs: [],
      budget: 2,
      idleTicks: 0,
      lastCmd: makeInputCmd(),
      brain: null,
      hT: new Float64Array(HISTORY),
      hX: new Float32Array(HISTORY),
      hY: new Float32Array(HISTORY),
      hZ: new Float32Array(HISTORY),
      hFlags: new Uint8Array(HISTORY),
      hHead: 0,
      hCount: 0,
    };
    if (p.isBot) p.brain = new BotBrain(this, p);
    this.players[idx] = p;
    if (this.started) this.spawn(p);
    return p;
  }

  removePlayer(idx: number): void {
    this.players[idx] = null;
  }

  /** Hands a disconnected human's slot to a bot so the teams stay even. */
  convertToBot(idx: number, name: string): void {
    const p = this.players[idx];
    if (!p || p.isBot) return;
    p.isBot = true;
    p.id = `bot-${idx}`;
    p.name = name;
    p.inputs.length = 0;
    p.brain = new BotBrain(this, p);
  }

  findById(id: string): SimPlayer | null {
    for (const p of this.players) if (p && p.id === id) return p;
    return null;
  }

  roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const p of this.players) if (p) out.push({ idx: p.idx, name: p.name, team: p.team, bot: p.isBot });
    return out;
  }

  teamCount(team: TeamId): number {
    let n = 0;
    for (const p of this.players) if (p && p.team === team) n++;
    return n;
  }

  setLoadout(idx: number, loadout: Loadout): void {
    const p = this.players[idx];
    if (p) p.nextLoadout = sanitizeLoadout(loadout);
  }

  // ------------------------------------------------------------------ flow
  /** Spawns everyone and starts the warm-up countdown. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.phase = PHASE.WARMUP;
    this.phaseEndsAt = this.time + this.warmupMs;
    for (const p of this.players) if (p) this.spawn(p);
    this.events.push([EV.PHASE, PHASE.WARMUP, -1]);
    if (this.warmupMs <= 0) this.beginPlaying();
  }

  private beginPlaying(): void {
    this.phase = PHASE.PLAYING;
    this.phaseEndsAt = this.time + MODES[this.mode].timeLimit * 1000;
    this.events.push([EV.PHASE, PHASE.PLAYING, -1]);
  }

  private endMatch(): void {
    if (this.phase === PHASE.ENDED) return;
    this.phase = PHASE.ENDED;
    this.winner = this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
    this.phaseEndsAt = this.time + ENDED_SECONDS * 1000;
    this.events.push([EV.PHASE, PHASE.ENDED, this.winner]);
  }

  /** Ends the match now with the current scores (host ended it early). */
  forceEnd(): void {
    if (this.started && this.phase !== PHASE.ENDED) this.endMatch();
  }

  /** Seconds left in the current phase. */
  get timeLeft(): number {
    return Math.max(0, (this.phaseEndsAt - this.time) / 1000);
  }

  /** True once the post-match scoreboard time has elapsed. */
  get finished(): boolean {
    return this.phase === PHASE.ENDED && this.time >= this.phaseEndsAt;
  }

  // ------------------------------------------------------------------ input
  queueInput(idx: number, cmd: InputCmd): void {
    const p = this.players[idx];
    if (!p || p.isBot) return;
    if (cmd.seq <= p.lastSeq) return; // duplicate / out of order
    if (p.inputs.length > 0 && cmd.seq <= p.inputs[p.inputs.length - 1].seq) return;
    p.inputs.push(cmd);
    if (p.inputs.length > NET.maxQueuedInputs) p.inputs.shift();
  }

  // ------------------------------------------------------------------ tick
  tick(): void {
    this.time += TICK_MS;
    this.tickCount++;
    const frozen = this.phase !== PHASE.PLAYING;

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      if (p.brain) {
        const cmd = p.lastCmd;
        cmd.seq = p.lastSeq + 1;
        p.brain.think(cmd);
        this.applyInput(p, cmd, frozen);
        continue;
      }
      p.budget = Math.min(p.budget + 1, 6);
      let n = 0;
      while (p.inputs.length > 0 && p.budget >= 1 && n < NET.maxInputsPerTick) {
        const cmd = p.inputs.shift()!;
        p.budget -= 1;
        copyInputCmd(p.lastCmd, cmd);
        this.applyInput(p, cmd, frozen);
        n++;
      }
      // A player's state only ever advances through their own input commands. That keeps it a
      // pure function of (spawn state, command sequence), which is what makes client-side
      // prediction exact. A stalled connection simply leaves the player where they were.
      if (n === 0) p.idleTicks++;
      else p.idleTicks = 0;
    }

    this.updateProjectiles();
    this.updatePlayers();

    if (this.phase === PHASE.WARMUP) {
      if (this.started && this.time >= this.phaseEndsAt) this.beginPlaying();
    } else if (this.phase === PHASE.PLAYING) {
      this.updateMode();
    }

    this.recordHistory();
  }

  private applyInput(p: SimPlayer, cmd: InputCmd, frozen: boolean): void {
    p.lastSeq = cmd.seq;
    if (!p.alive) return;
    const act = this.act;
    stepPlayer(p.state, cmd, TICK_DT, this.phys, p.loadout, act, frozen);
    if (act.shot) this.fire(p, cmd, act);
    if (act.threw) this.throwItem(p);
    if (act.reloadStart) this.events.push([EV.RELOAD, p.idx]);
  }

  // ------------------------------------------------------------------ combat
  private fire(p: SimPlayer, cmd: InputCmd, act: StepActions): void {
    const w = weaponForSlot(p.loadout, act.shotSlot);
    if (!w) return;
    const s = p.state;
    p.protectedUntil = 0; // shooting ends spawn protection
    const eyeX = s.x, eyeY = s.y + eyeHeight(s.crouching), eyeZ = s.z;

    // Aim origin: the client's camera, clamped to a sane distance from the head. Bots aim from the eye.
    let camX = eyeX, camY = eyeY, camZ = eyeZ;
    if (!p.isBot) {
      const d = Math.hypot(cmd.ox - eyeX, cmd.oy - eyeY, cmd.oz - eyeZ);
      if (d <= NET.maxAimOriginDist) {
        camX = cmd.ox;
        camY = cmd.oy;
        camZ = cmd.oz;
      }
    }

    // Lag compensation: put enemies where this shooter saw them.
    const rewindTo = p.isBot || cmd.rt <= 0 ? this.time : clamp(cmd.rt, this.time - MAX_REWIND_MS, this.time);
    const targets = this.targets;
    for (const t of targets) this.targetPool.push(t);
    targets.length = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const e = this.players[i];
      if (!e || e === p || e.team === p.team || !e.alive || this.time < e.protectedUntil) continue;
      const t = this.targetPool.pop() ?? { id: 0, x: 0, y: 0, z: 0, crouching: false };
      t.id = e.idx;
      this.rewound(e, rewindTo, t);
      targets.push(t);
    }

    const rng = this.shotRng;
    rng.reseed(shotSeed(p.idx, act.shotSeed));
    const dmg = this.dmgByTarget, heads = this.headByTarget;
    dmg.fill(0);
    heads.fill(0);
    const ev: number[] = [EV.SHOT, p.idx, weaponIndex(w.id), Math.round(eyeX * 100), Math.round(eyeY * 100), Math.round(eyeZ * 100), w.pellets];
    const res = this.shot;
    for (let k = 0; k < w.pellets; k++) {
      spreadDirection(rng, s.yaw, s.pitch, act.shotSpread, this.dir);
      traceShot(this.phys, eyeX, eyeY, eyeZ, camX, camY, camZ, this.dir.x, this.dir.y, this.dir.z, w.range, targets, res);
      ev.push(Math.round(res.ex * 100), Math.round(res.ey * 100), Math.round(res.ez * 100), res.kind);
      if (res.kind === HIT_PLAYER) {
        dmg[res.target] += pelletDamage(w, res.dist, res.head);
        if (res.head) heads[res.target] = 1;
      }
    }
    this.events.push(ev);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (dmg[i] > 0) {
        const v = this.players[i];
        if (v) this.damage(v, dmg[i], p.idx, weaponIndex(w.id), heads[i] === 1, s.x, s.z);
      }
    }
  }

  private shotRng = new Rng(1);

  private throwItem(p: SimPlayer): void {
    const type = throwableIndex(p.loadout.throwable);
    const l = this.launch;
    throwLaunch(p.state, this.phys, l);
    const proj: Projectile = {
      id: this.nextProjectileId++,
      owner: p.idx,
      type,
      x: l.x, y: l.y, z: l.z, vx: l.vx, vy: l.vy, vz: l.vz,
      fuse: type === 0 ? GRENADE.fuse : SMOKE.fuse,
      resting: false,
    };
    this.projectiles.push(proj);
    p.protectedUntil = 0;
    this.events.push([
      EV.THROW, proj.id, p.idx, type,
      Math.round(l.x * 100), Math.round(l.y * 100), Math.round(l.z * 100),
      Math.round(l.vx * 100), Math.round(l.vy * 100), Math.round(l.vz * 100),
    ]);
  }

  private updateProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      stepProjectile(pr, TICK_DT, this.phys);
      if (pr.fuse <= 0) {
        this.projectiles.splice(i, 1);
        this.events.push([EV.EXPLODE, pr.id, pr.type, Math.round(pr.x * 100), Math.round(pr.y * 100), Math.round(pr.z * 100)]);
        if (pr.type === 0) this.explode(pr);
        else this.smokes.push({ x: pr.x, y: pr.y + 1.2, z: pr.z, until: this.time + SMOKE.duration * 1000 });
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      if (this.time >= this.smokes[i].until) this.smokes.splice(i, 1);
    }
  }

  private explode(pr: Projectile): void {
    const owner = this.players[pr.owner];
    const ox = pr.x, oy = pr.y + 0.25, oz = pr.z;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = this.players[i];
      if (!v || !v.alive) continue;
      // no friendly fire, but you can blow yourself up
      if (owner && v.team === owner.team && v !== owner) continue;
      const s = v.state;
      const cy = s.y + (s.crouching ? 0.6 : 0.95);
      const d = Math.hypot(s.x - ox, cy - oy, s.z - oz);
      if (d > GRENADE.radius) continue;
      let amount = GRENADE.maxDamage + (GRENADE.minDamage - GRENADE.maxDamage) * (d / GRENADE.radius);
      const exposed =
        this.phys.lineOfSight(ox, oy, oz, s.x, cy, s.z) ||
        this.phys.lineOfSight(ox, oy, oz, s.x, s.y + eyeHeight(s.crouching), s.z) ||
        this.phys.lineOfSight(ox, oy, oz, s.x, s.y + 0.2, s.z);
      if (!exposed) amount *= GRENADE.coverMult;
      this.damage(v, amount, pr.owner, KILL_GRENADE, false, ox, oz);
    }
  }

  /** Applies damage, emits hit/kill events, handles scoring. */
  damage(v: SimPlayer, amount: number, attackerIdx: number, weaponCode: number, head: boolean, srcX: number, srcZ: number): void {
    if (!v.alive || this.phase !== PHASE.PLAYING) return;
    if (this.time < v.protectedUntil) return;
    v.health -= amount;
    v.lastDamageAt = this.time;
    if (attackerIdx >= 0 && attackerIdx !== v.idx) {
      v.lastAttacker = attackerIdx;
      v.lastAttackedAt = this.time;
    }
    const killed = v.health <= 0;
    this.events.push([
      EV.HIT, attackerIdx, v.idx, Math.max(1, Math.round(amount)), head ? 1 : 0, killed ? 1 : 0,
      Math.round(srcX * 100), Math.round(srcZ * 100),
    ]);
    if (killed) this.kill(v, attackerIdx, weaponCode, head);
  }

  private kill(v: SimPlayer, attackerIdx: number, weaponCode: number, head: boolean): void {
    v.alive = false;
    v.health = 0;
    v.deaths++;
    v.respawnAt = this.time + PLAYER.respawnTime * 1000;
    v.state.vx = v.state.vz = 0;
    const a = attackerIdx >= 0 ? this.players[attackerIdx] : null;
    if (a && a !== v && a.team !== v.team) {
      a.kills++;
      if (this.mode === 'tdm') this.scores[a.team]++;
    }
    this.events.push([EV.KILL, a ? a.idx : -1, v.idx, weaponCode, head ? 1 : 0]);
  }

  // ------------------------------------------------------------------ spawning
  spawn(p: SimPlayer): void {
    if (p.nextLoadout) {
      p.loadout = p.nextLoadout;
      p.nextLoadout = null;
    }
    const sp = this.pickSpawn(p);
    spawnPlayerState(p.state, sp, p.loadout);
    p.alive = true;
    p.health = PLAYER.maxHealth;
    p.lastDamageAt = -1e9;
    p.protectedUntil = this.time + PLAYER.spawnProtection * 1000;
    p.life++;
    p.lastCmd.yaw = sp.yaw;
    p.lastCmd.pitch = 0;
    p.hCount = 0; // do not rewind across a respawn
    p.brain?.onSpawn();
    this.events.push([
      EV.SPAWN, p.idx, Math.round(sp.x * 100), Math.round(sp.y * 100), Math.round(sp.z * 100), Math.round(sp.yaw * 1000),
      weaponIndex(p.loadout.primary), weaponIndex(p.loadout.secondary), throwableIndex(p.loadout.throwable),
    ]);
  }

  private pickSpawn(p: SimPlayer): SpawnPoint {
    const list = this.map.spawns[p.team];
    let best: SpawnPoint[] = [];
    let bestScore = -Infinity;
    for (const sp of list) {
      let occupied = false;
      let nearestEnemy = 999;
      for (const o of this.players) {
        if (!o || o === p || !o.alive) continue;
        const d = Math.hypot(o.state.x - sp.x, o.state.z - sp.z);
        if (d < 1.4) occupied = true;
        if (o.team !== p.team) nearestEnemy = Math.min(nearestEnemy, d);
      }
      if (occupied) continue;
      // safe spawns all score the same so the choice among them is random
      const score = Math.min(nearestEnemy, 25);
      if (score > bestScore + 0.01) {
        bestScore = score;
        best = [sp];
      } else if (Math.abs(score - bestScore) <= 0.01) {
        best.push(sp);
      }
    }
    if (best.length === 0) return this.rng.pick(list);
    return this.rng.pick(best);
  }

  private updatePlayers(): void {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      if (!p.alive) {
        if (this.started && this.phase !== PHASE.ENDED && this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (p.state.y < -15) {
        // fell out of the world somehow: count it and respawn
        this.kill(p, -1, KILL_WORLD, false);
        continue;
      }
      if (p.health < PLAYER.maxHealth && this.time - p.lastDamageAt >= PLAYER.regenDelay * 1000) {
        p.health = Math.min(PLAYER.maxHealth, p.health + PLAYER.regenRate * TICK_DT);
      }
    }
  }

  // ------------------------------------------------------------------ modes
  private updateMode(): void {
    const cfg = MODES[this.mode];
    if (this.mode === 'turf') {
      this.updateZones();
      this.pointTimer += TICK_DT;
      if (this.pointTimer >= TURF.pointInterval) {
        this.pointTimer -= TURF.pointInterval;
        for (const z of this.zones) {
          if (z.owner >= 0) this.scores[z.owner] = Math.min(cfg.scoreLimit, this.scores[z.owner] + 1);
        }
      }
    }
    if (this.scores[0] >= cfg.scoreLimit || this.scores[1] >= cfg.scoreLimit || this.time >= this.phaseEndsAt) {
      this.endMatch();
    }
  }

  private updateZones(): void {
    const defs = this.map.zones;
    for (let zi = 0; zi < defs.length; zi++) {
      const def = defs[zi], z = this.zones[zi];
      let c0 = 0, c1 = 0;
      for (const p of this.players) {
        if (!p || !p.alive) continue;
        const s = p.state;
        if (s.y > TURF.zoneHeight) continue; // rooftops do not count
        if ((s.x - def.x) ** 2 + (s.z - def.z) ** 2 <= def.radius * def.radius) {
          if (p.team === 0) c0++;
          else c1++;
        }
      }
      z.count[0] = c0;
      z.count[1] = c1;
      z.contested = c0 > 0 && c1 > 0;
      if (z.contested) continue;
      if (c0 === 0 && c1 === 0) {
        if (z.progress > 0) {
          z.progress = Math.max(0, z.progress - TURF.decayRate * TICK_DT);
          if (z.progress === 0) z.capTeam = -1;
        }
        continue;
      }
      const team = c0 > 0 ? 0 : 1;
      const n = c0 > 0 ? c0 : c1;
      const rate = ((1 + TURF.extraPlayerBonus * (n - 1)) / TURF.captureTime) * TICK_DT;
      if (z.owner === team) {
        // defenders scrub off any enemy progress
        if (z.progress > 0) {
          z.progress = Math.max(0, z.progress - rate * 1.5);
          if (z.progress === 0) z.capTeam = -1;
        }
      } else if (z.capTeam !== team && z.progress > 0) {
        z.progress -= rate * 1.5;
        if (z.progress <= 0) {
          z.progress = 0;
          z.capTeam = team;
        }
      } else {
        z.capTeam = team;
        z.progress += rate;
        if (z.progress >= 1) {
          const prev = z.owner;
          z.owner = team;
          z.progress = 0;
          z.capTeam = -1;
          this.events.push([EV.ZONE, zi, team, prev]);
          for (const p of this.players) {
            if (!p || !p.alive || p.team !== team) continue;
            if ((p.state.x - def.x) ** 2 + (p.state.z - def.z) ** 2 <= def.radius * def.radius) p.score++;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ lag compensation
  private recordHistory(): void {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p || !p.alive) continue;
      const h = p.hHead;
      p.hT[h] = this.time;
      p.hX[h] = p.state.x;
      p.hY[h] = p.state.y;
      p.hZ[h] = p.state.z;
      p.hFlags[h] = p.state.crouching;
      p.hHead = (h + 1) % HISTORY;
      if (p.hCount < HISTORY) p.hCount++;
    }
  }

  /** Where player `p` was at server time `t` (interpolated between recorded ticks). */
  rewound(p: SimPlayer, t: number, out: ShotTarget): void {
    const s = p.state;
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.crouching = s.crouching === 1;
    if (p.hCount === 0 || t >= this.time) return;
    // walk back from the newest sample
    let newer = -1;
    for (let k = 0; k < p.hCount; k++) {
      const i = (p.hHead - 1 - k + HISTORY * 2) % HISTORY;
      const ti = p.hT[i];
      if (ti <= t) {
        if (newer < 0) {
          // newest sample is already older than t: use current state
          return;
        }
        const span = p.hT[newer] - ti;
        const a = span > 0 ? (t - ti) / span : 0;
        out.x = p.hX[i] + (p.hX[newer] - p.hX[i]) * a;
        out.y = p.hY[i] + (p.hY[newer] - p.hY[i]) * a;
        out.z = p.hZ[i] + (p.hZ[newer] - p.hZ[i]) * a;
        out.crouching = (a < 0.5 ? p.hFlags[i] : p.hFlags[newer]) === 1;
        return;
      }
      newer = i;
    }
    // t is older than everything we kept: use the oldest sample
    if (newer >= 0) {
      out.x = p.hX[newer];
      out.y = p.hY[newer];
      out.z = p.hZ[newer];
      out.crouching = p.hFlags[newer] === 1;
    }
  }

  // ------------------------------------------------------------------ queries for bots
  /** Line of sight between two points, also blocked by smoke clouds. */
  canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const sm of this.smokes) {
      // closest point on the segment to the cloud center
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((sm.x - ax) * abx + (sm.y - ay) * aby + (sm.z - az) * abz) / len2 : 0;
      t = clamp(t, 0, 1);
      const d = Math.hypot(ax + abx * t - sm.x, ay + aby * t - sm.y, az + abz * t - sm.z);
      if (d < SMOKE.radius * 0.85) return false;
    }
    return this.phys.lineOfSight(ax, ay, az, bx, by, bz);
  }

  // ------------------------------------------------------------------ snapshots & events
  /** Events since the last drain. The host sends them with the next snapshot. */
  drainEvents(): number[][] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Builds the compact snapshot for one recipient (pass -1 for a spectator). */
  snapshot(forIdx: number, events: number[][]): WireSnapshot {
    const p: number[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const pl = this.players[i];
      if (!pl) continue;
      const s = pl.state;
      let flags = 0;
      if (pl.alive) flags |= PF.ALIVE;
      if (s.crouching) flags |= PF.CROUCH;
      if (s.grounded) flags |= PF.GROUND;
      if (s.sprinting) flags |= PF.SPRINT;
      if (s.aiming) flags |= PF.AIM;
      if (s.reloadT > 0) flags |= PF.RELOAD;
      if (pl.alive && this.time < pl.protectedUntil) flags |= PF.PROTECTED;
      const held =
        s.slot === SLOT_PRIMARY ? weaponIndex(pl.loadout.primary)
        : s.slot === SLOT_SECONDARY ? weaponIndex(pl.loadout.secondary)
        : pl.loadout.throwable === 'grenade' ? HELD_GRENADE : HELD_SMOKE;
      p.push(
        pl.idx,
        Math.round(s.x * 100), Math.round(s.y * 100), Math.round(s.z * 100),
        Math.round(s.yaw * 1000), Math.round(s.pitch * 1000),
        flags, Math.max(0, Math.ceil(pl.health)), held,
        pl.kills, pl.deaths, pl.score, Math.round(pl.ping),
      );
    }
    const z: number[] = [];
    for (const zn of this.zones) {
      z.push(zn.owner + 1, zn.capTeam + 1, Math.round(clamp(zn.progress, 0, 0.99) * 100) + (zn.contested ? 1000 : 0));
    }
    const me = forIdx >= 0 ? this.players[forIdx] : null;
    return {
      t: Math.round(this.time * 100) / 100,
      m: [this.phase, Math.round(this.timeLeft * 10), this.scores[0], this.scores[1]],
      z,
      p,
      a: me ? me.lastSeq : 0,
      s: me ? playerStateToArray(me.state, this.stateArr).slice() : null,
      l: me ? me.life : 0,
      r: me && !me.alive ? Math.max(0, Math.round(me.respawnAt - this.time)) : 0,
      e: events,
    };
  }

  /** Final standings for the end-of-match screen. */
  standings(): Array<{ idx: number; name: string; team: TeamId; bot: boolean; kills: number; deaths: number; score: number }> {
    const out = [];
    for (const p of this.players) {
      if (p) out.push({ idx: p.idx, name: p.name, team: p.team, bot: p.isBot, kills: p.kills, deaths: p.deaths, score: p.score });
    }
    return out;
  }

  dispose(): void {
    this.phys.dispose();
  }
}

