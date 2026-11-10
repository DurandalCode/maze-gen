import * as THREE from 'three';
import type { Maze } from '../core/maze';
import { freeRuntime } from './layout';
import { distance, ends } from './geometry';
import { fabricMaterial } from '../renderer/fabric-material';
import { groundMaterial } from '../renderer/ground';
import { timberMesh } from '../renderer/timber-mesh';
export function freeMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group(), r = freeRuntime(maze), material = fabricMaterial(maze.wallColor, maze.translucentFabric);
  for (const w of r.panels) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(distance(...ends(w)), maze.wallHeight, .006), material);
    mesh.name = 'fabric-wall';
    mesh.position.set((w.x1 + w.x2) / 2, maze.wallHeight / 2, (w.z1 + w.z2) / 2);
    mesh.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.add(timberMesh(maze));
  if (maze.roof) {
    const roofMaterial = fabricMaterial(maze.wallColor, maze.translucentFabric, 'roof');
    roofMaterial.side = THREE.DoubleSide;
    const surfaces = [...r.rooms.map(s => ({ polygon: s.polygon, holes: s.holes })), ...r.connections.map(c => ({ polygon: c.polygon, holes: [] }))];
    for (const s of surfaces) {
      const shape = new THREE.Shape(s.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
      shape.holes = s.holes.map(h => new THREE.Path(h.map(p => new THREE.Vector2(p.x, -p.z))));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), roofMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = maze.wallHeight;
      mesh.name = 'free-roof';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maze.width + 100, maze.depth + 100), groundMaterial(maze.width + 100, maze.depth + 100));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(maze.width / 2, -.025, maze.depth / 2);
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}
