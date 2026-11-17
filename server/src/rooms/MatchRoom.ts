import { Room, matchMaker, type Client } from '@colyseus/core';
import { sanitizeAppearance, type Appearance } from '../../../shared/src/config/appearance.ts';
import type { TeamId } from '../../../shared/src/config/crews.ts';
import {
  INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, MAX_PLAYERS, MIN_PLAYERS, MODE_IDS, SNAPSHOT_EVERY, TEAM_SIZE, TICK_MS,
  sanitizeName, type ModeId,
} from '../../../shared/src/config/game.ts';
import { PORCH, SQUAD_MODES, sanitizeSquadMode, type SquadMode } from '../../../shared/src/config/porch.ts';
import { sanitizeLoadout, type Loadout } from '../../../shared/src/config/weapons.ts';
import {
  MSG, PHASE, decodeInputs, type BotDifficulty, type JoinOptions, type MatchEndMsg, type MatchStartMsg,
} from '../../../shared/src/protocol.ts';
import { BOT_NAMES } from '../../../shared/src/sim/bots.ts';
import { GameSim } from '../../../shared/src/sim/game.ts';
import { getRapier } from '../rapier.ts';
import { LobbyPlayer, LobbyState } from './schema.ts';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];
/** Seconds a dropped player may take to reconnect before their slot is released. */
const RECONNECT_SECONDS = 20;
const MAX_CATCHUP_TICKS = 5;

interface Member {
  loadout: Loadout;
  look: Appearance;
  /** Player index in the running sim (-1 in the lobby). */
  idx: number;
  joinedAt: number;
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    s += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return s;
}

/**
 * One lobby + match. Players gather (crews, ready-up), the host starts, and the room
 * then runs the authoritative GameSim at 60 Hz, feeding it client input commands and
 * sending each client a 30 Hz snapshot stream. When the match ends everyone returns
 * to the lobby in the same room.
 *
 * JUMP OFF THE PORCH rooms hold a bigger lobby (no crews: squads are formed at launch) and
 * public ones launch on their own after a countdown once enough players are waiting.
 */
export class MatchRoom extends Room<{ state: LobbyState }> {
  override maxClients = MAX_PLAYERS;
  override patchRate = 100;
  override maxMessagesPerSecond = 240;

  private members = new Map<string, Member>();
  private sim: GameSim | null = null;
  private accumulator = 0;
  private pendingEvents: number[][] = [];
  private endSent = false;
  private joinCounter = 0;
  private countdownMs = -1;

  private get porch(): boolean {
    return this.state.mode === 'porch';
  }

  override async onCreate(options: JoinOptions): Promise<void> {
    const state = new LobbyState();
    state.mode = MODE_IDS.includes(options?.mode as ModeId) ? (options.mode as ModeId) : 'tdm';
    state.isPrivate = !!options?.private;
    state.phase = 'lobby';
    state.fillBots = true;
    state.botDifficulty = 'normal';
    state.squads = sanitizeSquadMode(options?.squads);
    state.capacity = state.mode === 'porch' ? PORCH.lobbySize : MAX_PLAYERS;
    this.maxClients = state.capacity;

    // The 6-character invite code doubles as the room id, so "Join with Code" is a plain joinById.
    let code = randomCode();
    for (let i = 0; i < 20 && (await matchMaker.getRoomById(code)); i++) code = randomCode();
    this.roomId = code;
    state.code = code;
    this.state = state;

    await this.setMatchmaking({
      private: state.isPrivate,
      metadata: { mode: state.mode, squads: state.mode === 'porch' ? state.squads : undefined, code },
    });

    this.onMessage(MSG.READY, (client, msg: { ready?: boolean }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && this.state.phase === 'lobby') p.ready = !!msg?.ready;
    });

    this.onMessage(MSG.TEAM, (client, msg: { team?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== 'lobby' || this.porch) return;
      const team: TeamId = msg?.team === 1 ? 1 : 0;
      if (p.team === team || this.teamSize(team) >= TEAM_SIZE) return;
      p.team = team;
    });

    this.onMessage(MSG.LOADOUT, (client, msg: unknown) => {
      const m = this.members.get(client.sessionId);
      const p = this.state.players.get(client.sessionId);
      if (!m || !p) return;
      m.loadout = sanitizeLoadout(msg);
      p.primary = m.loadout.primary;
      p.throwable = m.loadout.throwable;
      if (this.sim && m.idx >= 0) this.sim.setLoadout(m.idx, m.loadout);
    });

