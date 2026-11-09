import { expect, test } from 'bun:test';
import { emptyMaze, connect } from '../src/core/maze';
import { expectedExploration } from '../src/analysis/expected-exploration';
test('expected side exploration excludes the compulsory path and repeat counts', () => {
  const m = emptyMaze({ columns: 3, rows: 2, corridorWidth: 2, algorithm: 'prim', seed: 'forecast', extraConnections: 0 });
  for (const [a, b] of [[0, 1], [1, 2], [1, 4], [4, 3], [4, 5]])
    connect(m, a!, b!);
  m.entrance = { cell: 0, side: 'west' };
  m.exit = { cell: 2, side: 'east' };
  const r = expectedExploration(m, [1, 1, 1, .25, .5, 0]);
  expect(r.optionalArea).toBe(12);
  expect(r.visitedArea).toBe(3);
  expect(r.visitedRatio).toBe(.25);
  expect(r.uniqueLength).toBe(3);
  expect(r.uniqueRatio).toBe(.5);
  expect(() => expectedExploration(m, [NaN, 1, 1, .25, .5, 0])).toThrow();
  connect(m, 0, 3);
  expect(() => expectedExploration(m, [1, 1, 1, 1, 1, 1])).toThrow();
});
test('area weights and physical distances are different for modules and gaps', () => {
  const m = emptyMaze({ columns: 2, rows: 2, moduleSize: 3, corridorWidth: 1, algorithm: 'prim', seed: 'area', extraConnections: 0 });
  for (const [a, b] of [[0, 1], [1, 2], [2, 5], [5, 8], [0, 3], [3, 6], [6, 7], [7, 4]])
    connect(m, a!, b!);
  m.entrance = { cell: 0, side: 'west' };
  m.exit = { cell: 8, side: 'east' };
  const r = expectedExploration(m, [1, 1, 1, .5, 0, 1, 0, 0, 1]);
  expect(r.optionalArea).toBe(16);
  expect(r.visitedArea).toBe(1.5);
  expect(r.uniqueLength).toBe(2);
  expect(r.uniqueRatio).toBeCloseTo(2 / 11);
});
