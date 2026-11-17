import type { Appearance } from '@shared/config/appearance';
import type { TeamId } from '@shared/config/crews';
import { SNAPSHOT_EVERY, TICK_DT, TICK_MS, type ModeId } from '@shared/config/game';
import { PORCH, SQUAD_MODES, type SquadMode } from '@shared/config/porch';
import type { Loadout } from '@shared/config/weapons';
import {
  decodeSnapshot, type BotDifficulty, type MatchEndMsg, type PorchInit, type RosterEntry, type Snapshot, type WireSnapshot,
} from '@shared/protocol';
import { BOT_NAMES } from '@shared/sim/bots';
import { GameSim } from '@shared/sim/game';
import type { Rapier } from '@shared/sim/physics';
import { copyInputCmd, makeInputCmd, type InputCmd } from '@shared/sim/player';

export interface SessionHandlers {
  onSnapshot?: (snap: Snapshot) => void;
  onRoster?: (roster: RosterEntry[]) => void;
  onMatchEnd?: (msg: MatchEndMsg) => void;
  onDisconnect?: (reason: string) => void;
}

/**
 * A running match as seen by the game client. Two implementations share it:
 * LocalSession (the authoritative sim runs in this browser tab: practice vs bots) and
 * OnlineSession (a Colyseus room). The Game never needs to know which one it has.
 */
export interface Session {
  readonly kind: 'local' | 'online';
  readonly mode: ModeId;
  /** Our player index in snapshots. */
  readonly myIdx: number;
  roster: RosterEntry[];
  /** JUMP OFF THE PORCH: bags, transport route, pickups at the time we joined. */
  porch?: PorchInit;
  handlers: SessionHandlers;
  /** Round-trip time estimate in ms. */
  ping: number;
  /** Best estimate of the server's current time (ms). */
  serverTime(): number;
  sendInput(cmd: InputCmd): void;
  setLoadout(loadout: Loadout): void;
  /** Called once per rendered frame. */
  update(dt: number): void;
  leave(): void;
}

export interface LocalSessionOptions {
  mode: ModeId;
  name: string;
  loadout: Loadout;
  look?: Appearance;
  team?: TeamId;
  /** Players per crew including you (default 4 => 4v4 with 7 bots). */
  teamSize?: number;
  /** JUMP OFF THE PORCH team size (and how many players in total, bots filling the rest). */
  squads?: SquadMode;
  lobbySize?: number;
  difficulty?: BotDifficulty;
  /** Artificial one-way latency in ms (netcode testing). */
  latencyMs?: number;
  seed?: number;
  warmup?: number;
}

/**
 * Offline match: runs the exact same GameSim the server runs, in the browser.
 * Inputs and snapshots travel through the same encode/decode path as online play
 * (optionally with artificial latency) so prediction and lag compensation behave identically.
 */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly mode: ModeId;
  readonly myIdx: number;
  readonly sim: GameSim;
  roster: RosterEntry[];
  porch?: PorchInit;
  handlers: SessionHandlers = {};
  ping = 0;

  private accumulator = 0;
  private latency: number;
  private clock = 0;
  private inbox: Array<{ at: number; cmd: InputCmd }> = [];
  private outbox: Array<{ at: number; snap: WireSnapshot }> = [];
  private ended = false;
  private left = false;
  private pendingEvents: number[][] = [];

  constructor(R: Rapier, opts: LocalSessionOptions) {
    this.mode = opts.mode;
    this.latency = Math.max(0, opts.latencyMs ?? 0);
    this.ping = this.latency * 2;
    this.sim = new GameSim(R, {
      mode: opts.mode, botDifficulty: opts.difficulty ?? 'normal', seed: opts.seed, warmup: opts.warmup,
      squads: opts.squads, maxPlayers: opts.mode === 'porch' ? (opts.lobbySize ?? PORCH.lobbySize) : undefined,
    });
    if (this.sim.porch) {
      // battle royale practice: you, then bots in squads until the lobby is full
      const size = SQUAD_MODES[this.sim.porch.squadMode].size;
      const me = this.sim.addPlayer({ id: 'local', name: opts.name, team: 0, squad: 0, loadout: opts.loadout, look: opts.look })!;
      this.myIdx = me.idx;
      const names = BOT_NAMES.slice();
      for (let k = 1; k < this.sim.players.length; k++) {
        const name = names.splice(Math.floor(this.sim.rng.next() * names.length), 1)[0] ?? `Bot${k}`;
        const squad = Math.floor(k / size);
        this.sim.addPlayer({ id: `bot-${k}`, name, team: (squad % 2) as TeamId, squad, isBot: true });
      }
      this.roster = this.sim.roster();
      this.sim.start();
      this.porch = this.sim.porch.init();
      return;
    }
    const team = opts.team ?? 0;
    const size = Math.max(1, Math.min(4, opts.teamSize ?? 4));
    const me = this.sim.addPlayer({ id: 'local', name: opts.name, team, loadout: opts.loadout, look: opts.look })!;
    this.myIdx = me.idx;
    const names = BOT_NAMES.slice();
    const takeName = (): string => names.splice(Math.floor(this.sim.rng.next() * names.length), 1)[0] ?? 'Bot';
    for (const t of [0, 1] as const) {
      const have = t === team ? 1 : 0;
      for (let i = have; i < size; i++) {
        this.sim.addPlayer({ id: `bot-${t}-${i}`, name: takeName(), team: t, isBot: true });
      }
    }
    this.roster = this.sim.roster();
    this.sim.start();
  }

  serverTime(): number {
    // what a client would estimate: the latest snapshot time it could have received, extrapolated
    return this.sim.time + this.accumulator * 1000 - this.latency;
  }

  sendInput(cmd: InputCmd): void {
    if (this.left) return;
    const copy = copyInputCmd(makeInputCmd(), cmd);
    if (this.latency <= 0) this.sim.queueInput(this.myIdx, copy);
    else this.inbox.push({ at: this.clock + this.latency, cmd: copy });
  }

  setLoadout(loadout: Loadout): void {
    this.sim.setLoadout(this.myIdx, loadout);
  }

  update(dt: number): void {
    if (this.left) return;
    this.clock += dt * 1000;
    while (this.inbox.length > 0 && this.inbox[0].at <= this.clock) {
      this.sim.queueInput(this.myIdx, this.inbox.shift()!.cmd);
    }

    this.accumulator += dt;
    let n = 0;
    while (this.accumulator >= TICK_DT && n < 8) {
      this.accumulator -= TICK_DT;
      n++;
      this.sim.tick();
      const evs = this.sim.drainEvents();
      for (const e of evs) this.pendingEvents.push(e);
      if (this.sim.tickCount % SNAPSHOT_EVERY === 0) {
        const wire = this.sim.snapshot(this.myIdx, this.pendingEvents);
        this.pendingEvents = [];
        if (this.latency <= 0) this.deliver(wire);
        else this.outbox.push({ at: this.clock + this.latency, snap: wire });
      }
      if (this.sim.finished && !this.ended) {
        this.ended = true;
        this.handlers.onMatchEnd?.({
          winner: this.sim.winner,
          scores: [this.sim.scores[0], this.sim.scores[1]],
          players: this.sim.standings(),
        });
      }
    }
    if (n === 8) this.accumulator = 0;
    while (this.outbox.length > 0 && this.outbox[0].at <= this.clock) this.deliver(this.outbox.shift()!.snap);
  }

  private deliver(wire: WireSnapshot): void {
    this.handlers.onSnapshot?.(decodeSnapshot(wire));
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.sim.dispose();
  }
}

export { TICK_MS };
