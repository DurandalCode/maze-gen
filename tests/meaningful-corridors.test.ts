import { expect, test } from 'bun:test';
import { connect, emptyMaze, routingSize, type Maze } from '../src/core/maze';
import { domainOf } from '../src/core/domain';
import { routePoints, pathLength } from '../src/core/pathfinding';
import { corridorQuality } from '../src/analysis/corridor-quality';
import { prepareNavigation } from '../src/analysis/navigation';
import { viewCorridor } from '../src/analysis/corridor-view';
import { generate } from '../src/generators/generate';
const base = { columns: 7, rows: 3, corridorWidth: 2, algorithm: 'prim' as const, seed: 'meaningful', extraConnections: 0 };
function path(maze: Maze, cells: number[]) { for (let i = 1; i < cells.length; i++) connect(maze, cells[i - 1]!, cells[i]!); }
function mainLine() {
  const maze = emptyMaze(base); path(maze, [0, 1, 2, 3, 4, 5, 6]); maze.exit = { cell: 6, side: 'east' }; return maze;
}
function physicalPerspective(maze: Maze) {
  const context = prepareNavigation(maze); let length = 0;
  for (const from of domainOf(maze).cells) for (const to of maze.passages[from]!) length = Math.max(length, viewCorridor(maze, context, from, to, Infinity).length);
  return length;
}

test('visible side tails do not reset a forced run or fabricate route decisions', () => {
  const maze = mainLine();
  for (let c = 0; c < 7; c++) connect(maze, c, c + 7);
  const snapshot = structuredClone(maze), result = corridorQuality(maze, 8);
  expect(maze).toEqual(snapshot);
  expect(result.graphRouteForks).toBe(6); expect(result.routeForks).toBe(0);
  expect(result.longestMandatoryForcedRun).toBe(14); expect(result.longestMandatoryForcedStraight).toBe(14);
  expect(result.graphLongestMandatoryForcedStraight).toBe(3);
  expect(result.longMandatoryStraightRatio).toBe(1); expect(result.choicesPer100Metres).toBe(0);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

test('a concealed turn remains a choice despite eventually leading to a dead end', () => {
  const maze = mainLine(); path(maze, [3, 10, 11, 18]);
  const result = corridorQuality(maze);
  expect(result.routeForks).toBe(1); expect(result.graphRouteForks).toBe(1);
  expect(result.longestMandatoryForcedRun).toBe(7); expect(result.longestMandatoryForcedStraight).toBe(7);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

test('a side junction remains unknown even when each arm is itself a visible tail', () => {
  const maze = mainLine(); path(maze, [3, 10, 17]); path(maze, [10, 11]);
  const result = corridorQuality(maze);
  expect(result.routeForks).toBe(1);
  expect(result.longestMandatoryForcedRun).toBe(7);
});

test('a branch beyond the sight limit is not declared obvious', () => {
  const maze = emptyMaze({ ...base, columns: 3, rows: 15 });
  path(maze, [0, 1, 2]); maze.exit = { cell: 2, side: 'east' };
  path(maze, Array.from({ length: 15 }, (_, i) => 1 + i * 3));
  const result = corridorQuality(maze);
  expect(result.routeForks).toBe(1);
  expect(result.longestForcedRun).toBe(28); expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

test('a portal branch remains meaningful even if its straight geometry resembles a blind tail', () => {
  const maze = mainLine(); connect(maze, 3, 10);
  maze.portals = [maze.entrance, maze.exit, { cell: 10, side: 'south' }];
  expect(corridorQuality(maze).routeForks).toBe(1);
});

test('return loops preserve their real outgoing choice and finite physical lengths', () => {
  const maze = mainLine(); path(maze, [2, 9, 10, 11, 4]);
  const result = corridorQuality(maze);
  expect(result.routeForks).toBe(2); expect(result.graphRouteForks).toBe(2);
  expect(result.longestMandatoryForcedRun).toBe(5);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

test('a disconnected pure cycle is measured once rather than silently omitted', () => {
  const maze = emptyMaze({ ...base, columns: 4, rows: 3 });
  path(maze, [0, 1]); maze.exit = { cell: 1, side: 'north' };
  path(maze, [6, 7, 11, 10, 6]);
  const result = corridorQuality(maze);
  expect(result.longestForcedRun).toBe(8); expect(result.graphLongestForcedRun).toBe(8);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

for (const moduleSize of [undefined, 2]) test(`single ${moduleSize ? 'module' : 'classic cell'} has boundary-to-boundary forced length`, () => {
  const maze = emptyMaze({ ...base, columns: 1, rows: 1, corridorWidth: 3, moduleSize });
  const result = corridorQuality(maze);
  expect(result.longestMandatoryForcedRun).toBe(moduleSize ?? 3);
  expect(result.longestMandatoryForcedStraight).toBe(moduleSize ?? 3);
  expect(result.longestVisibleStraight).toBe(moduleSize ?? 3);
  expect(result.routeForks).toBe(0);
});

test('module and gap widths are measured physically across visible fake forks', () => {
  const maze = emptyMaze({ ...base, columns: 4, rows: 2, moduleSize: 2, corridorWidth: 1 });
  const width = routingSize(maze).columns;
  path(maze, Array.from({ length: width }, (_, i) => i)); maze.exit = { cell: width - 1, side: 'east' };
  for (let c = 0; c < width; c++) connect(maze, c, c + width);
  const result = corridorQuality(maze);
  expect(result.longestMandatoryForcedRun).toBe(11);
  expect(result.longestMandatoryForcedStraight).toBe(11); expect(result.routeForks).toBe(0);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
});

for (const moduleSize of [undefined, 2]) test(`hole footprint retains raw geometry and meaningful metric consistency (${moduleSize ?? 'classic'})`, () => {
  const maze = generate({ ...base, columns: 5, rows: 5, moduleSize, shape: { kind: 'grid-rectangles', rectangles: [
    { x: 0, z: 0, width: 5, height: 5, operation: 'add' }, { x: 1, z: 1, width: 3, height: 3, operation: 'subtract' },
  ] } });
  const result = corridorQuality(maze), optimal = pathLength(routePoints(maze));
  expect(result.longestMandatoryForcedRun).toBeGreaterThanOrEqual(result.graphLongestMandatoryForcedRun);
  expect(result.longestMandatoryForcedRun).toBeLessThanOrEqual(optimal + 1e-8);
  expect(result.routeForks).toBeLessThanOrEqual(result.graphRouteForks);
  expect(result.longestVisibleStraight).toBe(physicalPerspective(maze));
  expect(JSON.stringify(result)).not.toContain('null');
});

test('editing passages on an existing object cannot reuse a stale visible dead-end proof', () => {
  const maze = mainLine(); connect(maze, 3, 10);
  expect(corridorQuality(maze).routeForks).toBe(0);
  connect(maze, 10, 11); // Reveal a turn behind the side opening.
  expect(corridorQuality(maze).routeForks).toBe(1);
});
