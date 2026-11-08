import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { walls } from '../src/core/maze';
import { supportColliders, timberStructure } from '../src/core/structure';
import { generate } from '../src/generators/generate';
import { timberMesh } from '../src/renderer/timber-mesh';
import { disposeMeshes } from '../src/renderer/dispose';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';

const parameters = { columns: 2, rows: 2, corridorWidth: 1.5, extraConnections: 20000, seed: 'frames', algorithm: 'prim' as const };

test('an open intersection has one shared upright and physical collision', () => {
  const maze = generate(parameters);
  const structure = timberStructure(maze);
  const center = structure.posts.filter(p => p.x === 1.5 && p.z === 1.5);
  expect(center.length).toBe(1);
  const world = new CollisionWorld([...walls(maze), ...supportColliders(maze)]);
  expect(world.blocked({ x: 1.5, z: 1.5 })).toBe(true);
  const stopped = world.move({ x: 0.75, z: 1.5 }, { x: 2, z: 0 });
  expect(stopped.x).toBeLessThanOrEqual(1.19);
});

test('frame uprights leave minimum-width entrances and corridors traversable', () => {
  const maze = generate({ ...parameters, columns: 1, rows: 1, corridorWidth: 0.8 });
  const player = new Player(maze, new CollisionWorld([...walls(maze), ...supportColliders(maze)]));
  for (let i = 0; i < 100 && !player.finished; i++) player.update(1/60, new Set(['KeyW']));
  expect(player.finished).toBe(true);
  expect(player.recorder.distance).toBeCloseTo(0.8);
});

test('overhead boards stay above the camera and below the roof at every allowed height', () => {
  for (const wallHeight of [1.8, 2.2, 10]) {
    const maze = { ...generate(parameters), wallHeight };
    const structure = timberStructure(maze);
    const group = timberMesh(maze);
    const boards = group.getObjectByName('timber-boards');
    if (!(boards instanceof THREE.InstancedMesh)) throw new Error('Missing timber boards');
    const matrix = new THREE.Matrix4();
    for (let i = structure.posts.length*2; i < boards.count; i++) {
      boards.getMatrixAt(i, matrix);
      const box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix);
      expect(box.min.y).toBeGreaterThan(1.7);
      expect(box.max.y).toBeLessThanOrEqual(wallHeight+0.001);
    }
    disposeMeshes(group);
  }
});

test('changing the scene releases shared wood textures exactly once', () => {
  const group = timberMesh(generate(parameters));
  const boards = group.getObjectByName('timber-boards') as THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  let released = 0;
  boards.material.map!.addEventListener('dispose', () => released++);
  disposeMeshes(group);
  expect(released).toBe(1);
});
