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

import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { MazeRepository } from '../../src/repository/repository';
import { ImportRepository } from '../../src/exchange/import-repository';
import type { GeometryProof } from '../../src/exchange/import-repository';
async function staged(repo: MazeRepository, p = fixture()) {
  const imports = new ImportRepository(repo, IDBKeyRange),
    parsed = validatePackage(p);
  const stage = await imports.stage(parsed);
  const proofs: GeometryProof[] = parsed.revisions.map((r) => {
    const prepared = prepareWorld(r.document);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
    return {
      revisionHash: prepared.world.revisionHash,
      worldHash: prepared.world.physical.worldHash,
      navHash: prepared.world.navigation.navHash,
      versions: prepared.world.versions,
    };
  });
  return { imports, stage, proofs, parsed };
}
const open = () => MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange });
test('IO-02: staging stays invisible, geometry proofs are required, atomic commit and exact duplicate no-op', async () => {
  const repo = await open(),
    { imports, stage, proofs } = await staged(repo);
  expect((await repo.listMaps()).items).toHaveLength(0);
  await expect(imports.commit(stage.importId)).rejects.toMatchObject({
    code: 'IMPORT_NOT_VALIDATED',
  });
  await expect(imports.validateGeometry(stage.importId, [])).rejects.toMatchObject({
    code: 'IMPORT_NOT_VALIDATED',
  });
  const preview = await imports.validateGeometry(stage.importId, proofs);
  expect(preview.counts.maps).toBe(1);
  expect(preview.sessionConflicts).toEqual([]);
  await imports.commit(stage.importId);
  expect((await repo.listMaps()).items).toHaveLength(1);
  expect((await repo.sessions.chunk('walk', 0)).samples[0]!.inputMode).toBe('touch');
  const repeated = await staged(repo);
  const duplicate = await repeated.imports.validateGeometry(
    repeated.stage.importId,
    repeated.proofs,
  );
  expect(duplicate.duplicates).toEqual({ definitions: 4, maps: 1, projects: 1, sessions: 1 });
  expect((await repeated.imports.commit(repeated.stage.importId)).inserted).toBe(0);
  expect((await repo.listWalks()).items).toHaveLength(1);
  repo.close();
});
test('import quota failure rolls back entities and summaries; project conflict never replaces the old pointer', async () => {
  const repo = await open(),
    p = fixture();
  const old = structuredClone(p);
  old.projects[0]!.title = 'Существующий проект';
  manifest(old);
  const first = await staged(repo, old);
  await first.imports.validateGeometry(first.stage.importId, first.proofs);
  await first.imports.commit(first.stage.importId);
  const next = await staged(repo, p);
  const preview = await next.imports.validateGeometry(next.stage.importId, next.proofs);
  expect(preview.projectCopies).toHaveLength(1);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'projects') throw new DOMException('quota', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await expect(next.imports.commit(next.stage.importId)).rejects.toThrow('quota');
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  expect((await repo.getProject('project'))!.title).toBe('Существующий проект');
  expect((await repo.listMaps()).items).toHaveLength(1);
  const result = await next.imports.commit(next.stage.importId);
  expect(result.preview.projectCopies).toHaveLength(1);
  expect((await repo.getProject('project'))!.title).toBe('Существующий проект');
  const repeated = await staged(repo, p);
  const repeatedPreview = await repeated.imports.validateGeometry(
    repeated.stage.importId,
    repeated.proofs,
  );
  expect(repeatedPreview.duplicates.projects).toBe(1);
  expect(repeatedPreview.projectCopies).toHaveLength(0);
  expect((await repeated.imports.commit(repeated.stage.importId)).inserted).toBe(0);
  repo.close();
});
test('session conflict requires explicit copy and rekeys all chunks without changing the old attempt', async () => {
  const repo = await open(),
    first = await staged(repo);
  await first.imports.validateGeometry(first.stage.importId, first.proofs);
  await first.imports.commit(first.stage.importId);
  const changed = fixture(),
    { id: _, ...condition } = changed.sessions[0]!.condition;
  changed.sessions[0]!.condition = makeCondition({ ...condition, previewed: false });
  manifest(changed);
  const next = await staged(repo, changed),
    preview = await next.imports.validateGeometry(next.stage.importId, next.proofs);
  expect(preview.sessionConflicts).toEqual(['walk']);
  await expect(next.imports.commit(next.stage.importId)).rejects.toMatchObject({
    code: 'SESSION_CONFLICT',
  });
  expect((await repo.listWalks()).items).toHaveLength(1);
  await next.imports.commit(next.stage.importId, true);
  const rows = (await repo.listWalks()).items;
  expect(rows).toHaveLength(2);
  const copy = await repo.sessions.get(rows.find((r) => r.sessionId !== 'walk')!.sessionId);
  expect(copy.originId).toBe('walk');
  expect(copy.condition.previewed).toBe(false);
  expect((await repo.sessions.get('walk')).condition.previewed).toBe(true);
  const chunk = await repo.sessions.chunk(copy.sessionId, 0);
  expect(chunk.sessionId).toBe(copy.sessionId);
  expect(chunk.contentHash).not.toBe(fixture().chunks[0]!.contentHash);
  repo.close();
});
test('abort before and during commit leaves the library intact; cancel after complete cannot roll it back', async () => {
  const repo = await open(),
    run = await staged(repo);
  await run.imports.validateGeometry(run.stage.importId, run.proofs);
  const before = new AbortController();
  before.abort();
  await expect(run.imports.commit(run.stage.importId, false, before.signal)).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  const during = new AbortController(),
    put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    const result = put.apply(this, args);
    if (this.name === 'definitions') during.abort();
    return result;
  };
  try {
    await expect(run.imports.commit(run.stage.importId, false, during.signal)).rejects.toThrow();
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  expect((await repo.listMaps()).items).toHaveLength(0);
  expect((await repo.listWalks()).items).toHaveLength(0);
  const after = new AbortController(),
    result = await run.imports.commit(run.stage.importId, false, after.signal);
  after.abort();
  expect(result.committed).toBe(true);
  expect((await repo.listMaps()).items).toHaveLength(1);
  repo.close();
});

