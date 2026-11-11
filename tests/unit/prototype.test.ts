import { expect, test } from 'bun:test';
import { prototypeRequest } from '../../src/generation/prototype';
import { generateSync } from '../../src/generation/generate';
import { normalizeGenerationOrigin, generationOrigin } from '../../src/generation/manifest';
import { compileGeometry } from '../../src/geometry/compile/compile';
import { buildNavigation } from '../../src/navigation/navmesh';
import { MovementController } from '../../src/session/movement/controller';
import { distance } from '../../src/geometry/predicates';
for (const size of [12, 30] as const)
  test(`web prototype: ${size} rooms are connected, physical, reproducible across five seeds`, () => {
    const identities = new Set<string>();
    for (const seed of [
      'prototype-01',
      'prototype-02',
      'prototype-03',
      'prototype-04',
      'prototype-05',
    ]) {
      const request = prototypeRequest('test', seed, size),
        result = generateSync(request);
      expect(result.status).toBe('complete');
      expect(result.diagnostics).toEqual([]);
      const v = result.variants[0]!;
      expect(v.document.instances).toHaveLength(size);
      expect(v.document.connections).toHaveLength(size - 1);
      expect(v.metrics.components).toBe(1);
      expect(v.metrics.cycles).toBe(0);
      expect(v.document.openings.filter((o) => o.role === 'entrance')).toHaveLength(1);
      expect(v.document.openings.filter((o) => o.role === 'exit')).toHaveLength(1);
      expect(v.manifest.counters.placementChecks).toBe(size);
      identities.add(v.diversityHash);
      expect(normalizeGenerationOrigin(generationOrigin(v)).variantSeed).toBe(
        v.manifest.variantSeed,
      );
    }
    expect(identities.size).toBeGreaterThan(1);
    const r = prototypeRequest('repeat', 'prototype-01', size);
    expect(generateSync(r).variants[0]!.revisionHash).toBe(
      generateSync({ ...r, requestId: 'transport-only' }).variants[0]!.revisionHash,
    );
  });
test('web profile rejects unsupported settings explicitly instead of silently weakening the request', () => {
  const r = prototypeRequest('test', 'seed');
  const invalid = generateSync({ ...r, topology: { mode: 'cyclic', extraConnections: 1 } });
  expect(invalid.status).toBe('invalid-request');
  expect(invalid.variants).toHaveLength(0);
});
test('a generated route can be walked with real swept movement and reaches the exit', () => {
  const v = generateSync(prototypeRequest('walk', 'prototype-walk', 12)).variants[0]!,
    c = compileGeometry(v.document);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  const n = buildNavigation(c.snapshot);
  expect(n.ok).toBe(true);
  if (!n.ok) return;
  const nav = n.snapshot,
    controller = new MovementController(nav.collision, { ...nav.entrance }, nav.radius);
  controller.setPaused(false);
  for (const target of nav.referenceRoute.slice(1)) {
    let steps = 0;
    while (distance(controller.position, target) > 0.035 && steps++ < 3000) {
      const dx = target.x - controller.position.x,
        dz = target.z - controller.position.z;
      controller.frame(1 / 60, { forward: 1, strafe: 0, yaw: Math.atan2(dx, -dz), running: false });
    }
    expect(steps).toBeLessThan(3000);
  }
  expect(distance(controller.position, nav.exit)).toBeLessThan(0.28);
  expect(controller.distanceM).toBeGreaterThan(5);
});
