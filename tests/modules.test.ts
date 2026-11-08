import { expect, test } from 'bun:test';
import { cellCenter, emptyMaze, portalPoint, routingSize, walls, type Parameters } from '../src/core/maze';
import { random } from '../src/core/random';
import { backtracker } from '../src/generators/backtracker';
import { componentCount } from '../src/core/graph';
import { shortestPath, routePoints } from '../src/core/pathfinding';
import { metrics } from '../src/core/metrics';
import { moduleFootprints, supportColliders, timberStructure } from '../src/core/structure';
import { generate } from '../src/generators/generate';
import { deserialize, serialize } from '../src/persistence/maze-json';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';

const p: Parameters = { columns: 2, rows: 1, moduleSize: 2, corridorWidth: 1.5, extraConnections: 0, seed: 'modules', algorithm: 'backtracker' };

test('separate 2m modules have four corners each and a real inter-module gap', () => {
  const maze = generate(p), modules = moduleFootprints(maze), structure = timberStructure(maze);
  expect(modules).toEqual([{ x: 0, z: 0, size: 2 }, { x: 3.5, z: 0, size: 2 }]);
  expect(maze.width).toBe(5.5); expect(maze.depth).toBe(2);
  expect(structure.posts.length).toBe(8); expect(structure.frames.length).toBe(8);
  for (const m of modules) for (const [dx, dz] of [[0, 0], [2, 0], [2, 2], [0, 2]])
    expect(structure.posts.filter(post => post.x === m.x+dx! && post.z === m.z+dz!).length).toBe(1);
  // No lintel bridges the 1.5m gap and there is no extra perimeter frame.
  expect(structure.frames.some(f => f.x1 < 2.75 && f.x2 > 2.75)).toBe(false);
});

test('walls can block gaps in both directions, with both endpoints on module uprights', () => {
  const maze = generate({ ...p, columns: 5, rows: 4 });
  const structure = timberStructure(maze), panels = walls(maze);
  const world = new CollisionWorld([...walls(maze), ...supportColliders(maze)]);
  expect(panels.some(w => Math.abs(w.x2-w.x1) === 1.5 && w.z1 > 0 && w.z1 < maze.depth)).toBe(true);
  expect(panels.some(w => Math.abs(w.z2-w.z1) === 1.5 && w.x1 > 0 && w.x1 < maze.width)).toBe(true);
  for (const wall of panels) {
    expect(structure.posts.some(p => p.x === wall.x1 && p.z === wall.z1)).toBe(true);
    expect(structure.posts.some(p => p.x === wall.x2 && p.z === wall.z2)).toBe(true);
    expect(world.blocked({ x: (wall.x1+wall.x2)/2, z: (wall.z1+wall.z2)/2 })).toBe(true);
  }
  const path = shortestPath(maze), { columns } = routingSize(maze);
  expect(path.some(c => c%columns%2 === 1 || Math.floor(c/columns)%2 === 1)).toBe(true);
  expect(path.some(c => c%columns%2 === 0 && Math.floor(c/columns)%2 === 0)).toBe(true);
  for (const cell of path) expect(world.blocked(cellCenter(maze, cell))).toBe(false);
});

test('one module can be crossed from entrance through its interior to exit', () => {
  const maze = generate({ ...p, columns: 1 });
  const player = new Player(maze, new CollisionWorld([...walls(maze), ...supportColliders(maze)]));
  expect(portalPoint(maze, maze.entrance)).toEqual({ x: 0, z: 1 });
  for (let i = 0; i < 300 && !player.finished; i++) player.update(1/60, new Set(['KeyW']));
  expect(player.finished).toBe(true);
  expect(player.recorder.distance).toBeCloseTo(2);
  expect(metrics(maze).optimalLength).toBeCloseTo(2);
});

for (const algorithm of ['prim', 'backtracker'] as const) test(`${algorithm}: one maze across modules and gaps, controlled cycles and collision-free BFS`, () => {
  const maze = generate({ ...p, columns: 5, rows: 4, algorithm, extraConnections: 3 });
  expect(generate(maze.parameters)).toEqual(maze);
  expect(componentCount(maze)).toBe(1);
  expect(metrics(maze).cycles).toBe(3);
  const tree = generate({ ...maze.parameters, extraConnections: 0 });
  expect(metrics(tree).cycles).toBe(0);
  expect(metrics(tree).deadEnds).toBeGreaterThan(0);
  expect(deserialize(serialize(maze))).toEqual(maze);
  const world = new CollisionWorld([...walls(maze), ...supportColliders(maze)]);
  const points = routePoints(maze);
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1]!, b = points[i]!;
    const moved = world.move(a, { x: b.x-a.x, z: b.z-a.z });
    expect(moved.x).toBeCloseTo(b.x); expect(moved.z).toBeCloseTo(b.z);
  }
});

test('100×100 modules remain serializable within the file-size limit', () => {
  const maze = generate({ ...p, columns: 100, rows: 100 });
  expect(maze.passages.length).toBe(39601);
  const json = serialize(maze);
  expect(json.length).toBeLessThan(5_000_000);
  expect(deserialize(json)).toEqual(maze);
  expect(componentCount(maze)).toBe(1);
});

test('saved v1 modular files keep their old geometry; regeneration uses v2 without an outside ring', () => {
  const legacy = emptyMaze(p, 1);
  backtracker(legacy, random(p.seed));
  const restored = deserialize(serialize(legacy));
  expect(restored).toEqual(legacy);
  expect(restored.width).toBe(8.5);
  expect(moduleFootprints(restored)[0]).toEqual({ x: 1.5, z: 1.5, size: 2 });
  const updated = generate(restored.parameters);
  expect(updated.version).toBe(2);
  expect(updated.width).toBe(5.5);
  expect(moduleFootprints(updated)[0]).toEqual({ x: 0, z: 0, size: 2 });
});

test('module dimensions are validated, including JSON input', () => {
  for (const moduleSize of [0, 0.7, 11, NaN]) expect(() => generate({ ...p, moduleSize })).toThrow();
  const maze = generate(p);
  expect(() => deserialize(JSON.stringify({ ...maze, parameters: { ...p, moduleSize: null } }))).toThrow();
});
