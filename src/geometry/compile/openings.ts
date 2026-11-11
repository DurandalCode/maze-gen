import { fail } from '../../domain/validate';
import type { BoundaryLoop, Opening, OpeningRegion, Point, Segment } from '../../domain';
import { cross, distance, signedArea } from '../predicates';
import { sampleSegment, segmentLength, segmentPoint } from '../kernel/contour';
import type { PhysicalOpening } from './types';

export interface OpeningCut {
  opening: Opening;
  segment: Segment;
  intervals: [number, number][];
  startU: number;
  endU: number;
  physical: PhysicalOpening;
}
const wrap = (u: number): number => ((u % 1) + 1) % 1;
export function openingCut(
  opening: Opening,
  region: OpeningRegion,
  loop: BoundaryLoop,
  postWidthM: number,
): OpeningCut {
  const segment = loop.segments.find((s) => s.id === opening.boundarySegmentId);
  if (!segment) fail('MISSING_REFERENCE', opening.id, 'Opening segment missing');
  const half =
    segment.kind === 'arc'
      ? Math.asin(opening.widthM / (2 * segment.radius)) / Math.abs(segment.sweep)
      : opening.widthM / segmentLength(segment) / 2;
  if (!Number.isFinite(half)) fail('WIDTH', opening.id, 'Opening wider than circle diameter');
  const full = segment.kind === 'arc' && Math.abs(Math.abs(segment.sweep) - Math.PI * 2) < 1e-9;
  const startU = opening.uCenter - half,
    endU = opening.uCenter + half;
  if (!full && (startU < 0 || endU > 1))
    fail('OPENING_REGION', opening.id, 'Opening crosses the end of a nonperiodic segment');
  const intervals: [number, number][] =
    startU < 0
      ? [
          [0, endU],
          [1 + startU, 1],
        ]
      : endU > 1
        ? [
            [startU, 1],
            [0, endU - 1],
          ]
        : [[startU, endU]];
  const allowed: [number, number][] =
    region.wrap && region.uMin > region.uMax
      ? [
          [region.uMin, 1],
          [0, region.uMax],
        ]
      : [[region.uMin, region.uMax]];
  for (const [a, b] of intervals)
    if (!allowed.some(([lo, hi]) => a >= lo - 1e-9 && b <= hi + 1e-9))
      fail('OPENING_REGION', opening.id, 'Opening falls outside its allowed region');
  if ((startU < 0 || endU > 1) && !region.wrap)
    fail('OPENING_REGION', opening.id, 'Region does not permit wrap');
  const start = segmentPoint(segment, full ? wrap(startU) : startU),
    end = segmentPoint(segment, full ? wrap(endU) : endU);
  const tangent = { x: end.x - start.x, z: end.z - start.z },
    length = distance(start, end);
  const ring = loop.segments.flatMap((s) => sampleSegment(s).slice(0, -1));
  const orientation = (signedArea(ring) > 0 ? 1 : -1) * (loop.role === 'outer' ? 1 : -1);
  const normal = { x: (orientation * tangent.z) / length, z: (-orientation * tangent.x) / length };
  const center = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  return {
    opening,
    segment,
    intervals,
    startU,
    endU,
    physical: {
      id: opening.id,
      instanceId: opening.instanceId,
      role: opening.role,
      start,
      end,
      center,
      normal,
      clearWidthM: length - postWidthM,
    },
  };
}
export function samePoint(a: Point, b: Point, epsilon = 1e-6): boolean {
  return distance(a, b) <= epsilon;
}
export function connectionFacing(a: PhysicalOpening, b: PhysicalOpening): boolean {
  const delta = { x: b.center.x - a.center.x, z: b.center.z - a.center.z };
  if (distance(a.center, b.center) < 1e-6)
    return a.normal.x * b.normal.x + a.normal.z * b.normal.z < -1 + 1e-6;
  return (
    delta.x * a.normal.x + delta.z * a.normal.z > 1e-6 &&
    delta.x * b.normal.x + delta.z * b.normal.z < -1e-6
  );
}
