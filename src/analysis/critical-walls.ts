import {segmentDistance} from '../free/geometry';
import {freePortalPrivacy} from '../free/portal-privacy';
import {freeRuntime} from '../free/layout';
import {validFloorChanges} from '../core/two-storey';
import type {Maze,Wall,Point} from '../core/maze';
import {neighbors} from '../core/maze';
import {domainOf} from '../core/domain';
import {shortestPath} from '../core/pathfinding';
import {loopTraps} from './loop-traps';
import {routeTraps} from './route-traps';
import {mazePortalPrivacy} from './portal-privacy';
export interface WallProtection {kind:'portal'|'trap'|'loop'|'floor';element:string;reason:string}
export interface CriticalWall {a:number;b:number;wall:Wall;protections:WallProtection[]}
export const detailedCriticalWallsAvailable=(maze:Maze)=>domainOf(maze).cells.length<=1200;
function overlaps(a:Wall,b:Wall){
 const vertical=Math.abs(a.x1-a.x2)<1e-8;
 if(vertical!== (Math.abs(b.x1-b.x2)<1e-8))return false;
 return vertical?Math.abs(a.x1-b.x1)<1e-8&&Math.min(a.z2,b.z2)-Math.max(a.z1,b.z1)>1e-8:Math.abs(a.z1-b.z1)<1e-8&&Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)>1e-8;
}
/** Critical means deleting this wall ALONE invalidates a currently recognized element.
 * These are derived protections, not user pins. Combined edits still require revalidation.
 */
export function criticalWalls(maze:Maze):CriticalWall[]{
 if(maze.free){
  const r=freeRuntime(maze),result:CriticalWall[]=[],portals=[['входа',maze.entrance],['выхода',maze.exit]] as const;
  const before=portals.map(([,p])=>freePortalPrivacy(maze,p,3,false));
  for(const [index,wall]of r.panels.entries()){
   const protections:WallProtection[]=[];
   for(const [i,[name,portal]]of portals.entries())if(before[i]!.certified&&before[i]!.blockers.includes(wall)&&!freePortalPrivacy(maze,portal,3,false,index).certified)protections.push({kind:'portal',element:name,reason:`Экранирование ${name}`});
   if(protections.length)result.push({a:-1,b:-1,wall,protections});
  }
  return result;
 }
 const domain=domainOf(maze),privacy=mazePortalPrivacy(maze,false),traps=detailedCriticalWallsAvailable(maze)?routeTraps(maze):null,order=new Map(shortestPath(maze).map((c,i)=>[c,i]));
 const forks=[...new Set((traps?.candidates??[]).filter(t=>t.qualifies).map(t=>t.fork))].sort((a,b)=>order.get(a)!-order.get(b)!);
 const loops=detailedCriticalWallsAvailable(maze)?loopTraps(maze).candidates.filter(t=>t.qualifies):[];
 const result:CriticalWall[]=[];
 for(const a of domain.cells)for(const b of neighbors(maze,a))if(b>a&&!maze.passages[a]!.includes(b)){
   const r=domain.rectangles[a]!,q=domain.rectangles[b]!,horizontal=Math.abs(r.z1-q.z1)<1e-8;
   const wall:Wall=horizontal?{x1:r.x2,z1:Math.max(r.z1,q.z1),x2:r.x2,z2:Math.min(r.z2,q.z2)}:{x1:Math.max(r.x1,q.x1),z1:r.z2,x2:Math.min(r.x2,q.x2),z2:r.z2};
   if(maze.storeys)wall.floor=maze.storeys.nodes[a]!.floor;
   const protections:WallProtection[]=[];
   if(maze.storeys){const passages=maze.passages.map(v=>[...v]);passages[a]!.push(b);passages[b]!.push(a);if(!validFloorChanges({...maze,passages}))protections.push({kind:'floor',element:'floor-changes',reason:'Обязательные смены этажей'});}
   for(const [name,p] of [['входа',privacy.entrance],['выхода',privacy.exit]] as const)if(p.certified&&p.blockers.some(blocker=>overlaps(wall,blocker)))protections.push({kind:'portal',element:name,reason:`Экранирование ${name}`});
   if(forks.length||loops.length){
     const passages=[...maze.passages];passages[a]=[...passages[a]!,b].sort((x,y)=>x-y);passages[b]=[...passages[b]!,a].sort((x,y)=>x-y);
     const after=new Set(routeTraps({...maze,passages}).candidates.filter(t=>t.qualifies).map(t=>t.fork));
     const loopForks=loops.length?new Set(loopTraps({...maze,passages}).candidates.filter(t=>t.qualifies).map(t=>t.fork)):new Set<number>();
     for(const [i,t] of loops.entries())if(!loopForks.has(t.fork))protections.push({kind:'loop',element:`loop:${t.fork}`,reason:`Кольцевая ловушка К${i+1}: возврат на ту же развилку`});
     for(const [i,fork] of forks.entries())if(!after.has(fork))protections.push({kind:'trap',element:`trap:${fork}`,reason:`Ловушка Л${i+1}: тупиковая ветка или необходимый обход`});
   }
   if(protections.length)result.push({a,b,wall,protections});
 }
 return result;
}
export function criticalWallAt(walls:readonly CriticalWall[],point:Point,tolerance:number):CriticalWall|undefined {
 let best:CriticalWall|undefined,distance=tolerance;
 for(const item of walls){const d=segmentDistance(point,item.wall);if(d<=distance){best=item;distance=d;}}
 return best;
}
