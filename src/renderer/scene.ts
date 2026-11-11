import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RenderWorld } from '../jobs/render-artifacts';
import { disposeObjects } from './dispose';
import { forest, SunLandmark, sunDirection } from './environment';
import { VISUAL_V1 } from './visual-profile';
import { sortFabric, worldObjects } from './world-objects';
import type { WorldObjects } from './world-objects';
export interface CameraPose {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
}
export class WorldScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    VISUAL_V1.camera.fovDegrees,
    1,
    VISUAL_V1.camera.nearM,
    VISUAL_V1.camera.farM,
  );
  private orbit: OrbitControls;
  private observer: ResizeObserver;
  private objects: WorldObjects | null = null;
  private landmarks = new THREE.Group();
  private sunLandmark: SunLandmark | null = null;
  private sun = new THREE.DirectionalLight(VISUAL_V1.light.sunColor, VISUAL_V1.light.sunIntensity);
  private ambient = new THREE.HemisphereLight(
    VISUAL_V1.light.hemisphereSky,
    VISUAL_V1.light.hemisphereGround,
    VISUAL_V1.light.hemisphereIntensity,
  );
  private sunVector = new THREE.Vector3();
  private frame = 0;
  private lastTime = 0;
  private lost = false;
  private disposed = false;
  private walking = false;
  private extent = 50;
  private lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lastQuaternion = new THREE.Quaternion();
  private shadowCenter = new THREE.Vector2(Infinity, Infinity);
  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.stop();
    if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
    this.contextChanged?.('lost');
  };
  private onRestored = () => {
    this.lost = false;
    this.contextChanged?.('restored');
    this.render();
  };
  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly contextChanged?: (state: 'lost' | 'restored') => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, VISUAL_V1.renderer.maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = VISUAL_V1.renderer.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -16,
      right: 16,
      top: 16,
      bottom: -16,
      near: 1,
      far: 100,
    });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target, this.ambient);
    this.camera.rotation.order = 'YXZ';
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 0.1;
    this.orbit.maxDistance = 500;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.resize();
  }
  setWorld(world: RenderWorld): void {
    if (this.disposed) throw new Error('Scene disposed');
    if (this.objects) {
      this.scene.remove(this.objects.group);
      disposeObjects(this.objects.group);
    }
    this.scene.remove(this.landmarks);
    disposeObjects(this.landmarks);
    this.objects = worldObjects(world);
    this.scene.add(this.objects.group);
    const p = world.physical,
      b = p.bounds,
      e = p.document.environment,
      extent = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    this.extent = extent;
    this.sunVector.copy(sunDirection(e.sun));
    const daylight = THREE.MathUtils.smoothstep(this.sunVector.y, -0.1, 0.15);
    this.sun.intensity = this.sunVector.y > 0 ? 2.1 * daylight : 0;
    this.ambient.intensity = 0.12 + 2.18 * daylight;
    const sky = new THREE.Color('#101927').lerp(new THREE.Color('#c9dce5'), daylight);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(
      sky,
      Math.max(50, extent * 0.6),
      Math.max(250, extent * 2.5 + 100),
    );
    this.camera.far = Math.max(1500, Math.abs(e.forest.offset) + e.forest.distance + extent + 500);
    this.camera.updateProjectionMatrix();
    this.sunLandmark = new SunLandmark(this.sunVector.clone());
    this.landmarks = new THREE.Group();
    this.landmarks.add(forest(e, b), this.sunLandmark.group);
    this.scene.add(this.landmarks);
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.orbit.target.copy(center);
    this.camera.position
      .copy(center)
      .add(new THREE.Vector3(extent * 0.5, Math.max(8, extent * 0.5), extent * 0.5));
    this.camera.lookAt(center);
    this.orbit.update();
    this.shadowCenter.set(Infinity, Infinity);
    this.lastCamera.set(Infinity, Infinity, Infinity);
    this.renderer.shadowMap.needsUpdate = true;
    this.render();
  }
  setPreview(position: [number, number, number], target: [number, number, number]): void {
    if (this.walking) this.shadowCenter.set(Infinity, Infinity);
    this.walking = false;
    this.orbit.enabled = true;
    this.camera.position.set(...position);
    this.orbit.target.set(...target);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
    this.render();
  }
  setPose(pose: CameraPose): void {
    if (!this.walking) this.shadowCenter.set(Infinity, Infinity);
    this.walking = true;
    this.orbit.enabled = false;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.rotation.set(pose.pitch, pose.yaw, 0);
  }
  resize(): void {
    if (this.disposed) return;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, VISUAL_V1.renderer.maxDpr));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  render(): void {
    if (this.disposed || this.lost || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
    const focus = this.walking ? this.camera.position : this.orbit.target,
      x = Math.round(focus.x * 2) / 2,
      z = Math.round(focus.z * 2) / 2;
    if (x !== this.shadowCenter.x || z !== this.shadowCenter.y) {
      this.shadowCenter.set(x, z);
      const size = this.walking ? 16 : Math.max(16, this.extent * 0.65 + 10);
      Object.assign(this.sun.shadow.camera, {
        left: -size,
        right: size,
        top: size,
        bottom: -size,
        far: Math.max(100, size * 4),
      });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.position.set(x, 0, z).addScaledVector(this.sunVector, Math.max(40, size * 2));
      this.sun.target.position.set(x, 0, z);
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (
      this.objects &&
      (this.camera.position.distanceToSquared(this.lastCamera) > 1e-5 ||
        this.camera.quaternion.angleTo(this.lastQuaternion) > 0.001)
    ) {
      if ((this.objects.fabric.material as THREE.Material).transparent)
        sortFabric(this.objects, this.camera);
      this.lastCamera.copy(this.camera.position);
      this.lastQuaternion.copy(this.camera.quaternion);
    }
    this.sunLandmark?.update(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
  start(update?: (dt: number) => void): void {
    this.stop();
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed || this.lost) return;
      const dt = Math.min(5 / 60, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      if (document.visibilityState !== 'hidden') {
        update?.(dt);
        if (!this.walking) this.orbit.update();
        this.render();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  restore(): void {
    if (this.lost) this.renderer.forceContextRestore();
    else {
      this.renderer.shadowMap.needsUpdate = true;
      this.render();
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.orbit.dispose();
    if (this.objects) disposeObjects(this.objects.group);
    this.objects = null;
    disposeObjects(this.landmarks);
    this.sunLandmark = null;
    this.sun.shadow.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
