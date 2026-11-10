import {test,expect} from 'bun:test';
import {generate} from '../src/generators/generate';
import {serialize} from '../src/persistence/maze-json';
import {canonical,contentId} from '../src/persistence/identity';
import {storedModuleCount,storedTopologyPayload} from '../src/persistence/library-summary';
import {domainOf} from '../src/core/domain';
import {FileStore,topologyId} from '../server/store';
import {freeMaze} from '../src/free/layout';
import {emptyLayout} from '../src/free/model';
import {DEFAULT_CONSTRUCTION,type Maze} from '../src/core/maze';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
function free(){const l=emptyLayout();l.modules=[{id:'a',type:'2x2',x:4,z:4,angle:0},{id:'b',type:'2x2',x:8,z:4,angle:0}];l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:16,rows:16,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'summary',algorithm:'prim'},construction:{...DEFAULT_CONSTRUCTION},layout:l});}
test('persisted v1-v6 snapshots retain the exact topology ID and module count without free navigation hydration',async()=>{
 const base={columns:3,rows:3,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'summary',algorithm:'prim' as const};
 const maps=[generate({...base,moduleSize:undefined}),generate(base),generate({...base,shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:3,height:2,operation:'add'}]}}),generate({...base,generationType:'corridor',columns:18,rows:18}),free(),generate({...base,generationType:'two-storey',columns:5,rows:5,minFloorChanges:4,algorithm:'backtracker',seed:'two-test'})];
 for(const m of maps){const wire=JSON.parse(serialize(m)) as Maze;expect(await contentId(storedTopologyPayload(wire))).toBe(topologyId(m));expect(storedModuleCount(wire)).toBe(m.parameters.moduleSize===undefined?null:domainOf(m).modules.reduce((a,b)=>a+b,0));}
});
test('cold library lists reuse stored assessments and topology IDs; opening still restores the full snapshot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'maze-summary-'));try{
  const store=new FileStore(root),m=free(),maze=await store.saveMaze(m,'Free summary'),assessment={distance:4,ratio:123,interpretation:'movement-only'};
  await mkdir(join(root,'walks'),{recursive:true});await writeFile(join(root,'walks','legacy.json'),JSON.stringify({id:'legacy',mazeId:maze.id,createdAt:'2026',updatedAt:'2026',topologyId:topologyId(m),assessment,walk:{maze:JSON.parse(serialize(m)),status:'stopped',finished:false,recording:{distance:4,elapsed:3,samples:[]}}}));
  const cold=new FileStore(root),mazes=await cold.listMazes(),walks=await cold.listWalks();expect(mazes[0]!.modules).toBe(2);expect(walks[0]!.assessment).toEqual(assessment);expect(walks[0]!.topologyId).toBe(topologyId(m));expect(canonical((await cold.getMaze(maze.id))!.maze)).toBe(canonical(m));
 }finally{await rm(root,{recursive:true,force:true});}
});
