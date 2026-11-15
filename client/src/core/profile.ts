import { NAME_MAX_LENGTH, sanitizeName, type ModeId } from '@shared/config/game';
import { DEFAULT_LOADOUT, sanitizeLoadout, type Loadout } from '@shared/config/weapons';
import type { BotDifficulty } from '@shared/protocol';

const KEY = 'whoopa.profile.v1';

interface Saved {
  name?: string;
  loadout?: unknown;
  mode?: string;
  difficulty?: string;
}

/**
 * The player's local identity. There are no accounts: the display name, saved loadout and
 * last-used menu choices live in this browser's localStorage.
 */
export class Profile {
  name: string;
  loadout: Loadout;
  /** Last mode picked on the main menu. */
  mode: ModeId = 'tdm';
  /** Bot difficulty for practice matches. */
  difficulty: BotDifficulty = 'normal';
  private listeners = new Set<() => void>();

  constructor() {
    this.name = `Player${Math.floor(Math.random() * 9000 + 1000)}`;
    this.loadout = { ...DEFAULT_LOADOUT };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (typeof s.name === 'string' && s.name.trim()) this.name = sanitizeName(s.name);
        this.loadout = sanitizeLoadout(s.loadout);
        if (s.mode === 'tdm' || s.mode === 'turf') this.mode = s.mode;
        if (s.difficulty === 'easy' || s.difficulty === 'normal' || s.difficulty === 'hard') this.difficulty = s.difficulty;
      }
    } catch {
      /* first run or storage blocked */
    }
  }

  setName(raw: string): string {
    this.name = sanitizeName(raw.slice(0, NAME_MAX_LENGTH + 4));
    this.save();
    return this.name;
  }

  setLoadout(loadout: Loadout): void {
    this.loadout = sanitizeLoadout(loadout);
    this.save();
    for (const l of this.listeners) l();
  }

  setMode(mode: ModeId): void {
    this.mode = mode;
    this.save();
  }

  setDifficulty(d: BotDifficulty): void {
    this.difficulty = d;
    this.save();
  }

  onLoadoutChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: this.name, loadout: this.loadout, mode: this.mode, difficulty: this.difficulty }));
    } catch {
      /* ignore */
    }
  }
}
