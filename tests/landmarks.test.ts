import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SUN_DIRECTION } from '../src/core/environment';
import { generate } from '../src/generators/generate';
import { forestMesh, WorldLandmarks } from '../src/renderer/landmarks';
import { disposeMeshes } from '../src/renderer/dispose';

const maze = (seed = 'landmarks') => generate({ columns: 5, rows: 5, moduleSize: 2, corridorWidth: 2, extraConnections: 0, seed, algorithm: 'prim' });

test('the same north forest remains in place when the maze seed changes', () => {
  const a = forestMesh(maze('first')), b = forestMesh(maze('second'));
  const trunksA = a.getObjectByName('forest-trunks') as THREE.InstancedMesh;
  const trunksB = b.getObjectByName('forest-trunks') as THREE.InstancedMesh;
  expect(trunksA.instanceMatrix.array).toEqual(trunksB.instanceMatrix.array);
  const leaves = a.getObjectByName('forest-foliage') as THREE.InstancedMesh;
  leaves.computeBoundingBox(); trunksA.computeBoundingBox();
  expect(leaves.boundingBox!.max.z).toBeLessThan(0);
  expect(trunksA.boundingBox!.max.z).toBeLessThan(0);
  disposeMeshes(a); disposeMeshes(b);
});

test('visible sun keeps the lighting direction after walking and changing the camera view', () => {
  const landmarks = new WorldLandmarks(maze());
  const camera = new THREE.PerspectiveCamera(76, 1, 0.05, 1500);
  const expected = new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
  for (const [x, z, yaw] of [[0, 0, 0], [18, 12, Math.PI], [-5, 6, -Math.PI/2]]) {
    camera.position.set(x!, 1.7, z!); camera.rotation.y = yaw!;
    landmarks.update(camera);
    const sun = landmarks.group.getObjectByName('sun-landmark')!;
    const direction = sun.position.clone().sub(camera.position).normalize();
    expect(direction.distanceTo(expected)).toBeLessThan(1e-8);
    expect(sun.position.distanceTo(camera.position)).toBeLessThan(camera.far);
  }
  disposeMeshes(landmarks.group);
});
