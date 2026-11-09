import {expect,test} from 'bun:test';
import {generate} from '../src/generators/generate';
import {guardedMaze} from '../src/generators/guarded';
import {jointRepair} from '../src/generators/joint-repair';
import {jointGenerate} from '../src/generators/joint-generate';
import {shapeAlternatives} from '../src/generators/shape-alternatives';
import {DEFAULT_DESIGN_LIMITS,validateParameters} from '../src/core/maze';
import {domainOf} from '../src/core/domain';
import {withPortals} from '../src/core/portals';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {corridorQuality} from '../src/analysis/corridor-quality';
import {DEFAULT_ANALYSIS,analyzeColdspots} from '../src/analysis/coldspots';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {topologyId} from '../server/store';
import {optimizeColdspots} from '../src/analysis/optimize';
const loose={...DEFAULT_DESIGN_LIMITS,maxForcedStraight:40,maxForcedRun:100,maxVisibleStraight:24,maxColdRatio:1,maxColdRegion:10000};
function fixture(){return guardedMaze(generate({columns:7,rows:7,corridorWidth:2,algorithm:'prim',seed:'quality',extraConnections:0}),'privacy',true).maze;}
test('quality limits are simultaneous and a good score cannot compensate for a broken bound',()=>{
 const base=fixture(),maze={...base,parameters:{...base.parameters,design:{...loose,maxColdRatio:0,maxColdRegion:0,maxVisibleStraight:2}}};
 const p=analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:64,profile:'explorer'},undefined,false);
 expect(p.scenarios.map(s=>s.strategy)).toEqual(['adaptive','follow','avoid']);
 expect(p.worstColdRatio).toBeGreaterThan(0);expect(p.worstColdRegion).toBeGreaterThan(0);
 expect(p.eligible).toBe(false);
 expect(p.issues.some(s=>s.includes('видимая прямая'))).toBe(true);
 expect(p.issues.some(s=>s.includes('холодная доля'))).toBe(true);
 expect(p.issues.some(s=>s.includes('колдспот'))).toBe(true);
});
test('static perspectives are measured beyond the player model sight limit',()=>{
 const maze=generate({columns:20,rows:1,corridorWidth:2,algorithm:'prim',seed:'long',extraConnections:0});
 expect(corridorQuality(maze).longestVisibleStraight).toBeGreaterThan(24);
});
test('neither optimization objective may discard joint limits to report an improvement',()=>{
 const base=fixture(),maze={...base,parameters:{...base.parameters,design:{...loose,maxColdRatio:0,maxColdRegion:0}}};
 for(const objective of ['coldspots','exploration'] as const){
   const result=optimizeColdspots(maze,{...DEFAULT_ANALYSIS,samples:16},'walls',2,undefined,objective);
   expect(result.changed).toBe(false);expect(result.maze).toEqual(maze);
 }
});
test('a coarse heat overlay cannot replace the higher precision joint assessment',()=>{
 const base=fixture(),maze={...base,parameters:{...base.parameters,design:loose}},options={...DEFAULT_ANALYSIS,samples:64,routeMemory:1};
 const coarse=analyzeColdspots(maze,{...options,samples:16});
 expect(analyzePotential(maze,options,coarse,false)).toEqual(analyzePotential(maze,options,undefined,false));
});
test('limits roundtrip, validate and do not change the identity of a physical topology',()=>{
 const base=fixture(),maze={...base,parameters:{...base.parameters,design:loose}};
 expect(deserialize(serialize(maze))).toEqual(maze);expect(topologyId(maze)).toBe(topologyId(base));
 expect(()=>validateParameters({...base.parameters,design:{...loose,maxColdRatio:NaN}})).toThrow();
 expect(()=>validateParameters({...base.parameters,design:{...loose,maxModuleGrowth:-1}})).toThrow();
 expect(()=>validateParameters({...base.parameters,design:loose,extraConnections:1})).not.toThrow();
});
test('repair retains a passing design, is deterministic and never mutates its source',()=>{
 const base=fixture(),maze={...base,parameters:{...base.parameters,design:loose}},snapshot=structuredClone(maze);
 const candidates=jointRepair(maze,'repair-test',8);
 expect(candidates.length).toBeGreaterThan(0);expect(maze).toEqual(snapshot);
 for(const candidate of candidates)expect(analyzePotential(candidate,{...DEFAULT_ANALYSIS,samples:64},undefined,false).eligible).toBe(true);
 expect(jointRepair(maze,'repair-test',8)).toEqual(candidates);
 expect(jointGenerate(maze)).toEqual(maze);
 const impossible={...maze,parameters:{...maze.parameters,design:{...loose,maxForcedRun:2,maxForcedStraight:2,maxVisibleStraight:2,maxColdRatio:0,maxColdRegion:0}}};
 expect(jointRepair(impossible,'no-relaxation',8)).toEqual([]);
});
test('shape fallback is explicit, keeps roof and endpoints and respects the growth budget',()=>{
 const parameters={columns:9,rows:9,moduleSize:2,corridorWidth:2,algorithm:'prim' as const,seed:'shape-fallback',extraConnections:0,shape:{kind:'grid-rectangles' as const,rectangles:[{x:0,z:0,width:9,height:9,operation:'add' as const},{x:3,z:3,width:3,height:6,operation:'subtract' as const}]}};
 const raw=generate(parameters),base=withPortals({...raw,roof:true,entrance:{cell:272,side:'south'},exit:{cell:288,side:'south'}},[{cell:272,side:'south'},{cell:288,side:'south'}]);
 expect(shapeAlternatives(base)).toEqual([]);
 const alternatives=shapeAlternatives({...base,parameters:{...parameters,design:{...loose,allowReshape:true}}});
 expect(alternatives.length).toBeGreaterThan(0);
 const counts=alternatives.map(m=>domainOf(m).modules.reduce((a,b)=>a+b,0));
 expect(counts[0]).toBe(63);
 for(const [i,m] of alternatives.entries()){expect(counts[i]!).toBeGreaterThanOrEqual(63);expect(counts[i]!).toBeLessThanOrEqual(78);expect(m.roof).toBe(true);expect(m.entrance.side).toBe('south');expect(m.exit.side).toBe('south');expect(deserialize(serialize(m))).toEqual(m);}
});
