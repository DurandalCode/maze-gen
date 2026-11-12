import {expect,test} from 'bun:test';
import {sharedWallInfill} from '../src/free/shared-wall-infill';
import {distance,ends,quantize,segmentDistance} from '../src/free/geometry';
import {modulePolygon} from '../src/free/layout';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,freeRuntime} from '../src/free/layout';
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
test('flush infill reuses rotated module walls as unique physical boundaries and has traversable doorways',()=>{
 for(const angle of [0,23]){
  const d=fixture(),radians=angle*Math.PI/180;for(const m of d.layout.modules){const x=m.x,z=m.z;m.x=20+x*Math.cos(radians)-z*Math.sin(radians);m.z=5+x*Math.sin(radians)+z*Math.cos(radians);m.angle=angle;}d.parameters.columns=50;d.parameters.rows=50;
  const base=freeMaze(d),snapshot=serialize(base),result=sharedWallInfill(base,2),m=result.maze;
  expect(result.addedPassages).toBeGreaterThan(0);expect(result.sharedWallLength).toBeGreaterThan(.5);expect(m.free!.modules).toEqual(base.free!.modules);expect(serialize(base)).toBe(snapshot);expect(portalPoint(m,m.entrance)).toEqual(portalPoint(base,base.entrance));expect(portalPoint(m,m.exit)).toEqual(portalPoint(base,base.exit));
  const panels=walls(m),keys=panels.map(w=>ends(w).map(p=>`${quantize(p.x)}:${quantize(p.z)}`).sort().join('/'));expect(new Set(keys).size).toBe(keys.length);
  const shared=panels.filter(w=>result.sharedModuleIds.some(id=>{const poly=modulePolygon(m.free!.modules.find(x=>x.id===id)!);return poly.some((a,i)=>ends(w).every(p=>segmentDistance(p,{x1:a.x,z1:a.z,x2:poly[(i+1)%4]!.x,z2:poly[(i+1)%4]!.z})<1e-6));})&&m.free!.spaces.filter(s=>s.id.startsWith('shared-passage-')).some(s=>s.polygon.some((a,i)=>ends(w).every(p=>segmentDistance(p,{x1:a.x,z1:a.z,x2:s.polygon[(i+1)%4]!.x,z2:s.polygon[(i+1)%4]!.z})<1e-6))));expect(shared.reduce((s,w)=>s+distance(...ends(w)),0)).toBeGreaterThan(.5);
  const world=new CollisionWorld([...panels,...supportColliders(m)]);for(const path of freeRuntime(m).edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}expect(serialize(deserialize(serialize(m)))).toBe(serialize(m));
 }
});
