import { expect, test } from 'bun:test';
import { locatedIn, pointLocation } from '../../src/geometry/point-location';
import { pointInPolygon } from '../../src/geometry/kernel/contour';
import type { Polygon } from '../../src/geometry/kernel/contour';

test('indexed containment agrees with the independent ray predicate across holes and boundaries', () => {
  const polygon: Polygon = [
    [
      { x: 0, z: 0 },
      { x: 8, z: 0 },
      { x: 8, z: 8 },
      { x: 0, z: 8 },
    ],
    [
      { x: 2, z: 2 },
      { x: 2, z: 4 },
      { x: 4, z: 4 },
      { x: 4, z: 2 },
    ],
    [
      { x: 5, z: 5 },
      { x: 5, z: 7 },
      { x: 7, z: 6 },
    ],
  ];
  const index = pointLocation(polygon);
  for (const includeBoundary of [false, true]) {
    for (let x = -0.5; x <= 8.5; x += 0.125) {
      for (let z = -0.5; z <= 8.5; z += 0.125) {
        expect(locatedIn(index, { x, z }, includeBoundary)).toBe(
          pointInPolygon({ x, z }, polygon, includeBoundary),
        );
      }
    }
  }
  for (const ring of polygon)
    for (const p of ring) {
      expect(locatedIn(index, p, true)).toBe(true);
      expect(locatedIn(index, p, false)).toBe(false);
    }
});
