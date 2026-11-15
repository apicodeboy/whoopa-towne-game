import * as THREE from 'three';
import type { ModeId } from '@shared/config/game';
import type { Loadout } from '@shared/config/weapons';
import type { BotDifficulty } from '@shared/protocol';
import type { Rapier } from '@shared/sim/physics';
import { Profile } from './core/profile';
import { SettingsStore } from './core/settings';
import { Assets } from './game/assets';
import { AudioEngine } from './game/audio';
import { verticalFov } from './game/camera';
import type { CharacterVisual } from './game/characters/characterTypes';
import { ProceduralCharacter } from './game/characters/proceduralCharacter';
import { SkinnedCharacter } from './game/characters/skinnedCharacter';
import { Game } from './game/game';
import { Stage } from './game/stage';
import { buildWorld } from './game/world/worldBuilder';
import { InputManager } from './input/inputManager';
import { TouchSource } from './input/touch';
import type { DeviceKind } from './input/types';
import { LobbyConnection, NetClient, describeJoinError } from './net/online';
import { LocalSession, type LocalSessionOptions, type Session } from './net/session';
import { LoadoutScreen } from './ui/loadoutScreen';
import { LobbyScreen } from './ui/lobbyScreen';
import { MainMenu } from './ui/mainMenu';
import { MenuNav } from './ui/menuNav';
import { ClickToPlay, PauseMenu, ResultsBar } from './ui/pauseMenu';
import { FULL_LEGEND, deviceName, legendHtml } from './ui/prompts';
import { SettingsScreen } from './ui/settingsScreen';
import { Toasts } from './ui/toast';

type AppState = 'menu' | 'lobby' | 'playing';

/** Extra knobs for automated tests (read from the URL). */
export interface DebugOptions {
  nolock?: boolean;
  latencyMs?: number;
  seed?: number;
  warmup?: number;
  teamSize?: number;
  /** Skip downloading models and use the built-in procedural visuals only. */
  procedural?: boolean;
  /** Called as each model finishes loading (or fails), for the loading screen's bar. */
  onAssetProgress?: (done: number, total: number) => void;
}

/**
 * Top-level flow: main menu -> (lobby) -> match -> results -> back.
 * Owns the persistent stage, the input devices, the menus and the network connection.
 */
export class App {
  readonly stage: Stage;
  readonly settings = new SettingsStore();
  readonly profile = new Profile();
  readonly input: InputManager;
  readonly toasts: Toasts;
  /** CC0 models (characters, weapons, vehicles, props). Optional: the game runs without them. */
  readonly assets = new Assets();
  /** Resolves when the models have loaded (or failed) and the world has been dressed with them. */
  readonly assetsReady: Promise<void>;
  game: Game | null = null;
  session: Session | null = null;
  lobby: LobbyConnection | null = null;
  state: AppState = 'menu';
  /** Synthesized sound. Silent until the first click / key / tap (browser autoplay rules). */
  readonly audio: AudioEngine;
  /** Hook for input add-ons (gamepad / touch) to react to screen changes. */
  onStateChange: ((state: AppState, paused: boolean) => void) | null = null;

  private ui: HTMLElement;
  private menu: MainMenu;
  private lobbyScreen: LobbyScreen;
  private loadoutScreen: LoadoutScreen;
  private settingsScreen: SettingsScreen;
  private pause: PauseMenu;
  private results: ResultsBar;
  private clickToPlay: ClickToPlay;
  private nav: MenuNav;
  private touch: TouchSource;
  private net: NetClient | null = null;
  private debug: DebugOptions;
  private R: Rapier;
  private backdropCam: THREE.PerspectiveCamera;
  private backdropT = Math.random() * 100;
  private raf = 0;
  private lastFrame = 0;
  private lastPractice: { mode: ModeId; difficulty: BotDifficulty } | null = null;
  private matchOver = false;

