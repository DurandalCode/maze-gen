import type { Maze, Point } from '../core/maze';
import { portalPoint } from '../core/maze';
import { freeRuntime, siteGeometry } from './layout';
import { area, distance, ends, segmentInside } from './geometry';
/** Shared weights include connecting passages, without counting a room's subdivision as a cycle. */
export function freeAreaWeights(maze: Maze): number[] {
  const r = freeRuntime(maze), weights = r.rooms.map(s => area(s.polygon) - s.holes.reduce((n, h) => n + area(h), 0));
  for (const c of maze.free!.connections) {
    const p = r.connections.find(g => g.id === c.id);
    if (!p) continue;
    const a = r.rooms.findIndex(s => s.id === c.a.room), b = r.rooms.findIndex(s => s.id === c.b.room), weight = area(p.polygon) / 2;
    if (a >= 0) weights[a]! += weight;
    if (b >= 0) weights[b]! += weight;
  }
  return weights;
}
/** Known plot only: no internal wall, module or generated island is exposed to the policy. */
export function outlineDistances(maze: Maze, points: Point[]): number[] {
  const goal = portalPoint(maze, maze.exit), site = siteGeometry(maze.parameters);
  if (!maze.parameters.shape) return points.map(p => distance(p, goal));
  const unique = new Map<string, Point>();
  for (const w of site.boundaries) for (const p of ends(w)) unique.set(`${p.x}:${p.z}`, p);
  const vertices = [goal, ...unique.values()].filter(site.contains), dist = vertices.map(() => Infinity), done = new Set<number>();
  dist[0] = 0;
  for (let step = 0; step < vertices.length; step++) {
    let at = -1;
    for (let i = 0; i < vertices.length; i++)if (!done.has(i) && (at < 0 || dist[i]! < dist[at]!)) at = i;
    if (at < 0 || !Number.isFinite(dist[at]!)) break;
    done.add(at);
    for (let i = 0; i < vertices.length; i++)if (!done.has(i) && segmentInside(vertices[at]!, vertices[i]!, site.contains, site.boundaries)) dist[i] = Math.min(dist[i]!, dist[at]! + distance(vertices[at]!, vertices[i]!));
  }
  return points.map(p => Math.min(...vertices.map((v, i) => segmentInside(p, v, site.contains, site.boundaries) ? dist[i]! + distance(p, v) : Infinity)));
}
