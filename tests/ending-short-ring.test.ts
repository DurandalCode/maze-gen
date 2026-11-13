import {expect,test} from 'bun:test';
import fixture from './fixtures/vortex-f11-before-ending.json';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {vortexF11Ending} from '../src/free/vortex-f11-ending';
import {addEndingShortRing} from '../src/free/ending-short-ring';
import {freeRuntime,freeGraphPath,connectionGeometry} from '../src/free/layout';
import {distance,ends} from '../src/free/geometry';
import {shortestPath,pathLength} from '../src/core/pathfinding';
import {CollisionWorld} from '../src/simulation/collisions';
import {auditModuleWalls} from '../src/free/module-origin';
import {loopTraps} from '../src/analysis/loop-traps';
import {routeTraps} from '../src/analysis/route-traps';
const source=vortexF11Ending(deserialize(JSON.stringify(fixture))),before=serialize(source),next=addEndingShortRing(source);
test('a three-frame ending ring preserves the saved finish and every old construction',()=>{
 expect(serialize(source)).toBe(before);expect(next.free!.modules.slice(0,source.free!.modules.length)).toEqual(source.free!.modules);
 expect(next.free!.connections.slice(0,source.free!.connections.length)).toEqual(source.free!.connections);expect(next.free!.spaces).toEqual(source.free!.spaces);expect(next.free!.openings).toEqual(source.free!.openings);expect(next.free!.walls).toEqual(source.free!.walls);
 expect(next.parameters).toEqual(source.parameters);expect(next.environment).toEqual(source.environment);expect(next.roof).toBe(source.roof);expect(next.free!.modules.length-source.free!.modules.length).toBe(3);
 for(const c of next.free!.connections.slice(source.free!.connections.length))expect(Math.max(...connectionGeometry(next.free!,c).sides.map(w=>distance(...ends(w))))).toBeLessThanOrEqual(3+1e-7);
 expect(auditModuleWalls(next.free!).issues).toEqual([]);expect(serialize(addEndingShortRing(source))).toBe(serialize(next));expect(serialize(deserialize(serialize(next)))).toBe(serialize(next));expect(()=>addEndingShortRing(next)).toThrow();
 const a=freeRuntime(source),b=freeRuntime(next);expect(shortestPath(next).map(i=>b.rooms[i]!.id)).toEqual(shortestPath(source).map(i=>a.rooms[i]!.id));
});
test('the short ring is capsule-clear, has no internal dead end and does not replace K1/K2',()=>{
 const r=freeRuntime(next),a=freeRuntime(source),ids=['spiral1-10','spiral0-16','hybrid-vortexhybridnext11spreadbay18-633','ending-short-ring-0','ending-short-ring-1','ending-short-ring-2','hybrid-vortexhybridnext11spreadbay18-1210','hybrid-vortexhybridnext11spreadbay18-206','spiral1-10'],circuit=ids.map(id=>r.rooms.findIndex(v=>v.id===id));
 expect(pathLength(freeGraphPath(next,circuit))).toBeCloseTo(35.84693286798872,6);expect(pathLength(freeGraphPath(next,circuit))).toBeLessThan(40);
 for(const id of ids.slice(1,-2)){const cell=r.rooms.findIndex(v=>v.id===id);expect(r.passages[cell]!.length).toBe(2);}
 const world=new CollisionWorld(r.obstacles);for(const path of [...r.edgePaths.values(),...r.portalPaths.values()])for(let i=1;i<path.length;i++)expect(distance(world.move(path[i-1]!,{x:path[i]!.x-path[i-1]!.x,z:path[i]!.z-path[i-1]!.z}),path[i]!)).toBeLessThan(1e-5);
 const canonical=(m:typeof next,runtime:typeof r)=>loopTraps(m).candidates.filter(t=>t.qualifies).map(t=>({fork:runtime.rooms[t.fork]!.id,members:t.loop.map(i=>runtime.rooms[i]!.id)})).sort((a,b)=>a.fork.localeCompare(b.fork));
 expect(canonical(next,r)).toEqual(canonical(source,a));expect(canonical(next,r)).toHaveLength(2);expect(routeTraps(next).qualifiedCount).toBe(2);
},20000);
