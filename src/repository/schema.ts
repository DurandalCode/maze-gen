export const DATABASE_NAME = 'maze-reboot-v1';
export const DATABASE_VERSION = 1;
export const STORES = [
  'projects',
  'drafts',
  'definitions',
  'maps',
  'mapSummaries',
  'sessions',
  'walkSummaries',
  'walkChunks',
  'analyses',
  'importStaging',
] as const;
export type Store = (typeof STORES)[number];
export class StorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
export function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new StorageError('IDB_REQUEST', 'Ошибка хранилища'));
  });
}
export function openDatabase(factory: IDBFactory, name = DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, DATABASE_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const store = (name: Store, keyPath: string | string[]) =>
        db.createObjectStore(name, { keyPath });
      store('projects', 'projectId').createIndex('updatedAt-id', ['updatedAt', 'projectId']);
      store('drafts', 'projectId');
      store('definitions', 'contentHash');
      store('maps', 'revisionHash');
      const map = store('mapSummaries', 'revisionHash');
      map.createIndex('updatedAt-id', ['updatedAt', 'revisionHash']);
      map.createIndex('title-id', ['titleNormalized', 'revisionHash']);
      store('sessions', 'sessionId');
      const walk = store('walkSummaries', 'sessionId');
      walk.createIndex('updatedAt-id', ['updatedAt', 'sessionId']);
      walk.createIndex('title-id', ['titleNormalized', 'sessionId']);
      walk.createIndex('map-updatedAt-id', ['mapHash', 'updatedAt', 'sessionId']);
      store('walkChunks', ['sessionId', 'sequence']).createIndex('session-sequence', [
        'sessionId',
        'sequence',
      ]);
      store('analyses', 'analysisKey');
      store('importStaging', ['importId', 'entityKey']);
    };
    let blocked = false;
    opening.onblocked = () => {
      blocked = true;
      reject(
        new StorageError(
          'SCHEMA_BLOCKED',
          'Закройте другие вкладки Maze Lab и повторите открытие библиотеки.',
        ),
      );
    };
    opening.onerror = () =>
      reject(
        new StorageError(
          opening.error?.name === 'VersionError' ? 'SCHEMA_VERSION' : 'OPEN_FAILED',
          'Не удалось открыть библиотеку. Данные не изменены.',
        ),
      );
    opening.onsuccess = () => {
      const db = opening.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export async function transaction<T>(
  db: IDBDatabase,
  stores: Store[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new StorageError('CANCELLED', 'Действие отменено');
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new StorageError('CANCELLED', 'Транзакция отменена'));
  });
  // A rejection may occur while an individual request is still being awaited.
  done.catch(() => {});
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Complete already won the race. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await run(tx);
    await done;
    return result;
  } catch (error) {
    abort();
    await done.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
