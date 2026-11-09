import type {Maze} from '../core/maze';
import {domainOf} from '../core/domain';
/** Minimum possible peak footprint distance on ANY graph path to the exit, including cyclic alternatives. */
export function minimaxRetreat(maze:Maze,distance:ArrayLike<number>):Float64Array {
  const cost=new Float64Array(maze.passages.length).fill(Infinity),done=new Uint8Array(maze.passages.length),cells=domainOf(maze).cells;
  cost[maze.exit.cell]=distance[maze.exit.cell]!;
  for(let i=0;i<cells.length;i++){
    let best=-1;
    for(const cell of cells)if(!done[cell]&&(best<0||cost[cell]!<cost[best]!))best=cell;
    if(best<0||!Number.isFinite(cost[best]))break;
    done[best]=1;
    for(const next of maze.passages[best]!){const value=Math.max(cost[best]!,distance[next]!);if(value<cost[next]!)cost[next]=value;}
  }
  return cost;
}
