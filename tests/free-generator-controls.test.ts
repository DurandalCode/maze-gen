import {expect,test} from 'bun:test';
import {validateParameters,walls,type Parameters} from '../src/core/maze';
import {generateFree} from '../src/free/generate';
import {connectionGeometry,freeRuntime} from '../src/free/layout';
import {freeGroundLengths} from '../src/free/path-limits';
import {metrics} from '../src/core/metrics';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';

test('ordinary generator replays 90 native modules, real infill cycles and physical 8/16 limits',()=>{
 const parameters:Parameters={placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:2,algorithm:'prim',seed:'ninety-switch-1',freeRoutePattern:'switchbacks',freeConnectionSpan:3,freeModuleTarget:90,freeJunctionDegree:3,freeInfillPassages:2};
 const maze=generateFree(parameters),wire=serialize(maze);
 expect(maze.free!.modules).toHaveLength(90);expect(maze.parameters.seed).toBe(parameters.seed);expect(maze.parameters.extraConnections).toBe(2);expect(metrics(maze).cycles).toBe(4);
 expect(serialize(generateFree(maze.parameters))).toBe(wire);expect(serialize(deserialize(wire))).toBe(wire);
 const lengths=freeGroundLengths(maze);expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);expect(lengths.run).toBeLessThanOrEqual(16+1e-7);
 const spans=maze.free!.connections.flatMap(c=>connectionGeometry(maze.free!,c).sides.map(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)));
 expect(Math.max(...spans)).toBeCloseTo(3,7);expect(spans.every(n=>n<=3+1e-7)).toBe(true);
 const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
 for(const path of freeRuntime(maze).edgePaths.values())for(let i=1;i<path.length;i++){
  const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);
 }
},30000);

test('infill settings reject invalid budgets and unsupported bridge combinations',()=>{
 const base:Parameters={placementMode:'free',columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:2,algorithm:'prim',seed:'controls'};
 for(const freeInfillPassages of [-1,.5,13])expect(()=>validateParameters({...base,freeInfillPassages})).toThrow();
 expect(()=>validateParameters({...base,freeBridgeCount:2,freeInfillPassages:1})).toThrow('без мостов');
});
