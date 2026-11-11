import type {Point} from '../src/core/maze';
import {expect,test} from 'bun:test';
import {bridgeFixture} from './fixtures/free-bridge';
import {freeMaze,validateFree,freeRuntime} from '../src/free/layout';
import {bridgeGeometry} from '../src/free/bridges';
import {routePoints,pathLength} from '../src/core/pathfinding';
import {metrics} from '../src/core/metrics';
import {FreeBridgeWorld} from '../src/simulation/free-bridge-world';
import {Player} from '../src/simulation/player';
import {CollisionWorld} from '../src/simulation/collisions';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {makeWalkData,validateWalk} from '../src/persistence/walk-json';
import {recordJson} from '../src/persistence/record-codec';
import {browserTopologyId} from '../src/persistence/identity';
import {topologyId} from '../server/store';

test('covered bridge is a distinct reversible edge, never a junction at its lower crossing',()=>{
 const d=bridgeFixture();expect(validateFree(d)).toEqual([]);
 const m=freeMaze(d),r=freeRuntime(m);
 expect(m.version).toBe(7);expect(metrics(m).cycles).toBe(1);
 expect(r.passages[0]).toContain(1);expect(r.passages[1]).toContain(0);
 expect(r.passages[0]).not.toContain(2);expect(r.passages[0]).not.toContain(3);
 const bridge=bridgeGeometry(d.layout,d.layout.bridges![0]!);
 expect(pathLength(bridge.path)).toBeGreaterThan(bridge.length);
 expect(routePoints(m).some(p=>p.y===2.8)).toBe(true);
});
test('the lower crossing remains walkable without climbing or changing graph edge',()=>{
 const m=freeMaze(bridgeFixture()),world=new FreeBridgeWorld(m);
 const end=world.move({x:13,z:13,y:0,floor:0},{x:0,z:4},()=>{});
 expect(end.z).toBeCloseTo(17);expect(end.y).toBe(0);expect(end.bridge).toBeUndefined();
});
test('bridge can be walked across, reversed on a stair, recorded and restored',async()=>{
 const m=freeMaze(bridgeFixture()),p=new Player(m,new CollisionWorld([]));
 for(const target of routePoints(m).slice(1)){
  let steps=0;
  while(Math.hypot(target.x-p.position.x,target.z-p.position.z)>.01&&!p.finished){
   if(steps++>1500)throw Error('stuck '+JSON.stringify(p.position)+' toward '+JSON.stringify(target));
   p.yaw=Math.atan2(p.position.x-target.x,p.position.z-target.z);p.updateAnalog(Math.min(.02,Math.hypot(target.x-p.position.x,target.z-p.position.z)/1.4),1,0);
  }
 }
 expect(p.finished).toBe(true);expect(p.recorder.samples.some(p=>p.y===2.8&&p.bridge==='bridge-1')).toBe(true);
 const wire=serialize(m),restored=deserialize(wire);expect(serialize(restored)).toBe(wire);
 const saved=makeWalkData(m,p.recorder,'bridge-run',true,'finished');expect(saved.version).toBe(2);
 expect(validateWalk(JSON.parse(recordJson(saved))).recording.samples).toEqual(saved.recording.samples);
 expect(await browserTopologyId(restored)).toBe(topologyId(m));
 const world=new FreeBridgeWorld(m),mid={x:7,z:15,y:1.5,floor:1,bridge:'bridge-1'};
 expect(world.move(mid,{x:-.1,z:0},()=>{}).y).toBeLessThan(mid.y);
 const sideways=world.move(mid,{x:0,z:5},()=>{});expect(sideways.z).toBeLessThan(15.5);
});
test('invalid stair slopes, low bridge clearance and ground overlap are rejected without flattening',()=>{
 for(const patch of [{rise:2.4},{stairRun:1}]){const d=bridgeFixture();Object.assign(d.layout.bridges![0]!,patch);expect(validateFree(d).some(i=>i.code==='bridge')).toBe(true);}
 const d=bridgeFixture();d.layout.modules.push({id:'obstruction',type:'2x2',x:7,z:15,angle:0});expect(validateFree(d).some(i=>i.code==='bridge')).toBe(true);
 const wire=JSON.parse(serialize(freeMaze(bridgeFixture())));wire.version=5;expect(()=>deserialize(JSON.stringify(wire))).toThrow();
});

