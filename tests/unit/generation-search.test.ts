import { expect, test } from 'bun:test';
import { GenerationSearch } from '../../src/jobs/generation-search';
import { JobManager } from '../../src/jobs/manager';
import type { WorkerPort } from '../../src/jobs/manager';
import type { JobRequest } from '../../src/jobs/protocol';
import { response } from '../../src/jobs/protocol';
import { defaultRequest } from '../../src/generation/request';
import { generateSync } from '../../src/generation/generate';
class Port implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  request!: JobRequest;
  terminated = false;
  postMessage(data: unknown) {
    this.request = data as JobRequest;
  }
  terminate() {
    this.terminated = true;
  }
  send(kind: 'progress' | 'result', value: unknown) {
    this.onmessage?.({ data: response(this.request, kind, value) });
  }
}
function setup() {
  const ports: Port[] = [];
  const search = new GenerationSearch(
    new JobManager(() => {
      const port = new Port();
      ports.push(port);
      return port;
    }),
  );
  return { search, ports };
}
function request() {
  const r = defaultRequest('a', 'control');
  r.topology = { mode: 'tree', extraConnections: 0 };
  r.allocation = { mode: 'module-budget', minModules: 1, maxModules: 1, caps: {} };
  r.constraints.maxStraightM = null;
  r.constraints.maxForcedM = null;
  r.requestedVariants = 2;
  return r;
}
test('GEN-05: cancellation is immediate, preserves only complete variants, ignores late results, resumes the same seed/index', async () => {
  const { search, ports } = setup(),
    r = request();
  search.start(r);
  const v = generateSync({ ...r, requestedVariants: 1 }).variants[0]!;
  ports[0]!.send('progress', {
    stage: 'variant',
    variantIndex: 0,
    attemptIndex: 0,
    workDone: 1,
    workLimit: 50000,
    counters: v.manifest.counters,
    variant: v,
  });
  ports[0]!.send('progress', {
    stage: 'validation',
    variantIndex: 1,
    attemptIndex: 0,
    workDone: 200,
    workLimit: 50000,
    counters: v.manifest.counters,
  });
  const late = ports[0]!.onmessage;
  search.cancel();
  expect(search.getSnapshot().running).toBe(false);
  expect(ports[0]!.terminated).toBe(true);
  expect(search.getSnapshot().variants).toHaveLength(1);
  expect(search.getSnapshot().result!.nextVariantIndex).toBe(1);
  late?.({
    data: response(ports[0]!.request, 'result', {
      status: 'complete',
      variants: [],
      diagnostics: [],
    }),
  });
  expect(search.getSnapshot().result!.status).toBe('interrupted');
  search.resume(120000);
  expect(ports).toHaveLength(2);
  const input = ports[1]!.request.input as {
    request: ReturnType<typeof request>;
    startVariantIndex: number;
  };
  expect(input.startVariantIndex).toBe(1);
  expect(input.request.seed).toBe(r.seed);
  expect(input.request.budgets.watchdogMs).toBe(120000);
  expect(search.getSnapshot().variants[0]!.revisionHash).toBe(v.revisionHash);
  search.dispose();
});
test('host watchdog terminates a worker stuck in an indivisible final validation and retains the completed result', async () => {
  const { search, ports } = setup(),
    r = request();
  r.budgets.watchdogMs = 10;
  search.start(r);
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(search.getSnapshot().running).toBe(false);
  expect(ports[0]!.terminated).toBe(true);
  expect(search.getSnapshot().result!.status).toBe('interrupted');
  expect(search.getSnapshot().result!.diagnostics[0]!.code).toBe('TIMEOUT');
  expect(search.getSnapshot().variants).toHaveLength(0);
  search.dispose();
});
