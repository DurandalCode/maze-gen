import { expect, test } from 'bun:test';
import { documentHashes, VERSIONS, canonical } from '../../src/domain';
import type { MapRevision } from '../../src/domain';
import {
  makePackage,
  parsePackage,
  storedRevision,
  validatePackage,
  entityHashes,
  counts,
  PACKAGE_LIMITS,
} from '../../src/exchange/package';
import type { MazePackage } from '../../src/exchange/package';
import { mixedFixture } from '../fixtures/factory';
import { prepareWorld } from '../../src/jobs/compute';
import { makeChunk, makeCondition } from '../../src/session/format';
import type { Session } from '../../src/session/types';
function fixture() {
  const document = mixedFixture(),
    revisionHash = documentHashes(document).revisionHash;
  const revision: MapRevision = {
    document,
    revisionHash,
    versions: { ...VERSIONS },
    validationSummary: { ready: true, diagnostics: [] },
  };
  const condition = makeCondition({
    environment: document.environment,
    previewed: true,
    inputMode: 'touch',
    speedMps: 1.4,
    goalDirectionKnown: false,
    siteKnown: false,
    observationProfile: 'visual-v1',
  });
  const sample = {
    activeTimeMs: 100,
    x: 10,
    y: 1.7,
    z: 10,
    yaw: 0,
    pitch: 0,
    inputMode: 'touch' as const,
  };
  const chunk = makeChunk({
    sessionId: 'walk',
    sequence: 0,
    samples: [sample],
    events: [{ kind: 'stop', sampleIndex: 0, activeTimeMs: 100 }],
    elapsedMs: 100,
    distanceM: 0.14,
  });
  const session: Session = {
    sessionId: 'walk',
    mapHash: revisionHash,
    condition,
    state: 'stopped',
    elapsedMs: 100,
    distanceM: 0.14,
    lastCommittedSequence: 0,
    lastSample: sample,
    createdAt: 1,
    updatedAt: 2,
  };
  return makePackage(
    {
      definitions: document.definitions,
      maps: [storedRevision(revision)],
      projects: [
        {
          projectId: 'project',
          title: 'Смешанные формы',
          currentRevisionHash: revisionHash,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      sessions: [session],
      chunks: [chunk],
    },
    '2026-11-11T00:00:00.000Z',
  );
}
function manifest(p: MazePackage) {
  p.manifest = { counts: counts(p), entityHashes: entityHashes(p) };
  return p;
}
test('IO-01: mixed shape package is self-contained without the installed catalog and round-trips conditions', () => {
  const source = fixture(),
    parsed = parsePackage(JSON.stringify(source));
  expect(canonical(parsed.package)).toBe(canonical(source));
  expect(parsed.counts.samples).toBe(1);
  const prepared = prepareWorld(parsed.revisions[0]!.document);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared));
  expect(prepared.world.revisionHash).toBe(source.maps[0]!.revisionHash);
  expect(parsed.package.sessions[0]!.condition).toEqual(source.sessions[0]!.condition);
  const repeated = parsePackage(JSON.stringify(parsed.package));
  expect(repeated.package.manifest).toEqual(source.manifest);
});
test('IO-02: old formats, unknown fields, missing dependencies and forged identities fail before commit', () => {
  expect(() => parsePackage('{')).toThrow('JSON');
  expect(() => validatePackage({ kind: 'maze-package', schemaVersion: 1 })).toThrow(
    'Старые форматы',
  );
  expect(() => validatePackage({ ...fixture(), code: 'alert(1)' })).toThrow('неизвестное поле');
  const missing = fixture();
  missing.definitions = [];
  expect(() => validatePackage(missing)).toThrow('Нет определения');
  const forged = fixture();
  forged.maps[0]!.document.instances[0]!.position.x += 1;
  manifest(forged);
  expect(() => validatePackage(forged)).toThrow('Ревизия карты');
  const unknown = fixture();
  (unknown.definitions[0]!.builder as { kind: string }).kind = 'unknown-shape';
  expect(() => validatePackage(unknown)).toThrow();
  const badManifest = fixture();
  badManifest.manifest.entityHashes = {};
  expect(() => validatePackage(badManifest)).toThrow('Manifest');
});
test('package limits are checked before allocating normalized maps or samples', () => {
  const many = fixture();
  many.maps = Array(101).fill(null);
  expect(() => validatePackage(many)).toThrow('лимит 100');
  const samples = fixture();
  samples.chunks = Array(3907).fill({ samples: Array(256).fill(null) });
  expect(() => validatePackage(samples)).toThrow('лимит samples');
  expect(() => parsePackage(' '.repeat(PACKAGE_LIMITS.bytes + 1))).toThrow('32 MiB');
  expect(() => parsePackage('я'.repeat(PACKAGE_LIMITS.bytes / 2 + 1))).toThrow('32 MiB');
});
test('session dependencies, chunk closure and condition signatures are checked', () => {
  const gap = fixture();
  gap.chunks = [];
  manifest(gap);
  expect(() => validatePackage(gap)).toThrow('полную историю');
  const orphan = fixture();
  orphan.sessions = [];
  manifest(orphan);
  expect(() => validatePackage(orphan)).toThrow('Нет заголовка');
  const different = fixture();
  different.sessions[0]!.condition.previewed = false;
  manifest(different);
  expect(() => validatePackage(different)).toThrow('Condition hash');
  const summary = fixture();
  summary.sessions[0]!.distanceM = 2;
  manifest(summary);
  expect(() => validatePackage(summary)).toThrow('Итог попытки');
  const duplicate = fixture();
  duplicate.chunks.push(duplicate.chunks[0]!);
  manifest(duplicate);
  expect(() => validatePackage(duplicate)).toThrow('chunks');
});
