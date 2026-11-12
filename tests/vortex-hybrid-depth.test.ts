import {expect,test} from 'bun:test';
import {freeLoopTrapFixture} from './fixtures/free-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {freeRuntime} from '../src/free/layout';
import {inspectHybridVortexDepth,physicalVortexCircuit} from '../src/free/vortex-hybrid-depth';
import {CollisionWorld} from '../src/simulation/collisions';
import {distance} from '../src/free/geometry';

test('a central fork cannot claim an inward excursion from the outward radial range',()=>{
 const maze=freeLoopTrapFixture(),r=freeRuntime(maze),loop=loopTraps(maze).candidates[0]!;
 expect(loop).toBeDefined();
 const center=r.centers[loop.fork]!,report=inspectHybridVortexDepth(maze,center).find(d=>d.fork===r.rooms[loop.fork]!.id)!;
 expect(Math.max(...report.points.map(p=>distance(p,center)))).toBeGreaterThan(10);
 expect(report.inwardExcursion).toBeCloseTo(0,8);
 expect(report.pure).toBe(true);
});

test('the depth audit follows collision-clear door-to-door routes through real rooms',()=>{
 const maze=freeLoopTrapFixture(),r=freeRuntime(maze),loop=loopTraps(maze).candidates[0]!;
 const points=physicalVortexCircuit(maze,loop.loop),world=new CollisionWorld([...r.panels,...r.posts.map(p=>({x1:p.x,z1:p.z,x2:p.x,z2:p.z,thickness:.12}))]);
 expect(points.length).toBeGreaterThan(loop.loop.length);
 for(let i=1;i<points.length;i++){
  const a=points[i-1]!,b=points[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});
  expect(distance(end,b)).toBeLessThan(1e-5);
 }
 expect(distance(points[0]!,points.at(-1)!)).toBeLessThan(1e-8);
});
