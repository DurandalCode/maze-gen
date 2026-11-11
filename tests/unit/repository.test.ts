import { expect, test } from 'bun:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { documentHashes, VERSIONS } from '../../src/domain';
import type { MapRevision } from '../../src/domain';
import { MazeRepository } from '../../src/repository/repository';
import { request, transaction } from '../../src/repository/schema';
import { twoRooms } from '../helpers/maps';
const open = () => MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange });
function revision(offset = 0): MapRevision {
  const document = twoRooms();
  document.instances.forEach((i) => (i.position.x += offset));
  return {
    document,
    revisionHash: documentHashes(document).revisionHash,
    versions: { ...VERSIONS },
    validationSummary: { ready: true, diagnostics: [] },
  };
}
test('DB-01: save and hydrate immutable definitions/map/summary/project in one commit', async () => {
  const repo = await open(),
    r = revision();
  await repo.saveMap(r, 'project', 'Карта', 100);
  expect((await repo.getMap(r.revisionHash)).document).toEqual(r.document);
  expect((await repo.getProject('project'))!.currentRevisionHash).toBe(r.revisionHash);
  await repo.saveMap(r, 'project', 'Карта', 101);
  expect((await repo.listMaps()).items).toHaveLength(1);
  repo.close();
});
test('DB-02: quota failure aborts map and pointer together; retry has no duplicates', async () => {
  const repo = await open(),
    a = revision(),
    b = revision(0.01);
  await repo.saveMap(a, 'project', 'Старая', 100);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === 'projects') throw new DOMException('quota', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await expect(repo.saveMap(b, 'project', 'Новая', 200)).rejects.toThrow('quota');
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  expect((await repo.getProject('project'))!.currentRevisionHash).toBe(a.revisionHash);
  expect((await repo.listMaps()).items).toHaveLength(1);
  await expect(repo.getMap(b.revisionHash)).rejects.toThrow('не найдена');
  await repo.saveMap(b, 'project', 'Новая', 200);
  expect((await repo.listMaps()).items).toHaveLength(2);
  repo.close();
});
test('DB-02: stable pagination with equal dates and titles scans summaries only', async () => {
  const repo = await open();
  for (let i = 0; i < 35; i++)
    await repo.saveMap(revision(i * 0.001), `project-${i}`, 'Одинаковое имя', 100);
  const visited: string[][] = [],
    db = repo.database,
    original = db.transaction.bind(db);
  db.transaction = ((names: string | string[], mode: IDBTransactionMode) => {
    visited.push(typeof names === 'string' ? [names] : names);
    return original(names, mode);
  }) as typeof db.transaction;
  for (const sort of ['updated-desc', 'title-asc'] as const) {
    const first = await repo.listMaps({ sort }),
      second = await repo.listMaps({ sort, cursor: first.nextCursor });
    expect(first.items).toHaveLength(30);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((m) => m.revisionHash)).size).toBe(35);
  }
  expect(visited.every((stores) => stores.length === 1 && stores[0] === 'mapSummaries')).toBe(true);
  repo.close();
});
test('search, status, and cursor reject changed query without loading bodies', async () => {
  const repo = await open();
  await repo.saveMap(revision(), 'a', 'Сосновый лес', 100);
  await repo.saveMap(revision(0.1), 'b', 'Другая карта', 100);
  expect((await repo.listMaps({ search: 'СОСНОВЫЙ' })).items).toHaveLength(1);
  expect((await repo.listMaps({ status: 'invalid' })).items).toHaveLength(0);
  const page = await repo.listMaps({ limit: 1 });
  await expect(repo.listMaps({ cursor: page.nextCursor, search: 'changed' })).rejects.toThrow(
    'Параметры',
  );
  repo.close();
});
test('draft recovery rejects stale writes and rename preserves geometry identity', async () => {
  const factory = new IDBFactory(),
    repo = await MazeRepository.open({ factory, ranges: IDBKeyRange }),
    r = revision();
  await repo.saveMap(r, 'p', 'До', 100);
  const draft = { ...r.document, revision: 2 };
  await repo.saveDraft('p', draft, r.revisionHash, 2, 200);
  repo.close();
  const reopened = await MazeRepository.open({ factory, ranges: IDBKeyRange });
  expect((await reopened.getDraft('p'))!.document).toEqual(draft);
  await expect(reopened.saveDraft('p', r.document, r.revisionHash, 1, 300)).rejects.toThrow(
    'новый черновик',
  );
  await reopened.renameProject('p', 'После', 400);
  expect((await reopened.getProject('p'))!.currentRevisionHash).toBe(r.revisionHash);
  expect((await reopened.listMaps()).items[0]!.title).toBe('После');
  reopened.close();
});
test('one corrupted body does not block summaries or another map and is exportable raw', async () => {
  const repo = await open(),
    a = revision(),
    b = revision(0.1);
  await repo.saveMap(a, 'a', 'Хорошая', 100);
  await repo.saveMap(b, 'b', 'Повреждённая', 200);
  await transaction(repo.database, ['maps'], 'readwrite', async (tx) => {
    const row = await request(tx.objectStore('maps').get(b.revisionHash));
    row.document.instances[0].position.x = NaN;
    tx.objectStore('maps').put(row);
  });
  await expect(repo.getMap(b.revisionHash)).rejects.toMatchObject({ code: 'CORRUPT_MAP' });
  expect((await repo.listMaps()).items).toHaveLength(2);
  expect((await repo.getMap(a.revisionHash)).revisionHash).toBe(a.revisionHash);
  expect(await repo.exportRawMap(b.revisionHash)).toBeDefined();
  repo.close();
});
test('deleting a project retains map referenced by another project and never touches another database', async () => {
  const factory = new IDBFactory(),
    repo = await MazeRepository.open({ factory, ranges: IDBKeyRange }),
    r = revision();
  await repo.saveMap(r, 'a', 'Первый', 100);
  await repo.saveMap(r, 'b', 'Второй', 100);
  expect((await repo.deletionPreview('a')).retainedMap).toBe(true);
  await repo.deleteProject('a');
  expect((await repo.getMap(r.revisionHash)).revisionHash).toBe(r.revisionHash);
  await repo.deleteProject('b');
  await expect(repo.getMap(r.revisionHash)).rejects.toThrow('не найдена');
  repo.close();
  const names = await factory.databases();
  expect(names.map((n) => n.name)).toEqual(['maze-reboot-v1']);
});
