import { expandDefinition, instanceBoundary } from '../catalog/catalog';
import type { Definition, Document, Instance, Opening, Point } from '../domain';
import { openingCut } from '../geometry/compile/openings';
import type { PhysicalOpening } from '../geometry/compile/types';
import { segmentLength } from '../geometry/kernel/contour';

export interface Slot {
  key: string;
  opening: Opening;
  physical: PhysicalOpening;
}
/** Boundary regions, never definition IDs, determine candidate passages. */
export function openingSlots(
  definition: Definition,
  instance: Instance,
  profile: Document['physicalProfile'],
): Slot[] {
  const loops = instanceBoundary({ definitions: [definition] } as Document, instance);
  const width = Math.max(1.4, profile.minClearanceM + profile.postWidthM + 0.2);
  const result: Slot[] = [];
  for (const region of definition.openingRegions) {
    if (width < region.minWidthM || width > region.maxWidthM) continue;
    const loop = loops.find(
      (l) => l.role === 'outer' && l.segments.some((s) => s.id === region.segmentId),
    );
    if (!loop) continue;
    const segment = loop.segments.find((s) => s.id === region.segmentId)!;
    const length = segmentLength(segment),
      periodic = segment.kind === 'arc' && Math.abs(Math.abs(segment.sweep) - 2 * Math.PI) < 1e-8,
      count = Math.max(1, Math.min(32, Math.floor((length + 1e-6) / (width + 0.6))));
    for (let i = 0; i < count; i++) {
      const uCenter = periodic ? i / count : (i + 0.5) / count;
      const opening: Opening = {
        id: `${instance.id}/slot-${region.id}-${i}`,
        instanceId: instance.id,
        regionId: region.id,
        boundarySegmentId: segment.id,
        uCenter,
        widthM: width,
        role: 'ordinary',
      };
      try {
        const cut = openingCut(opening, region, loop, profile.postWidthM);
        if (cut.physical.clearWidthM >= profile.minClearanceM)
          result.push({ key: opening.id, opening, physical: cut.physical });
      } catch {
        /* A restricted region can exclude the sampled position. It stays closed. */
      }
    }
  }
  return result;
}
export function localSlots(definition: Definition, profile: Document['physicalProfile']): Slot[] {
  // Expansion also validates every declared parameter before the first placement.
  expandDefinition(definition);
  return openingSlots(
    definition,
    {
      id: 'local',
      definitionHash: definition.contentHash,
      parameterValues: Object.fromEntries(definition.parameters.map((p) => [p.id, p.default])),
      position: { x: 0, z: 0 },
      rotationRad: 0,
    },
    profile,
  );
}
export function transformed(point: Point, position: Point, angle: number): Point {
  return {
    x: position.x + point.x * Math.cos(angle) - point.z * Math.sin(angle),
    z: position.z + point.x * Math.sin(angle) + point.z * Math.cos(angle),
  };
}
