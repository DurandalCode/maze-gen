import {spatialVisibleCells} from '../core/spatial-visibility';
import {domainOf} from '../core/domain';
import {rayDistance,openingMidpoint} from '../core/corridor-navigation';
import {cellAtPoint} from './navigation';
import { cellSize, type Maze } from '../core/maze';
import { edgeLength, type NavigationContext } from './navigation';

export interface CorridorView {
  length: number;
  endCell: number;
  junctions: number;
  end: 'limit' | 'bend' | 'dead-end' | 'exit';
}
export const CORRIDOR_SIGHT_METRES=24;
/** Look only along a straight, unobstructed passage. No information around corners or through fabric. */
export function viewCorridor(maze:Maze,context:NavigationContext,from:number,to:number,maxDistance=CORRIDOR_SIGHT_METRES):CorridorView {
  if(!maze.passages[from]?.includes(to)) throw new Error('Направление коридора должно быть открытым проходом.');
  if(maze.version===5){const a=context.centers[from]!,b=openingMidpoint(maze,from,to),angle=Math.atan2(b.z-a.z,b.x-a.x),length=rayDistance(maze,a,angle,maxDistance);return {length,endCell:to,junctions:maze.passages[to]!.length>=3?1:0,end:length<maxDistance?'bend':'limit'};}
  if(maze.navigation){const a=context.centers[from]!,b=openingMidpoint(maze,from,to),angle=Math.atan2(b.z-a.z,b.x-a.x),dx=Math.cos(angle),dz=Math.sin(angle);let limit=Math.min(maxDistance,Math.hypot(maze.width,maze.depth));
    // An unobstructed ray through an external opening still ends at the site
    // boundary; the outdoors is not an infinitely long maze corridor.
    for(const {wall:w}of domainOf(maze.navigation.source).boundary){const vertical=w.x1===w.x2,direction=vertical?dx:dz;if(Math.abs(direction)<1e-9)continue;const t=((vertical?w.x1:w.z1)-(vertical?a.x:a.z))/direction,v=(vertical?a.z:a.x)+(vertical?dz:dx)*t,lo=vertical?w.z1:w.x1,hi=vertical?w.z2:w.x2;if(t>1e-7&&v>=lo-1e-7&&v<=hi+1e-7)limit=Math.min(limit,t);}
    const length=rayDistance(maze.navigation.source,a,angle,limit),endCell=cellAtPoint(maze,{x:a.x+Math.cos(angle)*Math.max(0,length-.01),z:a.z+Math.sin(angle)*Math.max(0,length-.01)})??to;return {length,endCell,junctions:maze.passages[endCell]!.length>=3?1:0,end:endCell===maze.exit.cell?'exit':length>=maxDistance?'limit':maze.passages[endCell]!.length===1?'dead-end':'bend'};}
  const a=context.centers[from]!,b=context.centers[to]!,dx=Math.sign(b.x-a.x),dz=Math.sign(b.z-a.z);
  if(maze.storeys){if(Math.abs((a.y??0)-(b.y??0))>1e-7)return {length:Math.min(maxDistance,edgeLength(context,from,to)),endCell:from,junctions:0,end:'bend'};maxDistance=Math.min(maxDistance,spatialVisibleCells(maze,from,Math.atan2(b.z-a.z,b.x-a.x),maxDistance).length);}
  let previous=from,cell=to,length=edgeLength(context,from,to),junctions=0;
  while(true) {
    if(length>=maxDistance) return {length:maxDistance,endCell:cell,junctions,end:'limit'};
    if(cell===maze.exit.cell) return {length,endCell:cell,junctions,end:'exit'};
    const links=maze.passages[cell]!;
    if(links.length>=3)junctions++;
    const forward=links.find(next=> {
      const p=context.centers[next]!;return next!==previous && (!maze.storeys||Math.abs((p.y??0)-(context.centers[cell]!.y??0))<1e-7) && Math.sign(p.x-context.centers[cell]!.x)===dx && Math.sign(p.z-context.centers[cell]!.z)===dz;
    });
    if(forward===undefined) {
      const size=cellSize(maze,cell),endLength=Math.min(maxDistance,length+(dx?size.width:size.depth)/2);
      return {length:endLength,endCell:cell,junctions,end:links.some(next=>next!==previous)?'bend':'dead-end'};
    }
    const nextLength=length+edgeLength(context,cell,forward);
    if(nextLength>maxDistance) return {length:maxDistance,endCell:cell,junctions,end:'limit'};
    previous=cell;cell=forward;length=nextLength;
  }
}
