import {expect,test} from 'bun:test';
import {seedReturnLoop} from '../src/free/return-loop-seed';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,freeRuntime,validateFree} from '../src/free/layout';
import {DEFAULT_CONSTRUCTION,walls} from '../src/core/maze';
import {trapOverlay} from '../src/ui/trap-overlay';
import {selectOppositePortals} from '../src/free/opposite-portals';
import {CollisionWorld} from '../src/simulation/collisions';
import {supportColliders} from '../src/core/structure';
import {freeGroundLengths} from '../src/free/path-limits';
import {metrics} from '../src/core/metrics';
test('native return circuit is a qualified UI К1 alongside a separate Л1, with opposed physical portals',()=>{
 const layout=emptyLayout(),seed=seedReturnLoop(layout,{x:50,z:50});
 layout.openings=[{id:'in',...seed.entrance,width:1.6},{id:'out',...seed.exit,width:1.6}];layout.entrance='in';layout.exit='out';
 const draft:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:1,algorithm:'prim',seed:'return-field-07'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout};
 expect(validateFree(draft)).toEqual([]);const maze=freeMaze(draft,false),overlay=trapOverlay(maze);
 expect(overlay.filter(t=>t.kind==='dead-end').map(t=>t.label)).toEqual(['Л1']);expect(overlay.filter(t=>t.kind==='loop').map(t=>t.label)).toEqual(['К1']);
 expect(selectOppositePortals(layout,layout.openings,1.6)).toHaveLength(1);
 const world=new CollisionWorld([...walls(maze),...supportColliders(maze)]);
 for(const path of [...freeRuntime(maze).edgePaths.values(),...freeRuntime(maze).portalPaths.values()])for(let i=1;i<path.length;i++){
  const a=path[i-1]!,b=path[i]!,p=world.move(a,{x:b.x-a.x,z:b.z-a.z});expect(Math.hypot(p.x-b.x,p.z-b.z)).toBeLessThan(1e-5);
 }
},15000);

test('connected return variant removes the long compulsory chain while retaining qualified Л and К',()=>{
 const layout=emptyLayout(),seed=seedReturnLoop(layout,{x:50,z:50},20,1.6,true);
 layout.openings=[{id:'in',...seed.entrance,width:1.6},{id:'out',...seed.exit,width:1.6}];layout.entrance='in';layout.exit='out';
 const maze=freeMaze({kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:4,algorithm:'prim',seed:'return-field-08'},construction:{...DEFAULT_CONSTRUCTION,roof:true},layout});
 const lengths=freeGroundLengths(maze);expect(lengths.straight).toBeLessThanOrEqual(8);expect(lengths.run).toBeLessThanOrEqual(16);expect(metrics(maze).cycles).toBe(4);
 const overlay=trapOverlay(maze);expect(overlay.some(t=>t.kind==='dead-end')).toBe(true);expect(overlay.some(t=>t.kind==='loop')).toBe(true);
 expect(selectOppositePortals(layout,layout.openings,1.6)).toHaveLength(1);
},30000);
