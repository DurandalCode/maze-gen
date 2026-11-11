import {freeGraphPath} from '../free/layout';
import {corridorPathPoints,corridorNavigation,corridorRoute} from '../core/corridor-navigation';
import {cellCenter,type Maze,type Point} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
import {loopTraps,type LoopTrap} from '../analysis/loop-traps';
import {routeTraps,type RouteTrap,type RouteTraps} from '../analysis/route-traps';

export interface TrapOverlayEntry {
  kind:'dead-end'|'loop'; loop?:LoopTrap; label:string; fork:number; point:Point; members:RouteTrap[];
  falsePaths:Point[][]; awayPath:Point[]; deadEnds:Point[];
}
/** Render the exact qualified candidates used by assessment; do not infer traps from heat or walks. */
export function trapOverlay(maze:Maze,analysis:RouteTraps=routeTraps(maze)):TrapOverlayEntry[]{
  const groups=new Map<number,RouteTrap[]>();
  for(const trap of analysis.candidates)if(trap.qualifies){const group=groups.get(trap.fork)??[];group.push(trap);groups.set(trap.fork,group);}
  const graph=maze.version===4?corridorNavigation(maze):null,route=graph?corridorRoute(maze).regions.map(c=>graph.navigation!.representatives[c]!):shortestPath(maze),point=(c:number)=>graph?graph.navigation!.centers[graph.navigation!.originalToRegion[c]!]!:cellCenter(maze,c);
  const path=(cells:number[])=>maze.free?freeGraphPath(maze,cells):maze.version===4?corridorPathPoints(maze,cells):cells.map(c=>cellCenter(maze,c));
  const order=new Map(route.map((c,i)=>[c,i]));
  const dead:TrapOverlayEntry[]=[...groups.entries()].sort(([a],[b])=>order.get(a)!-order.get(b)!).map(([fork,members],index)=>{
    const unique=[...new Map(members.map(t=>[t.falsePath.join(','),t])).values()];
    return {kind:'dead-end',label:`Л${index+1}`,fork,point:point(fork),members:unique,
      falsePaths:unique.map(t=>path(t.falsePath)),
      awayPath:path(unique[0]!.correctAwayPath),
      deadEnds:[...new Set(unique.map(t=>t.deadEnd))].map(c=>cellCenter(maze,c))};
  });
  const loops:TrapOverlayEntry[]=loopTraps(maze).candidates.filter(t=>t.qualifies).sort((a,b)=>order.get(a.fork)!-order.get(b.fork)!).map((t,i)=>({
    kind:'loop',loop:t,label:`К${i+1}`,fork:t.fork,point:point(t.fork),members:[],
    falsePaths:[path(t.loop)],awayPath:path(t.correctPath),deadEnds:[]
  }));
  return [...dead,...loops];
}
export function trapDetailsAt(entries:readonly TrapOverlayEntry[],cell:number):string[]{
  return entries.flatMap(entry=>{
    const roles:string[]=[];
    if(entry.kind==='loop'){
      if(entry.fork===cell){roles.push('перекрёсток: два ложных выхода возвращают сюда');const c=entry.loop!.credibility;if(c)roles.push(`направленный контроль: минимум ${c.commitmentDistance.toFixed(1)} м до первого возврата, ${c.branchingDecisions} решений, замыканий ${c.loopReturns}/4`);}
      else if(entry.loop!.loop.includes(cell))roles.push('кольцевой возврат на исходную развилку');
      else if(entry.loop!.correctPath.includes(cell))roles.push('продолжение к финишу');
      return roles.length?[`${entry.label}: ${roles.join('; ')}`]:[];
    }
    if(entry.fork===cell)roles.push('развилка ловушки');
    else {
      if(entry.members.some(t=>t.deadEnd===cell))roles.push('ложный тупик');
      else if(entry.members.some(t=>t.falsePath.includes(cell)))roles.push('ложное продвижение');
      if(entry.members[0]!.correctAwayPath.includes(cell))roles.push('правильный путь: начальное удаление от цели');
    }
    return roles.length?[`${entry.label}: ${roles.join('; ')}`]:[];
  });
}
