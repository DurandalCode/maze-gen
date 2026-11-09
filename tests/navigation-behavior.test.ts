import { expect, test } from 'bun:test';
import { boundaryBelief } from '../src/analysis/navigation-behavior';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
import { deserialize } from '../src/persistence/maze-json';
import { generate } from '../src/generators/generate';
const fixture = () => generate({ columns: 7, rows: 7, corridorWidth: 2, seed: 'cognitive-v6', algorithm: 'prim', extraConnections: 0 });
test('boundary beliefs persist, react to observed retreats, respect cooldown and stop oscillating', () => {
  const belief = boundaryBelief('adaptive', .1, 2);
  expect(belief.sign).toBe(-1);
  expect(belief.observe(50, 0, false)).toBe(false);
  for (const remaining of [48, 46, 44, 42])
    expect(belief.observe(remaining, 10, true)).toBe(false); // progress supports current policy
  expect(belief.observe(44, 20, false)).toBe(false); // no retrospective knowledge of a failure before retreat
  expect(belief.observe(44, 2, true)).toBe(true);
  expect(belief.sign).toBe(1);
  expect(belief.observe(44, 12, true)).toBe(false); // persistent new hypothesis
  expect(belief.observe(44, 12, true)).toBe(true);
  expect(belief.sign).toBe(-1);
  expect(belief.observe(44, 100, true)).toBe(false);
  expect(belief.changes).toBe(2);
});
test('fixed boundary strategies never flip, and adaptive runs start from distinct hypotheses', () => {
  for (const strategy of ['follow', 'avoid'] as const) {
    const a = boundaryBelief(strategy, .1, 2);
    a.observe(50, 0, false);
    a.observe(60, 100, true);
    expect(a.sign).toBe(strategy === 'follow' ? 1 : -1);
    expect(a.changes).toBe(0);
  }
  expect(boundaryBelief('adaptive', .9, 2).sign).toBe(1);
  expect(boundaryBelief('adaptive', .1, 2).sign).toBe(-1);
});
test('internal orientation preserves directional choices when all external landmarks are absent', async () => {
  const source = deserialize(await Bun.file(new URL('./fixtures/gray-branch-maze.json', import.meta.url)).text());
  const maze = { ...source, roof: true, translucentFabric: false, environment: { sun: { day: 15, minutes: 0 }, forest: { side: 'north' as const, distance: 12, offset: 0 } } };
  const options = { ...DEFAULT_ANALYSIS, corridorPreference: 0, boundaryPreference: 0, boundaryStrategy: 'follow' as const, routeMemory: 1, samples: 512 };
  const lost = analyzeColdspots(maze, { ...options, internalOrientation: 0 }), retained = analyzeColdspots(maze, { ...options, internalOrientation: 1 });
  expect(retained.landmarks!.orientedAreaRatio).toBe(0);
  expect(lost.landmarks!.orientedAreaRatio).toBe(0);
  // Cell 6 is a visible blind tail; cell 4 is an unresolved continuation.
  expect(lost.probability[6]!).toBe(0);
  expect(lost.probability[4]!).toBeGreaterThan(.3);
  expect(retained.probability[4]!).toBeLessThan(.05);
  expect(retained.probability[maze.exit.cell]).toBe(1);
});
test('reliable recognition suppresses bounded rechecks, not compulsory returns or the discovery of new passages', () => {
  const maze = fixture(), options = { ...DEFAULT_ANALYSIS, samples: 256 };
  const reliable = analyzeColdspots(maze, { ...options, routeMemory: 1 }), uncertain = analyzeColdspots(maze, { ...options, routeMemory: 0 });
  expect(reliable.behavior!.meanStrategyChanges).toBeGreaterThan(0);
  expect(reliable.behavior!.meanRechecks).toBe(0);
  expect(uncertain.behavior!.meanRechecks).toBeGreaterThan(0);
  expect(uncertain.behavior!.meanRechecks).toBeLessThanOrEqual(2);
  expect(uncertain.probability).toEqual(reliable.probability); // replay contains only already-observed cells
  expect(uncertain.expectedLength - reliable.expectedLength).toBeCloseTo(uncertain.behavior!.meanRecheckDistance, 8);
  expect(uncertain.expectedLength).toBeCloseTo(uncertain.visits.reduce((sum, n) => sum + n, 0) * 2, 8);
  expect(reliable.expectedLength).toBeCloseTo(reliable.visits.reduce((sum, n) => sum + n, 0) * 2, 8);
});
test('cognitive search terminates reproducibly on cyclic mazes and does not mutate them', () => {
  const maze = generate({ ...fixture().parameters, extraConnections: 4 }), before = structuredClone(maze), options = { ...DEFAULT_ANALYSIS, routeMemory: 0, samples: 128 };
  const a = analyzeColdspots(maze, options);
  expect(analyzeColdspots(maze, options)).toEqual(a);
  expect(maze).toEqual(before);
  expect(a.behavior!.meanStrategyChanges).toBeLessThanOrEqual(2);
  expect(a.probability[maze.exit.cell]).toBe(1);
  expect(a.expectedLength).toBeCloseTo(a.visits.reduce((sum, n) => sum + n, 0) * 2, 7);
});
test('explorer is independent of internal compass, beliefs and recognition', () => {
  const maze = fixture(), options = { ...DEFAULT_ANALYSIS, profile: 'explorer' as const };
  const a = analyzeColdspots(maze, { ...options, internalOrientation: 0, routeMemory: 0, boundaryStrategy: 'avoid' });
  const b = analyzeColdspots(maze, { ...options, internalOrientation: 1, routeMemory: 1, boundaryStrategy: 'follow' });
  expect(a.probability).toEqual(b.probability);
  expect(a.visits).toEqual(b.visits);
  expect(a.expectedLength).toBe(b.expectedLength);
});
test('invalid cognitive options are rejected before analysis', () => {
  const maze = fixture();
  for (const key of ['internalOrientation', 'routeMemory'] as const)
    for (const value of [-.1, 1.1, NaN, Infinity])
      expect(() => analyzeColdspots(maze, { ...DEFAULT_ANALYSIS, [key]: value })).toThrow();
  expect(() => analyzeColdspots(maze, { ...DEFAULT_ANALYSIS, boundaryStrategy: 'oracle' as never })).toThrow();
});
