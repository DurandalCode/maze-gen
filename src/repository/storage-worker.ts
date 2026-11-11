import { DomainError } from '../domain';
import { isJobRequest, response, STORAGE_OPERATIONS } from '../jobs/protocol';
import { MazeRepository } from './repository';
import { StorageError } from './schema';
import type { MapRevision } from '../domain';
import type { JobRequest } from '../jobs/protocol';
import type { ChunkInput, Condition, SessionState } from '../session/types';
import type { ListQuery } from './types';
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
function payload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new StorageError('INVALID_REQUEST', 'Invalid storage request');
  return input as Record<string, unknown>;
}
function string(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new StorageError('INVALID_REQUEST', `Invalid ${key}`);
  return value;
}
async function dispatch(request: JobRequest): Promise<unknown> {
  if (!STORAGE_OPERATIONS.includes(request.operation as (typeof STORAGE_OPERATIONS)[number]))
    throw new StorageError('UNSUPPORTED_OPERATION', 'Unsupported storage operation');
  const input = payload(request.input),
    repo = await getRepository();
  switch (request.operation) {
    case 'list':
      if (input.kind === 'maps') return repo.listMaps((input.query ?? {}) as ListQuery);
      if (input.kind === 'walks') return repo.listWalks((input.query ?? {}) as ListQuery);
      if (input.kind === 'drafts') return repo.listDrafts();
      break;
    case 'get':
      if (input.kind === 'map') return repo.getMap(string(input, 'hash'));
      if (input.kind === 'draft') return repo.getDraft(string(input, 'projectId'));
      if (input.kind === 'project') return repo.getProject(string(input, 'projectId'));
      if (input.kind === 'session') return repo.sessions.get(string(input, 'sessionId'));
      if (input.kind === 'chunk')
        return repo.sessions.chunk(string(input, 'sessionId'), input.sequence as number);
      if (input.kind === 'raw-map') return repo.exportRawMap(string(input, 'hash'));
      break;
    case 'save':
      if (input.kind === 'session')
        return repo.sessions.create(
          string(input, 'sessionId'),
          string(input, 'mapHash'),
          input.condition as Condition,
        );
      if (input.kind === 'session-state')
        return repo.sessions.transition(string(input, 'sessionId'), input.state as SessionState);
      return repo.saveMap(
        input.revision as MapRevision,
        string(input, 'projectId'),
        string(input, 'title'),
      );
    case 'append':
      return repo.sessions.append(input.chunk as ChunkInput);
    case 'finalize':
      return repo.sessions.finalize(
        string(input, 'sessionId'),
        input.state as 'finished' | 'stopped',
        input.lastSequence as number,
      );
    case 'draft':
      await repo.saveDraft(
        string(input, 'projectId'),
        input.document,
        (input.baseRevisionHash ?? null) as string | null,
        input.commandRevision as number,
      );
      return { saved: true };
    case 'rename':
      await repo.renameProject(string(input, 'projectId'), string(input, 'title'));
      return { saved: true };
    case 'delete': {
      if (input.kind === 'project-preview') return repo.deletionPreview(string(input, 'projectId'));
      if (input.confirmed !== true)
        throw new StorageError(
          'CONFIRMATION_REQUIRED',
          'Подтвердите удаление после просмотра затрагиваемых данных.',
        );
      if (input.kind === 'project') {
        await repo.deleteProject(string(input, 'projectId'));
        return { deleted: true };
      }
      if (input.kind === 'walk') {
        await repo.deleteWalk(string(input, 'sessionId'));
        return { deleted: true };
      }
      break;
    }
    case 'recover':
      await repo.cleanupStaging();
      return { drafts: await repo.listDrafts(), sessions: await repo.sessions.recover() };
  }
  throw new StorageError('UNSUPPORTED_OPERATION', 'Storage operation is not implemented');
}
// Requests may read concurrently; IndexedDB serializes overlapping write transactions atomically.
scope.onmessage = (event) => {
  if (!isJobRequest(event.data)) return;
  const request = event.data;
  void dispatch(request)
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
        response(request, 'error', {
          code,
          message:
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить действие. Данные не перезаписаны.',
        }),
      );
    });
};
