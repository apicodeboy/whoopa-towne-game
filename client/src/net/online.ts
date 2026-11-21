import { Client, type Room } from '@colyseus/sdk';
import type { TeamId } from '@shared/config/crews';
import { ROOM_NAME, type ModeId } from '@shared/config/game';
import { encodeAppearance, type Appearance } from '@shared/config/appearance';
import { sanitizeSquadMode, type SquadMode } from '@shared/config/porch';
import type { Loadout } from '@shared/config/weapons';
import {
  MSG, decodeSnapshot, encodeInput,
  type BotDifficulty, type JoinOptions, type MatchEndMsg, type MatchStartMsg, type PorchInit, type RosterEntry, type WireSnapshot,
} from '@shared/protocol';
import type { InputCmd } from '@shared/sim/player';
import type { Session, SessionHandlers } from './session';

/** Plain-object view of the synchronized lobby state. */
export interface LobbyPlayerView {
  id: string;
  name: string;
  team: TeamId;
  ready: boolean;
  connected: boolean;
  ping: number;
  primary: string;
  throwable: string;
}

export interface LobbyView {
  phase: 'lobby' | 'playing';
  mode: ModeId;
  code: string;
  isPrivate: boolean;
  hostId: string;
  fillBots: boolean;
  botDifficulty: BotDifficulty;
  players: LobbyPlayerView[];
  myId: string;
  /** JUMP OFF THE PORCH team size, auto-start countdown (-1 = not counting) and room size. */
  squads: SquadMode;
  countdown: number;
  capacity: number;
}

interface RawLobbyState {
  phase: string;
  mode: string;
  code: string;
  isPrivate: boolean;
  hostId: string;
  fillBots: boolean;
  botDifficulty: string;
  squads?: string;
  countdown?: number;
  capacity?: number;
  players?: { forEach(cb: (p: Record<string, unknown>, key: string) => void): void };
}

/** Turns matchmaking failures into something a player can act on. */
export function describeJoinError(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (/locked/i.test(msg)) return 'That match is already in progress. Try again when it ends.';
  if (/not found|invalid room|no rooms/i.test(msg)) return 'No lobby found with that code.';
  if (/full|max(imum)? clients/i.test(msg)) return 'That lobby is full.';
  if (/fetch|network|ECONNREFUSED|Failed to|offline|timed? ?out/i.test(msg)) return 'Could not reach the game server.';
  return msg || 'Could not join the lobby.';
}

