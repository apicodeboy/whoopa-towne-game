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

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cc-canvas';
    this.canvas.setAttribute('aria-label', 'Character preview: drag to turn, scroll or pinch to zoom');
    this.pose.held = 'none';

    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x3a332c, 1.45));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.5);
    key.position.set(-1.6, 3, -3);
    const rim = new THREE.DirectionalLight(crewColorHex(0), 1.8);
    rim.position.set(2.4, 2.2, 2.6);
    const fill = new THREE.DirectionalLight(0xffd23f, 0.55);
    fill.position.set(2.5, 0.8, -1.5);
    this.scene.add(key, rim, fill);
    // a floor disc so the character stands on something
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.scene.add(floor);

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
    const f = visual.frame;
    if (f) this.eyeH = f.eyeY * f.scale;
    // render it right away (also when the screen is idle) so a change shows instantly
    this.visual.update(0, this.pose, true);
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    this.cam.dist += (target.dist * this.zoom * narrow - this.cam.dist) * k;
    this.cam.fov += (target.fov - this.cam.fov) * k;
    this.camera.fov = this.cam.fov;
    this.camera.updateProjectionMatrix();
    // the character faces -Z at yaw 0, so the camera looks at it from the -Z side
    this.camera.position.set(0, this.cam.y * this.eyeH, -this.cam.dist);
    this.camera.lookAt(0, this.cam.look * this.eyeH, 0);

    if (this.visual) {
      this.pose.yaw = this.yaw;
      this.visual.update(dt, this.pose, true);
    }
    this.renderer?.render(this.scene, this.camera);
  };

  dispose(): void {
    this.setActive(false);
    this.observer.disconnect();
    this.visual?.dispose();
    this.renderer?.dispose();
  }
}
