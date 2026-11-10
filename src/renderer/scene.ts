import * as THREE from 'three';
import type { Maze } from '../core/maze';
import type { Player } from '../simulation/player';
import { mazeMesh } from './maze-mesh';
import { disposeMeshes } from './dispose';
import { TransparentWallSorter } from './transparent-walls';
import { WorldLandmarks } from './landmarks';
import { environmentOf, sunDirection } from '../core/environment';
import { sceneComposer } from './scene-composer';

export class WalkScene {
  private renderer: THREE.WebGLRenderer;
  private composer: ReturnType<typeof sceneComposer>;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(76, 1, 0.05, 1500);
  private observer: ResizeObserver;
  private group: THREE.Group | null = null;
  private wallSorter: TransparentWallSorter | null = null;
  private landmarks: WorldLandmarks | null = null;
  private sun = new THREE.DirectionalLight('#fff4de', 2.1);
  private sunDirection = new THREE.Vector3();
  private ambient = new THREE.HemisphereLight('#eff7ff', '#6d7658', 2.3);
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.composer = sceneComposer(this.renderer, this.scene, this.camera);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#c9dce5');
    this.scene.fog = new THREE.Fog('#c9dce5', 50, 250);
    this.scene.add(this.ambient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 100 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);
    this.camera.rotation.order = 'YXZ';
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); document.exitPointerLock(); });
  }
  setMaze(maze: Maze): void {
    const direction = sunDirection(environmentOf(maze));
    this.sunDirection.set(direction.x, direction.y, direction.z).multiplyScalar(40);
    const daylight = THREE.MathUtils.smoothstep(direction.y, -0.1, 0.15);
    this.sun.intensity = direction.y > 0 ? 2.1*daylight : 0;
    this.ambient.intensity = 0.12+2.18*daylight;
    const sky = new THREE.Color('#101927').lerp(new THREE.Color('#c9dce5'), daylight);
    this.scene.background = sky;
    if (this.landmarks) {
      this.scene.remove(this.landmarks.group); disposeMeshes(this.landmarks.group);
    }
    if (this.group) {
      this.scene.remove(this.group);
      disposeMeshes(this.group);
    }
    this.group = mazeMesh(maze);
    const fabric = this.group.getObjectByName('fabric-walls');
    this.wallSorter = maze.translucentFabric && fabric instanceof THREE.InstancedMesh
      ? new TransparentWallSorter(fabric) : null;
    this.scene.add(this.group); this.resize();
    this.landmarks = new WorldLandmarks(maze); this.scene.add(this.landmarks.group);
    const extent = Math.hypot(maze.width, maze.depth);
    this.camera.far = Math.max(1500, extent+500); this.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(sky, Math.max(50, extent*0.6), Math.max(250, extent*2.5+100));
  }
  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }
  render(player: Player): void {
    // A bounded shadow region follows the visitor instead of spreading over 100×100 cells.
    const x = Math.round(player.position.x*2)/2, z = Math.round(player.position.z*2)/2;
    this.sun.position.set(x, player.position.y??0, z).add(this.sunDirection); this.sun.target.position.set(x, player.position.y??0, z);
    this.camera.position.set(player.position.x, (player.position.y??0)+1.7, player.position.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
    this.wallSorter?.update(this.camera);
    this.landmarks?.update(this.camera);
    this.composer.render();
  }
  dispose(): void {
    this.observer.disconnect();
    disposeMeshes(this.scene);
    this.sun.shadow.dispose();
    this.wallSorter = null;
    this.landmarks = null;
    this.composer.passes.forEach(pass => pass.dispose());
    this.composer.dispose();
    this.renderer.dispose();
  }
}
