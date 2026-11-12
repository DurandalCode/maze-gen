import {expect,test} from 'bun:test';
import {DEFAULT_CONSTRUCTION,type Wall} from '../src/core/maze';
import {timberStructure} from '../src/core/structure';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {connectionGeometry,freeMaze,freeRuntime,validateFree} from '../src/free/layout';
import {promoteCavityConnectors} from '../src/free/void-infill';
const same=(a:Wall,b:Wall)=>Math.abs(a.x1-b.x1)+Math.abs(a.z1-b.z1)+Math.abs(a.x2-b.x2)+Math.abs(a.z2-b.z2)<1e-6||Math.abs(a.x1-b.x2)+Math.abs(a.z1-b.z2)+Math.abs(a.x2-b.x1)+Math.abs(a.z2-b.z1)<1e-6;
test('a module-backed span retains its complete top rail over a door while fabric stays cut',()=>{
 const layout=emptyLayout();layout.modules=[{id:'a',type:'2x2',x:3,z:3,angle:0},{id:'b',type:'2x2',x:8,z:3,angle:0}];
 const span={id:'ab',a:{room:'a',edge:1,offset:0},b:{room:'b',edge:3,offset:0},width:1.4};layout.connections=[span];layout.moduleConstruction={version:1,spans:[structuredClone(span)]};
 layout.openings=[{id:'in',room:'a',edge:3,offset:0,width:1.4},{id:'out',room:'b',edge:1,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:12,rows:10,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'headers'},construction:{...DEFAULT_CONSTRUCTION},layout};
 promoteCavityConnectors(draft);layout.openings.push({id:'side',room:'void-frame-ab',edge:0,offset:0,width:1.4});
 expect(validateFree(draft)).toEqual([]);const maze=freeMaze(draft,false),sides=connectionGeometry(layout,span).sides,rail=sides.find(w=>Math.abs(w.z1-2.3)<1e-7)!;
 expect(freeRuntime(maze).panels.some(w=>same(w,rail))).toBe(false);expect(timberStructure(maze).frames.some(w=>same(w,rail))).toBe(true);
 const originalPanels=JSON.stringify(freeRuntime(maze).panels);delete maze.free!.moduleConstruction;
 expect(timberStructure(maze).frames.some(w=>same(w,rail))).toBe(false);expect(JSON.stringify(freeRuntime(maze).panels)).toBe(originalPanels);
});
