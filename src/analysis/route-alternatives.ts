import type {Maze} from '../core/maze';
import {domainOf} from '../core/domain';
import {cellCenter} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
export interface RouteAlternatives {
 routeLength:number;
 unavoidableLength:number;
 unavoidableRatio:number;
 alternativeLength:number;
 alternativeRatio:number;
 alternativeSections:number;
 longestUnavoidableRun:number;
}
const key=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
interface Structure {signature:string;value:RouteAlternatives;routeBridges:Set<string>;edgeLength:(a:number,b:number)=>number}
const cache=new WeakMap<Maze,Structure>();
/** Iterative bridge search keeps 100x100 workspaces safe from recursion overflow.
 * Only cycles covering route edges count as alternatives; a pendant false loop does not.
 */
function structure(maze:Maze):Structure {
 const signature=JSON.stringify([maze.parameters,maze.entrance.cell,maze.exit.cell,maze.passages]);
 const known=cache.get(maze);if(known?.signature===signature)return known;
 const domain=domainOf(maze),size=maze.passages.length,disc=new Int32Array(size),low=new Int32Array(size),parent=new Int32Array(size).fill(-1),bridges=new Set<string>();let clock=0;
 for(const start of domain.cells){
  if(disc[start])continue;
  disc[start]=low[start]=++clock;
  const stack=[{cell:start,index:0}];
  while(stack.length){
   const frame=stack.at(-1)!,u=frame.cell,links=maze.passages[u]!;
   if(frame.index<links.length){
    const v=links[frame.index++]!;if(!domain.active[v]||v===parent[u])continue;
    if(!disc[v]){parent[v]=u;disc[v]=low[v]=++clock;stack.push({cell:v,index:0});}
    else low[u]=Math.min(low[u]!,disc[v]!);
   }else{
    stack.pop();const p=parent[u]!;
    if(p>=0){low[p]=Math.min(low[p]!,low[u]!);if(low[u]!>disc[p]!)bridges.add(key(u,p));}
   }
  }
 }
 const route=shortestPath(maze),centers=domain.cells.reduce((m,c)=>m.set(c,cellCenter(maze,c)),new Map<number,ReturnType<typeof cellCenter>>());
 const edgeLength=(a:number,b:number)=>{const p=centers.get(a)!,q=centers.get(b)!;return Math.hypot(p.x-q.x,p.z-q.z);};
 let routeLength=0,unavoidableLength=0,longestUnavoidableRun=0,run=0,alternativeSections=0,wasAlternative=false;
 const routeBridges=new Set<string>();
 for(let i=1;i<route.length;i++){
  const a=route[i-1]!,b=route[i]!,length=edgeLength(a,b),bridge=bridges.has(key(a,b));routeLength+=length;
  if(bridge){routeBridges.add(key(a,b));unavoidableLength+=length;run+=length;wasAlternative=false;}
  else{if(!wasAlternative)alternativeSections++;wasAlternative=true;longestUnavoidableRun=Math.max(longestUnavoidableRun,run);run=0;}
 }
 longestUnavoidableRun=Math.max(longestUnavoidableRun,run);
 const unavoidableRatio=routeLength?unavoidableLength/routeLength:0,alternativeLength=routeLength-unavoidableLength;
 const value={routeLength,unavoidableLength,unavoidableRatio,alternativeLength,alternativeRatio:routeLength?alternativeLength/routeLength:0,alternativeSections,longestUnavoidableRun};
 const result={signature,value,routeBridges,edgeLength};cache.set(maze,result);return result;
}
export const routeAlternatives=(maze:Maze):RouteAlternatives=>structure(maze).value;
/** Route metres whose unique connection would gain an alternative after this wall opens.
 * This is a design metric, never information supplied to the simulated player.
 */
export function connectionRouteGain(maze:Maze,a:number,b:number):number {
 if(maze.passages[a]?.includes(b))return 0;
 const s=structure(maze),path=shortestPath(maze,a,b);
 return path.slice(1).reduce((sum,c,i)=>sum+(s.routeBridges.has(key(path[i]!,c))?s.edgeLength(path[i]!,c):0),0);
}