    // cosmetic; stored for the next match (a running match keeps the look it started with)
    this.onMessage(MSG.LOOK, (client, msg: unknown) => {
      const m = this.members.get(client.sessionId);
      if (m) m.look = sanitizeAppearance(msg, m.look);
    });

    this.onMessage(MSG.CONFIG, (client, msg: { mode?: string; fillBots?: boolean; botDifficulty?: string; squads?: string }) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'lobby' || !msg) return;
      // Public lobbies are matched by mode, so only private lobbies may change it.
      if (this.state.isPrivate && MODE_IDS.includes(msg.mode as ModeId) && msg.mode !== this.state.mode) {
        const capacity = msg.mode === 'porch' ? PORCH.lobbySize : MAX_PLAYERS;
        if (this.state.players.size > capacity) {
          client.send(MSG.NOTICE, { text: `Too many players for that mode (max ${capacity}).` });
        } else {
          this.state.mode = msg.mode as ModeId;
          this.state.capacity = capacity;
          this.maxClients = capacity;
          void this.setMatchmaking({ metadata: { mode: this.state.mode, code: this.state.code } });
        }
      }
      if (this.state.isPrivate && msg.squads !== undefined) this.state.squads = sanitizeSquadMode(msg.squads);
      if (typeof msg.fillBots === 'boolean') this.state.fillBots = msg.fillBots;
      if (DIFFICULTIES.includes(msg.botDifficulty as BotDifficulty)) this.state.botDifficulty = msg.botDifficulty as BotDifficulty;
    });

    this.onMessage(MSG.START, (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'lobby') return;
      if (this.porch && !this.state.isPrivate) {
        // public battle royale: the host can skip the rest of the countdown
        if (this.countdownMs > 3000) this.countdownMs = 3000;
        return;
      }
      const problem = this.startProblem();
      if (problem) {
        client.send(MSG.NOTICE, { text: problem });
        return;
      }
      void this.startMatch();
    });

    this.onMessage(MSG.END, (client) => {
      // Only the host of a private lobby can call a match early.
      if (client.sessionId !== this.state.hostId || !this.state.isPrivate || !this.sim) return;
      this.sim.forceEnd();
    });

    this.onMessage(MSG.INPUT, (client, raw: unknown) => {
      const m = this.members.get(client.sessionId);
      if (!this.sim || !m || m.idx < 0) return;
      for (const cmd of decodeInputs(raw)) this.sim.queueInput(m.idx, cmd);
    });

    this.onMessage(MSG.PING, (client, msg: unknown) => {
      // [clientTime, lastMeasuredRtt]
      const arr = Array.isArray(msg) ? msg : [];
      const rtt = typeof arr[1] === 'number' && Number.isFinite(arr[1]) ? Math.max(0, Math.min(999, Math.round(arr[1]))) : 0;
      const p = this.state.players.get(client.sessionId);
      if (p) p.ping = rtt;
      const m = this.members.get(client.sessionId);
      if (this.sim && m && m.idx >= 0) {
        const sp = this.sim.players[m.idx];
        if (sp) sp.ping = rtt;
      }
      client.send(MSG.PONG, [arr[0], this.sim ? this.sim.time : 0]);
    });

    this.setSimulationInterval((dt) => this.onTick(dt), TICK_MS);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const p = new LobbyPlayer();
    p.id = client.sessionId;
    p.name = this.uniqueName(sanitizeName(options?.name));
    p.team = this.teamSize(0) <= this.teamSize(1) ? 0 : 1;
    p.ready = false;
    p.connected = true;
    const loadout = sanitizeLoadout(options?.loadout);
    p.primary = loadout.primary;
    p.throwable = loadout.throwable;
    this.state.players.set(client.sessionId, p);
    this.members.set(client.sessionId, { loadout, look: sanitizeAppearance(options?.look), idx: -1, joinedAt: this.joinCounter++ });
    if (!this.state.hostId || !this.state.players.has(this.state.hostId)) this.state.hostId = client.sessionId;
  }

  /** Connection dropped without consent: hold the seat for a while so the player can come back. */
  override async onDrop(client: Client): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      /* did not come back: onLeave handles the cleanup */
    }
  }

  override onReconnect(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
    const m = this.members.get(client.sessionId);
    if (this.sim && m && m.idx >= 0) client.send(MSG.MATCH_START, this.matchStartFor(m.idx));
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    const m = this.members.get(id);
    const lobbyPlayer = this.state.players.get(id);
    this.members.delete(id);
    this.state.players.delete(id);

    if (this.sim && m && m.idx >= 0) {
      const anyHumanLeft = this.members.size > 0;
      if (this.sim.porch) {
        // a battle royale has no stand-ins: leaving is forfeiting (the gear drops where you stood)
        this.sim.forfeit(m.idx);
      } else if (anyHumanLeft && this.state.fillBots) {
        this.sim.convertToBot(m.idx, this.botName(lobbyPlayer?.name));
      } else {
        this.sim.removePlayer(m.idx);
      }
      this.broadcast(MSG.ROSTER, this.sim.roster());
    }
    if (this.state.hostId === id) this.state.hostId = this.nextHost();
  }

  override onDispose(): void {
    this.sim?.dispose();
    this.sim = null;
  }

  // ------------------------------------------------------------------ lobby helpers
  private teamSize(team: number): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.team === team) n++;
    });
    return n;
  }

  private uniqueName(base: string): string {
    const taken = new Set<string>();
    this.state.players.forEach((p) => taken.add(p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 20; i++) {
      const candidate = `${base.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base.slice(0, 10)} ${Math.floor(Math.random() * 900 + 100)}`;
  }

  private nextHost(): string {
    let best = '';
    let bestAt = Infinity;
    for (const [id, m] of this.members) {
      if (m.joinedAt < bestAt) {
        bestAt = m.joinedAt;
        best = id;
      }
    }
    return best;
  }

  private botName(avoid?: string): string {
    const used = new Set<string>();
    if (this.sim) for (const p of this.sim.players) if (p) used.add(p.name);
    this.state.players.forEach((p) => used.add(p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n) && n !== avoid);
    return free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${Math.floor(Math.random() * 90 + 10)}`;
  }

  /** Why the match cannot start yet (empty string when it can). */
  private startProblem(): string {
    let waiting = 0;
    this.state.players.forEach((p) => {
      if (p.id !== this.state.hostId && !p.ready) waiting++;
    });
    if (waiting > 0) return waiting === 1 ? 'Waiting for 1 player to ready up.' : `Waiting for ${waiting} players to ready up.`;
    if (!this.state.fillBots && this.state.players.size < MIN_PLAYERS) {
      return `Need at least ${MIN_PLAYERS} players (or turn on "Fill with bots").`;
    }
    return '';
  }

  // ------------------------------------------------------------------ match
  private async startMatch(): Promise<void> {
    this.state.phase = 'playing';
    this.state.countdown = -1;
    this.countdownMs = -1;
    await this.lock();
    if (this.porch) {
      this.startPorch();
      return;
    }

    // Even out the crews before spawning (move the most recent joiners).
    const byJoin = [...this.members.entries()].sort((a, b) => b[1].joinedAt - a[1].joinedAt);
    for (let guard = 0; guard < MAX_PLAYERS; guard++) {
      const a = this.teamSize(0), b = this.teamSize(1);
      if (Math.abs(a - b) <= 1) break;
      const from = a > b ? 0 : 1;
      const mover = byJoin.find(([id]) => this.state.players.get(id)?.team === from);
      if (!mover) break;
      this.state.players.get(mover[0])!.team = from === 0 ? 1 : 0;
    }

    const sim = new GameSim(getRapier(), {
      mode: this.state.mode as ModeId,
      botDifficulty: this.state.botDifficulty as BotDifficulty,
    });
    for (const [id, m] of this.members) {
      const lp = this.state.players.get(id)!;
      const sp = sim.addPlayer({ id, name: lp.name, team: lp.team as TeamId, loadout: m.loadout, look: m.look });
      m.idx = sp ? sp.idx : -1;
    }
    if (this.state.fillBots) {
      const used = new Set<string>();
      this.state.players.forEach((p) => used.add(p.name));
      const names = BOT_NAMES.filter((n) => !used.has(n));
      for (const team of [0, 1] as const) {
        while (sim.teamCount(team) < TEAM_SIZE) {
          const name = names.splice(Math.floor(Math.random() * names.length), 1)[0] ?? `Bot ${sim.roster().length + 1}`;
          if (!sim.addPlayer({ id: `bot-${team}-${sim.teamCount(team)}`, name, team, isBot: true })) break;
        }
      }
    }
    sim.start();
    this.sim = sim;
    this.accumulator = 0;
    this.pendingEvents = [];
    this.endSent = false;

    for (const client of this.clients) {
      const m = this.members.get(client.sessionId);
      if (m && m.idx >= 0) client.send(MSG.MATCH_START, this.matchStartFor(m.idx));
    }
  }

  /** JUMP OFF THE PORCH: squads in join order, bots fill the rest of the lobby. */
  private startPorch(): void {
    const squads = this.state.squads as SquadMode;
    const size = SQUAD_MODES[squads].size;
    const sim = new GameSim(getRapier(), { mode: 'porch', squads, botDifficulty: this.state.botDifficulty as BotDifficulty });
    const byJoin = [...this.members.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    let k = 0;
    for (const [id, m] of byJoin) {
      const lp = this.state.players.get(id)!;
      const squad = Math.floor(k / size);
      const sp = sim.addPlayer({ id, name: lp.name, team: (squad % 2) as TeamId, squad, loadout: m.loadout, look: m.look });
      m.idx = sp ? sp.idx : -1;
      k++;
    }
    if (this.state.fillBots) {
      const used = new Set<string>();
      this.state.players.forEach((p) => used.add(p.name));
      const names = BOT_NAMES.filter((n) => !used.has(n));
      while (k < sim.players.length) {
        const squad = Math.floor(k / size);
        const name = names.splice(Math.floor(Math.random() * names.length), 1)[0] ?? `Bot ${k + 1}`;
        if (!sim.addPlayer({ id: `bot-${k}`, name, team: (squad % 2) as TeamId, squad, isBot: true })) break;
        k++;
      }
    }
    sim.start();
    this.sim = sim;
    this.accumulator = 0;
    this.pendingEvents = [];
    this.endSent = false;
    for (const client of this.clients) {
      const m = this.members.get(client.sessionId);
      if (m && m.idx >= 0) client.send(MSG.MATCH_START, this.matchStartFor(m.idx));
    }
  }

  private matchStartFor(idx: number): MatchStartMsg {
    const sim = this.sim!;
    return { mode: sim.mode, you: idx, roster: sim.roster(), t: sim.time, ...(sim.porch ? { porch: sim.porch.init() } : {}) };
  }

  /** Public battle royale lobbies launch by themselves once enough players are waiting. */
  private updateCountdown(dtMs: number): void {
    if (!this.porch || this.state.isPrivate || this.state.phase !== 'lobby') {
      if (this.state.countdown !== -1) this.state.countdown = -1;
      this.countdownMs = -1;
      return;
    }
    if (this.state.players.size < PORCH.minHumansToStart) {
      this.countdownMs = -1;
      if (this.state.countdown !== -1) this.state.countdown = -1;
      return;
    }
    if (this.countdownMs < 0) this.countdownMs = PORCH.startCountdown * 1000;
    // a full lobby goes right away
    if (this.state.players.size >= this.state.capacity) this.countdownMs = Math.min(this.countdownMs, 3000);
    this.countdownMs -= dtMs;
    const secs = Math.max(0, Math.ceil(this.countdownMs / 1000));
    if (this.state.countdown !== secs) this.state.countdown = secs;
    if (this.countdownMs <= 0) void this.startMatch();
  }

  private onTick(dtMs: number): void {
    this.updateCountdown(dtMs);
    const sim = this.sim;
    if (!sim) return;
    this.accumulator += dtMs;
    let n = 0;
    while (this.accumulator >= TICK_MS && n < MAX_CATCHUP_TICKS) {
      this.accumulator -= TICK_MS;
      n++;
      sim.tick();
      const evs = sim.drainEvents();
      for (const e of evs) this.pendingEvents.push(e);
      if (sim.tickCount % SNAPSHOT_EVERY === 0) this.sendSnapshots(sim);
    }
    if (n === MAX_CATCHUP_TICKS) this.accumulator = 0; // do not spiral after a hitch

    if (sim.phase === PHASE.ENDED && !this.endSent) {
      this.endSent = true;
      const msg: MatchEndMsg = { winner: sim.winner, scores: [sim.scores[0], sim.scores[1]], players: sim.standings() };
      this.broadcast(MSG.MATCH_END, msg);
    }
    if (sim.finished) void this.backToLobby();
  }

  private sendSnapshots(sim: GameSim): void {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const client of this.clients) {
      const m = this.members.get(client.sessionId);
      if (!m || m.idx < 0) continue;
      client.send(MSG.SNAPSHOT, sim.snapshot(m.idx, events));
    }
  }

  private async backToLobby(): Promise<void> {
    this.sim?.dispose();
    this.sim = null;
    for (const m of this.members.values()) m.idx = -1;
    this.state.players.forEach((p) => {
      p.ready = false;
    });
    this.state.phase = 'lobby';
    await this.unlock();
  }
}
