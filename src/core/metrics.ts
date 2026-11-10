import {corridorNavigation} from './corridor-navigation';
import {routingSize} from './maze';
import { domainOf } from './domain';
import type { Maze } from './maze';
import { componentCount } from './graph';
import { pathLength, routePoints } from './pathfinding';

export function metrics(maze: Maze) {
  const cells = domainOf(maze).cells.length;
  const corridors = maze.passages.reduce((sum, links) => sum + links.length, 0) / 2;
  const components = componentCount(maze);
  const route = routePoints(maze), optimalLength = pathLength(route);
  const area = domainOf(maze).area;
  let filled=0;
  if(maze.version===4&&!maze.navigation){const w=routingSize(maze).columns,active=domainOf(maze).active;for(const a of domainOf(maze).cells){const b=a+1,c=a+w,e=c+1;if(a%w===w-1||!active[b]||!active[c]||!active[e])continue;if(maze.passages[a]!.includes(b)&&maze.passages[a]!.includes(c)&&maze.passages[b]!.includes(e)&&maze.passages[c]!.includes(e))filled++;}}
  const semantic=maze.version===4&&!maze.navigation?corridorNavigation(maze):maze;
  return {
    cells:domainOf(semantic).cells.length, corridors:semantic.passages.reduce((sum,links)=>sum+links.length,0)/2, components, cycles: corridors - cells + components - filled,
    deadEnds: semantic.passages.filter(p => p.length === 1).length,
    junctions: semantic.passages.filter(p => p.length >= 3).length,
    reachable: route.length > 0, optimalLength, area, routeAreaRatio: optimalLength / area,
  };
}
