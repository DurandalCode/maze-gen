import { generateBase } from './generate';
import { neighbors, routingSize, type Maze, type Portal } from '../core/maze';
import { domainOf } from '../core/domain';
import { random, shuffle } from '../core/random';
import { metrics } from '../core/metrics';
import { mazePortalPrivacy } from '../analysis/portal-privacy';
export const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export interface GuardConstraints {
  mandatory: [
    number,
    number
  ][];
  locked: Set<string>;
  allowed: [
    number,
    number
  ][];
  pockets: number[][];
}
/** Build opaque return pockets without changing the footprint or moving the selected portals. */
export function portalConstraints(base: Maze): GuardConstraints {
  const { columns } = routingSize(base), domain = domainOf(base), ports = [base.entrance, base.exit];
  const chains = (p: Portal) => {
    const inward = p.side === 'south' ? -columns : p.side === 'north' ? columns : p.side === 'east' ? -1 : 1;
    const lateral = p.side === 'north' || p.side === 'south' ? [1, -1] : [columns, -columns];
    return lateral.map(d => [p.cell, p.cell + inward, p.cell + inward + d, p.cell + d]).filter(chain => chain.every(c => domain.active[c]) && chain.slice(1).every((c, i) => neighbors(base, chain[i]!).includes(c)));
  };
  for (const a of chains(ports[0]!))
    for (const b of chains(ports[1]!)) {
      if (a.some(c => b.includes(c)))
        continue;
      const pockets = [a.slice(0, 3), b.slice(0, 3)], protectedCells = new Set(pockets.flat()), mandatory: [
        number,
        number
      ][] = [];
      for (const chain of [a, b])
        for (let i = 0; i < 3; i++)
          mandatory.push([chain[i]!, chain[i + 1]!]);
      const locked = new Set(mandatory.map(([x, y]) => edgeKey(x, y))), allowed: [
        number,
        number
      ][] = [];
      for (const x of domain.cells)
        for (const y of neighbors(base, x))
          if (y > x && (!(protectedCells.has(x) || protectedCells.has(y)) || locked.has(edgeKey(x, y))))
            allowed.push([x, y]);
      // The allowed geometry must still connect all active cells.
      const adjacency = base.passages.map(() => [] as number[]);
      for (const [x, y] of allowed) {
        adjacency[x]!.push(y);
        adjacency[y]!.push(x);
      }
      const seen = new Set([domain.cells[0]!]), queue = [domain.cells[0]!];
      for (let i = 0; i < queue.length; i++)
        for (const n of adjacency[queue[i]!]!)
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
      if (seen.size === domain.cells.length)
        return { mandatory, locked, allowed, pockets };
    }
  throw new Error('Скрытые карманы не помещаются при текущих форме и проёмах. Нужно больше места или другое расположение проёмов.');
}
export function guardedMaze(base: Maze, seed: string, inherit = false): {
  maze: Maze;
  constraints: GuardConstraints;
} {
  if (metrics(base).cycles !== 0 || metrics(base).components !== 1)
    throw new Error('Подбор сложности со скрытыми проёмами пока поддерживает связные деревья проходов.');
  const guard = portalConstraints(base), generated = inherit ? base : generateBase({ ...base.parameters, seed });
  const maze: Maze = { ...base, parameters: generated.parameters, passages: base.passages.map(() => []) };
  const parent = maze.passages.map((_, i) => i), rng = random(seed + '|guarded-v1');
  const root = (x: number): number => { while (parent[x] !== x) {
    parent[x] = parent[parent[x]!]!;
    x = parent[x]!;
  } return x; };
  const add = (a: number, b: number) => { const ra = root(a), rb = root(b); if (ra === rb)
    return; parent[ra] = rb; maze.passages[a]!.push(b); maze.passages[b]!.push(a); };
  for (const [a, b] of guard.mandatory)
    add(a, b);
  for (const [a, b] of guard.allowed)
    if (generated.passages[a]!.includes(b))
      add(a, b);
  const remaining = [...guard.allowed];
  shuffle(remaining, rng);
  for (const [a, b] of remaining)
    add(a, b);
  for (const list of maze.passages)
    list.sort((a, b) => a - b);
  if (metrics(maze).components !== 1 || !mazePortalPrivacy(maze, false).certified)
    throw new Error('Не удалось доказать скрытность обоих проёмов для этой геометрии.');
  return { maze, constraints: guard };
}
