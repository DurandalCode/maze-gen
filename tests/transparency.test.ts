import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { TransparentWallSorter } from '../src/renderer/transparent-walls';

test('overlapping transparent panels keep back-to-front order after turning away and back', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2.5, 0.06),
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false }), 3);
  const transform = new THREE.Matrix4();
  [-2, -6, 4].forEach((z, i) => mesh.setMatrixAt(i, transform.makeTranslation(0, 1.25, z)));
  const sorter = new TransparentWallSorter(mesh), camera = new THREE.PerspectiveCamera();
  const positions = () => Array.from({ length: 3 }, (_, i) => { mesh.getMatrixAt(i, transform); return transform.elements[14]; });
  sorter.update(camera);
  expect(positions()).toEqual([-6, -2, 4]);
  camera.rotation.y = Math.PI; sorter.update(camera);
  expect(positions()).toEqual([4, -2, -6]);
  camera.rotation.y = 0; sorter.update(camera);
  expect(positions()).toEqual([-6, -2, 4]);
  mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose();
});
