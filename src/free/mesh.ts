import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type { Maze } from '../core/maze';
import { freeRuntime } from './layout';
import { distance, ends } from './geometry';
import { fabricMaterial } from '../renderer/fabric-material';
import { groundMaterial } from '../renderer/ground';
import { timberMesh } from '../renderer/timber-mesh';
export function freeMesh(maze: Maze): THREE.Group {
  const group = new THREE.Group(), r = freeRuntime(maze), material = fabricMaterial(maze.wallColor, maze.translucentFabric);
  const walls=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,r.panels.length),dummy=new THREE.Object3D();
  walls.name='fabric-walls';walls.castShadow=true;walls.receiveShadow=true;
  if(maze.translucentFabric)walls.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,opacity:.99,alphaHash:true});
  r.panels.forEach((w,i)=>{
    dummy.position.set((w.x1+w.x2)/2,maze.wallHeight/2,(w.z1+w.z2)/2);
    dummy.rotation.set(0,-Math.atan2(w.z2-w.z1,w.x2-w.x1),0);
    dummy.scale.set(distance(...ends(w)),maze.wallHeight,.006);dummy.updateMatrix();walls.setMatrixAt(i,dummy.matrix);
  });
  walls.instanceMatrix.needsUpdate=true;walls.computeBoundingSphere();group.add(walls);
  group.add(timberMesh(maze));
  if (maze.roof) {
    const roofMaterial = fabricMaterial(maze.wallColor, maze.translucentFabric, 'roof');
    roofMaterial.side = THREE.DoubleSide;
    const surfaces = [...r.rooms.map(s => ({ polygon: s.polygon, holes: s.holes })), ...r.connections.map(c => ({ polygon: c.polygon, holes: [] }))];
    const pieces:THREE.BufferGeometry[]=[];
    for (const s of surfaces) {
      const shape = new THREE.Shape(s.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
      shape.holes = s.holes.map(h => new THREE.Path(h.map(p => new THREE.Vector2(p.x, -p.z))));
      pieces.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,maze.wallHeight,0));
    }
    const geometry=mergeGeometries(pieces,false)!;pieces.forEach(g=>g.dispose());
    const roof=new THREE.Mesh(geometry,roofMaterial);roof.name='free-roof';roof.castShadow=true;roof.receiveShadow=true;roof.customDepthMaterial=walls.customDepthMaterial;group.add(roof);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maze.width + 100, maze.depth + 100), groundMaterial(maze.width + 100, maze.depth + 100));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(maze.width / 2, -.025, maze.depth / 2);
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}
