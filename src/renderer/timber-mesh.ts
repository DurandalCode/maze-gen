import * as THREE from 'three';
import type { Maze } from '../core/maze';
import { BOARD_THICKNESS, BOARD_WIDTH, HEADER_DEPTH, timberStructure } from '../core/structure';
import { random } from '../core/random';
import { woodMaterial } from './wood';

export function timberMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group(); group.name = 'timber-structure';
  const { posts, frames, braceDrop } = timberStructure(maze);
  const hasBraces = braceDrop > 0.06;
  const count = posts.length * 2 + frames.length * (hasBraces ? 3 : 1);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), woodMaterial(), count);
  boards.name = 'timber-boards'; boards.castShadow = true; boards.receiveShadow = true;
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.007, 6),
    new THREE.MeshStandardMaterial({ color: '#554f46', roughness: 0.65, metalness: 0.75 }), frames.length * (hasBraces ? 6 : 2));
  bolts.name = 'frame-fasteners';
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const rng = random('maze-lab-board-shades');
  const color = new THREE.Color();
  const basis = new THREE.Matrix4();
  const headerDepth = Math.min(HEADER_DEPTH, Math.max(0.03, maze.wallHeight - 1.78));
  let boardIndex = 0, boltIndex = 0;
  const board = (a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number, normal = new THREE.Vector3(0, 0, 1)) => {
    direction.subVectors(b, a);
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    const lengthAxis = direction.clone().normalize();
    basis.makeBasis(lengthAxis.clone().cross(normal).normalize(), lengthAxis, normal);
    dummy.quaternion.setFromRotationMatrix(basis);
    dummy.scale.set(width, direction.length(), thickness); dummy.updateMatrix();
    boards.setMatrixAt(boardIndex, dummy.matrix);
    const shade = 0.78 + rng()*0.3;
    color.setRGB(shade, shade, shade);
    boards.setColorAt(boardIndex++, color);
  };
  const bolt = (point: THREE.Vector3, normal: THREE.Vector3) => {
    dummy.position.copy(point); dummy.quaternion.setFromUnitVectors(up, normal);
    dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bolts.setMatrixAt(boltIndex++, dummy.matrix);
  };
  const height = maze.wallHeight;
  for (const post of posts) {
    // Two perpendicular planks form a shared corner, instead of a solid square pole.
    board(new THREE.Vector3(post.x, 0, post.z), new THREE.Vector3(post.x, height, post.z), BOARD_WIDTH, BOARD_THICKNESS);
    dummy.position.set(post.x, height/2, post.z);
    dummy.rotation.set(0, Math.PI/2, 0); dummy.scale.set(BOARD_WIDTH, height, BOARD_THICKNESS); dummy.updateMatrix();
    boards.setMatrixAt(boardIndex, dummy.matrix);
    const shade = 0.78 + rng()*0.3; color.setRGB(shade, shade, shade); boards.setColorAt(boardIndex++, color);
  }
  for (const frame of frames) {
    const a = new THREE.Vector3(frame.x1, height-headerDepth/2, frame.z1);
    const b = new THREE.Vector3(frame.x2, height-headerDepth/2, frame.z2);
    const along = b.clone().sub(a).normalize();
    const normal = new THREE.Vector3(-along.z, 0, along.x);
    // Boards straddle the fabric: the broad wooden faces remain visible on each side.
    const offset = normal.clone().multiplyScalar(0.052);
    board(a.clone().add(offset), b.clone().add(offset), headerDepth, BOARD_THICKNESS, normal);
    for (const end of [a, b]) bolt(end.clone().addScaledVector(normal, 0.076), normal);
    if (!hasBraces) continue;
    const span = Math.min(braceDrop * 1.15, maze.parameters.corridorWidth * 0.32);
    for (const [end, sign] of [[a, 1], [b, -1]] as const) {
      const low = end.clone().add(offset); low.y -= braceDrop;
      const high = end.clone().add(offset).addScaledVector(along, sign * span);
      board(low, high, BOARD_WIDTH * 0.8, BOARD_THICKNESS, normal);
      bolt(low.clone().addScaledVector(normal, 0.024), normal);
      bolt(high.clone().addScaledVector(normal, 0.024), normal);
    }
  }
  boards.instanceMatrix.needsUpdate = true; boards.computeBoundingSphere();
  bolts.instanceMatrix.needsUpdate = true; bolts.computeBoundingSphere();
  group.add(boards, bolts);
  return group;
}
