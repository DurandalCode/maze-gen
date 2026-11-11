import { expect, test } from 'bun:test';
import { compileGeometry } from '../../src/geometry/compile/compile';
import { renderArtifacts } from '../../src/jobs/render-artifacts';
import type { MeshArtifact } from '../../src/jobs/render-artifacts';
import { obstacleRoom } from '../helpers/maps';

function triangles(mesh: MeshArtifact) {
  return Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
    [0, 1, 2].map((j) => {
      const offset = mesh.indices[i * 3 + j]! * 3;
      return {
        x: mesh.positions[offset]!,
        y: mesh.positions[offset + 1]!,
        z: mesh.positions[offset + 2]!,
      };
    }),
  );
}
const cross = (
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
test('floor, physical roof slab and outdoor terrain preserve the same room hole', () => {
  const compiled = compileGeometry(obstacleRoom(true));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const artifacts = renderArtifacts(compiled.snapshot),
    p = { x: 14, z: 14 };
  for (const mesh of [artifacts.floorMesh, artifacts.roofMesh, artifacts.groundMesh]) {
    for (const t of triangles(mesh)) {
      const [a, b, c] = t as [(typeof t)[number], (typeof t)[number], (typeof t)[number]];
      const area = cross(a, b, c);
      if (Math.abs(area) < 1e-8) continue;
      const sides = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
      expect(sides.every((s) => s >= -1e-9) || sides.every((s) => s <= 1e-9)).toBe(false);
    }
  }
  const roofTriangles = triangles(artifacts.roofMesh);
  const horizontalArea = (y: number) =>
    roofTriangles
      .filter((t) => t.every((p) => Math.abs(p.y - y) < 1e-6))
      .reduce((sum, t) => sum + Math.abs(cross(t[0]!, t[1]!, t[2]!)) / 2, 0);
  expect(horizontalArea(2.5)).toBeCloseTo(60, 5);
  expect(horizontalArea(2.506)).toBeCloseTo(60, 5);
  expect(
    Math.max(...Array.from(artifacts.roofMesh.positions).filter((_, i) => i % 3 === 1)) - 2.5,
  ).toBeCloseTo(0.006, 6);
});
