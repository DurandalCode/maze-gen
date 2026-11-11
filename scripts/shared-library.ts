import { ImportRepository } from '../src/exchange/import-repository';
import { parsePackage } from '../src/exchange/package';
import { compileGeometry } from '../src/geometry/compile/compile';
import { buildNavigation } from '../src/navigation/navmesh';
import { documentHashes, VERSIONS, canonical } from '../src/domain';
import type { Draft } from '../src/repository/types';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { MazeRepository } from '../src/repository/repository';
import { STORES, request, transaction, StorageError } from '../src/repository/schema';
import type { Store } from '../src/repository/schema';
import { createStorageDispatcher } from '../src/repository/storage-dispatch';
import { isJobRequest } from '../src/jobs/protocol';
import { encodeStorage, decodeStorage } from '../src/platform/storage-wire';
import { DomainError } from '../src/domain';
interface Snapshot {
  kind: 'maze-shared-library';
  schemaVersion: 1;
  libraryId: string;
  stores: Record<Store, unknown[]>;
  migrations?: string[];
}
export async function snapshot(
  repo: MazeRepository,
  libraryId: string,
  migrations: string[] = [],
): Promise<Snapshot> {
  return transaction(repo.database, [...STORES], 'readonly', async (tx) => {
    const stores = {} as Snapshot['stores'];
    for (const name of STORES) stores[name] = await request(tx.objectStore(name).getAll());
    return { kind: 'maze-shared-library', schemaVersion: 1, libraryId, stores, migrations };
  });
}
export async function restore(repo: MazeRepository, data: Snapshot) {
  if (
    data.kind !== 'maze-shared-library' ||
    data.schemaVersion !== 1 ||
    !data.libraryId ||
    STORES.some((s) => !Array.isArray(data.stores[s]))
  )
    throw new Error('Invalid shared library JSON; refusing to overwrite it');
  await transaction(repo.database, [...STORES], 'readwrite', async (tx) => {
    for (const name of STORES) {
      const store = tx.objectStore(name);
      await request(store.clear());
      for (const row of data.stores[name]) await request(store.put(row));
    }
  });
}
export async function persist(file: string, data: Snapshot) {
  await mkdir(resolve(file, '..'), { recursive: true });
  const part = file + '.tmp',
    handle = await open(part, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(data));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(part, file);
}
async function jsonBody(req: IncomingMessage) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const bytes = Buffer.from(part);
    size += bytes.length;
    if (size > 48 * 1024 * 1024) throw new Error('Request exceeds 48 MiB');
    parts.push(bytes);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
