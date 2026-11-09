import type {Maze} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
import {metrics} from '../core/metrics';
import {cellSize} from '../core/maze';
import {edgeKey,type GuardConstraints} from './guarded';
import {routeTraps} from '../analysis/route-traps';
import {corridorQuality} from '../analysis/corridor-quality';

/** Redirect a former route into a dead end, reconnecting the exit through another branch.
 * Every exchange preserves a spanning tree and the protected portal pockets.
 * Uses the same trap geometry measured by the assessment; no separate selection formula.
 */
export function routeTrapCandidates(base:Maze,guard:GuardConstraints,straightLimit=12,runLimit=20,limit=12,minimumTraps=1):Maze[]{
  const solution=shortestPath(base),solutionEdges=new Set(solution.slice(1).map((n,i)=>edgeKey(solution[i]!,n)));
  const archive:{maze:Maze;score:number}[]=[];
  for(const [a,b] of guard.allowed){
    if(base.passages[a]!.includes(b))continue;
    const path=shortestPath(base,a,b);
    for(let i=1;i<path.length;i++){
      const c=path[i-1]!,d=path[i]!,key=edgeKey(c,d);
      if(guard.locked.has(key)||!solutionEdges.has(key))continue;
      const passages=[...base.passages];
      for(const n of new Set([a,b,c,d]))passages[n]=[...passages[n]!];
      passages[a]!.push(b);passages[b]!.push(a);
      passages[c]=passages[c]!.filter(n=>n!==d);passages[d]=passages[d]!.filter(n=>n!==c);
      for(const n of new Set([a,b,c,d]))passages[n]!.sort((x,y)=>x-y);
      const maze={...base,passages},route=shortestPath(maze);
      const ratio=route.reduce((sum,n)=>{const s=cellSize(maze,n);return sum+s.width*s.depth;},0)/metrics(maze).area;
      if(ratio<.35||ratio>.55)continue;
      const traps=routeTraps(maze);if(traps.qualifiedCount<minimumTraps)continue;
      const corridors=corridorQuality(maze,straightLimit);
      if(corridors.longestForcedStraight>straightLimit||corridors.longestForcedRun>runLimit)continue;
      archive.push({maze,score:traps.best!.score});archive.sort((x,y)=>y.score-x.score);
      if(archive.length>limit)archive.pop();
    }
  }
  return archive.map(row=>row.maze);
}

/** Seed multiple traps on arbitrary footprints, rather than requiring a pre-existing pair or a P template. */
export function bootstrapRouteTraps(base:Maze,guard:GuardConstraints,requested:number):Maze[]{
  const initial=routeTraps(base).qualifiedCount;
  if(initial>=requested)return [base];
  let beam=[base];
  for(let count=initial+1;count<=requested;count++){
    const candidates=new Map<string,Maze>();
    for(const source of beam)for(const maze of routeTrapCandidates(source,guard,40,100,3,count))candidates.set(JSON.stringify(maze.passages),maze);
    beam=[...candidates.values()].sort((a,b)=>routeTraps(b).best!.score-routeTraps(a).best!.score).slice(0,3);
    if(!beam.length)return [];
  }
  return beam;
}
