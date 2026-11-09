import { expect, test } from 'bun:test';
import { emptyMaze, connect } from '../src/core/maze';
import { prepareNavigation, prepareOutline } from '../src/analysis/navigation';
import { decisionModel, decisionScore, choiceProbabilities } from '../src/analysis/decision-model';
import { decisionDifficulty } from '../src/analysis/decision-difficulty';
import { spatialPerception } from '../src/analysis/spatial-perception';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
function fixture() { const maze = emptyMaze({ columns: 7, rows: 4, corridorWidth: 2, algorithm: 'prim', seed: 'choices', extraConnections: 0 }); for (let i = 0; i < 6; i++)
  connect(maze, i, i + 1); connect(maze, 7, 0); const branch = [7, 8, 9, 10, 11, 12, 13, 20, 19, 18, 17, 16, 15, 14, 21, 22, 23, 24, 25, 26, 27]; for (let i = 1; i < branch.length; i++)
  connect(maze, branch[i - 1]!, branch[i]!); maze.entrance = { cell: 7, side: 'west' }; maze.exit = { cell: 6, side: 'north' }; return maze; }
test('a sustained visible decoy grades above an obvious short dead end on the same mandatory route', () => {
  const tempting = fixture(), obvious = structuredClone(tempting);
  obvious.passages[8] = obvious.passages[8]!.filter(n => n !== 9);
  obvious.passages[9] = obvious.passages[9]!.filter(n => n !== 8);
  connect(obvious, 6, 13);
  const a = decisionDifficulty(tempting), b = decisionDifficulty(obvious);
  expect(a.mandatoryArea).toBe(b.mandatoryArea);
  expect(a.credibleDecoys).toBeGreaterThan(0);
  expect(a.decoyScore).toBeGreaterThan(b.decoyScore);
  expect(b.credibleDecoys).toBe(0);
  connect(obvious, 8, 9);
  expect(() => decisionDifficulty(obvious)).toThrow();
});
test('a visibly recognizable finish dominates an alluring alternative, and occluding walls hide it', () => {
  const maze = fixture(), ctx = prepareNavigation(maze);
  prepareOutline(maze, ctx);
  const model = decisionModel(maze, ctx);
  const east = model.features(0, 1, undefined, 'outline'), wrong = model.features(7, 8, undefined, 'outline');
  expect(east.exitVisible).toBe(1);
  expect(wrong.exitVisible).toBe(0);
  expect(decisionScore(east, 3, 1, 1.5, -1)).toBeGreaterThan(decisionScore(wrong, 3, 1, 1.5, 1));
  const closed = structuredClone(maze);
  closed.passages[3] = closed.passages[3]!.filter(n => n !== 4);
  closed.passages[4] = closed.passages[4]!.filter(n => n !== 3);
  const cc = prepareNavigation(closed);
  prepareOutline(closed, cc);
  expect(decisionModel(closed, cc).features(0, 1, undefined, 'outline').exitVisible).toBe(0);
});
test('decision features cannot read hidden geometry behind an occluding bend', () => {
  const maze = emptyMaze({ columns: 7, rows: 3, corridorWidth: 2, algorithm: 'prim', seed: 'hidden', extraConnections: 0 });
  connect(maze, 0, 1);
  connect(maze, 1, 2);
  connect(maze, 2, 9);
  connect(maze, 9, 16);
  const ctx = prepareNavigation(maze);
  prepareOutline(maze, ctx);
  const before = decisionModel(maze, ctx).features(0, 1, undefined, 'outline');
  connect(maze, 16, 17);
  connect(maze, 17, 18);
  const afterCtx = prepareNavigation(maze);
  prepareOutline(maze, afterCtx);
  expect(decisionModel(maze, afterCtx).features(0, 1, undefined, 'outline')).toEqual(before);
});
test('perspective depth uses support from several angular rays and remains bounded by the longest ray', () => {
  const maze = fixture(), view = spatialPerception(maze, prepareNavigation(maze)).view(7, 8);
  expect(view.depth).toBeGreaterThan(4);
  expect(view.depth).toBeLessThanOrEqual(view.length);
  expect(view.aperture).toBeGreaterThan(0);
  expect(view.aperture).toBeLessThanOrEqual(1);
});
test('local-choice simulation is reproducible, accounts for all travel and does not modify topology', () => {
  const maze = fixture(), snapshot = structuredClone(maze), options = { ...DEFAULT_ANALYSIS, samples: 128 };
  const a = analyzeColdspots(maze, options);
  expect(analyzeColdspots(maze, options)).toEqual(a);
  expect(maze).toEqual(snapshot);
  expect(a.probability[maze.exit.cell]).toBe(1);
  expect(a.expectedLength).toBeCloseTo(a.visits.reduce((sum, n) => sum + n, 0) * 2, 7);
  expect(() => analyzeColdspots(maze, { ...options, decisionMode: 'oracle' as never })).toThrow();
});
test('choice probabilities stay finite for extreme scores and prefer the highest score', () => {
  const probabilities = choiceProbabilities([10000, 9999, -10000]);
  expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(probabilities[0]!).toBeGreaterThan(probabilities[1]!);
  expect(probabilities.every(Number.isFinite)).toBe(true);
});