import { ExportRepository } from '../../src/exchange/export-repository';
test('IO-03: selected attempt export includes frozen map/definitions/condition and a complete chunk history', async () => {
  const repo = await open(),
    run = await staged(repo);
  await run.imports.validateGeometry(run.stage.importId, run.proofs);
  await run.imports.commit(run.stage.importId);
  const packets = [];
  for await (const packet of new ExportRepository(repo).packets({
    mapHashes: [],
    sessionIds: ['walk'],
  }))
    packets.push(packet);
  expect(packets).toHaveLength(1);
  expect(packets[0]!.last).toBe(true);
  const parsed = parsePackage(new TextDecoder().decode(packets[0]!.bytes));
  expect(parsed.counts).toEqual(fixture().manifest.counts);
  expect(parsed.package.sessions[0]!.condition).toEqual(fixture().sessions[0]!.condition);
  expect(parsed.package.chunks[0]!.contentHash).toBe(fixture().chunks[0]!.contentHash);
  repo.close();
});
test('large selection splits into independently importable complete packages and oversized items fail without truncation', async () => {
  const repo = await open();
  for (let index = 0; index < 4; index++) {
    const p = fixture();
    const id = `walk-${index}`;
    p.sessions[0]!.sessionId = id;
    const { contentHash: _, ...body } = p.chunks[0]!;
    p.chunks[0] = makeChunk({ ...body, sessionId: id });
    manifest(p);
    const run = await staged(repo, p);
    await run.imports.validateGeometry(run.stage.importId, run.proofs);
    await run.imports.commit(run.stage.importId);
  }
  const exporter = new ExportRepository(repo),
    selection = { mapHashes: [], sessionIds: Array.from({ length: 4 }, (_, i) => `walk-${i}`) };
  let oneSize = 0;
  for await (const p of exporter.packets({ mapHashes: [], sessionIds: ['walk-0'] }))
    oneSize = p.bytes.byteLength;
  const packets = [];
  for await (const p of exporter.packets(selection, { maxBytes: oneSize + 100 })) packets.push(p);
  expect(packets).toHaveLength(4);
  for (const [i, p] of packets.entries()) {
    expect(p.bytes.byteLength).toBeLessThanOrEqual(oneSize + 100);
    expect(p.number).toBe(i + 1);
    expect(p.last).toBe(i === 3);
    const parsed = parsePackage(new TextDecoder().decode(p.bytes));
    expect(parsed.counts.sessions).toBe(1);
    expect(parsed.counts.maps).toBe(1);
    expect(parsed.counts.definitions).toBe(4);
    const target = await open(),
      stagedCopy = await staged(target, parsed.package);
    await stagedCopy.imports.validateGeometry(stagedCopy.stage.importId, stagedCopy.proofs);
    await stagedCopy.imports.commit(stagedCopy.stage.importId);
    expect((await target.listWalks()).items).toHaveLength(1);
    target.close();
  }
  const tooSmall = exporter.packets({ mapHashes: [], sessionIds: ['walk-0'] }, { maxBytes: 1024 });
  await expect(tooSmall.next()).rejects.toMatchObject({ code: 'ITEM_TOO_LARGE' });
  repo.close();
});
