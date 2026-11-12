import {beforeAll,expect,test} from 'bun:test';
import fixture from './fixtures/vortex-deep-reservation.json';
import {deepHybridVortexParameters,hybridVortexParameters,continuousVortexParameters,chaoticVortexParameters,leaveContinuousVortex} from '../src/free/vortex-parameters';
import {reserveHybridVortex,separateHybridBlindBranch,fitHybridTurningFrames} from '../src/free/vortex-hybrid-reservation';
import {inspectHybridVortexDepth} from '../src/free/vortex-hybrid-depth';
import {validateParameters,type Maze} from '../src/core/maze';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {freeGroundLengths} from '../src/free/path-limits';
import {auditModuleWalls} from '../src/free/module-origin';
import {routeTraps} from '../src/analysis/route-traps';
import {physicallyOpen} from '../src/free/cavity-maze';
import {mazeDraft} from '../src/free/json';

const p=deepHybridVortexParameters({columns:70,rows:70,corridorWidth:2,moduleSize:2,seed:'vortex-chaotic-05',algorithm:'prim',extraConnections:0});
let base:Maze,reserved:Maze,initial:string;
beforeAll(()=>{
 base=deserialize(JSON.stringify(fixture.base));initial=serialize(base);
 const pool=fixture.pool as Parameters<typeof reserveHybridVortex>[1];
 reserved=fitHybridTurningFrames(separateHybridBlindBranch(reserveHybridVortex(base,pool)),pool);
 reserved.parameters=p;
},30000);

test('only the explicit deep profile selects64m; old profiles retain60 and16',()=>{
 expect(()=>validateParameters(p)).not.toThrow();
 expect(()=>validateParameters({...p,freeVortexHybrid:false})).toThrow();
 expect(p.design?.maxForcedRun).toBe(64);
 expect(hybridVortexParameters(p).design?.maxForcedRun).toBe(60);
 expect(hybridVortexParameters(p).freeVortexHybridDeep).toBe(false);
 expect(continuousVortexParameters(p).design?.maxForcedRun).toBe(60);
 expect(chaoticVortexParameters(p).design?.maxForcedRun).toBe(16);
 expect(leaveContinuousVortex(p).freeVortexHybridDeep).toBe(false);
});

test('native reservation keeps the spiral frame poses and adds genuine turning frames',()=>{
 expect(serialize(base)).toBe(initial);
 for(const old of base.free!.modules.filter(m=>m.id!=='vortex-central-junction'))expect(reserved.free!.modules.find(m=>m.id===old.id)).toEqual(old);
 expect(reserved.free!.modules.filter(m=>m.id.startsWith('vortex-deep-hub-'))).toHaveLength(3);
 expect(reserved.free!.modules.every(m=>!m.frameOnly&&(m.type==='2x2'||m.type==='2x6'))).toBe(true);
 expect(reserved.free!.preservedPanels).toBeUndefined();
 expect(reserved.free!.supports).toBeUndefined();
 expect(auditModuleWalls(reserved.free!).issues).toEqual([]);
 expect(physicallyOpen(mazeDraft(reserved))).toBe('');
});

test('pure return routes physically enter three real spiral bands by at least10m',()=>{
 const loops=inspectHybridVortexDepth(reserved,{x:35,z:35});
 expect(loops.filter(d=>d.qualifies&&d.pure&&d.inwardExcursion>=10&&d.inwardBandConnections.length>=3)).toHaveLength(2);
 expect(routeTraps(reserved).qualifiedCount).toBe(2);
 const lengths=freeGroundLengths(reserved);
 expect(lengths.straight).toBeLessThanOrEqual(8+1e-7);
 expect(lengths.run).toBeLessThanOrEqual(64+1e-7);
 expect(serialize(deserialize(serialize(reserved)))).toBe(serialize(reserved));
});
