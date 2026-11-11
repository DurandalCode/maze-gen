import { expect, test } from 'bun:test';
import { controlCatalog, expandDefinition } from '../../src/catalog/catalog';
import { DomainError, MAX_ARC_SAGITTA_M } from '../../src/domain';
import type { BoundaryLoop, Point, Segment } from '../../src/domain';
import { GeometryKernel, kernel, triangulate } from '../../src/geometry/kernel/boolean';
import {
  contourPolygon,
  multiArea,
  pointInMulti,
  polygonArea,
  sampleSegment,
  segmentPoint,
  validatePolygon,
} from '../../src/geometry/kernel/contour';
import { ringEdges, pointSegmentDistance } from '../../src/geometry/predicates';
import type { Polygon } from '../../src/geometry/kernel/contour';
const box = (x: number, z: number, w: number, d: number): Polygon => [
  [
    { x, z },
    { x: x + w, z },
    { x: x + w, z: z + d },
    { x, z: z + d },
  ],
];
function code(run: () => unknown) {
  try {
    run();
    throw new Error('Expected rejection');
  } catch (e) {
    if (e instanceof DomainError) return e.diagnostic.code;
    throw e;
  }
}

test('GEO-01: independent analytical area oracles for square, rectangle, triangle, circle', () => {
  const expected = [4, 12, 4 * Math.sqrt(3), 4 * Math.PI];
  controlCatalog().forEach((definition, i) => {
    const p = contourPolygon(expandDefinition(definition)),
      area = polygonArea(p),
      oracle = expected[i]!;
    expect(Math.abs(area - oracle)).toBeLessThan(
      i === 3 ? 2 * Math.PI * 2 * MAX_ARC_SAGITTA_M : 1e-5,
    );
    if (i === 3) expect(area).toBeLessThan(oracle);
    expect(triangulate(p).area).toBeCloseTo(area, 8);
  });
});
test('GEO-03: hole area, subtraction, triangulation, and sampled exclusion', () => {
  const p = kernel.boolean('difference', [box(0, 0, 10, 10)], [box(3, 3, 4, 4)]);
  expect(multiArea(p)).toBe(84);
  expect(p).toHaveLength(1);
  expect(p[0]).toHaveLength(2);
  expect(pointInMulti({ x: 5, z: 5 }, p)).toBe(false);
  const t = triangulate(p[0]!);
  expect(t.area).toBe(84);
  for (const triangle of t.triangles) {
    const vertices = triangle.map((i) => t.vertices[i]!);
    const center = {
      x: vertices.reduce((n, p) => n + p.x, 0) / 3,
      z: vertices.reduce((n, p) => n + p.z, 0) / 3,
    };
    expect(center.x > 3 && center.x < 7 && center.z > 3 && center.z < 7).toBe(false);
  }
});
test('analytical boolean area and orientation invariance', () => {
  const a = [box(0, 0, 2, 2)],
    b = [box(1, 0, 2, 2)];
  expect(multiArea(kernel.boolean('union', a, b))).toBe(6);
  expect(multiArea(kernel.boolean('intersection', a, b))).toBe(2);
  expect(multiArea(kernel.boolean('difference', a, b))).toBe(2);
  expect(multiArea(kernel.boolean('union', [[[...a[0]![0]!].reverse()]], b))).toBe(6);
});
test('corner contact has zero intersection area and does not create an area connection', () => {
  const a = [box(0, 0, 2, 2)],
    b = [box(2, 2, 2, 2)];
  expect(multiArea(kernel.boolean('intersection', a, b))).toBe(0);
  expect(kernel.boolean('union', a, b)).toHaveLength(2);
});
test('GEO-04: concave L shape triangulates even though vertex centroid is outside', () => {
  const p: Polygon = [
    [
      { x: 0, z: 0 },
      { x: 8, z: 0 },
      { x: 8, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 8 },
      { x: 0, z: 8 },
    ],
  ];
  expect(polygonArea(p)).toBe(15);
  expect(pointInMulti({ x: 3, z: 3 }, [p])).toBe(false);
  expect(triangulate(p).area).toBe(15);
});
test('GEO-06: full arc at ±pi closes and exact opening endpoints join the tessellation', () => {
  for (const startAngle of [Math.PI, -Math.PI]) {
    const arc: Segment = {
      id: 'arc',
      kind: 'arc',
      center: { x: 0, z: 0 },
      radius: 2,
      startAngle,
      sweep: Math.PI * 2,
    };
    const cuts = [0.03, 0.97],
      points = sampleSegment(arc, cuts);
    for (const u of cuts) expect(points).toContainEqual(segmentPoint(arc, u));
    const loop: BoundaryLoop = { id: 'circle', role: 'outer', segments: [arc] };
    expect(
      contourPolygon([loop], new Map([['arc', cuts]]))[0]!.every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.z),
      ),
    ).toBe(true);
  }
});
test('arc sagitta is bounded independently for every sampled chord', () => {
  for (const radius of [0.001, 2, 1000]) {
    const points = sampleSegment({
      id: 'arc',
      kind: 'arc',
      center: { x: 0, z: 0 },
      radius,
      startAngle: 0,
      sweep: Math.PI * 2,
    });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(radius - Math.hypot(mid.x, mid.z)).toBeLessThanOrEqual(MAX_ARC_SAGITTA_M + 1e-10);
    }
  }
});
test('degeneracy, self-crossing, disconnected boundaries, and touching holes reject explicitly', () => {
  expect(
    code(() =>
      validatePolygon([
        [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
          { x: 0, z: 2 },
          { x: 2, z: 0 },
        ],
      ]),
    ),
  ).toBe('SELF_INTERSECTION');
  expect(
    code(() =>
      validatePolygon([
        [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
          { x: 2, z: 0 },
        ],
      ]),
    ),
  ).toBe('SELF_INTERSECTION');
  expect(code(() => validatePolygon([box(0, 0, 4, 4)[0]!, box(0, 1, 1, 1)[0]!]))).toBe(
    'INVALID_HOLE',
  );
  const loops = expandDefinition(controlCatalog()[0]!);
  const first = loops[0]!.segments[0]!;
  if (first.kind === 'line') first.to.x -= 0.1;
  expect(code(() => contourPolygon(loops))).toBe('DISCONNECTED_BOUNDARY');
  expect(
    code(() =>
      sampleSegment({
        id: 'tiny',
        kind: 'arc',
        center: { x: 0, z: 0 },
        radius: 1,
        startAngle: 0,
        sweep: 1e-10,
      }),
    ),
  ).toBe('DEGENERATE');
});
test('kernel exception or corrupted output is never a successful empty layout', () => {
  const broken = new GeometryKernel(() => {
    throw new Error('Failure');
  });
  expect(code(() => broken.boolean('union', [box(0, 0, 2, 2)], [box(1, 1, 2, 2)]))).toBe(
    'GEOMETRY_LIBRARY_ERROR',
  );
  const invalid = new GeometryKernel(() => [
    [
      [
        [NaN, 0],
        [1, 0],
        [1, 1],
        [NaN, 0],
      ],
    ],
  ]);
  expect(code(() => invalid.boolean('union', [box(0, 0, 2, 2)], [box(1, 1, 2, 2)]))).toBe(
    'GEOMETRY_LIBRARY_ERROR',
  );
});

