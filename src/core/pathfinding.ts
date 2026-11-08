import { cellCenter, portalPoint, type Maze, type Point } from './maze';

export function shortestPath(maze: Maze, from = maze.entrance.cell, to = maze.exit.cell): number[] {
  if (!maze.passages[from] || !maze.passages[to]) return [];
  const parent = new Int32Array(maze.passages.length).fill(-1);
  const queue = [from]; parent[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === to) break;
    for (const next of maze.passages[cell]!) if (parent[next] === -1) {
      parent[next] = cell; queue.push(next);
    }
  }
  if (parent[to] === -1) return [];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(parent[path[path.length - 1]!]!);
  return path.reverse();
}

/** Same boundary-to-boundary convention as a recorded traversal. */
export function routePoints(maze: Maze): Point[] {
  const path = shortestPath(maze);
  return path.length ? [portalPoint(maze, maze.entrance), ...path.map(c => cellCenter(maze, c)), portalPoint(maze, maze.exit)] : [];
}

export function pathLength(points: readonly Point[]): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += Math.hypot(points[i]!.x - points[i-1]!.x, points[i]!.z - points[i-1]!.z);
  return distance;
}
