import { domainOf } from '../core/domain';
import { cellCenter, portalPoint, type Maze, type Point } from '../core/maze';
import { shortestPath, pathLength } from '../core/pathfinding';
import { prepareNavigation } from './navigation';
import { viewCorridor } from './corridor-view';
import { visibleDeadEnd } from './visible-deadends';
export interface CorridorQuality {
  /** Meaningful choice excludes only a fully visible straight blind tail. */
  longestForcedRun: number;
  graphLongestForcedRun: number;
  graphLongestForcedStraight: number;
  graphLongestMandatoryForcedRun: number;
  graphLongestMandatoryForcedStraight: number;
  graphRouteForks: number;
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
interface ChainMeasurements {
  longestRun: number; longestStraight: number;
  mandatoryRun: number; mandatoryStraight: number; longStraight: number;
}
/** Each physical edge is visited once, including components that are pure cycles. */
function measureChains(maze: Maze, cells: readonly number[], adjacent: readonly number[][], routeEdges: ReadonlySet<string>, straightLimit: number): ChainMeasurements {
  const anchors = new Set(cells.filter(c => adjacent[c]!.length !== 2 || c === maze.entrance.cell || c === maze.exit.cell));
  const seen = new Set<string>();
  const result: ChainMeasurements = { longestRun: 0, longestStraight: 0, mandatoryRun: 0, mandatoryStraight: 0, longStraight: 0 };
  const visit = (start: number, next: number) => {
    if (seen.has(edgeKey(start, next))) return;
    const chain = [start, next]; seen.add(edgeKey(start, next));
    let from = start, at = next;
    while (!anchors.has(at)) {
      const onward = adjacent[at]!.find(n => n !== from);
      if (onward === undefined || seen.has(edgeKey(at, onward))) break;
      seen.add(edgeKey(at, onward)); chain.push(onward); from = at; at = onward;
    }
    const mandatory = chain.slice(1).every((c, i) => routeEdges.has(edgeKey(chain[i]!, c)));
    const points = chain.map(c => cellCenter(maze, c));
    if (mandatory) for (const portal of [maze.entrance, maze.exit]) {
      if (chain[0] === portal.cell) points.unshift(portalPoint(maze, portal));
      if (chain.at(-1) === portal.cell) points.push(portalPoint(maze, portal));
    }
    const length = pathLength(points), segments = straightSegments(points);
    result.longestRun = Math.max(result.longestRun, length);
    for (const segment of segments) result.longestStraight = Math.max(result.longestStraight, segment);
    if (mandatory) {
      result.mandatoryRun = Math.max(result.mandatoryRun, length);
      for (const segment of segments) {
        result.mandatoryStraight = Math.max(result.mandatoryStraight, segment);
        if (segment > straightLimit + 1e-8) result.longStraight += segment;
      }
    }
  };
  for (const start of anchors) for (const next of adjacent[start]!) visit(start, next);
  // A disconnected ring has no graph anchor. Count its perimeter once instead of ignoring it.
  for (const start of cells) for (const next of adjacent[start]!) visit(start, next);
  return result;
}
/** Long forced travel is separate from a useful long perspective containing real choices. */
export function corridorQuality(maze: Maze, straightLimit = 12): CorridorQuality {
  if (!Number.isFinite(straightLimit) || straightLimit < 2 || straightLimit > 40)
    throw new Error('Предел прямого участка должен быть от 2 до 40 м.');
  const domain = domainOf(maze), route = shortestPath(maze);
  const routeEdges = new Set(route.slice(1).map((c, i) => edgeKey(route[i]!, c)));
  const context = prepareNavigation(maze);
  const graph = measureChains(maze, domain.cells, maze.passages, routeEdges, straightLimit);
  // Proofs are local to this evaluation: callers may edit passages on the same Maze.
  // No ray is extended around a bend, through a junction, beyond sight range or past a portal.
  const proofMaze = { ...maze }, omitted = new Set<number>();
  for (const from of domain.cells) {
    if (maze.passages[from]!.length < 3 && from !== maze.entrance.cell) continue;
    for (const to of maze.passages[from]!) {
      const proof = visibleDeadEnd(proofMaze, from, to, context);
      if (proof) for (const cell of proof.cells) omitted.add(cell);
    }
  }
  const meaningfulCells = domain.cells.filter(c => !omitted.has(c));
  const meaningfulAdjacent = maze.passages.map((links, c) => omitted.has(c) ? [] : links.filter(n => !omitted.has(n)));
  const meaningful = measureChains(maze, meaningfulCells, meaningfulAdjacent, routeEdges, straightLimit);
  const optimalPoints = route.length ? [portalPoint(maze, maze.entrance), ...route.map(c => cellCenter(maze, c)), portalPoint(maze, maze.exit)] : [];
  const optimal = pathLength(optimalPoints);
  // A single-cell route has physical boundary-to-boundary length despite having no graph edges.
  if (route.length === 1) {
    const segments = straightSegments(optimalPoints), straight = Math.max(0, ...segments);
    for (const value of [graph, meaningful]) {
      value.longestRun = Math.max(value.longestRun, optimal);
      value.longestStraight = Math.max(value.longestStraight, straight);
      value.mandatoryRun = optimal; value.mandatoryStraight = straight;
      value.longStraight = segments.filter(n => n > straightLimit + 1e-8).reduce((a, b) => a + b, 0);
    }
  }
  let longestVisibleStraight = 0;
  // Physical rays always use the original maze, never the choice-pruned adjacency.
  for (const from of domain.cells) for (const to of maze.passages[from]!)
    longestVisibleStraight = Math.max(longestVisibleStraight, viewCorridor(maze, context, from, to, Infinity).length);
  if (domain.cells.length === 1) {
    const rectangle = domain.rectangles[domain.cells[0]!]!;
    longestVisibleStraight = Math.max(rectangle.x2 - rectangle.x1, rectangle.z2 - rectangle.z1);
  }
  const graphRouteForks = route.slice(0, -1).filter((c, i) => maze.passages[c]!.filter(n => n !== route[i - 1]).length > 1).length;
  const routeForks = route.slice(0, -1).filter((c, i) => meaningfulAdjacent[c]!.filter(n => n !== route[i - 1]).length > 1).length;
  return {
    // Obvious side tails still have real physical length; retain their graph-run maximum.
    longestForcedRun: Math.max(graph.longestRun, meaningful.longestRun),
    longestForcedStraight: Math.max(graph.longestStraight, meaningful.longestStraight),
    longestMandatoryForcedRun: meaningful.mandatoryRun,
    longestMandatoryForcedStraight: meaningful.mandatoryStraight,
    longMandatoryStraightRatio: optimal ? meaningful.longStraight / optimal : 0,
    graphLongestForcedRun: graph.longestRun, graphLongestForcedStraight: graph.longestStraight,
    graphLongestMandatoryForcedRun: graph.mandatoryRun, graphLongestMandatoryForcedStraight: graph.mandatoryStraight,
    graphRouteForks, longestVisibleStraight, routeForks,
    choicesPer100Metres: optimal ? 100 * routeForks / optimal : 0, straightLimit,
  };
}
