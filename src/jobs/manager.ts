import { isJobRequest, isJobResponse, PROTOCOL_VERSION } from './protocol';
import type { JobRequest, JobResponse, Operation } from './protocol';
export interface WorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TerminalState = Exclude<JobState, 'queued' | 'running'>;
export interface JobOutcome {
  jobId: string;
  state: TerminalState;
  payload: unknown;
}
export interface JobHandle {
  jobId: string;
  result: Promise<JobOutcome>;
  cancel: () => void;
  state: () => JobState;
}
interface JobRecord {
  request: JobRequest;
  state: JobState;
  settle: (outcome: JobOutcome) => void;
  progress?: ((payload: unknown) => void) | undefined;
  cleanup?: () => void;
}
let nextId = 0;
export class JobManager {
  private port: WorkerPort | null = null;
  private current: JobRecord | null = null;
  private pending: JobRecord[] = [];
  private latest = new Map<string, string>();
  private disposed = false;
  constructor(
    private readonly create: () => WorkerPort,
    readonly maxPending = 16,
  ) {}
  submit(
    ownerId: string,
    sourceRevision: number | null,
    operation: Operation,
    input: unknown,
    options: {
      budget?: Record<string, number>;
      progress?: (payload: unknown) => void;
      signal?: AbortSignal;
    } = {},
  ): JobHandle {
    const request: JobRequest = {
      protocolVersion: PROTOCOL_VERSION,
      jobId: `job-${++nextId}`,
      ownerId,
      sourceRevision,
      operation,
      input,
      deterministicBudget: options.budget ?? {},
    };
    let settle!: (outcome: JobOutcome) => void;
    const result = new Promise<JobOutcome>((resolve) => (settle = resolve)),
      record: JobRecord = { request, state: 'queued', settle, progress: options.progress };
    const handle: JobHandle = {
      jobId: request.jobId,
      result,
      cancel: () => this.cancel(record),
      state: () => record.state,
    };
    if (this.disposed) {
      this.finish(record, 'cancelled', { reason: 'disposed' });
      return handle;
    }
    if (!isJobRequest(request)) {
      this.finish(record, 'failed', { code: 'INVALID_REQUEST' });
      return handle;
    }
    const old = this.pending.find((r) => r.request.ownerId === ownerId);
    if (old) this.cancel(old);
    if (this.pending.length >= this.maxPending) {
      this.finish(record, 'failed', { code: 'QUEUE_LIMIT', limit: this.maxPending });
      return handle;
    }
    this.latest.set(ownerId, request.jobId);
    if (options.signal) {
      const abort = () => this.cancel(record);
      options.signal.addEventListener('abort', abort, { once: true });
      record.cleanup = () => options.signal?.removeEventListener('abort', abort);
      if (options.signal.aborted) {
        this.finish(record, 'cancelled', { reason: 'aborted' });
        return handle;
      }
    }
    this.pending.push(record);
    this.drain();
    return handle;
  }
  private worker(): WorkerPort {
    if (!this.port) {
      const port = this.create();
      this.port = port;
      port.onmessage = (event) => {
        if (this.port === port) this.receive(event.data);
      };
      port.onerror = () => {
        if (this.port !== port) return;
        const record = this.current;
        this.stopWorker();
        if (record) this.finish(record, 'failed', { code: 'WORKER_CRASH' });
        this.drain();
      };
    }
    return this.port;
  }
  private drain(): void {
    if (this.current || this.disposed) return;
    const record = this.pending.shift();
    if (!record) return;
    this.current = record;
    record.state = 'running';
    try {
      this.worker().postMessage(record.request);
    } catch {
      this.stopWorker();
      this.finish(record, 'failed', { code: 'WORKER_START' });
      this.drain();
    }
  }
  private receive(value: unknown): void {
    if (!isJobResponse(value) || !this.current) return;
    const record = this.current,
      r = record.request;
    if (
      value.jobId !== r.jobId ||
      value.ownerId !== r.ownerId ||
      value.sourceRevision !== r.sourceRevision ||
      value.operation !== r.operation
    )
      return;
    const fresh = this.latest.get(r.ownerId) === r.jobId;
    if (value.kind === 'progress') {
      if (fresh) record.progress?.(value.payload);
      return;
    }
    this.finish(
      record,
      !fresh
        ? 'cancelled'
        : value.kind === 'result'
          ? 'completed'
          : value.kind === 'error'
            ? 'failed'
            : 'cancelled',
      !fresh ? { reason: 'stale' } : value.payload,
    );
    this.drain();
  }
  private finish(record: JobRecord, state: TerminalState, payload: unknown): void {
    if (['completed', 'failed', 'cancelled'].includes(record.state)) return;
    record.state = state;
    record.cleanup?.();
    record.cleanup = undefined;
    record.progress = undefined;
    this.pending = this.pending.filter((r) => r !== record);
    if (this.current === record) this.current = null;
    if (this.latest.get(record.request.ownerId) === record.request.jobId)
      this.latest.delete(record.request.ownerId);
    record.settle({ jobId: record.request.jobId, state, payload });
    // Release potentially large inputs after terminal outcome.
    record.request = { ...record.request, input: null };
  }
  private cancel(record: JobRecord): void {
    if (['completed', 'failed', 'cancelled'].includes(record.state)) return;
    if (this.current === record) this.stopWorker();
    this.finish(record, 'cancelled', { reason: 'cancelled' });
    this.drain();
  }
  private stopWorker(): void {
    if (this.port) {
      this.port.onmessage = null;
      this.port.onerror = null;
      this.port.terminate();
      this.port = null;
    }
  }
  disposeOwner(ownerId: string): void {
    const records = [...(this.current ? [this.current] : []), ...this.pending].filter(
      (r) => r.request.ownerId === ownerId,
    );
    // Prevent a cancelled current job from starting another pending job for this owner.
    this.latest.delete(ownerId);
    for (const record of records.filter((r) => r !== this.current)) this.cancel(record);
    for (const record of records.filter((r) => r === this.current)) this.cancel(record);
  }
  dispose(): void {
    this.disposed = true;
    for (const r of [...this.pending, ...(this.current ? [this.current] : [])]) this.cancel(r);
    this.stopWorker();
    this.latest.clear();
  }
  stats(): { active: number; pending: number; workers: number; owners: number } {
    return {
      active: this.current ? 1 : 0,
      pending: this.pending.length,
      workers: this.port ? 1 : 0,
      owners: this.latest.size,
    };
  }
}
