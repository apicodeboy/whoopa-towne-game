import * as THREE from 'three';
import { crewColorHex } from '@shared/config/crews';
import { makePose, type CharacterVisual, type HeldItem } from './characterTypes';

/** Turn that shows the character's face three-quarters on. */
const SHOWCASE_YAW = 0.55;
const SPIN = 0.35;

/**
 * Camera positions: the whole character, head to waist, or the face. Heights are fractions
 * between the feet and the eyes so they fit any character height.
 */
const FRAMES = {
  full: { look: 0.53, y: 0.6, dist: 3.6, fov: 32 },
  upper: { look: 0.84, y: 0.9, dist: 1.85, fov: 30 },
  face: { look: 0.99, y: 1.0, dist: 1.25, fov: 28 },
} as const;
export type PreviewFrame = keyof typeof FRAMES;
export const PREVIEW_FRAMES = Object.keys(FRAMES) as PreviewFrame[];

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.7;

/**
 * Turntable for the Character screen: its own small renderer, lights and camera, so it does
 * not disturb the menu backdrop. Drag (or the arrow buttons) turns the character; the wheel,
 * a pinch or the zoom buttons move the camera in and out.
 */
export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.03, 50);
  private visual: CharacterVisual | null = null;
  private pose = makePose();
  private yaw = 0.35;
  private spin = 0;
  /** Rotate buttons held: -1, 0, 1. */
  private turning = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private dragged = 0;
  /** While set, the turntable eases to this yaw and holds it until `holdUntil`. */
  private showcase: number | null = null;
  private holdUntil = 0;
  private frame: PreviewFrame = 'full';
  private zoom = 1;
  private cam = { look: FRAMES.full.look, y: FRAMES.full.y, dist: FRAMES.full.dist, fov: FRAMES.full.fov };
  private raf = 0;
  private last = 0;
  private observer: ResizeObserver;
  /** Eye height of the current character (meters), so framings fit tall and short ones. */
  private eyeH = 1.62;
  onUserTurn: (() => void) | null = null;
  /**
   * Split view (the Character Creator): a flat front view on the left half (the character as
   * it stands, never turned), the 3D view on the right. In it the camera goes round the
   * character instead of the character turning, so the front view stays a front view.
   */
  private split = false;
  /**
   * Standing in a box (the main menu's squad): the whole character, feet just above the bottom
   * edge, whatever the box's shape (instead of the fixed framings).
   */
  private stand = false;
  private frontCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  /** Pixels the split view keeps free above and below the character (the toolbars). */
  clear = { top: 160, bottom: 150 };
  /** The character's size (meters) and where it sits in the front view (canvas pixels). */
  private size = { w: 0.6, h: 1.85, cx: 0 };
  private boxKey = '';
  onFrontBox: ((box: { x: number; y: number; w: number; h: number; widthM: number; heightM: number } | null) => void) | null = null;
  private floor: THREE.Mesh;
  private stageFloor: THREE.Mesh;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cc-canvas';
    this.canvas.setAttribute('aria-label', 'Character preview: drag to turn, scroll or pinch to zoom');
    this.pose.held = 'none';

    // a studio for the Urban Ink look: one soft key from the upper left (the cel bands come
    // from it), a cool kicker behind for separation, a warm low fill
    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x3a332c, 1.3));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
    key.position.set(-1.8, 3.2, -2.6);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.0);
    rim.position.set(2.4, 2.2, 2.6);
    const fill = new THREE.DirectionalLight(0xffd8a0, 0.45);
    fill.position.set(2.5, 0.8, -1.5);
    void crewColorHex;
    this.scene.add(key, rim, fill);
    // a floor disc so the character stands on something
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.scene.add(this.floor);
    // the split view stands it on a dark studio floor instead
    this.stageFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1d1d20, depthWrite: true }),
    );
    this.stageFloor.position.y = -0.002;
    this.stageFloor.visible = false;
    this.scene.add(this.stageFloor);

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      this.dragged = 0;
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const d = this.pinchDist();
        if (this.pinch > 0 && d > 0) this.setZoom(this.zoom * (this.pinch / d));
        this.pinch = d;
        return;
      }
      const dx = e.clientX - p.x;
      p.x = e.clientX;
      p.y = e.clientY;
      this.yaw += dx * 0.012;
      this.dragged += Math.abs(dx);
      this.showcase = null;
      if (this.dragged > 6) this.onUserTurn?.();
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
  }

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Something in the hands (weapon skin previews); null = relaxed, empty-handed. */
  private held: HeldItem | null = null;

  setHeld(item: HeldItem | null): void {
    this.held = item;
    this.pose.held = item ?? 'none';
    this.visual?.setMenuIdle?.(!item);
  }

  /** Shows a new character (the preview owns and disposes it from now on). */
  setCharacter(visual: CharacterVisual): void {
    this.visual?.dispose();
    this.visual = visual;
    visual.setMenuIdle?.(!this.held);
    this.scene.add(visual.root);
    visual.setVisible(true);
    this.measure(visual);
    // render it right away (also when the screen is idle) so a change shows instantly
    this.visual.update(0, this.pose, true);
    // a model still downloading: measured again when it is here
    void visual.ready?.then(() => {
      if (this.visual !== visual) return;
      visual.setMenuIdle?.(!this.held);
      this.measure(visual);
    });
  }

  private measure(visual: CharacterVisual): void {
    const f = visual.frame;
    if (f) this.eyeH = f.eyeY * f.scale;
    // its size as it stands (for the front view's measurements), unturned
    const turned = visual.root.rotation.y;
    visual.root.rotation.y = 0;
    visual.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(visual.root);
    visual.root.rotation.y = turned;
    if (!box.isEmpty()) {
      const top = f ? Math.max(f.topY * f.scale, this.eyeH + 0.1) : box.max.y;
      this.size = { w: Math.min(1.4, box.max.x - box.min.x), h: Math.min(2.4, Math.max(top, box.max.y * 0.98)), cx: (box.min.x + box.max.x) / 2 };
    }
    this.boxKey = '';
  }

  get character(): CharacterVisual | null {
    return this.visual;
  }

  setFrame(frame: PreviewFrame): void {
    this.frame = frame;
    this.zoom = 1;
  }

  get currentFrame(): PreviewFrame {
    return this.frame;
  }

  /** 1 = the framing's own distance; smaller is closer. */
  setZoom(z: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  }

  zoomBy(steps: number): void {
    this.setZoom(this.zoom * Math.pow(0.8, steps));
  }

  /** Rotate buttons: -1 / 1 while held, 0 on release. */
  turn(dir: number): void {
    this.turning = dir;
    if (dir !== 0) this.showcase = null;
  }

  /** Turns a fixed step (keyboard). */
  turnStep(dir: number): void {
    this.yaw += dir * 0.35;
    this.showcase = null;
  }

  /** Split view: the front view on the left, the 3D view on the right (see `split`). */
  setSplit(on: boolean): void {
    // the 3D view starts three-quarters on, the way a model is shown off
    if (on && !this.split) this.yaw = SHOWCASE_YAW;
    this.split = on;
    this.floor.visible = !on;
    this.stageFloor.visible = on;
    this.boxKey = '';
    if (!on) this.onFrontBox?.(null);
    this.resize();
  }

  get isSplit(): boolean {
    return this.split;
  }

  /** Frame the whole character standing, feet at the bottom edge (the main menu's squad). */
  setStand(on: boolean): void {
    this.stand = on;
  }

  /** The dark studio floor under the character (TRAP), instead of the soft disc. */
  setStudio(on: boolean): void {
    this.floor.visible = !on;
    this.stageFloor.visible = on;
    if (on) this.yaw = SHOWCASE_YAW;
  }

  /** Turns the 3D view back round to the front. */
  faceFront(): void {
    const turn = Math.PI * 2;
    this.showcase = Math.round(this.yaw / turn) * turn;
    this.holdUntil = performance.now() + 2500;
  }

  get spinning(): boolean {
    return this.spin !== 0;
  }

  /** Slowly spin by itself (off by default: the player turns it). */
  setSpin(on: boolean): void {
    this.spin = on ? SPIN : 0;
  }

  /** Turns the character to show its face for a few seconds. */
  showcaseFace(angle = SHOWCASE_YAW): void {
    // nearest equivalent of the showcase angle, so it never spins the long way round
    const turn = Math.PI * 2;
    this.showcase = angle + Math.round((this.yaw - angle) / turn) * turn;
    this.holdUntil = performance.now() + 4000;
  }

  /** Starts or stops rendering (the WebGL context exists only while the screen is open). */
  setActive(active: boolean): void {
    if (active && !this.raf) {
      if (!this.renderer) {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.resize();
      }
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    } else if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!this.renderer || w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = (this.split ? w / 2 : w) / h;
    this.camera.updateProjectionMatrix();
    this.boxKey = '';
  }

  /**
   * The flat front view: the whole character in the left half, clear of the toolbars along the
   * top and the bottom (`clear` pixels kept free above and below it).
   */
  private placeFrontCam(w: number, h: number): void {
    const H = this.size.h, aspect = w / 2 / h;
    const T = this.clear.top, B = this.clear.bottom;
    const s0 = Math.max(40, h - T - B) / H; // pixels per meter
    const view = h / s0;
    const c = this.frontCam;
    c.top = view / 2;
    c.bottom = -view / 2;
    c.left = (-view / 2) * aspect;
    c.right = (view / 2) * aspect;
    c.updateProjectionMatrix();
    // the character's top lands T pixels down, its feet B pixels up
    const cy = (h / 2 - B) / s0;
    c.position.set(0, cy, -8);
    c.lookAt(0, cy, 0);
    // where the character's box lands on the canvas (CSS pixels), for the measurements
    const key = `${w}|${h}|${H}|${this.size.w}`;
    if (key === this.boxKey) return;
    this.boxKey = key;
    const s = h / view;
    const bw = this.size.w * s, bh = H * s;
    // (seen from the front the character's left is screen right: the box is mirrored in x)
    const x = w / 4 - this.size.cx * s - bw / 2;
    const y = h / 2 - (H - cy) * s;
    this.onFrontBox?.({ x, y, w: bw, h: bh, widthM: this.size.w, heightM: H });
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.turning !== 0) {
      this.yaw += this.turning * 2.2 * dt;
    } else if (this.showcase !== null) {
      this.yaw += (this.showcase - this.yaw) * (1 - Math.exp(-dt * 6));
      if (now > this.holdUntil) this.showcase = null;
    } else if (this.pointers.size === 0) {
      this.yaw += this.spin * dt;
    }

    // ease the camera between framings
    const target = FRAMES[this.frame];
    const k = 1 - Math.exp(-dt * 6);
    const narrow = this.camera.aspect < 0.8 ? 1.25 : 1;
    this.cam.look += (target.look - this.cam.look) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    const far = this.split ? 1.5 : 1;
    this.cam.dist += (target.dist * this.zoom * narrow * far - this.cam.dist) * k;
    this.cam.fov += (target.fov - this.cam.fov) * k;
    this.camera.fov = this.cam.fov;
    this.camera.updateProjectionMatrix();
    // the character faces -Z at yaw 0, so the camera looks at it from the -Z side (in the
    // split view the camera goes round it instead: turning it by yaw is seeing it from -yaw)
    if (this.stand) {
      // the view fits the character's height (with a little headroom) and its width, and the
      // feet sit 3% above the bottom edge
      const fov = 30;
      const V = Math.max((this.size.h + 0.06) / 0.94, 0.95 / Math.max(0.2, this.camera.aspect));
      const dist = V / (2 * Math.tan((fov * Math.PI) / 360));
      const cy = V / 2 - V * 0.03;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(0, cy, -dist);
      this.camera.lookAt(0, cy, 0);
    } else if (this.split) {
      this.camera.position.set(Math.sin(this.yaw) * this.cam.dist, this.cam.y * this.eyeH, -Math.cos(this.yaw) * this.cam.dist);
      this.camera.lookAt(0, this.cam.look * this.eyeH, 0);
    } else {
      this.camera.position.set(0, this.cam.y * this.eyeH, -this.cam.dist);
      this.camera.lookAt(0, this.cam.look * this.eyeH, 0);
    }

    if (this.visual) {
      this.pose.yaw = this.split ? 0 : this.yaw;
      this.visual.update(dt, this.pose, true);
    }
    const r = this.renderer;
    if (!r) return;
    if (!this.split) {
      r.render(this.scene, this.camera);
      return;
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.placeFrontCam(w, h);
    r.setScissorTest(true);
    r.setViewport(0, 0, w / 2, h);
    r.setScissor(0, 0, w / 2, h);
    this.stageFloor.visible = false;
    r.render(this.scene, this.frontCam);
    this.stageFloor.visible = true;
    r.setViewport(w / 2, 0, w / 2, h);
    r.setScissor(w / 2, 0, w / 2, h);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
  };

  dispose(): void {
    this.setActive(false);
    this.observer.disconnect();
    this.visual?.dispose();
    this.renderer?.dispose();
  }
}
