import { expect, test } from 'bun:test';
import { connect, emptyMaze } from '../src/core/maze';
import { generate } from '../src/generators/generate';
import { domainOf } from '../src/core/domain';
import { prepareNavigation } from '../src/analysis/navigation';
import { spatialPerception, perimeterPerception } from '../src/analysis/spatial-perception';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
function openGrid(columns = 4, rows = 4) {
  const maze = emptyMaze({ columns, rows, corridorWidth: 2, algorithm: 'prim', seed: 'vision-v5', extraConnections: 0 });
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++) {
      const a = z * columns + x;
      if (x + 1 < columns)
        connect(maze, a, a + 1);
      if (z + 1 < rows)
        connect(maze, a, a + columns);
    }
  return maze;
}
test('oblique perspective sees farther across open intersections without inventing diagonal edges', () => {
  const maze = openGrid(), context = prepareNavigation(maze), sight = spatialPerception(maze, context), before = JSON.stringify(maze.passages);
  const axis = sight.trace(0, 0), oblique = sight.view(0, 1);
  expect(oblique.length).toBeGreaterThan(axis.length + 1);
  expect(oblique.firstCell).toBe(1);
  expect(oblique.point.z).toBeGreaterThan(2);
  expect(JSON.stringify(maze.passages)).toBe(before);
});
test('walls, opaque uprights and corners stop diagonal visibility regardless of cloth translucency', () => {
  const maze = openGrid(), sight = spatialPerception(maze, prepareNavigation(maze));
  expect(sight.trace(0, Math.PI / 4).length).toBeCloseTo(Math.SQRT2); // corner post
  maze.passages[0] = [4];
  maze.passages[1] = maze.passages[1]!.filter(n => n !== 0);
  const blocked = spatialPerception(maze, prepareNavigation(maze)).trace(0, Math.PI / 6);
  expect(blocked.firstCell).toBeNull();
  expect(blocked.length).toBeCloseTo(1 / Math.cos(Math.PI / 6));
  maze.translucentFabric = false;
  expect(spatialPerception(maze, prepareNavigation(maze)).trace(0, Math.PI / 6)).toEqual(blocked);
});
test('rays stop at holes and ignore passages hidden behind the first opaque wall', () => {
  const maze = emptyMaze({ columns: 5, rows: 5, corridorWidth: 2, algorithm: 'prim', seed: 'hole', extraConnections: 0, shape: { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: 5, height: 5, operation: 'add' }, { x: 2, z: 2, width: 1, height: 1, operation: 'subtract' }] } });
  for (const c of domainOf(maze).cells)
    for (const n of prepareNavigation(maze).adjacent[c]!)
      if (n > c)
        connect(maze, c, n);
  const before = spatialPerception(maze, prepareNavigation(maze)).trace(11, 0);
  expect(before.endCell).toBe(11);
  expect(before.length).toBe(1);
  expect(before.blocked).toBe(true);
  maze.passages[13] = [];
  expect(spatialPerception(maze, prepareNavigation(maze)).trace(11, 0)).toEqual(before);
  expect(spatialPerception(maze, prepareNavigation(maze)).trace(0, 0, 2).length).toBe(2);
});
test('perimeter preference follows footprint edges but remains independent of hidden maze walls', () => {
  const maze = openGrid(7, 7), context = prepareNavigation(maze), edge = perimeterPerception(maze, context);
  expect(edge.attraction(1, 2)).toBeGreaterThan(edge.attraction(1, 8));
  const closed = { ...maze, passages: maze.passages.map(() => []) };
  expect(perimeterPerception(closed, prepareNavigation(closed)).distances).toEqual(edge.distances);
  const u = generate({ columns: 9, rows: 9, corridorWidth: 2, moduleSize: 2, algorithm: 'prim', seed: 'u', extraConnections: 0, shape: { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: 9, height: 9, operation: 'add' }, { x: 3, z: 3, width: 3, height: 6, operation: 'subtract' }] } });
  const uc = prepareNavigation(u), up = perimeterPerception(u, uc);
  expect(up.distances[17 * 10 + 4]).toBe(1); // inside edge of left leg
  expect(up.distances[17 * 10]).toBe(1); // outside edge
});
test('perimeter bias measurably attracts an unvisited edge branch and all modes remain reproducible', () => {
  const maze = emptyMaze({ columns: 7, rows: 3, corridorWidth: 2, algorithm: 'prim', seed: 'edge-choice', extraConnections: 0 });
  for (let x = 0; x < 6; x++) {
    connect(maze, x, x + 1);
    connect(maze, 7 + x, 8 + x);
    connect(maze, 14 + x, 15 + x);
  }
  connect(maze, 0, 7);
  connect(maze, 7, 14);
  maze.entrance = { cell: 7, side: 'west' };
  maze.exit = { cell: 13, side: 'east' };
  const opts = { ...DEFAULT_ANALYSIS, decisionMode:'frontier' as const, boundaryStrategy:'follow' as const, beta: 0, corridorPreference: 0, samples: 1024 };
  const none = analyzeColdspots(maze, { ...opts, boundaryPreference: 0 });
  const biased = analyzeColdspots(maze, { ...opts, boundaryPreference: 3 });
  expect(biased.probability[0]!).toBeGreaterThan(none.probability[0]! + .1);
  expect(analyzeColdspots(maze, { ...opts, boundaryPreference: 3 }).probability).toEqual(biased.probability);
  expect(biased.probability[13]).toBe(1);
  expect(() => analyzeColdspots(maze, { ...opts, boundaryPreference: NaN })).toThrow();
  expect(() => analyzeColdspots(maze, { ...opts, diagonalVision: 'yes' as unknown as boolean })).toThrow();
  const baseline = analyzeColdspots(maze, { ...opts, profile: 'explorer', boundaryPreference: 0 });
  expect(analyzeColdspots(maze, { ...opts, profile: 'explorer', boundaryPreference: 3 }).probability).toEqual(baseline.probability);
});
