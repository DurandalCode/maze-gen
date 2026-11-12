import {beforeAll,expect,test} from 'bun:test';
import {generateFree} from '../src/free/generate';
import {vortexParameters} from '../src/free/vortex-parameters';
import {freeGroundLengths,freeLayoutLengths} from '../src/free/path-limits';
import {connectionGeometry,freeRuntime} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {DEFAULT_DESIGN_LIMITS,walls,type Maze} from '../src/core/maze';
import {supportColliders} from '../src/core/structure';
import {CollisionWorld} from '../src/simulation/collisions';
import {Player} from '../src/simulation/player';
import {shortestPath,routePoints} from '../src/core/pathfinding';
import {serialize,deserialize} from '../src/persistence/maze-json';
const parameters=vortexParameters({columns:60,rows:60,corridorWidth:2,moduleSize:2,seed:'vortex-01',algorithm:'prim',extraConnections:0});let maze:Maze;
beforeAll(()=>{maze=generateFree(parameters);},15000);
test('native vortex uses real frames, selective turn breaks and distributed crossroads',()=>{
 const l=maze.free!,r=freeRuntime(maze);expect(l.modules).toHaveLength(96);expect(l.spaces).toEqual([]);expect(l.walls).toEqual([]);expect(l.modules.every(m=>!m.frameOnly&&(m.type==='2x2'||m.type==='2x6'))).toBe(true);expect(auditModuleWalls(l).issues).toEqual([]);
 expect(l.connections.length-l.modules.length+1).toBe(40);expect(r.passages.filter(ns=>ns.length>=3).length).toBeGreaterThan(25);
 for(let arm=0;arm<4;arm++){const modules=l.modules.filter(m=>m.id.startsWith('spiral'+arm+'-'));expect(modules).toHaveLength(24);const radii=modules.map(m=>Math.hypot(m.x-30,m.z-30));expect(radii.every((r,i)=>!i||r>radii[i-1]!)).toBe(true);expect(modules.at(-1)!.angle-modules[0]!.angle).toBeGreaterThan(360);}
 for(const c of l.connections){const g=connectionGeometry(l,c);expect(Math.max(...g.sides.map(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)))).toBeLessThanOrEqual(3+1e-7);}
 expect(new Set(shortestPath(maze).map(i=>l.modules[i]!.id.split('-')[0])).size).toBeGreaterThan(1);
 const n=freeGroundLengths(maze);expect(n.straight).toBeLessThanOrEqual(8);expect(n.run).toBeLessThanOrEqual(16);expect(freeLayoutLengths(l).run).toBeCloseTo(n.run,4);expect(maze.roof).toBe(true);
});
test('every native path sweeps past actual posts and the player can finish',()=>{
 const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]),r=freeRuntime(maze);
 for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-5);}
 const player=new Player(maze,world);for(const target of routePoints(maze).slice(1)){let steps=0;while(!player.finished&&Math.hypot(player.position.x-target.x,player.position.z-target.z)>.01){if(++steps>2500)throw Error('Player stalled at '+JSON.stringify(target));const d=Math.hypot(player.position.x-target.x,player.position.z-target.z);player.yaw=Math.atan2(player.position.x-target.x,player.position.z-target.z);player.updateAnalog(Math.min(.02,d/1.4),1,0);}}expect(player.finished).toBe(true);
});
test('seed and imported native topology replay without replacing older modes',()=>{expect(serialize(generateFree(parameters))).toBe(serialize(maze));expect(serialize(deserialize(serialize(maze)))).toBe(serialize(maze));expect(vortexParameters({...parameters,design:{...DEFAULT_DESIGN_LIMITS,maxForcedStraight:4,maxForcedRun:8}}).design?.maxForcedRun).toBe(16);},15000);
test('infeasible vortex inputs return concrete errors rather than a smaller demo',()=>{expect(()=>generateFree({...parameters,freeModuleTarget:40})).toThrow('80, 84, 88');expect(()=>generateFree({...parameters,columns:20,rows:20})).toThrow('не помещается');expect(()=>generateFree({...parameters,freeConnectionSpan:2})).toThrow('3 м');});
