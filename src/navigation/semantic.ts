import { fail } from '../domain/validate';
import type { Point } from '../domain';
import { kernel, triangulate } from '../geometry/kernel/boolean';
import { pointInPolygon } from '../geometry/kernel/contour';
import type { MultiPolygon, Polygon } from '../geometry/kernel/contour';
import { bounds, distance } from '../geometry/predicates';
import { triangleAdjacency } from './adjacency';
import { sweptClear } from './collision';
import type { NavigationMesh } from './navmesh';

export interface SemanticNode {
  id: string;
  roomId: string;
  region: Polygon;
  position: Point;
  degree: number;
}
export interface SemanticEdge {
  id: string;
  from: string;
  to: string;
  kind: 'connection' | 'intrinsic-cycle';
  path: Point[];
  lengthM: number;
}
export interface SemanticGraph {
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  components: number;
  cycles: number;
  decisionCount: number;
  entranceNode: string;
  exitNode: string;
}
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const length = (path: Point[]) => path.slice(1).reduce((n, p, i) => n + distance(path[i]!, p), 0);
/** Fundamental cycles from the polygon dual graph; the number is fixed by holes, not tessellation. */
function physicalCycles(region: Polygon, mesh: NavigationMesh): Point[][] {
  const t = triangulate(region),
    centers = t.triangles.map((ids) => {
      const vs = ids.map((id) => t.vertices[id]!);
      return { x: vs.reduce((n, p) => n + p.x, 0) / 3, z: vs.reduce((n, p) => n + p.z, 0) / 3 };
    });
  if (region.length === 1) return [];
  const neighbors = triangleAdjacency(
    t.triangles.map((ids) => ids.map((id) => t.vertices[id]!) as [Point, Point, Point]),
  );
  const adjacency = neighbors.map((ns) =>
    ns.map((n) => ({ id: n.triangle, portal: midpoint(...n.portal) })),
  );
  const dual = adjacency.flatMap((ns, a) =>
    ns.filter((n) => n.id > a).map((n) => ({ a, b: n.id, portal: n.portal })),
  );
  const parent = new Map<number, { id: number; portal: Point }>(),
    seen = new Set([0]),
    queue = [0];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const next of adjacency[id]!) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      queue.push(next.id);
      parent.set(next.id, { id, portal: next.portal });
    }
  }
  if (seen.size !== t.triangles.length)
    fail('INVALID_TOPOLOGY', 'navigation', 'Polygon triangulation is not connected');
  const cycles: Point[][] = [];
  for (const edge of dual) {
    if (parent.get(edge.a)?.id === edge.b || parent.get(edge.b)?.id === edge.a) continue;
    const aAncestors = new Map<number, Point[]>();
    let a = edge.a,
      aPath: Point[] = [centers[a]!];
    aAncestors.set(a, [...aPath]);
    while (parent.has(a)) {
      const p = parent.get(a)!;
      aPath.push(p.portal, centers[p.id]!);
      a = p.id;
      aAncestors.set(a, [...aPath]);
    }
    let b = edge.b,
      bPath: Point[] = [centers[b]!];
    while (!aAncestors.has(b) && parent.has(b)) {
      const p = parent.get(b)!;
      bPath.push(p.portal, centers[p.id]!);
      b = p.id;
    }
    const path = [
      ...aAncestors.get(b)!,
      ...bPath.slice(0, -1).reverse(),
      edge.portal,
      centers[edge.a]!,
    ];
    if (!path.slice(1).every((p, i) => sweptClear(mesh.collision, path[i]!, p, mesh.radius)))
      fail('INVALID_CYCLE', 'navigation', 'Intrinsic cycle failed physical verification');
    cycles.push(path);
  }
  if (cycles.length !== region.length - 1)
    fail('INVALID_TOPOLOGY', 'navigation', 'Polygon cycle rank differs from hole count');
  return cycles;
}
export function buildSemanticGraph(
  mesh: NavigationMesh,
  providedTiles: Map<string, MultiPolygon> | null = null,
): SemanticGraph {
  const physical = mesh.collision.physical,
    nodes: SemanticNode[] = [],
    edges: SemanticEdge[] = [];
  const prepared = kernel.prepare(mesh.area);
  const tiles = providedTiles ?? new Map<string, MultiPolygon>();
  const regionsFor = (
    room: NavigationMesh['collision']['physical']['rooms'][number],
  ): MultiPolygon => {
    if (!providedTiles) return kernel.boolean('intersection', prepared, [room.floor]);
    const box = bounds(room.floor[0]!),
      pieces: MultiPolygon = [];
    for (let x = Math.floor(box.minX / 10); x < Math.ceil(box.maxX / 10); x++)
      for (let z = Math.floor(box.minZ / 10); z < Math.ceil(box.maxZ / 10); z++) {
        const key = `${x},${z}`;
        let tile = tiles.get(key);
        if (!tile) {
          const cell: Polygon = [
            [
              { x: x * 10, z: z * 10 },
              { x: (x + 1) * 10, z: z * 10 },
              { x: (x + 1) * 10, z: (z + 1) * 10 },
              { x: x * 10, z: (z + 1) * 10 },
            ],
          ];
          tile = kernel.boolean('intersection', prepared, [cell]);
          tiles.set(key, tile);
        }
        pieces.push(...kernel.boolean('intersection', tile, [room.floor]));
      }
    return pieces.length
      ? kernel.boolean('union', [pieces[0]!], ...pieces.slice(1).map((p) => [p]))
      : [];
  };
  for (const room of physical.rooms) {
    const regions = regionsFor(room);
    if (!regions.length)
      fail('UNREACHABLE', room.id, 'Room has no accessible player-center region');
    regions.forEach((region, i) => {
      const triangulation = triangulate(region),
        first = triangulation.triangles[0];
      if (!first) return;
      const vertices = first.map((id) => triangulation.vertices[id]!);
      const node: SemanticNode = {
        id: `${room.id}/region-${i}`,
        roomId: room.id,
        region,
        position: {
          x: vertices.reduce((n, p) => n + p.x, 0) / 3,
          z: vertices.reduce((n, p) => n + p.z, 0) / 3,
        },
        degree: 0,
      };
      nodes.push(node);
      physicalCycles(region, mesh).forEach((path, j) =>
        edges.push({
          id: `${node.id}/cycle-${j}`,
          from: node.id,
          to: node.id,
          kind: 'intrinsic-cycle',
          path,
          lengthM: length(path),
        }),
      );
    });
  }
  const openingNode = (id: string): { node: SemanticNode; point: Point } => {
    const opening = physical.openPassages.find((o) => o.id === id)!;
    for (const offset of [mesh.radius + 0.03, mesh.radius + 0.1, mesh.radius + 0.25, 0.75, 1]) {
      const point = {
        x: opening.center.x - opening.normal.x * offset,
        z: opening.center.z - opening.normal.z * offset,
      };
      const node = nodes.find(
        (n) => n.roomId === opening.instanceId && pointInPolygon(point, n.region),
      );
      if (node) return { node, point };
    }
    fail('UNREACHABLE', id, 'Opening has no physically accessible owner region');
  };
  for (const connection of physical.connections) {
    const a = openingNode(connection.openingA),
      b = openingNode(connection.openingB),
      oa = physical.openPassages.find((o) => o.id === connection.openingA)!,
      ob = physical.openPassages.find((o) => o.id === connection.openingB)!;
    const path = [a.point, oa.center, ...(connection.direct ? [] : [ob.center]), b.point].filter(
      (p, i, all) => i === 0 || distance(p, all[i - 1]!) > 1e-8,
    );
    if (!path.slice(1).every((p, i) => sweptClear(mesh.collision, path[i]!, p, mesh.radius)))
      fail('CONNECTION_PATH', connection.id, 'Explicit connection has no verified crossing');
    edges.push({
      id: connection.id,
      from: a.node.id,
      to: b.node.id,
      kind: 'connection',
      path,
      lengthM: length(path),
    });
  }
  const entranceNode = openingNode(physical.openPassages.find((o) => o.role === 'entrance')!.id)
      .node.id,
    exitNode = openingNode(physical.openPassages.find((o) => o.role === 'exit')!.id).node.id;
  const seen = new Set<string>();
  let components = 0;
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    components++;
    const queue = [node.id];
    seen.add(node.id);
    for (let i = 0; i < queue.length; i++)
      for (const edge of edges) {
        const next = edge.from === queue[i] ? edge.to : edge.to === queue[i] ? edge.from : null;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
  }
  for (const edge of edges) {
    nodes.find((n) => n.id === edge.from)!.degree++;
    nodes.find((n) => n.id === edge.to)!.degree++;
  }
  // External terminals are virtual leaves and preserve cycle rank.
  nodes.find((n) => n.id === entranceNode)!.degree++;
  nodes.find((n) => n.id === exitNode)!.degree++;
  if (components !== 1)
    fail(
      'UNREACHABLE',
      'semantic',
      'Physical regions are not connected by declared passages',
      components,
      1,
    );
  return {
    nodes,
    edges,
    components,
    cycles: edges.length - nodes.length + components,
    decisionCount: nodes.filter((n) => n.degree >= 3).length,
    entranceNode,
    exitNode,
  };
}
