import {expect,test} from 'bun:test';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {densifyCourtyards} from '../src/free/dense-courtyards';
import {freeMaze,freeRuntime,physical,validateFree} from '../src/free/layout';
import {area} from '../src/free/geometry';
import {auditModuleWalls} from '../src/free/module-origin';
import {freeGroundLengths} from '../src/free/path-limits';
import {validateParameters} from '../src/core/maze';
test('remaining large bays gain real crosslinks and smaller courts without compressing the accepted framework',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/hybrid-selective-v2-regression.json',import.meta.url)).text()),before=serialize(source);
 const result=densifyCourtyards(mazeDraft(source),source.parameters.seed+'-dense-v3');
 expect(serialize(source)).toBe(before);expect(result.additions.reduce((s,a)=>s+a.area,0)).toBeGreaterThan(70);
 expect(result.additions.reduce((s,a)=>s+a.modules,0)).toBe(3);expect(result.additions.filter(a=>a.doors===2)).toHaveLength(3);
 for(const module of source.free!.modules)expect(result.draft.layout.modules.find(m=>m.id===module.id)).toEqual(module);
 expect(result.draft.layout.openings).toEqual(source.free!.openings);
 const maze=freeMaze(result.draft),runtime=freeRuntime(maze),audit=auditModuleWalls(maze.free!);
 expect(validateFree(result.draft)).toEqual([]);expect(audit.issues).toEqual([]);expect(audit.walls.every(w=>w.origins.length)).toBe(true);
 const original=new Set(source.free!.modules.map(m=>m.id));
 for(const module of maze.free!.modules.filter(m=>!original.has(m.id))){expect(['2x2','2x6']).toContain(module.type);expect(module.frameOnly).not.toBe(true);const cell=runtime.rooms.findIndex(r=>r.id===module.id);expect(runtime.passages[cell]!.length).toBeGreaterThanOrEqual(2);}
 for(const court of result.additions.filter(a=>a.doors)){expect(court.area).toBeLessThanOrEqual(24);expect(court.area).toBeGreaterThan(2.8);}
 const addedFloor=physical(maze.free!).polygons.reduce((s,p)=>s+area(p),0)-physical(source.free!).polygons.reduce((s,p)=>s+area(p),0);
 expect(addedFloor).toBeCloseTo(result.additions.reduce((s,a)=>s+a.area,0),6);
 const lengths=freeGroundLengths(maze);expect(lengths.run).toBeLessThan(freeGroundLengths(source).run);expect(lengths.run).toBeLessThan(10);expect(lengths.straight).toBeLessThanOrEqual(8);
 expect(()=>validateParameters({...source.parameters,freeCourtyardPolicy:'dense-v3'})).not.toThrow();
 // Keep version v2 valid: loading its recipe must not opt in to a new search.
 expect(source.parameters.freeCourtyardPolicy).toBe('selective-v2');
},30000);
