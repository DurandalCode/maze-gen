import { fail } from '../domain';
import type { Point } from '../domain';
import { triangulate } from '../geometry/kernel/boolean';
import { pointInPolygon } from '../geometry/kernel/contour';
import type { Polygon } from '../geometry/kernel/contour';
import { distance, ringEdges, segmentsTouch } from '../geometry/predicates';
import { triangleAdjacency } from './adjacency';
import { sweptClear } from './collision';
import { route } from './navmesh';
import type { NavigationSnapshot, NavigationMesh } from './navmesh';
export function roomPath(
  mesh: NavigationSnapshot,
  region: Polygon,
  from: Point,
  to: Point,
): Point[] {
  if (distance(from, to) < 1e-8) return [from];
  if (
    sweptClear(mesh.collision, from, to, mesh.radius) &&
    !region.flatMap(ringEdges).some(([a, b]) => segmentsTouch(from, to, a, b, 0))
  )
    return [from, to];
  const t = triangulate(region),
    vertices = t.triangles.map((ids) => ids.map((i) => t.vertices[i]!) as [Point, Point, Point]),
    adjacency = triangleAdjacency(vertices);
  const local: NavigationMesh = {
    ...mesh,
    triangles: vertices.map((v, i) => ({
      vertices: v,
      center: { x: (v[0].x + v[1].x + v[2].x) / 3, z: (v[0].z + v[1].z + v[2].z) / 3 },
      neighbors: adjacency[i]!.map((n) => ({ triangle: n.triangle, portal: n.portal })),
      component: 0,
    })),
  };
  const result = route(local, from, to);
  if (!result.length || !result.every((p) => pointInPolygon(p, region)))
    fail('CONSTRAINT_PATH', 'generation', 'Не удалось подтвердить внутренний путь для ограничения');
  return result;
}
