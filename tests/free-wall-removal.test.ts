import {freeLoopTrapFixture,freeRouteTrapFixture} from './fixtures/free-traps';
import {test,expect} from 'bun:test';
import {emptyMaze,connect,type Maze,walls} from '../src/core/maze';
import {freeCellLayout} from './fixtures/free-cell-layout';
import {freeRuntime} from '../src/free/layout';
import {removeFreePanel} from '../src/free/wall-removal';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {criticalWalls} from '../src/analysis/critical-walls';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {serialize} from '../src/persistence/maze-json';
import {independentCycles} from '../src/core/graph';

function verify(m:Maze,kind:'loop'|'trap'){
 const before=serialize(m),baseline=kind==='loop'?loopTraps(m).qualifiedCount:routeTraps(m).qualifiedCount;expect(baseline).toBeGreaterThan(0);const r=freeRuntime(m),result=criticalWalls(m),protectedWalls=result.filter(w=>w.protections.some(p=>p.kind===kind));expect(protectedWalls.length).toBeGreaterThan(0);
 for(const item of protectedWalls.slice(0,4)){const index=r.panels.indexOf(item.wall),after=removeFreePanel(m,index);expect(kind==='loop'?loopTraps(after).qualifiedCount:routeTraps(after).qualifiedCount).toBeLessThan(baseline);expect(freeRuntime(after).posts).toEqual(r.posts);expect(freeRuntime(after).panels.length).toBe(r.panels.length-1);}
 expect(serialize(m)).toBe(before);
}
test('physical panel deletion protects a recognized free return-loop trap',()=>verify(freeLoopTrapFixture(),'loop'),60000);
test('physical panel deletion protects recognized free dead-end route traps',()=>verify(freeRouteTrapFixture(),'trap'),60000);
test('a rotated shared panel opens one real passage, retaining posts and excluding outside void',()=>{
 const grid=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'u',extraConnections:0});connect(grid,0,2);connect(grid,2,3);connect(grid,3,1);grid.entrance={cell:0,side:'north'};grid.exit={cell:1,side:'north'};
 for(const angle of [0,19,37]){const m=freeCellLayout(grid,angle),r=freeRuntime(m),a=r.centers[0]!,b=r.centers[1]!,wall=r.panels.findIndex(w=>Math.hypot((w.x1+w.x2)/2-(a.x+b.x)/2,(w.z1+w.z2)/2-(a.z+b.z)/2)<1e-6),after=removeFreePanel(m,wall),world=new CollisionWorld([...walls(after),...supportColliders(after)]),p=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(p.x-b.x,p.z-b.z)).toBeLessThan(1e-5);expect(independentCycles(after)).toBe(1);expect(after.passages.length).toBe(m.passages.length+1);const exterior=r.panels.findIndex(w=>Math.hypot((w.x1+w.x2)/2-(a.x+b.x)/2,(w.z1+w.z2)/2-(a.z+b.z)/2)>3);if(exterior>=0)expect(removeFreePanel(m,exterior).passages.length).toBe(m.passages.length);}
});

test('a retained duplicate skin or a line of retained posts does not become an invented passage',()=>{
 const grid=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'u',extraConnections:0});connect(grid,0,2);connect(grid,2,3);connect(grid,3,1);grid.entrance={cell:0,side:'north'};grid.exit={cell:1,side:'north'};
 for(const kind of ['duplicate','posts']){const m=freeCellLayout(grid),r=freeRuntime(m),wall=r.panels.findIndex(w=>w.x1===22&&w.x2===22&&Math.min(w.z1,w.z2)===2),l=structuredClone(m.free!);if(kind==='duplicate')l.preservedPanels!.push({...r.panels[wall]!});else l.supports=Array.from({length:6},(_,i)=>({x:22,z:2+i*.4}));const blocked={...m,free:l},before=freeRuntime(blocked);expect(removeFreePanel(blocked,wall).passages.length).toBe(before.rooms.length);expect(independentCycles(removeFreePanel(blocked,wall))).toBe(0);}
});

