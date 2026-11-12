import {expect,test} from 'bun:test';
import {infillFree} from '../src/free/infill';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,validateFree,freeRuntime} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION,portalPoint,walls} from '../src/core/maze';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
function fixture(){const l=emptyLayout();
 for(let row=0;row<2;row++)for(let x=0;x<4;x++)l.modules.push({id:`m${row}-${x}`,type:'2x2',x:4+x*4,z:4+row*6,angle:0});
 for(let row=0;row<2;row++)for(let x=0;x<3;x++)l.connections.push({id:`c${row}-${x}`,a:{room:`m${row}-${x}`,edge:1,offset:0},b:{room:`m${row}-${x+1}`,edge:3,offset:0},width:1.4});
 l.modules.push({id:'turn',type:'2x2',x:16,z:7,angle:0});
 l.connections.push({id:'turn-a',a:{room:'m0-3',edge:2,offset:0},b:{room:'turn',edge:0,offset:0},width:1.4},{id:'turn-b',a:{room:'turn',edge:2,offset:0},b:{room:'m1-3',edge:0,offset:0},width:1.4});
 l.openings=[{id:'in',room:'m0-0',edge:3,offset:0,width:1.4},{id:'out',room:'m1-0',edge:3,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 return {kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:22,rows:16,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'infill-test'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l}as FreeDraft;
}
test('infill adds a real native crosslink in a gap, preserves the map and traverses all new physical edges',()=>{
 const draft=fixture();expect(validateFree(draft)).toEqual([]);const base=freeMaze(draft),snapshot=serialize(base),r=infillFree(base,1),m=r.maze;
 expect(r.addedPassages).toBe(1);expect(r.addedArea).toBeGreaterThan(0);expect(m.free!.modules).toEqual(base.free!.modules);expect(serialize(base)).toBe(snapshot);
 expect(portalPoint(m,m.entrance)).toEqual(portalPoint(base,base.entrance));expect(portalPoint(m,m.exit)).toEqual(portalPoint(base,base.exit));
 const cycles=(m:typeof base)=>m.passages.reduce((s,p)=>s+p.length,0)/2-m.passages.length+1;expect(cycles(m)).toBe(cycles(base)+1);
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]);for(const path of freeRuntime(m).edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}
 expect(serialize(deserialize(serialize(m)))).toBe(serialize(m));
});
