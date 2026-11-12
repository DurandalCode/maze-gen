import {expect,test} from 'bun:test';
import {replaceTwoRowAssembly,addTwoRowAlcove} from '../src/free/two-row-assembly';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {anchorGeometry,connectionGeometry,freeMaze,freeRuntime,modulePolygon,physical,validateFree} from '../src/free/layout';
import {distance,ends,segmentDistance,pointIn,area} from '../src/free/geometry';
import {CollisionWorld} from '../src/simulation/collisions';
import {auditModuleWalls} from '../src/free/module-origin';

function fixture(angle=0,side:1|-1=1,pair=[0,2]){
 const layout=emptyLayout();layout.modules=[{id:'long',type:'2x6',x:20,z:20,angle}];
 const externalEdge=side===1?0:2;
 layout.openings=pair.map((cell,i)=>({id:i?'out':'in',room:'long',edge:externalEdge,offset:((cell-1)*2)*(externalEdge===0?1:-1),width:1.4}));
 layout.entrance='in';layout.exit='out';layout.moduleConstruction={version:1,spans:[]};
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:40,rows:40,moduleSize:2,corridorWidth:2,extraConnections:1,seed:'two-rows',algorithm:'prim'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout};
 return draft;
}

test('six actual squares provide a full-wall detour and a real cycle at 0°/37°, both sides and endpoint pairs',()=>{
 for(const angle of [0,37])for(const side of [1,-1]as const)for(const pair of [[0,2],[0,1],[1,2]]){
  const draft=fixture(angle,side,pair),oldFootprint=modulePolygon(draft.layout.modules[0]!),original=draft.layout.openings.map(o=>anchorGeometry(draft.layout,o,o.width));
  const result=replaceTwoRowAssembly(draft,'long','rows',side);
  expect(result.modules.slice(0,3).every(m=>modulePolygon(m).every(p=>pointIn(p,oldFootprint)))).toBe(true);expect(result.modules.slice(0,3).reduce((sum,m)=>sum+area(modulePolygon(m)),0)).toBeCloseTo(area(oldFootprint),8);
  expect(result.modules).toHaveLength(6);expect(result.connections).toHaveLength(6);expect(draft.layout.modules.every(m=>m.type==='2x2'&&!m.frameOnly)).toBe(true);
  expect(result.connections.every(c=>c.width===2&&c.a.offset===0&&c.b.offset===0)).toBe(true);
  draft.layout.openings.forEach((o,i)=>{const actual=anchorGeometry(draft.layout,o,o.width);for(const key of ['mid','from','to']as const)expect(distance(actual[key],original[i]![key])).toBeLessThan(1e-7);});
  expect(validateFree(draft)).toEqual([]);expect(auditModuleWalls(draft.layout).issues).toEqual([]);
  const maze=freeMaze(draft,false),r=freeRuntime(maze),world=new CollisionWorld(physical(draft.layout).obstacles);
  const count=r.passages.reduce((s,p)=>s+p.length,0)/2;expect(count-r.rooms.length+1).toBe(1);
  for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
  const blockedIndex=pair[0]===1?1:0,a=result.modules[blockedIndex]!,b=result.modules[blockedIndex+1]!,gate=anchorGeometry(draft.layout,{room:a.id,edge:1,offset:0},2);
  // The closed boundary is the complete 2 m edge between actual frames.
  expect(physical(draft.layout).panels.some(w=>distance(...ends(w))>=2-1e-7&&segmentDistance(gate.from,w)<1e-7&&segmentDistance(gate.to,w)<1e-7)).toBe(true);
  expect(distance(world.move({x:a.x,z:a.z},{x:b.x-a.x,z:b.z-a.z}),{x:b.x,z:b.z})).toBeGreaterThan(.5);
  for(const c of result.connections)for(const wall of connectionGeometry(draft.layout,c).sides)expect(distance(...ends(wall))).toBeLessThanOrEqual(3+1e-7);
 }
});

