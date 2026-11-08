import { connect, neighbors, type Maze } from '../core/maze';

export function prim(maze: Maze, rng: () => number): void {
  const visited = new Uint8Array(maze.passages.length);
  const frontier: [number, number][] = [];
  const visit = (cell: number) => {
    visited[cell] = 1;
    for (const n of neighbors(maze, cell)) if (!visited[n]) frontier.push([cell, n]);
  };
  visit(0);
  while (frontier.length) {
    const i = Math.floor(rng() * frontier.length);
    const [from, to] = frontier[i]!;
    frontier[i] = frontier[frontier.length - 1]!;
    frontier.pop();
    if (visited[to]) continue;
    connect(maze, from, to);
    visit(to);
  }
}
