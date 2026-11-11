import { expect, test } from 'bun:test';
import { CommandStore, removal, snapped } from '../../src/editor/commands';
import { canonical, documentHashes, navHash, worldHash } from '../../src/domain';
import { twoRooms } from '../helpers/maps';
import { m50 } from '../fixtures/factory';
const identity = (store: CommandStore) => documentHashes(store.getSnapshot().document);
test('E-01: a hundred inverse patches undo and redo exact geometry while command revisions remain monotone', () => {
  const store = new CommandStore(twoRooms()),
    before = identity(store);
  for (let i = 0; i < 100; i++) {
    const instance = store.getSnapshot().document.instances[0]!;
    store.execute('Move', [
      {
        field: 'instances',
        id: instance.id,
        value: { ...instance, position: { x: 10 + (i + 1) / 10, z: 10 } },
      },
    ]);
  }
  const after = identity(store),
    revision = store.getSnapshot().document.revision;
  expect(store.historyStats().undo).toBe(100);
  expect(store.historyStats().patches).toBe(100);
  for (let i = 0; i < 100; i++) expect(store.undo()).toBe(true);
  expect(identity(store)).toEqual(before);
  expect(store.getSnapshot().document.revision).toBe(revision + 100);
  for (let i = 0; i < 100; i++) expect(store.redo()).toBe(true);
  expect(identity(store)).toEqual(after);
  expect(store.getSnapshot().geometryRevision).toBe(300);
});
test('E-01: bounded history stores changed entities, not documents; branch clears redo', () => {
  const source = m50();
  source.metadata.title = 'x'.repeat(200);
  const store = new CommandStore(source);
  for (let i = 0; i < 105; i++) {
    const instance = store.getSnapshot().document.instances[0]!;
    store.execute('Move', [
      {
        field: 'instances',
        id: instance.id,
        value: { ...instance, position: { x: 10 + (i + 1) / 10, z: 10 } },
      },
    ]);
  }
  const stats = store.historyStats();
  expect(stats.undo).toBe(100);
  expect(stats.bytes).toBeLessThan(canonical(source).length);
  for (let i = 0; i < 100; i++) store.undo();
  expect(store.getSnapshot().document.instances[0]!.position.x).toBe(10.5);
  expect(store.undo()).toBe(false);
  store.redo();
  const d = store.getSnapshot().document;
  store.execute('Name', [{ field: 'metadata', value: { ...d.metadata, title: 'Branch' } }]);
  expect(store.redo()).toBe(false);
  expect(store.historyStats().redo).toBe(0);
});
test('selection and metadata never invalidate navigation; environment changes only the visual revision', () => {
  const store = new CommandStore(twoRooms()),
    initial = identity(store);
  const beforeNav = navHash(worldHash(initial.layoutHash), 0.25);
  store.select({ field: 'instances', id: 'a' });
  expect(store.historyStats().undo).toBe(0);
  const d = store.getSnapshot().document;
  store.execute('Name', [{ field: 'metadata', value: { ...d.metadata, title: 'Renamed' } }]);
  store.execute('Color', [
    { field: 'environment', value: { ...d.environment, wallColor: '#3f7157' } },
  ]);
  const current = store.getSnapshot();
  expect(current.geometryRevision).toBe(0);
  expect(current.visualRevision).toBe(1);
  expect(current.metadataRevision).toBe(1);
  expect(identity(store).layoutHash).toBe(initial.layoutHash);
  expect(identity(store).revisionHash).not.toBe(initial.revisionHash);
  expect(navHash(worldHash(identity(store).layoutHash), 0.25)).toBe(beforeNav);
  store.undo();
  expect(identity(store)).toEqual(initial);
  store.undo();
  expect(store.getSnapshot().document.metadata.title).toBe(d.metadata.title);
});
test('one drag is one command: pointer previews neither mutate the document nor trigger physical revisions', () => {
  const store = new CommandStore(twoRooms()),
    original = store.getSnapshot().document;
  store.beginGesture('a');
  for (let i = 0; i < 1000; i++)
    store.previewTransform({ position: { x: 10 + i / 100, z: 10 }, rotationRad: i / 1000 });
  expect(store.getSnapshot().document).toBe(original);
  expect(store.getSnapshot().geometryRevision).toBe(0);
  expect(store.historyStats().undo).toBe(0);
  store.endGesture();
  expect(store.historyStats().undo).toBe(1);
  expect(store.getSnapshot().geometryRevision).toBe(1);
  expect(store.getSnapshot().document.instances.find((i) => i.id === 'a')!.position.x).toBe(19.99);
  store.undo();
  expect(identity(store)).toEqual(documentHashes(original));
  store.beginGesture('a');
  store.previewTransform({ position: { x: 20, z: 20 }, rotationRad: 0 });
  store.cancelGesture();
  expect(store.getSnapshot().document.instances.find((i) => i.id === 'a')!.position).toEqual({
    x: 10,
    z: 10,
  });
});
test('schema failure is atomic, immutable state rejects mutation, physical invalidity remains editable', () => {
  const store = new CommandStore(twoRooms()),
    initial = store.getSnapshot();
  const a = initial.document.instances[0]!;
  expect(() =>
    store.execute('NaN', [
      { field: 'instances', id: a.id, value: { ...a, position: { x: NaN, z: 0 } } },
    ]),
  ).toThrow();
  expect(store.getSnapshot()).toBe(initial);
  expect(store.historyStats().undo).toBe(0);
  expect(() => {
    initial.document.instances[0]!.position.x = 90;
  }).toThrow();
  store.execute('Invalid physical draft', [
    { field: 'instances', id: a.id, value: { ...a, position: { x: -50, z: -50 } } },
  ]);
  expect(store.getSnapshot().document.instances[0]!.position.x).toBe(-50);
  store.undo();
  expect(identity(store)).toEqual(documentHashes(initial.document));
});
test('deleting a module atomically removes owned openings and referenced connections; undo restores stable IDs', () => {
  const store = new CommandStore(twoRooms()),
    before = identity(store);
  store.select({ field: 'instances', id: 'a' });
  store.execute('Delete', removal(store.getSnapshot().document, store.getSnapshot().selection!));
  expect(store.getSnapshot().selection).toBeNull();
  expect(store.getSnapshot().document.connections).toEqual([]);
  expect(store.getSnapshot().document.openings.every((op) => op.instanceId === 'b')).toBe(true);
  store.undo();
  expect(identity(store)).toEqual(before);
});
test('snap defaults can stay off; enabled uses 0.1 m and 15 degrees', () => {
  const transform = { position: { x: 1.234, z: -2.36 }, rotationRad: 0.23 };
  expect(snapped(transform, false)).toEqual(transform);
  const on = snapped(transform, true);
  expect(on.position.x).toBeCloseTo(1.2, 8);
  expect(on.position.z).toBeCloseTo(-2.4, 8);
  expect(on.rotationRad).toBeCloseTo(Math.PI / 12, 10);
});

