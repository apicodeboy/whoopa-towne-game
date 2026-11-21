import type { Application } from 'express';
import type { ScoreGame, ScoresMsg } from '../../shared/src/index.ts';

/**
 * Live sports scores for the in-game billboards, read from ESPN's public scoreboard feeds.
 *
 * The game server does the asking, not the players' browsers: nothing about a player is ever
 * sent anywhere, there is no cross-origin trouble, and however many people are playing, ESPN
 * hears from this server at most once a minute per league. The answer is kept for a minute
 * (and the last good one is kept for as long as the feed is down).
 *
 * Turn it off with SCORES=off; point it elsewhere (a mirror, a mock) with SCORES_FEED_URL,
 * where {path} is replaced by e.g. `basketball/nba`.
 */
export const SCORE_FEEDS: ReadonlyArray<readonly [league: string, path: string]> = [
  ['NBA', 'basketball/nba'],
  ['NFL', 'football/nfl'],
  ['MLB', 'baseball/mlb'],
  ['NHL', 'hockey/nhl'],
  ['WNBA', 'basketball/wnba'],
  ['NCAAF', 'football/college-football'],
  ['NCAAM', 'basketball/mens-college-basketball'],
];
const DEFAULT_URL = 'https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard';
const TTL_MS = 60_000;
const TIMEOUT_MS = 5000;
const PER_LEAGUE = 8;
const MAX_GAMES = 40;

export interface ScoresOptions {
  /** The fetch to use (tests pass a fake). */
  fetch?: (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  now?: () => number;
  url?: string;
  enabled?: boolean;
}

/** Text from a feed, made safe to show: printable characters only, cut to a sane length. */
function clean(v: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

/** Picks the games out of one ESPN scoreboard answer. Anything malformed is skipped. */
export function parseScoreboard(league: string, body: unknown): ScoreGame[] {
  const out: ScoreGame[] = [];
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return out;
  for (const ev of events) {
    const comp = (ev as { competitions?: unknown[] })?.competitions?.[0] as { competitors?: unknown[]; status?: unknown } | undefined;
    const teams = comp?.competitors;
    if (!Array.isArray(teams) || teams.length < 2) continue;
    const side = (which: string) => teams.find((t) => (t as { homeAway?: string })?.homeAway === which) as { team?: { abbreviation?: unknown; shortDisplayName?: unknown }; score?: unknown } | undefined;
    const home = side('home'), away = side('away');
    if (!home || !away) continue;
    const st = ((comp?.status ?? (ev as { status?: unknown }).status) as { type?: { state?: unknown; shortDetail?: unknown; description?: unknown } } | undefined)?.type;
    const state = st?.state === 'in' ? 'in' : st?.state === 'post' ? 'post' : 'pre';
    const name = (t: typeof home) => clean(t?.team?.abbreviation, 6) || clean(t?.team?.shortDisplayName, 6).toUpperCase();
    const a = name(away), h = name(home);
    if (!a || !h) continue;
    out.push({
      league,
      away: a,
      home: h,
      awayScore: state === 'pre' ? '' : clean(away.score, 4),
      homeScore: state === 'pre' ? '' : clean(home.score, 4),
      status: clean(st?.shortDetail, 22) || clean(st?.description, 22),
      state,
    });
    if (out.length >= PER_LEAGUE) break;
  }
  return out;
}

export class Scores {
  private games: ScoreGame[] = [];
  private at = 0;
  private checked = -Infinity;
  private inFlight: Promise<void> | null = null;
  private readonly fetch: NonNullable<ScoresOptions['fetch']>;
  private readonly now: () => number;
  private readonly url: string;
  readonly enabled: boolean;

  constructor(opts: ScoresOptions = {}) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    this.url = opts.url ?? process.env.SCORES_FEED_URL ?? DEFAULT_URL;
    this.enabled = opts.enabled ?? process.env.SCORES !== 'off';
  }

  /** The current scores (refreshed first if they are over a minute old). Never throws. */
  async get(): Promise<ScoresMsg> {
    if (this.enabled && this.now() - this.checked >= TTL_MS) {
      this.inFlight ??= this.refresh().finally(() => (this.inFlight = null));
      // the first answer is worth waiting for; after that, serve what we have while it reloads
      if (this.at === 0) await this.inFlight;
    }
    return { games: this.games, at: this.at };
  }

  private async refresh(): Promise<void> {
    this.checked = this.now();
    const results = await Promise.all(SCORE_FEEDS.map(async ([league, path]) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        // a plain anonymous read: no cookies, no player or server details
        const res = await this.fetch(this.url.replace('{path}', path), { signal: ctl.signal, headers: { Accept: 'application/json', 'User-Agent': 'scoreboard-client' } });
        if (!res.ok) return null;
        return parseScoreboard(league, await res.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }));
    // keep the last good answer unless at least one league answered
    if (results.every((r) => r === null)) return;
    const games: ScoreGame[] = [];
    // live games first, then finished, then upcoming; leagues in feed order within each
    for (const want of ['in', 'post', 'pre'] as const) {
      for (const r of results) for (const g of r ?? []) if (g.state === want && games.length < MAX_GAMES) games.push(g);
    }
    this.games = games;
    this.at = this.now();
  }
}

/** GET /api/scores: the scoreboard billboards read this. Public, read-only, cacheable. */
export function setupScores(app: Application, scores = new Scores()): Scores {
  app.get('/api/scores', (_req, res) => {
    void scores.get().then((msg) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(msg);
    });
  });
  return scores;
}
