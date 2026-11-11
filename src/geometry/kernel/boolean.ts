import earcut from 'earcut';
import { integerClip, integerOffset } from './clipper-adapter';
import type { ClipMulti, ClipPolygon } from './clipper-adapter';
import { AREA_EPSILON_M2, GEOMETRY_EPSILON_M } from '../../domain/profile';
import { DomainError, LIMITS } from '../../domain/types';
import type { Point } from '../../domain/types';
import { fail } from '../../domain/validate';
import { cross, distance, signedArea } from '../predicates';
import { pointLocation, locatedIn } from '../point-location';
import { multiArea, pointInPolygon, polygonArea, validatePolygon } from './contour';
import type { MultiPolygon, Polygon } from './contour';

export type BooleanOperation = 'union' | 'intersection' | 'difference';
type ClipFunction = (
  operation: BooleanOperation,
  subject: ClipMulti,
  rest: ClipMulti[],
) => ClipMulti;
const defaultClip: ClipFunction = integerClip;
const snap = (n: number): number => Math.round(n * 1e7) / 1e7;
const toClip = (polygons: MultiPolygon): ClipMulti =>
  polygons.map((p) =>
    p.map((r) => [
      ...r.map((v) => [snap(v.x), snap(v.z)] as [number, number]),
      [snap(r[0]!.x), snap(r[0]!.z)],
    ]),
  );
