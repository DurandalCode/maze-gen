import {beforeAll,expect,test} from 'bun:test';
import type {Maze,Parameters,Point} from '../src/core/maze';
import {DEFAULT_CONSTRUCTION,validateParameters} from '../src/core/maze';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {seedFreeZones,freeZoneSummary} from '../src/free/zones';
import {freeIslands,freeRuntime,validateFree} from '../src/free/layout';
import {generateFree} from '../src/free/generate';
import {mazeDraft,decodeDraft,encodeDraft,freeIdentity} from '../src/free/json';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {metrics} from '../src/core/metrics';
import {FreeBridgeWorld} from '../src/simulation/free-bridge-world';
import {bridgeGeometry} from '../src/free/bridges';
import {routePoints} from '../src/core/pathfinding';
const parameters:Parameters={placementMode:'free',columns:60,rows:50,moduleSize:2,corridorWidth:2,extraConnections:5,freeZoneCount:3,freeIslandCount:3,freeBridgeCount:2,seed:'zones-1',algorithm:'prim'};
function seed(){const d:FreeDraft={kind:'maze-lab-free-draft',version:2,parameters,construction:{...DEFAULT_CONSTRUCTION},layout:emptyLayout()};seedFreeZones(d.layout,parameters,{x:30,z:18},3,d.construction.wallHeight,1.6);return d;}
test('zone seed has three real closed islands; breaking a ring removes only that island',()=>{
 const d=seed();expect(validateFree(d,false)).toEqual([]);expect(freeIslands(d.layout)).toHaveLength(3);
 d.layout.connections=d.layout.connections.filter(c=>c.id!=='zone-1-ring-0');expect(freeIslands(d.layout)).toHaveLength(2);
});
test('invalid zone counts, island counts, cycle budgets and unknown zone references are rejected',()=>{
 for(const patch of [{freeZoneCount:1},{freeIslandCount:4},{extraConnections:4},{placementMode:'grid' as const}])expect(()=>validateParameters({...parameters,...patch})).toThrow();
 const d=seed();d.layout.modules[0]!.zone='missing';expect(()=>decodeDraft(JSON.stringify(d))).toThrow('Неизвестная зона');expect(validateFree(d,false).some(i=>i.code==='zone')).toBe(true);
});
let maze:Maze;
beforeAll(()=>{maze=generateFree(parameters);},25000);
test('three-zone organic growth retains exact cycles, mixed rotated modules, endpoints in distinct zones and physical islands',()=>{
 expect(validateFree(mazeDraft(maze))).toEqual([]);expect(metrics(maze).cycles).toBe(5);expect(maze.free!.bridges).toHaveLength(2);
 const summary=freeZoneSummary(maze.free!);expect(summary).toHaveLength(3);expect(new Set(summary.map(z=>z.style)).size).toBe(3);for(const zone of summary)expect(zone.modules).toBeGreaterThan(8);
 expect(maze.free!.modules.length).toBeGreaterThan(50);expect(new Set(maze.free!.modules.map(m=>Math.round(m.angle%90))).size).toBeGreaterThan(3);
 const r=freeRuntime(maze),islands=freeIslands(maze.free!);expect(islands).toHaveLength(3);for(const island of islands){expect(island.area).toBeGreaterThan(60);expect(r.contains(island.center)).toBe(false);}
 const openings=maze.free!.openings,roomZone=(id:string)=>maze.free!.modules.find(m=>m.id===id)?.zone;
 expect(roomZone(openings.find(o=>o.id===maze.free!.entrance)!.room)).not.toBe(roomZone(openings.find(o=>o.id===maze.free!.exit)!.room));
});
test('zones survive ready/draft JSON, renaming metadata leaves topology identity unchanged',()=>{
 const restored=deserialize(serialize(maze));expect(restored.free).toEqual(maze.free);expect(decodeDraft(encodeDraft(mazeDraft(maze))).layout).toEqual(maze.free!);
 const renamed=structuredClone(maze);renamed.free!.zones![0]!.title='Другое название';expect(freeIdentity(renamed)).toEqual(freeIdentity(maze));
});
test('actual player-sized collision world follows route and both levels of every bridge',()=>{
 const world=new FreeBridgeWorld(maze),paths=[routePoints(maze),...maze.free!.bridges!.map(b=>bridgeGeometry(maze.free!,b).path)];
 for(const path of paths){let p:Point={...path[0]!,y:0,floor:0};delete p.bridge;for(const target of path.slice(1)){p=world.move(p,{x:target.x-p.x,z:target.z-p.z},()=>{});expect(Math.hypot(p.x-target.x,p.z-target.z)).toBeLessThan(1e-5);}}
});
test('same seed reproduces grown geometry including zone metadata',()=>{expect(serialize(generateFree(parameters))).toBe(serialize(maze));},25000);
