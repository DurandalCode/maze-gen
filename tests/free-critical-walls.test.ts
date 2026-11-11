import {expect,test} from 'bun:test';
import {DEFAULT_CONSTRUCTION} from '../src/core/maze';
import {emptyLayout,type FreeDraft} from '../src/free/model';
import {freeMaze,freeRuntime} from '../src/free/layout';
import {criticalWalls,criticalWallAt} from '../src/analysis/critical-walls';
import {portalPrivacy} from '../src/analysis/portal-privacy';
import {freePortalPrivacy,separatesApertures} from '../src/free/portal-privacy';
import {deserialize} from '../src/persistence/maze-json';
import {bridgeFixture} from './fixtures/free-bridge';
function fixture(angle:number){
 const layout=emptyLayout(),r=angle*Math.PI/180;
 layout.modules=[[3,7],[3,3],[7,3],[7,7]].map(([x,z],i)=>({id:`m${i}`,type:'2x2' as const,x:10+x!*Math.cos(r)-z!*Math.sin(r),z:10+x!*Math.sin(r)+z!*Math.cos(r),angle}));
 layout.connections=[{id:'c0',a:{room:'m0',edge:0,offset:0},b:{room:'m1',edge:2,offset:0},width:1.4},{id:'c1',a:{room:'m1',edge:1,offset:0},b:{room:'m2',edge:3,offset:0},width:1.4},{id:'c2',a:{room:'m2',edge:2,offset:0},b:{room:'m3',edge:0,offset:0},width:1.4}];
 layout.openings=[{id:'in',room:'m0',edge:2,offset:0,width:1.4},{id:'out',room:'m3',edge:2,offset:0,width:1.4}];layout.entrance='in';layout.exit='out';
 const d:FreeDraft={kind:'maze-lab-free-draft',version:1,parameters:{placementMode:'free',columns:30,rows:30,moduleSize:2,corridorWidth:2,extraConnections:0,algorithm:'prim',seed:'privacy'},construction:{...DEFAULT_CONSTRUCTION},layout};return freeMaze(d);
}
test('free critical walls protect physical shielding panels for arbitrary module angles',()=>{
 for(const angle of [0,19,37]){const m=fixture(angle),privacy=portalPrivacy(m,m.entrance,3,false);expect(privacy.certified).toBe(true);const walls=criticalWalls(m);expect(walls.length).toBeGreaterThan(0);
 for(const item of walls){expect(freeRuntime(m).panels).toContainEqual(item.wall);expect(item.protections.every(p=>p.kind==='portal')).toBe(true);const i=freeRuntime(m).panels.indexOf(item.wall);for(const p of item.protections)expect(freePortalPrivacy(m,p.element==='входа'?m.entrance:m.exit,3,false,i).certified).toBe(false);expect(criticalWallAt([item],{x:(item.wall.x1+item.wall.x2)/2,z:(item.wall.z1+item.wall.z2)/2},.1)).toBe(item);}
 }
});
test('oriented aperture certificate rejects diagonal bounding-box false positives',()=>{
 expect(separatesApertures([{x:0,z:0},{x:0,z:1}],[{x:4,z:0},{x:4,z:1}],{x1:1,z1:2,x2:3,z2:4})).toBe(false);
});
test('bridges with freeId portals no longer throw in critical-wall/privacy analysis',()=>{
 const m=freeMaze(bridgeFixture());expect(()=>portalPrivacy(m,m.entrance,3,false)).not.toThrow();expect(()=>criticalWalls(m)).not.toThrow();
});
test('reported three-zone saved map can open critical walls without a boundary exception',async()=>{
 const text=await Bun.file(new URL('./fixtures/free-zones.json',import.meta.url)).text(),m=deserialize(text);expect(()=>criticalWalls(m)).not.toThrow();const flat=JSON.parse(text);flat.version=5;delete flat.layout.bridges;flat.parameters.freeBridgeCount=0;flat.parameters.extraConnections=3;expect(()=>criticalWalls(deserialize(JSON.stringify(flat)))).not.toThrow();
});

test('free audit: physical edges include bridge stairs, portal identities and plot boundary stay geometric',async()=>{
 const {prepareNavigation,edgeLength}=await import('../src/analysis/navigation'),{pathLength}=await import('../src/core/pathfinding'),{freeGraphPath}=await import('../src/free/layout'),{boundaryPortal,transferPortals,withPortals}=await import('../src/core/portals'),{perimeterPerception}=await import('../src/analysis/spatial-perception'),{contourQuality}=await import('../src/generators/contours'),{generate}=await import('../src/generators/generate');
 const m=freeMaze(bridgeFixture()),r=freeRuntime(m),ctx=prepareNavigation(m),a=r.rooms.findIndex(r=>r.id==='a'),b=r.rooms.findIndex(r=>r.id==='b'),physical=r.edgePaths.get(`${a}:${b}`)!;
 expect(edgeLength(ctx,a,b)).toBeCloseTo(pathLength(physical));expect(edgeLength(ctx,a,b)).toBeGreaterThan(Math.hypot(ctx.centers[a]!.x-ctx.centers[b]!.x,ctx.centers[a]!.z-ctx.centers[b]!.z));expect(freeGraphPath(m,[a,b])).toEqual(physical);
 expect(boundaryPortal(m,m.entrance)).toBe(true);expect(boundaryPortal(m,m.exit)).toBe(true);expect(boundaryPortal(m,{...m.entrance,cell:999})).toBe(false);
 const reversed=withPortals({...m,entrance:m.exit,exit:m.entrance},m.portals!);expect(reversed.free!.entrance).toBe(m.free!.exit);
 const transferred=transferPortals(m,generate({columns:5,rows:5,corridorWidth:2,algorithm:'prim',seed:'audit',extraConnections:0}));expect(boundaryPortal(transferred,transferred.entrance)).toBe(true);
 const perception=perimeterPerception(m,ctx);for(const i of ctx.cells){const p=ctx.centers[i]!;expect(perception.distances[i]).toBeCloseTo(Math.min(p.x,p.z,m.width-p.x,m.depth-p.z));}
 expect(contourQuality(m).supported).toBe(false);expect(contourQuality(m).certified).toBe(false);
});

test('low panels cannot certify occlusion at eye level',()=>{const m=fixture(19);m.wallHeight=1;expect(portalPrivacy(m,m.entrance,3,false).certified).toBe(false);expect(criticalWalls(m)).toEqual([]);});
