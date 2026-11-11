import { multiPointLocation, locatedInMulti } from '../geometry/point-location';
import type { PointLocationIndex } from '../geometry/point-location';
import type { Point } from '../domain';
import type { PhysicalSnapshot } from '../geometry/compile/types';
import { pointInMulti } from '../geometry/kernel/contour';
import {
  bounds,
  distance,
  lerp,
  pointSegmentDistance,
  ringEdges,
  segmentsTouch,
} from '../geometry/predicates';
import { buildSpatialIndex, querySpatialIndex } from '../geometry/spatial-index';
import type { SpatialIndex } from '../geometry/spatial-index';

export interface CollisionWorld {
  edges: [Point, Point][];
  index: SpatialIndex;
  physical: PhysicalSnapshot;
  floorLocation: PointLocationIndex[];
  obstacleLocation: PointLocationIndex[];
}
export function collisionWorld(physical: PhysicalSnapshot): CollisionWorld {
  const edges = [...physical.floor, ...physical.obstacles].flatMap((p) => p.flatMap(ringEdges));
  return {
    edges,
    index: buildSpatialIndex(edges.map((e) => bounds(e))),
    physical,
    floorLocation: multiPointLocation(physical.floor),
    obstacleLocation: multiPointLocation(physical.obstacles),
  };
}
export function validCenter(world: CollisionWorld, point: Point, radius: number): boolean {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.z) ||
    !Number.isFinite(radius) ||
    radius < 0
  )
    return false;
  if (
    !locatedInMulti(world.floorLocation, point) ||
    locatedInMulti(world.obstacleLocation, point, false)
  )
    return false;
  return querySpatialIndex(world.index, {
    minX: point.x - radius,
    minZ: point.z - radius,
    maxX: point.x + radius,
    maxZ: point.z + radius,
  }).every((id) => pointSegmentDistance(point, ...world.edges[id]!) >= radius - 1e-8);
}
export function sweptClear(world: CollisionWorld, from: Point, to: Point, radius: number): boolean {
  if (!validCenter(world, from, radius) || !validCenter(world, to, radius)) return false;
  const box = bounds([from, to]),
    area = {
      minX: box.minX - radius,
      minZ: box.minZ - radius,
      maxX: box.maxX + radius,
      maxZ: box.maxZ + radius,
    };
  for (const id of querySpatialIndex(world.index, area)) {
    const [a, b] = world.edges[id]!;
    if (segmentsTouch(from, to, a, b, 0)) return false;
    if (
      Math.min(
        pointSegmentDistance(a, from, to),
        pointSegmentDistance(b, from, to),
        pointSegmentDistance(from, a, b),
        pointSegmentDistance(to, a, b),
      ) <
      radius - 1e-8
    )
      return false;
  }
  return true;
}
interface Hit {
  t: number;
  normal: Point;
}
function sweepEdge(point: Point, delta: Point, radius: number, a: Point, b: Point): Hit | null {
  const length = distance(a, b),
    tangent = { x: (b.x - a.x) / length, z: (b.z - a.z) / length },
    normal = { x: -tangent.z, z: tangent.x };
  const hits: Hit[] = [],
    speed2 = delta.x * delta.x + delta.z * delta.z;
  if (speed2 < 1e-20) return null;
  const side = (point.x - a.x) * normal.x + (point.z - a.z) * normal.z,
    approach = delta.x * normal.x + delta.z * normal.z;
  if (Math.abs(approach) > 1e-12) {
    for (const sign of [-1, 1]) {
      const t = (sign * radius - side) / approach;
      if (t < -1e-8 || t > 1) continue;
      const contact = lerp(point, { x: point.x + delta.x, z: point.z + delta.z }, Math.max(0, t));
      const along = (contact.x - a.x) * tangent.x + (contact.z - a.z) * tangent.z;
      const n = { x: normal.x * sign, z: normal.z * sign };
      if (along >= 0 && along <= length && delta.x * n.x + delta.z * n.z < -1e-10)
        hits.push({ t: Math.max(0, t), normal: n });
    }
  }
  for (const end of [a, b]) {
    const p = { x: point.x - end.x, z: point.z - end.z },
      linear = 2 * (p.x * delta.x + p.z * delta.z),
      constant = p.x * p.x + p.z * p.z - radius * radius,
      discriminant = linear * linear - 4 * speed2 * constant;
    if (discriminant < 0) continue;
    const t = (-linear - Math.sqrt(discriminant)) / (2 * speed2);
    if (t < -1e-8 || t > 1) continue;
    const contact = { x: p.x + delta.x * t, z: p.z + delta.z * t },
      size = Math.hypot(contact.x, contact.z);
    if (size < 1e-12) continue;
    const n = { x: contact.x / size, z: contact.z / size };
    if (delta.x * n.x + delta.z * n.z < -1e-10) hits.push({ t: Math.max(0, t), normal: n });
  }
  return hits.sort((a, b) => a.t - b.t)[0] ?? null;
}
export function move(
  world: CollisionWorld,
  point: Point,
  displacement: Point,
  radius: number,
  onSegment?: (from: Point, to: Point) => void,
): Point {
  if (
    !validCenter(world, point, radius) ||
    !Number.isFinite(displacement.x) ||
    !Number.isFinite(displacement.z)
  )
    return { ...point };
  let position = { ...point },
    remaining = { ...displacement };
  for (
    let iteration = 0;
    iteration < 5 && Math.hypot(remaining.x, remaining.z) > 1e-8;
    iteration++
  ) {
    const end = { x: position.x + remaining.x, z: position.z + remaining.z },
      b = bounds([position, end]),
      area = {
        minX: b.minX - radius,
        minZ: b.minZ - radius,
        maxX: b.maxX + radius,
        maxZ: b.maxZ + radius,
      };
    let first: Hit | null = null;
    for (const id of querySpatialIndex(world.index, area)) {
      const hit = sweepEdge(position, remaining, radius, ...world.edges[id]!);
      if (hit && (!first || hit.t < first.t)) first = hit;
    }
    if (!first) {
      if (sweptClear(world, position, end, radius)) {
        onSegment?.(position, end);
        position = end;
      }
      break;
    }
    const step = Math.max(0, first.t - 1e-6 / Math.max(1e-6, Math.hypot(remaining.x, remaining.z)));
    const next = { x: position.x + remaining.x * step, z: position.z + remaining.z * step };
    if (!validCenter(world, next, radius)) break;
    onSegment?.(position, next);
    position = next;
    remaining = { x: remaining.x * (1 - first.t), z: remaining.z * (1 - first.t) };
    const into = remaining.x * first.normal.x + remaining.z * first.normal.z;
    if (into < 0) {
      remaining.x -= first.normal.x * into;
      remaining.z -= first.normal.z * into;
    }
  }
  return position;
}
