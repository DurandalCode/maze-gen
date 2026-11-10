import {recordJson} from '../src/persistence/record-codec';
import 'fake-indexeddb/auto';
import { afterAll, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, topologyId, type SavedMaze, type SavedWalk } from '../server/store';
import { generate } from '../src/generators/generate';
import type { Maze } from '../src/core/maze';
import { Recorder } from '../src/simulation/recorder';
import { makeWalkData, restoreRecorder, type WalkData } from '../src/persistence/walk-json';
import { browserTopologyId, contentId } from '../src/persistence/identity';
import { offlineRequest, saveOfflineMaze, saveOfflineWalk } from '../src/persistence/offline-library';
import { saveLibraryWalk } from '../src/persistence/library';
import { preferWalk } from '../src/persistence/walk-order';
import { buildLibraryExport, validateLibraryExport, type LibraryExport } from '../src/persistence/library-export';

const locationBefore = Object.getOwnPropertyDescriptor(globalThis, 'location');
const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
class MemoryStorage implements Storage {
  get length() { return Object.keys(this).length; }
  key(index: number) { return Object.keys(this)[index] ?? null; }
  clear() { for (const key of Object.keys(this)) this.removeItem(key); }
  getItem(key: string) { return Object.hasOwn(this, key) ? (this as unknown as Record<string, string>)[key]! : null; }
  setItem(key: string, value: string) { Object.defineProperty(this, key, { value: String(value), configurable: true, enumerable: true, writable: true }); }
  removeItem(key: string) { delete (this as unknown as Record<string, string>)[key]; }
}
// Other suites may already have opened the shared in-memory default DB. Keep
// the same name so a fresh module really reopens the connection being tested.
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?offline=1' } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
const roots: string[] = [];
afterAll(async () => {
  if (locationBefore) Object.defineProperty(globalThis, 'location', locationBefore); else Reflect.deleteProperty(globalThis, 'location');
  if (storageBefore) Object.defineProperty(globalThis, 'localStorage', storageBefore); else Reflect.deleteProperty(globalThis, 'localStorage');
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});
function fixture(id: string) {
  const maze = generate({ columns: 1, rows: 2, corridorWidth: 2, extraConnections: 0, algorithm: 'prim', seed: id });
  const recorder = new Recorder({ x: 0, z: 1 });
  recorder.record({ x: 1, z: 1 }, 1, true); recorder.record({ x: 1, z: 3 }, 3, true); recorder.record({ x: 2, z: 3 }, 4, true);
  const finished = makeWalkData(maze, recorder, id, true, 'finished');
  const early: WalkData = { ...finished, finished: false, status: 'in-progress', recording: { samples: finished.recording.samples.slice(0, 2), distance: 1, elapsed: 1 } };
  return { maze, finished, early };
}
async function storedWalk(id: string) { return await offlineRequest('/api/walks/' + id) as SavedWalk; }

test('offline checkpoints cannot replace a terminal finished route, including concurrent saves', async () => {
  const { finished, early } = fixture('offline-progress-finish');
  await saveOfflineWalk(early);
  await Promise.all([saveOfflineWalk(finished), saveOfflineWalk(early)]);
  const saved = await storedWalk(finished.id);
  expect(saved.walk).toEqual(finished);
  expect(restoreRecorder(saved.walk.recording).samples).toEqual(finished.recording.samples);
  // Even a newer checkpoint cannot reopen a finished record.
  await saveOfflineWalk({ ...early, recording: { ...early.recording, elapsed: 20 } });
  expect((await storedWalk(finished.id)).walk).toEqual(finished);
}, 60_000);

test('offline stopped route rejects an equal-time or older in-progress checkpoint', async () => {
  const { early } = fixture('offline-stopped');
  await saveOfflineWalk({ ...early, status: 'stopped' });
  await saveOfflineWalk(early);
  expect((await storedWalk(early.id)).walk.status).toBe('stopped');
}, 60_000);

test('offline IDs exactly match FileStore, and construction changes preserve topology identity', async () => {
  const { maze, finished } = fixture('identity-offline');
  const root = await mkdtemp(join(tmpdir(), 'maze-offline-identity-')); roots.push(root);
  const fileStore = new FileStore(root);
  const server = await fileStore.saveMaze(maze, 'Сравнение');
  const offline = await saveOfflineMaze(maze, 'Сравнение');
  expect(offline.id).toBe(server.id); expect(offline.id).toBe(await contentId(maze));
  expect(await browserTopologyId(maze)).toBe(topologyId(maze));
  const changed = { ...maze, roof: !maze.roof, wallColor: '#123456', parameters: { ...maze.parameters, seed: 'changed', algorithm: 'backtracker' as const } };
  expect(await browserTopologyId(changed)).toBe(topologyId(maze));
  expect(await contentId(changed)).not.toBe(offline.id);
  await saveOfflineWalk(finished);
  const list = await offlineRequest('/api/walks') as { walks: Awaited<ReturnType<FileStore['listWalks']>> };
  expect(list.walks.find(row => row.id === finished.id)?.topologyId).toBe(topologyId(maze));
}, 60_000);

