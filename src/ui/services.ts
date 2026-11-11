import { computeJobs, storageJobs } from '../jobs/clients';
import type { Operation } from '../jobs/protocol';
import type { JobOutcome } from '../jobs/manager';
import type { Document, MapRevision } from '../domain';
import type { Preparation, PreparedWorld } from '../jobs/compute';
const storage = storageJobs();
export const compute = computeJobs();
let sequence = 0;
export function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Не удалось выполнить действие. Повторите попытку.';
}
export function unwrap<T>(outcome: JobOutcome): T {
  if (outcome.state !== 'completed') {
    const p = outcome.payload as { message?: string; code?: string } | null;
    throw new Error(p?.message ?? p?.code ?? 'Действие отменено');
  }
  return outcome.payload as T;
}
// Each write has its own owner. A concurrent list refresh must never supersede a recording receipt.
// Storage writes are not terminated on view changes: IDB complete is the durability boundary.
export async function store<T>(operation: Operation, input: unknown): Promise<T> {
  return unwrap<T>(await storage.submit(`storage-${++sequence}`, null, operation, input).result);
}
export function commitImport(importId: string, copyConflictingSessions: boolean) {
  return storage.submit(`storage-${++sequence}`, null, 'import', {
    importId,
    copyConflictingSessions,
  });
}
export async function prepare(document: Document, signal?: AbortSignal): Promise<PreparedWorld> {
  const result = unwrap<Preparation>(
    await compute.submit('selected-world', document.revision, 'compile', { document }, { signal })
      .result,
  );
  if (!result.ok)
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n'));
  return result.world;
}
export function revision(world: PreparedWorld): MapRevision {
  return {
    revisionHash: world.revisionHash,
    document: world.physical.document,
    versions: world.versions,
    validationSummary: { ready: true, diagnostics: [] },
  };
}
