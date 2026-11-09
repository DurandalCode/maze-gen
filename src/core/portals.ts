import { axisBounds, routingSize, type Maze, type Point, type Portal } from './maze';

export const samePortal = (a: Portal, b: Portal): boolean => a.cell === b.cell && a.side === b.side;
export const mazePortals = (maze: Maze): readonly Portal[] => maze.portals ?? [maze.entrance, maze.exit];

/** Snap a map click to a boundary cell, including the alternating module/gap widths. */
export function portalAtPoint(maze: Maze, point: Point, tolerance: number): Portal | null {
  if (point.x < -tolerance || point.x > maze.width+tolerance || point.z < -tolerance || point.z > maze.depth+tolerance) return null;
  const sides: [Portal['side'], number][] = [['west', Math.abs(point.x)], ['east', Math.abs(point.x-maze.width)],
    ['north', Math.abs(point.z)], ['south', Math.abs(point.z-maze.depth)]];
  sides.sort((a, b) => a[1]-b[1]);
  const [side, distance] = sides[0]!;
  if (distance > tolerance) return null;
  const horizontal = side === 'north' || side === 'south';
  const bounds = axisBounds(maze, horizontal ? 'x' : 'z'), value = horizontal ? point.x : point.z;
  let index = bounds.findIndex((bound, i) => i > 0 && value < bound)-1;
  index = value <= 0 ? 0 : index < 0 ? bounds.length-2 : index;
  const { columns, rows } = routingSize(maze);
  return { side, cell: horizontal ? index+(side === 'south' ? (rows-1)*columns : 0)
    : index*columns+(side === 'east' ? columns-1 : 0) };
}

export function boundaryPortal(maze: Maze, portal: Portal): boolean {
  const { columns, rows } = routingSize(maze);
  if (!Number.isInteger(portal.cell) || portal.cell < 0 || portal.cell >= columns*rows) return false;
  const x = portal.cell%columns, z = Math.floor(portal.cell/columns);
  return portal.side === 'west' && x === 0 || portal.side === 'east' && x === columns-1
    || portal.side === 'north' && z === 0 || portal.side === 'south' && z === rows-1;
}

/** Replace openings while keeping the selected traversal pair whenever possible. */
export function withPortals(maze: Maze, portals: readonly Portal[]): Maze {
  if (portals.length < 2 || portals.some(p => !boundaryPortal(maze, p))
    || new Set(portals.map(p => `${p.cell}:${p.side}`)).size !== portals.length)
    throw new Error('Нужны хотя бы два разных проёма на внешнем периметре.');
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
