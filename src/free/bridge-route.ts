import type {Maze,Point} from '../core/maze';
import {routePoints} from '../core/pathfinding';
import {freeRuntime} from './layout';
import {bridgeGeometry} from './bridges';
import {edges,ends,intersection,lerp,pointIn,distance} from './geometry';

/** Count positive ground distance inside an elevated deck, not a touch of a post. */
export function underBridgeIds(maze:Maze,path:readonly Point[]):string[]{
 return (maze.free?.bridges??[]).filter(b=>{
  const deck=bridgeGeometry(maze.free!,b).deck;
  return path.slice(1).some((q,i)=>{
   const p=path[i]!;if(p.bridge||q.bridge||(p.y??0)>.001||(q.y??0)>.001)return false;
   const events=[0,1,...edges(deck).flatMap(w=>{const t=intersection(p,q,...ends(w));return t===null?[]:[t];})].sort((a,b)=>a-b);
   return events.slice(1).some((hi,j)=>distance(p,q)*(hi-events[j]!)>.1&&pointIn(lerp(p,q,(hi+events[j]!)/2),deck,false));
  });
 }).map(b=>b.id);
}
export function bridgeRouteSummary(maze:Maze){
 const r=freeRuntime(maze),bridges=new Set((maze.free!.bridges??[]).map(b=>b.id)),adj=r.rooms.map(()=>[] as {to:number;id?:string;under:boolean}[]);
 for(const link of r.links){const id=link.connection??link.points.find(p=>p.bridge)?.bridge,under=underBridgeIds(maze,r.edgePaths.get(`${link.a}:${link.b}`)??link.points).length>0;adj[link.a]!.push({to:link.b,id,under});adj[link.b]!.push({to:link.a,id,under});}
 const reachable=(exclude:(id:string|undefined,under:boolean)=>boolean)=>{const seen=new Set([maze.entrance.cell]),q=[maze.entrance.cell];for(const a of q)for(const e of adj[a]!)if(!exclude(e.id,e.under)&&!seen.has(e.to)){seen.add(e.to);q.push(e.to);}return seen.has(maze.exit.cell);};
 const cost=new Float64Array(r.rooms.length).fill(Infinity),q=[maze.entrance.cell];cost[maze.entrance.cell]=0;
 for(let i=0;i<q.length;i++)for(const e of adj[q[i]!]!){const value=cost[q[i]!]!+Number(bridges.has(e.id??''));if(value<cost[e.to]!){cost[e.to]=value;q.push(e.to);}}
 const path=routePoints(maze),over=[...new Set(path.filter(p=>(p.y??0)>.01&&p.bridge).map(p=>p.bridge!))],under=underBridgeIds(maze,path);
 const endpointUnder=[maze.free!.entrance,maze.free!.exit].some(id=>underBridgeIds(maze,r.portalPaths.get(id)??[]).length>0);
 return {total:bridges.size,minimumCrossings:cost[maze.exit.cell]!,required:[...bridges].filter(id=>!reachable(other=>other===id)),routeOver:over,routeUnder:under,underpassRequired:endpointUnder||!reachable((_,under)=>under)};
}
export function bridgeRouteErrors(maze:Maze):string[]{
 const p=maze.parameters;if(!p.freeRequiredBridgeCount&&!p.freeRequireUnderpass)return [];
 const r=bridgeRouteSummary(maze),errors:string[]=[];
 if(r.total!==(p.freeBridgeCount??0))errors.push('Не выполнено общее число мостов.');
 if(p.freeRequiredBridgeCount&&(r.minimumCrossings!==p.freeRequiredBridgeCount||r.required.length!==p.freeRequiredBridgeCount||r.routeOver.length!==p.freeRequiredBridgeCount))errors.push('Маршрут не проходит через заданное число обязательных мостов.');
 if(p.freeRequireUnderpass&&(!r.underpassRequired||!r.routeUnder.length))errors.push('На пути к выходу нет обязательного нижнего прохода.');
 return errors;
}
