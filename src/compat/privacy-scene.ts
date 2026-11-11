import type {Maze,Portal,Point,Wall} from '../core/maze';
import {walls,cellCenter} from '../core/maze';
import {domainOf} from '../core/domain';
import {samePortal,mazePortals} from '../core/portals';
import {timberStructure,supportColliders} from '../core/structure';
import {rayWall} from '../free/geometry';
import type {PrivacyScene} from '../analysis/aperture-privacy';
const key=(p:Portal)=>`${p.cell}:${p.side}`;
/** Geometry adapter for legacy generation/import. No certification algorithm here. */
export function legacyPrivacyScene(maze:Maze,portal:Portal):PrivacyScene{
 const d=domainOf(maze),boundary=d.boundary.find(e=>samePortal(e.portal,portal));if(!boundary)throw Error('Проём должен находиться на границе.');
 const polygon=(r:{x1:number;z1:number;x2:number;z2:number})=>[{x:r.x1,z:r.z1},{x:r.x2,z:r.z1},{x:r.x2,z:r.z2},{x:r.x1,z:r.z2}],rooms=maze.passages.map((_,i)=>({polygon:d.rectangles[i]?polygon(d.rectangles[i]!):[],holes:[] as Point[][]})),links:PrivacyScene['links']=[];
 for(const a of d.cells)for(const b of maze.passages[a]!)if(b>a){const r=d.rectangles[a]!,s=d.rectangles[b]!,vertical=Math.abs(r.x2-s.x1)<1e-8||Math.abs(s.x2-r.x1)<1e-8;let gate:Wall;if(vertical){const x=Math.max(r.x1,s.x1);gate={x1:x,z1:Math.max(r.z1,s.z1),x2:x,z2:Math.min(r.z2,s.z2)};}else{const z=Math.max(r.z1,s.z1);gate={x1:Math.max(r.x1,s.x1),z1:z,x2:Math.min(r.x2,s.x2),z2:z};}links.push({a,b,gateA:gate,gateB:gate});}
 const panels=walls(maze),obstacles=[...panels,...supportColliders(maze)],w=boundary.wall,normal={north:{x:0,z:-1},south:{x:0,z:1},west:{x:-1,z:0},east:{x:1,z:0}}[portal.side];
 return {rooms,centers:maze.passages.map((_,i)=>d.active[i]?cellCenter(maze,i):{x:0,z:0}),passages:maze.passages,polygons:d.cells.map(i=>rooms[i]!.polygon),links,panels,posts:timberStructure(maze).posts,wallHeight:maze.wallHeight,opening:{room:portal.cell,from:{x:w.x1,z:w.z1},to:{x:w.x2,z:w.z2},mid:{x:(w.x1+w.x2)/2,z:(w.z1+w.z2)/2},normal},key:key(portal),portals:mazePortals(maze).map(p=>({room:p.cell,key:key(p)})),visible:(from,to)=>{const length=Math.hypot(to.x-from.x,to.z-from.z),angle=Math.atan2(to.z-from.z,to.x-from.x);return length>1e-8&&obstacles.every(w=>rayWall(from,angle,w,length)>=length-1e-7);}};
}
