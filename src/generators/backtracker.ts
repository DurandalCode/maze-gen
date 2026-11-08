import { connect, neighbors, type Maze } from '../core/maze';

/** Iterative DFS avoids recursion overflow on 100 × 100 mazes. */
export function backtracker(maze: Maze, rng: () => number): void {
  const visited = new Uint8Array(maze.passages.length);
  const stack = [0];
  visited[0] = 1;
  while (stack.length) {
    const cell = stack[stack.length - 1]!;
    const choices = neighbors(maze, cell).filter(n => !visited[n]);
    if (!choices.length) { stack.pop(); continue; }
    const next = choices[Math.floor(rng() * choices.length)]!;
    connect(maze, cell, next);
    visited[next] = 1;
    stack.push(next);
  }
}
