import * as THREE from 'three';
import { WALL_THICKNESS, walls, type Maze } from '../core/maze';
import { timberMesh } from './timber-mesh';
import { groundMaterial } from './ground';
import { fabricMaterial } from './fabric-material';

export function mazeMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group();
  const segments = walls(maze);
  const material = fabricMaterial(maze.wallColor, maze.translucentFabric);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, segments.length);
  mesh.name = 'fabric-walls';
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (maze.translucentFabric) mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, opacity: 0.99, alphaHash: true,
  });
  const dummy = new THREE.Object3D();
  segments.forEach((wall, i) => {
    const horizontal = wall.z1 === wall.z2;
    dummy.position.set((wall.x1+wall.x2)/2, maze.wallHeight/2, (wall.z1+wall.z2)/2);
    dummy.scale.set(horizontal ? wall.x2-wall.x1+WALL_THICKNESS : WALL_THICKNESS,
      maze.wallHeight, horizontal ? WALL_THICKNESS : wall.z2-wall.z1+WALL_THICKNESS);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere(); group.add(mesh);
  group.add(timberMesh(maze));
  if (maze.roof) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(maze.width + WALL_THICKNESS, WALL_THICKNESS, maze.depth + WALL_THICKNESS),
      material,
    );
    roof.name = 'roof';
    roof.castShadow = true; roof.receiveShadow = true;
    roof.customDepthMaterial = mesh.customDepthMaterial;
    // Lower surface sits exactly at the top of the walls and uses the same fabric.
    roof.position.set(maze.width / 2, maze.wallHeight + WALL_THICKNESS / 2, maze.depth / 2);
    group.add(roof);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(maze.width+100, maze.depth+100),
    groundMaterial(maze.width+100, maze.depth+100));
  floor.rotation.x = -Math.PI/2; floor.position.set(maze.width/2, -0.025, maze.depth/2); group.add(floor);
  floor.receiveShadow = true;
  return group;
}
