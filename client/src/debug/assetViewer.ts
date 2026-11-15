import * as THREE from 'three';
import { Assets } from '../game/assets';
import { makePose } from '../game/characters/characterTypes';
import { ProceduralCharacter } from '../game/characters/proceduralCharacter';
import { SkinnedCharacter } from '../game/characters/skinnedCharacter';

/**
 * Developer page (?debug=assets): lines up every loaded model next to a 1.8m reference
 * so scale, orientation and animation states can be checked by eye.
 *   ?debug=assets&view=characters|guns|props   &pose=idle|run|strafe|back|crouch|aim|sprint|reload|dead
 */
export async function runAssetViewer(container: HTMLElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const view = q.get('view') ?? 'characters';
  const poseName = q.get('pose') ?? 'idle';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8793a6);
  scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x4a4238, 1.2));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
  sun.position.set(-4, 8, 6);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x55585e }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.GridHelper(60, 60, 0x333333, 0x444444));
  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.05, 200);

  const assets = new Assets();
  await assets.load();
  const info: Record<string, unknown> = { failed: assets.failed, models: {} as Record<string, number[]> };
  for (const [name, t] of assets.models) (info.models as Record<string, number[]>)[name] = t.size.toArray().map((v) => +v.toFixed(3));

  // 1.8m reference post + axes (+X red, +Y green, +Z blue)
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  const updaters: Array<(dt: number, t: number) => void> = [];

  if (view === 'characters') {
    const pose = makePose();
    const set = (p: typeof pose, t: number) => {
      p.vx = 0; p.vz = 0; p.crouching = false; p.sprinting = false; p.aiming = false; p.reload = -1; p.pitch = 0; p.held = 'ar';
      switch (poseName) {
        case 'run': p.vz = -5; break;
        case 'strafe': p.vx = 5; break;
        case 'back': p.vz = 5; break;
        case 'sprint': p.vz = -7.5; p.sprinting = true; break;
        case 'crouch': p.crouching = true; break;
        case 'crouchwalk': p.crouching = true; p.vz = -2.6; break;
        case 'aimup': p.pitch = 0.6; p.aiming = true; break;
        case 'aimdown': p.pitch = -0.6; p.aiming = true; break;
        case 'reload': p.reload = (t * 0.5) % 1; break;
        case 'pistol': p.held = 'pistol'; break;
        case 'shotgun': p.held = 'shotgun'; break;
        case 'smg': p.held = 'smg'; break;
        case 'grenade': p.held = 'grenade'; break;
        default: break;
      }
    };
    const chars = [
      ...assets.characters.map((tpl, i) => new SkinnedCharacter(tpl, assets, (i % 2) as 0 | 1)),
      new ProceduralCharacter(0, 1),
    ];
    chars.forEach((c, i) => {
      scene.add(c.root);
      const p = makePose();
      p.x = (i - (chars.length - 1) / 2) * 1.6;
      p.yaw = q.has('yaw') ? Number(q.get('yaw')) : Math.PI * 0.82; // turned mostly toward the camera
      if (poseName === 'dead') setTimeout(() => c.die(0, 1), 300);
      if (poseName === 'shoot') setInterval(() => c.shot(), 110);
      updaters.push((dt, t) => {
        set(p, t);
        c.update(dt, p);
      });
      const ref = post.clone();
      ref.position.set(p.x - 0.55, 0.9, 0.1);
      scene.add(ref);
    });
    camera.position.set(Number(q.get('cx') ?? 0.8), Number(q.get('cy') ?? 1.5), Number(q.get('cz') ?? 6.2));
    camera.lookAt(0, 0.95, 0);
    info.characters = assets.characters.map((c) => ({ name: c.name, clips: [...c.clips.keys()] }));
  } else if (view === 'guns') {
    // stacked vertically and seen side-on: screen-left is +Z (blue axis), up is +Y
    const names = ['ar', 'smg', 'shotgun', 'pistol', 'grenade'];
    names.forEach((name, i) => {
      const t = assets.model(name);
      if (!t) return;
      const obj = t.root.clone(true);
      const k = (name === 'grenade' ? 0.3 : name === 'pistol' ? 0.6 : 1.6) / t.size.z;
      obj.scale.setScalar(k);
      obj.position.set(0, 0.2 + i * 0.75, 0);
      scene.add(obj);
      const axes = new THREE.AxesHelper(1.1);
      axes.position.copy(obj.position);
      scene.add(axes);
    });
    camera.position.set(7, 1.9, 0);
    camera.lookAt(0, 1.9, 0);
  } else {
    const names = ['car', 'taxi', 'van', 'truck', 'dumpster', 'barrier', 'bench', 'hydrant', 'trashcan', 'cone'];
    let x = 0;
    for (const name of names) {
      const t = assets.model(name);
      if (!t) continue;
      const obj = t.root.clone(true);
      obj.position.set(x + t.size.x / 2, 0, 0);
      scene.add(obj);
      const axes = new THREE.AxesHelper(Math.max(0.6, t.size.z * 0.7));
      axes.position.set(x + t.size.x / 2, t.size.y + 0.05, 0);
      scene.add(axes);
      x += t.size.x + 0.9;
    }
    const mid = x / 2;
    camera.position.set(mid + 6, 5, 13);
    camera.lookAt(mid, 0.8, 0);
    const ref = post.clone();
    ref.position.set(-0.6, 0.9, 0);
    scene.add(ref);
  }

  (window as unknown as Record<string, unknown>).__viewer = info;
  let last = performance.now();
  let time = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    for (const u of updaters) u(dt, time);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
