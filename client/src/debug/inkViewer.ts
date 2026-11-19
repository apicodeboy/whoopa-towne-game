import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Developer page (?debug=ink): the raw Urban Ink GLB from tools/characters, to check shapes,
 * pieces, weights and clips. Driven from the console / scenarios through window.inkView:
 *   inkView.view({ yaw, pitch, dist, y, fov })  inkView.show(regex of material names)  inkView.play(clip, time)
 */
export async function runInkViewer(container: HTMLElement): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1b20);
  scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x3a3430, 1.3));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.2);
  rim.position.set(-2, 2, -2.5);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.01, 50);
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/characters/ink.glb?v=${Date.now()}`);
  const root = gltf.scene;
  scene.add(root);
  const meshes: THREE.SkinnedMesh[] = [];
  const statics: THREE.Mesh[] = [];
  const bindPose = new THREE.Group();
  const palette: Record<string, number> = { Skin: 0x8a5a3c, Lips: 0x6b3a30, Skin_Darker: 0x5a3828, Sclera: 0xf2efe8, Eye: 0x3b2516, Pupil: 0x080808, Eyebrows: 0x1b1714 };
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    const name = mat.name;
    const base = palette[name] ?? (/^Skin/.test(name) ? palette.Skin : /Sole|Lace|Under/.test(name) ? 0xeeeeea : /Trim|Zip/.test(name) ? 0xc9ccd1 : 0x26262b);
    m.material = new THREE.MeshStandardMaterial({ color: base, vertexColors: true, roughness: 0.7, metalness: 0 });
    m.material.name = name;
    meshes.push(m);
    // the bind pose (T-pose) as a plain mesh: the shapes exactly as generated
    const still = new THREE.Mesh(m.geometry, m.material);
    still.name = name;
    statics.push(still);
    bindPose.add(still);
  });
  scene.add(bindPose);
  const mixer = new THREE.AnimationMixer(root);
  let action: THREE.AnimationAction | null = null;
  const view = { yaw: 0.5, pitch: 0.05, dist: 3.2, y: 0.95, fov: 30 };
  const api = {
    materials: () => meshes.map((m) => (m.material as THREE.Material).name),
    debug() {
      root.updateMatrixWorld(true);
      const m = meshes[0];
      m.skeleton.update();
      const box = new THREE.Box3();
      for (const x of meshes) {
        x.computeBoundingBox();
        box.union(x.boundingBox!.clone().applyMatrix4(x.matrixWorld));
      }
      const head = m.skeleton.bones.find((b) => b.name === 'Head')!;
      const hp = head.getWorldPosition(new THREE.Vector3());
      const s = new THREE.Vector3();
      head.getWorldScale(s);
      return { box: [box.min.toArray(), box.max.toArray()], head: hp.toArray(), headScale: s.toArray(), bind: m.bindMatrix.elements.slice(12, 15), meshWorld: m.matrixWorld.elements.slice(0, 3), inv0: m.skeleton.boneInverses[m.skeleton.bones.indexOf(head)].elements.slice(12, 16) };
    },
    view(v: Partial<typeof view>) {
      Object.assign(view, v);
      render();
    },
    show(re: string) {
      const r = new RegExp(re);
      for (const m of [...meshes, ...statics]) m.visible = r.test((m.material as THREE.Material).name);
      render();
    },
    play(name: string, time = 0) {
      action?.stop();
      const clip = gltf.animations.find((c) => c.name.endsWith(name));
      if (!clip) return 'no clip';
      action = mixer.clipAction(clip);
      action.play();
      mixer.setTime(time);
      root.visible = true;
      bindPose.visible = false;
      render();
      return clip.name;
    },
    rest() {
      action?.stop();
      action = null;
      mixer.stopAllAction();
      root.visible = false;
      bindPose.visible = true;
      render();
    },
  };
  function render(): void {
    camera.fov = view.fov;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.y + Math.sin(view.pitch) * view.dist, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(0, view.y, 0);
    renderer.render(scene, camera);
  }
  (window as unknown as { inkView: typeof api }).inkView = api;
  (window as unknown as { __whoopa: unknown }).__whoopa = { ink: api };
  api.rest();
}
