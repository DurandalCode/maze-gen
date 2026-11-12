import * as THREE from 'three';
import { environmentOf, forestFrame, sunDirection } from '../core/environment';
import type { Maze } from '../core/maze';
import { random } from '../core/random';
import { foliageAssets } from './foliage';
import { exitTowerMesh } from './exit-tower';

function sunHalo(): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size*size*4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x+0.5)/size-0.5, (y+0.5)/size-0.5)*2;
    const glow = Math.exp(-radius*radius*10)*Math.max(0, 1-radius);
    const i = (y*size+x)*4;
    pixels[i] = 255; pixels[i+1] = 228; pixels[i+2] = 174; pixels[i+3] = Math.round(glow*180);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Continuous movable treeline; tree variation never uses the maze seed. */
export function forestMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group(); group.name = 'forest-landmark';
  const environment = environmentOf(maze), frame = forestFrame(maze, environment);
  group.position.set(frame.origin.x, 0, frame.origin.z); group.rotation.y = frame.rotation;
  const rng = random('maze-lab-north-forest-v1');
  const spacing = Math.max(4.5, (frame.length+80)/160);
  const perRow = Math.ceil((frame.length+80)/spacing), treeCount = perRow*3;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.8, 1, 7),
    new THREE.MeshStandardMaterial({ color: '#5b5041', roughness: 1 }), treeCount);
  trunks.name = 'forest-trunks'; trunks.castShadow = true; trunks.receiveShadow = true;
  const foliageAsset = foliageAssets();
  const crowns = new THREE.InstancedMesh(foliageAsset.geometry, foliageAsset.material, treeCount*11);
  crowns.name = 'forest-foliage'; crowns.castShadow = true; crowns.receiveShadow = true;
  const dummy = new THREE.Object3D(), leafColor = new THREE.Color();
  let tree = 0, foliage = 0;
  const crown = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(rx, ry, rz);
    dummy.rotation.set((rng()-0.5)*0.3, rng()*Math.PI, (rng()-0.5)*0.3);
    dummy.updateMatrix(); crowns.setMatrixAt(foliage, dummy.matrix);
    leafColor.setHSL(0.23+rng()*0.07, 0.18+rng()*0.18, 0.45+rng()*0.18);
    crowns.setColorAt(foliage++, leafColor);
  };
  for (let row = 0; row < 3; row++) for (let i = 0; i < perRow; i++) {
    const x = -40+(i+0.5)*spacing+(rng()-0.5)*spacing*0.6;
    const z = -environment.forest.distance-row*8-rng()*4;
    const height = 12+rng()*9, radius = 1.8+rng()*1.2;
    dummy.position.set(x, height*0.35, z); dummy.scale.set(0.26, height*0.7, 0.26);
    dummy.rotation.set(0, rng()*Math.PI, 0); dummy.updateMatrix(); trunks.setMatrixAt(tree++, dummy.matrix);
    crown(x, height*0.74, z, radius, height*0.27, radius);
    for (let branch = 0; branch < 6; branch++) {
      const angle = branch*Math.PI/3+rng()*0.5;
      crown(x+Math.cos(angle)*radius*0.65, height*(0.62+rng()*0.17), z+Math.sin(angle)*radius*0.65,
        radius*0.78, height*0.16, radius*0.78);
    }
    crown(x+0.3, height*0.93, z, radius*0.7, height*0.13, radius*0.7);
    for (let shrub = 0; shrub < 3; shrub++)
      crown(x+(rng()-0.5)*spacing, 0.8+rng()*0.8, z+2+(rng()-0.5)*3, 1.5+rng(), 1.3+rng(), 1.5+rng());
  }
  trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere(); crowns.computeBoundingSphere();
  group.add(trunks, crowns);
  return group;
}

export class WorldLandmarks {
  readonly group = new THREE.Group();
  private sun = new THREE.Group();
  private direction: THREE.Vector3;
  private disc: THREE.Mesh;
  private halo: THREE.Mesh;

  constructor(maze: Maze) {
    const direction = sunDirection(environmentOf(maze));
    this.direction = new THREE.Vector3(direction.x, direction.y, direction.z);
    this.sun.visible = direction.y >= 0;
    this.group.name = 'world-landmarks'; this.sun.name = 'sun-landmark';
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4d1').multiplyScalar(80),
        fog: false, toneMapped: false, depthWrite: false }));
    this.disc.name = 'sun-disc';
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: sunHalo(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, toneMapped: false,
    }));
    this.halo.name = 'sun-halo'; this.halo.renderOrder = -1;
    this.sun.add(this.disc, this.halo);
    this.group.add(forestMesh(maze), exitTowerMesh(maze), this.sun);
  }

  update(camera: THREE.PerspectiveCamera): void {
    const distance = camera.far*0.95;
    // Move with the camera so the sun keeps a fixed world direction without parallax.
    this.sun.position.copy(camera.position).addScaledVector(this.direction, distance);
    this.disc.scale.setScalar(distance*0.0047);
    this.halo.scale.setScalar(distance*0.045);
    this.disc.quaternion.copy(camera.quaternion); this.halo.quaternion.copy(camera.quaternion);
  }
}
