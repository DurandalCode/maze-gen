import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { freeRooms, roomPanels } from './fixtures/free-rooms';
import { bridgeFixture } from './fixtures/free-bridge';
import { mazeDraft } from '../src/free/json';
import { freeMaze, freePortal, freeRuntime } from '../src/free/layout';
import { serialize } from '../src/persistence/maze-json';
import { EXIT_TOWER_HEIGHT, exitTowerFrame, exitTowerMesh } from '../src/renderer/exit-tower';
import { disposeMeshes } from '../src/renderer/dispose';

test('six-metre A tower follows a rotated free exit and clears all construction', () => {
  const draft = mazeDraft(freeRooms(2, 2));
  for (const m of draft.layout.modules) {
    const { x, z } = m, a = Math.PI / 3;
    m.x = 12 + x * Math.cos(a) - z * Math.sin(a);
    m.z = 4 + x * Math.sin(a) + z * Math.cos(a); m.angle = 60;
  }
  draft.parameters.columns = draft.parameters.rows = 30;
  roomPanels(draft.layout);
  for (const maze of [freeMaze(draft), freeMaze(bridgeFixture())]) {
    const before = serialize(maze), frame = exitTowerFrame(maze), portal = freePortal(maze, maze.exit.freeId!);
    expect(frame.normal).toEqual(portal.normal);
    expect(maze.exit.side).toBe('north'); // This compatibility label is not its physical direction.
    const tower = exitTowerMesh(maze), box = new THREE.Box3().setFromObject(tower);
    expect(box.min.y).toBe(0); expect(box.max.y).toBe(EXIT_TOWER_HEIGHT);
    expect(EXIT_TOWER_HEIGHT).toBe(6);
    for (const wall of freeRuntime(maze).boundaries) for (const p of [{ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }]) {
      expect((frame.origin.x - p.x) * frame.normal.x + (frame.origin.z - p.z) * frame.normal.z).toBeGreaterThanOrEqual(4 - 1e-7);
    }
    tower.traverse(object => {
      if (object instanceof THREE.Mesh) expect((object.material as THREE.Material).depthTest).toBe(true);
    });
    expect(serialize(maze)).toBe(before);
    disposeMeshes(tower);
  }
});
