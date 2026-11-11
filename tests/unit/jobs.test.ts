import { expect, test } from 'bun:test';
import { JobManager } from '../../src/jobs/manager';
import type { WorkerPort } from '../../src/jobs/manager';
import { isJobRequest, response } from '../../src/jobs/protocol';
import type { JobRequest } from '../../src/jobs/protocol';
class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  requests: JobRequest[] = [];
  terminated = false;
  postMessage(value: unknown) {
    if (!isJobRequest(value)) throw new Error('Invalid request');
    this.requests.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  reply(index: number, kind: 'result' | 'progress' | 'error' = 'result', payload: unknown = {}) {
    this.onmessage?.({ data: response(this.requests[index]!, kind, payload) });
  }
}
function setup(limit = 16) {
  const workers: FakeWorker[] = [];
  const manager = new JobManager(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  }, limit);
  return { manager, workers };
}
test('RUN-01: stale revision has one terminal cancellation and no progress', async () => {
  const { manager, workers } = setup(),
    progress: unknown[] = [];
  const old = manager.submit('editor', 1, 'compile', {}, { progress: (p) => progress.push(p) }),
    fresh = manager.submit('editor', 2, 'compile', {});
  workers[0]!.reply(0, 'progress', 1);
  workers[0]!.reply(0);
  expect((await old.result).state).toBe('cancelled');
  expect(progress).toEqual([]);
  expect(fresh.state()).toBe('running');
  workers[0]!.reply(1);
  expect((await fresh.result).state).toBe('completed');
  workers[0]!.reply(1);
  expect(fresh.state()).toBe('completed');
  manager.dispose();
});
test('only latest queued revision per owner survives and queue is bounded', async () => {
  const { manager, workers } = setup(2);
  manager.submit('active', 0, 'compile', {});
  const old = manager.submit('editor', 1, 'compile', {}),
    newer = manager.submit('editor', 2, 'compile', {});
  expect((await old.result).state).toBe('cancelled');
  manager.submit('library', null, 'list', {});
  const full = manager.submit('another', null, 'get', {});
  expect((await full.result).payload).toEqual({ code: 'QUEUE_LIMIT', limit: 2 });
  expect(manager.stats().pending).toBe(2);
  expect(workers).toHaveLength(1);
  manager.dispose();
  expect((await newer.result).state).toBe('cancelled');
});
test('cancel terminates active worker immediately and ignores late results', async () => {
  const { manager, workers } = setup();
  const a = manager.submit('screen', 1, 'compile', {}),
    late = workers[0]!.onmessage!,
    request = workers[0]!.requests[0]!;
  a.cancel();
  expect((await a.result).state).toBe('cancelled');
  expect(workers[0]!.terminated).toBe(true);
  const b = manager.submit('screen', 2, 'compile', {});
  expect(workers).toHaveLength(2);
  late({ data: response(request, 'result', 'late') });
  expect(b.state()).toBe('running');
  workers[1]!.reply(0);
  expect((await b.result).state).toBe('completed');
  manager.dispose();
});
test('wrong job/revision/operation is rejected; crash recovers queued job', async () => {
  const { manager, workers } = setup();
  const a = manager.submit('a', 1, 'compile', {}),
    b = manager.submit('b', null, 'list', {}),
    w = workers[0]!;
  w.onmessage?.({ data: { ...response(w.requests[0]!, 'result', {}), operation: 'metrics' } });
  expect(a.state()).toBe('running');
  w.onerror?.({});
  expect((await a.result).state).toBe('failed');
  expect(workers).toHaveLength(2);
  workers[1]!.reply(0);
  expect((await b.result).state).toBe('completed');
  manager.dispose();
});
test('twenty mount/unmount cycles release subscriptions, inputs, and worker resources', async () => {
  const { manager, workers } = setup();
  for (let i = 0; i < 20; i++) {
    const job = manager.submit('screen', i, 'compile', { large: new Uint8Array(1000) });
    manager.disposeOwner('screen');
    expect((await job.result).state).toBe('cancelled');
    expect(manager.stats()).toEqual({ active: 0, pending: 0, workers: 0, owners: 0 });
  }
  expect(workers.every((w) => w.terminated && w.onmessage === null && w.onerror === null)).toBe(
    true,
  );
  manager.dispose();
});
test('aborted signal does not leak an owner or start a worker', async () => {
  const { manager, workers } = setup();
  const abort = new AbortController();
  abort.abort();
  const job = manager.submit('screen', null, 'list', {}, { signal: abort.signal });
  expect((await job.result).state).toBe('cancelled');
  expect(workers).toHaveLength(0);
  expect(manager.stats().owners).toBe(0);
  manager.dispose();
});
