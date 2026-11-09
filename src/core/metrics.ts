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
  return {
    cells, corridors, components, cycles: corridors - cells + components,
    deadEnds: maze.passages.filter(p => p.length === 1).length,
    junctions: maze.passages.filter(p => p.length >= 3).length,
    reachable: route.length > 0, optimalLength, area, routeAreaRatio: optimalLength / area,
  };
}
