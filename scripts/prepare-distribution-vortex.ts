import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {freeMaze,freeRuntime,validateFree,physical} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {freeGroundLengths} from '../src/free/path-limits';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {metrics} from '../src/core/metrics';
import {routePoints} from '../src/core/pathfinding';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {FileStore} from '../server/store';

// A saved-geometry derivative: the older vortex preset intentionally builds a
// larger frame. This recipe trims whole optional districts, never rescales or
// relabels physical frames, and does not claim seed-only regeneration.
const source='examples/maps/approved-vortex-hybrid09.json';
const target=resolve(Bun.argv.find(a=>a.endsWith('.json'))??'examples/bundles/distribution-v2/04-vortex-hybrid.json');
const sourceRaw=await Bun.file(source).text(),draft=mazeDraft(deserialize(sourceRaw));
assert.equal(createHash('sha256').update(sourceRaw).digest('hex'),'32f8c1fcab136a91cc525558c25f52ba869724f02b6c940cb2f544babebe87a8','Saved vortex source changed; review the district recipe');
const removedDistricts=[
 ['spiral0-23','spiral0-22','spiral0-21','spiral0-20','spiral0-19','spiral1-13','spiral1-12','spiral2-7','spiral3-3','spiral3-4','spiral2-8','spiral2-9','spiral1-14','spiral1-15'],
 ['spiral0-2','spiral0-1','spiral0-0','vortex-false-side'],
 ['spiral3-2','hybrid-vortexchaotic05spreadbay19-635','hybrid-vortexchaotic05spreadbay19-1207'],
];
const removed=new Set(removedDistricts.flat());
draft.layout.modules=draft.layout.modules.filter(m=>!removed.has(m.id));
draft.layout.spaces=draft.layout.spaces.filter(s=>!removed.has(s.id));
draft.layout.connections=draft.layout.connections.filter(c=>!removed.has(c.a.room)&&!removed.has(c.b.room));
draft.layout.moduleConstruction={version:1,spans:(draft.layout.moduleConstruction?.spans??[]).filter(c=>!removed.has(c.a.room)&&!removed.has(c.b.room))};
delete draft.layout.cavityReport;
draft.parameters={...draft.parameters,seed:'BUNDLE-75-VORTEX-HYBRID-01',freeModuleTarget:75,routeTrapCount:1,loopTrapCount:1};
assert.deepEqual(validateFree(draft),[]);
const maze=freeMaze(draft),runtime=freeRuntime(maze),audit=auditModuleWalls(maze.free!),lengths=freeGroundLengths(maze),m=metrics(maze);
assert.equal(maze.free!.modules.length,75);assert.equal(maze.roof,true);
assert.deepEqual(audit.issues,[]);assert.equal(m.components,1);assert(m.reachable);
assert(lengths.straight<=8+1e-7&&lengths.run<=64+1e-7);
const ordinary=routeTraps(maze).qualifiedCount,loops=loopTraps(maze).qualifiedCount;
assert(ordinary>=1&&loops>=1);
const ports=maze.free!.openings.filter(o=>o.id===maze.free!.entrance||o.id===maze.free!.exit);
assert(selectOppositePortals(maze.free!,ports,Math.min(...ports.map(o=>o.width))).length>0);
const world=new CollisionWorld(physical(maze.free!).obstacles);let capsuleLegs=0;
for(const path of [...runtime.edgePaths.values(),...runtime.portalPaths.values()])for(let i=1;i<path.length;i++)for(const [a,b]of[[path[i-1]!,path[i]!],[path[i]!,path[i-1]!]]){
 const moved=world.move(a!,{x:b!.x-a!.x,z:b!.z-a!.z});assert(Math.hypot(moved.x-b!.x,moved.z-b!.z)<1e-5,'Blocked physical passage');capsuleLegs++;
}
const player=new Player(maze,world);
for(const target of routePoints(maze).slice(1))for(let step=0;step<10000&&!player.finished;step++){
 const dx=target.x-player.position.x,dz=target.z-player.position.z,distance=Math.hypot(dx,dz);if(distance<1e-6)break;
 player.yaw=Math.atan2(-dx,-dz);const before={...player.position};player.updateAnalog(Math.min(.02,distance/1.4),1,0);
 assert(Math.hypot(player.position.x-before.x,player.position.z-before.z)>1e-8,'Player stuck');
}
assert(player.finished);const raw=serialize(maze);assert.equal(serialize(deserialize(raw)),raw);await Bun.write(target,raw);
let libraryId:string|undefined;
if(Bun.argv.includes('--install'))libraryId=(await new FileStore(resolve('.local-data')).saveMaze(JSON.parse(raw),'Бандл75 · 04 Гибридный вортекс')).id;
const report={version:1,source,sourceSha256:createHash('sha256').update(sourceRaw).digest('hex'),recipe:'saved-geometry derivative; remove listed optional districts, preserve all remaining frame coordinates and courtyard geometry',command:'.tools/bun-windows-x64/bun.exe scripts/prepare-distribution-vortex.ts --install',removedDistricts,sha256:createHash('sha256').update(raw).digest('hex'),modules:maze.free!.modules.length,ordinaryTraps:ordinary,loopTraps:loops,throughCourtyards:maze.free!.spaces.filter(s=>s.kind==='hall').length,roof:maze.roof,oppositeExteriorPortals:true,limits:{straight:8,run:64},actualLengths:lengths,wallAuditIssues:audit.issues,components:m.components,cycles:m.cycles,capsuleLegsBothDirections:capsuleLegs,playerFinished:player.finished,jsonRoundTrip:true,libraryId,url:libraryId?`http://127.0.0.1:1420/?maze=${libraryId}`:undefined};
await Bun.write(target.replace(/\.json$/,'.validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
