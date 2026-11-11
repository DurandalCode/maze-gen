import * as THREE from 'three';
import type { RenderWorld } from '../jobs/render-artifacts';
import type { MeshArtifact } from '../jobs/render-artifacts';
import { fabricMaterial, groundMaterial, woodMaterial } from './materials';

export function artifactGeometry(artifact: MeshArtifact): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(artifact.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(artifact.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
export interface WorldObjects {
  group: THREE.Group;
  fabric: THREE.InstancedMesh;
  roof: THREE.Mesh;
  panelMatrices: THREE.Matrix4[];
  panelCenters: THREE.Vector3[];
}
export function worldObjects(world: RenderWorld): WorldObjects {
  const physical = world.physical,
    environment = physical.document.environment;
  const group = new THREE.Group();
  group.name = 'physical-world';
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    panels = physical.solids.filter((s) => s.kind === 'panel');
  const fabric = new THREE.InstancedMesh(
    geometry,
    fabricMaterial(environment.wallColor, environment.translucentFabric),
    panels.length,
  );
  fabric.name = 'fabric-panels';
  fabric.castShadow = true;
  fabric.receiveShadow = true;
  const depth = environment.translucentFabric
    ? new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        opacity: 0.99,
        alphaHash: true,
      })
    : undefined;
  if (depth) fabric.customDepthMaterial = depth;
  const dummy = new THREE.Object3D(),
    panelMatrices: THREE.Matrix4[] = [],
    panelCenters: THREE.Vector3[] = [];
  panels.forEach((s, i) => {
    const length = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
    dummy.position.set((s.from.x + s.to.x) / 2, (s.topM + s.bottomM) / 2, (s.from.z + s.to.z) / 2);
    dummy.rotation.set(0, -Math.atan2(s.to.z - s.from.z, s.to.x - s.from.x), 0);
    dummy.scale.set(length, s.topM - s.bottomM, s.thicknessM);
    dummy.updateMatrix();
    fabric.setMatrixAt(i, dummy.matrix);
    panelMatrices.push(dummy.matrix.clone());
    panelCenters.push(dummy.position.clone());
  });
  fabric.instanceMatrix.needsUpdate = true;
  fabric.computeBoundingSphere();
  group.add(fabric);
  const beams = physical.solids.filter((s) => s.beam),
    wood = new THREE.InstancedMesh(geometry, woodMaterial(), beams.length);
  wood.name = 'timber-boards';
  wood.castShadow = true;
  wood.receiveShadow = true;
  const axis = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    x = new THREE.Vector3(),
    basis = new THREE.Matrix4(),
    color = new THREE.Color();
  beams.forEach((s, i) => {
    const b = s.beam!;
    axis.set(b.to.x - b.from.x, b.to.y - b.from.y, b.to.z - b.from.z);
    const length = axis.length();
    axis.normalize();
    normal.set(b.normal.x, b.normal.y, b.normal.z);
    normal.addScaledVector(axis, -normal.dot(axis)).normalize();
    x.crossVectors(axis, normal).normalize();
    basis.makeBasis(x, axis, normal);
    dummy.position.set((b.from.x + b.to.x) / 2, (b.from.y + b.to.y) / 2, (b.from.z + b.to.z) / 2);
    dummy.quaternion.setFromRotationMatrix(basis);
    dummy.scale.set(b.widthM, length, b.thicknessM);
    dummy.updateMatrix();
    wood.setMatrixAt(i, dummy.matrix);
    const shade = 0.83 + ((i * 0.61803398875) % 1) * 0.24;
    color.setRGB(shade, shade, shade);
    wood.setColorAt(i, color);
  });
  wood.instanceMatrix.needsUpdate = true;
  wood.computeBoundingSphere();
  group.add(wood);
  const fasteners = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.007, 6),
    new THREE.MeshStandardMaterial({ color: '#554f46', roughness: 0.65, metalness: 0.75 }),
    physical.fasteners.length,
  );
  fasteners.name = 'frame-fasteners';
  let bolt = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (const boltData of physical.fasteners) {
    normal.set(boltData.normal.x, boltData.normal.y, boltData.normal.z);
    const p = boltData.position;
    dummy.position.set(p.x, p.y, p.z);
    dummy.quaternion.setFromUnitVectors(up, normal);
    dummy.scale.set(
      boltData.radiusM / 0.009,
      boltData.thicknessM / 0.007,
      boltData.radiusM / 0.009,
    );
    dummy.updateMatrix();
    fasteners.setMatrixAt(bolt++, dummy.matrix);
  }
  fasteners.instanceMatrix.needsUpdate = true;
  fasteners.computeBoundingSphere();
  group.add(fasteners);
  const ground = new THREE.Mesh(artifactGeometry(world.groundMesh), groundMaterial());
  ground.name = 'outdoor-ground';
  ground.receiveShadow = true;
  group.add(ground);
  const floor = new THREE.Mesh(artifactGeometry(world.floorMesh), ground.material);
  floor.name = 'physical-floor';
  floor.receiveShadow = true;
  group.add(floor);
  const roof = new THREE.Mesh(
    artifactGeometry(world.roofMesh),
    fabricMaterial(environment.wallColor, environment.translucentFabric, true),
  );
  roof.name = 'physical-roof';
  roof.visible = environment.roof;
  roof.castShadow = true;
  roof.receiveShadow = true;
  if (depth) roof.customDepthMaterial = depth;
  group.add(roof);
  return { group, fabric, roof, panelMatrices, panelCenters };
}
export function sortFabric(objects: WorldObjects, camera: THREE.Camera): void {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const ids = objects.panelCenters
    .map((p, id) => ({ id, depth: p.clone().sub(camera.position).dot(direction) }))
    .sort((a, b) => b.depth - a.depth || a.id - b.id);
  ids.forEach((p, i) => objects.fabric.setMatrixAt(i, objects.panelMatrices[p.id]!));
  objects.fabric.instanceMatrix.needsUpdate = true;
}
