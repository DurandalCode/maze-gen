import {test,expect} from 'bun:test';
import {optionalDistricts,districtAttachment} from '../src/core/optional-districts';
import {sideDistricts} from '../src/analysis/side-districts';
import {emptyMaze,connect} from '../src/core/maze';
import {generate} from '../src/generators/generate';
import {corridorNavigation} from '../src/core/corridor-navigation';
import {domainOf} from '../src/core/domain';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {DEFAULT_DESIGN_LIMITS,validateParameters} from '../src/core/maze';
import {effectiveLimits} from '../src/core/design-limits';
function fixture(spread=false){
 const m=emptyMaze({columns:5,rows:5,corridorWidth:2,algorithm:'backtracker',seed:'district',extraConnections:1});
 for(let c=0;c<4;c++)connect(m,c,c+1);
 const path=[5,6,7,8,9,14,13,12,11,10,15,16,17,18,19,24,23,22,21,20];for(let i=1;i<path.length;i++)connect(m,path[i-1]!,path[i]!);
 connect(m,spread?0:1,spread?5:6);connect(m,spread?4:2,spread?9:7);m.exit={cell:4,side:'east'};m.portals=[m.entrance,m.exit];return m;
}
test('optional components include a pendant loop as one whole district and ignore inactive islands',()=>{
 const graph=[[1],[0,2,3,4],[1],[1,4],[1,3],[]],r=optionalDistricts(graph,[0,1,2,3,4],[0,1,2]);expect(r).toHaveLength(1);expect(r[0]!.cells.sort()).toEqual([3,4]);expect(r[0]!.gates).toEqual([1]);expect(r[0]!.entries).toHaveLength(2);
});
test('a large cold district with two nearby route approaches is detected, while a distributed bypass is not',()=>{
 const heat=new Float64Array(25);for(let i=0;i<5;i++)heat[i]=1;
 const local=sideDistricts(fixture(),heat);expect(local.problemCount).toBe(1);const d=local.districts[0]!;
 expect(d.singleEntry).toBe(false);expect(d.entryCount).toBe(2);expect(d.gateSpread).toBe(2);expect(d.routeSpan).toBe(2);expect(d.area).toBe(80);expect(d.coldArea).toBe(80);expect(d.sideward).toBe(true);expect(local.largestProblemArea).toBe(80);
 const distributed=sideDistricts(fixture(true),heat);expect(distributed.problemCount).toBe(0);expect(distributed.districts[0]!.localized).toBe(false);
});
test('geometry alone is not a coldspot, and exploration or a small terminal area removes the penalty',()=>{
 const m=fixture();expect(sideDistricts(m).assessed).toBe(false);expect(sideDistricts(m).problemCount).toBe(0);expect(sideDistricts(m,new Float64Array(25).fill(1)).problemCount).toBe(0);
 const tiny=emptyMaze({columns:2,rows:2,corridorWidth:2,algorithm:'prim',seed:'tiny',extraConnections:0});connect(tiny,0,1);connect(tiny,0,2);connect(tiny,2,3);tiny.exit={cell:1,side:'east'};expect(sideDistricts(tiny,new Float64Array(4)).problemCount).toBe(0);
});
test('proximity of gates does not penalize a district that bypasses a long reference-route section',()=>{
 const r=districtAttachment({x1:0,x2:40,z1:0,z2:40},[{x:38,z:30,routeDistance:0},{x:38,z:32,routeDistance:90}]);expect(r.localized).toBe(false);
});
test('physical area and source-cell overlay agree with semantic corridor analysis',()=>{
 const m=generate({generationType:'corridor',columns:18,rows:18,moduleSize:2,corridorWidth:2,algorithm:'backtracker',seed:'SIDE-PROJECTION',extraConnections:2}),g=corridorNavigation(m),fine=new Float64Array(m.passages.length).fill(.05),rooms=new Float64Array(g.passages.length).fill(.05),a=sideDistricts(m,fine),b=sideDistricts(g,rooms);
 expect(a.largestProblemArea).toBeCloseTo(b.largestProblemArea);expect(a.problemArea).toBeCloseTo(b.problemArea);expect(a.districts.reduce((s,r)=>s+r.area,0)).toBeCloseTo(b.districts.reduce((s,r)=>s+r.area,0));
 for(const r of a.districts){const area=r.cells.reduce((s,c)=>{const q=domainOf(m).rectangles[c]!;return s+(q.x2-q.x1)*(q.z2-q.z1);},0);expect(area).toBeCloseTo(r.area);}
});
test('cold-side bound is optional, independently disabled, and validates its stored range',()=>{
 const m=fixture(),design={...DEFAULT_DESIGN_LIMITS,maxForcedStraight:40,maxForcedRun:100,maxVisibleStraight:24,maxColdRatio:1,maxColdRegion:10000,maxColdSideRatio:0};
 expect(effectiveLimits(m.parameters).maxColdSideRatio).toBe(Infinity);m.parameters={...m.parameters,design};validateParameters(m.parameters);
 const a=analyzePotential(m,{...DEFAULT_ANALYSIS,samples:32},undefined,false);expect(a.sideDistricts.largestProblemArea).toBe(80);expect(a.issues.some(s=>s.includes('слабо разнесёнными'))).toBe(true);
 const b=analyzePotential({...m,parameters:{...m.parameters,design:{...design,disabledLimits:['maxColdSideRatio']}}},{...DEFAULT_ANALYSIS,samples:32},undefined,false);expect(b.issues.some(s=>s.includes('слабо разнесёнными'))).toBe(false);expect(b.sideDistricts.largestProblemArea).toBe(80);
 for(const maxColdSideRatio of [-.1,1.1,NaN])expect(()=>validateParameters({...m.parameters,design:{...design,maxColdSideRatio}})).toThrow();
});
