import * as THREE from 'three';
import { clamp } from '@shared/math';
import { isLikelyMobile, type GraphicsQuality, type SettingsStore } from '../core/settings';
import { LIGHTING, NIGHT, live, type LightingPreset } from './lighting';
import { PostFx, type PostFxOptions } from './postfx';
import { ResolutionGovernor } from './resolutionGovernor';
import type { LightSpot } from './world/worldBuilder';

interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  antialias: boolean;
  far: number;
  fogNear: number;
  fogFar: number;
  /** How many lamps cast real light at once, and how far from the view they fade out. */
  lamps: { lights: number; fade: number };
  /** The finishing passes (null = draw straight to the screen). */
  post: PostFxOptions | null;
}

function profileFor(
  q: GraphicsQuality, performanceMode: boolean, budget: LightingPreset['budget'] = LIGHTING.budget,
  fx: { post: boolean; ao: boolean } = { post: true, ao: false },
): QualityProfile {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  if (performanceMode) {
    // roughly one rendered pixel per CSS pixel on phones: sharp enough, light on the GPU (no post)
    return { pixelRatio: Math.min(dpr, 1.25) * 0.8, shadows: false, shadowSize: 0, antialias: false, far: 170, fogNear: 45, fogFar: 160, lamps: budget.performance, post: null };
  }
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1.25), shadows: false, shadowSize: 0, antialias: false, far: 220, fogNear: 60, fogFar: 210, lamps: budget.low, post: null };
    case 'medium':
      return {
        pixelRatio: Math.min(dpr, 1.5), shadows: true, shadowSize: 1024, antialias: true, far: 320, fogNear: 80, fogFar: 300, lamps: budget.medium,
        post: fx.post ? { multisampling: 2, bloomScale: 0.4, ao: false } : null,
      };
    default:
      return {
        pixelRatio: Math.min(dpr, 2), shadows: true, shadowSize: 2048, antialias: true, far: 420, fogNear: 90, fogFar: 380, lamps: budget.high,
        post: fx.post ? { multisampling: 4, bloomScale: 0.5, ao: fx.ao } : null,
      };
  }
}

/** Horizon haze: fog and the bottom of the sky dome share this so distant geometry melts into the sky. */
const SKY = live.sky.horizon;
const SHADOW_RANGE = 42;
/** A lamp starts dimming this many meters before a nearer lamp would take its light slot. */
const HANDOFF_BAND = 6;

const _cam = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _color = new THREE.Color();

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Owns the WebGL renderer, scene, lights and quality profile. */
export class GameRenderer {
  renderer!: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  profile: QualityProfile;
  private container: HTMLElement;
  private settings: SettingsStore;
  private unsub: () => void;
  /** Sun (or moon) direction: the only shadow-casting light. */
  private sunDir = new THREE.Vector3(...live.sun.dir).normalize();
  /** Light sources in the world, and the small pool of real lights handed to the nearest ones. */
  private spots: LightSpot[] = [];
  private spotDist = new Float32Array(0);
  private order: number[] = [];
  private pool: THREE.SpotLight[] = [];
  /** Dynamic resolution: holds 60 fps on desktop / 30 fps on phones by shedding pixels when needed. */
  private governor = new ResolutionGovernor({ targetFps: isLikelyMobile() ? 30 : 60 });
  private lastRenderAt = 0;
  /** Called after the canvas is recreated (quality change). */
  onCanvasChange: ((canvas: HTMLCanvasElement) => void) | null = null;
  /** A day/night cycle is running (lamps sized for the night all match long, so nothing recompiles at dusk). */
  private dayNight = false;
  /** The `live.night` the lights were last set for. */
  private appliedNight = -1;
  /** The finishing passes (Medium / High with Post effects on), else null. */
  private post: PostFx | null = null;
  private postCamera = new THREE.PerspectiveCamera();
  private menuMode = true; // (the app opens on the menu)

  constructor(container: HTMLElement, settings: SettingsStore) {
    this.container = container;
    this.settings = settings;
    this.profile = this.makeProfile();

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, this.profile.fogNear, this.profile.fogFar);

    // sky fill (day: bright blue sky bounce; night: a dim blue that keeps the streets readable
    // between lamps) plus the sun or moon, which casts the shadows
    this.hemi = new THREE.HemisphereLight(live.ambient.sky, live.ambient.ground, live.ambient.intensity);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(live.sun.color, live.sun.intensity);
    this.sun.position.copy(this.sunDir).multiplyScalar(80);
    this.scene.add(this.sun, this.sun.target);

