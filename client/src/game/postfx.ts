import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, NormalPass, RenderPass, SSAOEffect, ShaderPass,
} from 'postprocessing';

/**
 * The finishing passes over the 3D picture (pmndrs/postprocessing, plain three.js):
 *
 *  - the scene is drawn into a half-float buffer (real highlights, MSAA on the GPUs that have it)
 *  - bloom: only what is truly bright glows (lamps, lit windows and signs at night; muzzle
 *    flashes and blasts by day)
 *  - grade: the same ACES tone curve and exposure the game always used (so the look and skin
 *    tones stay put), then a light color grade: warmer and a touch livelier by day, cool
 *    shadows at night
 *  - vignette (part of the grade): off in play, eased in for cinematic moments only
 *  - depth of field: the menu backdrop only (never in a match)
 *  - ambient occlusion: optional (High quality + the setting), it re-draws the scene's normals
 *
 * Low quality and performance mode do not use any of this: the renderer draws straight to the
 * screen as before.
 */
export interface PostFxOptions {
  /** MSAA samples for the scene buffer (0 = none). */
  multisampling: number;
  /** Bloom's blur works at this fraction of the screen (lower = cheaper). */
  bloomScale: number;
  ao: boolean;
}

/** ACES (three.js's fitted ACES, identical) + exposure, then the grade. Runs last, in display-referred light. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float exposure;
      uniform float saturation;
      uniform float contrast;
      uniform vec3 shadowTint;
      uniform vec3 highTint;
      uniform float vignette;
      vec3 rrtOdtFit(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 color) {
        const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        color *= exposure / 0.6;
        color = inM * color;
        color = rrtOdtFit(color);
        color = outM * color;
        return clamp(color, 0.0, 1.0);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // tone map (linear), then grade in perceptual space (where "contrast" and "shadows"
        // mean what they look like), then back to linear for the output encoding
        vec3 c = pow(aces(inputColor.rgb), vec3(1.0 / 2.2));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split toning: shadows lean one way, highlights the other (mid-tones, where skin sits, barely move)
        float sh = 1.0 - smoothstep(0.05, 0.45, l);
        float hi = smoothstep(0.65, 1.0, l);
        c *= mix(vec3(1.0), shadowTint, sh) * mix(vec3(1.0), highTint, hi);
        c = mix(vec3(l), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        // the cinematic vignette (0 in play)
        float v = smoothstep(0.95, 0.3, length((uv - 0.5) * vec2(1.25, 1.0)) * 1.3);
        c *= mix(1.0, v, vignette);
        outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1.05)],
        ['contrast', new THREE.Uniform(1.02)],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['highTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['vignette', new THREE.Uniform(0)],
      ]),
    });
  }
}

const DAY_GRADE = { saturation: 1.07, contrast: 1.03, shadow: [1.0, 0.99, 0.98], high: [1.03, 1.0, 0.95], bloom: 0.35, threshold: 1.9 };
const NIGHT_GRADE = { saturation: 0.97, contrast: 1.04, shadow: [0.9, 0.97, 1.1], high: [1.04, 1.0, 0.95], bloom: 0.95, threshold: 0.72 };

export class PostFx {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private sanitize: ShaderPass;
  private gamePass: EffectPass;
  private menuPass: EffectPass;
  private bloom: BloomEffect;
  private menuBloom: BloomEffect;
  private grade: GradeEffect;
  private menuGrade: GradeEffect;
  private dof: DepthOfFieldEffect;
  private normalPass: NormalPass | null = null;
  private ssao: SSAOEffect | null = null;
  private camera: THREE.Camera;
  private menu = false;
  /** 0..1: cinematic moments ease the vignette in. */
  private cinematic = 0;
  private cinematicWant = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostFxOptions) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: opts.multisampling });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // A stray NaN or infinity (a degenerate normal somewhere, a light at zero distance) is one
    // black pixel in an 8-bit picture, but in this HDR buffer the bloom blur would spread it over
    // the whole screen: zero those out, and cap absurd highlights, before anything reads them.
    this.sanitize = new ShaderPass(new THREE.ShaderMaterial({
      name: 'Sanitize',
      uniforms: { inputBuffer: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `uniform sampler2D inputBuffer; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(inputBuffer, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = clamp(c, vec4(0.0), vec4(48.0, 48.0, 48.0, 1.0));
        }`,
      depthWrite: false, depthTest: false,
    }), 'inputBuffer');
    this.composer.addPass(this.sanitize);
    const bloomOpts = { mipmapBlur: true, luminanceThreshold: DAY_GRADE.threshold, luminanceSmoothing: 0.25, intensity: DAY_GRADE.bloom, radius: 0.7, resolutionScale: opts.bloomScale };
    this.bloom = new BloomEffect(bloomOpts);
    this.grade = new GradeEffect();
    const gameEffects: Effect[] = [this.bloom];
    if (opts.ao) {
      this.normalPass = new NormalPass(scene, camera);
      this.composer.addPass(this.normalPass);
      this.ssao = new SSAOEffect(camera, this.normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY, samples: 9, rings: 3, radius: 0.08, intensity: 1.6, luminanceInfluence: 0.6,
        distanceThreshold: 0.6, distanceFalloff: 0.1, rangeThreshold: 0.02, rangeFalloff: 0.004, bias: 0.04, resolutionScale: 0.5,
      });
      gameEffects.unshift(this.ssao);
    }
    gameEffects.push(this.grade);
    this.gamePass = new EffectPass(camera, ...gameEffects);
    // the menu backdrop: the same, plus a gentle depth of field (focus a little way out)
    this.menuBloom = new BloomEffect(bloomOpts);
    this.menuGrade = new GradeEffect();
    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 70, worldFocusRange: 60, bokehScale: 1.6, resolutionScale: 0.5 });
    this.menuPass = new EffectPass(camera, this.menuBloom, this.dof, this.menuGrade);
    this.composer.addPass(this.gamePass);
    this.composer.addPass(this.menuPass);
    this.applyMenu();
  }

  /** One of the two last passes is on, and that one draws to the screen. */
  private applyMenu(): void {
    this.menuPass.enabled = this.menu;
    this.gamePass.enabled = !this.menu;
    this.menuPass.renderToScreen = this.menu;
    this.gamePass.renderToScreen = !this.menu;
  }

  setCamera(camera: THREE.Camera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    this.composer.setMainCamera(camera);
  }

  /** Menus (depth of field on) or a match (off). */
  setMenu(on: boolean): void {
    if (on === this.menu) return;
    this.menu = on;
    this.applyMenu();
  }

  /** Eases the cinematic vignette toward `k` (0 = none, 1 = full). */
  setCinematic(k: number): void {
    this.cinematicWant = Math.max(0, Math.min(1, k));
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** Grade and bloom for the time of day (`night` 0..1) and the exposure in use. */
  update(dt: number, night: number, exposure: number): void {
    const mix = (a: number, b: number) => a + (b - a) * night;
    for (const grade of [this.grade, this.menuGrade]) {
      const u = grade.uniforms;
      u.get('exposure')!.value = exposure;
      u.get('saturation')!.value = mix(DAY_GRADE.saturation, NIGHT_GRADE.saturation);
      u.get('contrast')!.value = mix(DAY_GRADE.contrast, NIGHT_GRADE.contrast);
      (u.get('shadowTint')!.value as THREE.Vector3).set(
        mix(DAY_GRADE.shadow[0], NIGHT_GRADE.shadow[0]), mix(DAY_GRADE.shadow[1], NIGHT_GRADE.shadow[1]), mix(DAY_GRADE.shadow[2], NIGHT_GRADE.shadow[2]),
      );
      (u.get('highTint')!.value as THREE.Vector3).set(
        mix(DAY_GRADE.high[0], NIGHT_GRADE.high[0]), mix(DAY_GRADE.high[1], NIGHT_GRADE.high[1]), mix(DAY_GRADE.high[2], NIGHT_GRADE.high[2]),
      );
    }
    for (const b of [this.bloom, this.menuBloom]) {
      b.intensity = mix(DAY_GRADE.bloom, NIGHT_GRADE.bloom);
      b.luminanceMaterial.threshold = mix(DAY_GRADE.threshold, NIGHT_GRADE.threshold);
    }
    this.cinematic += (this.cinematicWant - this.cinematic) * (1 - Math.exp(-dt * 3));
    this.grade.uniforms.get('vignette')!.value = 0.55 * this.cinematic;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
