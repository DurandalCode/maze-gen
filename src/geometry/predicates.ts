import type { Point } from '../domain/types';
export const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.z - a.z);
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
export function signedArea(ring: readonly Point[]): number {
  let a = 0;
  const base = ring[0];
  if (!base) return 0;
  for (let i = 1; i + 1 < ring.length; i++) a += cross(base, ring[i]!, ring[i + 1]!);
  return a / 2;
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length2 = dx * dx + dz * dz;
  if (length2 === 0) return distance(p, a);
  return distance(
    p,
    lerp(a, b, Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2))),
  );
}
export function segmentsTouch(a: Point, b: Point, c: Point, d: Point, epsilon = 1e-6): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  )
    return true;
  return (
    Math.min(
      pointSegmentDistance(a, c, d),
      pointSegmentDistance(b, c, d),
      pointSegmentDistance(c, a, b),
      pointSegmentDistance(d, a, b),
    ) <= epsilon
  );
}
export function pointInRing(p: Point, ring: readonly Point[], includeBoundary = true): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!,
      b = ring[i]!;
    if (pointSegmentDistance(p, a, b) <= 1e-8) return includeBoundary;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}
export function ringEdges(ring: readonly Point[]): [Point, Point][] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as [Point, Point]);
}
export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
export function bounds(points: readonly Point[]): Bounds {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}
export function boundsOverlap(a: Bounds, b: Bounds, margin = 0): boolean {
  return (
    a.maxX + margin >= b.minX &&
    a.minX - margin <= b.maxX &&
    a.maxZ + margin >= b.minZ &&
    a.minZ - margin <= b.maxZ
  );
}
