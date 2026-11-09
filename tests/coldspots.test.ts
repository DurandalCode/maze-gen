import {visibleDeadEnds} from '../src/analysis/visible-deadends';
import { expect, test } from 'bun:test';
import { analyzeColdspots, DEFAULT_ANALYSIS } from '../src/analysis/coldspots';
import { prepareNavigation, prepareOutline, type NavigationProfile } from '../src/analysis/navigation';
import { optimizeColdspots } from '../src/analysis/optimize';
import { domainOf } from '../src/core/domain';
import { metrics } from '../src/core/metrics';
import { shortestPath } from '../src/core/pathfinding';
import { withPortals } from '../src/core/portals';
import { connect, emptyMaze, type Parameters } from '../src/core/maze';
import { generate } from '../src/generators/generate';
import { serialize, deserialize } from '../src/persistence/maze-json';
const p: Parameters = { columns: 4, rows: 4, corridorWidth: 1, moduleSize: 2, algorithm: 'backtracker', seed: 'heat-tests', extraConnections: 0 };
function uMaze(extraConnections = 0) {
  const maze = generate({ ...p, columns: 9, rows: 9, corridorWidth: 2, seed: 'FIELD-024', extraConnections,
    shape: { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: 9, height: 9, operation: 'add' }, { x: 3, z: 3, width: 3, height: 6, operation: 'subtract' }] } });
  const entrance = { cell: 272, side: 'south' as const }, exit = { cell: 288, side: 'south' as const };
  return withPortals({ ...maze, entrance, exit }, [entrance, exit]);
}
for (const profile of ['explorer', 'compass', 'outline'] as NavigationProfile[])
  for (const algorithm of ['prim', 'backtracker'] as const)
    test(`${profile} ${algorithm}: zero direction strength matches sampled exploration`, () => {
      const maze = generate({ ...p, algorithm });
      const options = { ...DEFAULT_ANALYSIS, profile, beta: 0, corridorPreference:0, boundaryPreference:0, samples: 2048 };
      const exact = analyzeColdspots(maze, options), sample = analyzeColdspots(maze, options, undefined, true);
      expect(exact.method).toBe('exact-tree');
      expect(sample.method).toBe('sampled');
      for (const cell of domainOf(maze).cells) {
        expect(Math.abs(exact.probability[cell]! - sample.probability[cell]!)).toBeLessThan(.05);
        expect(Math.abs(exact.visits[cell]! - sample.visits[cell]!)).toBeLessThan(.12);
      }
      expect(Math.abs(exact.expectedLength - sample.expectedLength) / exact.expectedLength).toBeLessThan(.04);
      expect(exact.probability[maze.entrance.cell]).toBe(1);
      expect(exact.probability[maze.exit.cell]).toBe(1);
      for (const cell of shortestPath(maze))
        expect(exact.probability[cell]).toBe(1);
    });
