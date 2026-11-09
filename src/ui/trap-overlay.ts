import {cellCenter,type Maze,type Point} from '../core/maze';
import {shortestPath} from '../core/pathfinding';
import {routeTraps,type RouteTrap,type RouteTraps} from '../analysis/route-traps';

export interface TrapOverlayEntry {
  label:string; fork:number; point:Point; members:RouteTrap[];
  falsePaths:Point[][]; awayPath:Point[]; deadEnds:Point[];
}
/** Render the exact qualified candidates used by assessment; do not infer traps from heat or walks. */
export function trapOverlay(maze:Maze,analysis:RouteTraps=routeTraps(maze)):TrapOverlayEntry[]{
  const groups=new Map<number,RouteTrap[]>();
  for(const trap of analysis.candidates)if(trap.qualifies){const group=groups.get(trap.fork)??[];group.push(trap);groups.set(trap.fork,group);}
  const order=new Map(shortestPath(maze).map((c,i)=>[c,i]));
  return [...groups.entries()].sort(([a],[b])=>order.get(a)!-order.get(b)!).map(([fork,members],index)=>{
    const unique=[...new Map(members.map(t=>[t.falsePath.join(','),t])).values()];
    return {label:`Л${index+1}`,fork,point:cellCenter(maze,fork),members:unique,
      falsePaths:unique.map(t=>t.falsePath.map(c=>cellCenter(maze,c))),
      awayPath:unique[0]!.correctAwayPath.map(c=>cellCenter(maze,c)),
      deadEnds:[...new Set(unique.map(t=>t.deadEnd))].map(c=>cellCenter(maze,c))};
  });
}
export function trapDetailsAt(entries:readonly TrapOverlayEntry[],cell:number):string[]{
  return entries.flatMap(entry=>{
    const roles:string[]=[];
    if(entry.fork===cell)roles.push('развилка ловушки');
    else {
      if(entry.members.some(t=>t.deadEnd===cell))roles.push('ложный тупик');
      else if(entry.members.some(t=>t.falsePath.includes(cell)))roles.push('ложное продвижение');
      if(entry.members[0]!.correctAwayPath.includes(cell))roles.push('правильный путь: начальное удаление от цели');
    }
    return roles.length?[`${entry.label}: ${roles.join('; ')}`]:[];
  });
}