test('removing a corridor side joins its physical interior without an artificial triangular cycle',async()=>{
 const {emptyLayout}=await import('../src/free/model'),{freeMaze,physical}=await import('../src/free/layout'),{DEFAULT_CONSTRUCTION}=await import('../src/core/maze'),l=emptyLayout();l.modules=[{id:'a',type:'2x2',x:2,z:2,angle:0},{id:'b',type:'2x2',x:6,z:2,angle:0},{id:'c',type:'2x2',x:4,z:3.7,angle:0}];l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'c',edge:2,offset:0,width:1.4}];l.entrance='in';l.exit='out';const key=(w:{x1:number;z1:number;x2:number;z2:number})=>[[w.x1,w.z1].join(','),[w.x2,w.z2].join(',')].sort().join(':');l.preservedPanels=[...new Map(physical(l).panels.filter(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)>1e-7).map(w=>[key(w),w])).values()];
 const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:10,rows:10,moduleSize:2,corridorWidth:2,algorithm:'prim',extraConnections:0,seed:'contact'},construction:{...DEFAULT_CONSTRUCTION},layout:l},false),r=freeRuntime(m),wall=r.panels.findIndex(w=>Math.abs(w.z1-2.7)<1e-6&&Math.abs(w.z2-2.7)<1e-6),after=removeFreePanel(m,wall),ar=freeRuntime(after);
 expect(after.passages.length).toBe(5);expect(independentCycles(after)).toBe(0);expect(ar.links).toHaveLength(4);expect(ar.contains({x:4,z:3})).toBe(true);expect(ar.contains({x:4,z:.5})).toBe(false);
 const world=new CollisionWorld([...walls(after),...supportColliders(after)]);for(const path of ar.edgePaths.values())for(let i=1;i<path.length;i++){const p=world.move(path[i-1]!,{x:path[i]!.x-path[i-1]!.x,z:path[i]!.z-path[i-1]!.z});expect(Math.hypot(p.x-path[i]!.x,p.z-path[i]!.z)).toBeLessThan(1e-5);}
});

test('a ground panel below a bridge never adds a connection to the upper deck',async()=>{
 const {bridgeFixture}=await import('./fixtures/free-bridge'),{freeMaze}=await import('../src/free/layout'),m=freeMaze(bridgeFixture()),r=freeRuntime(m),side=r.connections.find(c=>c.id==='under')!.sides[0]!,wall=r.panels.findIndex(w=>Math.hypot((w.x1+w.x2-side.x1-side.x2)/2,(w.z1+w.z2-side.z1-side.z2)/2)<1e-7),after=removeFreePanel(m,wall),ar=freeRuntime(after);
 expect(ar.rooms).toHaveLength(r.rooms.length);const above=r.links.find(e=>e.points.some(p=>p.bridge!==undefined))!;expect(ar.links).toContain(above);expect(ar.edgePaths.get(`${above.a}:${above.b}`)).toEqual(r.edgePaths.get(`${above.a}:${above.b}`));
});

test('a second physical opening between the same rooms preserves the old passage and adds exactly one cycle',async()=>{
 const {emptyLayout}=await import('../src/free/model'),{freeMaze,physical}=await import('../src/free/layout'),{DEFAULT_CONSTRUCTION}=await import('../src/core/maze'),l=emptyLayout();l.modules=[{id:'a',type:'custom',width:6,depth:6,x:4,z:4,angle:0},{id:'b',type:'custom',width:6,depth:6,x:10,z:4,angle:0}];l.connections=[{id:'old',a:{room:'a',edge:1,offset:-1.6},b:{room:'b',edge:3,offset:1.6},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';const key=(w:{x1:number;z1:number;x2:number;z2:number})=>[[w.x1,w.z1].join(','),[w.x2,w.z2].join(',')].sort().join(':');l.preservedPanels=[...new Map(physical(l).panels.filter(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)>1e-7).map(w=>[key(w),w])).values()];const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:16,rows:10,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'parallel'},construction:{...DEFAULT_CONSTRUCTION},layout:l}),r=freeRuntime(m),wall=r.panels.findIndex(w=>Math.abs(w.x1-7)<1e-7&&Math.abs(w.x2-7)<1e-7&&Math.abs(w.z1-w.z2)>3),after=removeFreePanel(m,wall);
 expect(independentCycles(after)).toBe(1);expect(after.passages).toHaveLength(3);expect(freeRuntime(after).edgePaths.get('0:1')).toEqual(r.edgePaths.get('0:1'));expect(freeRuntime(after).links).toHaveLength(3);
});

test('removing an interior screen shortens the physical route while retaining its end posts',async()=>{
 const {emptyLayout}=await import('../src/free/model'),{freeMaze}=await import('../src/free/layout'),{routePoints,pathLength}=await import('../src/core/pathfinding'),{DEFAULT_CONSTRUCTION}=await import('../src/core/maze'),l=emptyLayout();l.modules=[{id:'hall',type:'custom',width:6,depth:6,x:4,z:4,angle:0}];l.walls=[{id:'screen',x1:4,z1:1,x2:4,z2:5}];l.supports=[{x:4,z:3}];l.openings=[{id:'in',room:'hall',edge:3,offset:0,width:1.4},{id:'out',room:'hall',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';const m=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:10,rows:10,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'screen'},construction:{...DEFAULT_CONSTRUCTION},layout:l}),before=pathLength(routePoints(m)),r=freeRuntime(m),index=r.panels.findIndex(w=>(w as {id?:string}).id==='screen'),after=removeFreePanel(m,index);
 expect(pathLength(routePoints(after))).toBeLessThan(before);expect(freeRuntime(after).posts).toEqual(r.posts);expect(after.passages).toEqual(m.passages);
});
