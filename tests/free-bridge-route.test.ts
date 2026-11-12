import {test,expect} from 'bun:test';
import {seedBridgeRoute} from '../src/free/bridge-route-seed';
import {bridgeRouteSummary,bridgeRouteErrors,underBridgeIds} from '../src/free/bridge-route';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {DEFAULT_CONSTRUCTION,validateParameters,type Parameters} from '../src/core/maze';
import {freeMaze,validateFree,localRoute} from '../src/free/layout';
import {serialize,deserialize} from '../src/persistence/maze-json';
import {routePoints} from '../src/core/pathfinding';
import {Player} from '../src/simulation/player';
import {CollisionWorld} from '../src/simulation/collisions';
import {bridgeGeometry} from '../src/free/bridges';

const parameters:Parameters={placementMode:'free',columns:80,rows:80,moduleSize:2,corridorWidth:2,extraConnections:3,freeBridgeCount:4,freeRequiredBridgeCount:2,freeRequireUnderpass:true,loopTrapCount:1,seed:'four-regression',algorithm:'prim'};
function fixture(angle=0){const layout=emptyLayout();seedBridgeRoute(layout,parameters,{x:40,z:40},angle,2.5,1.6);layout.openings=[{id:'in',room:'bridge-left-0',edge:3,offset:0,width:1.6},{id:'out',room:'return-fork',edge:3,offset:0,width:1.6}];layout.entrance='in';layout.exit='out';return {kind:'maze-lab-free-draft',version:2,parameters,construction:{...DEFAULT_CONSTRUCTION},layout} satisfies FreeDraft;}
test('four real bridges include exactly two unavoidable crossings and a mandatory lower passage',()=>{
 for(const angle of [0,27,90]){
  const draft=fixture(angle);expect(validateFree(draft)).toEqual([]);const m=freeMaze(draft),r=bridgeRouteSummary(m);
  expect(r.total).toBe(4);expect(r.minimumCrossings).toBe(2);expect(r.required).toHaveLength(2);expect(r.routeOver).toHaveLength(2);expect(r.routeUnder.length).toBeGreaterThanOrEqual(1);expect(r.underpassRequired).toBe(true);expect(bridgeRouteErrors(m)).toEqual([]);
  expect(serialize(deserialize(serialize(m)))).toBe(serialize(m));
 }
},60000);
test('the whole physical route can be walked with stairs and lower screens, without teleporting',()=>{
 const m=freeMaze(fixture()),p=new Player(m,new CollisionWorld([]));
 for(const target of routePoints(m).slice(1)){
  let attempts=0;while(Math.hypot(target.x-p.position.x,target.z-p.position.z)>.01&&!p.finished){if(attempts++>2500)throw Error('Stuck '+JSON.stringify(p.position));p.yaw=Math.atan2(p.position.x-target.x,p.position.z-target.z);p.updateAnalog(Math.min(.02,Math.hypot(target.x-p.position.x,target.z-p.position.z)/1.4),1,0);}
 }
 expect(p.finished).toBe(true);expect(new Set(p.recorder.samples.filter(p=>(p.y??0)>.01).map(p=>p.bridge)).size).toBe(2);
});
test('route requirements are checked independently from the total inventory and lower deck corner touches',()=>{
 const d=fixture();d.layout.openings[1]={id:'out',room:'bridge-right-0',edge:1,offset:0,width:1.6};const m=freeMaze(d);
 expect(bridgeRouteErrors(m).length).toBeGreaterThan(0);expect(bridgeRouteSummary(m).minimumCrossings).toBe(1);
 const g=bridgeGeometry(m.free!,m.free!.bridges![0]!);expect(underBridgeIds(m,[g.deck[0]!,g.deck[0]!])).toEqual([]);
 expect(()=>validateParameters({...parameters,freeBridgeCount:5})).toThrow();expect(()=>validateParameters({...parameters,freeRequiredBridgeCount:5})).toThrow();
});
test('local routing retains nearby thick solids, avoids post corners and ignores truly distant walls',()=>{
 const poly=[{x:0,z:0},{x:4,z:0},{x:4,z:4},{x:0,z:4}],a={x:1,z:1},b={x:3,z:1},screen={x1:2,z1:0,x2:2,z2:2.8};
 const far=Array.from({length:300},(_,i)=>({x1:100+i,z1:100,x2:100+i,z2:110})),route=localRoute(a,b,poly,[],[screen,...far]);
 expect(route).not.toBeNull();expect(route!.some(p=>p.z>3)).toBe(true);
 const world=new CollisionWorld([screen]);for(let i=1;i<route!.length;i++){const p=route![i-1]!,q=route![i]!,end=world.move(p,{x:q.x-p.x,z:q.z-p.z});expect(Math.hypot(end.x-q.x,end.z-q.z)).toBeLessThan(1e-5);}
 // Centre line lies outside the room, but its thickness reaches the endpoint.
 expect(localRoute({x:3.9,z:2},{x:1,z:2},poly,[],[{x1:6,z1:0,x2:6,z2:4,thickness:4}])).toBeNull();
 screen.x1=0;screen.x2=4;screen.z1=screen.z2=2;
 expect(localRoute({x:1,z:1},{x:1,z:3},poly,[],[screen,...far])).toBeNull();
 screen.x1=screen.x2=2;screen.z1=0;screen.z2=2.8;
 expect(localRoute(a,b,poly,[],[screen,...far])).not.toBeNull();
});
