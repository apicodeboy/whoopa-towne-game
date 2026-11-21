import RAPIER from '@dimforge/rapier3d-compat';
import './styles/base.css';
import './styles/hud.css';
import './styles/menu.css';
import './styles/creator.css';
import './styles/porch.css';
import './styles/touch.css';
import './styles/theme.css';
import './styles/mainmenu.css';
import './styles/economy.css';
import './styles/menutheme.css';
import './styles/gunpicker.css';
import { CREWS } from '@shared/config/crews';
import type { ModeId } from '@shared/config/game';
import type { BotDifficulty } from '@shared/protocol';
import { App } from './app';
import { LoadingScreen } from './ui/loadingScreen';

/** Extra time the loading screen stays up after everything is ready, to show off the artwork. */
const ARTWORK_HOLD_MS = 5000;
/** Never keep players on the loading screen longer than this waiting for models (they still swap in later). */
const MAX_ASSET_WAIT_MS = 20000;

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
  // bar: physics engine 0-15%, models 15-70%, then the artwork hold fills the rest
  const loading = new LoadingScreen(document.getElementById('loading'));
  loading.set(0.05);
  await RAPIER.init();
  loading.set(0.15);

  const q = new URLSearchParams(location.search);
  if (q.get('debug') === 'assets') {
    // developer-only model viewer, loaded on demand so it never ships in the main bundle path
    loading.remove();
    const { runAssetViewer } = await import('./debug/assetViewer');
    await runAssetViewer(viewport);
    return;
  }
  if (q.get('debug') === 'ink') {
    // developer-only: the raw Urban Ink character GLB (tools/characters)
    loading.remove();
    const { runInkViewer } = await import('./debug/inkViewer');
    await runInkViewer(viewport);
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
    onAssetProgress: (done, total) => loading.set(0.15 + 0.55 * (done / total)),
  });
  // automated runs skip the hold (?loadhold=<ms> overrides, e.g. to screenshot the screen)
  const holdMs = q.has('loadhold') ? num('loadhold') ?? 0 : navigator.webdriver || q.has('auto') ? 0 : ARTWORK_HOLD_MS;
  void Promise.race([app.assetsReady, new Promise((r) => setTimeout(r, MAX_ASSET_WAIT_MS))]).then(() =>
    loading.finish(holdMs),
  );

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
