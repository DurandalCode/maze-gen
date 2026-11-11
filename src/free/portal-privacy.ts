import type {Maze,Portal} from '../core/maze';
import {certifyAperturePrivacy,type PortalPrivacy} from '../analysis/aperture-privacy';
import {freePortal,freeRuntime} from './layout';
import {freeSpatialRay} from './spatial-visibility';
export {separatesApertures} from '../analysis/aperture-privacy';
export function freePortalPrivacy(maze:Maze,portal:Portal,maxPocket:number,findWitness:boolean,excludedPanel=-1):PortalPrivacy{
 const r=freeRuntime(maze),opening=freePortal(maze,portal.freeId!),room=r.rooms.findIndex(v=>v.id===opening.room.id);
 return certifyAperturePrivacy({rooms:r.rooms,centers:r.centers,passages:maze.passages,polygons:r.polygons,links:r.links,panels:r.panels.filter((_,i)=>i!==excludedPanel),posts:r.posts,wallHeight:maze.wallHeight,opening:{...opening,room},key:portal.freeId!,portals:maze.free!.openings.map(o=>({key:o.id,room:r.rooms.findIndex(v=>v.id===o.room)})),allowPocket:pocket=>{
  const ids=new Set(pocket.map(i=>r.rooms[i]!.id));return (!maze.free!.bridges?.length||!!maze.roof)&&!(maze.free!.bridges??[]).some(b=>ids.has(b.a.room)||ids.has(b.b.room));
 },visible:(from,to)=>{const length=Math.hypot(to.x-from.x,to.z-from.z);return length>1e-8&&freeSpatialRay(maze,{...from,y:1.7},{x:(to.x-from.x)/length,z:(to.z-from.z)/length},length).length>=length-1e-7;}},portal,maxPocket,findWitness);
}
