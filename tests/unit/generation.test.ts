import { expect, test } from 'bun:test';
import { defaultRequest, normalizeRequest, requestHash } from '../../src/generation/request';
import { localSlots } from '../../src/generation/slots';
import { controlCatalog, instantiate } from '../../src/catalog/catalog';
import { PHYSICAL_V1, emptyDocument } from '../../src/domain';

test('GN-01: canonical request separates watchdog, request transport, and variant count from deterministic work', () => {
  const a = normalizeRequest(defaultRequest('a', 'seed'));
  const b = normalizeRequest({
    ...structuredClone(a),
    requestId: 'b',
    requestedVariants: 8,
    budgets: { ...a.budgets, watchdogMs: 300_000 },
  });
  expect(requestHash(a)).toBe(requestHash(b));
  b.budgets.placementChecksPerVariant--;
  expect(requestHash(a)).not.toBe(requestHash(b));
  expect(normalizeRequest(JSON.parse(JSON.stringify(a)))).toEqual(a);
});
test('GN-01: unknown, nonfinite, incompatible and excessive requests reject without weakening constraints', () => {
  const a = defaultRequest('a', 'seed');
  for (const patch of [
    { requestedVariants: 9 },
    { unknown: true },
    { generatorVersion: 'future' },
    { budgets: { ...a.budgets, placementChecksPerVariant: 50_001 } },
    { topology: { mode: 'cyclic', extraConnections: 0 } },
    { allocation: { ...a.allocation, minModules: 2001 } },
    { catalogSnapshots: [{ ...a.catalogSnapshots[0], weight: NaN }] },
  ])
    expect(() => normalizeRequest({ ...a, ...patch })).toThrow();
  expect(() =>
    normalizeRequest({
      ...a,
      terminals: { mode: 'fixed', entrance: { x: 25, z: 25 }, exit: { x: 50, z: 25 } },
    }),
  ).toThrow('границе');
});
test('GN-02: generic slots support triangle, circle and renamed definitions through the same algorithm', () => {
  for (const definition of controlCatalog()) {
    const slots = localSlots(definition, { ...PHYSICAL_V1 });
    expect(slots.length).toBeGreaterThanOrEqual(3);
    expect(slots.every((s) => s.physical.clearWidthM >= 1)).toBe(true);
    for (const slot of slots)
      expect(Math.hypot(slot.physical.normal.x, slot.physical.normal.z)).toBeCloseTo(1, 8);
  }
});

import { generate, generateSync } from '../../src/generation/generate';
import { compileGeometry } from '../../src/geometry/compile/compile';
import { buildNavigation } from '../../src/navigation/navmesh';
import { mixedFixture } from '../fixtures/factory';
import { diversityHash, runMetrics } from '../../src/generation/metrics';
import { documentHashes, normalizeDocument, variantSeed } from '../../src/domain';

