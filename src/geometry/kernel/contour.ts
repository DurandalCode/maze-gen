import { AREA_EPSILON_M2, GEOMETRY_EPSILON_M, MAX_ARC_SAGITTA_M } from '../../domain/profile';
import { fail } from '../../domain/validate';
import { LIMITS } from '../../domain/types';
import type { BoundaryLoop, Point, Segment } from '../../domain/types';
import { buildSpatialIndex, querySpatialIndex } from '../spatial-index';
import {
  bounds,
  distance,
  pointInRing,
  pointSegmentDistance,
  ringEdges,
  segmentsTouch,
  signedArea,
} from '../predicates';

export type Polygon = Point[][];
export type MultiPolygon = Polygon[];
export function segmentPoint(segment: Segment, u: number): Point {
  if (segment.kind === 'line')
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * u,
      z: segment.from.z + (segment.to.z - segment.from.z) * u,
    };
  const angle = segment.startAngle + segment.sweep * u;
  return {
    x: segment.center.x + segment.radius * Math.cos(angle),
    z: segment.center.z + segment.radius * Math.sin(angle),
  };
}
export function segmentLength(segment: Segment): number {
  return segment.kind === 'line'
    ? distance(segment.from, segment.to)
    : segment.radius * Math.abs(segment.sweep);
}
export function sampleSegment(segment: Segment, breakpoints: readonly number[] = []): Point[] {
  let steps = 1;
  if (segment.kind === 'arc') {
    if (
      !Number.isFinite(segment.radius) ||
      segment.radius <= 0 ||
      !Number.isFinite(segment.sweep) ||
      Math.abs(segment.sweep) > Math.PI * 2 + 1e-9 ||
      segmentLength(segment) <= GEOMETRY_EPSILON_M
    )
      fail('DEGENERATE', segment.id, 'Invalid or near-zero arc');
    // Limit to pi/2 even when radius is below the sagitta bound.
    const maxAngle = Math.min(
      Math.PI / 2,
      2 * Math.acos(Math.max(-1, Math.min(1, 1 - MAX_ARC_SAGITTA_M / segment.radius))),
    );
    steps = Math.ceil(Math.abs(segment.sweep) / maxAngle);
    if (!Number.isFinite(steps) || steps > LIMITS.physicalSegments)
      fail(
        'RESOURCE_LIMIT',
        segment.id,
        'Arc approximation exceeds segment limit',
        steps,
        LIMITS.physicalSegments,
      );
  }
  if (breakpoints.length + steps + 1 > LIMITS.physicalSegments)
    fail('RESOURCE_LIMIT', segment.id, 'Too many arc cuts');
  const us = new Set<number>([0, 1]);
  for (let i = 1; i < steps; i++) us.add(i / steps);
  for (const u of breakpoints) {
    if (!Number.isFinite(u) || u < 0 || u > 1)
      fail('RANGE', segment.id, 'Invalid segment breakpoint');
    us.add(u);
  }
  return [...us].sort((a, b) => a - b).map((u) => segmentPoint(segment, u));
}
export function validateRing(input: readonly Point[], path = 'ring'): Point[] {
  const ring = input.map((p) => ({ x: p.x, z: p.z }));
  if (ring.length > 1 && distance(ring[0]!, ring[ring.length - 1]!) <= GEOMETRY_EPSILON_M)
    ring.pop();
  if (ring.length < 3) fail('DEGENERATE', path, 'Ring needs at least three vertices');
  if (ring.length > LIMITS.physicalSegments) fail('RESOURCE_LIMIT', path, 'Too many ring segments');
  for (const p of ring)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z))
      fail('NON_FINITE', path, 'Invalid ring coordinate');
  const edges = ringEdges(ring),
    index = buildSpatialIndex(edges.map((e) => bounds(e)));
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i]!;
    if (distance(a, b) <= GEOMETRY_EPSILON_M) fail('DEGENERATE', path, 'Zero-length ring edge');
    const previous = ring[(i + ring.length - 1) % ring.length]!;
    // Adjacent edges may share one endpoint, but must not double back.
    if (
      pointSegmentDistance(b, previous, a) <= GEOMETRY_EPSILON_M ||
      pointSegmentDistance(previous, a, b) <= GEOMETRY_EPSILON_M
    )
      fail('SELF_INTERSECTION', path, 'Adjacent edges overlap');
    const box = bounds([a, b]),
      epsilon = GEOMETRY_EPSILON_M;
    for (const j of querySpatialIndex(index, {
      minX: box.minX - epsilon,
      minZ: box.minZ - epsilon,
      maxX: box.maxX + epsilon,
      maxZ: box.maxZ + epsilon,
    })) {
      if (j <= i || j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
      if (segmentsTouch(a, b, ...edges[j]!))
        fail('SELF_INTERSECTION', path, 'Boundary crosses or touches itself');
    }
  }
  if (Math.abs(signedArea(ring)) <= AREA_EPSILON_M2) fail('DEGENERATE', path, 'Zero-area ring');
  return ring;
}
export function validatePolygon(input: Polygon, path = 'polygon'): Polygon {
  if (input.length === 0) return [];
  const rings = input.map((r, i) => validateRing(r, `${path}[${i}]`));
  const outer = rings[0]!;
  const edges = rings.flatMap((ring, owner) => ringEdges(ring).map(([a, b]) => ({ a, b, owner }))),
    index = buildSpatialIndex(edges.map((e) => bounds([e.a, e.b])));
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!,
      box = bounds([edge.a, edge.b]),
      epsilon = GEOMETRY_EPSILON_M;
    for (const j of querySpatialIndex(index, {
      minX: box.minX - epsilon,
      minZ: box.minZ - epsilon,
      maxX: box.maxX + epsilon,
      maxZ: box.maxZ + epsilon,
    })) {
      if (j <= i) continue;
      const other = edges[j]!;
      if (edge.owner === other.owner) continue;
      if (segmentsTouch(edge.a, edge.b, other.a, other.b))
        fail('INVALID_HOLE', path, 'Hole boundary touches another ring');
    }
  }
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]!;
    if (!pointInRing(hole[0]!, outer, false))
      fail('INVALID_HOLE', path, 'Hole must lie strictly inside the outer ring');
    for (let j = 0; j < i; j++) {
      const other = rings[j]!;
      if (j > 0 && (pointInRing(hole[0]!, other) || pointInRing(other[0]!, hole)))
        fail('INVALID_HOLE', path, 'Holes overlap or contain each other');
    }
  }
  return rings.map((ring, i) => (signedArea(ring) > 0 === (i === 0) ? ring : [...ring].reverse()));
}
export function contourPolygon(
  loops: readonly BoundaryLoop[],
  cuts: ReadonlyMap<string, readonly number[]> = new Map(),
): Polygon {
  if (loops.filter((l) => l.role === 'outer').length !== 1)
    fail('SCHEMA', 'contour', 'Exactly one outer boundary required');
  let total = 0;
  const ordered = [
    ...loops.filter((l) => l.role === 'outer'),
    ...loops.filter((l) => l.role === 'hole'),
  ];
  const rings = ordered.map((loop) => {
    const points: Point[] = [];
    for (let i = 0; i < loop.segments.length; i++) {
      const segment = loop.segments[i]!,
        next = loop.segments[(i + 1) % loop.segments.length]!;
      if (distance(segmentPoint(segment, 1), segmentPoint(next, 0)) > GEOMETRY_EPSILON_M)
        fail('DISCONNECTED_BOUNDARY', loop.id, 'Boundary segment endpoints do not match');
      const samples = sampleSegment(segment, cuts.get(segment.id));
      total += samples.length - 1;
      if (total > LIMITS.physicalSegments)
        fail(
          'RESOURCE_LIMIT',
          loop.id,
          'Physical segment limit exceeded',
          total,
          LIMITS.physicalSegments,
        );
      points.push(...samples.slice(0, -1));
    }
    return points;
  });
  return validatePolygon(rings);
}
export function polygonArea(polygon: Polygon): number {
  return polygon.reduce(
    (area, ring, i) => area + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)),
    0,
  );
}
export const multiArea = (polygons: MultiPolygon): number =>
  polygons.reduce((area, p) => area + polygonArea(p), 0);
export function pointInPolygon(point: Point, polygon: Polygon, includeBoundary = true): boolean {
  return (
    !!polygon[0] &&
    pointInRing(point, polygon[0], includeBoundary) &&
    polygon.slice(1).every((h) => !pointInRing(point, h, !includeBoundary))
  );
}
export function pointInMulti(
  point: Point,
  polygons: MultiPolygon,
  includeBoundary = true,
): boolean {
  return polygons.some((p) => pointInPolygon(point, p, includeBoundary));
}