test('offline first attempt enforces roof and a later construction variant reuses history', async () => {
  const { maze: base, early } = fixture('offline-first-attempt');
  // A distinct geometry isolates first-attempt history from the other test routes.
  const maze = generate({ ...base.parameters, corridorWidth: 3 });
  const bare = { ...maze, roof: false };
  const first = await offlineRequest('/api/prepare-walk', { maze: bare }) as { maze: Maze; firstAttempt: boolean; roofEnforced: boolean };
  expect(first.firstAttempt).toBe(true); expect(first.roofEnforced).toBe(true); expect(first.maze.roof).toBe(true);
  await saveOfflineWalk({ ...early, maze: first.maze });
  const next = await offlineRequest('/api/prepare-walk', { maze: { ...bare, wallColor: '#123456' } }) as typeof first;
  expect(next.firstAttempt).toBe(false); expect(next.roofEnforced).toBe(false); expect(next.maze.roof).toBe(false);
}, 60_000);

test('fresh module connection lists persisted maze and raw recordings; full export roundtrips', async () => {
  const { maze, finished } = fixture('offline-restart-export');
  const saved = await saveOfflineMaze(maze, 'Тест перезапуска'); await saveOfflineWalk(finished);
  // A fresh module instance opens the same database, as an app reload would.
  const modulePath = '../src/persistence/offline-library.ts?restart=' + crypto.randomUUID();
  const restarted = await import(modulePath) as typeof import('../src/persistence/offline-library');
  const loaded = await restarted.offlineRequest('/api/mazes/' + saved.id) as SavedMaze;
  expect(loaded.maze).toEqual(maze); expect(loaded.title).toBe('Тест перезапуска');
  const list = await restarted.offlineRequest('/api/walks') as { walks: { id: string; finished: boolean }[] };
  expect(list.walks.some(row => row.id === finished.id && row.finished)).toBe(true);
  const exported = await buildLibraryExport();
  // The built-in commute pack includes two-storey maps, which require model v11.
  expect(exported.modelVersion).toBe(11);
  const decoded = validateLibraryExport(JSON.parse(JSON.stringify(exported)));
  expect(decoded.modelVersion).toBe(11);
  expect(decoded.walks.find(row => row.id === finished.id)).toEqual(finished);
  expect(decoded.mazes.find(row => row.title === 'Тест перезапуска')?.maze).toEqual(maze);
  // Reimporting snapshots keeps the exact same route and content identity.
  for (const row of decoded.mazes.filter(row => row.title === 'Тест перезапуска')) await saveOfflineMaze(row.maze, row.title);
  await saveOfflineWalk(decoded.walks.find(row => row.id === finished.id)!);
  expect((await storedWalk(finished.id)).walk).toEqual(finished);
}, 60_000);

test('export validation rejects malformed samples, conflicting IDs, and corrupt maze snapshots', () => {
  const { maze, finished, early } = fixture('offline-validation');
  const data: LibraryExport = { kind: 'maze-lab-library-export', version: 1, modelVersion: 8, createdAt: new Date().toISOString(), platform: 'android', mazes: [{ title: 'Экспорт', maze }], walks: [finished] };
  expect(validateLibraryExport(data).walks).toEqual([finished]);
  expect(validateLibraryExport(data).modelVersion).toBe(8);
  expect(() => validateLibraryExport({ ...data, walks: [finished, early] })).toThrow('одинаковым идентификатором');
  expect(() => validateLibraryExport({ ...data, walks: [{ ...finished, recording: { ...finished.recording, samples: [{ x: 1, z: 1, time: -1 }] } }] })).toThrow();
  expect(() => validateLibraryExport({ ...data, mazes: [{ title: 'broken', maze: { ...maze, passages: [[9999]] } }] })).toThrow();
  expect(() => validateLibraryExport({ ...data, version: 9 })).toThrow();
}, 60_000);

