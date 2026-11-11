import { test, expect } from 'bun:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MazeRepository } from '../../src/repository/repository';
import { snapshot, restore, persist } from '../../scripts/shared-library';
import { encodeStorage, decodeStorage } from '../../src/platform/storage-wire';
import { documentHashes, VERSIONS } from '../../src/domain';
import { twoRooms } from '../helpers/maps';
import { createStorageDispatcher } from '../../src/repository/storage-dispatch';
import { makeCondition } from '../../src/session/format';
test('shared JSON snapshot reload preserves maps, names, attempts and migration markers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maze-json-')),
    first = await MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange }),
    second = await MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange });
  try {
    const document = twoRooms(),
      hash = documentHashes(document).revisionHash;
    await first.saveMap(
      {
        document,
        revisionHash: hash,
        versions: VERSIONS,
        validationSummary: { ready: true, diagnostics: [] },
      },
      'project',
      'Общая карта',
      100,
    );
    await first.sessions.create(
      'attempt',
      hash,
      makeCondition({
        environment: document.environment,
        previewed: false,
        inputMode: 'keyboard',
        speedMps: 1.4,
        goalDirectionKnown: false,
        siteKnown: false,
        observationProfile: 'visual-v1',
      }),
    );
    const file = join(dir, 'library.json');
    await persist(file, await snapshot(first, 'server-one', ['browser:0']));
    const data = JSON.parse(await readFile(file, 'utf8'));
    await restore(second, data);
    expect((await second.listMaps()).items[0]!.title).toBe('Общая карта');
    expect((await second.getMap(hash)).document).toEqual(document);
    expect((await second.sessions.get('attempt')).state).toBe('prepared');
    expect(data.migrations).toEqual(['browser:0']);
    await second.sessions.transition('attempt', 'running');
    const dispatch = createStorageDispatcher(async () => second, {
      recoverSessions: false,
      ranges: IDBKeyRange,
    });
    await dispatch(
      {
        protocolVersion: 1,
        jobId: 'recover',
        ownerId: 'browser',
        sourceRevision: null,
        operation: 'recover',
        input: {},
        deterministicBudget: {},
      },
      new AbortController().signal,
    );
    expect((await second.sessions.get('attempt')).state).toBe('running');
  } finally {
    first.close();
    second.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('wire JSON round trip preserves UTF-8 Blob bytes for import/export', async () => {
  const body = { file: new Blob(['{"title":"Маршрут 🧭"}'], { type: 'application/json' }), seq: 0 };
  const result = decodeStorage(
    JSON.parse(JSON.stringify(await encodeStorage(body))),
  ) as typeof body;
  expect(await result.file.text()).toBe(await body.file.text());
  expect(result.file.type).toBe(body.file.type);
  expect(result.seq).toBe(0);
});
