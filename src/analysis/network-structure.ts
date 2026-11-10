import {corridorNavigation} from '../core/corridor-navigation';
import {domainOf} from '../core/domain';
import {cellCenter,portalPoint,type Maze} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
export interface NetworkStructure {interlinkedCycles:number;junctions:number;routeJunctions:number;cells:number}
/** Biconnected blocks distinguish interlinked detours from rings hanging off one junction. */
export function networkStructure(maze:Maze):NetworkStructure{
 if(maze.version===4&&!maze.navigation)return networkStructure(corridorNavigation(maze));

 const domain=domainOf(maze),route=new Set(shortestPath(maze)),disc=new Int32Array(maze.passages.length),low=new Int32Array(disc.length),parent=new Int32Array(disc.length).fill(-1),edges:[number,number][]=[];
 let clock=0,best:NetworkStructure={interlinkedCycles:0,junctions:0,routeJunctions:0,cells:0};
 const block=(p:number,u:number)=>{
  const degree=new Map<number,number>();let count=0;
  while(edges.length){const [a,b]=edges.pop()!;count++;degree.set(a,(degree.get(a)??0)+1);degree.set(b,(degree.get(b)??0)+1);if(a===p&&b===u)break;}
  const cycles=count-degree.size+1;if(cycles<1)return;
  const junctions=[...degree].filter(([,n])=>n>=3).map(([c])=>c),value={interlinkedCycles:cycles,junctions:junctions.length,routeJunctions:junctions.filter(c=>route.has(c)).length,cells:degree.size};
  if(value.interlinkedCycles>best.interlinkedCycles||value.interlinkedCycles===best.interlinkedCycles&&value.junctions>best.junctions)best=value;
 };
 for(const start of domain.cells){
  if(disc[start])continue;disc[start]=low[start]=++clock;const stack=[{cell:start,index:0}];
  while(stack.length){const frame=stack.at(-1)!,u=frame.cell;
   if(frame.index<maze.passages[u]!.length){const v=maze.passages[u]![frame.index++]!;if(v===parent[u]||!domain.active[v])continue;
    if(!disc[v]){parent[v]=u;edges.push([u,v]);disc[v]=low[v]=++clock;stack.push({cell:v,index:0});}
    else if(disc[v]!<disc[u]!){edges.push([u,v]);low[u]=Math.min(low[u]!,disc[v]!);}
   }else{stack.pop();const p=parent[u]!;if(p>=0){low[p]=Math.min(low[p]!,low[u]!);if(low[u]!>=disc[p]!)block(p,u);}}
  }
 }
 return best;
}
export function coldNearExit(maze:Maze,probability:Float64Array,threshold:number,radius=8):{area:number;coldArea:number;ratio:number}{
 const domain=domainOf(maze),exit=portalPoint(maze,maze.exit);let area=0,coldArea=0;
 for(const c of domain.cells){const p=cellCenter(maze,c);if(Math.hypot(p.x-exit.x,p.z-exit.z)>radius)continue;const r=domain.rectangles[c]!,a=(r.x2-r.x1)*(r.z2-r.z1);area+=a;if(probability[c]!<threshold)coldArea+=a;}
 return {area,coldArea,ratio:area?coldArea/area:0};
}
