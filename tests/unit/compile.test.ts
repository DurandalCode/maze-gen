import { expect, test } from 'bun:test';
import { compileGeometry } from '../../src/geometry/compile/compile';
import type { PhysicalSnapshot } from '../../src/geometry/compile/types';
import { circleRoom, twoRooms } from '../helpers/maps';
import { polygonArea } from '../../src/geometry/kernel/contour';
import { distance } from '../../src/geometry/predicates';
function snapshot(value: unknown): PhysicalSnapshot {
  const result = compileGeometry(value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.snapshot;
}
function code(value: unknown): string {
  const result = compileGeometry(value);
  if (result.ok) throw new Error('Expected rejection');
  return result.diagnostics[0]!.code;
}

test('GEO-02: explicit connection compiles at arbitrary rotation', () => {
  for (const rotation of [0, Math.PI / 7, Math.PI, -Math.PI]) {
    const s = snapshot(twoRooms(2, rotation));
    expect(s.rooms).toHaveLength(2);
    expect(s.connections).toHaveLength(1);
    expect(s.connections[0]!.direct).toBe(false);
    expect(s.connections[0]!.lengthM).toBeCloseTo(2, 5);
    expect(s.openPassages.every((p) => p.clearWidthM >= 1)).toBe(true);
    expect(s.accessibleRegions).toHaveLength(1);
    expect(s.quantities.floorM2).toBeCloseTo(10.8, 5);
  }
});
test('GEO-02: actual clearance is measured between physical supports', () => {
  expect(code(twoRooms(2, 0, 1.11))).toBe('WIDTH');
  const s = snapshot(twoRooms(2, 0, 1.13));
  expect(s.openPassages.find((o) => o.id === 'a-b')!.clearWidthM).toBeCloseTo(1.01, 5);
});
test('direct join has explicit semantic connection and no degenerate polygon', () => {
  const s = snapshot(twoRooms(0));
  expect(s.connections[0]!.direct).toBe(true);
  expect(s.connections[0]!.floor).toEqual([]);
  expect(s.accessibleRegions).toHaveLength(1);
  expect(s.quantities.floorM2).toBeCloseTo(8, 8);
});
test('GEO-06: circular wrap cut has no seam or panel across the opening', () => {
  const s = snapshot(circleRoom()),
    opening = s.openPassages.find((p) => p.role === 'entrance')!;
  expect(opening.clearWidthM).toBeGreaterThan(1);
  expect(s.floor).toHaveLength(1);
  expect(s.accessibleRegions).toHaveLength(1);
  const midpoint = opening.center;
  for (const solid of s.solids.filter((s) => s.kind === 'panel'))
    expect(
      distance(midpoint, solid.from) +
        distance(midpoint, solid.to) -
        distance(solid.from, solid.to),
    ).toBeGreaterThan(0.01);
});
test('quantities derive from the same surfaces and physical board elements', () => {
  const s = snapshot(twoRooms());
  expect(s.quantities.floorM2).toBeCloseTo(
    s.floor.reduce((n, p) => n + polygonArea(p), 0),
    9,
  );
  expect(s.quantities.roofM2).toBe(s.quantities.floorM2);
  expect(s.quantities.panels).toBe(s.solids.filter((x) => x.kind === 'panel').length);
  expect(s.quantities.timberM3).toBeGreaterThan(0);
  expect(s.quantities.braces).toBeGreaterThan(0);
  expect(s.solids.every((x) => x.topM > x.bottomM)).toBe(true);
});
test('invalid connection, overlap, opening, and terminal diagnostics are explicit', () => {
  expect(code(twoRooms(3.01))).toBe('SPAN');
  expect(code(twoRooms(-0.2))).toBe('OVERLAP');
  const d = twoRooms();
  d.connections = [];
  expect(code(d)).toBe('OPEN_END');
  const c = circleRoom();
  c.openings[1]!.uCenter = c.openings[0]!.uCenter;
  expect(code(c)).toBe('OPENING_OVERLAP');
  const missing = twoRooms();
  missing.openings = missing.openings.filter((o) => o.role !== 'exit');
  expect(code(missing)).toBe('TERMINALS');
});
test('visual changes preserve physical world hash and all colliders', () => {
  const d = twoRooms(),
    before = snapshot(d);
  d.environment.wallColor = '#ffffff';
  d.environment.translucentFabric = false;
  d.environment.roof = false;
  const after = snapshot(d);
  expect(after.worldHash).toBe(before.worldHash);
  expect(after.solids).toEqual(before.solids);
  expect(after.roof).toEqual([]);
});

test('physical diagnostics identify source objects and a world location', () => {
  const result = compileGeometry(twoRooms(3.01));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics[0]!.objectIds).toContain('a-to-b');
    expect(result.diagnostics[0]!.location).toMatchObject({ x: 10 });
  }
});
