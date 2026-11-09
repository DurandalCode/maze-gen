import { expect, test } from 'bun:test';
import { InstancedMesh, Raycaster, Vector3 } from 'three';
import { generate } from '../src/generators/generate';
import { domainOf, shapeMask, type ShapeRectangle } from '../src/core/domain';
import { cellCenter, portalPoint, walls, neighbors, type Parameters } from '../src/core/maze';
import { componentCount } from '../src/core/graph';
import { metrics } from '../src/core/metrics';
import { routePoints } from '../src/core/pathfinding';
import { boundaryPortal, portalAtPoint, samePortal, transferPortals, withPortals, mazePortals } from '../src/core/portals';
import { moduleFootprints, supportColliders, timberStructure } from '../src/core/structure';
import { serialize, deserialize } from '../src/persistence/maze-json';
import { CollisionWorld } from '../src/simulation/collisions';
import { Player } from '../src/simulation/player';
import { mazeMesh } from '../src/renderer/maze-mesh';
import { disposeMeshes } from '../src/renderer/dispose';
const rect = (x: number, z: number, width: number, height: number, operation: ShapeRectangle['operation'] = 'add'): ShapeRectangle => ({ x, z, width, height, operation });
const base: Parameters = { columns: 5, rows: 5, corridorWidth: 1, moduleSize: 2, algorithm: 'backtracker', seed: 'shapes', extraConnections: 0 };
const cases: Record<string, ShapeRectangle[]> = {
  L: [rect(0, 0, 2, 5), rect(0, 3, 5, 2)],
  T: [rect(0, 0, 5, 2), rect(2, 0, 1, 5)],
  U: [rect(0, 0, 5, 5), rect(1, 0, 3, 4, 'subtract')],
  ring: [rect(0, 0, 5, 5), rect(1, 1, 3, 3, 'subtract')],
  strip: [rect(2, 0, 1, 5)],
  single: [rect(2, 2, 1, 1)],
};
for (const algorithm of ['prim', 'backtracker'] as const)
  for (const modules of [false, true])
    for (const [name, rectangles] of Object.entries(cases))
      test(`${algorithm} ${modules ? 'modules' : 'grid'} ${name}: geometry, graph, route and persistence agree`, () => {
        const maze = generate({ ...base, algorithm, moduleSize: modules ? 2 : undefined, shape: { kind: 'grid-rectangles', rectangles } });
        const domain = domainOf(maze), m = metrics(maze);
        expect(maze.version).toBe(3);
        expect(componentCount(maze)).toBe(1);
        expect(m.cycles).toBe(0);
        expect(m.cells).toBe(domain.cells.length);
        expect(generate(maze.parameters)).toEqual(maze);
        expect(deserialize(serialize(maze))).toEqual(maze);
        expect(domain.area).toBeGreaterThan(0);
        expect(boundaryPortal(maze, maze.entrance)).toBe(true);
        expect(boundaryPortal(maze, maze.exit)).toBe(true);
        for (let i = 0; i < maze.passages.length; i++)
          if (!domain.active[i])
            expect(maze.passages[i]).toEqual([]);
        const world = new CollisionWorld([...walls(maze), ...supportColliders(maze)]);
        const route = routePoints(maze);
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1]!, b = route[i]!, end = world.move(a, { x: b.x - a.x, z: b.z - a.z });
          expect(end.x).toBeCloseTo(b.x);
          expect(end.z).toBeCloseTo(b.z);
          expect(domain.contains(b)).toBe(true);
        }
        const segments = walls(maze).map(w => JSON.stringify(w));
        expect(new Set(segments).size).toBe(segments.length);
        for (const p of timberStructure(maze).posts)
          expect(domain.contains(p)).toBe(true);
        if (modules)
          expect(moduleFootprints(maze).length).toBe(shapeMask(maze.parameters).reduce((a, b) => a + b, 0));
        const extra = generate({ ...maze.parameters, extraConnections: 3 });
        expect(metrics(extra).cycles).toBe(Math.min(3, domain.cells.reduce((n, c) => n + neighbors(maze, c).length, 0) / 2 - domain.cells.length + 1));
      });
