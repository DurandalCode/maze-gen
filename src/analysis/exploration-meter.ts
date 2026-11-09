import type { Maze } from '../core/maze';
import { cellCenter } from '../core/maze';
import { metrics } from '../core/metrics';
import { shortestPath } from '../core/pathfinding';
export interface ExplorationForecast {
  firstDetourRate: number;
  expectedEnteredBranches: number;
  expectedDeepBranches: number;
  meanBranchDepth: number;
  medianBranchDepth: number;
  deepThreshold: number;
}
/** Observer only. The solution labels below are never available to the walking policy. */
export function explorationMeter(maze: Maze) {
  const m = metrics(maze);
  if (m.components !== 1 || m.cycles !== 0)
    return null;
  const route = shortestPath(maze), onRoute = new Set(route), branchOf = new Int32Array(maze.passages.length).fill(-1), depth = new Float64Array(maze.passages.length), forkNext = new Int32Array(maze.passages.length).fill(-1);
  const edge = (a: number, b: number) => { const p = cellCenter(maze, a), q = cellCenter(maze, b); return Math.hypot(p.x - q.x, p.z - q.z); };
  const seen = new Set(route);
  let count = 0;
  for (let i = 0; i < route.length; i++) {
    const anchor = route[i]!, next = route[i + 1];
    if (next !== undefined && maze.passages[anchor]!.filter(n => n !== route[i - 1]).length > 1)
      forkNext[anchor] = next;
    for (const n of maze.passages[anchor]!) {
      if (onRoute.has(n) || seen.has(n))
        continue;
      const id = count++, stack = [{ cell: n, distance: edge(anchor, n) }];
      seen.add(n);
      while (stack.length) {
        const a = stack.pop()!;
        branchOf[a.cell] = id;
        depth[a.cell] = a.distance;
        for (const b of maze.passages[a.cell]!)
          if (!seen.has(b)) {
            seen.add(b);
            stack.push({ cell: b, distance: a.distance + edge(a.cell, b) });
          }
      }
    }
  }
  const branchDepth = new Float64Array(count), forkSeen = new Uint8Array(maze.passages.length), histogram = new Map<number, number>();
  let runs = 0, assessed = 0, detours = 0, entered = 0, deep = 0, depthSum = 0;
  return {
    begin() { branchDepth.fill(0); forkSeen.fill(0); },
    enter(owner: number, target: number) {
      if (forkNext[owner]! >= 0 && !forkSeen[owner]) {
        forkSeen[owner] = 1;
        assessed++;
        if (target !== forkNext[owner])
          detours++;
      }
      const branch = branchOf[target]!;
      if (branch >= 0)
        branchDepth[branch] = Math.max(branchDepth[branch]!, depth[target]!);
    },
    finish() { runs++; for (const d of branchDepth)
      if (d > 0) {
        entered++;
        depthSum += d;
        if (d >= 6 - 1e-8)
          deep++;
        histogram.set(d, (histogram.get(d) ?? 0) + 1);
      } },
    summary(): ExplorationForecast {
      let median = 0, position = 0;
      const left = Math.floor((entered - 1) / 2), right = Math.floor(entered / 2);
      let lo = 0, hi = 0;
      for (const [d, n] of [...histogram].sort(([a], [b]) => a - b)) {
        if (position <= left && position + n > left)
          lo = d;
        if (position <= right && position + n > right) {
          hi = d;
          break;
        }
        position += n;
      }
      if (entered)
        median = (lo + hi) / 2;
      return { firstDetourRate: assessed ? detours / assessed : 0, expectedEnteredBranches: runs ? entered / runs : 0, expectedDeepBranches: runs ? deep / runs : 0, meanBranchDepth: entered ? depthSum / entered : 0, medianBranchDepth: median, deepThreshold: 6 };
    },
  };
}
/** Exact DFS branch expectations for an unguided search on a tree. */
export function unguidedExplorationForecast(maze: Maze, probability: ArrayLike<number>): ExplorationForecast | undefined {
  const m = metrics(maze);
  if (m.components !== 1 || m.cycles !== 0)
    return undefined;
  const route = shortestPath(maze), onRoute = new Set(route), seen = new Set(route), depths: {
    depth: number;
    weight: number;
  }[] = [];
  let expectedEnteredBranches = 0, expectedDeepBranches = 0, depthSum = 0, forks = 0, wrong = 0;
  const length = (a: number, b: number) => { const p = cellCenter(maze, a), q = cellCenter(maze, b); return Math.hypot(p.x - q.x, p.z - q.z); };
  for (let i = 0; i < route.length; i++) {
    const anchor = route[i]!, next = route[i + 1], choices = maze.passages[anchor]!.filter(n => n !== route[i - 1]);
    if (next !== undefined && choices.length > 1) {
      forks++;
      wrong += (choices.length - 1) / choices.length;
    }
    for (const neighbor of maze.passages[anchor]!) {
      if (onRoute.has(neighbor) || seen.has(neighbor))
        continue;
      const stack = [{ cell: neighbor, depth: length(anchor, neighbor) }];
      seen.add(neighbor);
      let depth = 0;
      while (stack.length) {
        const current = stack.pop()!;
        depth = Math.max(depth, current.depth);
        for (const n of maze.passages[current.cell]!)
          if (!seen.has(n)) {
            seen.add(n);
            stack.push({ cell: n, depth: current.depth + length(current.cell, n) });
          }
      }
      const p = probability[neighbor] ?? 0;
      expectedEnteredBranches += p;
      depthSum += p * depth;
      if (depth >= 6)
        expectedDeepBranches += p;
      depths.push({ depth, weight: p });
    }
  }
  depths.sort((a, b) => a.depth - b.depth);
  let weight = 0, median = 0;
  for (const entry of depths) {
    weight += entry.weight;
    if (weight >= expectedEnteredBranches / 2) {
      median = entry.depth;
      break;
    }
  }
  return { firstDetourRate: forks ? wrong / forks : 0, expectedEnteredBranches, expectedDeepBranches, meanBranchDepth: expectedEnteredBranches ? depthSum / expectedEnteredBranches : 0, medianBranchDepth: expectedEnteredBranches ? median : 0, deepThreshold: 6 };
}
