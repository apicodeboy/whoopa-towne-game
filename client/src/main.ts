import RAPIER from '@dimforge/rapier3d-compat';
import './styles/base.css';
import './styles/hud.css';
import './styles/menu.css';
import './styles/touch.css';
import { CREWS } from '@shared/config/crews';
import type { ModeId } from '@shared/config/game';
import type { BotDifficulty } from '@shared/protocol';
import { App } from './app';

/** Feeds the crew palette from shared/src/config/crews.ts into the stylesheets (--crew0, --crew0-dark, ...). */
function applyCrewTheme(): void {
  const style = document.documentElement.style;
  for (const crew of CREWS) {
    style.setProperty(`--crew${crew.id}`, crew.color);
    style.setProperty(`--crew${crew.id}-dark`, crew.dark);
    style.setProperty(`--crew${crew.id}-light`, crew.light);
  }
}

async function boot(): Promise<void> {
  applyCrewTheme();
  const viewport = document.getElementById('viewport')!;
  const ui = document.getElementById('ui')!;
  const loading = document.getElementById('loading');
  await RAPIER.init();

  const q = new URLSearchParams(location.search);
  if (q.get('debug') === 'assets') {
    // developer-only model viewer, loaded on demand so it never ships in the main bundle path
    loading?.remove();
    const { runAssetViewer } = await import('./debug/assetViewer');
    await runAssetViewer(viewport);
    return;
  }
  const num = (key: string): number | undefined => (q.has(key) ? Number(q.get(key)) : undefined);
  const app = new App(viewport, ui, RAPIER, {
    nolock: q.has('nolock'),
    latencyMs: num('latency'),
    seed: num('seed'),
    warmup: num('warmup'),
    teamSize: num('size'),
    procedural: q.has('procedural'),
  });
  loading?.remove();

  // Automation / debugging handle and shortcuts (?auto=practice&mode=turf&diff=hard)
  const handle = {
    app,
    input: app.input,
    settings: app.settings,
    get game() {
      return app.game;
    },
    get session() {
      return app.session;
    },
    get lobby() {
      return app.lobby;
    },
  };
  (window as unknown as Record<string, unknown>).__whoopa = handle;
  if (q.get('auto') === 'practice') {
    await app.assetsReady;
    const mode: ModeId = q.get('mode') === 'turf' ? 'turf' : 'tdm';
    const diff = (['easy', 'normal', 'hard'].includes(q.get('diff') ?? '') ? q.get('diff') : 'normal') as BotDifficulty;
    app.startPractice(mode, diff);
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:20px;z-index:99;color:#f88;white-space:pre-wrap">Failed to start: ${String(err?.stack ?? err)}</pre>`,
  );
});
