import type { PhysicalSnapshot } from '../geometry/compile/types';
import { kernel, triangulate } from '../geometry/kernel/boolean';
import { contourPolygon } from '../geometry/kernel/contour';
import type { MultiPolygon, Polygon } from '../geometry/kernel/contour';
export interface MeshArtifact {
  positions: Float32Array;
  indices: Uint32Array;
}
export interface RenderWorld {
  physical: PhysicalSnapshot;
  floorMesh: MeshArtifact;
  roofMesh: MeshArtifact;
  groundMesh: MeshArtifact;
}
function surface(polygons: MultiPolygon, y: number): MeshArtifact {
  const positions: number[] = [],
    indices: number[] = [];
  for (const polygon of polygons) {
    const t = triangulate(polygon),
      offset = positions.length / 3;
    for (const p of t.vertices) positions.push(p.x, y, p.z);
    for (const triangle of t.triangles)
      indices.push(triangle[0] + offset, triangle[2] + offset, triangle[1] + offset);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
function roofSurface(polygons: MultiPolygon, bottom: number, thickness: number): MeshArtifact {
  const positions: number[] = [],
    indices: number[] = [];
  for (const polygon of polygons) {
    const t = triangulate(polygon),
      base = positions.length / 3;
    for (const y of [bottom + thickness, bottom])
      for (const p of t.vertices) positions.push(p.x, y, p.z);
    for (const [a, b, c] of t.triangles) {
      indices.push(
        base + a,
        base + c,
        base + b,
        base + t.vertices.length + a,
        base + t.vertices.length + b,
        base + t.vertices.length + c,
      );
    }
    for (const ring of polygon)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!,
          offset = positions.length / 3;
        positions.push(
          a.x,
          bottom,
          a.z,
          a.x,
          bottom + thickness,
          a.z,
          b.x,
          bottom + thickness,
          b.z,
          b.x,
          bottom,
          b.z,
        );
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
export function renderArtifacts(
  physical: Pick<PhysicalSnapshot, 'bounds' | 'document' | 'rooms' | 'floor'>,
): {
  floorMesh: MeshArtifact;
  roofMesh: MeshArtifact;
  groundMesh: MeshArtifact;
} {
  const b = physical.bounds,
    environment = physical.document.environment,
    margin = Math.max(120, Math.abs(environment.forest.offset) + environment.forest.distance + 30);
  const ground: Polygon = [
    [
      { x: b.minX - margin, z: b.minZ - margin },
      { x: b.maxX + margin, z: b.minZ - margin },
      { x: b.maxX + margin, z: b.maxZ + margin },
      { x: b.minX - margin, z: b.maxZ + margin },
    ],
  ];
  const holes: MultiPolygon = [
    ...physical.rooms.flatMap((room) => room.floor.slice(1).map((hole) => [hole])),
    ...physical.document.site.boundaryLoops
      .filter((l) => l.role === 'hole')
      .map((loop) => contourPolygon([{ ...loop, role: 'outer' }])),
  ];
  const terrain = holes.length
    ? kernel.boolean('difference', [ground], ...holes.map((h) => [h]))
    : [ground];
  return {
    floorMesh: surface(physical.floor, 0),
    roofMesh: roofSurface(
      physical.floor,
      physical.document.physicalProfile.wallHeightM,
      physical.document.physicalProfile.panelThicknessM,
    ),
    groundMesh: surface(terrain, -0.025),
  };
}
