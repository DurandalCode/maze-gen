import{mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{deserialize,serialize}from'../src/persistence/maze-json';
import{FileStore}from'../server/store';
import{freeRuntime,freeGraphPath,connectionGeometry,physical}from'../src/free/layout';
import{shortestPath}from'../src/core/pathfinding';
import{walls,type Point}from'../src/core/maze';
import{supportColliders}from'../src/core/structure';
import{CollisionWorld}from'../src/simulation/collisions';
import{Player}from'../src/simulation/player';
import{distance,ends,area}from'../src/free/geometry';
import{auditModuleWalls}from'../src/free/module-origin';
import{freeGroundLengths}from'../src/free/path-limits';
import{routeTraps}from'../src/analysis/route-traps';
import{loopTraps}from'../src/analysis/loop-traps';
import{inspectHybridVortexDepth}from'../src/free/vortex-hybrid-depth';
import{continuousVortexStructure}from'../src/free/vortex-continuous-structure';
import{selectOppositePortals}from'../src/free/opposite-portals';
const maze=deserialize(await Bun.file(process.env.VORTEX_HYBRID_FILE??resolve('test-results/vortex-hybrid-candidate.json')).text()),l=maze.free!,r=freeRuntime(maze),world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);let segments=0;
for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!;if(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)>1e-5)throw Error('Blocked capsule segment');segments++;}
if(!maze.parameters.freeVortexHybridDeep)throw Error('Expected explicit deep hybrid profile');
const dead=routeTraps(maze),loops=loopTraps(maze),tour:Point[]=[...r.portalPaths.get(l.entrance)!].reverse();let at=maze.entrance.cell;
const go=(cell:number)=>{tour.push(...freeGraphPath(maze,shortestPath(maze,at,cell)).slice(1));at=cell;};
for(const trap of [...new Map(dead.candidates.filter(t=>t.qualifies).map(t=>[t.fork,t])).values()]){go(trap.fork);tour.push(...freeGraphPath(maze,[...trap.falsePath,...trap.falsePath.slice(0,-1).reverse()]).slice(1));}
for(const loop of loops.candidates.filter(t=>t.qualifies)){go(loop.fork);tour.push(...freeGraphPath(maze,loop.loop).slice(1));}
for(const room of l.spaces.filter(s=>s.kind==='hall'))go(r.rooms.findIndex(q=>q.id===room.id));go(maze.exit.cell);tour.push(...r.portalPaths.get(l.exit)!.slice(1));
const player=new Player(maze,world);for(const target of tour.slice(1)){let steps=0;while(!player.finished&&distance(player.position,target)>.01){if(++steps>2500)throw Error('Player stalled on hybrid tour');const d=distance(player.position,target);player.yaw=Math.atan2(player.position.x-target.x,player.position.z-target.z);player.updateAnalog(Math.min(.02,d/1.4),1,0);}}if(!player.finished)throw Error('Player did not finish');
const structure=continuousVortexStructure(maze);if(structure.loops.some(k=>!k.allInteriorDegreesTwo||k.deadEnds.length||k.internalJunctions))throw Error('Hybrid touched the clean K route');if(!selectOppositePortals(l,l.openings,Math.min(...l.openings.map(o=>o.width))).length)throw Error('Portals no longer outside');
const depths=inspectHybridVortexDepth(maze,{x:maze.parameters.columns/2,z:maze.parameters.rows/2});if(depths.filter(d=>d.qualifies&&d.pure&&d.inwardExcursion>=10&&d.inwardBandConnections.length>=3).length<2)throw Error('Expected two physically deep pure loops');
const baseUrl=process.env.MAZE_BASE_URL??'http://127.0.0.1:1424',artifact=process.env.VORTEX_ARTIFACT_NAME??'vortex-hybrid-09';
const record=process.env.VORTEX_CHECK_ONLY?{id:'check-only'}:await new FileStore(process.env.MAZE_DATA_DIR??resolve('.local-data')).saveMaze(JSON.parse(serialize(maze)), process.env.VORTEX_MAP_NAME??"\u0412\u043e\u0440\u0442\u0435\u043a\u0441 \u00b7 \u0433\u0438\u0431\u0440\u0438\u043409 \u00b7 \u0433\u043b\u0443\u0431\u043e\u043a\u0438\u0439 \u0432\u043e\u0437\u0432\u0440\u0430\u0442 \u00b7 8/64 \u043c"),out=process.env.VORTEX_OUTPUT_DIR??resolve('test-results');
if(!process.env.VORTEX_CHECK_ONLY)console.log('PLAYABLE '+baseUrl+'/?maze='+record.id+'&blind=1');
const report={deepCircuits:depths.map(({points,members,...d})=>d),replayStatus:'experimental deep stage integrated; exact browser regeneration not yet checked',id:record.id,url:`${baseUrl}/?maze=${record.id}&blind=1`,modules:l.modules.length,longModules:l.modules.filter(m=>m.type==='2x6').length,qualified:{dead:dead.qualifiedCount,loops:loops.qualifiedCount},lengths:freeGroundLengths(maze),capsuleSegments:segments,player:{allCourtyards:l.spaces.filter(s=>s.kind==='hall').length,deadForks:dead.qualifiedCount,returnLoops:loops.qualifiedCount,finished:player.finished},structure,ledger:l.cavityReport,moduleOrigin:auditModuleWalls(l).issues,maxSide:Math.max(...l.moduleConstruction!.spans.flatMap(c=>connectionGeometry(l,c).sides.map(w=>distance(...ends(w))))),floor:physical(l).polygons.reduce((s,p)=>s+area(p),0),actualCycles:r.passages.reduce((s,p)=>s+p.length,0)/2-r.rooms.length+1};
await mkdir(out,{recursive:true});await Bun.write(resolve(out,artifact+'.json'),serialize(maze));await Bun.write(resolve(out,artifact+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id:report.id,url:report.url,modules:report.modules,qualified:report.qualified,lengths:report.lengths,deepCircuits:report.deepCircuits,capsuleSegments:report.capsuleSegments,player:report.player,actualCycles:report.actualCycles},null,2));