test('external connection and construction-span doors retain their exact world endpoints',()=>{
 const draft=fixture(37),opening=draft.layout.openings.pop()!,a=anchorGeometry(draft.layout,opening,opening.width);
 draft.layout.modules.push({id:'neighbor',type:'2x2',angle:37,x:a.mid.x+a.normal.x*4,z:a.mid.z+a.normal.z*4});
 draft.layout.connections.push({id:'outside',a:{...opening},b:{room:'neighbor',edge:2,offset:0},width:opening.width});draft.layout.moduleConstruction!.spans=structuredClone(draft.layout.connections);
 draft.layout.openings.push({id:'out',room:'neighbor',edge:0,offset:0,width:1.4});
 const before=anchorGeometry(draft.layout,draft.layout.connections[0]!.a,opening.width);
 replaceTwoRowAssembly(draft,'long','rows',1);expect(validateFree(draft)).toEqual([]);
 const runtime=freeRuntime(freeMaze(draft,false)),world=new CollisionWorld(physical(draft.layout).obstacles);for(const path of runtime.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
 for(const c of [draft.layout.connections[0]!,draft.layout.moduleConstruction!.spans[0]!]){const after=anchorGeometry(draft.layout,c.a,c.width);expect(distance(before.from,after.from)).toBeLessThan(1e-7);expect(distance(before.to,after.to)).toBeLessThan(1e-7);}
});

test('straddling doors, occupied added sides and duplicate IDs refuse atomically',()=>{
 for(const modify of [(d:FreeDraft)=>{d.layout.openings[0]!.offset=-1;},(d:FreeDraft)=>{d.layout.openings[0]!.edge=2;},(d:FreeDraft)=>{d.layout.modules.push({id:'rows-top-0',type:'2x2',x:3,z:3,angle:0});}]){
  const draft=fixture();modify(draft);const before=JSON.stringify(draft);expect(()=>replaceTwoRowAssembly(draft,'long','rows',1)).toThrow();expect(JSON.stringify(draft)).toBe(before);
 }
});

test('a full-width alcove is traversable but does not hide the long main run, also at 37°',async()=>{
 const {freeGroundLengths}=await import('../src/free/path-limits');const {routeTraps}=await import('../src/analysis/route-traps');
 for(const angle of [0,37]){
  const draft=fixture(angle),rad=angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);draft.layout.modules=[0,1,2].map(i=>({id:`c${i}`,type:'2x2',x:20+(i-1)*5*c,z:20+(i-1)*5*s,angle}));
  draft.layout.connections=[0,1].map(i=>({id:`chain${i}`,a:{room:`c${i}`,edge:1,offset:0},b:{room:`c${i+1}`,edge:3,offset:0},width:2}));
  draft.layout.openings=[{id:'in',room:'c0',edge:3,offset:0,width:2},{id:'out',room:'c2',edge:1,offset:0,width:2}];draft.layout.moduleConstruction!.spans=structuredClone(draft.layout.connections);
  const before=freeGroundLengths(freeMaze(draft,false)),parents=structuredClone(draft.layout.modules),added=addTwoRowAlcove(draft,'c1','recess',0);
  expect(added.module.type).toBe('2x2');expect(added.module.frameOnly).toBeUndefined();expect(added.connection.width).toBe(2);expect(added.connection.a.offset).toBe(0);expect(added.connection.b.offset).toBe(0);
  expect(distance(added.module,parents[1]!)).toBeCloseTo(5,10);expect(draft.layout.modules.slice(0,3)).toEqual(parents);expect(draft.layout.moduleConstruction!.spans.at(-1)).toEqual(added.connection);
  expect(validateFree(draft)).toEqual([]);expect(auditModuleWalls(draft.layout).issues).toEqual([]);
  expect(routeTraps(freeMaze(draft,false)).qualifiedCount).toBe(0);
  const after=freeGroundLengths(freeMaze(draft,false));expect(before.run).toBeGreaterThan(10);expect(after.run).toBeCloseTo(before.run,8);expect(after.straight).toBeCloseTo(before.straight,8);
  const world=new CollisionWorld(physical(draft.layout).obstacles),runtime=freeRuntime(freeMaze(draft,false));for(const path of runtime.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
  for(const wall of connectionGeometry(draft.layout,added.connection).sides)expect(distance(...ends(wall))).toBeCloseTo(3,8);
  const bent=structuredClone(draft),tail=addTwoRowAlcove(bent,added.module.id,'deep',1);expect(validateFree(bent)).toEqual([]);
  // A second real square behind a physical turn forms a ten-metre arm. This
  // is the meaningful alternative used in tight return pockets, not a single bud.
  const bentMaze=freeMaze(bent,false),bentWorld=new CollisionWorld(physical(bent.layout).obstacles),bentRuntime=freeRuntime(bentMaze);expect(freeGroundLengths(bentMaze).run).toBeLessThan(before.run-1);
  expect(distance(bentWorld.move(parents[1]!,{x:tail.module.x-parents[1]!.x,z:tail.module.z-parents[1]!.z}),tail.module)).toBeGreaterThan(.1);
  for(const path of bentRuntime.edgePaths.values())for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;expect(distance(bentWorld.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);}
 }
});

test('occupied alcove sides and IDs refuse without changing the draft',()=>{
 const draft=fixture();replaceTwoRowAssembly(draft,'long','rows',1);const before=JSON.stringify(draft);
 expect(()=>addTwoRowAlcove(draft,'rows-base-0','bud',2)).toThrow();expect(JSON.stringify(draft)).toBe(before);
 addTwoRowAlcove(draft,'rows-top-0','bud',2);const after=JSON.stringify(draft);
 expect(()=>addTwoRowAlcove(draft,'rows-top-2','bud',2)).toThrow();expect(JSON.stringify(draft)).toBe(after);
});
