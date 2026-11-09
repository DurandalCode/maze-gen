import { axisBounds, routingSize, type Maze, type Point } from '../core/maze';
import { domainOf } from '../core/domain';
import { FRAME_POST_SIZE } from '../core/structure';
import type { NavigationContext } from './navigation';
import { CORRIDOR_SIGHT_METRES } from './corridor-view';
export interface SightRay {
  length: number;
  endCell: number;
  point: Point;
  blocked: boolean;
  firstCell: number | null;
  angle: number;
}
export interface OpeningView extends SightRay {
  depth: number;
  aperture: number;
}
/** Eye-level visibility inside the footprint. Fabric identifies a boundary but does not reveal its passages. */
export function spatialPerception(maze: Maze, context: NavigationContext) {
  const domain = domainOf(maze), xs = axisBounds(maze, 'x'), zs = axisBounds(maze, 'z'), columns = routingSize(maze).columns;
  const trace = (from: number, angle: number, limit = CORRIDOR_SIGHT_METRES): SightRay => {
    const start = context.centers[from];
    if (!start || !Number.isFinite(angle) || !Number.isFinite(limit) || limit <= 0)
      throw new Error('Некорректный луч видимости.');
    const dx = Math.cos(angle), dz = Math.sin(angle), sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    let cell = from, firstCell: number | null = null;
    const finish = (length: number, blocked: boolean): SightRay => ({ length, endCell: cell, point: { x: start.x + dx * length, z: start.z + dz * length }, blocked, firstCell, angle });
    // A ray crosses at most columns+rows cell boundaries before leaving this bounded grid.
    for (let step = 0; step < xs.length + zs.length; step++) {
      const x = cell % columns, z = Math.floor(cell / columns);
      const tx = Math.abs(dx) < 1e-12 ? Infinity : (xs[x + (sx > 0 ? 1 : 0)]! - start.x) / dx;
      const tz = Math.abs(dz) < 1e-12 ? Infinity : (zs[z + (sz > 0 ? 1 : 0)]! - start.z) / dz;
      const t = Math.min(tx, tz);
      if (t >= limit)
        return finish(limit, false);
      const px = start.x + dx * t, pz = start.z + dz * t;
      // Corner uprights block eye-level rays, including exact diagonal corner contact.
      const clearance = tx < tz ? Math.min(pz - zs[z]!, zs[z + 1]! - pz) : Math.min(px - xs[x]!, xs[x + 1]! - px);
      if (clearance <= FRAME_POST_SIZE / 2 + 1e-9)
        return finish(t, true);
      const next = tx < tz ? cell + sx : cell + sz * columns;
      if (!domain.active[next] || !maze.passages[cell]!.includes(next))
        return finish(t, true);
      firstCell ??= next;
      cell = next;
    }
    return finish(limit, false);
  };
  const cache = new Map<string, OpeningView>();
  const view = (from: number, to: number): OpeningView => {
    if (!maze.passages[from]?.includes(to))
      throw new Error('Обзор требует открытого соседнего прохода.');
    const key = from + ':' + to, previous = cache.get(key);
    if (previous)
      return previous;
    const a = context.centers[from]!, b = context.centers[to]!, heading = Math.atan2(b.z - a.z, b.x - a.x);
    let best = trace(from, heading);
    const depths: number[] = [best.length];
    // Angular sampling, not diagonal graph edges: only rays that first enter this opening count.
    for (let degrees = -60; degrees <= 60; degrees += 5) {
      if (degrees === 0)
        continue;
      const ray = trace(from, heading + degrees * Math.PI / 180);
      if (ray.firstCell === to)
        depths.push(ray.length);
      if (ray.firstCell === to && ray.length > best.length + .01)
        best = ray;
    }
    depths.sort((a, b) => a - b);
    const result = { ...best, depth: depths.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, depths.length), aperture: depths.length / 25 };
    cache.set(key, result);
    return result;
  };
  return { trace, view };
}
/** Known footprint only; no hidden maze walls or solution path are used. */
export function perimeterPerception(maze: Maze, context: NavigationContext) {
  const domain = domainOf(maze), distances = new Float64Array(maze.passages.length);
  let scale = 0;
  for (const cell of context.cells) {
    const p = context.centers[cell]!;
    let distance = Infinity;
    for (const { wall: w } of domain.boundary) {
      const x = Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), p.x));
      const z = Math.max(Math.min(w.z1, w.z2), Math.min(Math.max(w.z1, w.z2), p.z));
      distance = Math.min(distance, Math.hypot(p.x - x, p.z - z));
    }
    distances[cell] = distance;
    const r = domain.rectangles[cell]!;
    scale += Math.min(r.x2 - r.x1, r.z2 - r.z1);
  }
  scale /= context.cells.length;
  const attraction = (from: number, to: number) => {
    const a = context.centers[from]!, b = context.centers[to]!, step = Math.hypot(b.x - a.x, b.z - a.z);
    const near = Math.exp(-distances[to]! / (scale * 1.5));
    const change = (distances[from]! - distances[to]!) / step;
    const tangent = 1 - Math.min(1, Math.abs(change));
    // Prefer a promising arc along either edge of a U, rather than mandatory wall contact.
    return 3 * near + 1.5 * change + 1.5 * near * tangent;
  };
  return { distances, attraction };
}
