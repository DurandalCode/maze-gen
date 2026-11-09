import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Blend transmitted light in linear HDR before applying exposure and display tone mapping. */
export function sceneComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): EffectComposer {
  const composer = new EffectComposer(renderer);
  // Canvas antialiasing does not apply to offscreen render targets.
  composer.renderTarget1.samples = composer.renderTarget2.samples = Math.min(4, renderer.capabilities.maxSamples);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  return composer;
}
