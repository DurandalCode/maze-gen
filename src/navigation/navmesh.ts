import { navHash, MAX_ARC_SAGITTA_M, DomainError } from '../domain';
import type { Diagnostic, Point } from '../domain';
import { fail } from '../domain/validate';
import type { PhysicalSnapshot } from '../geometry/compile/types';
import { triangulate } from '../geometry/kernel/boolean';
import type { MultiPolygon } from '../geometry/kernel/contour';
import { cross, distance } from '../geometry/predicates';
import { collisionWorld, sweptClear, validCenter } from './collision';
import type { CollisionWorld } from './collision';
import { buildSemanticGraph } from './semantic';
import type { SemanticGraph } from './semantic';
import { triangleAdjacency } from './adjacency';
import { walkableTiles } from './offset';

export interface Neighbor {
  triangle: number;
  portal: [Point, Point];
}
export interface NavTriangle {
  vertices: [Point, Point, Point];
  center: Point;
  neighbors: Neighbor[];
  component: number;
}
export interface NavigationMesh {
  navHash: string;
  worldHash: string;
  radius: number;
  area: MultiPolygon;
  triangles: NavTriangle[];
  collision: CollisionWorld;
  entrance: Point;
  exit: Point;
  referenceRoute: Point[];
  referenceLengthM: number;
  routeQuality: 'reference-approximate';
}
export interface NavigationSnapshot extends NavigationMesh {
  semantic: SemanticGraph;
}
export type NavigationResult =
  | { ok: true; snapshot: NavigationSnapshot }
  | { ok: false; diagnostics: Diagnostic[] };
