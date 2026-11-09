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
  const a=context.centers[from]!,b=context.centers[to]!,dx=Math.sign(b.x-a.x),dz=Math.sign(b.z-a.z);
  let previous=from,cell=to,length=edgeLength(context,from,to),junctions=0;
  while(true) {
    if(length>=maxDistance) return {length:maxDistance,endCell:cell,junctions,end:'limit'};
    if(cell===maze.exit.cell) return {length,endCell:cell,junctions,end:'exit'};
    const links=maze.passages[cell]!;
    if(links.length>=3)junctions++;
    const forward=links.find(next=> {
      const p=context.centers[next]!;return next!==previous && Math.sign(p.x-context.centers[cell]!.x)===dx && Math.sign(p.z-context.centers[cell]!.z)===dz;
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
