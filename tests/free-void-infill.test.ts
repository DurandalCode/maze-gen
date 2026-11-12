import {expect,test} from 'bun:test';
import {fillOrganicVoids,partitionOpenedVoid} from '../src/free/void-infill';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,freeRuntime,physical} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION,portalPoint,walls} from '../src/core/maze';
import {detectFreeIslands} from '../src/free/islands';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
function ring(angle:number){const l=emptyLayout(),r=angle*Math.PI/180;for(const [id,x,z]of [['a',4,4],['b',9,4],['c',9,9],['d',4,9]]as const)l.modules.push({id,type:'2x2',x:15+x*Math.cos(r)-z*Math.sin(r),z:4+x*Math.sin(r)+z*Math.cos(r),angle});
 l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4},{id:'bc',a:{room:'b',edge:2,offset:0},b:{room:'c',edge:0,offset:0},width:1.4},{id:'dc',a:{room:'d',edge:1,offset:0},b:{room:'c',edge:3,offset:0},width:1.4},{id:'ad',a:{room:'a',edge:2,offset:0},b:{room:'d',edge:0,offset:0},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'c',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:35,rows:35,moduleSize:2,corridorWidth:2,extraConnections:1,algorithm:'prim',seed:'native-void'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l}as FreeDraft);
}
test('existing irregular negative space becomes floor with multiple physical side doors; surrounding free modules and ports stay put',()=>{
 for(const angle of [0,19]){const base=ring(angle),old=physical(base.free!),voids=detectFreeIslands(old.panels,old.contains),snapshot=serialize(base),result=fillOrganicVoids(base),m=result.maze;
 expect(voids.length).toBe(1);expect(result.filled.length).toBe(1);expect(result.filled[0]!.doors).toBeGreaterThanOrEqual(2);expect(result.filled[0]!.area).toBeCloseTo(voids[0]!.area,5);expect(serialize(base)).toBe(snapshot);expect(m.free!.modules).toEqual(base.free!.modules);expect(portalPoint(m,m.entrance)).toEqual(portalPoint(base,base.entrance));expect(portalPoint(m,m.exit)).toEqual(portalPoint(base,base.exit));
 const p=physical(m.free!);expect(old.contains(voids[0]!.center)).toBe(false);expect(p.contains(voids[0]!.center)).toBe(true);
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]);for(const path of freeRuntime(m).edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}expect(serialize(deserialize(serialize(m)))).toBe(serialize(m));
 const partitioned=partitionOpenedVoid(m,result.filled[0]!.id);expect(partitioned.free!.spaces.length).toBe(m.free!.spaces.length+1);expect(partitioned.free!.modules).toEqual(m.free!.modules);const splitWorld=new CollisionWorld([...walls(partitioned),...supportColliders(partitioned)]);for(const path of freeRuntime(partitioned).edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=splitWorld.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}
 }
});
