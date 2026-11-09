import {expect,test} from 'bun:test';
import {generate} from '../src/generators/generate';
import {pRouteTrapMaze} from '../src/generators/p-route-trap';
import {guardedMaze} from '../src/generators/guarded';
import {bootstrapRouteTraps} from '../src/generators/route-trap-candidates';
import {routeTraps} from '../src/analysis/route-traps';
import {analyzePotential} from '../src/analysis/potential-difficulty';
import {DEFAULT_ANALYSIS} from '../src/analysis/coldspots';
import {metrics} from '../src/core/metrics';
import {emptyMaze,connect,neighbors} from '../src/core/maze';
import {withPortals} from '../src/core/portals';
import {mazePortalPrivacy} from '../src/analysis/portal-privacy';
import {serialize,deserialize} from '../src/persistence/maze-json';
function base(){const m=generate({columns:9,rows:9,corridorWidth:2,moduleSize:2,algorithm:'backtracker',seed:'trap-tests',extraConnections:0,shape:{kind:'grid-rectangles',rectangles:[{x:0,z:0,width:9,height:9,operation:'add'},{x:3,z:3,width:3,height:6,operation:'subtract'}]}});return withPortals({...m,entrance:{cell:272,side:'south'},exit:{cell:288,side:'south'}},[{cell:272,side:'south'},{cell:288,side:'south'}]);}
test('constructive generator produces a paired near-exit trap with a real initial retreat',()=>{
 const m=pRouteTrapMaze(base(),'trap-proof')!,r=routeTraps(m),t=r.best!;
 expect(r.qualifiedCount).toBeGreaterThan(0);
 expect(t.qualifies).toBe(true);expect(t.deadEndVisible).toBe(false);
 expect(t.deadEndDistance).toBe(6);expect(t.falseApproach).toBeGreaterThanOrEqual(8);
 expect(t.requiredRetreat).toBeGreaterThanOrEqual(8);expect(t.awayLength).toBe(t.requiredRetreat);
 expect(t.falsePath[0]).toBe(t.fork);expect(t.correctAwayPath[0]).toBe(t.fork);
 expect(t.falsePath[1]).not.toBe(t.correctAwayPath[1]);
 expect(m.passages[t.deadEnd]).toHaveLength(1);
 expect(t.returnLength).toBe((t.falsePath.length-1)*2);
 expect(metrics(m).components).toBe(1);expect(metrics(m).cycles).toBe(0);
 expect(mazePortalPrivacy(m,false).certified).toBe(true);
 expect(pRouteTrapMaze(base(),'trap-proof')).toEqual(m);
 expect(deserialize(serialize(m))).toEqual(m);
});
test('a straight route and visible blind ends cannot qualify as a directional trap',()=>{
 const line=generate({columns:12,rows:1,corridorWidth:2,algorithm:'prim',seed:'line',extraConnections:0});
 expect(routeTraps(line).qualifiedCount).toBe(0);
 const p=analyzePotential({...line,parameters:{...line.parameters,routeTrapCount:1}},{...DEFAULT_ANALYSIS,samples:16},undefined,false);
 expect(p.eligible).toBe(false);expect(p.issues.some(s=>s.includes('Ловушек'))).toBe(true);
 const cyclic=generate({...base().parameters,extraConnections:2});
 expect(routeTraps(cyclic)).toEqual({supported:false,candidates:[],qualifiedCount:0,best:null});
});
test('a route trap can be far from the exit; a nearby finish is not a requirement',()=>{
 const m=emptyMaze({columns:11,rows:13,corridorWidth:2,algorithm:'prim',seed:'far-trap',extraConnections:0});
 const parent=m.passages.map((_,i)=>i),root=(n:number):number=>parent[n]===n?n:(parent[n]=root(parent[n]!));
 const add=(a:number,b:number)=>{if(root(a)!==root(b)){parent[root(a)]=root(b);connect(m,a,b);}};
 const chain=(p:number[][])=>{for(let i=1;i<p.length;i++){const [x,z]=p[i-1]!,[tx,tz]=p[i]!;let a=z!*11+x!;const target=tz!*11+tx!,step=x===tx?Math.sign(tz!-z!)*11:Math.sign(tx!-x!);while(a!==target){add(a,a+step);a+=step;}}};
 chain([[0,6],[2,6],[2,1],[10,1],[10,12]]);
 chain([[2,6],[2,10],[3,10],[3,11]]);
 const deadEnd=124;
 for(let a=0;a<m.passages.length;a++)for(const b of neighbors(m,a))if(a!==deadEnd&&b!==deadEnd)add(a,b);
 m.entrance={cell:66,side:'west'};m.exit={cell:142,side:'east'};
 const t=routeTraps(m).candidates.find(t=>t.fork===68&&t.deadEnd===deadEnd)!;
 expect(t.deadEndDistance).toBe(16);expect(t.falseApproach).toBe(12);
 expect(t.requiredRetreat).toBe(10);expect(t.qualifies).toBe(true);
});
test('ordinary generate accepts a trap count, preserves it in JSON and is reproducible',()=>{
 const old=base(),parameters={...old.parameters,seed:'ordinary-generator-proof',routeTrapCount:1};
 const maze=generate(parameters,old);
 expect(routeTraps(maze).qualifiedCount).toBeGreaterThanOrEqual(1);
 expect(analyzePotential(maze,{...DEFAULT_ANALYSIS,samples:16},undefined,false).eligible).toBe(true);
 expect(generate(parameters,old)).toEqual(maze);
 expect(deserialize(serialize(maze)).parameters.routeTrapCount).toBe(1);
 expect(generate({...old.parameters,routeTrapCount:0}).passages).toEqual(generate(old.parameters).passages);
 expect(()=>generate({...parameters,routeTrapCount:1.5},old)).toThrow();
 expect(()=>generate({...parameters,extraConnections:1},old)).toThrow();
 const two=generate({...parameters,routeTrapCount:2},old);
 expect(new Set(routeTraps(two).candidates.filter(t=>t.qualifies).map(t=>t.fork)).size).toBeGreaterThanOrEqual(2);
 expect(deserialize(serialize(two)).parameters.routeTrapCount).toBe(2);
 const prim=generate({...parameters,algorithm:'prim'},{...old,roof:true});
 expect(routeTraps(prim).qualifiedCount).toBeGreaterThanOrEqual(1);
 expect(prim.roof).toBe(true);expect(maze.roof).toBe(old.roof);
});
test('generator varies by seed and refuses other shapes without modifying them',()=>{
 const a=base(),before=structuredClone(a),one=pRouteTrapMaze(a,'one')!,two=pRouteTrapMaze(a,'two')!;
 expect(one.passages).not.toEqual(two.passages);expect(a).toEqual(before);
 expect(pRouteTrapMaze(generate({columns:4,rows:4,corridorWidth:2,algorithm:'prim',seed:'small',extraConnections:0}),'small')).toBeNull();
});
test('multiple traps can be bootstrapped on a full square without a P template',()=>{
 const raw=generate({columns:9,rows:9,moduleSize:2,corridorWidth:2,extraConnections:0,seed:'square-probe',algorithm:'backtracker'});
 const square=withPortals({...raw,entrance:{cell:272,side:'south'},exit:{cell:288,side:'south'}},[{cell:272,side:'south'},{cell:288,side:'south'}]);
 const guarded=guardedMaze(square,'square-probe-19'),snapshot=structuredClone(guarded.maze);
 const candidates=bootstrapRouteTraps(guarded.maze,guarded.constraints,2);
 expect(candidates.length).toBeGreaterThan(0);expect(guarded.maze).toEqual(snapshot);
 for(const candidate of candidates){expect(routeTraps(candidate).qualifiedCount).toBeGreaterThanOrEqual(2);expect(metrics(candidate).cycles).toBe(0);expect(metrics(candidate).components).toBe(1);expect(mazePortalPrivacy(candidate,false).certified).toBe(true);}
});
