import { expect, test } from 'bun:test';
import { generate } from '../src/generators/generate';
import { emptyMaze, portalPoint, routingSize, walls, type Algorithm, type Portal } from '../src/core/maze';
import { boundaryPortal, mazePortals, portalAtPoint, samePortal, transferPortals, withPortals } from '../src/core/portals';
import { pathLength, routePoints, shortestPath } from '../src/core/pathfinding';
import { deserialize, serialize } from '../src/persistence/maze-json';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';

const parameters = { columns: 3, rows: 3, moduleSize: 2, corridorWidth: 1,
  extraConnections: 0, seed: 'multi-portals', algorithm: 'prim' as Algorithm };

test('every pair of perimeter openings shares a route for both generators', () => {
  for (const algorithm of ['prim', 'backtracker'] as const) {
    const original = generate({ ...parameters, algorithm });
    const portals: Portal[] = [original.entrance, original.exit, { cell: 2, side: 'north' }, { cell: 22, side: 'south' }];
    const maze = withPortals(original, portals);
    expect(walls(maze).length).toBe(walls(original).length-2);
    expect(maze.passages).toEqual(original.passages);
    for (const entrance of portals) for (const exit of portals) {
      if (samePortal(entrance, exit)) continue;
      const pair = { ...maze, entrance, exit }, points = routePoints(pair);
      expect(shortestPath(pair).length).toBeGreaterThan(0);
      expect(points[0]).toEqual(portalPoint(pair, entrance));
      expect(points.at(-1)).toEqual(portalPoint(pair, exit));
      expect(pathLength(points)).toBeCloseTo(pathLength(routePoints({ ...pair, entrance: exit, exit: entrance })), 8);
    }
  }
});

test('new files preserve all portals and selected direction; old files retain their pair', () => {
  const original = generate(parameters);
  expect(mazePortals(deserialize(serialize(original)))).toEqual([original.entrance, original.exit]);
  const multi = withPortals(original, [original.entrance, original.exit, { cell: 2, side: 'north' }]);
  const selected = { ...multi, entrance: multi.portals![2]!, exit: original.entrance };
  expect(deserialize(serialize(selected))).toEqual(selected);
  for (const portals of [[original.entrance], [original.entrance, original.entrance],
    [original.entrance, { cell: 12, side: 'north' }]])
    expect(() => deserialize(JSON.stringify({ ...selected, portals }))).toThrow();
  expect(() => deserialize(JSON.stringify({ ...selected, entrance: { cell: 0, side: 'north' } }))).toThrow();
});

test('map placement snaps to module and gap cells only near the perimeter', () => {
  const maze = generate(parameters);
  expect(portalAtPoint(maze, { x: 2.5, z: -0.05 }, 0.1)).toEqual({ cell: 1, side: 'north' });
  expect(portalAtPoint(maze, { x: 3.5, z: maze.depth }, 0.1)).toEqual({ cell: 22, side: 'south' });
  expect(portalAtPoint(maze, { x: 4, z: 4 }, 0.1)).toBeNull();
  expect(portalAtPoint(maze, { x: -1, z: -1 }, 0.1)).toBeNull();
});

test('regeneration preserves selected endpoints and detects merging openings on a smaller grid', () => {
  const original = generate(parameters);
  const multi = withPortals(original, [original.entrance, original.exit, { cell: 2, side: 'north' }]);
  const selected = { ...multi, entrance: multi.portals![2]!, exit: original.entrance };
  const larger = transferPortals(selected, generate({ ...parameters, columns: 5, rows: 4 }));
  expect(larger.portals).toHaveLength(3);
  expect(larger.entrance).toEqual({ cell: 4, side: 'north' });
  expect(larger.portals!.every(p => boundaryPortal(larger, p))).toBe(true);
  expect(transferPortals(selected, generate(parameters)).portals).toEqual(selected.portals);
  const crowded = withPortals(original, [original.entrance, original.exit, { cell: 0, side: 'north' }, { cell: 1, side: 'north' }]);
  expect(() => transferPortals(crowded, generate({ ...parameters, columns: 1, rows: 1 }))).toThrow();
  const removed = withPortals(selected, [original.entrance, original.exit]);
  expect(samePortal(removed.entrance, removed.exit)).toBe(false);
  expect(() => withPortals(emptyMaze(parameters), [original.entrance, original.exit])).toThrow();
});

test('selected same-cell pair can be walked in both directions despite another open portal', () => {
  const base = generate({ ...parameters, columns: 1, rows: 1 });
  const west: Portal = { cell: 0, side: 'west' }, east: Portal = { cell: 0, side: 'east' };
  const multi = withPortals(base, [west, east, { cell: 0, side: 'north' }]);
  for (const [entrance, exit] of [[west, east], [east, west]]) {
    const maze = { ...multi, entrance: entrance!, exit: exit! };
    const player = new Player(maze, new CollisionWorld(walls(maze)));
    expect(player.position).toEqual(portalPoint(maze, maze.entrance));
    for (let i = 0; i < 30 && !player.finished; i++) player.update(0.1, new Set(['KeyW']));
    expect(player.finished).toBe(true);
    expect(player.position.x).toBeCloseTo(portalPoint(maze, maze.exit).x);
    expect(player.recorder.distance).toBeCloseTo(pathLength(routePoints(maze)));
  }
  expect(routingSize(multi)).toEqual({ columns: 1, rows: 1 });
});
