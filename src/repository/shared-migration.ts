import type { MazeRepository } from './repository';
import { request, transaction } from './schema';
import { ExportRepository } from '../exchange/export-repository';
import { makePackage } from '../exchange/package';
import { sharedDispatch } from './shared-client';
let pending: Promise<void> | null = null;
export function migrateLocalLibrary(repo: MazeRepository, libraryId: string): Promise<void> {
  return (pending ??= run(repo, libraryId).catch((e) => {
    pending = null;
    throw e;
  }));
}
async function run(repo: MazeRepository, libraryId: string) {
  const key = `system/shared-migrated:${libraryId}`;
  const meta = await transaction(repo.database, ['analyses'], 'readwrite', async (tx) => {
    const store = tx.objectStore('analyses');
    if (await request(store.get(key))) return null;
    const old = (await request(store.get('system/shared-client'))) as
      | { clientId: string }
      | undefined;
    const clientId = old?.clientId ?? crypto.randomUUID();
    if (!old) await request(store.put({ analysisKey: 'system/shared-client', clientId }));
    return clientId;
  });
  if (!meta) return;
  // Restore the last confirmed checkpoint when switching from a previous local run.
  await repo.sessions.recover();
  const selection = await transaction(
      repo.database,
      ['maps', 'sessions'],
      'readonly',
      async (tx) => ({
        mapHashes: (await request(tx.objectStore('maps').getAllKeys())) as string[],
        sessionIds: (await request(tx.objectStore('sessions').getAllKeys())) as string[],
      }),
    ),
    drafts = await repo.listDrafts();
  let number = 0;
  const send = async (blob: Blob) => {
    await sharedDispatch(
      {
        protocolVersion: 1,
        jobId: `migration-${meta}-${number}`,
        ownerId: 'local-migration',
        sourceRevision: null,
        operation: 'import',
        deterministicBudget: {},
        input: {
          kind: 'local-bootstrap',
          migrationId: `${meta}:${number}`,
          packet: blob,
          drafts: number === 0 ? drafts : [],
        },
      },
      new AbortController().signal,
    );
    number++;
  };
  if (selection.mapHashes.length || selection.sessionIds.length) {
    for await (const packet of new ExportRepository(repo).packets(selection))
      await send(new Blob([packet.bytes.buffer as ArrayBuffer], { type: 'application/json' }));
  } else if (drafts.length)
    await send(
      new Blob(
        [
          JSON.stringify(
            makePackage({ definitions: [], maps: [], projects: [], sessions: [], chunks: [] }),
          ),
        ],
        { type: 'application/json' },
      ),
    );
  await transaction(repo.database, ['analyses'], 'readwrite', async (tx) => {
    await request(tx.objectStore('analyses').put({ analysisKey: key, completed: true }));
  });
}
