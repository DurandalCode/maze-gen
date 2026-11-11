import { expect, test } from 'bun:test';
import { circleRoom, obstacleRoom, squareNetwork, twoRooms } from '../helpers/maps';
import { compileGeometry } from '../../src/geometry/compile/compile';
import { triangleAdjacency } from '../../src/navigation/adjacency';
import { buildNavigation, route } from '../../src/navigation/navmesh';
import type { NavigationSnapshot } from '../../src/navigation/navmesh';
import { move, sweptClear, validCenter } from '../../src/navigation/collision';
import { MovementController } from '../../src/session/movement/controller';
import { distance } from '../../src/geometry/predicates';
function nav(document = twoRooms()): NavigationSnapshot {
  const c = compileGeometry(document);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  const n = buildNavigation(c.snapshot);
  if (!n.ok) throw new Error(JSON.stringify(n.diagnostics));
  return n.snapshot;
}
test('entrance-to-exit route is verified against physical obstacles at rotated joins', () => {
  for (const rotation of [0, Math.PI / 7, Math.PI, -Math.PI]) {
    const n = nav(twoRooms(2, rotation));
    expect(n.area).toHaveLength(1);
    expect(n.referenceLengthM).toBeGreaterThan(3);
    expect(
      n.referenceRoute
        .slice(1)
        .every((p, i) => sweptClear(n.collision, n.referenceRoute[i]!, p, 0.25)),
    ).toBe(true);
  }
});
test('circle wrap opening has a valid continuous route and no center is outside the floor', () => {
  const n = nav(circleRoom());
  expect(n.referenceRoute.length).toBeGreaterThanOrEqual(2);
  expect(n.triangles.every((t) => validCenter(n.collision, t.center, 0.25))).toBe(true);
});
test('direct join navigates without a fabricated corridor polygon', () => {
  const n = nav(twoRooms(0));
  expect(route(n, n.entrance, n.exit).length).toBeGreaterThan(1);
});
test('swept disc cannot tunnel through closed walls on arbitrarily long displacement', () => {
  const n = nav(),
    start = { x: 10, z: 10 };
  expect(validCenter(n.collision, start, 0.25)).toBe(true);
  for (const displacement of [
    { x: 100, z: 0 },
    { x: -100, z: 0 },
    { x: 0, z: -100 },
    { x: 0, z: 100 },
    { x: 100, z: 100 },
  ]) {
    const end = move(n.collision, start, displacement, 0.25);
    expect(validCenter(n.collision, end, 0.25)).toBe(true);
    expect(end.x).toBeLessThan(11);
    expect(end.z).toBeGreaterThan(9);
    expect(distance(start, end)).toBeLessThan(7);
  }
  expect(sweptClear(n.collision, { x: 10, z: 10 }, { x: 12, z: 10 }, 0.25)).toBe(false);
});
test('movement slides along the wall without penetration', () => {
  const n = nav(),
    start = { x: 10, z: 10 },
    end = move(n.collision, start, { x: 1, z: 0.3 }, 0.25);
  expect(end.x).toBeLessThan(10.75);
  expect(end.z).toBeGreaterThan(10.2);
  expect(validCenter(n.collision, end, 0.25)).toBe(true);
});
test('fixed-step keyboard/touch inputs have the same distance; pause and long dt do not teleport', () => {
  const n = nav(),
    input = { forward: 1, strafe: 0, yaw: Math.PI, running: false };
  const a = new MovementController(n.collision, { x: 10, z: 10 }),
    b = new MovementController(n.collision, { x: 10, z: 10 });
  a.setPaused(false);
  b.setPaused(false);
  for (let i = 0; i < 60; i++) a.frame(1 / 60, input);
  for (let i = 0; i < 120; i++) b.frame(1 / 120, input);
  expect(a.distanceM).toBeCloseTo(1.4, 5);
  expect(a.position.z).toBeCloseTo(b.position.z, 8);
  const before = { ...a.position };
  a.setPaused(true);
  expect(a.frame(60, input)).toBe(0);
  expect(a.position).toEqual(before);
  a.setPaused(false);
  expect(a.frame(60, input)).toBe(5);
  expect(distance(a.position, before)).toBeLessThanOrEqual((1.4 * 5) / 60 + 1e-8);
});
test('unreachable isolated room is rejected physically, independent of nominal topology', () => {
  const d = twoRooms();
  d.connections = [];
  d.openings = d.openings.filter((o) => o.role !== 'ordinary');
  const c = compileGeometry(d);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  const n = buildNavigation(c.snapshot);
  expect(n.ok).toBe(false);
  if (!n.ok) expect(n.diagnostics[0]!.code).toBe('UNREACHABLE');
});

test('semantic graph cycle rank follows physical holes and wall islands, not triangle count', () => {
  for (const hole of [false, true]) {
    const n = nav(obstacleRoom(hole));
    expect(n.semantic.cycles).toBe(1);
    expect(n.semantic.components).toBe(1);
    expect(n.semantic.edges.filter((e) => e.kind === 'intrinsic-cycle')).toHaveLength(1);
    for (const edge of n.semantic.edges)
      expect(
        edge.path.slice(1).every((p, i) => sweptClear(n.collision, edge.path[i]!, p, 0.25)),
      ).toBe(true);
  }
  const tree = nav();
  expect(tree.semantic.cycles).toBe(0);
  expect(tree.semantic.nodes).toHaveLength(2);
  expect(tree.triangles.length).toBeGreaterThan(tree.semantic.nodes.length);
});

test('explicit ring and two-cycle graph have independent known cycle counts', () => {
  const ring = nav(squareNetwork(2, 2, 1));
  expect(ring.semantic.cycles).toBe(1);
  expect(ring.semantic.nodes).toHaveLength(4);
  expect(ring.semantic.edges).toHaveLength(4);
  const two = nav(squareNetwork(3, 2, 2));
  expect(two.semantic.cycles).toBe(2);
  expect(two.semantic.nodes).toHaveLength(6);
  expect(two.semantic.edges).toHaveLength(7);
});

test('navmesh links partial shared edges without linking a point-only contact', () => {
  const triangles: [
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
  ][] = [
    [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 0, z: 2 },
    ],
    [
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 1, z: 1 },
    ],
    [
      { x: 0, z: 2 },
      { x: -1, z: 2 },
      { x: 0, z: 3 },
    ],
  ];
  const neighbors = triangleAdjacency(triangles);
  expect(neighbors[0]!.map((n) => n.triangle)).toEqual([1]);
  expect(neighbors[2]).toEqual([]);
});

test('tiled offset and semantic joins preserve a known three-cycle graph across tile seams', () => {
  const n = nav(squareNetwork(4, 3, 3));
  expect(n.semantic.cycles).toBe(3);
  expect(n.semantic.nodes).toHaveLength(12);
  expect(n.area).toHaveLength(1);
  expect(
    n.referenceRoute
      .slice(1)
      .every((p, i) => sweptClear(n.collision, n.referenceRoute[i]!, p, 0.25)),
  ).toBe(true);
});
