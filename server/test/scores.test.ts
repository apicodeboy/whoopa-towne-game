import { assert, test } from '../../shared/test/harness.ts';
import { SCORE_FEEDS, Scores, parseScoreboard } from '../src/scores.ts';

/** A cut-down scoreboard answer in the feed's shape. */
const board = (games: Array<[string, string, string, string, string, string]>) => ({
  events: games.map(([away, as, home, hs, state, detail]) => ({
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { abbreviation: home }, score: hs },
        { homeAway: 'away', team: { abbreviation: away }, score: as },
      ],
      status: { type: { state, shortDetail: detail } },
    }],
  })),
});

test('scores: a scoreboard answer becomes games; junk is skipped and text is cleaned', () => {
  const games = parseScoreboard('NBA', board([['LAL', '102', 'BOS', '99', 'post', 'Final'], ['NYK', '0', 'MIA', '0', 'pre', '7:30 PM ET'], ['DEN', '55', 'PHX', '61', 'in', 'Q3 5:12']]));
  assert(games.length === 3, `three games (${games.length})`);
  assert(games[0].away === 'LAL' && games[0].home === 'BOS' && games[0].awayScore === '102' && games[0].homeScore === '99' && games[0].state === 'post', 'final score read');
  assert(games[1].awayScore === '' && games[1].status === '7:30 PM ET', 'no score before tip-off');
  assert(games[2].state === 'in' && games[2].status === 'Q3 5:12', 'live game');
  assert(parseScoreboard('NBA', null).length === 0 && parseScoreboard('NBA', { events: [{}, { competitions: [{ competitors: [{}] }] }] }).length === 0, 'malformed answers give nothing');
  const odd = parseScoreboard('X', board([['<b>A\u0007', '1', 'A-VERY-LONG-NAME', '2', 'post', 'Final '.repeat(20)]]));
  assert(odd[0].away === 'bA' && odd[0].home.length <= 6 && odd[0].status.length <= 22, `cleaned: ${JSON.stringify(odd[0])}`);
});

test('scores: one read per league a minute, live games first, the last good answer survives an outage', async () => {
  let now = 1_000_000, calls = 0, down = false;
  const urls: string[] = [];
  const scores = new Scores({
    enabled: true,
    now: () => now,
    url: 'https://feed.test/{path}',
    fetch: async (url, init) => {
      calls++;
      urls.push(url);
      assert(init?.headers?.['User-Agent'] === 'scoreboard-client' && !('Cookie' in (init?.headers ?? {})), 'an anonymous request');
      if (down) throw new Error('network down');
      if (url.endsWith('basketball/nba')) return { ok: true, json: async () => board([['LAL', '102', 'BOS', '99', 'post', 'Final'], ['DEN', '55', 'PHX', '61', 'in', 'Q3 5:12']]) };
      if (url.endsWith('football/nfl')) return { ok: true, json: async () => board([['KC', '', 'BUF', '', 'pre', 'Sun 1:00 PM']]) };
      return { ok: false, json: async () => ({}) };
    },
  });
  const first = await scores.get();
  assert(calls === SCORE_FEEDS.length && urls.includes('https://feed.test/basketball/nba'), `one request per league (${calls})`);
  assert(first.games.length === 3 && first.at === now, 'three games');
  assert(first.games[0].state === 'in' && first.games[1].state === 'post' && first.games[2].state === 'pre', 'live, then final, then upcoming');
  // within the minute: no new requests
  now += 30_000;
  await scores.get();
  assert(calls === SCORE_FEEDS.length, 'cached for a minute');
  // after it, the feed is down: the old scores are still served
  now += 40_000;
  down = true;
  await scores.get();
  await new Promise((r) => setTimeout(r, 20));
  const later = await scores.get();
  assert(calls === SCORE_FEEDS.length * 2, 'asked again after a minute');
  assert(later.games.length === 3 && later.at === first.at, 'kept the last good scores');
  // switched off: never asks
  const off = new Scores({ enabled: false, fetch: async () => { throw new Error('should not be called'); } });
  assert((await off.get()).games.length === 0, 'off means off');
});
