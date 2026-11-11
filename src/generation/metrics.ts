import { hashValue, fail } from '../domain';
import type { Point } from '../domain';
import type { PhysicalSnapshot } from '../geometry/compile/types';
import { multiArea } from '../geometry/kernel/contour';
import type { Polygon } from '../geometry/kernel/contour';
import {
  distance,
  bounds,
  ringEdges,
  pointSegmentDistance,
  segmentsTouch,
} from '../geometry/predicates';
import { buildSpatialIndex, querySpatialIndex } from '../geometry/spatial-index';
import { roomPath } from '../navigation/room-path';
import type { NavigationSnapshot } from '../navigation/navmesh';
import { straightMetric } from './straight';
import type { GenerationMetrics } from './types';

const length = (p: Point[]) => p.slice(1).reduce((n, q, i) => n + distance(p[i]!, q), 0);
/** Dijkstra weights include physically verified intra-room paths, rather than centroid chords. */
export function graphDistances(mesh: NavigationSnapshot): Map<string, number> {
  const graph = mesh.semantic,
    adjacency = new Map<string, { to: string; length: number }[]>(),
    nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    const a = nodes.get(edge.from)!,
      b = nodes.get(edge.to)!;
    const cost =
      length(roomPath(mesh, a.region, a.position, edge.path[0]!)) +
      edge.lengthM +
      length(roomPath(mesh, b.region, edge.path[edge.path.length - 1]!, b.position));
    adjacency.set(a.id, [...(adjacency.get(a.id) ?? []), { to: b.id, length: cost }]);
    adjacency.set(b.id, [...(adjacency.get(b.id) ?? []), { to: a.id, length: cost }]);
  }
  const entrance = nodes.get(graph.entranceNode)!,
    distances = new Map([
      [entrance.id, length(roomPath(mesh, entrance.region, mesh.entrance, entrance.position))],
    ]),
    open = new Set([entrance.id]);
  while (open.size) {
    const current = [...open].sort(
      (a, b) => distances.get(a)! - distances.get(b)! || (a < b ? -1 : 1),
    )[0]!;
    open.delete(current);
    for (const edge of adjacency.get(current) ?? []) {
      const cost = distances.get(current)! + edge.length;
      if (cost < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, cost);
        open.add(edge.to);
      }
    }
  }
  return distances;
}

