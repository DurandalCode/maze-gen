import {describe,test,expect} from 'bun:test';
import {generate} from '../src/generators/generate';
import {type Maze,type Parameters,cellCenter} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
import {floorOf,minimumFloorChanges,spatialEdgeLength,spatialEdgePoints,stairProgress} from '../src/core/two-storey';
import {componentCount,independentCycles} from '../src/core/graph';
import {routePoints,pathLength} from '../src/core/pathfinding';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {topologyId,FileStore} from '../server/store';
import {browserTopologyId} from '../src/persistence/identity';
import {recordJson} from '../src/persistence/record-codec';
import {makeWalkData,validateWalk,restoreRecorder} from '../src/persistence/walk-json';
import {Recorder} from '../src/simulation/recorder';
import {Player} from '../src/simulation/player';
import {CollisionWorld} from '../src/simulation/collisions';
import {TwoStoreyWorld} from '../src/simulation/two-storey-world';
import {spatialLineVisible} from '../src/core/spatial-visibility';
import {analyzeColdspots,DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {optimizeColdspots} from '../src/analysis/optimize';
import {assessWalk} from '../src/analysis/walk-assessment';
import {withPortals} from '../src/core/portals';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const parameters:Parameters={generationType:'two-storey',columns:5,rows:5,corridorWidth:2,moduleSize:2,minFloorChanges:4,extraConnections:2,algorithm:'backtracker',seed:'two-test'};
const make=(patch:Partial<Parameters>={})=>generate({...parameters,...patch});
function walkRoute(maze:Maze):Player{
  const player=new Player(maze,new CollisionWorld([]));
  for(const target of routePoints(maze).slice(1)){
    let steps=0;
    while(Math.hypot(target.x-player.position.x,target.z-player.position.z)>.015&&!player.finished){
      if(steps++>1000)throw Error(`Player stuck at ${JSON.stringify(player.position)} approaching ${JSON.stringify(target)}`);
      const dx=target.x-player.position.x,dz=target.z-player.position.z;
      player.yaw=Math.atan2(-dx,-dz);player.updateAnalog(Math.min(.02,Math.hypot(dx,dz)/1.4),1,0);
    }
  }
  return player;
}
describe('two-storey maze',()=>{
  for(const minFloorChanges of [2,4,6])for(const algorithm of ['backtracker','prim'] as const)test(`${algorithm}: any solution changes floors at least ${minFloorChanges} times`,()=>{
    const m=make({minFloorChanges,algorithm});expect(componentCount(m)).toBe(1);expect(independentCycles(m)).toBe(2);expect(minimumFloorChanges(m)).toBeGreaterThanOrEqual(minFloorChanges);expect(floorOf(m,m.entrance.cell)).toBe(0);expect(floorOf(m,m.exit.cell)).toBe(0);expect(serialize(make({minFloorChanges,algorithm}))).toBe(serialize(m));
    for(const st of m.storeys!.stairs){expect(st.rise/st.steps).toBeLessThanOrEqual(.180001);expect(Math.hypot(st.end.x-st.start.x,st.end.z-st.start.z)/st.steps).toBeGreaterThanOrEqual(.28);}
  });
  test('partial upper floor and disconnected islands stay reachable',()=>{
    const m=make({columns:7,rows:7,upperShape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:3,height:7,operation:'add'},{x:4,z:0,width:3,height:7,operation:'add'}]}});
    expect(componentCount(m)).toBe(1);expect(minimumFloorChanges(m)).toBeGreaterThanOrEqual(4);expect(domainOf(m.storeys!.floors[1]).modules.reduce((a,b)=>a+b,0)).toBe(42);
  });
  test('rejects wrong construction, odd transition counts, outside upper shapes and too small shafts',()=>{
    expect(()=>make({moduleSize:undefined})).toThrow();expect(()=>make({minFloorChanges:3})).toThrow();expect(()=>make({columns:1,rows:1})).toThrow();expect(()=>make({shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:3,height:5,operation:'add'}]},upperShape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:5,height:5,operation:'add'}]}})).toThrow();
  });
  test('v6 stores canonical geometry, validates the graph and keeps matching identities',async()=>{
    const m=make(),text=serialize(m),wire=JSON.parse(text);expect(wire.version).toBe(6);expect(wire.storeys.nodes).toBeUndefined();const restored=deserialize(text);expect(serialize(restored)).toBe(text);expect(await browserTopologyId(restored)).toBe(topologyId(m));expect(await browserTopologyId({...m,parameters:{...m.parameters,seed:'another'}})).toBe(topologyId(m));
    const broken=JSON.parse(text);broken.storeys.stairs[0].shaft[0]=9999;expect(()=>deserialize(JSON.stringify(broken))).toThrow();
    const bypass=JSON.parse(text),edge=domainOf(m).cells.flatMap(a=>m.storeys!.adjacent[a]!.map(b=>[a,b] as const)).find(([a,b])=>{if(m.passages[a]!.includes(b))return false;const passages=m.passages.map(v=>[...v]);passages[a]!.push(b);passages[b]!.push(a);return minimumFloorChanges({...m,passages})<4;});expect(edge).toBeDefined();bypass.passages[edge![0]].push(edge![1]);bypass.passages[edge![1]].push(edge![0]);expect(()=>deserialize(JSON.stringify(bypass))).toThrow();
  });
  test('physical stairs can be walked up and down with no teleportation and reach the real exit',()=>{
    const m=make(),player=walkRoute(m);expect(player.finished).toBe(true);expect(player.position.floor).toBe(0);expect(player.position.stair).toBeUndefined();expect(player.recorder.samples.some(p=>p.stair!==undefined&&p.y!>0&&p.y!<m.storeys!.floorHeight)).toBe(true);
    const changes=player.recorder.samples.slice(1).filter((p,i)=>p.floor!==player.recorder.samples[i]!.floor).length;expect(changes).toBeGreaterThanOrEqual(4);
    expect(Math.abs(player.recorder.distance-pathLength(routePoints(m)))).toBeLessThan(.5);
  });
  test('stairs allow stopping, reversal and closed sides; upstairs cannot finish downstairs',()=>{
    const m=make(),world=new TwoStoreyWorld(m),st=m.storeys!.stairs[0]!,middle={x:(st.start.x+st.end.x)/2,z:(st.start.z+st.end.z)/2,y:st.rise/2,floor:1,stair:st.id};
    expect(stairProgress(st,middle)).toBeCloseTo(.5);const stopped=world.move(middle,{x:0,z:0},()=>{});expect(stopped).toEqual(middle);
    const direction={x:(st.start.x-st.end.x)/100,z:(st.start.z-st.end.z)/100};expect(world.move(middle,direction,()=>{}).y).toBeLessThan(middle.y);
    const sideways=st.axis==='x'?{x:0,z:10}:{x:10,z:0},side=world.move(middle,sideways,()=>{});expect(Math.hypot(side.x-middle.x,side.z-middle.z)).toBeLessThan(st.width/2);
    const p=new Player(m,new CollisionWorld([]));p.position={...cellCenter(m,m.exit.cell),floor:1,y:m.storeys!.floorHeight};p.updateAnalog(.02,0,0);expect(p.finished).toBe(false);
  });
  test('same coordinates on different floors are occluded and counted separately',()=>{
    const m=make(),n=m.storeys!.floors[0].passages.length,c=domainOf(m).cells.find(c=>c<n&&m.storeys!.nodes[c+n])!,a=cellCenter(m,c),b=cellCenter(m,c+n);
    expect(spatialLineVisible(m,{...a,y:1.7},{...b,y:b.y!+1.7})).toBe(false);
    const low=assessWalk(m,[{...a,time:0}],0),high=assessWalk(m,[{...b,time:0}],0),both=assessWalk(m,[{...a,time:0},{...b,time:1}],0);expect(low.coveredAreaRatio).toBeGreaterThan(0);expect(high.coveredAreaRatio).toBeCloseTo(low.coveredAreaRatio);expect(both.coveredAreaRatio).toBeCloseTo(2*low.coveredAreaRatio);
  });
  test('recording v2 roundtrip retains height, stair state and sloped distance',()=>{
    const m=make(),player=walkRoute(m),data=makeWalkData(m,player.recorder,'storey-walk',true,'finished'),decoded=validateWalk(JSON.parse(recordJson(data)));expect(data.version).toBe(2);expect(decoded.recording.samples).toEqual(data.recording.samples);expect(restoreRecorder(decoded.recording).distance).toBe(player.recorder.distance);const corrupted=structuredClone(decoded);corrupted.recording.samples[0]!.y=99;expect(()=>validateWalk(corrupted)).toThrow();
    const st=m.storeys!.stairs[0]!,points=spatialEdgePoints(m,st.lower,st.cells[0]!),r=new Recorder(points[0]!);points.slice(1).forEach((p,i)=>r.record(p,i+1,true));expect(r.distance).toBeCloseTo(spatialEdgeLength(m,st.lower,st.cells[0]!));
  });
  test('heat, potential and wall optimization support the whole graph',()=>{
    const m=make(),options={...DEFAULT_ANALYSIS,samples:16},heat=analyzeColdspots(m,options);expect(heat.modelVersion).toBe(11);expect(heat.probability[m.exit.cell]).toBe(1);expect(Number.isFinite(heat.expectedLength)).toBe(true);expect(analyzePotential(m,options,heat,false).supported).toBe(true);
    const optimized=optimizeColdspots(m,options,'walls',2);expect(minimumFloorChanges(optimized.maze)).toBeGreaterThanOrEqual(4);expect(componentCount(optimized.maze)).toBe(1);expect(independentCycles(optimized.maze)).toBe(2);expect(optimized.maze.parameters.upperShape).toEqual(m.parameters.upperShape);
  });
  test('moving portals cannot bypass obligatory transitions',()=>{
    const m=make(),edges=domainOf(m).boundary,p=edges.find(e=>e.portal.cell!==m.entrance.cell&&minimumFloorChanges(m,m.entrance.cell,e.portal.cell)<4)!.portal;expect(()=>withPortals({...m,exit:p},[m.entrance,p])).toThrow();
  });
  test('server library restores maps and recordings',async()=>{
    const root=await mkdtemp(join(tmpdir(),'maze-storeys-'));try{const store=new FileStore(root),m=make(),player=walkRoute(m),saved=await store.saveMaze(m,'Два этажа');expect((await store.getMaze(saved.id))!.maze.storeys!.nodes.length).toBe(m.storeys!.nodes.length);const walk=await store.saveWalk(makeWalkData(m,player.recorder,'persisted-storey',true,'finished'));expect((await store.getWalk(walk.id))!.walk.recording.samples).toEqual(player.recorder.samples);}finally{await rm(root,{recursive:true,force:true});}
  });
});
