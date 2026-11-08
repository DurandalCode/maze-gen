import * as THREE from 'three';
import { random } from '../core/random';

export function groundMaterial(width: number, depth: number): THREE.MeshStandardMaterial {
  const size = 256, pixels = new Uint8Array(size * size * 4), rng = random('maze-lab-field');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const patch = Math.sin(x*0.033 + Math.sin(y*0.027)*3)*Math.sin(y*0.041)*0.11;
    const noise = (rng()-0.5)*0.25;
    const grass = 0.56 + patch + noise;
    const i = (y*size+x)*4;
    pixels[i] = grass*139; pixels[i+1] = grass*156; pixels[i+2] = grass*84; pixels[i+3] = 255;
  }
  // Fine pale and dark blades break up the noise without extra meshes or draw calls.
  for (let i = 0; i < 9000; i++) {
    const x = Math.floor(rng()*size), y = Math.floor(rng()*size), length = 2+Math.floor(rng()*6);
    const pale = rng() > 0.7;
    for (let k = 0; k < length; k++) {
      const index = (((y+k)%size)*size+(x+Math.floor(k*0.3))%size)*4;
      pixels[index] = pale ? 115 : 46; pixels[index+1] = pale ? 119 : 66; pixels[index+2] = pale ? 66 : 26;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width/3, depth/3);
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
}
