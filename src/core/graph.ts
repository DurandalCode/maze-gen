import type { Maze } from './maze';

export function componentCount(maze: Maze): number {
  const visited = new Uint8Array(maze.passages.length);
  let count = 0;
  for (let start = 0; start < visited.length; start++) {
    if (visited[start]) continue;
    count++;
    const stack = [start]; visited[start] = 1;
    while (stack.length) for (const next of maze.passages[stack.pop()!]!) {
      if (!visited[next]) { visited[next] = 1; stack.push(next); }
    }
  }
  return count;
}
