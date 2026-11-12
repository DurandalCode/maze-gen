import {expect,test} from 'bun:test';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {generateSecondDenseTrap} from '../src/free/dense-second-trap';
import {routeTraps} from '../src/analysis/route-traps';
import {trapOverlay} from '../src/ui/trap-overlay';
import {freeGroundLengths} from '../src/free/path-limits';
import {freeRuntime,physical} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {area,distance} from '../src/free/geometry';
import {CollisionWorld} from '../src/simulation/collisions';
import {walls} from '../src/core/maze';
import {supportColliders} from '../src/core/structure';
test('a later dense-sector fork gains its own qualified trap; supported offset doors block the real straight line',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-one-trap-base.json',import.meta.url)).text()),before=serialize(source),result=generateSecondDenseTrap(source),runtime=freeRuntime(result);
 expect(serialize(source)).toBe(before);expect(routeTraps(source).qualifiedCount).toBe(1);
 const traps=routeTraps(result);expect(traps.qualifiedCount).toBeGreaterThanOrEqual(2);expect(trapOverlay(result,traps).filter(t=>t.kind==='dead-end')).toHaveLength(traps.qualifiedCount);
 for(const old of source.free!.modules.filter(m=>!m.id.startsWith('route-arm-')))expect(result.free!.modules.find(m=>m.id===old.id)).toEqual(old);
 expect(result.free!.spaces.filter(s=>s.kind==='hall')).toEqual(source.free!.spaces.filter(s=>s.kind==='hall'));expect(result.free!.openings).toEqual(source.free!.openings);
 const lengths=freeGroundLengths(result);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);expect(auditModuleWalls(result.free!).issues).toEqual([]);
 const world=new CollisionWorld([...walls(result),...supportColliders(result)]);let physicalBaffles=0;
 for(const a of result.free!.modules.filter(m=>m.id.startsWith('dense-apex-')&&m.id.endsWith('-frame-0'))){const b=result.free!.modules.find(m=>m.id===a.id.replace(/0$/,'2'))!;const from=runtime.centers[runtime.rooms.findIndex(r=>r.id===a.id)]!,to=runtime.centers[runtime.rooms.findIndex(r=>r.id===b.id)]!,end=world.move(from,{x:to.x-from.x,z:to.z-from.z});if(distance(end,to)>.1)physicalBaffles++;}
 expect(physicalBaffles).toBeGreaterThanOrEqual(4);
 expect(physical(result.free!).polygons.reduce((s,p)=>s+area(p),0)).toBeGreaterThan(physical(source.free!).polygons.reduce((s,p)=>s+area(p),0)+70);
},60000);
