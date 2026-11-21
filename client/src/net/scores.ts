import type { ScoresMsg } from '@shared/protocol';

/**
 * Live scores for the billboards. Asks the game server (which reads ESPN's public feed and
 * keeps it for a minute): the browser never talks to anyone but our own server.
 */
export class ScoreFeed {
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopped = false;

  /** `onScores(null)` means the feed cannot be reached right now. */
  constructor(private serverUrl: string, private onScores: (msg: ScoresMsg | null) => void, private everyMs = 60_000) {}

  start(): void {
    if (this.timer) return;
    void this.load();
    this.timer = setInterval(() => void this.load(), this.everyMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl.replace(/\/$/, '')}/api/scores`, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const msg = (await res.json()) as ScoresMsg;
      if (this.stopped) return;
      if (!msg || !Array.isArray(msg.games)) throw new Error('bad answer');
      this.failures = 0;
      this.onScores(msg);
    } catch {
      // keep showing the last scores through a blip; say so after two misses in a row
      if (!this.stopped && ++this.failures >= 2) this.onScores(null);
    }
  }
}
