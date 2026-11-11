import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../domain';
import type { Environment } from '../domain';
import type { Bounds } from '../geometry/predicates';

/** Fixed Moscow/August scene convention, independent of host date and timezone. */
export function sunDirection(sun: Environment['sun']): THREE.Vector3 {
  const rad = Math.PI / 180,
    latitude = 55.7558 * rad,
    gamma = ((2 * Math.PI) / 365) * (211 + sun.day + (sun.minutes / 60 - 12) / 24);
  const equation =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const solarMinutes = (((sun.minutes + equation + 4 * 37.6173 - 180) % 1440) + 1440) % 1440,
    hour = (solarMinutes / 4 - 180) * rad;
  const elevation = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        Math.sin(latitude) * Math.sin(declination) +
          Math.cos(latitude) * Math.cos(declination) * Math.cos(hour),
      ),
    ),
  );
  const azimuth =
    Math.atan2(
      Math.sin(hour),
      Math.cos(hour) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
    ) + Math.PI;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  );
}
function leafAssets(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  const size = 256,
    pixels = new Uint8Array(size * size * 4),
    rng = new Random('visual-leaf-clusters-v1');
  for (let cluster = 0; cluster < 30; cluster++) {
    const angle = rng.next() * Math.PI * 2,
      radius = Math.sqrt(rng.next()) * size * 0.37,
      cx = size / 2 + Math.cos(angle) * radius,
      cy = size / 2 + Math.sin(angle) * radius;
    for (let leaf = 0; leaf < 95; leaf++) {
      const a = rng.next() * Math.PI * 2,
        r = Math.sqrt(rng.next()) * (12 + rng.next() * 15),
        x = cx + Math.cos(a) * r,
        y = cy + Math.sin(a) * r,
        rx = 1 + rng.next() * 2.2,
        ry = 1.5 + rng.next() * 2.8,
        shade = 0.55 + rng.next() * 0.45;
      for (
        let py = Math.max(0, Math.floor(y - ry));
        py <= Math.min(size - 1, Math.ceil(y + ry));
        py++
      )
        for (
          let px = Math.max(0, Math.floor(x - rx));
          px <= Math.min(size - 1, Math.ceil(x + rx));
          px++
        ) {
          const d = ((px - x) / rx) ** 2 + ((py - y) / ry) ** 2;
          if (d > 1) continue;
          const i = (py * size + px) * 4;
          pixels[i] = 165 * shade;
          pixels[i + 1] = 190 * shade;
          pixels[i + 2] = 130 * shade;
          pixels[i + 3] = Math.max(pixels[i + 3]!, Math.round(Math.min(1, (1 - d) * 5) * 255));
        }
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const cards = [0, Math.PI / 3, (Math.PI * 2) / 3].map((angle) =>
      new THREE.PlaneGeometry(2, 2).rotateY(angle),
    ),
    geometry = mergeGeometries(cards);
  cards.forEach((g) => g.dispose());
  return {
    geometry,
    material: new THREE.MeshStandardMaterial({
      map: texture,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1,
    }),
  };
}
export function forest(environment: Environment, b: Bounds): THREE.Group {
  const group = new THREE.Group();
  group.name = 'forest-landmark';
  const f = environment.forest,
    width = b.maxX - b.minX,
    depth = b.maxZ - b.minZ;
  const frames = {
    north: { x: b.minX + f.offset, z: b.minZ, rotation: 0, length: width },
    east: { x: b.maxX, z: b.minZ + f.offset, rotation: -Math.PI / 2, length: depth },
    south: { x: b.maxX - f.offset, z: b.maxZ, rotation: Math.PI, length: width },
    west: { x: b.minX, z: b.maxZ - f.offset, rotation: Math.PI / 2, length: depth },
  };
  const frame = frames[f.side];
  group.position.set(frame.x, 0, frame.z);
  group.rotation.y = frame.rotation;
  const spacing = Math.max(4.5, (frame.length + 80) / 160),
    perRow = Math.ceil((frame.length + 80) / spacing),
    count = perRow * 3,
    rng = new Random('visual-forest-v1');
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.55, 0.8, 1, 7),
    new THREE.MeshStandardMaterial({ color: '#5b5041', roughness: 1 }),
    count,
  );
  trunks.name = 'forest-trunks';
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  const leaves = leafAssets(),
    crowns = new THREE.InstancedMesh(leaves.geometry, leaves.material, count * 11);
  crowns.name = 'forest-foliage';
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  let tree = 0,
    leaf = 0;
  const crown = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(rx, ry, rz);
    dummy.rotation.set((rng.next() - 0.5) * 0.3, rng.next() * Math.PI, (rng.next() - 0.5) * 0.3);
    dummy.updateMatrix();
    crowns.setMatrixAt(leaf, dummy.matrix);
    color.setHSL(0.23 + rng.next() * 0.07, 0.18 + rng.next() * 0.18, 0.45 + rng.next() * 0.18);
    crowns.setColorAt(leaf++, color);
  };
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < perRow; i++) {
      const x = -40 + (i + 0.5) * spacing + (rng.next() - 0.5) * spacing * 0.6,
        z = -f.distance - row * 8 - rng.next() * 4,
        height = 12 + rng.next() * 9,
        radius = 1.8 + rng.next() * 1.2;
      dummy.position.set(x, height * 0.35, z);
      dummy.scale.set(0.26, height * 0.7, 0.26);
      dummy.rotation.set(0, rng.next() * Math.PI, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(tree++, dummy.matrix);
      crown(x, height * 0.74, z, radius, height * 0.27, radius);
      for (let branch = 0; branch < 6; branch++) {
        const angle = (branch * Math.PI) / 3 + rng.next() * 0.5;
        crown(
          x + Math.cos(angle) * radius * 0.65,
          height * (0.62 + rng.next() * 0.17),
          z + Math.sin(angle) * radius * 0.65,
          radius * 0.78,
          height * 0.16,
          radius * 0.78,
        );
      }
      crown(x + 0.3, height * 0.93, z, radius * 0.7, height * 0.13, radius * 0.7);
      for (let shrub = 0; shrub < 3; shrub++)
        crown(
          x + (rng.next() - 0.5) * spacing,
          0.8 + rng.next() * 0.8,
          z + 2 + (rng.next() - 0.5) * 3,
          1.5 + rng.next(),
          1.3 + rng.next(),
          1.5 + rng.next(),
        );
    }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  group.add(trunks, crowns);
  return group;
}
export class SunLandmark {
  readonly group = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  constructor(readonly direction: THREE.Vector3) {
    const size = 128,
      pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2,
          i = (y * size + x) * 4;
        pixels[i] = 255;
        pixels[i + 1] = 228;
        pixels[i + 2] = 174;
        pixels[i + 3] = Math.round(Math.exp(-radius * radius * 10) * Math.max(0, 1 - radius) * 180);
      }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#fff4d1').multiplyScalar(80),
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.disc.name = 'sun-disc';
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.halo.name = 'sun-halo';
    this.halo.renderOrder = -1;
    this.group.name = 'sun-landmark';
    this.group.visible = direction.y >= 0;
    this.group.add(this.disc, this.halo);
  }
  update(camera: THREE.PerspectiveCamera): void {
    const distance = camera.far * 0.95;
    this.group.position.copy(camera.position).addScaledVector(this.direction, distance);
    this.disc.scale.setScalar(distance * 0.0047);
    this.halo.scale.setScalar(distance * 0.045);
    this.disc.quaternion.copy(camera.quaternion);
    this.halo.quaternion.copy(camera.quaternion);
  }
}