test('union minus cuts is independent of order, rejects invalid and disconnected domains', () => {
  const rectangles = [rect(0, 0, 3, 5), rect(2, 0, 3, 5), rect(1, 1, 3, 3, 'subtract')];
  const p = { ...base, shape: { kind: 'grid-rectangles' as const, rectangles } };
  expect(shapeMask(p)).toEqual(shapeMask({ ...p, shape: { ...p.shape, rectangles: [...rectangles].reverse() } }));
  expect(generate(p).passages).toEqual(generate({ ...p, shape: { ...p.shape, rectangles: [...rectangles].reverse() } }).passages);
  for (const bad of [[], [rect(0, 0, 5, 5), rect(0, 0, 5, 5, 'subtract')], [rect(0, 0, 1, 1), rect(1, 1, 1, 1)], [rect(0, 0, 1, 1), rect(4, 4, 1, 1)], [rect(4, 4, 2, 1)], [rect(0.5, 0, 2, 2)]])
    expect(() => generate({ ...base, shape: { kind: 'grid-rectangles', rectangles: bad } })).toThrow();
});
test('module gaps require both neighbours and four-way gaps require all four modules', () => {
  const maze = generate({ ...base, columns: 2, rows: 2, shape: { kind: 'grid-rectangles', rectangles: [rect(0, 0, 2, 2), rect(1, 1, 1, 1, 'subtract')] } });
  expect(Array.from(domainOf(maze).active)).toEqual([1, 1, 1, 1, 0, 0, 1, 0, 0]);
  expect(metrics(maze).area).toBe(16); // Three 2×2 modules and two 2×1 gaps.
  const posts = timberStructure(maze).posts;
  for (const w of walls(maze)) {
    expect(posts.some(p => p.x === w.x1 && p.z === w.z1)).toBe(true);
    expect(posts.some(p => p.x === w.x2 && p.z === w.z2)).toBe(true);
  }
});
test('hole portals support placement, traversal in both directions and prevent escape', () => {
  for (const modules of [false, true]) {
    const original = generate({ ...base, moduleSize: modules ? 2 : undefined, shape: { kind: 'grid-rectangles', rectangles: cases.ring! } });
    const domain = domainOf(original);
    const inner = domain.boundary.find(e => { const q = portalPoint(original, e.portal); return q.x > 0 && q.z > 0 && q.x < original.width && q.z < original.depth; })!.portal;
    const q = portalPoint(original, inner);
    expect(portalAtPoint(original, q, 0.01)).toEqual(inner);
    const outer = original.entrance;
    for (const reverse of [false, true]) {
      const entrance = reverse ? outer : inner, exit = reverse ? inner : outer;
      const maze = withPortals({ ...original, entrance, exit }, [inner, outer]);
      const player = new Player(maze, new CollisionWorld([...walls(maze), ...supportColliders(maze)]));
      for (let i = 0; i < 200; i++)
        player.update(1 / 60, new Set(['KeyS']));
      expect(player.position.x).toBeCloseTo(portalPoint(maze, entrance).x);
      expect(player.position.z).toBeCloseTo(portalPoint(maze, entrance).z);
      expect(player.recorder.distance).toBeCloseTo(0);
      expect(player.finished).toBe(false);
      const points = routePoints(maze);
      for (let i = 1; i < points.length && !player.finished; i++) {
        const target = points[i]!, dx = target.x - player.position.x, dz = target.z - player.position.z;
        player.yaw = Math.atan2(-dx, -dz);
        player.update(Math.hypot(dx, dz) / 1.4, new Set(['KeyW']));
      }
      expect(player.finished).toBe(true);
      expect(player.recorder.distance).toBeCloseTo(metrics(maze).optimalLength);
      expect(deserialize(serialize(maze))).toEqual(maze);
    }
  }
});
test('transfer reserves existing portals before relocating invalid portals without duplicates', () => {
  const original = generate({ ...base, moduleSize: undefined });
  const portals = [original.entrance, original.exit, { cell: 4, side: 'north' as const }];
  const from = withPortals({ ...original, entrance: portals[2]!, exit: portals[0]! }, portals);
  const to = generate({ ...base, moduleSize: undefined, shape: { kind: 'grid-rectangles', rectangles: [rect(0, 0, 3, 5)] } });
  const moved = transferPortals(from, to), openings = mazePortals(moved);
  expect(openings[0]).toEqual(portals[0]);
  expect(openings.every(p => boundaryPortal(moved, p))).toBe(true);
  expect(new Set(openings.map(p => `${p.cell}:${p.side}`)).size).toBe(3);
  expect(samePortal(moved.entrance, openings[2]!)).toBe(true);
  expect(samePortal(moved.exit, openings[0]!)).toBe(true);
  expect(transferPortals(from, to)).toEqual(moved);
});
test('v3 rejects inactive edges, wrong versions, disconnected topology and invalid portals', () => {
  const maze = generate({ ...base, moduleSize: undefined, shape: { kind: 'grid-rectangles', rectangles: cases.ring! } });
  const tamper = (change: (m: any) => void) => { const data = JSON.parse(serialize(maze)); change(data); expect(() => deserialize(JSON.stringify(data))).toThrow(); };
  tamper(m => m.passages[6] = [7]);
  tamper(m => m.version = 2);
  tamper(m => m.parameters.shape = null);
  tamper(m => delete m.parameters.shape);
  tamper(m => m.entrance = { cell: 6, side: 'north' });
  tamper(m => { m.passages = m.passages.map(() => []); });
});
test('roof follows ring and leaves the courtyard open in both construction modes', () => {
  for (const modules of [false, true]) {
    const maze = { ...generate({ ...base, moduleSize: modules ? 2 : undefined, shape: { kind: 'grid-rectangles', rectangles: cases.ring! } }), roof: true };
    const mesh = mazeMesh(maze), roof = mesh.getObjectByName('roof');
    expect(roof).toBeInstanceOf(InstancedMesh);
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(maze.width / 2, 20, maze.depth / 2), new Vector3(0, -1, 0));
    expect(ray.intersectObject(roof!).length).toBe(0);
    const q = cellCenter(maze, domainOf(maze).cells[0]!);
    ray.set(new Vector3(q.x, 20, q.z), new Vector3(0, -1, 0));
    expect(ray.intersectObject(roof!).length).toBeGreaterThan(0);
    disposeMeshes(mesh);
  }
});
test('resizing the working grid preserves logical portal coordinates', () => {
  const from = generate({ ...base, moduleSize: undefined, shape: { kind: 'grid-rectangles', rectangles: [rect(1, 1, 3, 3)] } });
  const to = generate({ ...from.parameters, columns: 7 });
  const moved = transferPortals(from, to);
  expect(portalPoint(moved, moved.entrance)).toEqual(portalPoint(from, from.entrance));
  expect(portalPoint(moved, moved.exit)).toEqual(portalPoint(from, from.exit));
});
test('large compound modular domain stays reproducible and below the JSON size limit', () => {
  const p = { ...base, columns: 100, rows: 100, shape: { kind: 'grid-rectangles' as const, rectangles: [rect(0, 0, 100, 100), rect(20, 20, 60, 60, 'subtract')] } };
  const maze = generate(p), json = serialize(maze);
  expect(json.length).toBeLessThan(5000000);
  expect(deserialize(json)).toEqual(maze);
  expect(generate(p)).toEqual(maze);
  expect(metrics(maze).components).toBe(1);
});
