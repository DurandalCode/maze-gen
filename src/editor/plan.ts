import { canonical } from '../domain';
import type { BoundaryLoop, Document, Instance, Opening, Point, Segment } from '../domain';
import { expandDefinition } from '../catalog/catalog';
import { bounds, pointInRing, pointSegmentDistance } from '../geometry/predicates';
import type { Bounds } from '../geometry/predicates';
import { sampleSegment, segmentPoint } from '../geometry/kernel/contour';
import { openingCut } from '../geometry/compile/openings';
import { buildSpatialIndex, querySpatialIndex } from '../geometry/spatial-index';
import type { SpatialIndex } from '../geometry/spatial-index';
import type { Gesture, Selection, Transform } from './commands';
export interface LocalShape {
  key: string;
  boundary: BoundaryLoop[];
  rings: { role: 'outer' | 'hole'; points: Point[] }[];
}
export interface PlanInstance {
  instance: Instance;
  local: LocalShape;
  rings: { role: 'outer' | 'hole'; points: Point[] }[];
  boundary: BoundaryLoop[];
  bounds: Bounds;
  wallPaths: Point[][];
}
export interface PlanOpening {
  opening: Opening;
  center: Point;
  start: Point;
  end: Point;
  error: string | null;
}
export interface PlanWall {
  id: string;
  path: Point[];
  bounds: Bounds;
}
export interface PlanModel {
  moduleIds: string[];
  wallIds: string[];
  modules: Map<string, PlanInstance>;
  openings: Map<string, PlanOpening>;
  walls: Map<string, PlanWall>;
  shapes: Map<string, LocalShape>;
  moduleIndex: SpatialIndex;
  wallIndex: SpatialIndex;
  site: { role: 'outer' | 'hole'; points: Point[] }[];
  bounds: Bounds;
}
export function transformPoint(point: Point, transform: Transform): Point {
  const c = Math.cos(transform.rotationRad),
    s = Math.sin(transform.rotationRad);
  return {
    x: point.x * c - point.z * s + transform.position.x,
    z: point.x * s + point.z * c + transform.position.z,
  };
}
export function inversePoint(point: Point, transform: Transform): Point {
  const x = point.x - transform.position.x,
    z = point.z - transform.position.z,
    c = Math.cos(transform.rotationRad),
    s = Math.sin(transform.rotationRad);
  return { x: x * c + z * s, z: -x * s + z * c };
}
function worldBoundary(loops: BoundaryLoop[], instance: Instance): BoundaryLoop[] {
  return loops.map((loop) => ({
    ...loop,
    segments: loop.segments.map((segment) =>
      segment.kind === 'line'
        ? {
            ...segment,
            from: transformPoint(segment.from, instance),
            to: transformPoint(segment.to, instance),
          }
        : {
            ...segment,
            center: transformPoint(segment.center, instance),
            startAngle: segment.startAngle + instance.rotationRad,
          },
    ),
  }));
}
/** No boolean/navmesh/compiler work. Cache source contours and update only changed transforms. */
export function planModel(document: Document, previous?: PlanModel): PlanModel {
  const modules = new Map<string, PlanInstance>(),
    shapes = new Map<string, LocalShape>();
  for (const instance of document.instances) {
    const shapeKey = `${instance.definitionHash}/${canonical(instance.parameterValues)}`;
    let local = shapes.get(shapeKey) ?? previous?.shapes.get(shapeKey);
    if (!local) {
      const definition = document.definitions.find(
        (d) => d.contentHash === instance.definitionHash,
      );
      if (!definition) throw new Error('Нет определения модуля');
      const boundary = expandDefinition(definition, instance.parameterValues);
      local = {
        key: shapeKey,
        boundary,
        rings: boundary.map((loop) => ({
          role: loop.role,
          points: loop.segments.flatMap((s) => sampleSegment(s).slice(0, -1)),
        })),
      };
    }
    shapes.set(shapeKey, local);
    const old = previous?.modules.get(instance.id);
    if (
      old &&
      old.local === local &&
      old.instance.position.x === instance.position.x &&
      old.instance.position.z === instance.position.z &&
      old.instance.rotationRad === instance.rotationRad
    ) {
      modules.set(instance.id, { ...old, instance });
      continue;
    }
    const rings = local.rings.map((ring) => ({
      role: ring.role,
      points: ring.points.map((p) => transformPoint(p, instance)),
    }));
    modules.set(instance.id, {
      instance,
      local,
      rings,
      boundary: worldBoundary(local.boundary, instance),
      bounds: bounds(rings.flatMap((r) => r.points)),
      wallPaths: [],
    });
  }
  const openings = new Map<string, PlanOpening>();
  const cuts = new Map<string, [number, number][]>();
  for (const opening of document.openings) {
    const module = modules.get(opening.instanceId);
    if (!module) continue;
    const definition = document.definitions.find(
      (d) => d.contentHash === module.instance.definitionHash,
    )!;
    const region = definition.openingRegions.find((r) => r.id === opening.regionId)!;
    const loop = module.boundary.find((loop) =>
      loop.segments.some((s) => s.id === opening.boundarySegmentId),
    );
    const segment = loop?.segments.find((s) => s.id === opening.boundarySegmentId);
    if (!loop || !segment || !region) continue;
    const center = segmentPoint(segment, opening.uCenter);
    try {
      const cut = openingCut(opening, region, loop, document.physicalProfile.postWidthM);
      const cutKey = `${opening.instanceId}/${opening.boundarySegmentId}`;
      cuts.set(cutKey, [...(cuts.get(cutKey) ?? []), ...cut.intervals]);
      openings.set(opening.id, {
        opening,
        center: cut.physical.center,
        start: cut.physical.start,
        end: cut.physical.end,
        error: null,
      });
    } catch (error) {
      openings.set(opening.id, {
        opening,
        center,
        start: center,
        end: center,
        error: error instanceof Error ? error.message : 'Неверный проём',
      });
    }
  }
  for (const module of modules.values()) {
    module.wallPaths = [];
    for (const loop of module.boundary)
      for (const segment of loop.segments) {
        let visible: [number, number][] = [[0, 1]];
        for (const [from, to] of cuts.get(`${module.instance.id}/${segment.id}`) ?? [])
          visible = visible.flatMap(([a, b]) =>
            to <= a || from >= b
              ? [[a, b] as [number, number]]
              : [
                  ...(from > a ? [[a, from] as [number, number]] : []),
                  ...(to < b ? [[to, b] as [number, number]] : []),
                ],
          );
        for (const [a, b] of visible) {
          if (b - a <= 1e-12) continue;
          const part: Segment =
            segment.kind === 'line'
              ? { ...segment, from: segmentPoint(segment, a), to: segmentPoint(segment, b) }
              : {
                  ...segment,
                  startAngle: segment.startAngle + a * segment.sweep,
                  sweep: (b - a) * segment.sweep,
                };
          module.wallPaths.push(sampleSegment(part));
        }
      }
  }
  const walls = new Map<string, PlanWall>();
  for (const wall of document.freeWalls) {
    const path = sampleSegment(wall.centerline);
    walls.set(wall.id, { id: wall.id, path, bounds: bounds(path) });
  }
  const site = document.site.boundaryLoops.map((loop) => ({
    role: loop.role,
    points: loop.segments.flatMap((s) => sampleSegment(s).slice(0, -1)),
  }));
  return {
    modules,
    moduleIds: [...modules.keys()],
    wallIds: [...walls.keys()],
    openings,
    walls,
    shapes,
    site,
    bounds: bounds(site.flatMap((r) => r.points)),
    moduleIndex: buildSpatialIndex(
      [...modules.values()].map((m) => m.bounds),
      4,
    ),
    wallIndex: buildSpatialIndex(
      [...walls.values()].map((w) => w.bounds),
      4,
    ),
  };
}
export function hitPlan(
  model: PlanModel,
  document: Document,
  point: Point,
  toleranceM: number,
): Selection | null {
  for (const opening of [...model.openings.values()].reverse())
    if (Math.hypot(opening.center.x - point.x, opening.center.z - point.z) <= toleranceM * 1.4)
      return { field: 'openings', id: opening.opening.id };
  for (const connection of [...document.connections].reverse()) {
    const a = model.openings.get(connection.openingA),
      b = model.openings.get(connection.openingB);
    if (a && b && pointSegmentDistance(point, a.center, b.center) <= toleranceM)
      return { field: 'connections', id: connection.id };
  }
  const query = {
    minX: point.x - toleranceM,
    minZ: point.z - toleranceM,
    maxX: point.x + toleranceM,
    maxZ: point.z + toleranceM,
  };
  for (const index of querySpatialIndex(model.wallIndex, query).reverse()) {
    const id = model.wallIds[index]!;
    const wall = model.walls.get(id)!;
    for (let i = 1; i < wall.path.length; i++)
      if (
        pointSegmentDistance(point, wall.path[i - 1]!, wall.path[i]!) <=
        toleranceM + document.physicalProfile.panelThicknessM / 2
      )
        return { field: 'freeWalls', id };
  }
  for (const index of querySpatialIndex(model.moduleIndex, query).reverse()) {
    const id = model.moduleIds[index]!;
    const module = model.modules.get(id)!,
      local = inversePoint(point, module.instance);
    if (
      module.local.rings.some((r) => r.role === 'outer' && pointInRing(local, r.points)) &&
      !module.local.rings.some((r) => r.role === 'hole' && pointInRing(local, r.points))
    )
      return { field: 'instances', id };
  }
  return null;
}
export function previewRings(
  module: PlanInstance,
  gesture: Gesture | null,
): { role: 'outer' | 'hole'; points: Point[] }[] {
  if (!gesture || gesture.instanceId !== module.instance.id) return module.rings;
  return module.local.rings.map((r) => ({
    role: r.role,
    points: r.points.map((p) => transformPoint(p, gesture.preview)),
  }));
}
export function nearestBoundary(
  module: PlanInstance,
  point: Point,
): { segment: Segment; u: number; point: Point; distance: number } | null {
  let best: ReturnType<typeof nearestBoundary> = null;
  for (const loop of module.boundary)
    for (const segment of loop.segments) {
      let u: number;
      if (segment.kind === 'line') {
        const dx = segment.to.x - segment.from.x,
          dz = segment.to.z - segment.from.z;
        u = Math.max(
          0,
          Math.min(
            1,
            ((point.x - segment.from.x) * dx + (point.z - segment.from.z) * dz) /
              (dx * dx + dz * dz),
          ),
        );
      } else {
        const angle = Math.atan2(point.z - segment.center.z, point.x - segment.center.x),
          delta =
            segment.sweep > 0
              ? (((angle - segment.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
              : -((((segment.startAngle - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        const projected = delta / segment.sweep;
        if (projected <= 1) u = Math.max(0, projected);
        else {
          const start = segmentPoint(segment, 0),
            end = segmentPoint(segment, 1);
          u =
            Math.hypot(point.x - start.x, point.z - start.z) <=
            Math.hypot(point.x - end.x, point.z - end.z)
              ? 0
              : 1;
        }
      }
      const candidate = segmentPoint(segment, u),
        distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
      if (!best || distance < best.distance) best = { segment, u, point: candidate, distance };
    }
  return best;
}
