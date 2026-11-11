import { describe, expect, test } from 'bun:test';
import { cellCenter, walls, type Parameters } from '../src/core/maze';
import { componentCount } from '../src/core/graph';
import { metrics } from '../src/core/metrics';
import { shortestPath } from '../src/core/pathfinding';
import { generate } from '../src/generators/generate';
import { deserialize, serialize } from '../src/persistence/maze-json';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';

const parameters: Parameters = { columns: 12, rows: 9, corridorWidth: 1.5, extraConnections: 0, seed: 'maze-lab', algorithm: 'backtracker' };

for (const algorithm of ['backtracker', 'prim'] as const) describe(algorithm, () => {
  test('reproducible connected spanning tree for multiple seeds', () => {
    for (let i = 0; i < 20; i++) {
      const p = { ...parameters, algorithm, seed: String(i) };
      const maze = generate(p);
      expect(generate(p)).toEqual(maze);
      expect(componentCount(maze)).toBe(1);
      expect(metrics(maze).cycles).toBe(0);
      expect(metrics(maze).corridors).toBe(107);
      expect(shortestPath(maze).length).toBeGreaterThan(1);
    }
  });
  test('different seeds produce different topology', () => {
    expect(generate({ ...parameters, algorithm, seed: 'a' }).passages)
      .not.toEqual(generate({ ...parameters, algorithm, seed: 'b' }).passages);
  });
  test('adds exactly the requested number of available edges', () => {
    expect(metrics(generate({ ...parameters, algorithm, extraConnections: 7 })).cycles).toBe(7);
    const maze = generate({ ...parameters, algorithm, extraConnections: 20000 });
    expect(metrics(maze).corridors).toBe(11*9+8*12);
    expect(metrics(maze).cycles).toBe(88);
    expect(shortestPath(maze).length).toBe(20);
  });
  test('minimal and single-axis grids', () => {
    for (const [columns, rows] of [[1, 1], [1, 8], [8, 1]]) {
      const maze = generate({ ...parameters, algorithm, columns: columns!, rows: rows!, extraConnections: 20000 });
      expect(componentCount(maze)).toBe(1);
      expect(metrics(maze).cycles).toBe(0);
      expect(shortestPath(maze).length).toBe(columns!*rows!);
    }
  });
  test('100 × 100 is connected, deterministic and serializable', () => {
    const start = performance.now();
    const maze = generate({ ...parameters, algorithm, columns: 100, rows: 100, extraConnections: 100 });
    expect(metrics(maze).components).toBe(1);
    expect(metrics(maze).cycles).toBe(100);
    expect(deserialize(serialize(maze))).toEqual(maze);
    expect(performance.now()-start).toBeLessThan(5000);
  });
});




test('rejects invalid parameters and malformed saved topology', () => {
  for (const columns of [0, -1, 1.2, 101, Infinity]) expect(() => generate({ ...parameters, columns })).toThrow();
  for (const corridorWidth of [0, 0.7, NaN, Infinity]) expect(() => generate({ ...parameters, corridorWidth })).toThrow();
  const maze = generate(parameters);
  expect(() => deserialize('{')).toThrow();
  expect(() => deserialize(JSON.stringify({ ...maze, version: 99 }))).toThrow();
  const bad = structuredClone(maze); bad.passages[0] = [99999];
  expect(() => deserialize(JSON.stringify(bad))).toThrow();
  const asym = structuredClone(maze); asym.passages[0] = [];
  expect(() => deserialize(JSON.stringify(asym))).toThrow();
  expect(() => deserialize(JSON.stringify({ ...maze, entrance: { cell: 13, side: 'west' } }))).toThrow();
});

describe('collisions', () => {
  const world = new CollisionWorld([{ x1: 2, z1: -5, x2: 2, z2: 5 }]);
  test('cannot tunnel at high speed', () => {
    const point = world.move({ x: 0, z: 0 }, { x: 10, z: 0 });
    expect(point.x).toBeLessThanOrEqual(1.72); expect(point.x).toBeGreaterThan(1.6);
  });
  test('slides along walls', () => {
    const point = world.move({ x: 1.7, z: 0 }, { x: 1, z: 1 });
    expect(point.x).toBeCloseTo(1.7); expect(point.z).toBeCloseTo(1);
  });
  test('circle cannot clip a corner', () => {
    const corner = new CollisionWorld([{ x1: 2, z1: 2, x2: 2, z2: 4 }, { x1: 2, z1: 2, x2: 4, z2: 2 }]);
    const point = corner.move({ x: 1.5, z: 1.5 }, { x: 1, z: 1 });
    expect(point.x).toBeLessThan(2); expect(point.z).toBeLessThan(2); expect(corner.blocked(point)).toBe(false);
  });
  test('start adjacent to wall can move away', () => {
    expect(world.move({ x: 1.72, z: 0 }, { x: -1, z: 0 }).x).toBeCloseTo(0.72);
  });
  test('open portals have no invisible wall', () => {
    const maze = generate({ ...parameters, columns: 1, rows: 1 });
    const collisions = new CollisionWorld(walls(maze));
    expect(collisions.blocked({ x: 0, z: 0.75 })).toBe(false);
    expect(collisions.blocked({ x: 0.75, z: 0 })).toBe(true);
  });
});

test('walking speed is normalized and independent of FPS', () => {
  const maze = generate({ ...parameters, columns: 10, rows: 10, corridorWidth: 10, extraConnections: 20000 });
  const simulate = (fps: number, diagonal: boolean) => {
    const player = new Player(maze, new CollisionWorld(walls(maze)));
    player.position = cellCenter(maze, 44); player.yaw = 0;
    for (let frame = 0; frame < fps; frame++) player.update(1/fps, new Set(diagonal ? ['KeyW', 'KeyD'] : ['KeyW']));
    return Math.hypot(player.position.x-45, player.position.z-45);
  };
  expect(simulate(30, false)).toBeCloseTo(1.4, 6);
  expect(simulate(144, true)).toBeCloseTo(1.4, 6);
});

test('one-cell traversal finishes at exit and records matching boundary-to-boundary distance', () => {
  const maze = generate({ ...parameters, columns: 1, rows: 1 });
  const player = new Player(maze, new CollisionWorld(walls(maze)));
  for (let i = 0; i < 200 && !player.finished; i++) player.update(1/60, new Set(['KeyW']));
  expect(player.finished).toBe(true);
  expect(player.recorder.distance).toBeCloseTo(1.5);
  expect(metrics(maze).optimalLength).toBeCloseTo(1.5);
  expect(player.recorder.samples.length).toBeGreaterThan(5);
});
