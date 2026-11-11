import { DomainError } from '../domain';
import { isJobRequest, response, STORAGE_OPERATIONS } from '../jobs/protocol';
import { MazeRepository } from './repository';
import { StorageError } from './schema';
import type { MapRevision } from '../domain';
import type { JobRequest } from '../jobs/protocol';
import type { ChunkInput, Condition, SessionState } from '../session/types';
import type { ListQuery } from './types';
import { ImportRepository } from '../exchange/import-repository';
import type { GeometryProof } from '../exchange/import-repository';
import { parsePackage, PACKAGE_LIMITS } from '../exchange/package';
import { ExportRepository } from '../exchange/export-repository';
import type { ExportSelection, ExportPacket } from '../exchange/export-repository';
let activeExport: {
  id: string;
  packets: AsyncGenerator<ExportPacket>;
  touchedAt: number;
  native: boolean;
  current: ExportPacket | null;
} | null = null;
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
async function dispatch(request: JobRequest, signal: AbortSignal): Promise<unknown> {
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
      if (input.kind === 'import-map')
        return new ImportRepository(repo).map(string(input, 'importId'), string(input, 'hash'));
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
    case 'validate-import': {
      const imports = new ImportRepository(repo);
      if (input.kind === 'cancel') {
        await imports.cancel(string(input, 'importId'));
        return { cancelled: true };
      }
      if (input.kind === 'finish')
        return imports.validateGeometry(string(input, 'importId'), input.proofs as GeometryProof[]);
      const file = input.file;
      if (!(file instanceof Blob)) throw new StorageError('INVALID_FILE', 'Выберите JSON-файл');
      if (file.size > PACKAGE_LIMITS.bytes)
        throw new StorageError('FILE_TOO_LARGE', 'Один пакет не может превышать 32 MiB UTF-8.');
      return imports.stage(parsePackage(await file.text()));
    }
    case 'import':
      return new ImportRepository(repo).commit(
        string(input, 'importId'),
        input.copyConflictingSessions === true,
        signal,
      );
    case 'export': {
      if (activeExport && Date.now() - activeExport.touchedAt > 5 * 60_000) {
        await activeExport.packets.return(undefined);
        activeExport = null;
      }
      if (input.kind === 'cancel') {
        if (activeExport && activeExport.id === input.exportId) {
          await activeExport.packets.return(undefined);
          activeExport = null;
        }
        return { cancelled: true };
      }
      if (input.kind === 'begin') {
        if (activeExport) await activeExport.packets.return(undefined);
        activeExport = {
          id: crypto.randomUUID(),
          packets: new ExportRepository(repo).packets(input.selection as ExportSelection),
          touchedAt: Date.now(),
          native: input.native === true,
          current: null,
        };
      } else if (!activeExport || activeExport.id !== input.exportId)
        throw new StorageError('EXPORT_NOT_FOUND', 'Экспорт закрыт. Повторите выбор.');
      const current = activeExport!;
      if (input.kind === 'chunk') {
        const packet = current.current,
          sequence = input.sequence;
        if (
          !current.native ||
          !packet ||
          !Number.isSafeInteger(sequence) ||
          (sequence as number) < 0
        )
          throw new StorageError('INVALID_CHUNK', 'Неверная часть экспорта');
        const offset = (sequence as number) * 192 * 1024;
        if (offset >= packet.bytes.length)
          throw new StorageError('INVALID_CHUNK', 'Часть за границей пакета');
        const bytes = packet.bytes.subarray(offset, offset + 192 * 1024);
        const pieces: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192)
          pieces.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        current.touchedAt = Date.now();
        return {
          sequence,
          base64: btoa(pieces.join('')),
          bytes: bytes.length,
          last: offset + bytes.length === packet.bytes.length,
        };
      }
      if (input.kind === 'part-complete') {
        if (!current.native || !current.current || input.number !== current.current.number)
          throw new StorageError('INVALID_CHUNK', 'Неверный номер пакета');
        const last = current.current.last;
        current.current = null;
        if (last) {
          await current.packets.return(undefined);
          activeExport = null;
          return { exportId: current.id, done: true };
        }
        return { exportId: current.id, done: false, completed: input.number };
      } else if (current.native && current.current)
        throw new StorageError('EXPORT_PENDING', 'Сначала завершите передачу текущего пакета');
      try {
        const next = await current.packets.next();
        current.touchedAt = Date.now();
        if (next.done) {
          activeExport = null;
          return { exportId: current.id, done: true };
        }
        const packet = next.value;
        const blob = current.native
          ? undefined
          : new Blob([packet.bytes.buffer as ArrayBuffer], { type: 'application/json' });
        if (current.native) current.current = packet;
        if (packet.last && !current.native) {
          await current.packets.return(undefined);
          activeExport = null;
        }
        return {
          exportId: current.id,
          done: false,
          packet: {
            ...(blob ? { blob } : { native: true }),
            bytes: packet.bytes.byteLength,
            number: packet.number,
            last: packet.last,
            counts: packet.counts,
            filename: `maze-${current.id.slice(0, 8)}-${packet.number}.json`,
          },
        };
      } catch (error) {
        await current.packets.return(undefined);
        if (activeExport === current) activeExport = null;
        throw error;
      }
    }
  }
  throw new StorageError('UNSUPPORTED_OPERATION', 'Storage operation is not implemented');
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