import {
  planModel,
  hitPlan,
  previewRings,
  nearestBoundary,
  transformPoint,
} from '../../src/editor/plan';
import { controlCatalog, instantiate } from '../../src/catalog/catalog';
import { emptyDocument, normalizeDocument } from '../../src/domain';
import { obstacleRoom } from '../helpers/maps';
test('E-02: circle and triangle hit testing respects shape, rotation and holes instead of bounding boxes', () => {
  const document = emptyDocument('shapes'),
    catalog = controlCatalog();
  document.definitions = catalog;
  document.instances = [
    instantiate(catalog[3]!, 'circle', { x: 5, z: 5 }),
    instantiate(catalog[2]!, 'triangle', { x: 15, z: 15 }, 0.7),
  ];
  const model = planModel(document);
  expect(hitPlan(model, document, { x: 5, z: 5 }, 0.01)).toEqual({
    field: 'instances',
    id: 'circle',
  });
  expect(hitPlan(model, document, { x: 6.8, z: 6.8 }, 0.01)).toBeNull();
  const triangle = document.instances[1]!;
  expect(hitPlan(model, document, transformPoint({ x: 0, z: 0 }, triangle), 0.01)).toEqual({
    field: 'instances',
    id: 'triangle',
  });
  expect(hitPlan(model, document, transformPoint({ x: 1.9, z: 1.9 }, triangle), 0.01)).toBeNull();
  const withHole = obstacleRoom(true),
    holeModel = planModel(withHole);
  expect(hitPlan(holeModel, withHole, { x: 14, z: 14 }, 0.01)).toBeNull();
  expect(hitPlan(holeModel, withHole, { x: 11, z: 11 }, 0.01)).toEqual({
    field: 'instances',
    id: 'room',
  });
});
test('contour cache reuses unmodified module geometry; transform preview does not rebuild it', () => {
  const document = twoRooms(),
    first = planModel(document),
    next = structuredClone(document);
  next.instances[0]!.position.x += 1;
  const second = planModel(next, first);
  expect(second.modules.get('b')!.rings).toBe(first.modules.get('b')!.rings);
  expect(second.modules.get('a')!.local).toBe(first.modules.get('a')!.local);
  const store = new CommandStore(document);
  store.beginGesture('a');
  store.previewTransform({ position: { x: 20, z: 20 }, rotationRad: Math.PI / 2 });
  const preview = previewRings(first.modules.get('a')!, store.getSnapshot().gesture);
  expect(preview[0]!.points[0]).toEqual({ x: 21, z: 19 });
  expect(first.modules.get('a')!.rings[0]!.points[0]).toEqual({ x: 9, z: 9 });
});
test('stable opening parameters follow transformed and resized boundary segments', () => {
  const document = twoRooms(),
    base = planModel(document);
  const next = structuredClone(document);
  next.instances[0]!.rotationRad = Math.PI / 2;
  next.instances[0]!.parameterValues.width = 4;
  const changed = planModel(normalizeDocument(next), base);
  const entrance = changed.openings.get('entrance')!;
  expect(entrance.opening.boundarySegmentId).toBe('edge-3');
  expect(entrance.center.x).toBeCloseTo(10, 7);
  expect(entrance.center.z).toBeCloseTo(8, 7);
  expect(entrance.error).toBeNull();
  expect(
    Math.hypot(entrance.end.x - entrance.start.x, entrance.end.z - entrance.start.z),
  ).toBeCloseTo(1.4, 7);
  const circleDoc = emptyDocument('arc');
  circleDoc.definitions = [controlCatalog()[3]!];
  circleDoc.instances = [instantiate(circleDoc.definitions[0]!, 'circle', { x: 10, z: 10 })];
  const module = planModel(circleDoc).modules.get('circle')!;
  const nearest = nearestBoundary(module, { x: 10, z: 13 })!;
  expect(nearest.segment.kind).toBe('arc');
  expect(nearest.u).toBeCloseTo(0.25, 8);
  expect(nearest.point).toEqual({ x: 10, z: 12 });
});
