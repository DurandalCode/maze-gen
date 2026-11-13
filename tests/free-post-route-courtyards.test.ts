import {expect,test} from 'bun:test';
import fixture from './fixtures/post-route-organic-base.json';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {generateFree} from '../src/free/generate';
import {cavityInventory} from '../src/free/cavity-inventory';
import {freeRuntime} from '../src/free/layout';
import {area,centroid,distance} from '../src/free/geometry';
import {freeGroundLengths} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {CollisionWorld} from '../src/simulation/collisions';
import {topologyId} from '../server/store';

test('completed organic route fills its late cavities without rebuilding the accepted composition',()=>{
 const source=deserialize(JSON.stringify(fixture)),snapshot=serialize(source),p={...source.parameters,freePassagePattern:'organic-sectors-v2' as const},m=generateFree(p,source),report=m.free!.cavityReport!.postRoute!;
 expect(report.addedFloorArea).toBeGreaterThan(60);expect(report.openedCourts).toBeGreaterThanOrEqual(5);expect(report.addedModules).toBeGreaterThan(0);
 expect(m.free!.modules.slice(0,source.free!.modules.length)).toEqual(source.free!.modules);expect(m.free!.walls).toEqual(source.free!.walls);
 expect(report.beforeNegativeArea-report.afterNegativeArea).toBeCloseTo(report.addedFloorArea,7);expect(cavityInventory(m).hullArea).toBeCloseTo(cavityInventory(source).hullArea,7);
 const oldIds=new Set(source.free!.spaces.map(s=>s.id)),courts=m.free!.spaces.filter(s=>s.kind==='hall'&&!oldIds.has(s.id)),centers=courts.map(c=>centroid(c.polygon));
 expect(Math.max(...centers.map(c=>c.x))-Math.min(...centers.map(c=>c.x))).toBeGreaterThan(10);expect(Math.max(...centers.map(c=>c.z))-Math.min(...centers.map(c=>c.z))).toBeGreaterThan(10);
 for(const c of courts){expect(area(c.polygon)).toBeLessThanOrEqual(24+1e-7);expect(m.free!.connections.filter(g=>g.a.room===c.id||g.b.room===c.id).length).toBe(2);}
 expect(auditModuleWalls(m.free!).issues).toEqual([]);const lengths=freeGroundLengths(m);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);
 const runtime=freeRuntime(m),world=new CollisionWorld(runtime.obstacles);for(const path of [...runtime.edgePaths.values(),...runtime.portalPaths.values()])for(let i=1;i<path.length;i++)expect(distance(world.move(path[i-1]!,{x:path[i]!.x-path[i-1]!.x,z:path[i]!.z-path[i-1]!.z}),path[i]!)).toBeLessThan(1e-5);
 expect(serialize(source)).toBe(snapshot);const wire=serialize(m),roundtrip=deserialize(wire);expect(serialize(roundtrip)).toBe(wire);expect(serialize(generateFree(p,roundtrip))).toBe(wire);
 const without=structuredClone(roundtrip);delete without.free!.postRouteSource;expect(topologyId(without)).toBe(topologyId(m));
 const nested=JSON.parse(wire);nested.layout.postRouteSource.layout.postRouteSource=structuredClone(nested.layout.postRouteSource);expect(()=>deserialize(JSON.stringify(nested))).toThrow('Вложенный источник');
},60000);
