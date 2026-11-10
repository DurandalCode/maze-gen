import { domainOf } from './domain';
import {routingSize,type Maze} from './maze';

export function componentCount(maze: Maze): number {
  const visited = new Uint8Array(maze.passages.length);
  let count = 0;
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || !domainOf(maze).active[start]) continue;
    count++;
    const stack = [start]; visited[start] = 1;
    while (stack.length) for (const next of maze.passages[stack.pop()!]!) {
      if (!visited[next]) { visited[next] = 1; stack.push(next); }
    }
  }
  return count;
}
/** First Betti number of the walkable cell complex. A completely open 2x2
 * navigation quad fills a face; it is not a physical maze loop. */
export function independentCycles(maze:Maze,components=componentCount(maze)):number{
 const cells=domainOf(maze).cells,E=maze.passages.reduce((n,links)=>n+links.length,0)/2;
 if(maze.version!==4||maze.navigation)return E-cells.length+components;
 let faces=0;const w=routingSize(maze).columns,active=domainOf(maze).active;
 for(const a of cells){const b=a+1,c=a+w,d=c+1;if(a%w===w-1||!active[b]||!active[c]||!active[d])continue;if(maze.passages[a]!.includes(b)&&maze.passages[a]!.includes(c)&&maze.passages[b]!.includes(d)&&maze.passages[c]!.includes(d))faces++;}
 return E-cells.length+components-faces;
}
