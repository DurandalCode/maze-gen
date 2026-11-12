import {test,expect} from 'bun:test';
import {maximumConnectionGap} from '../src/free/connection-span';
import {seedSwitchbacks} from '../src/free/switchback-seed';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {anchorGeometry,connectionGeometry,validateFree,freeMaze,rooms} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {metrics} from '../src/core/metrics';
import {routeTraps} from '../src/analysis/route-traps';
import {deserialize,serialize} from '../src/persistence/maze-json';
test('maximum span constrains both edges of a rotated connector',()=>{
 for(const angle of [0,17,39]){
  const layout=emptyLayout();layout.modules=[{id:'a',type:'2x2',x:5,z:5,angle:0},{id:'b',type:'2x2',x:0,z:0,angle}];
  const a={room:'a',edge:1,offset:0},b={room:'b',edge:3,offset:0},ga=anchorGeometry(layout,a,1.6),gb=anchorGeometry(layout,b,1.6),gap=maximumConnectionGap(ga,gb,3),m=layout.modules[1]!;
  m.x=ga.mid.x+ga.normal.x*gap-gb.mid.x;m.z=ga.mid.z+ga.normal.z*gap-gb.mid.z;
  const lengths=connectionGeometry(layout,{id:'c',a,b,width:1.6}).sides.map(w=>Math.hypot(w.x2-w.x1,w.z2-w.z1));
  expect(Math.max(...lengths)).toBeCloseTo(3,8);expect(lengths.every(n=>n<=3+1e-7)).toBe(true);
 }
});
test('distributed native circuits retain two genuine traps and opposite exterior portals',()=>{
 const layout=emptyLayout(),seed=seedSwitchbacks(layout,{x:50,z:50},30);layout.openings=[{id:'in',...seed.entrance,width:1.6},{id:'out',...seed.exit,width:1.6}];layout.entrance='in';layout.exit='out';
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:2,algorithm:'prim',seed:'switchbacks'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout};
 expect(validateFree(draft)).toEqual([]);const m=freeMaze(draft);expect(metrics(m).cycles).toBe(2);expect(routeTraps(m).qualifiedCount).toBeGreaterThanOrEqual(2);
 const a=anchorGeometry(layout,seed.entrance,1.6),b=anchorGeometry(layout,seed.exit,1.6);expect(a.normal.x*b.normal.x+a.normal.z*b.normal.z).toBeCloseTo(-1,8);
 for(const g of [a,b])expect(Math.max(...rooms(layout).flatMap(r=>r.polygon).map(p=>(p.x-g.mid.x)*g.normal.x+(p.z-g.mid.z)*g.normal.z))).toBeLessThan(1e-7);
 expect(serialize(deserialize(serialize(m)))).toBe(serialize(m));
},30000);
