import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { walls } from '../src/core/maze';
import {mergeWalls} from '../src/core/corridor-geometry';
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

test('corridor modules keep their own rectangular frames and corner braces in 3D', () => {
  const maze=generate({generationType:'corridor',moduleSize:2,columns:30,rows:26,corridorWidth:2,algorithm:'backtracker',seed:'CORRIDOR-FIRST-WALK-01',extraConnections:2});
  const structure=timberStructure(maze);
  expect(maze.layout!.modules.some(m=>m.type==='2x6')).toBe(true);
  expect(maze.layout!.modules.some(m=>m.type==='2x2')).toBe(true);
  expect(structure.bracedFrames!.length).toBe(maze.layout!.modules.length*4);
  for(const frame of structure.bracedFrames!)for(const p of [{x:frame.x1,z:frame.z1},{x:frame.x2,z:frame.z2}])expect(structure.posts).toContainEqual(p);
  for(const module of maze.layout!.modules){
    const width=module.type==='2x6'&&module.rotation===0?6:2,depth=module.type==='2x6'&&module.rotation===90?6:2;
    const perimeter=structure.bracedFrames!.filter(f=>Math.min(f.x1,f.x2)>=module.x&&Math.max(f.x1,f.x2)<=module.x+width&&Math.min(f.z1,f.z2)>=module.z&&Math.max(f.z1,f.z2)<=module.z+depth);
    for(const f of [{x1:module.x,z1:module.z,x2:module.x+width,z2:module.z},{x1:module.x+width,z1:module.z,x2:module.x+width,z2:module.z+depth},{x1:module.x+width,z1:module.z+depth,x2:module.x,z2:module.z+depth},{x1:module.x,z1:module.z+depth,x2:module.x,z2:module.z}])expect(perimeter).toContainEqual(f);
  }
  const panels=mergeWalls(walls(maze));
  for(const f of structure.frames){
    if(structure.roofFrames?.includes(f))continue;
    for(const p of [{x:f.x1,z:f.z1},{x:f.x2,z:f.z2}])expect(structure.posts).toContainEqual(p);
    if(structure.bracedFrames!.includes(f))continue;
    // No header may be invented solely because two navigation regions meet.
    expect(panels.some(w=>f.x1===f.x2?w.x1===w.x2&&w.x1===f.x1&&w.z1<=Math.min(f.z1,f.z2)&&w.z2>=Math.max(f.z1,f.z2):w.z1===w.z2&&w.z1===f.z1&&w.x1<=Math.min(f.x1,f.x2)&&w.x2>=Math.max(f.x1,f.x2))).toBe(true);
  }
  const group=timberMesh(maze),boards=group.getObjectByName('timber-boards') as THREE.InstancedMesh,matrix=new THREE.Matrix4();let braces=0;
  for(let i=0;i<boards.count;i++){
    boards.getMatrixAt(i,matrix);const e=matrix.elements;
    if(Math.hypot(e[4]!,e[6]!)<1e-6||Math.abs(e[5]!)<1e-6)continue;
    braces++;const box=new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix);
    expect(box.min.y).toBeGreaterThan(1.7);expect(box.max.y).toBeLessThan(maze.wallHeight);
  }
  expect(braces).toBe(maze.layout!.modules.length*8);disposeMeshes(group);
  const low=timberStructure({...maze,wallHeight:1.8});expect(low.braceDrop).toBe(0);
});

test('lower rails sit inside the fabric of 2x6 modules in both orientations, never in 2x2 modules',()=>{
  for(const [columns,rows]of [[6,2],[2,6],[2,2]] as const){
    const maze=generate({generationType:'corridor',moduleSize:2,columns,rows,corridorWidth:2,algorithm:'backtracker',seed:'lower-rails',extraConnections:0}),s=timberStructure(maze),rails=s.lowerFrames!;
    if(columns===2&&rows===2){expect(rails).toHaveLength(0);continue;}
    expect(maze.layout!.modules[0]!.type).toBe('2x6');expect(rails.length).toBeGreaterThan(0);
    const group=timberMesh(maze),boards=group.getObjectByName('timber-boards') as THREE.InstancedMesh,matrix=new THREE.Matrix4();
    for(let i=0;i<rails.length;i++){
      const rail=rails[i]!;boards.getMatrixAt(boards.count-rails.length+i,matrix);
      const position=new THREE.Vector3().setFromMatrixPosition(matrix),middle={x:(rail.x1+rail.x2)/2,z:(rail.z1+rail.z2)/2};
      expect((position.x-middle.x)*rail.inward.x+(position.z-middle.z)*rail.inward.z).toBeCloseTo(.052);
      const box=new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix);
      expect(box.min.x).toBeGreaterThanOrEqual(-1e-6);expect(box.max.x).toBeLessThanOrEqual(columns+1e-6);
      expect(box.min.z).toBeGreaterThanOrEqual(-1e-6);expect(box.max.z).toBeLessThanOrEqual(rows+1e-6);
      if(rail.inward.x>0)expect(box.min.x).toBeGreaterThan(.03);
      if(rail.inward.x<0)expect(box.max.x).toBeLessThan(columns-.03);
      if(rail.inward.z>0)expect(box.min.z).toBeGreaterThan(.03);
      if(rail.inward.z<0)expect(box.max.z).toBeLessThan(rows-.03);
    }
    disposeMeshes(group);
  }
});
