import { expect, test } from 'bun:test';
import { connect, emptyMaze } from '../src/core/maze';
import { assessExploration } from '../src/analysis/walk-exploration';
function fixture() { const m = emptyMaze({ columns: 3, rows: 2, corridorWidth: 2, algorithm: 'prim', seed: 'exploration', extraConnections: 0 }); for (const [a, b] of [[0, 1], [1, 2], [1, 4], [4, 3], [4, 5]])
  connect(m, a!, b!); m.entrance = { cell: 0, side: 'west' }; m.exit = { cell: 2, side: 'east' }; return m; }
test('unique side exploration is separated from mandatory route and repeat travel', () => {
  const maze = fixture(), a = assessExploration(maze, [0, 1, 4, 3, 4, 1, 2], true)!, b = assessExploration(maze, [0, 1, 4, 3, 4, 1, 4, 3, 4, 1, 2], true)!;
  expect(a.optimalLength).toBe(6);
  expect(a.centerlineDistance).toBe(14);
  expect(a.uniqueExplorationLength).toBe(8);
  expect(a.repeatedLength).toBe(0);
  expect(a.exploredOptionalArea).toBe(8);
  expect(a.optionalArea).toBe(12);
  expect(a.exploredOptionalRatio).toBeCloseTo(2 / 3);
  expect(a.mandatoryAreaRatio).toBe(.5);
  expect(a.firstDetourChoices).toBe(1);
  expect(a.assessedFirstChoices).toBe(1);
  expect(a.enteredBranches).toBe(1);
  expect(a.meanBranchDepth).toBe(4);
  expect(a.deepBranches).toBe(0);
  expect(b.uniqueExplorationLength).toBe(a.uniqueExplorationLength);
  expect(b.repeatedLength).toBe(8);
  expect(b.enteredBranches).toBe(1);
  expect(b.firstDetourChoices).toBe(1);
});
test('first choice differs from eventually entering a side branch', () => {
  const a = assessExploration(fixture(), [0, 1, 2, 1, 4, 3, 4, 1, 2], true)!;
  expect(a.firstDetourChoices).toBe(0);
  expect(a.enteredBranches).toBe(1);
  expect(a.uniqueExplorationLength).toBe(8);
  expect(a.repeatedLength).toBe(4);
});
test('incomplete, cyclic and undersampled traces do not invent exploration metrics', () => {
  const m = fixture();
  expect(assessExploration(m, [0, 1, 2], false)).toBeNull();
  expect(assessExploration(m, [0, 4, 1, 2], true)).toBeNull();
  connect(m, 0, 3);
  expect(assessExploration(m, [0, 1, 2], true)).toBeNull();
});
test('unequal module and gap sizes preserve metric lengths and handle zero optional area', () => {
  const m = emptyMaze({ columns: 1, rows: 2, moduleSize: 3, corridorWidth: 1, algorithm: 'prim', seed: 'weighted', extraConnections: 0 });
  connect(m, 0, 1);
  connect(m, 1, 2);
  m.entrance = { cell: 0, side: 'north' };
  m.exit = { cell: 2, side: 'south' };
  const a = assessExploration(m, [0, 1, 0, 1, 2], true)!;
  expect(a.optimalLength).toBe(7);
  expect(a.centerlineDistance).toBe(11);
  expect(a.repeatedLength).toBe(4);
  expect(a.uniqueExplorationLength).toBe(0);
  expect(a.optionalArea).toBe(0);
  expect(a.exploredOptionalRatio).toBe(0);
});
