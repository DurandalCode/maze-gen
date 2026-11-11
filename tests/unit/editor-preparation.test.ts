import { expect, test } from 'bun:test';
import { CommandStore } from '../../src/editor/commands';
import { EditorPreparation } from '../../src/jobs/editor-preparation';
import { JobManager } from '../../src/jobs/manager';
import type { WorkerPort } from '../../src/jobs/manager';
import type { JobRequest } from '../../src/jobs/protocol';
import { compute } from '../../src/jobs/compute';
import type { Preparation } from '../../src/jobs/compute';
import { twoRooms } from '../helpers/maps';
class Worker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  requests: JobRequest[] = [];
  terminated = false;
  postMessage(value: unknown) {
    this.requests.push(value as JobRequest);
  }
  terminate() {
    this.terminated = true;
  }
  finish(index: number) {
    const result = compute(this.requests[index]!, () => {});
    this.onmessage?.({ data: result.message });
    return result.message.payload;
  }
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function setup() {
  const workers: Worker[] = [];
  const jobs = new JobManager(() => {
    const worker = new Worker();
    workers.push(worker);
    return worker;
  });
  const store = new CommandStore(twoRooms());
  const preparation = new EditorPreparation(store, jobs, 'editor', () => {});
  return { workers, jobs, store, preparation };
}
test('visual changes keep pending physical work and reuse the exact navmesh; metadata and selection submit no jobs', async () => {
  const { workers, jobs, store, preparation } = setup(),
    worker = workers[0]!;
  const d = store.getSnapshot().document;
  store.execute('Color', [
    { field: 'environment', value: { ...d.environment, wallColor: '#3f7157' } },
  ]);
  expect(worker.requests.map((r) => r.operation)).toEqual(['compile']);
  const result = worker.finish(0) as Preparation;
  if (!result.ok) throw new Error('Fixture invalid');
  await tick();
  expect(worker.requests.map((r) => r.operation)).toEqual(['compile', 'identity']);
  worker.finish(1);
  await tick();
  expect(preparation.getState().status).toBe('ready');
  expect(preparation.getState().world!.navigation).toBe(result.world.navigation);
  expect(preparation.getState().world!.physical.document.environment.wallColor).toBe('#3f7157');
  expect(preparation.getState().world!.revisionHash).not.toBe(result.world.revisionHash);
  const world = preparation.getState().world;
  store.select({ field: 'instances', id: 'a' });
  store.execute('Rename', [{ field: 'metadata', value: { ...d.metadata, title: 'New title' } }]);
  expect(worker.requests).toHaveLength(2);
  expect(preparation.getState().world).toBe(world);
  preparation.dispose();
  expect(preparation.getState().world).toBeNull();
  jobs.dispose();
});
test('new physical revision cancels stale work and a late result never enables Play', async () => {
  const { workers, jobs, store, preparation } = setup(),
    old = workers[0]!,
    late = old.onmessage!;
  const a = store.getSnapshot().document.instances[0]!;
  store.execute('Move', [
    { field: 'instances', id: a.id, value: { ...a, position: { x: 20, z: 10 } } },
  ]);
  expect(old.terminated).toBe(true);
  expect(workers).toHaveLength(2);
  const stale = compute(old.requests[0]!, () => {});
  late({ data: stale.message });
  await tick();
  expect(preparation.getState().status).toBe('pending');
  expect(preparation.getState().world).toBeNull();
  // This transform breaks the explicit connection; its diagnostic must survive instead of the old ready state.
  workers[1]!.finish(0);
  await tick();
  expect(preparation.getState().status).toBe('invalid');
  expect(preparation.getState().diagnostics.length).toBeGreaterThan(0);
  store.undo();
  workers[1]!.finish(1);
  await tick();
  expect(preparation.getState().status).toBe('ready');
  preparation.dispose();
  jobs.dispose();
});
test('identity operation validates/hashes schema without invoking physical compilation or navigation', () => {
  const document = twoRooms();
  document.instances[0]!.position.x = -100;
  const result = compute(
    {
      protocolVersion: 1,
      jobId: 'identity',
      ownerId: 'editor',
      sourceRevision: document.revision,
      operation: 'identity',
      input: { document },
      deterministicBudget: {},
    },
    () => {
      throw new Error('Physical preparing progress is forbidden for identity');
    },
  );
  expect(result.message.kind).toBe('result');
  expect(result.message.payload).toMatchObject({ ok: true });
  expect(result.transfer).toEqual([]);
  const compiled = compute(
    {
      protocolVersion: 1,
      jobId: 'physical',
      ownerId: 'editor',
      sourceRevision: document.revision,
      operation: 'compile',
      input: { document },
      deterministicBudget: {},
    },
    () => {},
  );
  expect(compiled.message.payload).toMatchObject({ ok: false });
});