    this.createRenderer();
    this.buildLightPool();
    this.unsub = settings.onChange((_v, key) => {
      if (key === null || key === 'quality' || key === 'performanceMode' || key === 'postFx' || key === 'ambientOcclusion') this.applyQuality();
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private createRenderer(): void {
    const p = this.profile;
    const renderer = new THREE.WebGLRenderer({
      antialias: p.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = live.exposure;
    renderer.shadowMap.enabled = p.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(p.pixelRatio * this.governor.scale);
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = -1;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.configureShadows();
    this.buildPost();
    this.resize();
  }

  /**
   * (Re)builds the finishing passes for the profile. With them on, tone mapping moves into the
   * last pass (the same ACES curve), so the scene is drawn untouched into the HDR buffer.
   */
  private buildPost(): void {
    this.post?.dispose();
    this.post = null;
    const p = this.profile.post;
    if (p) {
      try {
        this.post = new PostFx(this.renderer, this.scene, this.postCamera, p);
        this.post.setMenu(this.menuMode);
      } catch (err) {
        console.warn('post effects unavailable, drawing without them', err);
        this.post = null;
      }
    }
    this.renderer.toneMapping = this.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  }

  /** Menus get a gentle depth of field (never in a match). */
  setMenuMode(on: boolean): void {
    this.menuMode = on;
    this.post?.setMenu(on);
  }

  /** Cinematic moments (0..1): eases a vignette in. */
  setCinematic(k: number): void {
    this.post?.setCinematic(k);
  }

  /** Whether the finishing passes are on (for tests and the FPS readout). */
  get postFx(): boolean {
    return this.post !== null;
  }

  private configureShadows(): void {
    const p = this.profile;
    this.sun.castShadow = p.shadows;
    if (p.shadows) {
      const cam = this.sun.shadow.camera;
      cam.left = -SHADOW_RANGE;
      cam.right = SHADOW_RANGE;
      cam.top = SHADOW_RANGE;
      cam.bottom = -SHADOW_RANGE;
      cam.near = 1;
      cam.far = 220;
      cam.updateProjectionMatrix();
      this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.035;
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: unknown }).map = null;
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = p.fogNear;
    fog.far = p.fogFar;
  }

  /** Re-reads settings. Antialiasing needs a fresh context, so the canvas is rebuilt when that flips. */
  private makeProfile(): QualityProfile {
    const v = this.settings.values;
    return profileFor(v.quality, v.performanceMode, this.dayNight ? NIGHT.budget : LIGHTING.budget, { post: v.postFx, ao: v.ambientOcclusion });
  }

  /**
   * Turns the day/night cycle's light budget on or off (at the start and end of a JUMP OFF THE
   * PORCH match). The number of lamp lights changes, so shaders recompile once, here, rather
   * than at dusk mid-match.
   */
  setDayNight(on: boolean): void {
    if (on === this.dayNight) return;
    this.dayNight = on;
    this.profile = { ...this.profile, lamps: this.makeProfile().lamps };
    this.buildLightPool();
  }

  /** Sun or moon, sky light, fog, sky color and exposure from the live lighting (only when it changed). */
  private applyLighting(): void {
    if (live.night === this.appliedNight) return;
    this.appliedNight = live.night;
    this.hemi.color.setHex(live.ambient.sky);
    this.hemi.groundColor.setHex(live.ambient.ground);
    this.hemi.intensity = live.ambient.intensity;
    this.sun.color.setHex(live.sun.color);
    this.sun.intensity = live.sun.intensity;
    this.sunDir.set(live.sun.dir[0], live.sun.dir[1], live.sun.dir[2]).normalize();
    // (without shadows followShadow never moves it: aim it here)
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 90);
    (this.scene.background as THREE.Color).setHex(live.sky.horizon);
    (this.scene.fog as THREE.Fog).color.setHex(live.sky.horizon);
    this.renderer.toneMappingExposure = live.exposure;
  }

  applyQuality(): void {
    const next = this.makeProfile();
    const rebuild = next.antialias !== this.profile.antialias;
    this.profile = next;
    this.governor.reset();
    this.buildLightPool();
    if (!rebuild) this.buildPost();
    if (rebuild) {
      const old = this.renderer;
      old.domElement.remove();
      old.dispose();
      this.createRenderer();
      this.onCanvasChange?.(this.renderer.domElement);
    } else {
      this.renderer.setPixelRatio(next.pixelRatio);
      this.renderer.shadowMap.enabled = next.shadows;
      this.configureShadows();
      this.resize();
      // materials must recompile when shadows toggle
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
  }

  resize(): { width: number; height: number } {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
    return { width, height };
  }

  /** Keeps the shadow frustum centered on the action, snapped to texels so shadows do not swim. */
  followShadow(x: number, z: number): void {
    if (!this.profile.shadows) return;
    const texel = (SHADOW_RANGE * 2) / this.profile.shadowSize;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 90, this.sunDir.y * 90, sz + this.sunDir.z * 90);
    this.sun.target.updateMatrixWorld();
  }

  /** Fraction of the quality profile's resolution currently being rendered (1 = full). */
  get resScale(): number {
    return this.governor.scale;
  }

  /** The world's light sources (street lamps, shop lights, rooms). Kinds that are off right now get no light. */
  setLights(spots: LightSpot[]): void {
    this.spots = spots;
    this.spotDist = new Float32Array(spots.length);
    this.order = spots.map((_s, i) => i);
  }

  /**
   * A fixed number of lights (by quality) that get handed to whichever lamps are
   * nearest to what the camera looks at. Keeping the count fixed means shaders never
   * recompile mid-game; every other lamp still shows its glowing head, cone and ground pool.
   */
  private buildLightPool(): void {
    const n = this.profile.lamps.lights;
    while (this.pool.length > n) {
      const l = this.pool.pop()!;
      l.target.removeFromParent();
      l.removeFromParent();
      l.dispose();
    }
    while (this.pool.length < n) {
      // a wide downward cone: lamps and ceiling lights light what is below them, not above
      const l = new THREE.SpotLight(0xffffff, 0, 10, NIGHT.street.angle, 0.55, 2);
      this.scene.add(l, l.target);
      this.pool.push(l);
    }
  }

  private updateLights(camera: THREE.Camera): void {
    const pool = this.pool, spots = this.spots;
    if (pool.length === 0) return;
    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_dir);
    // rank lamps by distance to a point a little ahead of the camera (what you are looking at)
    const h = Math.hypot(_dir.x, _dir.z) || 1;
    const rx = _cam.x + (_dir.x / h) * 10, rz = _cam.z + (_dir.z / h) * 10;
    const d = this.spotDist, order = this.order;
    // (kinds that are switched off right now, like street lamps by day, never take a light)
    for (let i = 0; i < spots.length; i++) d[i] = live[spots[i].kind].intensity > 0.01 ? Math.hypot(spots[i].x - rx, spots[i].z - rz) : Infinity;
    order.sort((a, b) => d[a] - d[b]);
    const fade = this.profile.lamps.fade;
    // the first lamp that does not get a light: lamps fade out as they near its distance, so
    // handing a light from one lamp to another never pops
    const dNext = order.length > pool.length ? d[order[pool.length]] : Infinity;
    for (let k = 0; k < pool.length; k++) {
      const light = pool[k];
      if (k >= order.length || !Number.isFinite(d[order[k]])) {
        light.intensity = 0;
        continue;
      }
      const s = spots[order[k]];
      const dist = d[order[k]];
      const w = (1 - smoothstep(fade * 0.55, fade, dist)) * clamp((dNext - dist) / HANDOFF_BAND, 0, 1);
      const cfg = live[s.kind];
      light.position.set(s.x, s.y, s.z);
      light.target.position.set(s.x, s.y - 10, s.z);
      light.target.updateMatrixWorld();
      light.color.copy(_color.setHex(cfg.color));
      light.distance = cfg.distance;
      light.angle = cfg.angle;
      light.intensity = cfg.intensity * w;
    }
  }

  render(camera: THREE.Camera): void {
    this.applyLighting();
    this.updateLights(camera);
    // up in the air (the blimp, a skydive) the haze pushes out, so the land past the town shows
    // instead of a white wall of fog
    const fog = this.scene.fog as THREE.Fog;
    const high = Math.max(0, camera.position.y - 25);
    fog.near = this.profile.fogNear + high * 2.5;
    fog.far = this.profile.fogFar + high * 7;
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      const far = Math.max(this.profile.far, fog.far + 40);
      // (a longer view needs a further near plane too, or distant ground flickers)
      const near = high > 0 ? Math.min(1.5, 0.08 + high * 0.012) : 0.08;
      if (Math.abs(cam.far - far) > 1 || Math.abs(cam.near - near) > 0.005) {
        cam.far = far;
        cam.near = near;
        cam.updateProjectionMatrix();
      }
    }
    const now = performance.now();
    const dt = (now - this.lastRenderAt) / 1000;
    this.lastRenderAt = now;
    if (this.settings.values.dynamicRes) {
      if (this.governor.frame(dt)) this.applyResolution();
    } else if (this.governor.scale !== 1) {
      this.governor.reset();
      this.applyResolution();
    }
    if (this.post) {
      this.post.setCamera(camera);
      this.post.update(dt, live.night, live.exposure);
      this.post.render(dt);
    } else this.renderer.render(this.scene, camera);
  }

  /**
   * A picture of the scene from `camera`, center-cropped to w x h (menu cards). Rendered into
   * the main canvas and copied out straight away, so it never reaches the screen.
   */
  snapshot(camera: THREE.PerspectiveCamera, w: number, h: number): string {
    const canvas = this.renderer.domElement;
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.updateProjectionMatrix();
    this.applyLighting();
    this.updateLights(camera);
    if (this.post) {
      this.post.setCamera(camera);
      this.post.update(0, live.night, live.exposure);
      this.post.render(0);
    } else this.renderer.render(this.scene, camera);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d');
    if (!g) return '';
    const cw = canvas.width, ch = canvas.height, ta = w / h;
    let sw = cw, sh = cw / ta;
    if (sh > ch) {
      sh = ch;
      sw = ch * ta;
    }
    g.drawImage(canvas, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.84);
  }

  private applyResolution(): void {
    this.renderer.setPixelRatio(this.profile.pixelRatio * this.governor.scale);
    this.resize();
  }

  dispose(): void {
    this.unsub();
    this.post?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