test('offline IDB write failure rejects explicitly and leaves the previous verified route intact', async () => {
  const { early, finished } = fixture('offline-quota');
  await saveOfflineWalk(early);
  const originalPut = IDBObjectStore.prototype.put;
  const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'walks') throw new DOMException('Test quota exceeded', 'QuotaExceededError');
    return originalPut.call(this, value, key);
  });
  try { await expect(saveOfflineWalk(finished)).rejects.toThrow(); } finally { put.mockRestore(); }
  expect((await storedWalk(early.id)).walk).toEqual(early);
  await saveOfflineWalk(finished);
  expect((await storedWalk(finished.id)).walk).toEqual(finished);
}, 60_000);


test('pending finished record survives stale checkpoints and exports at equal elapsed after write failure', async () => {
  const { finished, early } = fixture('offline-pending-export');
  const checkpoint: WalkData = { ...finished, finished: false, status: 'in-progress' };
  await saveOfflineWalk(checkpoint);
  const originalPut = IDBObjectStore.prototype.put;
  const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'walks') throw new DOMException('Test quota exceeded', 'QuotaExceededError');
    return originalPut.call(this, value, key);
  });
  const key = 'maze-lab:pending-walk:' + finished.id;
  try {
    expect(await saveLibraryWalk(finished)).toEqual({ saved: false, queued: true });
    expect(await saveLibraryWalk(early)).toEqual({ saved: false, queued: true });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(finished);
    expect((await storedWalk(finished.id)).walk).toEqual(checkpoint);
    const exported = await buildLibraryExport();
    expect(exported.walks.find(row => row.id === finished.id)).toEqual(finished);
    expect(validateLibraryExport(JSON.parse(JSON.stringify(exported))).walks.find(row => row.id === finished.id)).toEqual(finished);
  } finally { put.mockRestore(); }
  expect(await saveLibraryWalk(finished)).toEqual({ saved: true, queued: false });
  expect(localStorage.getItem(key)).toBeNull();
  expect((await storedWalk(finished.id)).walk).toEqual(finished);
}, 60_000);

test('walk preference preserves terminal state, accepts final at equal time, and rejects ID/snapshot conflicts', () => {
  const { finished, early } = fixture('offline-preference');
  const checkpoint: WalkData = { ...finished, finished: false, status: 'in-progress' };
  expect(preferWalk(checkpoint, finished)).toBe(finished);
  expect(preferWalk(finished, early)).toBe(finished);
  expect(preferWalk(finished, { ...early, recording: { ...early.recording, elapsed: 100 } })).toBe(finished);
  expect(preferWalk({ ...early, status: 'stopped' }, early).status).toBe('stopped');
  expect(() => preferWalk(finished, { ...early, id: 'different' })).toThrow();
  expect(() => preferWalk(finished, { ...early, maze: { ...early.maze, roof: !early.maze.roof } })).toThrow();
}, 60_000);

test('transient database open failure is recoverable without reloading the module', async () => {
  const modulePath = '../src/persistence/offline-library.ts?open-retry=' + crypto.randomUUID();
  const fresh = await import(modulePath) as typeof import('../src/persistence/offline-library');
  const { maze } = fixture('offline-open-retry');
  const open = spyOn(indexedDB, 'open').mockImplementationOnce(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => request.onerror?.call(request, new Event('error')));
    return request;
  });
  try { await expect(fresh.saveOfflineMaze(maze, 'Retry')).rejects.toThrow('открыть'); }
  finally { open.mockRestore(); }
  const saved = await fresh.saveOfflineMaze(maze, 'Retry');
  expect(saved.id).toBe(await contentId(maze));
}, 60_000);


test('offline corridor v4 restores explicit supports and exports without navigation subdivisions',async()=>{
 const maze=generate({generationType:'corridor',columns:18,rows:18,moduleSize:2,corridorWidth:2,algorithm:'backtracker',seed:'OFFLINE-CORRIDOR',extraConnections:1}),saved=await saveOfflineMaze(maze,'Corridor offline QA');
 const loaded=await offlineRequest('/api/mazes/'+saved.id) as SavedMaze;expect(loaded.maze).toEqual(maze);
 const exported=await buildLibraryExport(),wire=JSON.parse(recordJson(exported)),entry=wire.mazes.find((r:any)=>r.title==='Corridor offline QA');expect(entry.maze.version).toBe(4);expect(entry.maze.passages).toBeUndefined();expect(entry.maze.supports.length).toBeGreaterThan(0);
 const restored=validateLibraryExport(wire).mazes.find(r=>r.title==='Corridor offline QA')!;expect(restored.maze.passages).toEqual(maze.passages);expect(await browserTopologyId(restored.maze)).toBe(topologyId(maze));
}, 60_000);
