import {expect,test} from 'bun:test';
import {nativePanels} from '../src/free/panels';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,physical,validateFree} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION,walls} from '../src/core/maze';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {routePoints} from '../src/core/pathfinding';
test('coincident partial panels form one boundary while all support endpoints remain',()=>{
 const panels=nativePanels([{x1:0,z1:0,x2:0,z2:4},{x1:0,z1:2,x2:0,z2:0},{x1:0,z1:4,x2:0,z2:2},{x1:1,z1:1,x2:1,z2:1}]);expect(panels).toHaveLength(2);expect(panels.reduce((s,w)=>s+Math.hypot(w.x2-w.x1,w.z2-w.z1),0)).toBe(4);
});
test('adjoining native floors have editable shared walls and zero-length doorway links remain physically walkable',()=>{
 const l=emptyLayout();l.modules=[{id:'left',type:'2x2',x:3,z:3,angle:0},{id:'right',type:'2x2',x:5,z:3,angle:0}];l.connections=[{id:'shared-door',a:{room:'left',edge:1,offset:0},b:{room:'right',edge:3,offset:0},width:1.4}];l.openings=[{id:'in',room:'left',edge:3,offset:0,width:1.4},{id:'out',room:'right',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';const d:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:10,rows:10,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'native-shared'},construction:{...DEFAULT_CONSTRUCTION},layout:l};expect(validateFree(d)).toEqual([]);expect(l.preservedPanels).toBeUndefined();const m=freeMaze(d),world=new CollisionWorld([...walls(m),...supportColliders(m)]),path=routePoints(m);for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,end=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(end.x-b.x,end.z-b.z)).toBeLessThan(1e-6);}const before=physical(l).panels;l.connections=[];const after=physical(l).panels;expect(after.reduce((s,w)=>s+Math.hypot(w.x2-w.x1,w.z2-w.z1),0)).toBeCloseTo(before.reduce((s,w)=>s+Math.hypot(w.x2-w.x1,w.z2-w.z1),0)+1.4,6);
});
