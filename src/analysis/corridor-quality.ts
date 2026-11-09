import { domainOf } from '../core/domain';
import { cellCenter, portalPoint, type Maze, type Point } from '../core/maze';
import { shortestPath, pathLength } from '../core/pathfinding';
import { prepareNavigation } from './navigation';
import { viewCorridor } from './corridor-view';
export interface CorridorQuality {
  longestForcedRun: number;
  longestForcedStraight: number;
  longestMandatoryForcedRun: number;
  longestMandatoryForcedStraight: number;
  longMandatoryStraightRatio: number;
  longestVisibleStraight: number;
  routeForks: number;
  choicesPer100Metres: number;
  straightLimit: number;
}
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
function straightSegments(points: readonly Point[]) {
  const lengths: number[] = [];
  let previous = '', length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (!distance)
      continue;
    const direction = `${Math.sign(b.x - a.x)}:${Math.sign(b.z - a.z)}`;
    if (direction !== previous && length) {
      lengths.push(length);
      length = 0;
    }
    length += distance;
    previous = direction;
  }
  if (length)
    lengths.push(length);
  return lengths;
}
/** Long forced travel is separate from a useful long perspective containing real choices. */
export function corridorQuality(maze: Maze, straightLimit = 12): CorridorQuality {
  if (!Number.isFinite(straightLimit) || straightLimit < 2 || straightLimit > 40)
    throw new Error('Предел прямого участка должен быть от 2 до 40 м.');
  const domain = domainOf(maze), route = shortestPath(maze), routeEdges = new Set(route.slice(1).map((c, i) => edgeKey(route[i]!, c))), seen = new Set<string>(), context = prepareNavigation(maze);
  const anchors = new Set(domain.cells.filter(c => maze.passages[c]!.length !== 2 || c === maze.entrance.cell || c === maze.exit.cell));
  let longestForcedRun = 0, longestForcedStraight=0, longestMandatoryForcedRun = 0, longestMandatoryForcedStraight = 0, longStraight = 0, longestVisibleStraight = 0;
  for (const c of domain.cells)
    for (const n of maze.passages[c]!)
      longestVisibleStraight = Math.max(longestVisibleStraight, viewCorridor(maze, context, c, n, Infinity).length);
  for (const start of anchors)
    for (const next of maze.passages[start]!) {
      if (seen.has(edgeKey(start, next)))
        continue;
      const cells = [start, next];
      seen.add(edgeKey(start, next));
      let from = start, at = next;
      while (!anchors.has(at)) {
        const onward = maze.passages[at]!.find(n => n !== from);
        if (onward === undefined || seen.has(edgeKey(at, onward)))
          break;
        seen.add(edgeKey(at, onward));
        cells.push(onward);
        from = at;
        at = onward;
      }
      const mandatory = cells.slice(1).every((c, i) => routeEdges.has(edgeKey(cells[i]!, c))), points = cells.map(c => cellCenter(maze, c));
      if (mandatory) {
        for (const portal of [maze.entrance, maze.exit]) {
          if (cells[0] === portal.cell)
            points.unshift(portalPoint(maze, portal));
          if (cells.at(-1) === portal.cell)
            points.push(portalPoint(maze, portal));
        }
      }
      const length = pathLength(points);
      longestForcedRun = Math.max(longestForcedRun, length);
      for(const segment of straightSegments(points))longestForcedStraight=Math.max(longestForcedStraight,segment);
      if (mandatory) {
        longestMandatoryForcedRun = Math.max(longestMandatoryForcedRun, length);
        for (const segment of straightSegments(points)) {
          longestMandatoryForcedStraight = Math.max(longestMandatoryForcedStraight, segment);
          if (segment > straightLimit + 1e-8)
            longStraight += segment;
        }
      }
    }
  const optimal = pathLength([portalPoint(maze, maze.entrance), ...route.map(c => cellCenter(maze, c)), portalPoint(maze, maze.exit)]);
  const routeForks = route.slice(0, -1).filter((c, i) => maze.passages[c]!.filter(n => n !== route[i - 1]).length > 1).length;
  return { longestForcedRun, longestForcedStraight, longestMandatoryForcedRun, longestMandatoryForcedStraight, longMandatoryStraightRatio: optimal ? longStraight / optimal : 0, longestVisibleStraight, routeForks, choicesPer100Metres: optimal ? 100 * routeForks / optimal : 0, straightLimit };
}
