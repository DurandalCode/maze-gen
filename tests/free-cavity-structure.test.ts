import {expect,test} from 'bun:test';
import {carveCavity} from '../src/free/cavity-structure';
import {area,pointIn} from '../src/free/geometry';
import {pocketOverlap} from '../src/free/open-pockets';
const irregular=[{x:0,z:0},{x:14,z:0},{x:14,z:4},{x:10,z:4},{x:10,z:9},{x:5,z:9},{x:5,z:12},{x:0,z:12}];
test('seeded cavity carves a selected native chamber graph while preserving its exact footprint',()=>{
 const a=carveCavity(irregular,'cavity-a',{loops:1}),again=carveCavity(irregular,'cavity-a',{loops:1}),b=carveCavity(irregular,'cavity-b',{loops:1});expect(a).toEqual(again);expect(a).not.toEqual(b);expect(a.cells.length).toBeGreaterThan(8);expect(a.components.length).toBe(1);expect(a.passages.length).toBe(a.cells.length);expect(a.closed.length).toBeGreaterThan(3);expect(a.cells.reduce((s,c)=>s+c.area,0)).toBeCloseTo(area(irregular),6);
 for(let i=0;i<a.cells.length;i++){expect(a.cells[i]!.polygon.every(p=>pointIn(p,irregular))).toBe(true);for(let j=i+1;j<a.cells.length;j++)expect(pocketOverlap(a.cells[i]!.polygon,a.cells[j]!.polygon)).toBe(false);}
 const degree=a.cells.map((_,i)=>a.passages.filter(e=>e.a===i||e.b===i).length);expect(degree.filter(d=>d===1).length).toBeGreaterThan(1);expect(degree.some(d=>d>=3)).toBe(true);
});
test('selected chamber doors and closed walls use the actual native collision world',async()=>{
 const {emptyLayout}=await import('../src/free/model'),{sharedPanels}=await import('../src/free/shared-wall-infill'),{freeMaze,validateFree,freeRuntime}=await import('../src/free/layout'),{DEFAULT_CONSTRUCTION,walls}=await import('../src/core/maze'),{supportColliders}=await import('../src/core/structure'),{CollisionWorld}=await import('../src/simulation/collisions');
 const s=carveCavity(irregular,'physical-cavity',{loops:1}),l=emptyLayout();l.supports=s.supports.map(p=>({x:p.x+8,z:p.z+8}));l.spaces=s.cells.map(c=>({id:c.id,kind:'hall',polygon:c.polygon.map(p=>({x:p.x+8,z:p.z+8}))}));
 l.connections=s.passages.map((e,i)=>({id:`door-${i}`,a:{room:s.cells[e.a]!.id,edge:e.edgeA,offset:e.offsetA},b:{room:s.cells[e.b]!.id,edge:e.edgeB,offset:e.offsetB},width:e.width}));
 const left=s.cells.flatMap((c,i)=>c.polygon.map((p,edge)=>({c,i,p,q:c.polygon[(edge+1)%c.polygon.length]!,edge}))).find(e=>e.p.x===0&&e.q.x===0&&Math.abs(e.p.z-e.q.z)>1.4)!;
 const right=s.cells.flatMap((c,i)=>c.polygon.map((p,edge)=>({c,i,p,q:c.polygon[(edge+1)%c.polygon.length]!,edge}))).find(e=>e.p.x===14&&e.q.x===14&&Math.abs(e.p.z-e.q.z)>1.4)!;
 l.modules=[{id:'original-module',type:'2x2',x:5,z:8+(left.p.z+left.q.z)/2,angle:0}];l.connections.push({id:'entry-link',a:{room:'original-module',edge:1,offset:0},b:{room:left.c.id,edge:left.edge,offset:0},width:1.2});l.openings=[{id:'in',room:'original-module',edge:3,offset:0,width:1.2},{id:'out',room:right.c.id,edge:right.edge,offset:0,width:1.2}];l.entrance='in';l.exit='out';
 const d=sharedPanels({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:1,algorithm:'prim',seed:'physical-cavity'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l});expect(validateFree(d)).toEqual([]);const m=freeMaze(d),r=freeRuntime(m),world=new CollisionWorld([...walls(m),...supportColliders(m)]);for(const path of r.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}
 for(const closed of s.closed){const mid={x:(closed.from.x+closed.to.x)/2+8,z:(closed.from.z+closed.to.z)/2+8};expect(world.blocked(mid)).toBe(true);}
});
test('blocked doorway repair preserves bounded chambers instead of erasing a whole cavity into a long hall',()=>{
 const polygon=[{x:0,z:0},{x:10,z:0},{x:10,z:2},{x:0,z:2}],cells=Array.from({length:5},(_,i)=>({id:`cell-${i}`,area:4,polygon:[{x:2*i,z:0},{x:2*i+2,z:0},{x:2*i+2,z:2},{x:2*i,z:2}]})),posts=[2,4,6,8].map(x=>({x,z:1}));const result=carveCavity(polygon,'blocked-stitches',{cells,existingSupports:posts,maxMergedArea:14,loops:0});expect(result.cells.reduce((s,c)=>s+c.area,0)).toBe(20);expect(Math.max(...result.cells.map(c=>c.area))).toBeLessThanOrEqual(14);expect(result.components.length).toBeGreaterThan(1);
});
