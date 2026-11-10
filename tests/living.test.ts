import {expect,test} from 'bun:test';
import {DEFAULT_DESIGN_LIMITS,validateParameters,type Parameters} from '../src/core/maze';
import {defaultDesign,effectiveLimits} from '../src/core/design-limits';
import {generate,generateBase} from '../src/generators/generate';
import {contourStructure,contourQuality} from '../src/generators/contours';
import {exchangeLivingWall} from '../src/generators/living';
import {metrics} from '../src/core/metrics';
import {domainOf} from '../src/core/domain';
import {neighbors} from '../src/core/maze';
import {random} from '../src/core/random';
import {shortestPath,routePoints} from '../src/core/pathfinding';
import {deserialize,serialize} from '../src/persistence/maze-json';
import {browserTopologyId} from '../src/persistence/identity';
import {topologyId} from '../server/store';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {optimizeColdspots} from '../src/analysis/optimize';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {cellCenter} from '../src/core/maze';
import {walls as wallsOf} from '../src/core/maze';
const parameters:Parameters={generationType:'living',columns:9,rows:9,moduleSize:2,corridorWidth:2,algorithm:'backtracker',seed:'living-proof',extraConnections:0};
const shape=(columns:number,rows:number,subtract:{x:number;z:number;width:number;height:number}[])=>({kind:'grid-rectangles' as const,rectangles:[{x:0,z:0,width:columns,height:rows,operation:'add' as const},...subtract.map(r=>({...r,operation:'subtract' as const}))]});
test('concentric rectangle retains long contour arcs, with one connected seeded tree',()=>{
 const m=generate(parameters),q=contourQuality(m);expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(0);expect(q.layers).toBe(9);expect(q.ratio!).toBeGreaterThan(.9);
 expect(generate(parameters)).toEqual(m);expect(generate({...parameters,seed:'another'}).passages).not.toEqual(m.passages);
 expect(generate({...parameters,algorithm:'prim'}).passages).toEqual(m.passages);
 const s=contourStructure(m);expect(s.depth[0]).toBe(0);expect(s.depth[144]).toBe(8);
});
test('any supported connected shape, narrow necks, holes and minimal domains work in both constructions',()=>{
 const examples=[{columns:1,rows:1},{columns:1,rows:8},{columns:8,rows:1},
  {columns:7,rows:7,shape:shape(7,7,[{x:3,z:3,width:4,height:4}])},
  {columns:7,rows:7,shape:shape(7,7,[{x:0,z:3,width:2,height:4},{x:5,z:3,width:2,height:4}])},
  {columns:9,rows:9,shape:shape(9,9,[{x:3,z:3,width:3,height:6}])},
  {columns:9,rows:9,shape:shape(9,9,[{x:3,z:3,width:3,height:3}])}];
 for(const moduleSize of [undefined,2])for(const example of examples){
  const m=generate({...parameters,...example,moduleSize}),d=domainOf(m),q=contourQuality(m);
  expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(0);expect(q.certified).toBe(true);expect(shortestPath(m).length).toBeGreaterThan(0);
  for(let a=0;a<m.passages.length;a++)for(const b of m.passages[a]!){expect(d.active[a]).toBe(1);expect(d.active[b]).toBe(1);expect(neighbors(m,a)).toContain(b);expect(m.passages[b]!).toContain(a);}
  expect(deserialize(serialize(m))).toEqual(m);expect(wallsOf(m).length).toBeGreaterThan(0);
  const world=new CollisionWorld([...wallsOf(m),...supportColliders(m)]);
  for(const a of d.cells)for(const b of m.passages[a]!)if(b>a){const from=cellCenter(m,a),to=cellCenter(m,b),actual=world.move(from,{x:to.x-from.x,z:to.z-from.z});expect(Math.hypot(actual.x-to.x,actual.z-to.z)).toBeLessThan(1e-5);}
 }
});
test('hole boundaries start at depth zero and disconnected inner layers still connect',()=>{
 const m=generate({...parameters,shape:shape(9,9,[{x:3,z:3,width:3,height:3}])}),s=contourStructure(m);
 for(const edge of domainOf(m).boundary)expect(s.depth[edge.portal.cell]).toBe(0);
 expect(metrics(m).components).toBe(1);
});
test('additional connections have an exact cycle count and impossible counts fail',()=>{
 for(const extraConnections of [1,2,5]){const m=generate({...parameters,extraConnections});expect(metrics(m).cycles).toBe(extraConnections);expect(contourQuality(m).certified).toBe(true);}
 expect(()=>generate({...parameters,columns:1,rows:1,moduleSize:undefined,extraConnections:1})).toThrow('недостаточно');
});
test('generation metadata does not alter topology identity, old defaults or old seed behavior',async()=>{
 const {generationType:_,...classic}=parameters;
 expect(generate(classic)).toEqual(generateBase(classic));
 const living=generate(parameters),tagged={...living,parameters:{...living.parameters,generationType:'classical' as const}};
 expect(topologyId(living)).toBe(topologyId(tagged));expect(await browserTopologyId(living)).toBe(topologyId(living));expect(await browserTopologyId(tagged)).toBe(topologyId(living));
 for(const generationType of ['classical','living'] as const)expect(deserialize(serialize(generate({...classic,generationType}))).parameters.generationType).toBe(generationType);
 expect(deserialize(serialize(generate(classic))).parameters.generationType).toBeUndefined();
 expect(()=>validateParameters({...parameters,generationType:'broken' as never})).toThrow();
});
test('quality bounds toggle individually, persist and keep classical defaults',()=>{
 const design=defaultDesign(true,DEFAULT_DESIGN_LIMITS),m=generate(parameters),p={...parameters,design};
 expect(effectiveLimits(p).maxForcedRun).toBe(Infinity);expect(effectiveLimits(p).maxColdRatio).toBe(.12);expect(effectiveLimits({...parameters,generationType:'classical'}).maxForcedRun).toBe(20);
 expect(DEFAULT_DESIGN_LIMITS.disabledLimits).toBeUndefined();expect(deserialize(serialize({...m,parameters:p})).parameters.design).toEqual(design);
 expect(()=>validateParameters({...p,design:{...design,disabledLimits:['bad' as never]}})).toThrow();
 const disabled={...DEFAULT_DESIGN_LIMITS,disabledLimits:['maxForcedStraight','maxForcedRun','maxVisibleStraight','maxColdRatio','maxColdRegion','maxUnavoidableRouteRatio'] as const};
 const result=analyzePotential({...m,parameters:{...parameters,design:{...disabled,disabledLimits:[...disabled.disabledLimits]}}},{...DEFAULT_ANALYSIS,samples:16},undefined,false);
 expect(result.contours?.certified).toBe(true);expect(result.issues.some(s=>s.includes('превышает предел')||s.includes('холодная')||s.includes('колдспот')||s.includes('видимая прямая'))).toBe(false);
});
test('wall exchanges and both optimization objectives preserve contour style, cycles and source',()=>{
 const base=generate({...parameters,columns:5,rows:5,extraConnections:1}),snapshot=structuredClone(base),rng=random('exchanges');let current=base;
 for(let i=0;i<80;i++){const next=exchangeLivingWall(current,rng);if(next){expect(contourQuality(next).certified).toBe(true);expect(metrics(next).cycles).toBe(1);expect(metrics(next).components).toBe(1);current=next;}}
 for(const objective of ['exploration','coldspots'] as const)for(const method of ['seeds','walls'] as const){const result=optimizeColdspots(base,{...DEFAULT_ANALYSIS,samples:16},method,3,undefined,objective);expect(contourQuality(result.maze).certified).toBe(true);expect(result.maze.parameters.generationType).toBe('living');expect(metrics(result.maze).cycles).toBe(1);if(result.changed)expect(result.afterPotential?.eligible).toBe(true);}
 expect(base).toEqual(snapshot);expect(routePoints(base).length).toBeGreaterThan(1);
});
test('unachievable living requests never mutate the current topology',()=>{
 const base=generate({...parameters,columns:1,rows:1,moduleSize:undefined}),snapshot=structuredClone(base);
 expect(()=>generate({...base.parameters,routeTrapCount:1},base)).toThrow('Текущий лабиринт сохранён');expect(base).toEqual(snapshot);
});
test('ordinary living generation finds a real route trap without a classical template',()=>{
 const p={...parameters,columns:7,rows:9,seed:'living-field',routeTrapCount:1},raw=generate({...p,routeTrapCount:0}),snapshot=structuredClone(raw);
 const m=generate(p);expect(m.parameters).toEqual(p);expect(contourQuality(m).certified).toBe(true);
 expect(analyzePotential(m,{...DEFAULT_ANALYSIS,samples:16},undefined,false).traps.qualifiedCount).toBeGreaterThanOrEqual(1);
 expect(generate(p)).toEqual(m);expect(raw).toEqual(snapshot);
},30000);
test('ordinary living generation finds a genuine large return loop and preserves it on improvement',()=>{
 const p={...parameters,seed:'living-field',loopTrapCount:1,extraConnections:1},m=generate(p),before=analyzePotential(m,{...DEFAULT_ANALYSIS,samples:16},undefined,false);
 expect(before.loops.qualifiedCount).toBeGreaterThanOrEqual(1);expect(before.privacy.certified).toBe(true);expect(contourQuality(m).certified).toBe(true);expect(metrics(m).cycles).toBe(1);
 const improved=optimizeColdspots(m,{...DEFAULT_ANALYSIS,samples:16},'walls',3,undefined,'exploration').maze;
 expect(analyzePotential(improved,{...DEFAULT_ANALYSIS,samples:16},undefined,false).loops.qualifiedCount).toBeGreaterThanOrEqual(1);expect(contourQuality(improved).certified).toBe(true);expect(deserialize(serialize(improved))).toEqual(improved);
},30000);
test('living shape fallback is explicit and recomputes contours within the module budget',async()=>{
 const {shapeAlternatives}=await import('../src/generators/shape-alternatives');
 const base=generate({...parameters,columns:7,rows:9});expect(shapeAlternatives(base)).toEqual([]);
 const enabled={...base,roof:true,parameters:{...base.parameters,design:{...defaultDesign(true,DEFAULT_DESIGN_LIMITS),allowReshape:true,maxModuleGrowth:.1}}};
 const alternatives=shapeAlternatives(enabled);expect(alternatives.length).toBeGreaterThan(0);
 for(const m of alternatives){expect(m.parameters.generationType).toBe('living');expect(m.roof).toBe(true);const count=domainOf(m).modules.reduce((a,b)=>a+b,0);expect(count).toBeGreaterThanOrEqual(63);expect(count).toBeLessThanOrEqual(69);expect(contourQuality(m).certified).toBe(true);expect(contourStructure(m).depth.length).toBe(m.passages.length);}
});
test('large unconstrained workspaces support many cycles without recursive or quadratic search',()=>{
 const m=generate({...parameters,columns:100,rows:100,moduleSize:undefined,extraConnections:1000});
 expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(1000);expect(contourQuality(m).certified).toBe(true);
});
test('joint living quality accepts loose bounds and never relaxes explicit tight bounds',()=>{
 const design={...defaultDesign(true,DEFAULT_DESIGN_LIMITS),maxColdRatio:1,maxColdRegion:10000},p={...parameters,columns:7,rows:9,seed:'living-quality',design};
 const m=generate(p);expect(m.parameters.design).toEqual(design);expect(analyzePotential(m,{...DEFAULT_ANALYSIS,samples:64},undefined,false).eligible).toBe(true);expect(contourQuality(m).certified).toBe(true);
 const impossible={...parameters,columns:1,rows:1,moduleSize:undefined,design:{...DEFAULT_DESIGN_LIMITS,maxForcedRun:2,maxColdRatio:0,maxColdRegion:0}};
 expect(()=>generate(impossible)).toThrow('Текущий лабиринт сохранён');expect(impossible.design.maxForcedRun).toBe(2);
},30000);
test('an open grid cannot pass as living merely because every contour passage is retained',()=>{
 const m=generate(parameters);const passages=m.passages.map((_,c)=>[...neighbors(m,c)]),open={...m,passages},q=contourQuality(open);
 expect(q.ratio).toBe(1);expect(q.separation).toBe(0);expect(q.certified).toBe(false);
 expect(()=>generate({...parameters,extraConnections:contourStructure(m).pairs.length-domainOf(m).cells.length+1})).toThrow('разрушают контуры');
});
test('regeneration transfers explicit portals into a connected living composite target',()=>{
 const p={...parameters,shape:shape(9,9,[{x:5,z:5,width:4,height:4}])},previous=generate(p),d=domainOf(previous),ports=d.boundary.filter(e=>e.portal.side==='north');
 previous.portals=[previous.entrance,ports.at(-1)!.portal];previous.exit=previous.portals[1]!;
 const snapshot=structuredClone(previous),next=generate({...p,seed:'transferred-living'},previous);
 expect(next.entrance).toEqual(previous.entrance);expect(next.exit).toEqual(previous.exit);expect(next.portals).toEqual(previous.portals);expect(metrics(next).components).toBe(1);expect(contourQuality(next).certified).toBe(true);expect(previous).toEqual(snapshot);
});
