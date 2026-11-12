import * as THREE from 'three';
import { domainOf } from '../core/domain';
import { portalPoint, walls, type Maze } from '../core/maze';
import { freePortal, freeRuntime } from '../free/layout';

export const EXIT_TOWER_HEIGHT = 6;

/** Use the actual rotated opening, not the legacy side label of free portals. */
export function exitTowerFrame(maze: Maze) {
  const exit = portalPoint(maze, maze.exit);
  const normal = maze.version === 5 || maze.version === 7
    ? freePortal(maze, maze.exit.freeId!).normal
    : { north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
      east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }[maze.exit.side];
  // Keep the whole tower beyond the construction, including concave layouts.
  let beyond = 0;
  const boundaries = maze.version === 5 || maze.version === 7
    ? freeRuntime(maze).boundaries : domainOf(maze).boundary.map(edge => edge.wall);
  for (const wall of [...boundaries, ...walls(maze)]) {
    for (const [x, z] of [[wall.x1, wall.z1], [wall.x2, wall.z2]])
      beyond = Math.max(beyond, (x! - exit.x) * normal.x + (z! - exit.z) * normal.z);
  }
  return { origin: { x: exit.x + normal.x * (beyond + 4), z: exit.z + normal.z * (beyond + 4) },
    normal, rotation: Math.atan2(normal.x, normal.z) };
}

/** A simple painted A-frame: real depth-tested geometry, exactly six metres tall. */
export function exitTowerMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group(), frame = exitTowerFrame(maze);
  group.name = 'exit-tower-landmark';
  group.position.set(frame.origin.x, 0, frame.origin.z);
  group.rotation.y = frame.rotation;
  const material = new THREE.MeshStandardMaterial({ color: '#e8a339', roughness: .85 });
  const add = (geometry: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const side of [-1, 1]) {
    const leg = new THREE.Shape();
    leg.moveTo(side * 2, 0); leg.lineTo(side * 1.55, 0);
    leg.lineTo(-side * .17, 5.5); leg.lineTo(0, EXIT_TOWER_HEIGHT); leg.closePath();
    const geometry = new THREE.ExtrudeGeometry(leg, { depth: .22, bevelEnabled: false });
    for (const z of [-.8, .58]) add(geometry, 0, 0, z);
  }
  for (const z of [-.69, .69]) add(new THREE.BoxGeometry(2.5, .28, .24), 0, 2.45, z);
  // Tie the two A-frames into a recognisable three-dimensional tower.
  for (const x of [-1.16, 1.16]) add(new THREE.BoxGeometry(.24, .24, 1.6), x, 2.45, 0);
  add(new THREE.BoxGeometry(.24, .24, 1.6), 0, 5.7, 0);
  return group;
}
