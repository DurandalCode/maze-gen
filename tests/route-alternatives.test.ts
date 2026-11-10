import {expect,test} from 'bun:test';
import {connect,emptyMaze,validateParameters,DEFAULT_DESIGN_LIMITS} from '../src/core/maze';
import {routeAlternatives,connectionRouteGain} from '../src/analysis/route-alternatives';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {serialize,deserialize} from '../src/persistence/maze-json';
function fixture(){
 const m=emptyMaze({columns:4,rows:3,corridorWidth:2,algorithm:'prim',seed:'alternatives',extraConnections:0});
 m.entrance={cell:0,side:'west'};m.exit={cell:3,side:'east'};
 for(const [a,b] of [[0,1],[1,2],[2,3],[1,5],[5,4],[4,8],[8,9],[9,10],[10,6],[6,7],[7,11]] as const)connect(m,a,b);
 return m;
}
test('a tree route has no alternative and lengths use physical metres',()=>{
 const r=routeAlternatives(fixture());expect(r.routeLength).toBe(6);expect(r.unavoidableRatio).toBe(1);expect(r.longestUnavoidableRun).toBe(6);expect(r.alternativeSections).toBe(0);
});
test('a pendant false loop does not provide a route alternative',()=>{
 const m=fixture();expect(connectionRouteGain(m,4,5)).toBe(0);expect(connectionRouteGain(m,5,9)).toBe(0);
 connect(m,5,9);expect(routeAlternatives(m).unavoidableRatio).toBe(1);
});
test('a route-rejoining loop counts only the route edges it bypasses',()=>{
 const m=fixture();expect(connectionRouteGain(m,2,6)).toBe(2);
 connect(m,2,6);const r=routeAlternatives(m);expect(r.alternativeLength).toBe(2);expect(r.unavoidableLength).toBe(4);expect(r.alternativeSections).toBe(1);expect(r.longestUnavoidableRun).toBe(2);
});
test('single cells have no centre-to-centre route to score',()=>{
 const m=emptyMaze({columns:1,rows:1,corridorWidth:2,algorithm:'prim',seed:'single',extraConnections:0});
 expect(routeAlternatives(m).routeLength).toBe(0);expect(routeAlternatives(m).unavoidableRatio).toBe(0);
});
test('iterative bridge traversal supports a large snake without stack overflow',()=>{
 const m=emptyMaze({columns:100,rows:100,corridorWidth:2,algorithm:'prim',seed:'snake',extraConnections:0});
 const cells=Array.from({length:100},(_,z)=>Array.from({length:100},(_,i)=>z*100+(z%2?99-i:i))).flat();
 for(let i=1;i<cells.length;i++)connect(m,cells[i-1]!,cells[i]!);
 m.exit={cell:cells.at(-1)!,side:'south'};expect(routeAlternatives(m).routeLength).toBe(19998);expect(routeAlternatives(m).unavoidableRatio).toBe(1);
});
test('optional route cap roundtrips without changing legacy defaults',()=>{
 const m=fixture();m.parameters.design={...DEFAULT_DESIGN_LIMITS,maxUnavoidableRouteRatio:.7};
 expect(deserialize(serialize(m)).parameters.design?.maxUnavoidableRouteRatio).toBe(.7);
 expect(DEFAULT_DESIGN_LIMITS.maxUnavoidableRouteRatio).toBeUndefined();
 for(const limit of [-1,1.01,NaN,Infinity])expect(()=>validateParameters({...m.parameters,design:{...m.parameters.design!,maxUnavoidableRouteRatio:limit}})).toThrow();
});

test('a hard route cap distinguishes a pendant cycle from an on-route bypass',()=>{
 for(const [edge,hasIssue] of [[[5,9],true],[[2,6],false]] as const){
  const m=fixture();connect(m,edge[0],edge[1]);m.parameters.extraConnections=1;
  m.parameters.design={...DEFAULT_DESIGN_LIMITS,maxUnavoidableRouteRatio:.7};
  const result=analyzePotential(m,{...DEFAULT_ANALYSIS,samples:16},undefined,false);
  expect(result.issues.some(issue=>issue.includes('альтернативного обхода'))).toBe(hasIssue);
 }
 const tree=fixture();tree.parameters.design={...DEFAULT_DESIGN_LIMITS,maxUnavoidableRouteRatio:0};
 expect(analyzePotential(tree,{...DEFAULT_ANALYSIS,samples:16},undefined,false).issues.some(issue=>issue.includes('альтернативного обхода'))).toBe(false);
});
test('module and gap centres use their actual physical spacing',()=>{
 const m=emptyMaze({columns:3,rows:1,moduleSize:2,corridorWidth:1,algorithm:'prim',seed:'physical-spacing',extraConnections:0});
 for(let i=0;i<4;i++)connect(m,i,i+1);
 expect(routeAlternatives(m).routeLength).toBe(6);
});
