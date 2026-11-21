import * as THREE from 'three';
import { LOOK_FIELDS, randomAppearance, sanitizeAppearance, seededRandom, type Appearance, type LookField } from '@shared/config/appearance';
import { Assets } from '../game/assets';
import { makePose, type CharacterVisual } from '../game/characters/characterTypes';
import { LookBuilder, lookTimings } from '../game/characters/look/assemble';
import { ProceduralCharacter } from '../game/characters/proceduralCharacter';
import { SkinnedCharacter } from '../game/characters/skinnedCharacter';
import { applyWeaponSkin } from '../game/characters/weaponSkins';
import { GunIcons } from '../game/gunIcons';
import { hasGunModel, makeGunModel } from '../game/gunKit';
import { WEAPON_IDS } from '@shared/config/weapons';

/**
 * Developer page (?debug=assets): lines up every loaded model next to a 1.8m reference
 * so scale, orientation and animation states can be checked by eye.
 *   ?debug=assets&view=characters|guns|props   &pose=idle|run|strafe|back|crouch|aim|sprint|reload|dead
 * Characters: the three classic outfits, or &looks=random[&n=6&seed=1] for random looks, or
 * &look=<wire code or JSON> for one look.
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
  // (the game's own shadow settings, so characters look here as they do in a match)
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
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
      p.vx = 0; p.vz = 0; p.crouching = false; p.sprinting = false; p.aiming = false; p.reload = -1; p.pitch = 0; p.held = 'draco';
      // &gun=<id>: hold that gun (any pose)
      if (q.get('gun')) p.held = q.get('gun') as typeof p.held;
      switch (poseName) {
        case 'run': p.vz = -5; break;
        case 'strafe': p.vx = 5; break;
        case 'back': p.vz = 5; break;
        case 'sprint': p.vz = -7.5; p.sprinting = true; break;
        case 'crouch': p.crouching = true; break;
        case 'crouchwalk': p.crouching = true; p.vz = -2.6; break;
        case 'aim': p.aiming = true; break;
        case 'aimsmg': p.aiming = true; p.held = 'mp7'; break;
        case 'aimshotgun': p.aiming = true; p.held = 'bammer'; break;
        case 'aimpistol': p.aiming = true; p.held = 'taurus'; break;
        case 'aimrun': p.aiming = true; p.vz = -3; break;
        case 'aimup': p.pitch = 0.6; p.aiming = true; break;
        case 'aimdown': p.pitch = -0.6; p.aiming = true; break;
        case 'reload': p.reload = (t * 0.5) % 1; break;
        case 'pistol': p.held = 'taurus'; break;
        case 'magnum': p.held = 'magnum'; break;
        case 'knife': p.held = 'knife'; break;
        case 'shotgun': p.held = 'bammer'; break;
        case 'double': p.held = 'doublebarrel'; break;
        case 'smg': p.held = 'mp7'; break;
        case 'grenade': p.held = 'grenade'; break;
        case 'sniper': p.held = 'intervention'; break;
        case 'unarmed': p.held = 'none'; break;
        case 'unarmedrun': p.held = 'none'; p.vz = -5; break;
        case 'walk': p.vz = -2.6; break;
        case 'flip': p.flip = (t * 0.8) % 1; break;
        case 'flip50': p.flip = 0.5; break;
        case 'flip25': p.flip = 0.25; break;
        default: break;
      }
    };
    const builder = new LookBuilder(() => assets.characters);
    let looks: Appearance[] = ['hoodie', 'punk', 'casual'].map((body) => sanitizeAppearance({ body }));
    if (q.get('looks') === 'random') {
      const rand = seededRandom(Number(q.get('seed') ?? 1));
      looks = Array.from({ length: Number(q.get('n') ?? 6) }, () => randomAppearance(rand));
    } else if (q.get('look') || q.get('vary')) {
      const raw = q.get('look') ?? '{}';
      looks = [sanitizeAppearance(raw.startsWith('{') ? JSON.parse(raw) : raw)];
      // one character per option of a field: &vary=hair&from=0&n=6
      const field = q.get('vary') as LookField | null;
      if (field && LOOK_FIELDS[field]) {
        const opts = LOOK_FIELDS[field].filter((o) => o.available !== false).slice(Number(q.get('from') ?? 0), Number(q.get('from') ?? 0) + Number(q.get('n') ?? 6));
        looks = opts.map((o) => ({ ...looks[0], [field]: o.id }));
        info.varied = opts.map((o) => o.id);
      }
    }
    const t0 = performance.now();
    const chars: CharacterVisual[] = [
      ...looks.map((l, i) => SkinnedCharacter.create(builder, assets, (i % 2) as 0 | 1, l)).filter((c): c is SkinnedCharacter => !!c),
      ...(q.has('looks') || q.has('look') || q.has('vary') ? [] : [new ProceduralCharacter(0, 1)]),
    ];
    info.buildMs = Math.round(performance.now() - t0);
    info.phases = Object.fromEntries(Object.entries(lookTimings()).map(([k, v]) => [k, Math.round(v)]));
    chars.forEach((c, i) => {
      scene.add(c.root);
      const p = makePose();
      p.x = (i - (chars.length - 1) / 2) * Number(q.get('gap') ?? 1.6);
      p.yaw = q.has('yaw') ? Number(q.get('yaw')) : Math.PI * 0.82; // turned mostly toward the camera
      if (q.has('calm')) c.setMenuIdle?.(true);
      if (q.has('expr')) setTimeout(() => c.previewExpression?.(q.get('expr')!), 200);
      if (poseName === 'dead') setTimeout(() => c.die(0, 1), 300);
      if (poseName === 'shoot') setInterval(() => c.shot(), 110);
      updaters.push((dt, t) => {
        set(p, t);
        c.update(dt, p);
      });
      ((window as unknown as { __chars?: CharacterVisual[] }).__chars ??= []).push(c);
      // &ikdots: markers on the IK wrists (red/blue) and the gun mount (green) of each character
      if (q.has('ikdots')) {
        const dot = (color: number) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
          m.renderOrder = 50;
          scene.add(m);
          return m;
        };
        const dr = dot(0xff2020), dl = dot(0x2060ff), dg = dot(0x20ff40);
        const sc = c as unknown as { arms: { R: { wrist: THREE.Object3D } | null; L: { wrist: THREE.Object3D } | null }; gunMount: THREE.Object3D };
        updaters.push(() => {
          sc.arms.R?.wrist.getWorldPosition(dr.position);
          sc.arms.L?.wrist.getWorldPosition(dl.position);
          sc.gunMount.getWorldPosition(dg.position);
        });
      }
      if (!q.has('noref')) {
        const ref = post.clone();
        ref.position.set(p.x - 0.55, 0.9, 0.1);
        scene.add(ref);
      }
    });
    camera.position.set(Number(q.get('cx') ?? 0.8), Number(q.get('cy') ?? 1.5), Number(q.get('cz') ?? 6.2));
    camera.lookAt(Number(q.get('lx') ?? 0), Number(q.get('ly') ?? 0.95), Number(q.get('lz') ?? 0));
    if (q.has('fov')) {
      camera.fov = Number(q.get('fov'));
      camera.updateProjectionMatrix();
    }
    info.characters = assets.characters.map((c) => ({ name: c.name, clips: [...c.clips.keys()] }));
  } else if (view === 'guns') {
    // the weapon collection at real size, side-on (muzzles to the right), in three columns;
    // &skin=gold etc. puts a wrap on them all
    const icons = new GunIcons(renderer, assets);
    // the pictures the menus use, for a sheet (see tools/out/sc/gunsheet.mjs)
    (window as unknown as Record<string, unknown>).__gunIcons = (skin = 'none') => WEAPON_IDS.filter((id) => hasGunModel(id)).map((id) => [id, icons.get(id, skin)]);
    const ids = WEAPON_IDS.filter((id) => hasGunModel(id));
    ids.forEach((id, i) => {
      const g = makeGunModel(id)!;
      if (q.get('skin')) applyWeaponSkin(g, q.get('skin')!, new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()));
      const col = i % 3, row = Math.floor(i / 3);
      g.rotation.y = -Math.PI / 2;
      g.position.set(-1.6 + col * 1.6, 3.4 - row * 0.62, 0);
      scene.add(g);
    });
    scene.background = new THREE.Color(0xb9bec8);
    camera.position.set(0, 2.2, 7.2);
    camera.lookAt(0, 2.2, 0);
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
