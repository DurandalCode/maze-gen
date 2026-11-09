import { domainOf } from './domain';
import { routingSize, portalPoint, type Maze, type Point, type Portal } from './maze';

export const samePortal = (a: Portal, b: Portal): boolean => a.cell === b.cell && a.side === b.side;
export const mazePortals = (maze: Maze): readonly Portal[] => maze.portals ?? [maze.entrance, maze.exit];

/** Snap a map click to a boundary cell, including the alternating module/gap widths. */
export function portalAtPoint(maze: Maze, point: Point, tolerance: number): Portal | null {
  let best: Portal | null=null, distance=tolerance;
  for(const edge of domainOf(maze).boundary) {
    const w=edge.wall;
    const x=Math.max(Math.min(w.x1,w.x2),Math.min(point.x,Math.max(w.x1,w.x2)));
    const z=Math.max(Math.min(w.z1,w.z2),Math.min(point.z,Math.max(w.z1,w.z2)));
    const d=Math.hypot(point.x-x,point.z-z);
    if(d<=distance && (best===null || d<distance)) { best=edge.portal; distance=d; }
  }
  return best;
}

export function boundaryPortal(maze: Maze, portal: Portal): boolean {
  return domainOf(maze).boundary.some(e=>samePortal(e.portal,portal));
}

/** Replace openings while keeping the selected traversal pair whenever possible. */
export function withPortals(maze: Maze, portals: readonly Portal[]): Maze {
  if (portals.length < 2 || portals.some(p => !boundaryPortal(maze, p))
    || new Set(portals.map(p => `${p.cell}:${p.side}`)).size !== portals.length)
    throw new Error('Нужны хотя бы два разных проёма на границе области.');
  const entrance = portals.find(p => samePortal(p, maze.entrance)) ?? portals[0]!;
  const exit = portals.find(p => samePortal(p, maze.exit) && !samePortal(p, entrance))
    ?? portals.find(p => !samePortal(p, entrance))!;
  const visited = new Uint8Array(maze.passages.length), queue = [entrance.cell];
  visited[entrance.cell] = 1;
  for (let head = 0; head < queue.length; head++) for (const next of maze.passages[queue[head]!]!) {
    if (!visited[next]) { visited[next] = 1; queue.push(next); }
  }
  if (portals.some(p => !visited[p.cell])) throw new Error('Все входы-выходы должны быть соединены проходами.');
  return { ...maze, portals: portals.map(p => ({ ...p })), entrance: { ...entrance }, exit: { ...exit } };
}

/** Preserve perimeter positions proportionally when changing the module grid. */
export function transferPortals(from: Maze, to: Maze): Maze {
  if (from.parameters.shape || to.parameters.shape) {
    const originals=mazePortals(from), available=domainOf(to).boundary.map(e=>e.portal);
    const oldGrid=routingSize(from), newGrid=routingSize(to);
    const samePlacement=(from.parameters.moduleSize === undefined) === (to.parameters.moduleSize === undefined)
      && (from.version === 1 && from.parameters.moduleSize !== undefined) === (to.version === 1 && to.parameters.moduleSize !== undefined);
    const mapped: (Portal | undefined)[]=originals.map(p=> {
      const x=p.cell%oldGrid.columns, z=Math.floor(p.cell/oldGrid.columns);
      const next={cell:z*newGrid.columns+x,side:p.side};
      return samePlacement && x<newGrid.columns && z<newGrid.rows && boundaryPortal(to,next)?next:undefined;
    });
    const used=new Set(mapped.filter((p):p is Portal=>!!p).map(p=>`${p.cell}:${p.side}`));
    for(let i=0;i<originals.length;i++) if(!mapped[i]) {
      const point=portalPoint(from,originals[i]!);
      let best:Portal|undefined, distance=Infinity;
      for(const p of available) {
        if(used.has(`${p.cell}:${p.side}`)) continue;
        const q=portalPoint(to,p), d=(q.x-point.x)**2+(q.z-point.z)**2;
        if(d<distance) {distance=d;best=p;}
      }
      if(!best) throw new Error('На новой границе недостаточно места для всех проёмов. Удалите лишние проёмы.');
      mapped[i]=best;used.add(`${best.cell}:${best.side}`);
    }
    const portals=mapped as Portal[];
    const entrance=portals[originals.findIndex(p=>samePortal(p,from.entrance))]!;
    const exit=portals[originals.findIndex(p=>samePortal(p,from.exit))]!;
    return withPortals({...to,entrance,exit},portals);
  }
  if (!from.portals) return to;
  const oldSize = routingSize(from), newSize = routingSize(to);
  const remap = (p: Portal): Portal => {
    const horizontal = p.side === 'north' || p.side === 'south';
    const oldCount = horizontal ? oldSize.columns : oldSize.rows;
    const newCount = horizontal ? newSize.columns : newSize.rows;
    const oldIndex = horizontal ? p.cell%oldSize.columns : Math.floor(p.cell/oldSize.columns);
    const index = oldCount === 1 ? 0 : Math.round(oldIndex/(oldCount-1)*(newCount-1));
    return { side: p.side, cell: horizontal ? index+(p.side === 'south' ? (newSize.rows-1)*newSize.columns : 0)
      : index*newSize.columns+(p.side === 'east' ? newSize.columns-1 : 0) };
  };
  const mapped = from.portals.map(remap);
  if (new Set(mapped.map(p => `${p.cell}:${p.side}`)).size !== mapped.length)
    throw new Error('На новой сетке некоторые проёмы совпадают. Разнесите или удалите их перед уменьшением сетки.');
  return withPortals({ ...to, entrance: remap(from.entrance), exit: remap(from.exit) }, mapped);
}
