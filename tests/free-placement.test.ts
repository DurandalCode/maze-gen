import 'fake-indexeddb/auto';
import { describe, test, expect } from 'bun:test';
import { DEFAULT_CONSTRUCTION, DEFAULT_DESIGN_LIMITS, type Maze } from '../src/core/maze';
import { emptyLayout, type FreeDraft } from '../src/free/model';
import { anchorGeometry, connectionGeometry, freeMaze, freeRuntime, modulePolygon, validateFree, freeRay, physical } from '../src/free/layout';
import { distance, movementClearance, wallDistance } from '../src/free/geometry';
import { generate } from '../src/generators/generate';
import { serialize, deserialize } from '../src/persistence/maze-json';
import { decodeDraft, encodeDraft, mazeDraft } from '../src/free/json';
import { convertToFree } from '../src/free/convert';
import { routePoints } from '../src/core/pathfinding';
import { metrics } from '../src/core/metrics';
import { CollisionWorld } from '../src/simulation/collisions';
import { supportColliders, timberStructure } from '../src/core/structure';
import { walls, portalPoint } from '../src/core/maze';
import { editorReducer, history } from '../src/free/editor-state';
import { browserTopologyId } from '../src/persistence/identity';
import { recordJson, restoreRecord } from '../src/persistence/record-codec';
import { makeWalkData, validateWalk } from '../src/persistence/walk-json';
import { Recorder } from '../src/simulation/recorder';
import { Player } from '../src/simulation/player';
import { FileStore, topologyId } from '../server/store';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function fixture(gap = 2, angle = 0): FreeDraft {
  const l = emptyLayout(), r = angle * Math.PI / 180, rotate = (x: number, z: number) => ({ x: 10 + x * Math.cos(r) - z * Math.sin(r), z: 10 + x * Math.sin(r) + z * Math.cos(r) });
  l.modules = [{ id: 'a', type: '2x2', ...rotate(0, 0), angle }, { id: 'b', type: '2x2', ...rotate(2 + gap, 0), angle }];
  l.connections = [{ id: 'link', a: { room: 'a', edge: 1, offset: 0 }, b: { room: 'b', edge: 3, offset: 0 }, width: 1.4 }];
  l.openings = [{ id: 'in', room: 'a', edge: 3, offset: 0, width: 1.4 }, { id: 'out', room: 'b', edge: 1, offset: 0, width: 1.4 }];
  l.entrance = 'in';
  l.exit = 'out';
  return { kind: 'maze-lab-free-draft', version: 1, parameters: { placementMode: 'free', columns: 30, rows: 30, moduleSize: 2, corridorWidth: 2, extraConnections: 0, seed: 'free-test', algorithm: 'backtracker' }, construction: { ...DEFAULT_CONSTRUCTION }, layout: l };
}
const base = { placementMode: 'free' as const, columns: 24, rows: 16, moduleSize: 2, corridorWidth: 2, extraConnections: 2, seed: 'free-generation', algorithm: 'prim' as const };
describe('free physical geometry', () => {
  test('an opening on a distant collinear module cannot extend another module wall', () => {
    for (const angle of [0, 17, 90]) {
      const d = fixture(8, angle);
      d.layout.connections = [];
      d.layout.openings = [{ id: 'out', room: 'b', edge: 0, offset: 0, width: 1.4 }];
      const panels = physical(d.layout).panels;
      expect(panels).toHaveLength(9);
      for (const w of panels) expect(Math.hypot(w.x2 - w.x1, w.z2 - w.z1)).toBeLessThanOrEqual(2 + 1e-7);
    }
  });
  for (const angle of [17, 45, 123]) test(`arbitrary ${angle}° rotations preserve spans, portals and physical route`, () => {
    const d = fixture(3, angle);
    expect(validateFree(d)).toEqual([]);
    const g = connectionGeometry(d.layout, d.layout.connections[0]!);
    expect(distance({ x: g.sides[0]!.x1, z: g.sides[0]!.z1 }, { x: g.sides[0]!.x2, z: g.sides[0]!.z2 })).toBeCloseTo(3, 8);
    const m = freeMaze(d), world = new CollisionWorld([...walls(m), ...supportColliders(m)]), route = routePoints(m);
    expect(route.length).toBeGreaterThan(2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!, b = route[i]!;
      expect(freeRuntime(m).obstacles.every(w => movementClearance(a, b, w) >= .25 - 1e-7)).toBe(true);
      const moved = world.move(a, { x: b.x - a.x, z: b.z - a.z });
      expect(distance(moved, b)).toBeLessThan(1e-5);
    }
    expect(metrics(m).cycles).toBe(0);
  });
  for (const gap of [2.999, 3, 3.001]) test(`span ${gap} m uses actual length`, () => {
    expect(validateFree(fixture(gap, 45)).some(i => i.code === 'span')).toBe(gap > 3);
  });
  test('a module six-metre rail is allowed without intermediate posts', () => {
    const d = fixture();
    d.layout.modules = [{ id: 'a', type: '2x6', x: 10, z: 10, angle: 17 }];
    d.layout.connections = [];
    d.layout.openings[1]!.room = 'a';
    expect(validateFree(d)).toEqual([]);
    const m = freeMaze(d);
    expect(timberStructure(m).posts.length).toBe(8);
    expect(modulePolygon(d.layout.modules[0]!)).toHaveLength(4);
  });
  test('intersections, disconnected rooms, holes and narrow openings reject readiness', () => {
    const d = fixture();
    d.layout.modules[1]!.x = 10;
    expect(validateFree(d).some(i => i.code === 'overlap')).toBe(true);
    const disconnected = fixture();
    disconnected.layout.connections = [];
    expect(validateFree(disconnected).some(i => i.code === 'disconnected')).toBe(true);
    const hole = fixture();
    hole.parameters.shape = { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: 30, height: 30, operation: 'add' }, { x: 9.7, z: 9.7, width: .6, height: .6, operation: 'subtract' }] };
    expect(validateFree(hole).some(i => i.code === 'outside')).toBe(true);
    const narrow = fixture();
    narrow.layout.connections[0]!.width = .9;
    expect(validateFree(narrow).some(i => i.code === 'anchor')).toBe(true);
  });
  test('oblique collision uses oriented wall rather than its bounding rectangle', () => {
    const w = { x1: 0, z1: 0, x2: 4, z2: 4 };
    expect(wallDistance({ x: 0, z: 4 }, w)).toBeGreaterThan(2);
    const world = new CollisionWorld([w]);
    expect(world.blocked({ x: 0, z: 4 })).toBe(false);
    expect(world.blocked({ x: 2, z: 2 })).toBe(true);
    expect(movementClearance({ x: 0, z: 4 }, { x: 4, z: 0 }, w)).toBe(0);
  });
  test('diagonal sight hits real wall, not its axis bounding box', () => {
    const m = freeMaze(fixture(2, 45));
    const start = freeRuntime(m).centers[0]!;
    expect(freeRay(m, start, 45 * Math.PI / 180, 30)).toBeGreaterThan(4);
  });
  test('manual wall splitting a required room makes map unplayable', () => {
    const d = fixture();
    d.layout.walls.push({ id: 'cut', x1: 10, z1: 9, x2: 10, z2: 11 });
    expect(validateFree(d).some(i => i.code === 'clearance')).toBe(true);
  });
  test('player starts facing inward and can finish through an oblique exit', () => {
    const m = freeMaze(fixture(2, 45)), world = new CollisionWorld([...walls(m), ...supportColliders(m)]), player = new Player(m, world), exit = portalPoint(m, m.exit);
    player.position = exit;
    player.updateAnalog(.01, 0, 0);
    expect(player.finished).toBe(true);
  });
});
describe('free generation, editing and persistence', () => {
  for (const generationType of ['classical', 'living', 'corridor'] as const) test(`${generationType}: mixed modules, deterministic valid topology and cycles`, () => {
    const a = generate({ ...base, generationType }), b = generate({ ...base, generationType });
    expect(serialize(a)).toBe(serialize(b));
    expect(new Set(a.free!.modules.map(m => m.type)).size).toBe(2);
    expect(new Set(a.free!.modules.map(m => m.angle)).size).toBeGreaterThan(1);
    expect(metrics(a).cycles).toBe(2);
    expect(validateFree(mazeDraft(a))).toEqual([]);
  });
  test('impossible request fails without modifying previous map', () => {
    const old = generate(base), before = serialize(old);
    expect(() => generate({ ...base, columns: 2, rows: 2 }, old)).toThrow();
    expect(serialize(old)).toBe(before);
  });
  test('v5 roundtrip rebuilds derived data and keeps environment', () => {
    const m = generate(base);
    m.environment = { sun: { day: 10, minutes: 720 }, forest: { side: 'north', distance: 20, offset: 0 } };
    const text = serialize(m), raw = JSON.parse(text);
    expect(raw.version).toBe(5);
    expect(raw.passages).toBeUndefined();
    expect(raw.layout.modules.length).toBeGreaterThan(0);
    expect(serialize(deserialize(text))).toBe(text);
  });
  test('invalid drafts survive export/import but are not accepted as maps', () => {
    const d = fixture();
    d.layout.connections = [];
    expect(decodeDraft(encodeDraft(d))).toEqual(d);
    expect(() => freeMaze(d)).toThrow();
    const raw = JSON.parse(serialize(freeMaze(fixture())));
    raw.layout.connections = [];
    expect(() => deserialize(JSON.stringify(raw))).toThrow();
  });
  test('moving a module keeps its anchored opening; undo and redo restore document', () => {
    const d = fixture(), original = anchorGeometry(d.layout, d.layout.openings[0]!, 1.4).mid, next = structuredClone(d);
    next.layout.modules[0]!.angle = 17;
    next.layout.modules[0]!.x += 1;
    const moved = anchorGeometry(next.layout, next.layout.openings[0]!, 1.4).mid;
    expect(moved).not.toEqual(original);
    let h = editorReducer(history(d), { type: 'change', draft: next });
    h = editorReducer(h, { type: 'undo' });
    expect(h.present).toEqual(d);
    h = editorReducer(h, { type: 'redo' });
    expect(h.present).toEqual(next);
    expect(d.layout.modules[0]!.angle).toBe(0);
  });
  test('legacy modular conversion preserves physical walls and does not mutate source', () => {
    const old = generate({ columns: 3, rows: 3, corridorWidth: 2, moduleSize: 2, extraConnections: 0, seed: 'legacy', algorithm: 'prim' }), before = serialize(old), d = convertToFree(old);
    expect(d.layout.preservedPanels).toEqual(walls(old));
    expect(validateFree(d)).toEqual([]);
    const copy = freeMaze(d);
    expect(walls(copy)).toEqual(walls(old));
    expect(serialize(old)).toBe(before);
    expect(copy.width).toBe(old.width);
  });
  test('browser/server identities and record codecs agree', async () => {
    const m = generate(base);
    expect(await browserTopologyId(m)).toBe(topologyId(m));
    const restored = restoreRecord(JSON.parse(recordJson({ maze: m }))) as { maze: Maze };
    expect(serialize(restored.maze)).toBe(serialize(m));
    const changed = mazeDraft(m);
    changed.layout.modules[0]!.angle += .1;
    expect(await browserTopologyId(freeMaze(changed, false))).not.toBe(await browserTopologyId(m));
  });
  test('server library and walk codecs accept v5', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-library-'));
    try {
      const m = freeMaze(fixture()), store = new FileStore(dir), saved = await store.saveMaze(m);
      expect((await store.getMaze(saved.id))!.maze.version).toBe(5);
      const recorder = new Recorder(portalPoint(m, m.entrance));
      recorder.record(routePoints(m)[1]!, 1, true);
      const walk = makeWalkData(m, recorder, 'free-walk', false, 'stopped');
      expect(validateWalk(walk).maze.version).toBe(5);
      const row = await store.saveWalk(walk);
      expect(row.assessment.optimalLength).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('constraints remain serialized in the free document', () => {
    const d = fixture();
    d.parameters.design = { ...DEFAULT_DESIGN_LIMITS };
    const round = decodeDraft(encodeDraft(d));
    expect(round.parameters.design).toEqual(DEFAULT_DESIGN_LIMITS);
  });
});
describe('free compatibility and physical invariants', () => {
  test('v4 conversion collapses navigation cuts and preserves cycle count', () => {
    const old = generate({ generationType: 'corridor', columns: 16, rows: 12, moduleSize: 2, corridorWidth: 2, extraConnections: 1, seed: 'convert-v4', algorithm: 'prim' }), draft = convertToFree(old);
    expect(validateFree(draft)).toEqual([]);
    const next = freeMaze(draft);
    expect(walls(next)).toEqual(walls(old));
    expect(metrics(next).cycles).toBe(metrics(old).cycles);
    expect(serialize(deserialize(serialize(next)))).toBe(serialize(next));
  });
  test('a custom square module retains its physical size', () => {
    const old = generate({ columns: 2, rows: 2, moduleSize: 2.5, corridorWidth: 2, extraConnections: 0, seed: 'custom-size', algorithm: 'prim' }), d = convertToFree(old);
    expect(d.layout.modules.every(m => m.type === 'custom' && m.width === 2.5 && m.depth === 2.5)).toBe(true);
    expect(validateFree(d)).toEqual([]);
  });
  test('overlapping additive site rectangles do not create forbidden internal boundaries', () => {
    const d = fixture();
    d.parameters.shape = { kind: 'grid-rectangles', rectangles: [{ x: 0, z: 0, width: 30, height: 30, operation: 'add' }, { x: 9, z: 9, width: 2, height: 2, operation: 'add' }] };
    expect(validateFree(d)).toEqual([]);
  });
  test('a skew connection checks both side spans, not its centreline', () => {
    const d = fixture(3);
    d.layout.modules[1]!.angle = 10;
    const g = connectionGeometry(d.layout, d.layout.connections[0]!);
    expect(distance(g.a.mid, g.b.mid)).toBeLessThan(3.03);
    expect(validateFree(d).some(i => i.code === 'span')).toBe(true);
  });
  test('near-parallel walls and straight visibility at an external opening remain bounded', () => {
    const m = freeMaze(fixture(2, 17));
    expect(freeRay(m, freeRuntime(m).centers[0]!, 17 * Math.PI / 180, 100)).toBeLessThan(10);
    const wall = { x1: 0, z1: 0, x2: 4, z2: .000001 };
    expect(movementClearance({ x: 0, z: 1 }, { x: 4, z: 1 }, wall)).toBeGreaterThan(.9);
  });
  test('algorithms choose different reproducible classical trees', () => {
    expect(generate({ ...base, algorithm: 'prim' }).passages).not.toEqual(generate({ ...base, algorithm: 'backtracker' }).passages);
  });
  test('room weights include physical connecting passages', async () => {
    const { freeAreaWeights } = await import('../src/free/analysis-geometry');
    const { analyzeFree } = await import('../src/free/quality');
    const m = freeMaze(fixture()), weights = freeAreaWeights(m);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(metrics(m).area, 8);
    const a = analyzeFree(m, 16);
    expect(a.finishedRatio).toBe(1);
    expect(a.coldAreaRatio).toBe(0);
    expect([...a.probability]).toEqual([1, 1]);
  });
  test('offline v5 library, export and first-walk preparation restore geometry', async () => {
    const modulePath = '../src/persistence/offline-library.ts?free-placement-test';
    const { saveOfflineMaze, offlineRequest } = await import(modulePath) as typeof import('../src/persistence/offline-library');
    const { validateLibraryExport } = await import('../src/persistence/library-export');
    const m = freeMaze(fixture()), saved = await saveOfflineMaze(m, 'Free placement test');
    expect(saved.maze.version).toBe(5);
    const read = await offlineRequest('/api/mazes/' + saved.id) as { maze: Maze };
    expect(serialize(read.maze)).toBe(serialize(m));
    const prepared = await offlineRequest('/api/prepare-walk', { maze: m }) as { maze: Maze; roofEnforced: boolean };
    expect(prepared.maze.version).toBe(5);
    expect(prepared.roofEnforced).toBe(true);
    const exported = validateLibraryExport(JSON.parse(recordJson({ kind: 'maze-lab-library-export', version: 1, mazes: [{ title: 'Free', maze: m }], walks: [] })));
    expect(exported.mazes[0]!.maze.version).toBe(5);
  }, 60_000); // First access also seeds the larger built-in free-placement maps.
  test('schema rejects malformed anchors and derived navigation cannot override geometry', () => {
    const raw = JSON.parse(serialize(freeMaze(fixture())));
    raw.passages = [[], []];
    expect(deserialize(JSON.stringify(raw)).passages).toEqual([[1], [0]]);
    raw.layout.connections[0].a = null;
    expect(() => deserialize(JSON.stringify(raw))).toThrow();
  });
});
describe('strongly non-orthogonal junctions', () => {
  for (const degree of [3, 5] as const) test(`${degree}-way junction is physical, traversable, saved and clearly rotated`, () => {
    const maze = generate({ ...base, extraConnections: 0, seed: `strong-${degree}`, freeJunctionDegree: degree, freeAngleSpread: 100 });
    const runtime = freeRuntime(maze), hub = runtime.rooms.findIndex(r => r.id === `junction-${degree}`);
    expect(hub).toBeGreaterThanOrEqual(0);
    expect(maze.passages[hub]).toHaveLength(degree);
    expect(validateFree(mazeDraft(maze))).toEqual([]);
    const bends = maze.free!.connections.map(c => {
      const g = connectionGeometry(maze.free!, c);
      return Math.acos(Math.max(-1, Math.min(1, -g.a.normal.x * g.b.normal.x - g.a.normal.z * g.b.normal.z))) * 180 / Math.PI;
    });
    expect(Math.max(...bends)).toBeGreaterThan(25);
    expect(maze.free!.modules.some(m => m.type === '2x6')).toBe(true);
    expect(deserialize(serialize(maze)).parameters.freeJunctionDegree).toBe(degree);
    const world = new CollisionWorld([...walls(maze), ...supportColliders(maze)]), path = routePoints(maze);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      expect(distance(world.move(a, { x: b.x - a.x, z: b.z - a.z }), b)).toBeLessThan(1e-5);
    }
    if (degree === 5) {
      const directions = maze.free!.connections.filter(c => c.a.room === 'junction-5' || c.b.room === 'junction-5').map(c => {
        const g = connectionGeometry(maze.free!, c), a = c.a.room === 'junction-5' ? g.a : g.b, b = c.a.room === 'junction-5' ? g.b : g.a;
        return (Math.atan2(b.mid.z - a.mid.z, b.mid.x - a.mid.x) * 180 / Math.PI + 360) % 360;
      }).sort((a, b) => a - b);
      for (let i = 0; i < 5; i++)expect((directions[(i + 1) % 5]! - directions[i]! + 360) % 360).toBeCloseTo(72, 6);
    }
  });
  test('default free layout combines a five-way junction and real three-way module forks', () => {
    const m = generate({ ...base, extraConnections: 0, seed: 'mixed-strong' });
    expect(m.passages.some(p => p.length === 5)).toBe(true);
    expect(m.free!.modules.some(module => {
      const room = freeRuntime(m).rooms.findIndex(r => r.id === module.id);
      return m.passages[room]!.length === 3;
    })).toBe(true);
  });
  test('spread control changes geometry and invalid junction settings reject explicitly', () => {
    const m = generate({ ...base, extraConnections: 0, freeAngleSpread: 0, freeJunctionDegree: 5 });
    for (const c of m.free!.connections) {
      const g = connectionGeometry(m.free!, c);
      expect(g.a.normal.x * g.b.normal.x + g.a.normal.z * g.b.normal.z).toBeCloseTo(-1, 6);
    }
    expect(() => generate({ ...base, freeAngleSpread: 121 })).toThrow('Разброс');
    expect(() => generate({ ...base, freeJunctionDegree: 4 as 3 })).toThrow('Перекрёсток');
  });
});

test('a partition immediately behind an entrance cannot leave a valid but blocked portal route', () => {
  const d = fixture();
  d.layout.walls = [{id:'blocked-entry',x1:9.01,z1:9,x2:9.01,z2:11}];
  expect(validateFree(d).some(i=>i.code==='clearance')).toBe(true);
  const m=freeMaze(d,false);
  expect(routePoints(m)).toEqual([]);
});

test('a concave hall with its vertex centroid outside still has usable navigation and roundtrips', () => {
  const d=fixture();
  d.layout.modules=d.layout.modules.slice(0,1);
  d.layout.spaces=[{id:'hall',kind:'hall',polygon:[{x:13,z:9},{x:19,z:9},{x:19,z:11},{x:15,z:11},{x:15,z:15},{x:13,z:15}]}];
  d.layout.connections=[{id:'link',a:{room:'a',edge:1,offset:0},b:{room:'hall',edge:5,offset:2},width:1.4}];
  d.layout.openings[1]={id:'out',room:'hall',edge:1,offset:0,width:1.4};
  d.layout.supports=[{x:16,z:9},{x:17,z:11},{x:15,z:13},{x:13,z:12}];
  expect(validateFree(d)).toEqual([]);
  const maze=freeMaze(d),restored=deserialize(serialize(maze)),route=routePoints(restored);
  expect(route.length).toBeGreaterThan(2);
  const world=new CollisionWorld([...walls(restored),...supportColliders(restored)]);
  for(let i=1;i<route.length;i++){
    const a=route[i-1]!,b=route[i]!;
    expect(distance(world.move(a,{x:b.x-a.x,z:b.z-a.z}),b)).toBeLessThan(1e-5);
  }
});
