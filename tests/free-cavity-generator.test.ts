import {expect,test} from 'bun:test';
import {generateFree} from '../src/free/generate';
import {DEFAULT_DESIGN_LIMITS,type Parameters,validateParameters} from '../src/core/maze';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {freeGroundLengths} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {freeRuntime} from '../src/free/layout';
import {topologyId} from '../server/store';
const parameters:Parameters={placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'organic-maximum-13',freeModuleTarget:40,freeJunctionDegree:3,freeAngleSpread:80,freeSpanPolicy:'maximum',freeConnectionSpan:3,freeCavityMaze:true,design:{...DEFAULT_DESIGN_LIMITS,disabledLimits:['maxVisibleStraight']}};
test('ordinary seeded generation produces an editable selective cavity maze and replays its complete ledger',()=>{
 const maze=generateFree(parameters),wire=serialize(maze),report=maze.free!.cavityReport!;expect(maze.free!.preservedPanels).toBeUndefined();expect(report).toBeDefined();expect(report.construction!.addedModules).toBeGreaterThan(0);expect(maze.free!.modules.length).toBe(parameters.freeModuleTarget!+report.construction!.addedModules);expect(report.construction!.openedCourtyards).toBeGreaterThan(0);expect(report.filledArea).toBeGreaterThan(0);const audit=auditModuleWalls(maze.free!);expect(audit.issues).toEqual([]);expect(audit.walls.every(w=>w.origins.length>0)).toBe(true);const runtime=freeRuntime(maze);for(let i=parameters.freeModuleTarget!;i<maze.free!.modules.length;i++){expect(maze.free!.modules[i]!.frameOnly).not.toBe(true);expect(['2x2','2x6']).toContain(maze.free!.modules[i]!.type);expect(runtime.passages[i]!.length).toBeGreaterThanOrEqual(2);}expect(report.regions.every(r=>r.status!=='unprocessed')).toBe(true);expect(report.regions.filter(r=>r.status==='blocked').every(r=>r.reason.length>10)).toBe(true);
 expect(serialize(generateFree(parameters))).toBe(wire);expect(serialize(deserialize(wire))).toBe(wire);const lengths=freeGroundLengths(maze);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);
 const same=deserialize(wire),id=topologyId(same);same.free!.cavityReport!.regions[0]!.reason='Отчёт уточнён без изменения конструкции.';expect(topologyId(same)).toBe(id);
},90000);
test('unsupported cavity combinations explain the requirement without removing existing bridge modes',()=>{
 expect(()=>validateParameters({...parameters,freeBridgeCount:1})).toThrow('без мостов');expect(()=>validateParameters({...parameters,freeRoutePattern:'switchbacks'})).toThrow('органической');expect(()=>validateParameters({...parameters,placementMode:'grid'})).toThrow('свободной');expect(()=>validateParameters({...parameters,freeCavityMaze:false,freeBridgeCount:1,extraConnections:1})).not.toThrow();
});
