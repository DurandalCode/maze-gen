import {spatialDistance,spatialEdgePoints,spatialEdgeLength,spatialShortestPath} from './two-storey';
import {freeRoute} from '../free/layout';
import {corridorRoute} from './corridor-navigation';
import { domainOf } from './domain';
import { cellCenter, portalPoint, type Maze, type Point } from './maze';

export function shortestPath(maze: Maze, from = maze.entrance.cell, to = maze.exit.cell): number[] {
  if(maze.storeys)return spatialShortestPath(maze,from,to);
  if((maze.version===5||maze.version===7))return freeRoute(maze,from,to).regions;
  if(maze.navigation&&from===maze.entrance.cell&&to===maze.exit.cell)return corridorRoute(maze).regions;
  if((maze.version===4&&!maze.navigation)||maze.storeys)return weightedPath(maze,from,to);
  if (!domainOf(maze).active[from] || !domainOf(maze).active[to]) return [];
  const parent = new Int32Array(maze.passages.length).fill(-1);
  const queue = [from]; parent[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === to) break;
    for (const next of maze.passages[cell]!) if (parent[next] === -1) {
      parent[next] = cell; queue.push(next);
    }
  }
  if (parent[to] === -1) return [];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(parent[path[path.length - 1]!]!);
  return path.reverse();
}

/** Same boundary-to-boundary convention as a recorded traversal. */
export function routePoints(maze: Maze): Point[] {
  if((maze.version===5||maze.version===7))return freeRoute(maze).points;
  if(maze.version===4)return corridorRoute(maze).points;
  const path = shortestPath(maze);
  if(maze.storeys&&path.length)return [portalPoint(maze,maze.entrance),cellCenter(maze,path[0]!),...path.slice(1).flatMap((c,i)=>spatialEdgePoints(maze,path[i]!,c).slice(1)),portalPoint(maze,maze.exit)];
  return path.length ? [portalPoint(maze, maze.entrance), ...path.map(c => cellCenter(maze, c)), portalPoint(maze, maze.exit)] : [];
}

export function pathLength(points: readonly Point[]): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += spatialDistance(points[i]!,points[i-1]!);
  return distance;
}

function weightedPath(maze:Maze,from:number,to:number):number[]{
 if(!domainOf(maze).active[from]||!domainOf(maze).active[to])return [];
 const n=maze.passages.length,dist=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),done=new Uint8Array(n),centers=Array.from({length:n},(_,i)=>cellCenter(maze,i));dist[from]=0;
 for(let j=0;j<n;j++){let a=-1;for(let i=0;i<n;i++)if(!done[i]&&(a<0||dist[i]!<dist[a]!))a=i;if(a<0||!Number.isFinite(dist[a]!))break;if(a===to)break;done[a]=1;for(const b of maze.passages[a]!){const value=dist[a]!+(maze.storeys?spatialEdgeLength(maze,a,b):spatialDistance(centers[a]!,centers[b]!));if(value<dist[b]!){dist[b]=value;parent[b]=a;}}}
 if(!Number.isFinite(dist[to]!))return [];const path=[to];while(path.at(-1)!==from)path.push(parent[path.at(-1)!]!);return path.reverse();
}