test('deck and covered roof occlude vertical sight while the lower passage stays visible',async()=>{
 const {spatialLineVisible}=await import('../src/core/spatial-visibility');
 const m=freeMaze({...bridgeFixture(),construction:{...bridgeFixture().construction,translucentFabric:false,roof:false}});
 expect(spatialLineVisible(m,{x:13,z:15,y:4.5},{x:13,z:15,y:1.7})).toBe(false);
 expect(spatialLineVisible(m,{x:13,z:15,y:4.5},{x:13,z:15,y:10})).toBe(false);
 expect(spatialLineVisible(m,{x:13,z:13,y:1.7},{x:13,z:17,y:1.7})).toBe(true);
});
test('bridge rendering includes steps, elevated deck and enclosure above the original free scene',async()=>{
 const {mazeMesh}=await import('../src/renderer/maze-mesh'),{disposeMeshes}=await import('../src/renderer/dispose');
 const m=freeMaze(bridgeFixture()),mesh=mazeMesh(m);
 expect(mesh.getObjectByName('covered-free-bridges')).toBeDefined();
 expect(mesh.getObjectByName('bridge-1')!.children.length).toBeGreaterThan(40);disposeMeshes(mesh);
});
test('rotated free bridge can be walked in either direction without switching to the lower crossing',()=>{
 for(const angle of [17,90,123]){
  const d=bridgeFixture(),r=angle*Math.PI/180,rotate=(p:{x:number;z:number})=>({x:30+(p.x-14)*Math.cos(r)-(p.z-12)*Math.sin(r),z:30+(p.x-14)*Math.sin(r)+(p.z-12)*Math.cos(r)});
  d.parameters.columns=60;d.parameters.rows=60;
  for(const m of d.layout.modules){Object.assign(m,rotate(m));m.angle+=angle;}
  for(const space of d.layout.spaces)space.polygon=space.polygon.map(rotate);
  d.layout.supports=d.layout.supports!.map(rotate);
  expect(validateFree(d)).toEqual([]);
  const maze=freeMaze(d),g=bridgeGeometry(d.layout,d.layout.bridges![0]!),world=new FreeBridgeWorld(maze);
  for(const reversed of [false,true]){
   const path=reversed?[...g.path].reverse():g.path;
   let point:Point={...path[0]!,y:0,floor:0};delete point.bridge;
   for(const target of path.slice(1)){point=world.move(point,{x:target.x-point.x,z:target.z-point.z},()=>{});expect(Math.hypot(point.x-target.x,point.z-target.z)).toBeLessThan(1e-5);}
  }
 }
});
test('organic generation reserves two bridges, grows mixed modules and preserves exact cycles and seed',async()=>{
 const {generateFree}=await import('../src/free/generate');
 const parameters={placementMode:'free' as const,columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:2,freeBridgeCount:2,seed:'bridges-5',algorithm:'prim' as const};
 const a=generateFree(parameters),b=generateFree(parameters);
 expect(serialize(a)).toBe(serialize(b));expect(a.free!.bridges).toHaveLength(2);
 expect(a.free!.modules.length).toBeGreaterThan(20);expect(a.free!.modules.some(m=>m.type==='2x6')).toBe(true);
 expect(new Set(a.free!.modules.map(m=>Math.round(m.angle%90))).size).toBeGreaterThan(3);
 expect(metrics(a).cycles).toBe(2);expect(validateFree((await import('../src/free/json')).mazeDraft(a))).toEqual([]);
 const world=new FreeBridgeWorld(a);
 for(const bridge of a.free!.bridges!){const g=bridgeGeometry(a.free!,bridge);let point:Point={...g.path[0]!,y:0,floor:0};delete point.bridge;for(const target of g.path.slice(1)){point=world.move(point,{x:target.x-point.x,z:target.z-point.z},()=>{});expect(Math.hypot(point.x-target.x,point.z-target.z)).toBeLessThan(1e-5);}}
},45000); // Two complete, individually 20-second-bounded generation searches.

