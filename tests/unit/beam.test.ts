import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { beamEnvelope } from '../../src/geometry/compile/beam';
import { pointInPolygon, polygonArea } from '../../src/geometry/kernel/contour';

test('vertical and horizontal beam envelopes match analytical box projections', () => {
  const post = beamEnvelope({ x: 0, y: 0, z: 0 }, { x: 0, y: 2.5, z: 0 }, 0.12, 0.04, {
    x: 0,
    y: 0,
    z: 1,
  });
  expect(polygonArea(post.footprint)).toBeCloseTo(0.0048, 10);
  expect(post.bottomM).toBe(0);
  expect(post.topM).toBe(2.5);
  const rail = beamEnvelope({ x: 0, y: 2, z: 0 }, { x: 3, y: 2, z: 0 }, 0.14, 0.04, {
    x: 0,
    y: 0,
    z: 1,
  });
  expect(polygonArea(rail.footprint)).toBeCloseTo(0.12, 10);
  expect(rail.bottomM).toBeCloseTo(1.93, 10);
  expect(rail.topM).toBeCloseTo(2.07, 10);
});
test('inclined brace footprint contains the actual Three.js transformed box vertices', () => {
  const a = { x: 2, y: 2, z: 3 },
    b = { x: 2.4, y: 2.4, z: 3.2 },
    envelope = beamEnvelope(a, b, 0.096, 0.04, { x: -0.4, y: 0, z: 0.9 }),
    axis = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z),
    length = axis.length();
  axis.normalize();
  const normal = new THREE.Vector3(envelope.normal.x, envelope.normal.y, envelope.normal.z),
    widthAxis = axis.clone().cross(normal).normalize(),
    matrix = new THREE.Matrix4().makeBasis(widthAxis, axis, normal);
  matrix.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const geometry = new THREE.BoxGeometry(0.096, length, 0.04).applyMatrix4(matrix),
    positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const p = { x: positions.getX(i), z: positions.getZ(i) };
    expect(
      pointInPolygon(p, envelope.footprint, true) ||
        envelope.footprint[0]!.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-6),
    ).toBe(true);
    expect(positions.getY(i)).toBeGreaterThanOrEqual(envelope.bottomM - 1e-6);
    expect(positions.getY(i)).toBeLessThanOrEqual(envelope.topM + 1e-6);
  }
  geometry.dispose();
});