function smallRequest() {
  const r = defaultRequest('test', 'test-seed');
  r.placement = { mode: 'orthogonal', baseRotationRad: 0 };
  r.topology = { mode: 'tree', extraConnections: 0 };
  r.allocation = { mode: 'module-budget', minModules: 4, maxModules: 8, caps: {} };
  r.requestedVariants = 1;
  r.budgets.attemptsPerVariant = 2;
  return r;
}
test('GEN-01/02: variant hash is independent of requested count and repeated runs; tree is physically connected', () => {
  const r = smallRequest(),
    one = generateSync(r),
    two = generateSync({ ...r, requestedVariants: 2 });
  expect(one.status).toBe('complete');
  expect(two.variants[0]!.revisionHash).toBe(one.variants[0]!.revisionHash);
  expect(generateSync(r).variants[0]!.revisionHash).toBe(one.variants[0]!.revisionHash);
  const v = one.variants[0]!;
  expect(v.manifest.variantSeed).toBe(
    variantSeed(r.seed, r.generatorVersion, 0, v.manifest.attemptIndex),
  );
  expect(v.document.instances).toHaveLength(8);
  expect(v.document.connections).toHaveLength(7);
  expect(v.metrics.cycles).toBe(0);
  expect(v.metrics.components).toBe(1);
  const c = compileGeometry(v.document);
  expect(c.ok).toBe(true);
  if (c.ok) expect(buildNavigation(c.snapshot).ok).toBe(true);
});
test('GEN-03: mixed circle/triangle placements share generic growth, honor caps, and free rotations stay continuous', () => {
  const r = smallRequest();
  r.seed = 'mixed-control';
  r.placement.mode = 'free';
  r.catalogSnapshots = controlCatalog()
    .slice(2)
    .map((definition) => ({ definition, weight: 1 }));
  r.allocation.maxModules = 6;
  r.allocation.minModules = 3;
  r.constraints.maxStraightM = null;
  r.constraints.maxForcedM = null;
  r.budgets.attemptsPerVariant = 4;
  const result = generateSync(r);
  expect(result.status).toBe('complete');
  const v = result.variants[0]!;
  expect(new Set(v.document.instances.map((i) => i.definitionHash)).size).toBe(2);
  expect(
    v.document.instances.some(
      (i) =>
        Math.abs(i.rotationRad / (Math.PI / 2) - Math.round(i.rotationRad / (Math.PI / 2))) > 0.01,
    ),
  ).toBe(true);
  expect(v.metrics.components).toBe(1);
});
test('GEN-04/06: bounded failure and target-not-met never silently satisfy hard requirements', () => {
  const r = smallRequest();
  r.allocation.mode = 'site';
  r.constraints.coverageTarget = 0.99;
  r.budgets.attemptsPerVariant = 1;
  const soft = generateSync(r);
  expect(soft.status).toBe('exhausted');
  expect(soft.variants[0]!.status).toBe('target-not-met');
  const hard = generateSync({ ...r, constraints: { ...r.constraints, hardCoverage: true } });
  expect(hard.status).toBe('exhausted');
  expect(hard.variants).toHaveLength(0);
  expect(hard.diagnostics[0]!.code).toBe('COVERAGE_LIMIT');
  const tiny = smallRequest();
  tiny.budgets.placementChecksPerVariant = 1;
  const failed = generateSync(tiny);
  expect(failed.status).toBe('exhausted');
  expect(failed.variants).toHaveLength(0);
  expect(failed.diagnostics[0]!.code).toMatch(/NO_ROOT|MIN_MODULES/);
});
test('GEN-07: physical run lengths include long room interiors rather than only short connection edges', () => {
  const doc = mixedFixture(),
    c = compileGeometry(doc);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  const n = buildNavigation(c.snapshot);
  expect(n.ok).toBe(true);
  if (!n.ok) return;
  const runs = runMetrics(n.snapshot);
  expect(runs.maxForcedM).toBeGreaterThan(9);
  expect(runs.maxForcedM).toBeGreaterThan(
    n.snapshot.semantic.edges.reduce((v, e) => v + e.lengthM, 0),
  );
});
test('normalized diversity ignores IDs, metadata, seed and absolute translation', () => {
  const a = mixedFixture(),
    b = structuredClone(a),
    offset = { x: 2, z: 3 };
  const move = (p: { x: number; z: number }) => ({ x: p.x + offset.x, z: p.z + offset.z });
  b.documentId = 'renamed';
  b.metadata.title = 'other';
  b.instances.forEach((i) => {
    const old = i.id;
    i.id = 'new-' + old;
    i.position = move(i.position);
    b.openings.filter((o) => o.instanceId === old).forEach((o) => (o.instanceId = i.id));
  });
  b.openings.forEach((o) => {
    const old = o.id;
    o.id = 'new-' + old;
    b.connections.forEach((c) => {
      if (c.openingA === old) c.openingA = o.id;
      if (c.openingB === old) c.openingB = o.id;
    });
  });
  b.connections.forEach((c) => (c.id = 'new-' + c.id));
  const x = compileGeometry(a),
    y = compileGeometry(b);
  expect(x.ok && y.ok).toBe(true);
  if (x.ok && y.ok) expect(diversityHash(x.snapshot)).toBe(diversityHash(y.snapshot));
});
test('GEN-02: requested cycle rank is verified physically; insufficient pairs exhaust rather than return a tree', () => {
  const r = smallRequest();
  r.seed = 'cyclic-control';
  r.allocation.maxModules = 40;
  r.allocation.minModules = 10;
  r.topology = { mode: 'cyclic', extraConnections: 1 };
  r.constraints.maxStraightM = null;
  r.constraints.maxForcedM = null;
  const result = generateSync(r);
  expect(result.status).toBe('complete');
  expect(result.variants[0]!.metrics.cycles).toBe(1);
  const tiny = smallRequest();
  tiny.allocation.maxModules = 4;
  tiny.topology = { mode: 'cyclic', extraConnections: 8 };
  const fail = generateSync(tiny);
  expect(fail.status).toBe('exhausted');
  expect(fail.variants).toHaveLength(0);
  expect(fail.diagnostics[0]!.code).toBe('CYCLES_NOT_MET');
});

