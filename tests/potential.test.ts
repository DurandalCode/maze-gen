import { expect, test } from 'bun:test';
import { generate } from '../src/generators/generate';
import { guardedMaze } from '../src/generators/guarded';
import { DEFAULT_ANALYSIS, analyzeColdspots } from '../src/analysis/coldspots';
import { analyzePotential } from '../src/analysis/potential-difficulty';
import { optimizeColdspots } from '../src/analysis/optimize';
import { mazePortalPrivacy } from '../src/analysis/portal-privacy';
import { domainOf } from '../src/core/domain';
import { metrics } from '../src/core/metrics';
import { deserialize, serialize } from '../src/persistence/maze-json';
const fixture = () => generate({ columns: 7, rows: 7, corridorWidth: 2, algorithm: 'prim', seed: 'quality', extraConnections: 0 });
const options = { ...DEFAULT_ANALYSIS, samples: 16 };
test('potential assessment forecasts a new maze without any recorded walk', () => {
  const base = fixture(), maze = guardedMaze(base, 'privacy', true).maze;
  const result = analyzePotential(maze, options);
  expect(result.supported).toBe(true);
  expect(result.eligible).toBe(true);
  expect(result.privacy.certified).toBe(true);
  expect(result.scenarios.map(s => s.strategy)).toEqual(['adaptive', 'follow', 'avoid']);
  expect(result.minOptionalCoverage).toBeGreaterThanOrEqual(0);
  expect(result.maxOptionalCoverage).toBeLessThanOrEqual(1);
  expect(result.mandatoryAreaRatio).toBeGreaterThanOrEqual(.35);
  expect(result.mandatoryAreaRatio).toBeLessThanOrEqual(.55);
  expect(analyzePotential(maze, options)).toEqual(result);
});
test('repeat visits and elapsed route length cannot inflate potential exploration', () => {
  const maze = fixture(), a = analyzeColdspots(maze, options), inflated = { ...a, expectedLength: a.expectedLength * 100, visits: a.visits.map(v => v * 100) };
  const normal = analyzePotential(maze, options, a), replayed = analyzePotential(maze, options, inflated);
  expect(replayed.score).toBe(normal.score);
  expect(replayed.scenarios).toEqual(normal.scenarios);
});
test('guarded completion preserves geometry, portals, construction and a connected tree', () => {
  const base = { ...fixture(), roof: true, wallColor: '#123456' }, snapshot = structuredClone(base);
  const { maze } = guardedMaze(base, 'guard-test');
  expect(base).toEqual(snapshot);
  expect(maze.parameters.columns).toBe(base.parameters.columns);
  expect(maze.parameters.rows).toBe(base.parameters.rows);
  expect(domainOf(maze).active).toEqual(domainOf(base).active);
  expect(maze.entrance).toEqual(base.entrance);
  expect(maze.exit).toEqual(base.exit);
  expect(maze.roof).toBe(true);
  expect(maze.wallColor).toBe('#123456');
  expect(metrics(maze).components).toBe(1);
  expect(metrics(maze).cycles).toBe(0);
  expect(mazePortalPrivacy(maze).certified).toBe(true);
  expect(guardedMaze(base, 'guard-test').maze).toEqual(maze);
  expect(deserialize(serialize(maze))).toEqual(maze);
});
test('the application optimizer uses the potential forecast and cannot accept exposed portals', () => {
  const base = fixture(), result = optimizeColdspots(base, options, 'walls', 16, undefined, 'exploration');
  expect(result.objective).toBe('exploration');
  expect(result.changed).toBe(true);
  expect(result.afterPotential!.eligible).toBe(true);
  expect(mazePortalPrivacy(result.maze).certified).toBe(true);
  expect(result.afterPotential!.score).toBe(result.after);
  expect(optimizeColdspots(base, options, 'walls', 16, undefined, 'exploration')).toEqual(result);
  expect(result.maze.entrance).toEqual(base.entrance);
  expect(result.maze.exit).toEqual(base.exit);
});
test('cyclic assessment separates tree-only forecasts and pockets that do not fit are explicit', () => {
  const cyclic = generate({ ...fixture().parameters, extraConnections: 2 });
  expect(analyzePotential(cyclic, options).supported).toBe(true);
  expect(analyzePotential(cyclic, options).treeForecast).toBe(false);
  expect(() => optimizeColdspots(cyclic, options, 'seeds', 2, undefined, 'exploration')).toThrow();
  const tiny = generate({ ...fixture().parameters, columns: 1, rows: 1 });
  expect(() => guardedMaze(tiny, 'tiny')).toThrow();
  expect(() => optimizeColdspots(fixture(), options, 'walls', 2, undefined, 'invalid' as never)).toThrow();
});
test('strict passage limits reject candidates instead of silently accepting long forced travel', () => {
  const result = optimizeColdspots(fixture(), { ...options, maxForcedStraight: 2, maxForcedRun: 4 }, 'walls', 2, undefined, 'exploration');
  expect(result.changed).toBe(false);
  expect(result.maze).toEqual(fixture());
  expect(result.afterPotential!.eligible).toBe(false);
  const normal = optimizeColdspots(fixture(), options, 'walls', 4, undefined, 'exploration');
  if (normal.changed) {
    expect(normal.afterPotential!.corridors.longestMandatoryForcedStraight).toBeLessThanOrEqual(12);
    expect(normal.afterPotential!.corridors.longestMandatoryForcedRun).toBeLessThanOrEqual(20);
  }
});
