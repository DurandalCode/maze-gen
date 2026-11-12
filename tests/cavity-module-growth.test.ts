import {expect,test,spyOn} from 'bun:test';
import {growCavityModules} from '../src/free/cavity-module-growth';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {connectionGeometry,freeMaze,modulePolygon,validateFree} from '../src/free/layout';
import {freeGroundLengths} from '../src/free/path-limits';
import {pointIn,edges,ends,segmentInside} from '../src/free/geometry';
function source():FreeDraft{
 const l=emptyLayout();
 l.modules=[['l0',3,3],['l1',3,7],['l2',3,11],['b',6,11],['r2',9,11],['r1',9,7],['r0',9,3]].map(([id,x,z])=>({id:id as string,x:x as number,z:z as number,type:'2x2',angle:0}));
 const pairs:[string,string,number][]=[['l0','l1',2],['l1','l2',2],['l2','b',1],['b','r2',1],['r2','r1',0],['r1','r0',0]];
 l.connections=pairs.map(([a,b,edge],i)=>({id:'old-'+i,a:{room:a,edge,offset:0},b:{room:b,edge:(edge+2)%4,offset:0},width:1.4}));
 l.openings=[{id:'in',room:'l0',edge:0,offset:0,width:1.4},{id:'out',room:'r0',edge:0,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 return {kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:14,rows:16,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'module-cavity-test'},construction:{...DEFAULT_CONSTRUCTION},layout:l};
}
const polygon=[{x:4,z:2},{x:8,z:2},{x:8,z:10},{x:4,z:10}];
test('a real module closes two old branches and cuts the long U without moving its frames',()=>{
 const d=source(),before=JSON.stringify(d);expect(validateFree(d)).toEqual([]);expect(freeGroundLengths(freeMaze(d)).run).toBeGreaterThan(16);
 const result=growCavityModules(d,polygon,'native-cavity-test',2);
 expect(result.addedModules).toBeGreaterThan(0);expect(result.addedModules).toBeLessThanOrEqual(2);expect(result.loops).toBe(1);expect(result.addedConnections).toBe(result.addedModules+1);
 expect(JSON.stringify(d)).toBe(before);expect(result.draft.layout.modules.slice(0,d.layout.modules.length)).toEqual(d.layout.modules);expect(result.draft.layout.connections.slice(0,d.layout.connections.length)).toEqual(d.layout.connections);
 expect(result.draft.layout.spaces).toEqual(d.layout.spaces);expect(result.draft.layout.walls).toEqual(d.layout.walls);expect(result.draft.layout.supports).toBeUndefined();expect(result.draft.layout.openings).toEqual(d.layout.openings);
 for(const m of result.draft.layout.modules.slice(d.layout.modules.length)){expect(['2x2','2x6']).toContain(m.type);expect(m.frameOnly).toBeUndefined();const inside=(p:{x:number;z:number})=>pointIn(p,polygon);expect(edges(modulePolygon(m)).every(w=>segmentInside(...ends(w),inside,edges(polygon)))).toBe(true);}
 for(const c of result.draft.layout.connections.slice(d.layout.connections.length)){
  const g=connectionGeometry(result.draft.layout,c);expect(Math.max(...g.sides.map(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1)))).toBeLessThanOrEqual(3+1e-7);
  const inside=(p:{x:number;z:number})=>pointIn(p,polygon);expect(edges(g.polygon).every(w=>segmentInside(...ends(w),inside,edges(polygon)))).toBe(true);
 }
 expect(validateFree(result.draft)).toEqual([]);const n=freeGroundLengths(freeMaze(result.draft));expect(n.straight).toBeLessThanOrEqual(8+1e-7);expect(n.run).toBeLessThanOrEqual(16+1e-7);
 let now=0;const clock=spyOn(performance,'now').mockImplementation(()=>now+=100000);
 try{expect(growCavityModules(d,polygon,'native-cavity-test',2).draft).toEqual(result.draft);}finally{clock.mockRestore();}
},10000);
test('a narrow cavity returns an explicit failure and leaves the source untouched',()=>{
 const d=source(),before=JSON.stringify(d),narrow=[{x:4,z:6.2},{x:8,z:6.2},{x:8,z:7.8},{x:4,z:7.8}];
 const result=growCavityModules(d,narrow,'narrow-cavity',2);expect(result.addedModules).toBe(0);expect(result.addedConnections).toBe(0);expect(result.loops).toBe(0);expect(result.reason.length).toBeGreaterThan(20);expect(result.draft).toBe(d);expect(JSON.stringify(d)).toBe(before);
});