test('footprint knowledge is independent of internal walls and seed', () => {
  const a = uMaze(), b = { ...a, passages: a.passages.map(() => []) };
  const ca = prepareNavigation(a), cb = prepareNavigation(b);
  prepareOutline(a, ca);
  prepareOutline(b, cb);
  expect(ca.outlineTargets).toEqual(cb.outlineTargets);
  expect(ca.outlineTargets![a.entrance.cell]!.z).toBeLessThan(ca.centers[a.entrance.cell]!.z);
});
test('cold regions are area-weighted, connected through passages, and omit missing cells', () => {
  const maze = uMaze(), result = analyzeColdspots(maze), domain = domainOf(maze);
  expect(result.coldAreaRatio).toBeGreaterThan(.1);
  expect(result.coldAreaRatio).toBeLessThan(.8);
  let sum = 0;
  for (const region of result.regions) {
    let area = 0;
    const set = new Set(region.cells), seen = new Set([region.cells[0]!]), queue = [region.cells[0]!];
    for (const cell of queue)
      for (const next of maze.passages[cell]!)
        if (set.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    expect(seen.size).toBe(set.size);
    for (const cell of region.cells) {
      const r = domain.rectangles[cell]!;
      expect(result.probability[cell]!).toBeLessThan(result.options.threshold);
      area += (r.x2 - r.x1) * (r.z2 - r.z1);
    }
    expect(region.area).toBeCloseTo(area);
    sum += area;
  }
  expect(result.coldArea).toBeCloseTo(sum);
  expect(result.coldAreaRatio).toBeCloseTo(sum / domain.area);
  for (let cell = 0; cell < maze.passages.length; cell++)
    if (!domain.active[cell])
      expect(result.probability[cell]).toBe(0);
});
test('straight path has no cold spots and traversal load is distinct from reach probability', () => {
  const straight = generate({ ...p, columns: 1, rows: 4, moduleSize: undefined });
  const result = analyzeColdspots(straight);
  expect(result.coldArea).toBe(0);
  expect(result.searchRatio).toBeCloseTo(1);
  expect(Array.from(result.visits)).toEqual([1, 1, 1, 1]);
  const maze = uMaze(), heat = analyzeColdspots(maze);
  expect(heat.visits.some((v, i) => v > heat.probability[i]! + .1)).toBe(true);
});
test('a branch encountered only after detecting the finish is never explored', () => {
  const maze = generate({ ...p, columns: 1, rows: 3, moduleSize: undefined });
  const exit = { cell: 1, side: 'west' as const };
  const heat = analyzeColdspots({ ...maze, exit });
  expect(heat.probability[2]).toBe(0);
  expect(heat.visits[2]).toBe(0);
  expect(heat.coldArea).toBe(1);
});
test('cyclic results are reproducible, stop at goal and do not mutate maze', () => {
  const maze = uMaze(3), before = serialize(maze), a = analyzeColdspots(maze), b = analyzeColdspots(maze);
  expect(a).toEqual(b);
  expect(a.method).toBe('sampled');
  expect(serialize(maze)).toBe(before);
  expect(a.searchRatio).toBeGreaterThanOrEqual(1 - 1e-10);
  for (const cell of domainOf(maze).cells) {
    expect(a.probability[cell]!).toBeGreaterThanOrEqual(0);
    expect(a.probability[cell]!).toBeLessThanOrEqual(1);
  }
});
test('unreachable goal and invalid options produce explicit errors', () => {
  expect(() => analyzeColdspots(emptyMaze(p))).toThrow('недостижим');
  for (const options of [{ beta: NaN }, { threshold: 0 }, { samples: 1 }])
    expect(() => analyzeColdspots(generate(p), { ...DEFAULT_ANALYSIS, ...options })).toThrow();
});
for (const method of ['seeds', 'walls'] as const)
  test(`${method}: optimization preserves geometry, portals, cycles and branching and never worsens objective`, () => {
    const base = uMaze(), snapshot = serialize(base), before = metrics(base), progress: number[] = [];
    const result = optimizeColdspots(base, DEFAULT_ANALYSIS, method, 16, (done) => progress.push(done));
    expect(progress.length).toBe(result.attempted);
    expect(result.after).toBeLessThanOrEqual(result.before);
    expect(serialize(base)).toBe(snapshot);
    expect(result.maze.parameters.shape).toEqual(base.parameters.shape);
    expect(result.maze.entrance).toEqual(base.entrance);
    expect(result.maze.exit).toEqual(base.exit);
    expect(result.maze.portals).toEqual(base.portals);
    const after = metrics(result.maze);
    expect(after.cycles).toBe(before.cycles);
    expect(after.components).toBe(1);
    expect(after.junctions).toBeGreaterThanOrEqual(Math.ceil(before.junctions * .8));
    expect(after.deadEnds).toBeGreaterThanOrEqual(Math.ceil(before.deadEnds * .8));
    expect(after.optimalLength).toBeGreaterThanOrEqual(before.optimalLength * .8);
    expect(after.optimalLength).toBeLessThanOrEqual(before.optimalLength * 1.5);
    expect(deserialize(serialize(result.maze))).toEqual(result.maze);
    expect(optimizeColdspots(base, DEFAULT_ANALYSIS, method, 16)).toEqual(result);
  });
test('wall exchanges also preserve cyclic mazes and handle a grid with no closed edges', () => {
  const base = uMaze(2), result = optimizeColdspots(base, { ...DEFAULT_ANALYSIS, samples: 32 }, 'walls', 3);
  expect(metrics(result.maze).cycles).toBe(2);
  expect(metrics(result.maze).components).toBe(1);
  const full = generate({ ...p, columns: 2, rows: 2, moduleSize: undefined, extraConnections: 100 });
  expect(optimizeColdspots(full, { ...DEFAULT_ANALYSIS, samples: 32 }, 'walls', 3).changed).toBe(false);
});
test('oriented exploration reconsiders a tempting branch instead of exhaustively exploring it', () => {
  const maze = emptyMaze({ ...p, columns: 9, rows: 2, moduleSize: undefined, corridorWidth: 2 });
  for (let x = 0; x < 8; x++)
    connect(maze, x, x + 1);
  for (const x of [0, 1, 2, 3, 5, 6, 7, 8])
    connect(maze, x, x + 9);
  connect(maze, 14, 13);
  maze.entrance = { cell: 4, side: 'north' };
  maze.exit = { cell: 13, side: 'south' };
  maze.wallHeight = 1.8;
  const result = analyzeColdspots(maze, { ...DEFAULT_ANALYSIS, profile: 'compass', corridorPreference:0, samples: 2048 });
  expect(result.method).toBe('sampled');
  // At the first fork east/west are symmetric with respect to the southern goal.
  expect(result.probability[3]!).toBeGreaterThan(.25);
  expect(result.probability[3]!).toBeLessThan(.75);
  // Continuing west becomes less attractive than the still-untried eastern option.
  expect(result.probability[0]!).toBeLessThan(.05);
  expect(result.probability[0]!).toBeLessThan(result.probability[3]! / 5);
  expect(result.probability[maze.exit.cell]).toBe(1);
  // Every edge is two metres; endpoint-to-centre travel contributes two metres total.
  expect(result.expectedLength).toBeCloseTo(result.visits.reduce((sum, n) => sum + n, 0) * 2, 8);
});
test('necessary movement away from the goal is postponed, never permanently forbidden', () => {
  const maze = emptyMaze({ ...p, columns: 3, rows: 3, moduleSize: undefined, corridorWidth: 2 });
  const snake = [2, 1, 0, 3, 4, 5, 8, 7, 6];
  for (let i = 1; i < snake.length; i++)
    connect(maze, snake[i - 1]!, snake[i]!);
  maze.entrance = { cell: 2, side: 'north' };
  maze.exit = { cell: 8, side: 'south' };
  for (const profile of ['compass', 'outline'] as const) {
    const result = analyzeColdspots(maze, { ...DEFAULT_ANALYSIS, profile });
    for (const cell of shortestPath(maze))
      expect(result.probability[cell]).toBe(1);
    expect(result.probability[6]).toBe(0);
    expect(result.searchRatio).toBeCloseTo(1);
  }
});
test('oriented search travel and revisit counts agree, including hidden-cue cyclic environments', () => {
  for (const night of [false, true])
    for (const cycles of [0, 3]) {
      const base = uMaze(cycles), maze = { ...base, environment: { sun: { day: 15, minutes: night ? 0 : 780 }, forest: { side: 'north' as const, distance: 12, offset: 0 } } };
      const a = analyzeColdspots(maze), b = analyzeColdspots(maze);
      expect(a).toEqual(b);
      expect(a.expectedLength).toBeCloseTo(a.visits.reduce((sum, n) => sum + n, 0) * 2, 7);
      for (const cell of domainOf(maze).cells)
        expect(a.visits[cell]!).toBeGreaterThanOrEqual(a.probability[cell]! - 1e-10);
      expect(a.probability[maze.exit.cell]).toBe(1);
      if (night)
        expect(a.landmarks!.orientedAreaRatio).toBe(0);
    }
});
test('landmarks affect uncertain branches but visible blind tails stay cold even without orientation', async () => {
  const source = deserialize(await Bun.file(new URL('./fixtures/gray-branch-maze.json', import.meta.url)).text());
  const maze = { ...source, translucentFabric: true };
  const daylight = analyzeColdspots(maze,{...DEFAULT_ANALYSIS,internalOrientation:0}), night = analyzeColdspots({ ...maze, environment: { sun: { day: 15, minutes: 0 }, forest: { side: 'north', distance: 12, offset: 0 } } },{...DEFAULT_ANALYSIS,internalOrientation:0});
  // These cells are in the large northern branch from the reported screenshot.
  for (const cell of [3, 6, 9, 12]) {
    expect(daylight.probability[cell]!).toBeLessThan(.05);
    // Loss of heading does not hide a terminal wall. Do not restore the old
    // expectation of walking into visually exhausted branches merely because it is night.
    if(visibleDeadEnds(maze).cells.has(cell))expect(night.probability[cell]!).toBe(0);
    else expect(night.probability[cell]!).toBeGreaterThan(daylight.probability[cell]!);
  }
  expect(daylight.landmarks!.sunAreaRatio).toBe(1);
  expect(night.landmarks!.orientedAreaRatio).toBe(0);
});
