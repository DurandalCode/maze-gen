import type { Point } from '../domain';
import type { MultiPolygon, Polygon } from './kernel/contour';
import { bounds, pointSegmentDistance, ringEdges } from './predicates';
import type { Bounds } from './predicates';
export interface PointLocationIndex {
  bounds: Bounds;
  cellHeight: number;
  buckets: Record<string, number[]>;
  edges: { a: Point; b: Point; ring: number; slope: number }[];
  ringCount: number;
}
/** A serializable horizontal-ray index; containment keeps the exact same predicate. */
export function pointLocation(polygon: Polygon): PointLocationIndex {
  const box = bounds(polygon[0] ?? []),
    cellHeight = Math.max(1e-4, (box.maxZ - box.minZ) / 128),
    edges = polygon.flatMap((ring, index) =>
      ringEdges(ring).map(([a, b]) => ({ a, b, ring: index, slope: (b.x - a.x) / (b.z - a.z) })),
    ),
    buckets: Record<string, number[]> = {};
  edges.forEach((edge, id) => {
    const lo = Math.floor((Math.min(edge.a.z, edge.b.z) - box.minZ - 1e-8) / cellHeight),
      hi = Math.floor((Math.max(edge.a.z, edge.b.z) - box.minZ + 1e-8) / cellHeight);
    for (let bin = lo; bin <= hi; bin++) (buckets[bin] ??= []).push(id);
  });
  return { bounds: box, cellHeight, buckets, edges, ringCount: polygon.length };
}
export function locatedIn(index: PointLocationIndex, p: Point, includeBoundary = true): boolean {
  const b = index.bounds;
  if (p.x < b.minX - 1e-8 || p.x > b.maxX + 1e-8 || p.z < b.minZ - 1e-8 || p.z > b.maxZ + 1e-8)
    return false;
  const bin = Math.floor((p.z - b.minZ) / index.cellHeight),
    parity = new Uint8Array(index.ringCount);
  for (const id of index.buckets[bin] ?? []) {
    const { a, b, ring, slope } = index.edges[id]!;
    if (pointSegmentDistance(p, a, b) <= 1e-8) return includeBoundary;
    if (a.z > p.z !== b.z > p.z && p.x < a.x + (p.z - a.z) * slope)
      parity[ring] = parity[ring] === 1 ? 0 : 1;
  }
  return parity[0] === 1 && parity.slice(1).every((n) => n === 0);
}
export function multiPointLocation(polygons: MultiPolygon): PointLocationIndex[] {
  return polygons.map(pointLocation);
}
export function locatedInMulti(
  indices: PointLocationIndex[],
  point: Point,
  includeBoundary = true,
): boolean {
  return indices.some((index) => locatedIn(index, point, includeBoundary));
}