  constructor(viewport: HTMLElement, ui: HTMLElement, R: Rapier, debug: DebugOptions = {}) {
    this.ui = ui;
    this.R = R;
    this.debug = debug;
    this.stage = new Stage(viewport, R, this.settings);
    this.input = new InputManager(this.settings, viewport);
    this.audio = new AudioEngine(this.settings);
    // browsers only start audio from a user gesture: hook the first one of any kind
    const unlock = () => this.audio.unlock();
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    // menu buttons click
    ui.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button, [role="switch"]')) this.audio.ui();
    });
    if (debug.nolock) this.input.kbm.allowUnlockedLook = true;
    this.backdropCam = new THREE.PerspectiveCamera(verticalFov(80), 1, 0.5, 600);
    this.assetsReady = debug.procedural
      ? Promise.resolve()
      : this.assets.load(debug.onAssetProgress).then(() => {
          // swap the stand-in props for the real models (a running match just keeps going)
          this.stage.setWorld(buildWorld(this.stage.map, this.assets));
        }).catch(() => undefined);

    this.toasts = new Toasts(ui);
    this.menu = new MainMenu(ui, this.profile, {
      quickPlay: (mode) => void this.connect('quick', mode),
      createPrivate: (mode) => void this.connect('create', mode),
      joinWithCode: (code) => void this.connect('join', this.profile.mode, code),
      practice: (mode, difficulty) => this.startPractice(mode, difficulty),
      openLoadout: () => this.loadoutScreen.show(true),
      openSettings: () => this.settingsScreen.show(true),
    });
    this.lobbyScreen = new LobbyScreen(ui, {
      setReady: (r) => this.lobby?.setReady(r),
      switchCrew: (t) => this.lobby?.setTeam(t),
      configure: (cfg) => this.lobby?.configure(cfg),
      start: () => this.lobby?.start(),
      openLoadout: () => this.loadoutScreen.show(true),
      leave: () => void this.leaveLobby(),
      copy: (text, what) => void this.copy(text, what),
    });
    this.pause = new PauseMenu(ui, {
      resume: () => this.setPaused(false),
      openLoadout: () => this.loadoutScreen.show(true),
      openSettings: () => this.settingsScreen.show(true),
      leave: () => void this.leaveMatch(),
      endMatch: () => {
        this.lobby?.endMatch();
        this.setPaused(false);
      },
    });
    this.results = new ResultsBar(ui, {
      playAgain: () => {
        const last = this.lastPractice;
        this.endGame();
        if (last) this.startPractice(last.mode, last.difficulty);
      },
      mainMenu: () => void this.leaveMatch(),
    });
    this.clickToPlay = new ClickToPlay(ui);
    this.loadoutScreen = new LoadoutScreen(ui, this.profile, (l) => this.onLoadoutChanged(l), () => this.loadoutScreen.show(false));
    this.settingsScreen = new SettingsScreen(ui, this.settings, () => this.settingsScreen.show(false));

    // ---- controllers + touch ----
    this.nav = new MenuNav(ui);
    this.touch = new TouchSource(viewport, ui);
    this.input.attachTouch(this.touch);
    this.touch.onFirstTouch = () => this.input.noteDevice('touch');
    this.input.onDeviceChange((d) => this.onDeviceChange(d));
    this.input.gamepad.onConnection = (connected, kind) => {
      this.toasts.show(connected ? `${deviceName(kind)} connected.` : 'Controller disconnected.', connected ? 'good' : 'info', 2600);
    };
    this.onDeviceChange(this.input.device);

    this.input.kbm.onLockChange = (locked) => this.onPointerLock(locked);
    window.addEventListener('resize', () => this.resizeBackdrop());
    this.resizeBackdrop();

    const join = new URLSearchParams(location.search).get('join');
    if (join) {
      this.menu.setCode(join);
      this.toasts.show(`Invite code ${join.toUpperCase()} filled in. Pick a name and press Join with Code.`, 'info', 6000);
    }
    this.setState('menu');
    this.raf = requestAnimationFrame(this.backdropFrame);
  }

  // ------------------------------------------------------------------ state
  private setState(state: AppState): void {
    this.state = state;
    this.menu.show(state === 'menu');
    this.lobbyScreen.show(state === 'lobby');
    if (state !== 'playing') {
      this.pause.show(false);
      this.results.show(false);
      this.clickToPlay.show(false);
    }
    this.input.setGameplay(state === 'playing');
    document.body.dataset.state = state;
    this.nav.clear();
    this.updateTouchControls();
    this.onStateChange?.(state, false);
  }

  /** The player picked up a different input device: swap prompts and on-screen controls. */
  private onDeviceChange(device: DeviceKind): void {
    document.body.dataset.device = device;
    document.body.classList.toggle('is-touch', device === 'touch');
    this.pause.setLegend(`CONTROLS · ${deviceName(device).toUpperCase()}`, legendHtml(device, FULL_LEGEND));
    if (device !== 'kbm') this.input.kbm.releaseLock();
    // controller buttons fire no DOM events, so this is their chance to start the sound
    if (device !== 'kbm') this.audio.unlock();
    this.updateTouchControls();
    this.updateClickToPlay();
  }

  private updateTouchControls(): void {
    const playing = this.state === 'playing' && !!this.game && !this.game.paused && !this.matchOver;
    this.touch.setVisible(playing && this.input.device === 'touch');
  }

  /** Phones: go fullscreen + landscape when a match starts (must run inside a tap). */
  private enterFullscreen(): void {
    if (this.input.device !== 'touch') return;
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen?.();
      const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined);
      if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).then(lock, () => undefined);
    } catch {
      /* fullscreen not available (iPhone Safari): the game still works in the browser chrome */
    }
  }

  private resizeBackdrop(): void {
    const { width, height } = this.stage.gfx.resize();
    this.backdropCam.aspect = width / height;
    this.backdropCam.updateProjectionMatrix();
  }

  /** Slow fly-around of the map behind the menus. */
  private backdropFrame = (now: number): void => {
    this.raf = requestAnimationFrame(this.backdropFrame);
    if (this.game) return; // the game runs its own loop
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;
    this.backdropT += dt;
    this.nav.handle(this.input.update(dt));
    const t = this.backdropT * 0.045;
    const cam = this.backdropCam;
    cam.position.set(Math.cos(t) * 62, 26 + Math.sin(t * 1.7) * 6, Math.sin(t) * 44);
    cam.lookAt(Math.cos(t + 1.2) * 12, 2, Math.sin(t + 1.2) * 8);
    this.stage.world.update(dt, this.backdropT, cam.position);
    this.stage.gfx.followShadow(cam.position.x * 0.4, cam.position.z * 0.4);
    this.stage.gfx.render(cam);
  };

  // ------------------------------------------------------------------ online
  private async connect(kind: 'quick' | 'create' | 'join', mode: ModeId, code = ''): Promise<void> {
    this.enterFullscreen();
    const name = this.menu.commitName();
    this.menu.setBusy(true, kind === 'join' ? 'Joining lobby…' : 'Finding a lobby…');
    try {
      this.net ??= new NetClient();
      const loadout = this.profile.loadout;
      const conn =
        kind === 'quick' ? await this.net.quickPlay(mode, name, loadout)
        : kind === 'create' ? await this.net.createPrivate(mode, name, loadout)
        : await this.net.joinByCode(code, name, loadout);
      this.enterLobby(conn);
    } catch (err) {
      this.toasts.show(describeJoinError(err), 'error', 5000);
    } finally {
      this.menu.setBusy(false);
    }
  }

  private enterLobby(conn: LobbyConnection): void {
    this.lobby = conn;
    conn.onChange = (view) => {
      this.lobbyScreen.update(view);
      // the server sends everyone back to the lobby after the final scoreboard
      if (view.phase === 'lobby' && this.game && this.session?.kind === 'online') {
        this.endGame();
        conn.endSession();
        this.setState('lobby');
      }
    };
    conn.onNotice = (text) => this.toasts.show(text, 'info');
    conn.onMatchStart = (session) => this.startGame(session);
    conn.onClosed = (reason) => {
      if (this.lobby !== conn) return;
      this.lobby = null;
      this.endGame();
      this.setState('menu');
      if (reason !== 'left') this.toasts.show(reason, 'error', 6000);
    };
    this.lobbyScreen.update(conn.view());
    this.setState('lobby');
  }

  private async leaveLobby(): Promise<void> {
    const conn = this.lobby;
    this.lobby = null;
    this.endGame();
    this.setState('menu');
    await conn?.leave();
  }

  // ------------------------------------------------------------------ matches
  startPractice(mode: ModeId, difficulty: BotDifficulty): void {
    this.enterFullscreen();
    this.menu.commitName();
    this.lastPractice = { mode, difficulty };
    const opts: LocalSessionOptions = {
      mode,
      name: this.profile.name,
      loadout: this.profile.loadout,
      difficulty,
      latencyMs: this.debug.latencyMs,
      seed: this.debug.seed,
      warmup: this.debug.warmup,
      teamSize: this.debug.teamSize,
    };
    this.startGame(new LocalSession(this.R, opts));
  }

  private startGame(session: Session): void {
    this.endGame();
    this.audio.unlock();
    this.session = session;
    this.matchOver = false;
    const game = new Game({
      stage: this.stage,
      uiRoot: this.ui,
      settings: this.settings,
      input: this.input,
      session,
      loadout: this.profile.loadout,
      audio: this.audio,
      characterFactory: (team, seed) => this.makeCharacter(team, seed),
    });
    game.onPause = () => this.togglePause();
    game.onFrame = () => {
      if (!this.input.ctx.gameplay) this.nav.handle(this.input.frame);
    };
    game.onMatchOver = () => {
      this.matchOver = true;
      this.setPaused(false);
      this.input.setGameplay(false);
      this.results.show(true, session.kind === 'online');
      this.clickToPlay.show(false);
      this.input.kbm.releaseLock();
      this.updateTouchControls();
    };
    this.game = game;
    this.input.resetMatchState();
    this.touch.resetToggles();
    this.setState('playing');
    this.loadoutScreen.show(false);
    this.settingsScreen.show(false);
    this.updateClickToPlay();
    game.start();
  }

  /** Rigged CC0 character when the models are available, the procedural one otherwise. */
  private makeCharacter(team: 0 | 1, seed: number): CharacterVisual {
    const list = this.assets.characters;
    if (list.length === 0) return new ProceduralCharacter(team, seed);
    return new SkinnedCharacter(list[seed % list.length], this.assets, team);
  }

  private endGame(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    if (this.session) {
      this.session.leave();
      this.session = null;
    }
    this.input.kbm.releaseLock();
    this.pause.show(false);
    this.results.show(false);
    this.clickToPlay.show(false);
    this.lastFrame = performance.now();
  }

  private async leaveMatch(): Promise<void> {
    if (this.lobby) {
      await this.leaveLobby();
    } else {
      this.endGame();
      this.setState('menu');
    }
  }

  // ------------------------------------------------------------------ pause & pointer lock
  togglePause(): void {
    if (!this.game || this.matchOver) return;
    if (this.loadoutScreen.visible) {
      this.loadoutScreen.show(false);
      return;
    }
    if (this.settingsScreen.visible) {
      this.settingsScreen.show(false);
      return;
    }
    this.setPaused(!this.game.paused);
  }

  setPaused(paused: boolean): void {
    const game = this.game;
    if (!game) return;
    game.paused = paused;
    const view = this.lobby?.view();
    const canEnd = !!view && view.isPrivate && view.hostId === view.myId;
    this.pause.show(paused, this.session?.kind === 'online', canEnd);
    this.input.setGameplay(!paused && !this.matchOver);
    if (paused) {
      this.loadoutScreen.show(false);
      this.settingsScreen.show(false);
      this.input.kbm.releaseLock();
    } else if (this.input.device === 'kbm' && !this.matchOver) {
      this.input.kbm.requestLock();
    }
    this.updateClickToPlay();
    this.updateTouchControls();
    this.nav.clear();
    this.onStateChange?.(this.state, paused);
  }

  private onPointerLock(locked: boolean): void {
    if (!this.game) return;
    // Esc releases the pointer: treat that as opening the pause menu
    if (!locked && !this.game.paused && !this.matchOver && this.input.device === 'kbm' && !this.debug.nolock) {
      this.setPaused(true);
    }
    this.updateClickToPlay();
  }

  private updateClickToPlay(): void {
    const need =
      !!this.game && !this.game.paused && !this.matchOver && this.input.device === 'kbm' &&
      !this.input.kbm.isLocked && !this.debug.nolock;
    this.clickToPlay.show(need);
  }

  // ------------------------------------------------------------------ misc
  private onLoadoutChanged(loadout: Loadout): void {
    if (this.lobby) this.lobby.setLoadout(loadout);
    else this.session?.setLoadout(loadout);
  }

  private async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toasts.show(`${what} copied.`, 'good', 2200);
    } catch {
      this.toasts.show(`${what}: ${text}`, 'info', 8000);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.endGame();
    void this.lobby?.leave();
    this.input.dispose();
    this.stage.dispose();
  }
}
