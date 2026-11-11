import {twoStoreyMesh} from './two-storey-mesh';
import {freeMesh} from '../free/mesh';
import { domainOf } from '../core/domain';
import * as THREE from 'three';
import { WALL_THICKNESS, walls, type Maze } from '../core/maze';
import { timberMesh } from './timber-mesh';
import { groundMaterial } from './ground';
import { fabricMaterial } from './fabric-material';

export function mazeMesh(maze: Maze): THREE.Group {
  if(maze.storeys)return twoStoreyMesh(maze);
  if((maze.version===5||maze.version===7))return freeMesh(maze);
  const group = new THREE.Group();
  const segments = walls(maze);
  // Fabric is thinner than the timber: a thick collision envelope must not
  // visually swallow jambs and wall-end posts. Legacy scenes retain their look.
  const fabricThickness=maze.version===4?.006:WALL_THICKNESS;
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
    dummy.scale.set(horizontal ? wall.x2-wall.x1+fabricThickness : fabricThickness,
      maze.wallHeight, horizontal ? fabricThickness : wall.z2-wall.z1+fabricThickness);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere(); group.add(mesh);
  group.add(timberMesh(maze));
  if (maze.roof && !maze.parameters.shape && !maze.layout?.spaces) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(maze.width+WALL_THICKNESS,WALL_THICKNESS,maze.depth+WALL_THICKNESS),
      fabricMaterial(maze.wallColor,maze.translucentFabric,'roof'));
    roof.name='roof'; roof.castShadow=true; roof.receiveShadow=true; roof.customDepthMaterial=mesh.customDepthMaterial;
    roof.position.set(maze.width/2,maze.wallHeight+WALL_THICKNESS/2,maze.depth/2);group.add(roof);
  } else if (maze.roof) {
    const domain = domainOf(maze);
    const rects = domain.cells.map(c=>domain.rectangles[c]!);
    const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      fabricMaterial(maze.wallColor,maze.translucentFabric,'roof'),rects.length);
    roof.name='roof'; roof.castShadow=true; roof.receiveShadow=true;
    roof.customDepthMaterial=mesh.customDepthMaterial;
    rects.forEach((r,i)=> {
      dummy.position.set((r.x1+r.x2)/2,maze.wallHeight+WALL_THICKNESS/2,(r.z1+r.z2)/2);
      dummy.scale.set(r.x2-r.x1,WALL_THICKNESS,r.z2-r.z1);
      dummy.updateMatrix(); roof.setMatrixAt(i,dummy.matrix);
    });
    roof.instanceMatrix.needsUpdate=true; roof.computeBoundingSphere(); group.add(roof);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(maze.width+100, maze.depth+100),
    groundMaterial(maze.width+100, maze.depth+100));
  floor.rotation.x = -Math.PI/2; floor.position.set(maze.width/2, -0.025, maze.depth/2); group.add(floor);
  floor.receiveShadow = true;
  return group;
}
