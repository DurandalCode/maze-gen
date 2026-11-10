import {expect,test} from 'bun:test';
import {connect,emptyMaze,type Maze} from '../src/core/maze';
import {withPortals} from '../src/core/portals';
import {loopTraps} from '../src/analysis/loop-traps';
import {trapOverlay,trapDetailsAt} from '../src/ui/trap-overlay';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {topologyId} from '../server/store';
import {generate} from '../src/generators/generate';
import {metrics} from '../src/core/metrics';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {criticalWalls} from '../src/analysis/critical-walls';
import {optimizeColdspots} from '../src/analysis/optimize';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {walls,cellCenter} from '../src/core/maze';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
function fixture(scale=2):Maze{
 const m=emptyMaze({columns:9,rows:9,corridorWidth:scale,algorithm:'prim',seed:'loop-fixture',extraConnections:1,loopTrapCount:1,
 shape:{kind:'grid-rectangles',rectangles:[
 {x:2,z:3,width:6,height:6,operation:'add'},{x:3,z:4,width:4,height:4,operation:'subtract'},
 {x:0,z:3,width:2,height:1,operation:'add'},{x:2,z:1,width:1,height:2,operation:'add'},{x:0,z:1,width:2,height:1,operation:'add'},{x:0,z:0,width:1,height:1,operation:'add'}]}});
 const c=(x:number,z:number)=>z*9+x,ring:number[]=[];
 for(let x=2;x<7;x++)ring.push(c(x,3));for(let z=3;z<8;z++)ring.push(c(7,z));
 for(let x=7;x>2;x--)ring.push(c(x,8));for(let z=8;z>3;z--)ring.push(c(2,z));
 for(let i=0;i<ring.length;i++)connect(m,ring[i]!,ring[(i+1)%ring.length]!);
 const route=[c(0,3),c(1,3),c(2,3),c(2,2),c(2,1),c(1,1),c(0,1),c(0,0)];for(let i=1;i<route.length;i++)connect(m,route[i-1]!,route[i]!);
 return withPortals(m,[{cell:c(0,3),side:'west'},{cell:c(0,0),side:'north'}]);
}
test('a return loop has two attractive doors at the same route fork and a distinct continuation',()=>{
 const m=fixture(),snapshot=structuredClone(m),analysis=loopTraps(m);
 expect(metrics(m).components).toBe(1);expect(analysis.qualifiedCount).toBe(1);
 const t=analysis.candidates[0]!;expect(t.fork).toBe(29);expect(t.loop[0]).toBe(t.fork);expect(t.loop.at(-1)).toBe(t.fork);expect(t.length).toBe(40);expect(t.turns).toBe(4);
 expect(t.entryProbabilities.every(p=>p>=.15)).toBe(true);expect(t.correctProbability).toBeLessThanOrEqual(.4);
 for(let i=1;i<t.loop.length;i++)expect(m.passages[t.loop[i-1]!]).toContain(t.loop[i]!);
 const entry=trapOverlay(m).find(t=>t.kind==='loop')!;expect(entry.deadEnds).toEqual([]);expect(entry.label).toBe('К1');expect(trapDetailsAt([entry],t.fork).join()).toContain('возвращают');
 expect(m).toEqual(snapshot);expect(loopTraps(deserialize(serialize(m)))).toEqual(analysis);
 expect(topologyId(m)).toBe(topologyId({...m,parameters:{...m.parameters,loopTrapCount:0}}));
});
test('small rings and cycles with another route to the exit do not qualify as large return traps',()=>{
 expect(loopTraps(fixture(1)).qualifiedCount).toBe(0);
 const m=fixture(),shortcut=withPortals(m,[m.entrance,{cell:8*9+7,side:'south'}]);
 expect(loopTraps(shortcut).qualifiedCount).toBe(0);
 const broken=structuredClone(m);broken.passages[29]=broken.passages[29]!.filter(n=>n!==30);broken.passages[30]=broken.passages[30]!.filter(n=>n!==29);
 expect(loopTraps(broken).qualifiedCount).toBe(0);
 const p=analyzePotential({...broken,parameters:{...broken.parameters,loopTrapCount:1}},{...DEFAULT_ANALYSIS,samples:16},undefined,false);
 expect(p.eligible).toBe(false);expect(p.issues.some(s=>s.includes('Кольцевых ловушек'))).toBe(true);
});
test('loop requirements validate and ordinary generation reports impossible geometry without mutation',()=>{
 const m=fixture();
 for(const loopTrapCount of [-1,1.5,7])expect(()=>deserialize(JSON.stringify({...m,parameters:{...m.parameters,loopTrapCount}}))).toThrow();
 expect(()=>generate({...m.parameters,loopTrapCount:2,extraConnections:1})).toThrow();
 const small={columns:1,rows:1,corridorWidth:2,algorithm:'prim' as const,seed:'too-small',extraConnections:1,loopTrapCount:1};
 expect(()=>generate(small)).toThrow();
});
test('ordinary generation creates a new reproducible return-loop maze while respecting joint limits',()=>{
 const parameters={columns:7,rows:9,corridorWidth:2,moduleSize:2,algorithm:'backtracker' as const,seed:'FIELD-V15-RETURN-LOOP',extraConnections:1,routeTrapCount:0,loopTrapCount:1,
 design:{maxForcedStraight:8,maxForcedRun:16,maxVisibleStraight:12,maxColdRatio:.4,maxColdRegion:64,allowReshape:false,maxModuleGrowth:.25}};
 const prior={...emptyMaze(parameters),roof:true},snapshot=structuredClone(prior),m=generate(parameters,prior);
 expect(m.roof).toBe(true);expect(metrics(m).cycles).toBe(1);expect(metrics(m).components).toBe(1);expect(loopTraps(m).qualifiedCount).toBeGreaterThanOrEqual(1);
 expect(analyzePotential(m,{...DEFAULT_ANALYSIS,samples:2048,routeMemory:1},undefined,false).eligible).toBe(true);
 const protections=criticalWalls(m).filter(w=>w.protections.some(p=>p.kind==='loop'));expect(protections.length).toBeGreaterThan(0);
 const w=protections[0]!,opened=structuredClone(m);connect(opened,w.a,w.b);expect(loopTraps(opened).qualifiedCount).toBe(0);
 const optimized=optimizeColdspots(m,{...DEFAULT_ANALYSIS,samples:16},'walls',3,undefined,'exploration');
 expect(loopTraps(optimized.maze).qualifiedCount).toBeGreaterThanOrEqual(1);expect(metrics(optimized.maze).cycles).toBe(1);
 const world=new CollisionWorld([...walls(m),...supportColliders(m)]);
 for(let c=0;c<m.passages.length;c++)for(const n of m.passages[c]!)if(n>c){const a=cellCenter(m,c),b=cellCenter(m,n),r=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(r.x-b.x,r.z-b.z)).toBeLessThan(1e-5);}
 expect(deserialize(serialize(m))).toEqual(m);expect(prior).toEqual(snapshot);expect(generate(parameters,prior)).toEqual(m);
},60000);

test('legacy loop qualification does not mistake geometrical return for directional credibility',()=>{
 const t=loopTraps(fixture()).candidates[0]!;
 expect(t.geometryQualifies).toBe(true);expect(t.qualifies).toBe(true);
 expect(t.credibility.strongEntry).toBe(false);expect(t.credibility.credible).toBe(false);
 expect(t.credibility.probes).toHaveLength(4);
});