test('quantized boolean identity preserves rotated geometry without false library errors', () => {
  for (let i = 0; i < 100; i++) {
    const theta = 0.001 + i * 0.1,
      c = Math.cos(theta),
      s = Math.sin(theta),
      ring = [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ].map(([x, z]) => ({ x: x! * c - z! * s + 0.1234567, z: x! * s + z! * c + 5.3333333 }));
    expect(Math.abs(multiArea(kernel.boolean('union', [[ring]], [[ring]])) - 4)).toBeLessThan(1e-5);
  }
});

test('generated offset with submicrometre consecutive edges remains conservative without losing a large component', async () => {
  const fixture = (await import('../fixtures/offset-short-edges.json')).default;
  const source = fixture.subject;
  const result = kernel.offset(source, fixture.delta, fixture.tolerance);
  expect(result.length).toBeGreaterThan(0);
  // Erosion cannot add area; known >40m² component must survive numerical cleanup.
  expect(multiArea(result)).toBeGreaterThan(40);
  expect(multiArea(result)).toBeLessThan(multiArea(source));
  for (const polygon of result)
    for (const ring of polygon)
      for (const point of ring) {
        expect(pointInMulti(point, source)).toBe(true);
        const d = Math.min(
          ...source
            .flatMap((p) => p.flatMap(ringEdges))
            .map(([a, b]) => pointSegmentDistance(point, a, b)),
        );
        expect(d).toBeGreaterThanOrEqual(Math.abs(fixture.delta) - fixture.tolerance - 2e-6);
      }
});
test('rotated containment intersection respects the integer-grid area bound', async () => {
  const { subject, rest } = (await import('../fixtures/boolean-grid-rounding.json')).default;
  const result = kernel.boolean('intersection', subject, ...rest);
  expect(multiArea(result)).toBeCloseTo(4, 6);
  // Every returned point remains within public geometric tolerance of both inputs.
  for (const p of result)
    for (const ring of p)
      for (const point of ring)
        for (const operand of [subject, ...rest])
          expect(
            pointInMulti(point, operand) ||
              Math.min(
                ...operand
                  .flatMap((p) => p.flatMap(ringEdges))
                  .map(([a, b]) => pointSegmentDistance(point, a, b)),
              ) <= 1e-6,
          ).toBe(true);
});
