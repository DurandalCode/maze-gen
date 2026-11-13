import {expect,test} from 'bun:test';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {promoteCavityConnectors} from '../src/free/void-infill';
import {buildNavigation,connectionGeometry} from '../src/free/layout';
import {distance,movementClearance} from '../src/free/geometry';
import {CollisionWorld} from '../src/simulation/collisions';

for(const rotation of [0,37])test(`acute promoted corridor keeps a real capsule-clear doorway approach at ${rotation} degrees`,()=>{
 const radians=rotation*Math.PI/180,rotate=(x:number,z:number)=>({x:50+(x-34)*Math.cos(radians)-(z-59)*Math.sin(radians),z:50+(x-34)*Math.sin(radians)+(z-59)*Math.cos(radians)}),layout=emptyLayout();
 layout.modules=[{id:'a',type:'2x2',...rotate(33.665101247868456,60.63865079078745),angle:72.7701423200781+rotation},{id:'b',type:'2x2',...rotate(34.861120888301244,57.94410762809108),angle:147.03526937169974+rotation}];
 layout.connections=[{id:'acute',a:{room:'a',edge:3,offset:0},b:{room:'b',edge:1,offset:0},width:1.4}];
 layout.openings=[{id:'in',room:'a',edge:1,offset:0,width:1.4},{id:'out',room:'b',edge:3,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';layout.moduleConstruction={version:1,spans:structuredClone(layout.connections)};
 const d:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:100,rows:100,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'acute-seat'},construction:{...DEFAULT_CONSTRUCTION},layout};
 expect(buildNavigation(layout).paths.every(Boolean)).toBe(true);promoteCavityConnectors(d);
 const snapshot=JSON.stringify(d),g=connectionGeometry(d.layout,d.layout.connections[0]!),preferred={x:g.b.mid.x-g.b.normal.x*.35,z:g.b.mid.z-g.b.normal.z*.35},nav=buildNavigation(d.layout);
 expect(Math.min(...nav.obstacles.map(w=>movementClearance(preferred,g.b.mid,w)))).toBeLessThan(.25);
 expect(nav.paths.every(Boolean)).toBe(true);const link=nav.links.find(l=>l.connection==='acute-a')!;
 expect(distance(link.to,preferred)).toBeGreaterThan(.1);expect(Math.min(...nav.obstacles.map(w=>movementClearance(link.to,g.b.mid,w)))).toBeGreaterThan(.4);
 // The already safe native-room approach is unchanged.
 expect(distance(link.from,{x:g.a.mid.x-g.a.normal.x*.35,z:g.a.mid.z-g.a.normal.z*.35})).toBeLessThan(1e-8);
 const world=new CollisionWorld(nav.obstacles);for(const path of [...nav.edgePaths.values(),...nav.portalPaths.values()])for(let i=1;i<path.length;i++)expect(distance(world.move(path[i-1]!,{x:path[i]!.x-path[i-1]!.x,z:path[i]!.z-path[i-1]!.z}),path[i]!)).toBeLessThan(1e-5);
 expect(JSON.stringify(d)).toBe(snapshot);
});
