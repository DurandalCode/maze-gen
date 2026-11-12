import {expect,test} from 'bun:test';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {crosslinkLongRoute} from '../src/free/route-crosslinks';
import {freeGroundLengths,freeGroundRunWitness,freeGroundStraightWitness} from '../src/free/path-limits';
import {connectionGeometry,freeMaze,freeRuntime} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {distance,ends} from '../src/free/geometry';
import {shortestPath} from '../src/core/pathfinding';

test('a crowded return-sector run gets a real supported crosslink without bypassing protected trap forks',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-return-blocked-run.json',import.meta.url)).text()),before=serialize(source),witness=freeGroundRunWitness(source),ids=[...new Set(witness.rooms)];
 ids.sort((a,b)=>Math.abs(witness.rooms.indexOf(a)-witness.rooms.length/2)-Math.abs(witness.rooms.indexOf(b)-witness.rooms.length/2));
 const protectedForks=['dense-apex-5fb50826-7-frame-1','m-144','cavity-module-ecff7d16-331'];
 const draft=crosslinkLongRoute(mazeDraft(source),ids,false,'regression',protectedForks);expect(draft).toBeDefined();expect(serialize(source)).toBe(before);
 const maze=freeMaze(draft!,false),link=draft!.layout.connections.at(-1)!,g=connectionGeometry(draft!.layout,link);
 expect(draft!.layout.modules).toEqual(source.free!.modules);expect(draft!.layout.spaces).toEqual(source.free!.spaces);
 expect(draft!.layout.connections).toHaveLength(source.free!.connections.length+1);
 expect(Math.max(...g.sides.map(side=>distance(...ends(side))))).toBeLessThanOrEqual(3);
 expect(freeGroundLengths(maze).run).toBeLessThan(witness.length-.1);expect(auditModuleWalls(draft!.layout).issues).toEqual([]);
 const runtime=freeRuntime(maze),route=shortestPath(maze).map(i=>runtime.rooms[i]!.id);for(const fork of protectedForks)expect(route).toContain(fork);
 // The independent 11m straight remains visible to the physical metric. A
 // successful crosslink is not falsely advertised as a fully repaired map.
 expect(freeGroundStraightWitness(maze).length).toBeGreaterThan(8);
},25000);
