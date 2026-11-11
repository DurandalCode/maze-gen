import { JobManager } from './manager';
import type { WorkerPort } from './manager';
export function computeJobs(): JobManager {
  return new JobManager(
    () =>
      new Worker(new URL('./compute-worker.ts', import.meta.url), {
        type: 'module',
        name: 'maze-compute',
      }) as unknown as WorkerPort,
  );
}
export function storageJobs(): JobManager {
  return new JobManager(
    () =>
      new Worker(new URL('../repository/storage-worker.ts', import.meta.url), {
        type: 'module',
        name: 'maze-storage',
      }) as unknown as WorkerPort,
  );
}
export function generationJobs(): JobManager {
  return new JobManager(
    () =>
      new Worker(new URL('./generation-worker.ts', import.meta.url), {
        type: 'module',
        name: 'maze-generation',
      }) as unknown as WorkerPort,
  );
}