export function containsTriangle(p: Point, triangle: NavTriangle): boolean {
  const [a, b, c] = triangle.vertices;
  return cross(a, b, p) >= -1e-8 && cross(b, c, p) >= -1e-8 && cross(c, a, p) >= -1e-8;
}
export function triangleAt(mesh: NavigationMesh, point: Point): number {
  return mesh.triangles.findIndex((t) => containsTriangle(point, t));
}
export function route(mesh: NavigationMesh, from: Point, to: Point): Point[] {
  const start = triangleAt(mesh, from),
    goal = triangleAt(mesh, to);
  if (start < 0 || goal < 0) return [];
  if (start === goal) return sweptClear(mesh.collision, from, to, mesh.radius) ? [from, to] : [];
  const open = new Set([start]),
    cost = new Map<number, number>([[start, 0]]),
    previous = new Map<number, { triangle: number; portal: [Point, Point] }>();
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const id of open) {
      const score = cost.get(id)! + distance(mesh.triangles[id]!.center, to);
      if (score < best || (score === best && id < current)) {
        best = score;
        current = id;
      }
    }
    if (current === goal) break;
    open.delete(current);
    for (const neighbor of mesh.triangles[current]!.neighbors) {
      const nextCost =
        cost.get(current)! +
        distance(mesh.triangles[current]!.center, mesh.triangles[neighbor.triangle]!.center);
      if (nextCost < (cost.get(neighbor.triangle) ?? Infinity)) {
        cost.set(neighbor.triangle, nextCost);
        previous.set(neighbor.triangle, { triangle: current, portal: neighbor.portal });
        open.add(neighbor.triangle);
      }
    }
  }
  if (!previous.has(goal)) return [];
  const portals: [Point, Point][] = [];
  let current = goal;
  while (current !== start) {
    const p = previous.get(current);
    if (!p) return [];
    const a = mesh.triangles[p.triangle]!.center,
      b = mesh.triangles[current]!.center;
    const [x, y] = p.portal;
    portals.unshift(cross(a, b, x) > cross(a, b, y) ? [x, y] : [y, x]);
    current = p.triangle;
  }
  const pulled = funnel(from, to, portals);
  if (
    pulled.slice(1).every((point, i) => sweptClear(mesh.collision, pulled[i]!, point, mesh.radius))
  )
    return pulled;
  // The triangle corridor's midpoints provide a conservative fallback, also checked physically.
  const conservative = [
    from,
    ...portals.map(([a, b]) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })),
    to,
  ];
  return conservative
    .slice(1)
    .every((point, i) => sweptClear(mesh.collision, conservative[i]!, point, mesh.radius))
    ? conservative
    : [];
}
function funnel(from: Point, to: Point, portals: [Point, Point][]): Point[] {
  const channel: [[Point, Point], ...[Point, Point][]] = [[from, from], ...portals, [to, to]];
  const result = [from];
  let apex = from,
    left = from,
    right = from,
    apexIndex = 0,
    leftIndex = 0,
    rightIndex = 0;
  for (let i = 1; i < channel.length; i++) {
    const [nextLeft, nextRight] = channel[i]!;
    if (cross(apex, right, nextRight) <= 0) {
      if (distance(apex, right) < 1e-9 || cross(apex, left, nextRight) > 0) {
        right = nextRight;
        rightIndex = i;
      } else {
        result.push(left);
        apex = left;
        apexIndex = leftIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }
    if (cross(apex, left, nextLeft) >= 0) {
      if (distance(apex, left) < 1e-9 || cross(apex, right, nextLeft) < 0) {
        left = nextLeft;
        leftIndex = i;
      } else {
        result.push(right);
        apex = right;
        apexIndex = rightIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }
  }
  if (distance(result[result.length - 1]!, to) > 1e-9) result.push(to);
  return result;
}
function build(physical: PhysicalSnapshot, radius: number): NavigationSnapshot {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 1)
    fail('RANGE', 'navigation', 'Invalid player radius');
  const curved =
    physical.document.definitions.some((d) =>
      d.boundaryLoops.some((l) => l.segments.some((s) => s.kind === 'arc')),
    ) || physical.document.freeWalls.some((w) => w.centerline.kind === 'arc');
  const tiled = walkableTiles(
    physical.floor,
    physical.obstacles,
    radius + (curved ? MAX_ARC_SAGITTA_M : 0) + 1e-6,
  );
  const area = tiled.area,
    triangles: NavTriangle[] = [];
  area.forEach((polygon, component) => {
    const t = triangulate(polygon);
    for (const indices of t.triangles) {
      const vertices = indices.map((i) => t.vertices[i]!) as [Point, Point, Point];
      const id = triangles.length;
      triangles.push({
        vertices,
        component,
        center: {
          x: vertices.reduce((n, p) => n + p.x, 0) / 3,
          z: vertices.reduce((n, p) => n + p.z, 0) / 3,
        },
        neighbors: [],
      });
    }
  });
  const adjacency = triangleAdjacency(triangles.map((t) => t.vertices));
  triangles.forEach((t, i) => (t.neighbors = adjacency[i]!));
  if (triangles.length) {
    const seen = new Set([0]),
      queue = [0];
    for (let i = 0; i < queue.length; i++)
      for (const n of triangles[queue[i]!]!.neighbors)
        if (!seen.has(n.triangle)) {
          seen.add(n.triangle);
          queue.push(n.triangle);
        }
    if (area.length === 1 && seen.size !== triangles.length)
      fail(
        'INVALID_TOPOLOGY',
        'navigation',
        'Navmesh has disconnected triangles inside a connected polygon',
      );
  }
  const collision = collisionWorld(physical);
  const terminal = (role: 'entrance' | 'exit'): Point => {
    const opening = physical.openPassages.find((o) => o.role === role);
    if (!opening) fail('TERMINALS', 'navigation', `Missing ${role}`);
    for (const offset of [radius + 0.03, radius + 0.1, radius + 0.25, 0.75, 1]) {
      const p = {
        x: opening.center.x - opening.normal.x * offset,
        z: opening.center.z - opening.normal.z * offset,
      };
      if (triangles.some((t) => containsTriangle(p, t)) && validCenter(collision, p, radius))
        return p;
    }
    fail('UNREACHABLE', opening.id, 'No accessible position on inner side of terminal');
  };
  const mesh: NavigationMesh = {
    navHash: navHash(physical.worldHash, radius),
    worldHash: physical.worldHash,
    radius,
    area,
    triangles,
    collision,
    entrance: terminal('entrance'),
    exit: terminal('exit'),
    referenceRoute: [],
    referenceLengthM: 0,
    routeQuality: 'reference-approximate',
  };
  if (area.length !== 1)
    fail(
      'UNREACHABLE',
      'navigation',
      'All accessible floor regions must belong to the entrance component',
      area.length,
      1,
    );
  mesh.referenceRoute = route(mesh, mesh.entrance, mesh.exit);
  if (mesh.referenceRoute.length < 2)
    fail('UNREACHABLE', 'navigation', 'No physically verified entrance-to-exit route');
  mesh.referenceLengthM = mesh.referenceRoute
    .slice(1)
    .reduce((n, p, i) => n + distance(mesh.referenceRoute[i]!, p), 0);
  return { ...mesh, semantic: buildSemanticGraph(mesh, tiled.tiles) };
}
export function buildNavigation(
  physical: PhysicalSnapshot,
  radius = physical.document.physicalProfile.playerRadiusM,
): NavigationResult {
  try {
    return { ok: true, snapshot: build(physical, radius) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        error instanceof DomainError
          ? error.diagnostic
          : {
              code: 'INTERNAL_ERROR',
              path: 'navigation',
              message: `Unexpected navigation failure: ${error instanceof Error ? error.message : 'unknown error'}`,
            },
      ],
    };
  }
}
