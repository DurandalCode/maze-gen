import { DomainError } from '../domain';
import { isJobRequest, response } from '../jobs/protocol';
import { MazeRepository } from './repository';
import { StorageError } from './schema';
import { createStorageDispatcher } from './storage-dispatch';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown) => void;
};
let repository: Promise<MazeRepository> | null = null;
function getRepository() {
  return (repository ??= MazeRepository.open().catch((error) => {
    repository = null;
    throw error;
  }));
}
const localDispatch = createStorageDispatcher(getRepository);
import { migrateLocalLibrary } from './shared-migration';
import { sharedConfiguration, sharedDispatch } from './shared-client';
import type { JobRequest } from '../jobs/protocol';
async function dispatch(request: JobRequest, signal: AbortSignal): Promise<unknown> {
  const input = request.input as { kind?: string } | null;
  const fileOnly =
    (request.operation === 'get' && ['draft-file', 'route-file'].includes(input?.kind ?? '')) ||
    (request.operation === 'export' && input?.kind === 'draft');
  if (fileOnly) return localDispatch(request, signal);
  const shared = await sharedConfiguration();
  if (request.operation === 'get' && input?.kind === 'storage-mode')
    return { shared: shared.enabled };
  if (shared.enabled && shared.libraryId)
    await migrateLocalLibrary(await getRepository(), shared.libraryId);
  return shared.enabled ? sharedDispatch(request, signal) : localDispatch(request, signal);
}
// Requests may read concurrently; IndexedDB serializes overlapping write transactions atomically.
const controllers = new Map<string, AbortController>();
scope.onmessage = (event) => {
  const control = event.data as {
    protocolVersion?: unknown;
    kind?: unknown;
    jobId?: unknown;
  } | null;
  if (
    control?.protocolVersion === 1 &&
    control.kind === 'cancel' &&
    typeof control.jobId === 'string'
  ) {
    controllers.get(control.jobId)?.abort();
    return;
  }
  if (!isJobRequest(event.data)) return;
  const request = event.data;
  const controller = new AbortController();
  controllers.set(request.jobId, controller);
  void dispatch(request, controller.signal)
    .then((result) => scope.postMessage(response(request, 'result', result)))
    .catch((error) => {
      const code =
        error instanceof StorageError
          ? error.code
          : error instanceof DomainError
            ? error.diagnostic.code
            : error instanceof DOMException
              ? error.name
              : 'STORAGE_ERROR';
      scope.postMessage(
        response(
          request,
          request.operation === 'import' && (code === 'CANCELLED' || code === 'AbortError')
            ? 'cancelled'
            : 'error',
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Не удалось выполнить действие. Данные не перезаписаны.',
          },
        ),
      );
    })
    .finally(() => controllers.delete(request.jobId));
};
