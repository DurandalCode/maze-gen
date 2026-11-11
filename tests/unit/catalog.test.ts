import { expect, test } from 'bun:test';
import {
  controlCatalog,
  expandDefinition,
  instantiate,
  instanceBoundary,
  validateCatalogDefinition,
  withCatalog,
} from '../../src/catalog/catalog';
import { createDefinition, emptyDocument, normalizeDocument } from '../../src/domain';

const catalog = controlCatalog();
test('four control definitions are immutable versioned data and round-trip', () => {
  expect(catalog.map((d) => d.id)).toEqual([
    'square-2x2',
    'rectangle-2x6',
    'triangle-4',
    'circle-2',
  ]);
  for (const d of catalog) {
    expect(validateCatalogDefinition(d)).toEqual(d);
    expect(expandDefinition(d)).toEqual(d.boundaryLoops);
  }
});
test('parameters affect contours without changing the definition', () => {
  const d = catalog[0]!,
    before = JSON.stringify(d),
    loops = expandDefinition(d, { width: 4, depth: 8 });
  expect(loops[0]!.segments[0]).toEqual({
    id: 'edge-0',
    kind: 'line',
    from: { x: -2, z: -4 },
    to: { x: 2, z: -4 },
  });
  expect(JSON.stringify(d)).toBe(before);
});
test('triangle has analytical side lengths and circle preserves analytic arc', () => {
  for (const s of expandDefinition(catalog[2]!)[0]!.segments) {
    if (s.kind !== 'line') throw new Error();
    expect(Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z)).toBeCloseTo(4, 5);
  }
  expect(expandDefinition(catalog[3]!)[0]!.segments[0]).toMatchObject({
    kind: 'arc',
    radius: 2,
    sweep: 6.283185307,
  });
});
test('transform belongs to instance, including arc orientation', () => {
  const d = withCatalog(emptyDocument('map')),
    i = instantiate(catalog[3]!, 'circle', { x: 10, z: 4 }, Math.PI / 2);
  const arc = instanceBoundary(d, i)[0]!.segments[0]!;
  expect(arc.kind).toBe('arc');
  if (arc.kind === 'arc') {
    expect(arc.center).toEqual({ x: 10, z: 4 });
    expect(arc.startAngle).toBe(Math.PI / 2);
  }
  expect(catalog[3]!.boundaryLoops[0]!.segments[0]).toMatchObject({ center: { x: 0, z: 0 } });
});
test('explicitLoops adds a new shape without a new catalog-specific branch', () => {
  const { contentHash: _, ...base } = catalog[0]!;
  const d = createDefinition({
    ...base,
    id: 'explicit',
    builder: { kind: 'explicitLoops' },
    parameters: [],
  });
  expect(expandDefinition(d)).toEqual(base.boundaryLoops);
});
test('unknown builders, unsupported versions, and contradictory default boundary fail', () => {
  const d = catalog[0]!;
  expect(() => expandDefinition({ ...d, builder: { kind: 'custom-code' } })).toThrow();
  const { contentHash: _, ...payload } = d;
  const bad = createDefinition({ ...payload, boundaryLoops: catalog[1]!.boundaryLoops });
  expect(() => validateCatalogDefinition(bad)).toThrow('Default contour');
  expect(() =>
    normalizeDocument({ ...withCatalog(emptyDocument('m')), definitions: [{ ...d, version: 0 }] }),
  ).toThrow();
});
