/** Rebuild and verify the individual organic courtyard map from frozen native geometry. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {freeMaze,freeRuntime,physical,validateFree} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {freeGroundLengths} from '../src/free/path-limits';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {metrics} from '../src/core/metrics';
import {routePoints} from '../src/core/pathfinding';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {FileStore} from '../server/store';
import type {Construction,Parameters} from '../src/core/maze';
import type {FreeConnection,FreeLayout,FreeModule,FreeOpening} from '../src/free/model';

const recipeFile='examples/bundles/distribution-v2/03-free-hybrid.recipe.json';
const recipe=await Bun.file(recipeFile).json() as {
 source:string;sourceSha256:string;outputSha256:string;method:string;
 parameters:Parameters;construction:Construction;removedConnections:string[];
 addedModules:FreeModule[];addedConnections:FreeConnection[];
 openings:FreeOpening[];moduleConstruction:FreeLayout['moduleConstruction'];
};
const target=Bun.argv.find(a=>a.endsWith('.json'))??'examples/bundles/distribution-v2/03-free-hybrid.json';
const sourceRaw=await Bun.file(recipe.source).text(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
assert.equal(hash(sourceRaw),recipe.sourceSha256,'Frozen organic source changed');
const draft=mazeDraft(deserialize(sourceRaw)),originalModules=structuredClone(draft.layout.modules);
draft.parameters=structuredClone(recipe.parameters);draft.construction=structuredClone(recipe.construction);
draft.layout.modules.push(...structuredClone(recipe.addedModules));
draft.layout.connections=draft.layout.connections.filter(c=>!recipe.removedConnections.includes(c.id));
draft.layout.connections.push(...structuredClone(recipe.addedConnections));
draft.layout.openings=structuredClone(recipe.openings);
draft.layout.moduleConstruction=structuredClone(recipe.moduleConstruction);
delete draft.layout.cavityReport;delete draft.layout.postRouteSource;
for(const frame of originalModules)assert.deepEqual(draft.layout.modules.find(m=>m.id===frame.id),frame);
assert.deepEqual(validateFree(draft),[]);
const maze=freeMaze(draft),layout=maze.free!,raw=serialize(maze),runtime=freeRuntime(maze);
assert.equal(hash(raw),recipe.outputSha256,'Recipe must reproduce the exact reviewed geometry');
assert.equal(serialize(deserialize(raw)),raw);assert(maze.roof);assert.equal(layout.modules.length,70);
assert.deepEqual(auditModuleWalls(layout).issues,[]);
const ordinary=routeTraps(maze),loops=loopTraps(maze),m=metrics(maze),lengths=freeGroundLengths(maze);
assert(ordinary.qualifiedCount>=1&&loops.qualifiedCount>=1);assert.equal(m.components,1);assert(m.reachable);
assert(lengths.straight<=8+1e-7&&lengths.run<=64+1e-7);
const ports=layout.openings.filter(o=>o.id===layout.entrance||o.id===layout.exit);
assert(selectOppositePortals(layout,ports,Math.min(...ports.map(o=>o.width))).length);
const privacy=mazePortalPrivacy(maze,false);assert(privacy.certified);
const world=new CollisionWorld(physical(layout).obstacles);let capsuleLegs=0;
for(const path of [...runtime.edgePaths.values(),...runtime.portalPaths.values()])for(let i=1;i<path.length;i++)for(const [a,b]of[[path[i-1]!,path[i]!],[path[i]!,path[i-1]!]]){
 const moved=world.move(a!,{x:b!.x-a!.x,z:b!.z-a!.z});assert(Math.hypot(moved.x-b!.x,moved.z-b!.z)<1e-5,'Blocked native passage');capsuleLegs++;
}
const player=new Player(maze,world);
for(const target of routePoints(maze).slice(1))for(let step=0;step<10000&&!player.finished;step++){
 const dx=target.x-player.position.x,dz=target.z-player.position.z,distance=Math.hypot(dx,dz);if(distance<1e-6)break;
 player.yaw=Math.atan2(-dx,-dz);const before={...player.position};player.updateAnalog(Math.min(.02,distance/1.4),1,0);
 assert(Math.hypot(player.position.x-before.x,player.position.z-before.z)>1e-8,'Physical Player stuck');
}
assert(player.finished);await Bun.write(target,raw);
let libraryId:string|undefined;
if(Bun.argv.includes('--install'))libraryId=(await new FileStore(resolve('.local-data')).saveMaze(JSON.parse(raw),'03 · Органический гибрид с дворами · 70 модулей')).id;
const halls=layout.spaces.filter(s=>s.kind==='hall');
const report={version:1,source:recipe.source,sourceSha256:recipe.sourceSha256,recipe:recipeFile,method:recipe.method,sha256:hash(raw),modules:layout.modules.length,originalFramePosesPreserved:originalModules.length,ordinaryTraps:ordinary.qualifiedCount,loopTraps:loops.qualifiedCount,courtyards:halls.map(s=>({id:s.id,doors:layout.connections.filter(c=>c.a.room===s.id||c.b.room===s.id).length})),roof:true,oppositeExteriorPortals:true,portalPrivacy:privacy,limits:{straight:8,run:64},actualLengths:lengths,wallAuditIssues:[],validation:[],components:m.components,cycles:m.cycles,capsuleLegsBothDirections:capsuleLegs,playerFinished:player.finished,playerDistance:player.recorder.distance,jsonRoundTrip:true,libraryId,url:libraryId?`http://127.0.0.1:1420/?maze=${libraryId}`:undefined};
await Bun.write(target.replace(/\.json$/,'.validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
