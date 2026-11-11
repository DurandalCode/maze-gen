import type { Point } from '../domain';
import { bounds, distance, lerp, pointSegmentDistance } from '../geometry/predicates';
import { buildSpatialIndex, querySpatialIndex } from '../geometry/spatial-index';
export interface TriangleNeighbor {
  triangle: number;
  portal: [Point, Point];
}
/** Handles partial shared edges when earcut eliminates a collinear boundary vertex. */
export function triangleAdjacency(
  triangles: readonly [Point, Point, Point][],
): TriangleNeighbor[][] {
  const adjacency = triangles.map(() => [] as TriangleNeighbor[]);
  const edges = triangles.flatMap((vertices, triangle) =>
    vertices.map((a, i) => ({ a, b: vertices[(i + 1) % 3]!, triangle })),
  );
  const index = buildSpatialIndex(edges.map((e) => bounds([e.a, e.b]))),
    seen = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!,
      length = distance(edge.a, edge.b),
      area = bounds([edge.a, edge.b]),
      epsilon = 1e-8;
    if (length < 1e-8) continue;
    for (const j of querySpatialIndex(index, {
      minX: area.minX - epsilon,
      minZ: area.minZ - epsilon,
      maxX: area.maxX + epsilon,
      maxZ: area.maxZ + epsilon,
    })) {
      if (j <= i) continue;
      const other = edges[j]!;
      if (edge.triangle === other.triangle) continue;
      const key = [edge.triangle, other.triangle].sort((a, b) => a - b).join('|');
      if (seen.has(key)) continue;
      const t = { x: (edge.b.x - edge.a.x) / length, z: (edge.b.z - edge.a.z) / length },
        signed = (p: Point) => (p.x - edge.a.x) * -t.z + (p.z - edge.a.z) * t.x;
      if (Math.abs(signed(other.a)) > epsilon || Math.abs(signed(other.b)) > epsilon) continue;
      const u = (p: Point) => (p.x - edge.a.x) * t.x + (p.z - edge.a.z) * t.z;
      const lo = Math.max(0, Math.min(u(other.a), u(other.b))),
        hi = Math.min(length, Math.max(u(other.a), u(other.b)));
      if (hi - lo <= 1e-6) continue;
      const portal: [Point, Point] = [
        lerp(edge.a, edge.b, lo / length),
        lerp(edge.a, edge.b, hi / length),
      ];
      adjacency[edge.triangle]!.push({ triangle: other.triangle, portal });
      adjacency[other.triangle]!.push({ triangle: edge.triangle, portal });
      seen.add(key);
    }
  }
  return adjacency.map((neighbors) => neighbors.sort((a, b) => a.triangle - b.triangle));
}
