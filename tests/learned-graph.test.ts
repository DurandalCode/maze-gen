import { expect, test } from 'bun:test';
import { LearnedGraph } from '../src/analysis/learned-graph';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
import { generate } from '../src/generators/generate';
import { domainOf } from '../src/core/domain';

const uniform = (size: number) => new LearnedGraph(size, Array.from({ length: size }, (_, i) => i), () => 2);

test('observed visited-to-visited shortcut replaces the old exploration-tree return', () => {
  const memory = uniform(6);
  memory.observe(0, [1]);
  memory.observe(1, [0, 2]);
  memory.observe(2, [1, 3]);
  memory.observe(3, [2, 4]);
  memory.observe(4, [3]);
  expect(memory.routesFrom(4).routeTo(0)).toEqual({ cells: [4, 3, 2, 1, 0], length: 8 });
  const beforeShortcut = memory.routesFrom(4);
  // The closing opening is only learned on observation, not from any global maze.
  memory.observe(4, [3, 0]);
  expect(beforeShortcut.routeTo(0)).toEqual({ cells: [4, 3, 2, 1, 0], length: 8 });
  expect(memory.hasCycles).toBe(true);
  expect(memory.routesFrom(4).routeTo(0)).toEqual({ cells: [4, 0], length: 2 });
  expect(memory.routesFrom(0).routeTo(4)).toEqual({ cells: [0, 4], length: 2 });
});

test('known openings into an unentered cell do not magically reveal its other openings or create transit shortcuts', () => {
  const memory = uniform(6);
  memory.observe(0, [1, 5]);
  memory.observe(1, [0, 2]);
  memory.observe(2, [1, 3]);
  memory.observe(3, [2, 4]);
  memory.observe(4, [3, 5]);
  // Both approaches to 5 are known, but 5 has never been physically entered.
  expect(memory.hasCycles).toBe(true);
  expect(memory.routesFrom(4).routeTo(0)).toEqual({ cells: [4, 3, 2, 1, 0], length: 8 });
  expect(memory.routesFrom(4).routeTo(5)).toEqual({ cells: [4, 5], length: 2 });
  expect(() => memory.routesFrom(5)).toThrow();
  memory.observe(5, [0, 4]);
  expect(memory.routesFrom(4).routeTo(0)).toEqual({ cells: [4, 5, 0], length: 4 });
});

test('frontier can be entered through its newly seen shorter approach instead of its first discoverer', () => {
  const memory = uniform(5);
  memory.observe(0, [1, 4]); // first discovery of 4
  memory.observe(1, [0, 2]);
  memory.observe(2, [1, 3]);
  memory.observe(3, [2, 4]);
  const routes = memory.routesFrom(3);
  expect(routes.predecessorOf(4)).toBe(3);
  expect(routes.distanceTo(4)).toBe(2);
  expect(routes.routeTo(4)).toEqual({ cells: [3, 4], length: 2 });
});

test('routes minimize physical edge length, ignore inactive cells, and count repeated observations once', () => {
  const costs = new Map([['0:1', 7], ['1:2', 7], ['0:3', 1], ['2:3', 1]]);
  const memory = new LearnedGraph(5, [0, 1, 2, 3], (a, b) => costs.get(`${Math.min(a,b)}:${Math.max(a,b)}`)!);
  memory.observe(0, [1, 3, 4]);
  memory.observe(1, [0, 2]);
  memory.observe(2, [1, 3]);
  memory.observe(3, [0, 2]);
  memory.observe(3, [0, 2]);
  expect(memory.neighbors(0)).toEqual([1, 3]);
  expect(memory.routesFrom(0).routeTo(2)).toEqual({ cells: [0, 3, 2], length: 2 });
  expect(memory.routesFrom(0).routeTo(4)).toBeUndefined();
  expect(() => memory.observe(4, [0])).toThrow();
});

test('cyclic directed forecasts preserve physical visit accounting, deterministic bounded rechecks and inactive cells', () => {
  const maze = generate({ columns: 9, rows: 9, corridorWidth: 2, seed: 'learned-memory-v9', algorithm: 'prim', extraConnections: 7,
    shape: { kind: 'grid-rectangles', rectangles: [
      { x: 0, z: 0, width: 9, height: 9, operation: 'add' },
      { x: 3, z: 3, width: 1, height: 2, operation: 'subtract' },
    ] } });
  const before = structuredClone(maze), active = domainOf(maze).active;
  for (const decisionMode of ['local', 'frontier'] as const) {
    const options = { ...DEFAULT_ANALYSIS, decisionMode, routeMemory: 0, samples: 128 };
    const result = analyzeColdspots(maze, options);
    expect(analyzeColdspots(maze, options)).toEqual(result);
    expect(result.expectedLength).toBeCloseTo(result.visits.reduce((sum, count) => sum + 2 * count, 0), 7);
    expect(result.behavior!.meanRechecks).toBeLessThanOrEqual(2);
    expect(result.behavior!.meanRechecks).toBeGreaterThan(0);
    expect(result.probability[maze.exit.cell]).toBe(1);
    for (let cell = 0; cell < active.length; cell++) {
      expect(result.visits[cell]!).toBeGreaterThanOrEqual(result.probability[cell]! - 1e-10);
      if (!active[cell]) { expect(result.visits[cell]).toBe(0); expect(result.probability[cell]).toBe(0); }
    }
    const reliable = analyzeColdspots(maze, { ...options, routeMemory: 1 });
    expect(reliable.behavior!.meanRechecks).toBe(0);
    expect(reliable.expectedLength).toBeCloseTo(reliable.visits.reduce((sum, count) => sum + 2 * count, 0), 7);
  }
  expect(maze).toEqual(before);
});