/** Compress only degree-two physical semantic nodes; navmesh vertices never count as choices. */
export function runMetrics(mesh: NavigationSnapshot): { maxStraightM: number; maxForcedM: number } {
  const graph = mesh.semantic;
  const edges = graph.edges.map((e) => ({ ...e, path: e.path }));
  edges.push({
    id: '@entrance',
    from: '@entrance',
    to: graph.entranceNode,
    kind: 'connection',
    path: [mesh.entrance],
    lengthM: 0,
  });
  edges.push({
    id: '@exit',
    from: graph.exitNode,
    to: '@exit',
    kind: 'connection',
    path: [mesh.exit],
    lengthM: 0,
  });
  const adjacency = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const n of [e.from, e.to]) adjacency.set(n, [...(adjacency.get(n) ?? []), i]);
  });
  const seen = new Set<number>();
  let maxStraightM = 0,
    maxForcedM = 0;
  const measure = (path: Point[]) => {
    maxForcedM = Math.max(maxForcedM, length(path));
    let run = 0,
      previous: Point | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!,
        d = distance(a, b);
      if (d < 1e-8) continue;
      const direction = { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
      if (
        previous &&
        previous.x * direction.x + previous.z * direction.z < Math.cos(Math.PI / 180) - 1e-10
      )
        run = 0;
      run += d;
      maxStraightM = Math.max(maxStraightM, run);
      previous = direction;
    }
  };
  const walk = (start: string, first: number) => {
    let at = start,
      id = first;
    const path: Point[] = [];
    while (!seen.has(id)) {
      seen.add(id);
      const e = edges[id]!,
        oriented = e.from === at ? e.path : [...e.path].reverse();
      if (path.length && oriented.length) {
        const node = graph.nodes.find((n) => n.id === at);
        if (node)
          path.push(...roomPath(mesh, node.region, path[path.length - 1]!, oriented[0]!).slice(1));
      }
      path.push(...oriented);
      at = e.from === at ? e.to : e.from;
      const next = adjacency.get(at)!;
      if (next.length !== 2) break;
      id = next.find((j) => j !== id) ?? id;
      if (seen.has(id)) fail('FORCED_CYCLE', 'generation', 'Цикл без выхода в цепочке без выбора');
    }
    measure(path);
  };
  for (const [node, ids] of adjacency)
    if (ids.length !== 2) for (const id of ids) if (!seen.has(id)) walk(node, id);
  if (seen.size !== edges.length)
    fail('FORCED_CYCLE', 'generation', 'Компонент цикла не имеет выхода или выбора');
  return { maxStraightM: Math.max(maxStraightM, straightMetric(mesh)), maxForcedM };
}
export function isolatedIslands(physical: PhysicalSnapshot): number {
  const boundary = physical.floor.flatMap((p) => ringEdges(p[0]!)),
    index = buildSpatialIndex(boundary.map((e) => bounds(e)));
  let count = 0;
  for (const component of physical.obstacles) {
    const touches = component.flatMap(ringEdges).some(([a, b]) => {
      const box = bounds([a, b]),
        epsilon = 1e-5;
      return querySpatialIndex(index, {
        minX: box.minX - epsilon,
        maxX: box.maxX + epsilon,
        minZ: box.minZ - epsilon,
        maxZ: box.maxZ + epsilon,
      }).some((id) => {
        const [c, d] = boundary[id]!;
        return (
          segmentsTouch(a, b, c, d) ||
          Math.min(
            pointSegmentDistance(a, c, d),
            pointSegmentDistance(b, c, d),
            pointSegmentDistance(c, a, b),
            pointSegmentDistance(d, a, b),
          ) <= epsilon
        );
      });
    });
    if (!touches) count++;
  }
  return count;
}
export function generationMetrics(
  physical: PhysicalSnapshot,
  nav: NavigationSnapshot,
  siteArea: number,
): GenerationMetrics {
  const modulesByDefinition: Record<string, number> = {};
  for (const i of physical.document.instances)
    modulesByDefinition[i.definitionHash] = (modulesByDefinition[i.definitionHash] ?? 0) + 1;
  return {
    coverage: multiArea(physical.accessibleRegions) / siteArea,
    routeLengthM: nav.referenceLengthM,
    routeQuality: 'reference-approximate',
    cycles: nav.semantic.cycles,
    components: nav.semantic.components,
    decisionCount: nav.semantic.decisionCount,
    ...runMetrics(nav),
    isolatedWallIslands: isolatedIslands(physical),
    modulesByDefinition,
    quantities: physical.quantities,
  };
}
export function diversityHash(physical: PhysicalSnapshot): string {
  const box = bounds(physical.rooms.flatMap((r) => r.floor.flat())),
    point = (p: Point) => [Math.round((p.x - box.minX) * 1e6), Math.round((p.z - box.minZ) * 1e6)],
    ring = (input: Point[]) => {
      const vertices = input.map(point),
        rotations: string[] = [];
      for (const direction of [vertices, [...vertices].reverse()]) {
        let first = 0;
        for (let i = 1; i < direction.length; i++)
          if (JSON.stringify(direction[i]) < JSON.stringify(direction[first])) first = i;
        rotations.push(JSON.stringify([...direction.slice(first), ...direction.slice(0, first)]));
      }
      return rotations.sort()[0]!;
    },
    polygon = (p: Polygon) => [ring(p[0]!), ...p.slice(1).map(ring).sort()],
    openings = new Map(
      physical.openPassages.map((o) => [
        o.id,
        hashValue({ ends: [point(o.start), point(o.end)].sort(), role: o.role }),
      ]),
    );
  return hashValue({
    physicalProfile: physical.document.physicalProfile,
    rooms: physical.rooms.map((r) => hashValue(polygon(r.floor))).sort(),
    openings: [...openings.values()].sort(),
    connections: physical.connections
      .map((c) => [openings.get(c.openingA), openings.get(c.openingB)].sort())
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  });
}
