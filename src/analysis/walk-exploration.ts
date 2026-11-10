import {spatialEdgeLength} from '../core/two-storey';
import type { Maze } from '../core/maze';
import { cellCenter, portalPoint } from '../core/maze';
import { domainOf } from '../core/domain';
import { metrics } from '../core/metrics';
import { shortestPath, pathLength, routePoints } from '../core/pathfinding';
export interface WalkExploration {
  centerlineDistance: number;
  optimalLength: number;
  uniqueExplorationLength: number;
  uniqueExplorationRatio: number;
  repeatedLength: number;
  optionalArea: number;
  exploredOptionalArea: number;
  exploredOptionalRatio: number;
  mandatoryAreaRatio: number;
  routeForks: number;
  assessedFirstChoices: number;
  firstDetourChoices: number;
  firstDetourRate: number;
  enteredBranches: number;
  deepBranches: number;
  deepForks:number;
  deepForkRate:number;
  medianBranchDepth:number;
  meanBranchDepth: number;
  deepThreshold: number;
}
/** Finished, adjacent cell traces on a tree. No inferred movement or shortest-path stitching. */
export function assessExploration(maze: Maze, sequence: readonly number[], finished: boolean): WalkExploration | null {
  const m = metrics(maze), domain = domainOf(maze);
  if (!finished || m.components !== 1 || m.cycles !== 0 || sequence[0] !== maze.entrance.cell || sequence.at(-1) !== maze.exit.cell)
    return null;
  if (sequence.some(c => !domain.active[c]) || sequence.slice(1).some((c, i) => !maze.passages[sequence[i]!]!.includes(c)))
    return null;
  const centers = new Map(domain.cells.map(c => [c, cellCenter(maze, c)])), edge = (a: number, b: number) => { const p = centers.get(a)!, q = centers.get(b)!; return maze.storeys?spatialEdgeLength(maze,a,b):Math.hypot(p.x - q.x, p.z - q.z); };
  const area = (c: number) => { const r = domain.rectangles[c]!; return (r.x2 - r.x1) * (r.z2 - r.z1); };
  const path = shortestPath(maze), route = new Set(path), visited = new Set(sequence), optimalLength = pathLength(routePoints(maze));
  const shortestInternal = path.slice(1).reduce((s, c, i) => s + edge(path[i]!, c), 0);
  const endpoints = pathLength([portalPoint(maze, maze.entrance), centers.get(path[0]!)!]) + pathLength([centers.get(path.at(-1)!)!, portalPoint(maze, maze.exit)]);
  let visitedEdges = 0;
  for (const a of visited)
    for (const b of maze.passages[a]!)
      if (b > a && visited.has(b))
        visitedEdges += edge(a, b);
  const uniqueExplorationLength = Math.max(0, 2 * (visitedEdges - shortestInternal));
  const centerlineDistance = endpoints + sequence.slice(1).reduce((s, c, i) => s + edge(sequence[i]!, c), 0);
  const repeatedLength = Math.max(0, centerlineDistance - optimalLength - uniqueExplorationLength);
  const mandatoryArea = path.reduce((s, c) => s + area(c), 0), optionalArea = domain.area - mandatoryArea;
  const exploredOptionalArea = [...visited].filter(c => !route.has(c)).reduce((s, c) => s + area(c), 0);
  const forks = new Map<number, {
    previous: number | undefined;
    next: number;
  }>();
  for (let i = 0; i < path.length - 1; i++) {
    const cell = path[i]!, previous = path[i - 1];
    if (maze.passages[cell]!.filter(n => n !== previous).length > 1)
      forks.set(cell, { previous, next: path[i + 1]! });
  }
  const assessed = new Set<number>();
  let firstDetourChoices = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    const cell = sequence[i]!, fork = forks.get(cell), next = sequence[i + 1]!;
    if (!fork || assessed.has(cell) || next === fork.previous)
      continue;
    assessed.add(cell);
    if (next !== fork.next)
      firstDetourChoices++;
  }
  let enteredBranches = 0, deepBranches = 0, depthSum = 0;
  const deepThreshold = 6;
  const deepAnchors=new Set<number>(),depths:number[]=[];
  const checked = new Set(path);
  for (const anchor of path)
    for (const neighbor of maze.passages[anchor]!) {
      if (checked.has(neighbor))
        continue;
      const stack = [{ cell: neighbor, depth: edge(anchor, neighbor) }];
      checked.add(neighbor);
      let depth = 0;
      while (stack.length) {
        const current = stack.pop()!;
        if (visited.has(current.cell))
          depth = Math.max(depth, current.depth);
        for (const n of maze.passages[current.cell]!) {
          if (!checked.has(n)) {
            checked.add(n);
            stack.push({ cell: n, depth: current.depth + edge(current.cell, n) });
          }
        }
      }
      if (depth > 0) {
        enteredBranches++;
        depthSum += depth;
        depths.push(depth);
        if (depth >= deepThreshold - 1e-8)
          {deepBranches++;deepAnchors.add(anchor); }
      }
    }
  depths.sort((a,b)=>a-b);
  const middle=Math.floor(depths.length/2),medianBranchDepth=depths.length?(depths.length%2?depths[middle]!:(depths[middle-1]!+depths[middle]!)/2):0;
  return { deepForks:deepAnchors.size,deepForkRate:forks.size?deepAnchors.size/forks.size:0,medianBranchDepth,centerlineDistance, optimalLength, uniqueExplorationLength, uniqueExplorationRatio: uniqueExplorationLength / optimalLength, repeatedLength, optionalArea, exploredOptionalArea, exploredOptionalRatio: optionalArea ? exploredOptionalArea / optionalArea : 0, mandatoryAreaRatio: mandatoryArea / domain.area, routeForks: forks.size, assessedFirstChoices: assessed.size, firstDetourChoices, firstDetourRate: assessed.size ? firstDetourChoices / assessed.size : 0, enteredBranches, deepBranches, meanBranchDepth: enteredBranches ? depthSum / enteredBranches : 0, deepThreshold };
}