function clipArea(polygons: ClipMulti): number {
  let total = 0;
  for (const polygon of polygons)
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i]!,
        base = ring[0];
      if (!base) continue;
      let area = 0;
      for (let j = 1; j + 1 < ring.length; j++) {
        const a = ring[j]!,
          b = ring[j + 1]!;
        area += (a[0] - base[0]) * (b[1] - base[1]) - (a[1] - base[1]) * (b[0] - base[0]);
      }
      total += (i === 0 ? 1 : -1) * Math.abs(area / 2);
    }
  return total;
}
function bounded(polygons: MultiPolygon): MultiPolygon {
  let count = 0;
  for (const polygon of polygons)
    for (const ring of polygon) {
      count += ring.length;
      if (count > LIMITS.physicalSegments)
        fail(
          'RESOURCE_LIMIT',
          'kernel',
          'Physical segment limit exceeded',
          count,
          LIMITS.physicalSegments,
        );
    }
  return polygons.map((polygon, i) => validatePolygon(polygon, `polygon[${i}]`));
}
export class PreparedGeometry {
  readonly polygons: MultiPolygon;
  readonly clip: ClipMulti;
  constructor(input: MultiPolygon) {
    this.polygons = bounded(input);
    this.clip = toClip(this.polygons);
    for (const polygon of this.polygons) {
      for (const ring of polygon) {
        ring.forEach(Object.freeze);
        Object.freeze(ring);
      }
      Object.freeze(polygon);
    }
    Object.freeze(this.polygons);
    for (const polygon of this.clip) {
      for (const ring of polygon) {
        ring.forEach(Object.freeze);
        Object.freeze(ring);
      }
      Object.freeze(polygon);
    }
    Object.freeze(this.clip);
    Object.freeze(this);
  }
}
export class GeometryKernel {
  constructor(private readonly clip: ClipFunction = defaultClip) {}
  offset(subject: MultiPolygon, deltaM: number, arcToleranceM = 0.001): MultiPolygon {
    if (!Number.isFinite(deltaM) || !Number.isFinite(arcToleranceM) || arcToleranceM <= 0)
      fail('RANGE', 'offset', 'Invalid offset distance/tolerance');
    const normalized = bounded(subject);
    if (!normalized.length) return [];
    try {
      const raw = integerOffset(toClip(normalized), deltaM, arcToleranceM);
      return bounded(raw.map((p) => p.map((r) => r.map(([x, z]) => ({ x, z })))));
    } catch (error) {
      if (error instanceof DomainError && error.diagnostic.code === 'RESOURCE_LIMIT') throw error;
      fail(
        'GEOMETRY_LIBRARY_ERROR',
        'kernel',
        `Offset failed validation: ${error instanceof Error ? error.message : 'unknown failure'}`,
      );
    }
  }
  prepare(input: MultiPolygon): PreparedGeometry {
    return new PreparedGeometry(input);
  }
  boolean(
    operation: BooleanOperation,
    subject: MultiPolygon | PreparedGeometry,
    ...rest: (MultiPolygon | PreparedGeometry)[]
  ): MultiPolygon {
    const normalized = subject instanceof PreparedGeometry ? subject.polygons : bounded(subject),
      others = rest.map((p) => (p instanceof PreparedGeometry ? p.polygons : bounded(p)));
    if (operation !== 'union' && !normalized.length) return [];
    if (operation === 'intersection' && others.some((p) => !p.length)) return [];
    if (operation === 'union' && !normalized.length) {
      if (!others.length) return [];
      return this.boolean('union', others[0]!, ...others.slice(1));
    }
    if (!others.length) return normalized;
    try {
      const subjectClip = subject instanceof PreparedGeometry ? subject.clip : toClip(normalized);
      const otherClips = others.flatMap((p, i) =>
        p.length ? [rest[i] instanceof PreparedGeometry ? rest[i].clip : toClip(p)] : [],
      );
      const raw = this.clip(operation, subjectClip, otherClips);
      // Runtime validation is intentional: library failure/malformed output is not success.
      if (!Array.isArray(raw)) throw new Error('Non-array result');
      let segments = 0;
      const output: MultiPolygon = raw.map((polygon: ClipPolygon) =>
        polygon.map((ring) => {
          segments += ring.length;
          if (segments > LIMITS.physicalSegments)
            fail(
              'RESOURCE_LIMIT',
              'kernel',
              'Boolean output exceeds physical segment limit',
              segments,
              LIMITS.physicalSegments,
            );
          return ring.map((p) => ({ x: p[0], z: p[1] }));
        }),
      );
      // Remove only numerical residues within the public geometry tolerances.
      // Significant degeneracy still fails validation; library exceptions are never retried as success.
      const clean: MultiPolygon = [];
      for (const polygon of output) {
        const rings: Polygon = [];
        for (let i = 0; i < polygon.length; i++) {
          const ring: Point[] = [];
          for (const point of polygon[i]!) {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.z))
              throw new Error('Non-finite boolean output');
            if (!ring.length || distance(ring[ring.length - 1]!, point) > GEOMETRY_EPSILON_M)
              ring.push(point);
          }
          if (ring.length > 1 && distance(ring[0]!, ring[ring.length - 1]!) <= GEOMETRY_EPSILON_M)
            ring.pop();
          if (ring.length < 3 || Math.abs(signedArea(ring)) <= AREA_EPSILON_M2) {
            if (Math.abs(signedArea(polygon[i]!)) > AREA_EPSILON_M2)
              throw new Error('Significant ring collapsed during tolerance cleanup');
            if (i === 0) break;
            continue;
          }
          rings.push(ring);
        }
        if (rings.length) clean.push(rings);
      }
      const valid = bounded(clean);
      const resultArea = multiArea(valid),
        subjectArea = clipArea(subjectClip);
      if (!Number.isFinite(resultArea) || resultArea < 0) throw new Error('Invalid result area');
      if (
        operation === 'union' &&
        resultArea <
          Math.max(subjectArea, ...otherClips.map(clipArea)) - 1e-8 * Math.max(1, subjectArea)
      )
        throw new Error('Union lost an operand');
      if (operation === 'difference' && resultArea > subjectArea + 1e-8 * Math.max(1, subjectArea))
        throw new Error('Difference grew the subject');
      if (
        operation === 'intersection' &&
        resultArea >
          Math.min(subjectArea, ...otherClips.map(clipArea)) + 1e-8 * Math.max(1, subjectArea)
      )
        throw new Error('Intersection grew an operand');
      return valid;
    } catch (error) {
      if (error instanceof DomainError && error.diagnostic.code === 'RESOURCE_LIMIT') throw error;
      fail(
        'GEOMETRY_LIBRARY_ERROR',
        'kernel',
        `Boolean ${operation} failed validation: ${error instanceof Error ? error.message : 'unknown failure'}`,
      );
    }
  }
}
export const kernel = new GeometryKernel();
export interface Triangulation {
  vertices: Point[];
  triangles: [number, number, number][];
  area: number;
}
export function triangulate(polygon: Polygon): Triangulation {
  const p = validatePolygon(polygon);
  if (!p.length) return { vertices: [], triangles: [], area: 0 };
  const vertices = p.flat(),
    holes: number[] = [];
  let offset = p[0]!.length;
  for (let i = 1; i < p.length; i++) {
    holes.push(offset);
    offset += p[i]!.length;
  }
  try {
    const location = pointLocation(p);
    const indices = earcut(
      vertices.flatMap((p) => [p.x, p.z]),
      holes,
      2,
    );
    if (indices.length % 3 !== 0) throw new Error('Invalid triangulation');
    const triangles: [number, number, number][] = [];
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const ids: [number, number, number] = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
      if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= vertices.length))
        throw new Error('Invalid index');
      const [a, b, c] = ids.map((id) => vertices[id]!) as [Point, Point, Point];
      const triangleArea = Math.abs(cross(a, b, c)) / 2;
      if (triangleArea <= 1e-12) continue;
      if (!locatedIn(location, { x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 }))
        throw new Error('Triangle outside polygon');
      area += triangleArea;
      triangles.push(signedArea([a, b, c]) >= 0 ? ids : [ids[0], ids[2], ids[1]]);
    }
    if (Math.abs(area - polygonArea(p)) > 1e-8 * Math.max(1, polygonArea(p)))
      throw new Error('Area mismatch');
    return { vertices, triangles, area };
  } catch {
    fail('GEOMETRY_LIBRARY_ERROR', 'kernel', 'Triangulation failed validation');
  }
}
