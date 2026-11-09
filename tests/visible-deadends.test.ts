import {expect,test} from 'bun:test';
import {emptyMaze,connect,type Maze} from '../src/core/maze';
import {withPortals} from '../src/core/portals';
import {visibleDeadEnd,visibleDeadEnds,obviousForkDeadEnds,recognitionAdjustedColdspots} from '../src/analysis/visible-deadends';
import {analyzeColdspots,DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {decisionModel,decisionScore,choiceProbabilities} from '../src/analysis/decision-model';
import {prepareNavigation,prepareOutline} from '../src/analysis/navigation';
import {analyzePotential} from '../src/analysis/potential-difficulty';
function fixture():Maze{
 const m=emptyMaze({columns:5,rows:3,corridorWidth:2,algorithm:'prim',seed:'visible-v8',extraConnections:0,shape:{kind:'grid-rectangles',rectangles:[
  {x:0,z:1,width:5,height:1,operation:'add'},{x:1,z:0,width:1,height:1,operation:'add'},{x:3,z:2,width:2,height:1,operation:'add'},{x:3,z:0,width:2,height:1,operation:'add'}
 ]}});
 for(let c=5;c<9;c++)connect(m,c,c+1);connect(m,6,1);connect(m,8,13);connect(m,13,14);connect(m,9,4);connect(m,4,3);
 return withPortals(m,[{cell:5,side:'west'},{cell:3,side:'north'}]);
}
test('only a completely visible blind branch is exhausted; a bend, side opening and portal are not',()=>{
 const m=fixture(),ctx=prepareNavigation(m);prepareOutline(m,ctx);
 expect(visibleDeadEnd(m,6,1,ctx)?.cells).toEqual([1]);
 expect(visibleDeadEnd(m,8,13,ctx)).toBeNull();
 expect(visibleDeadEnd(m,13,14,ctx)?.cells).toEqual([14]);
 expect(visibleDeadEnd(m,5,6,ctx)).toBeNull();expect(visibleDeadEnd(m,8,9,ctx)).toBeNull();
 const model=decisionModel(m,ctx),features=model.features(6,1,ctx.centers[5],'outline');
 expect(features.exhausted).toBe(true);expect(decisionScore(features,3,1,1.5,1)).toBe(-Infinity);
 expect(choiceProbabilities([-Infinity,0])).toEqual([0,1]);expect(choiceProbabilities([-Infinity,-Infinity])).toEqual([0,0]);
});
test('directed search never queues a visible dead end for later, but still investigates hidden continuations',()=>{
 const m=fixture();
 for(const profile of ['compass','outline'] as const)for(const decisionMode of ['local','frontier'] as const){
  const h=analyzeColdspots(m,{...DEFAULT_ANALYSIS,profile,decisionMode,samples:256});
  expect(h.probability[1]).toBe(0);expect(h.visits[1]).toBe(0);
  expect(h.probability[14]).toBe(0);expect(h.probability[13]).toBeGreaterThan(0);
  expect(h.probability[3]).toBe(1);
 }
 const explorer=analyzeColdspots(m,{...DEFAULT_ANALYSIS,profile:'explorer',samples:256});
 expect(explorer.probability[1]).toBeGreaterThan(0);
});
test('recognized terminal area is a deduplicated physical union and remains distinct from a hidden branch',()=>{
 const m=fixture(),v=visibleDeadEnds(m);
 expect(v.branches).toHaveLength(2);expect([...v.cells].sort((a,b)=>a-b)).toEqual([1,14]);expect(v.area).toBe(8);expect(v.ratio).toBeCloseTo(2/10);
 const p=analyzePotential(m,{...DEFAULT_ANALYSIS,samples:16},undefined,false);
 expect(p.obviousDeadEnds).toEqual({count:1,area:4,ratio:1/10});
 expect(obviousForkDeadEnds(m).branches.map(b=>b.end)).toEqual([1]);
 const heat=analyzeColdspots(m,{...DEFAULT_ANALYSIS,samples:256}),effective=recognitionAdjustedColdspots(m,heat.probability,.2);
 expect(heat.probability[14]).toBe(0);expect(effective.recognizedTerminalArea).toBeGreaterThan(0);
 expect(effective.coldArea).toBeLessThan(heat.coldArea);
 const unknown=new Float64Array(m.passages.length);
 expect(recognitionAdjustedColdspots(m,unknown,.2).recognizedTerminalArea).toBe(0);
 const one=emptyMaze({columns:1,rows:1,corridorWidth:2,algorithm:'prim',seed:'one',extraConnections:0});
 expect(visibleDeadEnds(one).area).toBe(0);
});
test('quality separates a recognized terminal after a bend from an unknown cold branch without repainting heat',()=>{
 const m=fixture(),p=analyzePotential(m,{...DEFAULT_ANALYSIS,samples:256},undefined,false);
 expect(p.rawWorstColdRatio).toBeGreaterThanOrEqual(p.worstColdRatio);
 expect(p.rawWorstColdRegion).toBeGreaterThanOrEqual(p.worstColdRegion);
 for(const scenario of p.scenarios){
  expect(scenario.coldArea-scenario.effectiveColdArea).toBeCloseTo(scenario.recognizedTerminalArea);
  expect(scenario.effectiveLargestColdArea).toBeLessThanOrEqual(scenario.largestColdArea);
 }
 const probability=new Float64Array(m.passages.length);probability[13]=1;
 const before=[...probability],known=recognitionAdjustedColdspots(m,probability,.2);
 expect(known.recognizedTerminalArea).toBe(4);expect([...probability]).toEqual(before);
 probability[13]=.19;
 expect(recognitionAdjustedColdspots(m,probability,.2).recognizedTerminalArea).toBe(0);
});
