import {spatialEdgeLength} from '../core/two-storey';
import type { Maze } from '../core/maze';
import { cellCenter } from '../core/maze';
import { domainOf } from '../core/domain';
import { metrics } from '../core/metrics';
import { shortestPath } from '../core/pathfinding';
/** Forecasts unique side exploration only: mandatory travel and replay cannot inflate the score. */
export function expectedExploration(maze: Maze, probability: ArrayLike<number>) {
  const m = metrics(maze);
  if (m.components !== 1 || m.cycles !== 0)
    throw new Error('Прогноз разведки требует дерева проходов.');
  const domain = domainOf(maze);
  for (const c of domain.cells) {
    const p = probability[c];
    if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1)
      throw new Error('Некорректная вероятность посещения.');
  }
  const route = new Set(shortestPath(maze)), seen = new Set([maze.entrance.cell]), queue = [maze.entrance.cell];
  let optionalArea = 0, visitedArea = 0, uniqueLength = 0;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const n of maze.passages[c]!) {
      if (seen.has(n))
        continue;
      seen.add(n);
      queue.push(n);
      const p = probability[n];
      if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1)
        throw new Error('Некорректная вероятность посещения.');
      if (!route.has(n)) {
        const a = cellCenter(maze, c), b = cellCenter(maze, n), r = domain.rectangles[n]!;
        const area = (r.x2 - r.x1) * (r.z2 - r.z1);
        optionalArea += area;
        visitedArea += p * area;
        uniqueLength += 2 * p * (maze.storeys?spatialEdgeLength(maze,c,n):Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
  }
  return { optionalArea, visitedArea, visitedRatio: optionalArea ? visitedArea / optionalArea : 0, uniqueLength, uniqueRatio: uniqueLength / m.optimalLength };
}
