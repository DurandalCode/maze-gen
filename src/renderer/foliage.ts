import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from '../core/random';

/** Leaf clusters with cut-out edges; crossed cards retain a treelike silhouette from every side. */
export function foliageAssets(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  const size = 256, pixels = new Uint8Array(size*size*4), rng = random('maze-lab-leaf-clusters');
  for (let cluster = 0; cluster < 30; cluster++) {
    const angle = rng()*Math.PI*2, radius = Math.sqrt(rng())*size*0.37;
    const cx = size/2+Math.cos(angle)*radius, cy = size/2+Math.sin(angle)*radius;
    for (let leaf = 0; leaf < 95; leaf++) {
      const a = rng()*Math.PI*2, r = Math.sqrt(rng())*(12+rng()*15);
      const x = cx+Math.cos(a)*r, y = cy+Math.sin(a)*r;
      const rx = 1+rng()*2.2, ry = 1.5+rng()*2.8, shade = 0.55+rng()*0.45;
      for (let py = Math.max(0, Math.floor(y-ry)); py <= Math.min(size-1, Math.ceil(y+ry)); py++)
        for (let px = Math.max(0, Math.floor(x-rx)); px <= Math.min(size-1, Math.ceil(x+rx)); px++) {
          const d = ((px-x)/rx)**2+((py-y)/ry)**2;
          if (d > 1) continue;
          const i = (py*size+px)*4;
          pixels[i] = 165*shade; pixels[i+1] = 190*shade; pixels[i+2] = 130*shade;
          pixels[i+3] = Math.max(pixels[i+3]!, Math.round(Math.min(1, (1-d)*5)*255));
        }
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  const cards = [0, Math.PI/3, Math.PI*2/3].map(angle => new THREE.PlaneGeometry(2, 2).rotateY(angle));
  const geometry = mergeGeometries(cards);
  cards.forEach(card => card.dispose());
  return { geometry, material: new THREE.MeshStandardMaterial({
    color: '#ffffff', map: texture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1,
  }) };
}