export function sharedLibraryPlugin(): Plugin {
  const enabled = process.env.MAZE_SHARED_LIBRARY !== '0',
    file = resolve(process.env.MAZE_SHARED_LIBRARY_FILE ?? '.local-data/shared-library.json');
  let repoPromise: Promise<{ repo: MazeRepository; libraryId: string }> | null = null,
    tail: Promise<unknown> = Promise.resolve();
  const controls = new Map<string, AbortController>(),
    cancelled = new Set<string>();
  let migrations = new Set<string>();
  const clients = new Map<string, ReturnType<typeof createStorageDispatcher>>();
  const get = () =>
    (repoPromise ??= (async () => {
      const repo = await MazeRepository.open({ factory: new IDBFactory(), ranges: IDBKeyRange });
      let libraryId: string = crypto.randomUUID();
      try {
        const saved = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
        await restore(repo, saved);
        libraryId = saved.libraryId;
        migrations = new Set(saved.migrations ?? []);
      } catch (e) {
        if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e;
      }
      await repo.sessions.recover();
      await repo.cleanupStaging();
      await persist(file, await snapshot(repo, libraryId, [...migrations]));
      return { repo, libraryId };
    })());
  return {
    name: 'maze-shared-json-library',
    configureServer(server) {
      server.middlewares.use('/__maze/library', (req, res) => {
        // Same-origin local API. Do not accept browser cross-origin writes or bind to a public host.
        const origin = req.headers.origin,
          host = req.headers.host;
        if (origin && new URL(origin).host !== host) {
          send(res, 403, {
            ok: false,
            error: { code: 'ORIGIN', message: 'Only same-origin library requests are accepted' },
          });
          return;
        }
        if (req.url === '/cancel' && req.method === 'POST') {
          void jsonBody(req)
            .then((value) => {
              const key = String(value.clientId) + ':' + String(value.jobId);
              if (controls.has(key)) controls.get(key)!.abort();
              else if (cancelled.size < 128) cancelled.add(key);
              send(res, 200, { ok: true });
            })
            .catch(() => send(res, 400, { ok: false }));
          return;
        }
        const run = async () => {
          if (!enabled) {
            send(res, 200, { enabled: false });
            return;
          }
          const { repo, libraryId } = await get();
          if (req.method === 'GET') {
            send(res, 200, { enabled: true, libraryId });
            return;
          }
          if (req.method !== 'POST') {
            send(res, 405, { ok: false, error: { message: 'Method not allowed' } });
            return;
          }
          const body = (await jsonBody(req)) as { clientId?: string; request?: unknown };
          if (
            typeof body.clientId !== 'string' ||
            !/^[a-zA-Z0-9-]{1,80}$/.test(body.clientId) ||
            !isJobRequest(body.request)
          )
            throw new StorageError('INVALID_REQUEST', 'Неверный запрос общей библиотеки');
          const requestMessage = { ...body.request, input: decodeStorage(body.request.input) };
          let dispatch = clients.get(body.clientId);
          if (!dispatch) {
            if (clients.size >= 128) clients.clear();
            dispatch = createStorageDispatcher(async () => repo, {
              recoverSessions: false,
              ranges: IDBKeyRange,
            });
            clients.set(body.clientId, dispatch);
          }
          const key = body.clientId + ':' + requestMessage.jobId,
            controller = new AbortController();
          controls.set(key, controller);
          if (cancelled.delete(key)) controller.abort();
          const before = await snapshot(repo, libraryId, [...migrations]);
          let wireResult: unknown;
          try {
            const input = requestMessage.input as {
              kind?: string;
              migrationId?: string;
              packet?: Blob;
              drafts?: Draft[];
            };
            let result: unknown;
            if (requestMessage.operation === 'import' && input.kind === 'local-bootstrap') {
              if (
                !input.migrationId ||
                input.migrationId.length > 100 ||
                !(input.packet instanceof Blob) ||
                input.packet.size > 32 * 1024 * 1024
              )
                throw new StorageError('INVALID_MIGRATION', 'Неверный локальный пакет');
              if (!migrations.has(input.migrationId)) {
                const packet = parsePackage(await input.packet.text()),
                  imports = new ImportRepository(repo, IDBKeyRange),
                  stage = await imports.stage(packet),
                  proofs = [];
                for (const map of packet.revisions) {
                  const c = compileGeometry(map.document);
                  if (!c.ok) throw new Error(c.diagnostics[0]!.message);
                  const n = buildNavigation(c.snapshot);
                  if (!n.ok) throw new Error(n.diagnostics[0]!.message);
                  proofs.push({
                    revisionHash: documentHashes(map.document).revisionHash,
                    worldHash: c.snapshot.worldHash,
                    navHash: n.snapshot.navHash,
                    versions: VERSIONS,
                  });
                }
                await imports.validateGeometry(stage.importId, proofs);
                await imports.commit(stage.importId, true, controller.signal);
                for (const draft of input.drafts ?? []) {
                  const old = await repo.getDraft(draft.projectId),
                    conflict = old && canonical(old.document) !== canonical(draft.document),
                    id = conflict
                      ? `${draft.projectId.slice(0, 70)}-local-${input.migrationId.slice(0, 8)}`
                      : draft.projectId;
                  await repo.saveDraft(
                    id,
                    draft.document,
                    conflict ? null : draft.baseRevisionHash,
                    draft.commandRevision,
                    undefined,
                    draft.generationOrigin,
                  );
                }
                migrations.add(input.migrationId);
              }
              result = { migrated: true };
            } else {
              if (
                requestMessage.operation === 'save' &&
                input.kind !== 'session' &&
                input.kind !== 'session-state'
              ) {
                const revision = (requestMessage.input as { revision: { document: unknown } })
                    .revision,
                  c = compileGeometry(revision.document);
                if (!c.ok) throw new StorageError('NOT_READY', c.diagnostics[0]!.message);
                const n = buildNavigation(c.snapshot);
                if (!n.ok) throw new StorageError('NOT_READY', n.diagnostics[0]!.message);
              }
              result = await dispatch(requestMessage, controller.signal);
            }
            wireResult = await encodeStorage(result);
            if (!['get', 'list', 'export', 'recover'].includes(requestMessage.operation))
              await persist(file, await snapshot(repo, libraryId, [...migrations]));
          } catch (e) {
            await restore(repo, before);
            migrations = new Set(before.migrations ?? []);
            throw e;
          } finally {
            controls.delete(key);
            cancelled.delete(key);
          }
          send(res, 200, { ok: true, result: wireResult });
        };
        const task = tail.then(run);
        tail = task.catch(() => {});
        void task.catch((e) =>
          send(res, 500, {
            ok: false,
            error: {
              code:
                e instanceof StorageError
                  ? e.code
                  : e instanceof DomainError
                    ? e.diagnostic.code
                    : 'SHARED_STORAGE_ERROR',
              message: e instanceof Error ? e.message : 'Ошибка общей JSON-библиотеки',
            },
          }),
        );
      });
    },
  };
}
