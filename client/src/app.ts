import * as THREE from 'three';
import { botAppearance, decodeAppearance, encodeAppearance, isPremiumOption, type Appearance } from '@shared/config/appearance';
import { unlocksOf, type StoreCategory } from '@shared/config/economy';
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
import { LookBuilder } from './game/characters/look/assemble';
import { SkinnedCharacter } from './game/characters/skinnedCharacter';
import { Game } from './game/game';
import { Stage } from './game/stage';
import { buildWorld } from './game/world/worldBuilder';
import { mapForMode } from '@shared/map/maps';
import { InputManager } from './input/inputManager';
import { TouchSource } from './input/touch';
import type { DeviceKind } from './input/types';
import { AccountService } from './net/account';
import { LobbyConnection, NetClient, describeJoinError } from './net/online';
import { LocalSession, type LocalSessionOptions, type Session } from './net/session';
import { CharacterScreen } from './ui/characterScreen';
import { bindings } from './input/bindings';
import { AjTalk } from './ui/ajTalk';
import { AuthModal, GramsScreen, StoreScreen, TrapScreen } from './ui/economyScreens';
import { GunPicker } from './ui/gunPicker';
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
  /** Builds character bodies from looks (cached per look). */
  readonly looks = new LookBuilder(() => this.assets.characters);
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
  /** The weapon collection: browse the guns, set the loadout, buy and wear skins. */
  private loadoutScreen!: GunPicker;
  private characterScreen: CharacterScreen;
  /** GRAMS / AJ's / TRAP. */
  readonly account = new AccountService();
  private auth!: AuthModal;
  private gramsScreen!: GramsScreen;
  private storeScreen!: StoreScreen;
  private trapScreen!: TrapScreen;
  /** The signed-in account whose saved look has been put on already. */
  private lookFrom: string | null = null;
  /** Talking to AJ in free roam (his greeting and options). */
  private ajTalk!: AjTalk;
  /** A store screen was opened from AJ's counter: the walk resumes when it closes. */
  private shopFromWorld = false;
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
    // character ink outlines: off on low quality / performance mode (they double each character's cost)
    const outlines = () => (SkinnedCharacter.outlines = this.settings.values.quality !== 'low' && !this.settings.values.performanceMode);
    outlines();
    this.settings.onChange(outlines);
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
          this.wantThumbs = true;
        }).catch(() => undefined);

    this.toasts = new Toasts(ui);
    this.menu = new MainMenu(ui, this.profile, {
      quickPlay: (mode) => void this.connect('quick', mode),
      createPrivate: (mode) => void this.connect('create', mode),
      joinWithCode: (code) => void this.connect('join', this.profile.mode, code),
      practice: (mode, difficulty) => this.startPractice(mode, difficulty),
      openCharacter: () => this.characterScreen.show(true),
      openLoadout: () => this.loadoutScreen.show(true),
      openSettings: () => this.settingsScreen.show(true),
      openStore: () => this.openStore(),
      openTrap: () => this.trapScreen.show(true),
      openGrams: () => this.openGrams(),
      signIn: () => this.auth.open(),
      signOut: () => void this.account.logout(),
    });
    this.lobbyScreen = new LobbyScreen(ui, {
      setReady: (r) => this.lobby?.setReady(r),
      switchCrew: (t) => this.lobby?.setTeam(t),
      configure: (cfg) => this.lobby?.configure(cfg),
      start: () => this.lobby?.start(),
      openCharacter: () => this.characterScreen.show(true),
      openLoadout: () => this.loadoutScreen.show(true),
      leave: () => void this.leaveLobby(),
      copy: (text, what) => void this.copy(text, what),
    });
    this.pause = new PauseMenu(ui, {
      resume: () => this.setPaused(false),
      openLoadout: () => this.loadoutScreen.show(true),
      openSettings: () => this.settingsScreen.show(true),
      openTrap: () => this.trapScreen.show(true),
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
    this.settingsScreen = new SettingsScreen(ui, this.settings, () => this.settingsScreen.show(false));
    this.characterScreen = new CharacterScreen(ui, {
      profile: this.profile,
      build: (look) => this.makeCharacter(0, 0, look),
      // a kept look goes to the lobby right away (it shows from the next match) and to the account
      onKeep: (look) => {
        this.lobby?.setLook(look);
        if (this.account.signedIn) void this.account.equip(encodeAppearance(look)).catch(() => undefined);
      },
      onClose: () => this.characterScreen.show(false),
      owns: (field, option) => this.ownedKeys().has(`${field}:${option}`),
      openStore: () => this.openStore(),
      openTrap: () => this.trapScreen.show(true),
    });
    // ---- GRAMS, AJ's, TRAP ----
    const ecoDeps = {
      account: this.account,
      profile: this.profile,
      build: (look: Appearance) => this.makeCharacter(0, 0, look),
      applyLook: (look: Appearance) => this.applyLook(look),
    };
    this.auth = new AuthModal(ui, this.account);
    this.gramsScreen = new GramsScreen(ui, { ...ecoDeps, auth: this.auth });
    const openGrams = () => this.openGrams();
    this.storeScreen = new StoreScreen(ui, { ...ecoDeps, auth: this.auth, openGrams, openTrap: () => this.trapScreen.show(true) });
    this.trapScreen = new TrapScreen(ui, { ...ecoDeps, auth: this.auth, openGrams, openStore: () => this.openStore() });
    this.loadoutScreen = new GunPicker(ui, {
      profile: this.profile,
      account: this.account,
      build: (look) => this.makeCharacter(0, 0, look),
      onLoadout: (l) => this.onLoadoutChanged(l),
      applyLook: (look) => this.applyLook(look),
      signIn: (then) => this.auth.open(then, 'register'),
      openGrams,
      device: () => this.input.device,
      assets: () => this.assets,
      onClose: () => undefined,
    });
    this.ajTalk = new AjTalk(ui, {
      shop: () => this.fromCounter(() => this.openStore()),
      grams: () => this.fromCounter(() => this.openGrams()),
      preview: () => this.fromCounter(() => this.openStore('outfits')),
      leave: () => this.resumeFromCounter(),
    }, () => this.game?.talkToAj());
    this.storeScreen.setWalkIn(() => this.startRoam(), () => !this.game && !this.lobby);
    this.account.onChange(() => this.onAccountChange());
    void this.account.init();
    // the preview starts with the stand-in figure if the models are still downloading
    void this.assetsReady.then(() => this.characterScreen.rebuild());

    // ---- controllers + touch ----
    this.nav = new MenuNav(ui);
    this.touch = new TouchSource(viewport, ui);
    this.input.attachTouch(this.touch);
    this.touch.onFirstTouch = () => this.input.noteDevice('touch');
    this.input.onDeviceChange((d) => this.onDeviceChange(d));
    // new key / button assignments: every on-screen glyph follows
    bindings.onChange(() => {
      this.onDeviceChange(this.input.device);
      this.game?.hud.setDevice(this.input.device, true);
    });
    this.input.gamepad.onConnection = (connected, kind) => {
      this.toasts.show(connected ? `${deviceName(kind)} connected.` : 'Controller disconnected.', connected ? 'good' : 'info', 2600);
      // a controller just plugged in: every prompt shows its buttons straight away
      if (connected) this.input.noteDevice(kind);
      else if (this.input.usingPad) this.input.noteDevice('kbm');
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

  // ------------------------------------------------------------------ GRAMS / AJ's / TRAP
  private ownedKeys(): Set<string> {
    return unlocksOf(this.account.account?.owned ?? [], isPremiumOption);
  }

  openStore(category?: StoreCategory): void {
    this.storeScreen.openAt(category);
  }

  openGrams(): void {
    if (!this.account.signedIn) {
      this.auth.open(() => this.gramsScreen.show(true), 'register');
      return;
    }
    this.gramsScreen.show(true);
  }

  // ------------------------------------------------------------------ free roam + AJ at the counter
  /** Greater Whoopa Towne to yourself, starting out front of AJ'S (no bots, no clock). */
  startRoam(): void {
    this.storeScreen.show(false);
    this.trapScreen.show(false);
    this.gramsScreen.show(false);
    this.enterFullscreen();
    this.menu.commitName();
    this.startGame(new LocalSession(this.R, {
      mode: 'tdm', roam: true, name: this.profile.name, loadout: this.profile.loadout, look: this.profile.look, seed: this.debug.seed,
    }));
    this.toasts.show("Free roam: walk into AJ'S and talk to AJ at the register.", 'info', 4200);
  }

  /** At the counter: the game holds still while AJ talks. */
  private openAjTalk(): void {
    const game = this.game;
    if (!game || game.paused || this.matchOver) return;
    game.paused = true;
    this.input.setGameplay(false);
    this.input.kbm.releaseLock();
    this.ajTalk.open();
    this.updateClickToPlay();
  }

  private fromCounter(open: () => void): void {
    this.ajTalk.close();
    this.shopFromWorld = true;
    open();
  }

  private resumeFromCounter(): void {
    this.ajTalk.close();
    this.shopFromWorld = false;
    if (this.game?.paused) this.setPaused(false);
  }

  /** Any store / sign-in screen still open? */
  private ecoOpen(): boolean {
    return !!this.ui.querySelector('.screen.eco:not(.hidden), .eco-auth-wrap:not(.hidden)');
  }

  /** Wear a look: the profile keeps it, the lobby gets it for the next match. */
  private applyLook(look: Appearance): void {
    this.profile.setLook(look);
    this.lobby?.setLook(look);
    this.game?.setMyLook(look);
    this.characterScreen.rebuild();
  }

  private onAccountChange(): void {
    const a = this.account.account;
    this.menu.setAccount(a ? { username: a.username, balance: a.balance } : null);
    if (this.net) this.net.token = this.account.session;
    // just signed in: put on the look saved on the account (from any device)
    if (a && this.lookFrom !== a.username) {
      this.lookFrom = a.username;
      if (a.look) this.applyLook(decodeAppearance(a.look, this.profile.look));
    }
    if (!a) this.lookFrom = null;
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
    if (device === 'xbox' || device === 'playstation' || device === 'gamepad') this.settingsScreen.padKind = device;
    document.body.dataset.device = device;
    document.body.classList.toggle('is-touch', device === 'touch');
    this.menu.setDevice(device);
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

  /** Pictures of the town for the menu's mode cards (taken once the real art has loaded). */
  private wantThumbs = false;

  private captureMenuThumbs(): void {
    this.wantThumbs = false;
    const cam = new THREE.PerspectiveCamera(55, 1, 0.3, 500);
    const shoot = (from: [number, number, number], at: [number, number, number], w = 480, h = 400): string => {
      cam.position.set(...from);
      cam.lookAt(...at);
      this.stage.world.update(0, this.backdropT, cam.position);
      this.stage.gfx.followShadow(at[0], at[2]);
      return this.stage.gfx.snapshot(cam, w, h);
    };
    try {
      this.menu.setThumbs({
        tdm: shoot([24, 10, 15], [2, 0.5, -6]),
        turf: shoot([-29, 7.5, 41], [-46, 0.5, 24]),
        lobby: shoot([-14, 15, 48], [6, 0, 26]),
      });
    } catch {
      // no pictures: the cards fall back to their drawn art
    }
  }

  /** Slow fly-around of the map behind the menus. */
  private backdropFrame = (now: number): void => {
    this.raf = requestAnimationFrame(this.backdropFrame);
    if (this.game) return; // the game runs its own loop
    if (this.wantThumbs) this.captureMenuThumbs();
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
      this.net.token = this.account.session;
      const { loadout, look, squads } = this.profile;
      const conn =
        kind === 'quick' ? await this.net.quickPlay(mode, name, loadout, look, squads)
        : kind === 'create' ? await this.net.createPrivate(mode, name, loadout, look, squads)
        : await this.net.joinByCode(code, name, loadout, look);
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
      look: this.profile.look,
      squads: this.profile.squads,
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
    this.stage.useMap(session.map ?? mapForMode(session.mode), this.assets);
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
      characterFactory: (team, seed, look) => this.makeCharacter(team, seed, look),
      assets: this.assets,
      prewarmLooks: (looks) => {
        for (const l of looks) this.looks.build(l);
      },
    });
    game.onPause = () => this.togglePause();
    game.onFrame = () => {
      if (!this.input.ctx.gameplay) this.nav.handle(this.input.frame);
      this.ajTalk.prompt(game.canTalkToAj, this.input.device);
      // shopping from AJ's counter: back to walking around once the last store screen closes
      if (this.shopFromWorld && !this.ajTalk.visible && !this.ecoOpen()) this.resumeFromCounter();
    };
    game.onTalkToAj = () => this.openAjTalk();
    game.onLeaveRequest = () => void this.leaveMatch();
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
    this.characterScreen.show(false);
    this.updateClickToPlay();
    game.start();
  }

  /**
   * A character built from a look (Character Creator) on the rigged CC0 models, or the
   * procedural stand-in while / if the models are unavailable. Servers that send no look get
   * a stable random one per slot.
   */
  private makeCharacter(team: 0 | 1, seed: number, look?: Appearance): CharacterVisual {
    const l = look ?? botAppearance('Player', seed);
    return SkinnedCharacter.create(this.looks, this.assets, team, l) ?? new ProceduralCharacter(team, seed, l);
  }

  private endGame(): void {
    this.ajTalk?.close();
    this.ajTalk?.prompt(false, '');
    this.shopFromWorld = false;
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
    // at AJ's counter / in the store: Escape (or B) backs out of those instead
    if (this.ajTalk.visible || this.shopFromWorld || this.ecoOpen()) return;
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
    this.pause.setLoadoutAllowed(this.session?.mode !== 'porch');
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
