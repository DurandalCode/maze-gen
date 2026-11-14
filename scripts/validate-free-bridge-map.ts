/** Validate a separately prepared bridge map and optionally add its library record. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {validateFree,freeRuntime,freeRoute,physical} from '../src/free/layout';
import {bridgeGeometry} from '../src/free/bridges';
import {bridgeRouteErrors,bridgeRouteSummary} from '../src/free/bridge-route';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {routeTraps} from '../src/analysis/route-traps';
import {loopTraps} from '../src/analysis/loop-traps';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {routePoints} from '../src/core/pathfinding';
import {metrics} from '../src/core/metrics';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {FileStore} from '../server/store';
const file=Bun.argv[2];if(!file)throw Error('Usage: bun scripts/validate-free-bridge-map.ts MAP.json [--install]');
const raw=await Bun.file(file).text(),maze=deserialize(raw),layout=maze.free!;
assert.equal(maze.version,7);assert(maze.roof);assert(layout.modules.length<=75);assert(layout.bridges!.length>=1&&layout.bridges!.length<=2);
assert.deepEqual(serialize(deserialize(serialize(maze))),serialize(maze));assert.deepEqual(validateFree(mazeDraft(maze)),[]);
const m=metrics(maze);assert.equal(m.components,1);assert(m.reachable);
const routes=routeTraps(maze).qualifiedCount,loops=loopTraps(maze).qualifiedCount;assert(routes>=1);assert(loops>=1);
assert.deepEqual(bridgeRouteErrors(maze),[]);const bridges=bridgeRouteSummary(maze);assert(bridges.required.length>=1);
const gates=layout.openings.filter(o=>o.id===layout.entrance||o.id===layout.exit);
const opposite=selectOppositePortals(layout,gates,Math.min(...gates.map(o=>o.width))).length>0;
assert(opposite,'Selected portals must lie on opposite exterior support planes');
const runtime=freeRuntime(maze),world=new CollisionWorld(physical(layout).obstacles);let groundPaths=0;
for(const path of [...runtime.edgePaths.values(),...runtime.portalPaths.values()]){
 if(path.some(p=>p.bridge||(p.y??0)>.01))continue;
 for(let i=1;i<path.length;i++)for(const [a,b]of [[path[i-1]!,path[i]!],[path[i]!,path[i-1]!] ]){
  const end=world.move(a!,{x:b!.x-a!.x,z:b!.z-a!.z});assert(Math.hypot(end.x-b!.x,end.z-b!.z)<1e-5,'Blocked ground opening');
 }groundPaths++;
}
const walk=(player:Player,points:readonly {x:number;z:number}[])=>{
 for(const q of points){let count=0;while(!player.finished&&Math.hypot(q.x-player.position.x,q.z-player.position.z)>.005){
  assert(count++<4000,'Player stuck '+JSON.stringify({position:player.position,target:q}));const before={...player.position};
  player.yaw=Math.atan2(player.position.x-q.x,player.position.z-q.z);player.updateAnalog(Math.min(.02,Math.hypot(q.x-player.position.x,q.z-player.position.z)/1.4),1,0);
  assert(Math.hypot(player.position.x-before.x,player.position.z-before.z)>1e-8,'Player cannot move '+JSON.stringify({position:player.position,target:q}));
 }}
};
const player=new Player(maze,world);console.log('Walking shortest route');walk(player,routePoints(maze).slice(1));assert(player.finished,'Shortest route did not finish');
const crossed=[...new Set(player.recorder.samples.filter(p=>(p.y??0)>.01).map(p=>p.bridge))];assert.equal(crossed.length,bridges.minimumCrossings);
const explorer=new Player(maze,world);console.log('Exploring bridges');walk(explorer,[...runtime.portalPaths.get(layout.entrance)!].reverse());let current=maze.entrance.cell;
for(const bridge of layout.bridges!){
 const g=bridgeGeometry(layout,bridge),a=runtime.rooms.findIndex(r=>r.id===bridge.a.room);
 walk(explorer,freeRoute(maze,current,a).points);walk(explorer,g.path);walk(explorer,[...g.path].reverse());walk(explorer,[runtime.centers[a]!]);current=a;
}
walk(explorer,freeRoute(maze,current,maze.exit.cell).points);walk(explorer,runtime.portalPaths.get(layout.exit)!);assert(explorer.finished);
const explored=[...new Set(explorer.recorder.samples.filter(p=>(p.y??0)>.01).map(p=>p.bridge))];assert.equal(explored.length,layout.bridges!.length);
let saved;if(Bun.argv.includes('--install'))saved=await new FileStore(resolve('.local-data')).saveMaze(maze,'05 · Свободный с мостами'+(Bun.argv.includes('--revision02')?' · правка02':'')+' · '+layout.modules.length+' модулей');
const report={file,sha256:createHash('sha256').update(raw).digest('hex'),modules:layout.modules.length,qualifiedRouteTraps:routes,qualifiedLoopTraps:loops,cycles:m.cycles,roof:true,fabricTransmissionStrength:maze.fabricTransmissionStrength??1,oppositePortals:opposite,portalPrivacy:mazePortalPrivacy(maze,false),bridges,groundPathsCheckedBothDirections:groundPaths,player:{finished:player.finished,crossed,distance:player.recorder.distance},exploration:{finished:explorer.finished,bridgesBothDirections:explored,distance:explorer.recorder.distance},jsonRoundTrip:true,validation:[],...(saved?{libraryId:saved.id,url:'http://127.0.0.1:1420/?maze='+saved.id}:{})};
await Bun.write(file.replace(/\.json$/,'.validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
