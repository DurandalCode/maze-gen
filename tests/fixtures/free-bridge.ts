import {DEFAULT_CONSTRUCTION} from '../../src/core/maze';
import {emptyLayout,type FreeDraft} from '../../src/free/model';
export function bridgeFixture():FreeDraft{
 const layout=emptyLayout();
 layout.modules=[{id:'a',type:'2x2',x:3,z:15,angle:0},{id:'b',type:'2x2',x:23,z:15,angle:0},{id:'c',type:'2x2',x:13,z:13,angle:0},{id:'d',type:'2x2',x:13,z:17,angle:0}];
 layout.spaces=[{id:'hall',kind:'hall',polygon:[{x:2,z:18.5},{x:24,z:18.5},{x:24,z:20.5},{x:2,z:20.5}]}];
 layout.connections=[
  {id:'under',a:{room:'c',edge:2,offset:0},b:{room:'d',edge:0,offset:0},width:1.4},
  {id:'ah',a:{room:'a',edge:2,offset:0},b:{room:'hall',edge:0,offset:-10},width:1.4},
  {id:'bh',a:{room:'b',edge:2,offset:0},b:{room:'hall',edge:0,offset:10},width:1.4},
  {id:'dh',a:{room:'d',edge:2,offset:0},b:{room:'hall',edge:0,offset:0},width:1.4},
 ];
 layout.bridges=[{id:'bridge-1',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4,rise:2.8,stairRun:6}];
 layout.supports=[];for(let x=2;x<=24;x+=2)for(const z of [18.5,20.5])layout.supports.push({x,z});
 layout.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
 return {kind:'maze-lab-free-draft',version:2,parameters:{placementMode:'free',columns:28,rows:24,corridorWidth:2,moduleSize:2,extraConnections:1,freeBridgeCount:1,seed:'bridge-test',algorithm:'backtracker'},construction:{...DEFAULT_CONSTRUCTION},layout};
}
