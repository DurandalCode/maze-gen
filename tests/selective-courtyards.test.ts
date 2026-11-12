import {expect,test,spyOn} from 'bun:test';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {mazeDraft} from '../src/free/json';
import {openSelectiveCourtyards} from '../src/free/selective-courtyards';
import {freeMaze,freeRuntime,physical,validateFree} from '../src/free/layout';
import {auditModuleWalls} from '../src/free/module-origin';
import {freeGroundLengths} from '../src/free/path-limits';
import {area} from '../src/free/geometry';
import {validateParameters} from '../src/core/maze';
// Native geometry from saved 2f54441ff9876015ddd69348. Only its report was
// removed; these narrow, rotated courts were wrongly labelled as needing frames.
const load=async()=>deserialize(await Bun.file(new URL('./fixtures/hybrid-courtyard-regression.json',import.meta.url)).text());
test('saved compact bays become two-door courts without extra frames or unsupported caps',async()=>{
 const source=await load(),before=serialize(source),draft=mazeDraft(source),result=openSelectiveCourtyards(draft,source.parameters.seed+'-selective-v2');
 expect(result.opened.length).toBeGreaterThanOrEqual(3);expect(serialize(source)).toBe(before);expect(result.draft.layout.modules).toEqual(source.free!.modules);expect(result.draft.layout.openings).toEqual(source.free!.openings);
 for(const expected of [4.8335172436,4.4516150237,7.2879391017])expect(result.opened.some(c=>Math.abs(c.area-expected)<1e-6)).toBe(true);
 const maze=freeMaze(result.draft),runtime=freeRuntime(maze),audit=auditModuleWalls(maze.free!);
 expect(validateFree(result.draft)).toEqual([]);expect(audit.issues).toEqual([]);expect(audit.walls.every(w=>w.origins.length>0)).toBe(true);
 for(const court of result.opened){expect(court.doors).toBe(2);expect(court.area).toBeLessThanOrEqual(24);expect(court.span).toBeLessThanOrEqual(3+1e-7);const cell=runtime.rooms.findIndex(r=>r.id===court.id);expect(runtime.passages[cell]!.length).toBeGreaterThanOrEqual(2);}
 const floorDelta=physical(maze.free!).polygons.reduce((s,p)=>s+area(p),0)-physical(source.free!).polygons.reduce((s,p)=>s+area(p),0);expect(floorDelta).toBeCloseTo(result.opened.reduce((s,c)=>s+c.area+c.spanArea,0),6);
 const lengths=freeGroundLengths(maze);expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);expect(lengths.run).toBeLessThanOrEqual(16+1e-7);
 expect(result.rejected.some(r=>r.area>24&&r.reason.includes('большой зал'))).toBe(true);
 let time=0;const clock=spyOn(performance,'now').mockImplementation(()=>time+=100000);
 try{const replay=openSelectiveCourtyards(mazeDraft(source),source.parameters.seed+'-selective-v2');expect(replay.draft).toEqual(result.draft);expect(replay.opened).toEqual(result.opened);}finally{clock.mockRestore();}
},30000);
test('the new courtyard policy is explicit and old recipes remain valid',async()=>{
 const source=await load();expect(source.parameters.freeCourtyardPolicy).toBeUndefined();expect(()=>validateParameters(source.parameters)).not.toThrow();
 expect(()=>validateParameters({...source.parameters,freeCourtyardPolicy:'selective-v2'})).not.toThrow();expect(()=>validateParameters({...source.parameters,freeCavityMaze:false,freeCourtyardPolicy:'selective-v2'})).toThrow('Выборочные дворы');
});