/** Where the game server lives. Override with VITE_SERVER_URL at build time or ?server= at runtime. */
export function defaultServerUrl(): string {
  const loc = typeof location !== 'undefined' ? location : null;
  if (loc) {
    const q = new URLSearchParams(loc.search).get('server');
    if (q) return q;
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  if (loc) {
    // Dev: Vite serves the client on its own port, the game server runs on 2567.
    // Production: the Node server serves the client too, so same origin works.
    const devPorts = ['5173', '5174', '4173'];
    if (devPorts.includes(loc.port)) return `${loc.protocol}//${loc.hostname}:2567`;
    return loc.origin;
  }
  return 'http://localhost:2567';
}

/** Matchmaking entry points: Quick Play, Create Private Lobby, Join with Code. */
export class NetClient {
  readonly url: string;
  /** Account session (signed-in players): the server uses their account name and owned cosmetics. */
  token: string | null = null;
  private client: Client;

  constructor(url = defaultServerUrl()) {
    this.url = url;
    this.client = new Client(url);
  }

  /** Auto-joins an open public lobby for the mode (or creates one). */
  async quickPlay(mode: ModeId, name: string, loadout: Loadout, look?: Appearance, squads?: SquadMode): Promise<LobbyConnection> {
    const opts: JoinOptions = { mode, name, loadout, look: look && encodeAppearance(look), ...(mode === 'porch' ? { squads: squads ?? 'solo' } : {}), ...this.auth() };
    return new LobbyConnection(await this.client.joinOrCreate(ROOM_NAME, opts));
  }

  /** Creates an unlisted lobby that friends join with its 6-character code. */
  async createPrivate(mode: ModeId, name: string, loadout: Loadout, look?: Appearance, squads?: SquadMode): Promise<LobbyConnection> {
    const opts: JoinOptions = { mode, name, loadout, look: look && encodeAppearance(look), private: true, ...(mode === 'porch' ? { squads: squads ?? 'solo' } : {}), ...this.auth() };
    return new LobbyConnection(await this.client.create(ROOM_NAME, opts));
  }

  async joinByCode(code: string, name: string, loadout: Loadout, look?: Appearance): Promise<LobbyConnection> {
    const opts: JoinOptions = { name, loadout, look: look && encodeAppearance(look), ...this.auth() };
    return new LobbyConnection(await this.client.joinById(code.trim().toUpperCase(), opts));
  }

  private auth(): { token?: string } {
    return this.token ? { token: this.token } : {};
  }
}

/** A joined room: the lobby (crews, ready-up, host controls) and the gateway into matches. */
export class LobbyConnection {
  readonly room: Room;
  onChange: ((view: LobbyView) => void) | null = null;
  onMatchStart: ((session: OnlineSession) => void) | null = null;
  onMatchEnd: ((msg: MatchEndMsg) => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  /** The connection to the room is gone for good. */
  onClosed: ((reason: string) => void) | null = null;
  session: OnlineSession | null = null;
  private closed = false;

  constructor(room: Room) {
    this.room = room;
    room.onStateChange(() => this.onChange?.(this.view()));
    room.onMessage(MSG.MATCH_START, (msg: MatchStartMsg) => {
      if (this.session) {
        // reconnected mid-match: keep the running session, just refresh its roster
        this.session.applyStart(msg);
        return;
      }
      this.session = new OnlineSession(room, msg);
      this.onMatchStart?.(this.session);
    });
    room.onMessage(MSG.MATCH_END, (msg: MatchEndMsg) => {
      this.session?.handlers.onMatchEnd?.(msg);
      this.onMatchEnd?.(msg);
    });
    room.onMessage(MSG.NOTICE, (msg: { text?: string }) => this.onNotice?.(String(msg?.text ?? '')));
    room.onMessage(MSG.SNAPSHOT, (wire: WireSnapshot) => this.session?.receiveSnapshot(wire));
    room.onMessage(MSG.ROSTER, (roster: RosterEntry[]) => this.session?.receiveRoster(roster));
    room.onMessage(MSG.PONG, (msg: number[]) => this.session?.receivePong(msg));
    room.onError((code, message) => this.onNotice?.(message ?? `Server error ${code}`));
    room.onLeave((code) => {
      if (this.closed) return;
      this.closed = true;
      const reason = code === 1000 || code === 4000 ? 'left' : 'Lost connection to the server.';
      this.session?.handlers.onDisconnect?.(reason);
      this.onClosed?.(reason);
    });
  }

  get code(): string {
    return this.room.roomId;
  }

  get myId(): string {
    return this.room.sessionId;
  }

  view(): LobbyView {
    const s = this.room.state as RawLobbyState | undefined;
    const players: LobbyPlayerView[] = [];
    s?.players?.forEach((p) => {
      players.push({
        id: String(p.id),
        name: String(p.name),
        team: (p.team === 1 ? 1 : 0) as TeamId,
        ready: !!p.ready,
        connected: p.connected !== false,
        ping: Number(p.ping) || 0,
        primary: String(p.primary ?? 'draco'),
        throwable: String(p.throwable ?? 'grenade'),
      });
    });
    return {
      phase: s?.phase === 'playing' ? 'playing' : 'lobby',
      mode: s?.mode === 'turf' ? 'turf' : s?.mode === 'porch' ? 'porch' : 'tdm',
      code: s?.code || this.room.roomId,
      isPrivate: !!s?.isPrivate,
      hostId: s?.hostId ?? '',
      fillBots: s?.fillBots !== false,
      botDifficulty: (s?.botDifficulty as BotDifficulty) ?? 'normal',
      players,
      myId: this.room.sessionId,
      squads: sanitizeSquadMode(s?.squads),
      countdown: typeof s?.countdown === 'number' ? s.countdown : -1,
      capacity: Number(s?.capacity) || 8,
    };
  }

  setReady(ready: boolean): void {
    this.room.send(MSG.READY, { ready });
  }

  setTeam(team: TeamId): void {
    this.room.send(MSG.TEAM, { team });
  }

  setLoadout(loadout: Loadout): void {
    this.room.send(MSG.LOADOUT, loadout);
  }

  /** Character look for the next match. */
  setLook(look: Appearance): void {
    this.room.send(MSG.LOOK, encodeAppearance(look));
  }

  configure(cfg: { mode?: ModeId; fillBots?: boolean; botDifficulty?: BotDifficulty; squads?: SquadMode }): void {
    this.room.send(MSG.CONFIG, cfg);
  }

  start(): void {
    this.room.send(MSG.START, {});
  }

  /** Host of a private lobby: end the running match now and send everyone back to the lobby. */
  endMatch(): void {
    this.room.send(MSG.END, {});
  }

  /** Called when a match is over and everyone is back in the lobby. */
  endSession(): void {
    this.session = null;
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.session = null;
    try {
      await this.room.leave(true);
    } catch {
      /* already gone */
    }
  }
}

/**
 * An online match: sends our input commands to the authoritative server and hands the
 * game its snapshots. Also keeps a smoothed estimate of the server clock (for
 * interpolation and lag-compensation timestamps) and of the round-trip time.
 */
export class OnlineSession implements Session {
  readonly kind = 'online' as const;
  mode: ModeId;
  myIdx: number;
  roster: RosterEntry[];
  porch?: PorchInit;
  bld?: number[];
  handlers: SessionHandlers = {};
  ping = 0;

  private room: Room;
  private outbox: number[] = [];
  private offset = 0;
  private synced = false;
  private pingTimer = 0;
  private left = false;

  constructor(room: Room, start: MatchStartMsg) {
    this.room = room;
    this.mode = start.mode;
    this.myIdx = start.you;
    this.roster = start.roster;
    this.porch = start.porch;
    this.bld = start.bld;
    this.offset = start.t - performance.now();
    this.synced = false;
  }

  applyStart(msg: MatchStartMsg): void {
    this.myIdx = msg.you;
    this.receiveRoster(msg.roster);
  }

  serverTime(): number {
    return performance.now() + this.offset;
  }

  /** Feeds a snapshot in: refines the clock estimate and passes it to the game. */
  receiveSnapshot(wire: WireSnapshot): void {
    if (this.left) return;
    const sample = wire.t - performance.now();
    if (!this.synced) {
      this.offset = sample;
      this.synced = true;
    } else {
      const diff = sample - this.offset;
      // snap on big jumps (stall / tab switch), otherwise glide so jitter does not shake the render clock
      if (Math.abs(diff) > 250) this.offset = sample;
      else this.offset += diff * (diff > 0 ? 0.12 : 0.04);
    }
    this.handlers.onSnapshot?.(decodeSnapshot(wire));
  }

  receiveRoster(roster: RosterEntry[]): void {
    this.roster = roster;
    this.handlers.onRoster?.(roster);
  }

  receivePong(msg: number[]): void {
    const sent = Array.isArray(msg) ? Number(msg[0]) : NaN;
    if (!Number.isFinite(sent)) return;
    const rtt = Math.max(0, performance.now() - sent);
    this.ping = this.ping === 0 ? rtt : this.ping + (rtt - this.ping) * 0.3;
  }

  sendInput(cmd: InputCmd): void {
    if (this.left) return;
    encodeInput(cmd, this.outbox);
  }

  setLoadout(loadout: Loadout): void {
    if (!this.left) this.room.send(MSG.LOADOUT, loadout);
  }

  /** Flushes this frame's commands in one message and pings every couple of seconds. */
  update(dt: number): void {
    if (this.left) return;
    if (this.outbox.length > 0) {
      this.room.send(MSG.INPUT, this.outbox);
      this.outbox = [];
    }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      this.room.send(MSG.PING, [performance.now(), Math.round(this.ping)]);
    }
  }

  /** Stop using this session (the room itself stays joined for the lobby). */
  leave(): void {
    this.left = true;
    this.handlers = {};
  }
}
