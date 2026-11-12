import {expect,test,spyOn} from 'bun:test';
import {createHash} from 'node:crypto';
import {freeIdentity} from '../src/free/json';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {generateDenseTraps} from '../src/free/dense-traps';
import {routeTraps} from '../src/analysis/route-traps';
import {trapOverlay} from '../src/ui/trap-overlay';
import {freeGroundLengths,freeGroundRunWitness} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {freeRuntime,physical,validateFree} from '../src/free/layout';
import {mazeDraft} from '../src/free/json';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {area} from '../src/free/geometry';
// The accepted dense0bb29... had no qualified trap: its entire shortest
// route monotonically approached the exit despite many decorative bypasses.
test('dense recipe gains a real landmark trap and substantive choices without compressing its original frames',async()=>{
 const source=deserialize(await Bun.file(new URL('./fixtures/dense-v3-trap-base.json',import.meta.url)).text()),before=serialize(source);
 expect(routeTraps(source).qualifiedCount).toBe(0);
 let time=0;const clock=spyOn(performance,'now').mockImplementation(()=>time+=100000);
 let maze;try{maze=generateDenseTraps(source,1);}finally{clock.mockRestore();}
 expect(createHash('sha256').update(JSON.stringify(freeIdentity(maze))).digest('hex')).toBe('a89671b99a1917d36d5527a3d6547d213bd824eb9ff7b4c4535abf912933e4a1');
 expect(serialize(source)).toBe(before);expect(maze.free!.modules.length).toBeGreaterThanOrEqual(52);
 for(const module of source.free!.modules)expect(maze.free!.modules.find(m=>m.id===module.id)).toEqual(module);
 expect(maze.free!.openings).toEqual(source.free!.openings);expect(maze.roof).toBe(true);
 const traps=routeTraps(maze),overlay=trapOverlay(maze,traps);expect(traps.qualifiedCount).toBeGreaterThanOrEqual(1);expect(overlay.filter(t=>t.kind==='dead-end')).toHaveLength(traps.qualifiedCount);
 for(const trap of traps.candidates.filter(t=>t.qualifies)){expect(trap.falsePathLength).toBeGreaterThanOrEqual(10);expect(trap.falseApproach).toBeGreaterThanOrEqual(6);expect(trap.requiredRetreat).toBeGreaterThanOrEqual(8);expect(trap.deadEndVisible).toBe(false);expect(trap.entryProbability).toBeGreaterThanOrEqual(.15);}
 const arms=maze.free!.modules.filter(m=>m.id.startsWith('route-arm-'));expect(arms.filter(m=>m.type==='2x6').length).toBeGreaterThanOrEqual(2);expect(arms.filter(m=>m.type==='2x2').length).toBeGreaterThanOrEqual(2);
 const r=freeRuntime(maze);for(const module of arms.filter(m=>m.type==='2x2'))expect(r.passages[r.rooms.findIndex(room=>room.id===module.id)]!.length).toBe(2);
 const n=freeGroundLengths(maze),witness=freeGroundRunWitness(maze);expect(n.straight).toBeLessThanOrEqual(8);expect(n.run).toBeLessThanOrEqual(16);expect(witness.length).toBeCloseTo(n.run,6);expect(witness.rooms.length).toBeGreaterThan(1);
 expect(validateFree(mazeDraft(maze))).toEqual([]);expect(auditModuleWalls(maze.free!).issues).toEqual([]);
 const gates=maze.free!.openings.filter(o=>o.id===maze.free!.entrance||o.id===maze.free!.exit);expect(selectOppositePortals(maze.free!,gates,Math.min(...gates.map(g=>g.width))).length).toBeGreaterThan(0);
 expect(physical(maze.free!).polygons.reduce((s,p)=>s+area(p),0)).toBeGreaterThan(physical(source.free!).polygons.reduce((s,p)=>s+area(p),0)+60);
},30000);
