import {expect,test} from 'bun:test';
import {nativeFloorBoundary,organicOpenPockets,pocketOverlap} from '../src/free/open-pockets';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,physical} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
function ring(angle:number){const l=emptyLayout(),r=angle*Math.PI/180;for(const [id,x,z]of [['a',4,4],['b',9,4],['c',9,9],['d',4,9]]as const)l.modules.push({id,type:'2x2',x:15+x*Math.cos(r)-z*Math.sin(r),z:4+x*Math.sin(r)+z*Math.cos(r),angle});
 l.connections=[{id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4},{id:'bc',a:{room:'b',edge:2,offset:0},b:{room:'c',edge:0,offset:0},width:1.4},{id:'dc',a:{room:'d',edge:1,offset:0},b:{room:'c',edge:3,offset:0},width:1.4}];l.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'c',edge:1,offset:0,width:1.4}];l.entrance='in';l.exit='out';
 return freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:35,rows:35,moduleSize:2,corridorWidth:2,extraConnections:1,algorithm:'prim',seed:'native-void'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout:l}as FreeDraft);
}
test('real open concavities are found without filling the outer plot or double counting nested caps',()=>{
 for(const angle of [0,19]){const base=ring(angle),before=physical(base.free!),boundary=nativeFloorBoundary(base),pockets=organicOpenPockets(base);expect(boundary.length).toBe(1);expect(pockets.length).toBeGreaterThan(0);for(const pocket of pockets){expect(pocket.area).toBeGreaterThanOrEqual(6);expect(pocket.mouth).toBeLessThanOrEqual(6);expect(before.polygons.some(p=>pocketOverlap(pocket.polygon,p))).toBe(false);}for(let i=0;i<pockets.length;i++)for(let j=i+1;j<pockets.length;j++)expect(pocketOverlap(pockets[i]!.polygon,pockets[j]!.polygon)).toBe(false);}
});
test('nested caps of the same concave bay count once even when its vertex average is outside',()=>{
 const concave=[{x:0,z:0},{x:6,z:0},{x:6,z:6},{x:4,z:6},{x:4,z:2},{x:2,z:2},{x:2,z:6},{x:0,z:6}];expect(pocketOverlap(concave,concave)).toBe(true);
 const neighbouring=[{x:6,z:0},{x:8,z:0},{x:8,z:6},{x:6,z:6}];expect(pocketOverlap(concave,neighbouring)).toBe(false);
});
