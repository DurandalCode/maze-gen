import * as THREE from 'three';
import { random } from '../core/random';

/** Small local procedural texture: longitudinal grain, saw marks and two knots. */
export function woodMaterial(): THREE.MeshStandardMaterial {
  const width = 96, height = 512, data = new Uint8Array(width * height * 4);
  const rng = random('maze-lab-weathered-pine-v1');
  const fibers = Array.from({ length: width }, () => rng());
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    let warp = u;
    let knotDarkness = 0;
    for (const [kx, ky] of [[0.28, 0.31], [0.76, 0.78]]) {
      const dx = u-kx!, dy = (v-ky!) * 5;
      const radius = Math.hypot(dx, dy);
      warp += Math.exp(-radius*7) * dx * 0.45;
      knotDarkness += Math.exp(-radius*22)*0.25 + Math.sin(radius*100)*Math.exp(-radius*10)*0.055;
    }
    const grain = Math.sin(warp*170 + Math.sin(v*9)*1.8)*0.035 + Math.sin(warp*410 + v*4)*0.022;
    const streak = (fibers[Math.min(width-1, Math.floor(warp*width+width)%width)]! - 0.5)*0.095;
    const saw = Math.sin(y*1.7 + x*0.3)*0.012;
    const value = Math.max(0.16, Math.min(0.85, 0.59 + grain + streak + saw - knotDarkness + (rng()-0.5)*0.055));
    const i = (y*width+x)*4;
    data[i] = Math.round(value*255); data[i+1] = Math.round(value*235); data[i+2] = Math.round(value*210); data[i+3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = 'weathered-board-grain';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 });
}