test('visiting both ground endpoints never marks an untraversed upper bridge as explored',async()=>{
 const {analyzeFree,freeColdRegions}=await import('../src/free/quality'),m=freeMaze(bridgeFixture()),r=freeRuntime(m);
 const regions=freeColdRegions(m,new Float64Array(r.rooms.length).fill(1),[0],.2);
 expect(regions).toHaveLength(1);expect(regions[0]!.cells).toEqual([]);expect(regions[0]!.bridgeIds).toEqual(['bridge-1']);expect(regions[0]!.area).toBeGreaterThan(25);
 const result=analyzeFree(m,256,'explorer');expect(result.probability[m.entrance.cell]).toBe(1);expect(result.probability[m.exit.cell]).toBe(1);
 expect(result.bridgeUsage[0]!.overProbability).toBeGreaterThan(0);expect(result.bridgeUsage[0]!.overProbability).toBeLessThan(1);
 expect(result.bridgeUsage[0]!.underProbability).toBeGreaterThanOrEqual(0);expect(result.finishedRatio).toBe(1);
});
test('bridge pieces in material estimates match the geometry actually rendered',async()=>{
 const {materialEstimate}=await import('../src/core/materials'),{mazeMesh}=await import('../src/renderer/maze-mesh'),{disposeMeshes}=await import('../src/renderer/dispose');
 const maze=freeMaze(bridgeFixture()),mesh=mazeMesh(maze),base=mesh.getObjectByName('timber-boards') as any;let bridgePieces=0;
 mesh.getObjectByName('covered-free-bridges')!.traverse((o:any)=>{if(o.isMesh&&o.geometry.type==='BoxGeometry')bridgePieces++;});
 const estimate=materialEstimate(maze);expect(estimate.bridgePieces).toBe(bridgePieces);expect(estimate.boardPieces).toBe(base.count+bridgePieces);expect(estimate.bridgeRoofArea).toBeGreaterThan(25);disposeMeshes(mesh);
});
test('a bridge cannot bypass a removed plot area or accept a forged jump from the deck',()=>{
 const d=bridgeFixture();d.parameters.shape={kind:'grid-rectangles',rectangles:[{x:0,z:0,width:28,height:24,operation:'add'},{x:11,z:14.5,width:.5,height:1,operation:'subtract'}]};
 expect(validateFree(d).some(i=>i.code==='bridge')).toBe(true);
 const m=freeMaze(bridgeFixture());
 expect(()=>validateWalk({kind:'maze-lab-walk',version:2,id:'jump',maze:JSON.parse(serialize(m)),finished:false,status:'stopped',recording:{samples:[{x:13,z:15,y:2.8,floor:1,bridge:'bridge-1',time:0},{x:13,z:15,y:0,floor:0,time:1}],distance:2.8,elapsed:1}})).toThrow();
});

test.each(['living','corridor'] as const)('%s organic bridge generation keeps its existing generator and valid network',async generationType=>{
 const {generateFree}=await import('../src/free/generate');
 const maze=generateFree({placementMode:'free',generationType,columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:2,freeBridgeCount:2,seed:'bridges-5',algorithm:'prim'});
 expect(maze.parameters.generationType).toBe(generationType);expect(maze.free!.bridges).toHaveLength(2);expect(metrics(maze).cycles).toBe(2);expect(metrics(maze).reachable).toBe(true);
},25000);

test('recorded partial visits at both bridge ends do not cover the unwalked middle',async()=>{
 const {bridgeWalkArea}=await import('../src/free/walk-coverage'),m=freeMaze(bridgeFixture()),g=bridgeGeometry(m.free!,m.free!.bridges![0]!);
 const probes=[g.at(0),g.at(.1),{x:3,z:15,y:0,floor:0},g.at(1),g.at(.9)];
 const partial=bridgeWalkArea(m,probes),full=bridgeWalkArea(m,g.path);
 expect(partial).toBeGreaterThan(0);expect(partial).toBeLessThan(full*.3);expect(full).toBeCloseTo(pathLength(g.path)*g.bridge.width);
});

test('external inspection cannot walk through a solid flight, while the underpass remains open',async()=>{
 const {bridgeInspectionSolids}=await import('../src/free/bridges'),{walls}=await import('../src/core/maze'),{supportColliders}=await import('../src/core/structure');
 const m=freeMaze(bridgeFixture()),world=new CollisionWorld([...walls(m),...supportColliders(m),...bridgeInspectionSolids(m.free!)]);
 expect(world.move({x:3,z:15,y:0},{x:6,z:0}).x).toBeLessThan(4);
 expect(world.move({x:13,z:13,y:0},{x:0,z:4}).z).toBeCloseTo(17);
});

test('bridge reservation supports the existing minimum wall height without an impossible rise',async()=>{
 const {seedFreeBridges}=await import('../src/free/bridge-generate'),{emptyLayout}=await import('../src/free/model'),d=bridgeFixture();
 d.layout=emptyLayout();d.construction.wallHeight=1.8;d.parameters.columns=30;d.parameters.rows=30;
 seedFreeBridges(d.layout,1,{x:15,z:15},17,1.8,1.6);
 d.layout.openings=[{id:'in',room:'bridge-left-0',edge:3,offset:0,width:1.4},{id:'out',room:'bridge-right-0',edge:1,offset:0,width:1.4}];d.layout.entrance='in';d.layout.exit='out';
 expect(d.layout.bridges![0]!.rise).toBe(2.2);expect(validateFree(d)).toEqual([]);
});