import { generationOrigin, normalizeGenerationOrigin } from '../../src/generation/manifest';
import { MazeRepository } from '../../src/repository/repository';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { makePackage, parsePackage, storedRevision } from '../../src/exchange/package';
import { VERSIONS } from '../../src/domain';
test('generation manifest survives draft recovery, immutable map and self-contained JSON round trip; forged seed rejects', async () => {
  const request = smallRequest(),
    v = generateSync(request).variants[0]!,
    origin = generationOrigin(v);
  const repo = await MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange });
  await repo.saveDraft('generated', v.document, null, 0, 100, origin);
  expect((await repo.getDraft('generated'))!.generationOrigin).toEqual(origin);
  const revision = {
    document: v.document,
    revisionHash: v.revisionHash,
    versions: VERSIONS,
    validationSummary: { ready: true, diagnostics: [] },
    generationOrigin: origin,
  };
  await repo.saveMap(revision, 'generated', 'Вариант', 101, null);
  const restored = await repo.getMap(v.revisionHash);
  expect(restored.generationOrigin).toEqual(origin);
  const packet = makePackage(
    {
      definitions: v.document.definitions,
      maps: [storedRevision(restored)],
      projects: [],
      sessions: [],
      chunks: [],
    },
    '2026-11-11T00:00:00.000Z',
  );
  expect(parsePackage(JSON.stringify(packet)).revisions[0]!.generationOrigin).toEqual(origin);
  expect(() => normalizeGenerationOrigin({ ...origin, variantSeed: '0'.repeat(64) })).toThrow(
    'Seed',
  );
  expect(() =>
    normalizeGenerationOrigin({ ...origin, request: { ...origin.request, seed: 'forged' } }),
  ).toThrow('hash');
  repo.close();
});
test('fixed terminals stay within one metre of requested site boundary positions and caps are upper bounds', () => {
  const r = smallRequest(),
    points = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
  r.seed = 'fixed-control';
  r.budgets.attemptsPerVariant = 8;
  r.catalogSnapshots = controlCatalog()
    .slice(0, 1)
    .map((definition) => ({ definition, weight: 1 }));
  r.site.boundaryLoops[0]!.segments = points.map((from, i) => ({
    id: `s${i}`,
    kind: 'line',
    from,
    to: points[(i + 1) % 4]!,
  }));
  r.terminals = { mode: 'fixed', entrance: { x: 0, z: 5 }, exit: { x: 10, z: 5 } };
  r.allocation = {
    mode: 'module-budget',
    minModules: 3,
    maxModules: 12,
    caps: { [r.catalogSnapshots[0]!.definition.contentHash]: 12 },
  };
  r.constraints.maxStraightM = null;
  r.constraints.maxForcedM = null;
  const result = generateSync(r);
  expect(result.status).toBe('complete');
  const c = compileGeometry(result.variants[0]!.document);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  const a = c.snapshot.openPassages.find((o) => o.role === 'entrance')!,
    b = c.snapshot.openPassages.find((o) => o.role === 'exit')!;
  expect(Math.hypot(a.center.x, a.center.z - 5)).toBeLessThanOrEqual(1);
  expect(Math.hypot(b.center.x - 10, b.center.z - 5)).toBeLessThanOrEqual(1);
  expect(c.snapshot.document.instances.length).toBeLessThanOrEqual(12);
});

test('GEN-07: a long room with a real branch still exposes its straight physical run', () => {
  const doc = emptyDocument('long-room'),
    catalog = controlCatalog(),
    long = catalog[1]!,
    square = catalog[0]!;
  doc.definitions = [long, square];
  doc.instances = [
    instantiate(long, 'long', { x: 25, z: 25 }, 0, { width: 2, depth: 20 }),
    instantiate(square, 'side', { x: 27.5, z: 25 }),
  ];
  const opening = (
    id: string,
    instanceId: string,
    edge: number,
    role: 'ordinary' | 'entrance' | 'exit' = 'ordinary',
  ) => ({
    id,
    instanceId,
    regionId: `region-edge-${edge}`,
    boundarySegmentId: `edge-${edge}`,
    uCenter: 0.5,
    widthM: 1.4,
    role,
  });
  doc.openings = [
    opening('entrance', 'long', 0, 'entrance'),
    opening('exit', 'long', 2, 'exit'),
    opening('branch-a', 'long', 1),
    opening('branch-b', 'side', 3),
  ];
  doc.connections = [{ id: 'branch', openingA: 'branch-a', openingB: 'branch-b' }];
  const c = compileGeometry(doc);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  const n = buildNavigation(c.snapshot);
  expect(n.ok).toBe(true);
  if (!n.ok) return;
  expect(n.snapshot.semantic.decisionCount).toBe(1);
  expect(runMetrics(n.snapshot).maxStraightM).toBeGreaterThan(19);
});
