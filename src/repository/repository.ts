import { canonical, documentHashes, normalizeDocument, parseDefinition, VERSIONS } from '../domain';
import type { Document, MapRevision } from '../domain';
import { bounds } from '../geometry/predicates';
import { contourPolygon } from '../geometry/kernel/contour';
import { SessionRepository } from './session-repository';
import { DATABASE_NAME, openDatabase, request, StorageError, transaction } from './schema';
import type { Store } from './schema';
import type {
  Draft,
  DraftSummary,
  ListQuery,
  ListCursor,
  MapSummary,
  Page,
  Project,
  Session,
  StoredMap,
  WalkChunk,
  WalkSummary,
} from './types';
const normalizeTitle = (title: string) => title.normalize('NFC').toLowerCase();
function timestamp(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new StorageError('INVALID_TIME', 'Invalid timestamp');
  return value;
}
function title(value: string) {
  const s = value.trim().normalize('NFC');
  if (!s || s.length > 256)
    throw new StorageError('INVALID_TITLE', 'Название должно содержать 1–256 символов.');
  return s;
}
function supported(versions: MapRevision['versions']): boolean {
  return canonical(versions) === canonical(VERSIONS);
}
export class MazeRepository {
  readonly sessions: SessionRepository;
  private constructor(
    readonly database: IDBDatabase,
    private readonly ranges: typeof IDBKeyRange,
  ) {
    this.sessions = new SessionRepository(database, ranges);
  }
  static async open(
    options: { factory?: IDBFactory; ranges?: typeof IDBKeyRange; name?: string } = {},
  ): Promise<MazeRepository> {
    return new MazeRepository(
      await openDatabase(options.factory ?? indexedDB, options.name ?? DATABASE_NAME),
      options.ranges ?? IDBKeyRange,
    );
  }
  close() {
    this.database.close();
  }
  async saveMap(
    revision: MapRevision,
    projectId: string,
    projectTitle: string,
    now = Date.now(),
    expectedBaseRevisionHash?: string | null,
  ): Promise<MapSummary> {
    timestamp(now);
    if (
      expectedBaseRevisionHash !== undefined &&
      expectedBaseRevisionHash !== null &&
      (typeof expectedBaseRevisionHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expectedBaseRevisionHash))
    )
      throw new StorageError('INVALID_BASE', 'Неверная базовая ревизия проекта');
    const normalized = normalizeDocument(revision.document),
      hash = documentHashes(normalized, revision.versions).revisionHash;
    if (hash !== revision.revisionHash)
      throw new StorageError('HASH_MISMATCH', 'Карта не соответствует ревизии.');
    if (
      !supported(revision.versions) ||
      !revision.validationSummary.ready ||
      revision.validationSummary.diagnostics.length
    )
      throw new StorageError('NOT_READY', 'Можно сохранить только проверенную ревизию.');
    if (!projectId || projectId.length > 128)
      throw new StorageError('INVALID_ID', 'Invalid project ID');
    const name = title(projectTitle),
      { definitions, ...document } = normalized,
      definitionHashes = definitions.map((d) => d.contentHash);
    const map: StoredMap = {
      revisionHash: hash,
      document,
      definitionHashes,
      versions: { ...revision.versions },
      validationSummary: { ready: true, diagnostics: [] },
    };
    const b = bounds(contourPolygon(normalized.site.boundaryLoops)[0]!);
    const commitDraftContent =
      expectedBaseRevisionHash === undefined ? null : canonical({ ...normalized, revision: 0 });
    return transaction(
      this.database,
      ['projects', 'maps', 'definitions', 'mapSummaries', 'drafts'],
      'readwrite',
      async (tx) => {
        const oldProject = (await request(tx.objectStore('projects').get(projectId))) as
          | Project
          | undefined;
        if (
          expectedBaseRevisionHash !== undefined &&
          (oldProject?.currentRevisionHash ?? null) !== expectedBaseRevisionHash
        )
          throw new StorageError(
            'PROJECT_CONFLICT',
            'Проект уже изменён в другом редакторе. Сохраните текущую работу отдельной копией.',
          );
        if (commitDraftContent !== null) {
          const draft = (await request(tx.objectStore('drafts').get(projectId))) as
            | Draft
            | undefined;
          if (draft && canonical({ ...draft.document, revision: 0 }) !== commitDraftContent)
            throw new StorageError(
              'DRAFT_CONFLICT',
              'Черновик проекта изменён в другом редакторе. Сохраните свою работу отдельной копией.',
            );
        }
        for (const definition of definitions) {
          const existing = await request(tx.objectStore('definitions').get(definition.contentHash));
          if (existing && canonical(existing) !== canonical(definition))
            throw new StorageError('CORRUPT_DEFINITION', 'Сохранённое определение повреждено.');
          if (!existing) tx.objectStore('definitions').add(definition);
        }
        const existing = (await request(tx.objectStore('maps').get(hash))) as StoredMap | undefined;
        if (existing) {
          const hydrated = { ...existing.document, definitions };
          if (documentHashes(hydrated, existing.versions).revisionHash !== hash)
            throw new StorageError('CORRUPT_MAP', 'Сохранённая карта повреждена.');
        } else tx.objectStore('maps').add(map);
        const oldSummary = (await request(tx.objectStore('mapSummaries').get(hash))) as
          | MapSummary
          | undefined;
        const summary: MapSummary = {
          revisionHash: hash,
          projectId,
          title: name,
          titleNormalized: normalizeTitle(name),
          createdAt: oldSummary?.createdAt ?? now,
          updatedAt: now,
          status: 'ready',
          widthM: b.maxX - b.minX,
          depthM: b.maxZ - b.minZ,
          modules: normalized.instances.length,
          connections: normalized.connections.length,
        };
        tx.objectStore('mapSummaries').put(summary);
        tx.objectStore('projects').put({
          projectId,
          title: name,
          currentRevisionHash: hash,
          createdAt: oldProject?.createdAt ?? now,
          updatedAt: now,
          ...(oldProject?.originId ? { originId: oldProject.originId } : {}),
        } satisfies Project);
        tx.objectStore('drafts').delete(projectId);
        return summary;
      },
    );
  }
  async getMap(revisionHash: string): Promise<MapRevision> {
    const stored = await transaction(
      this.database,
      ['maps', 'definitions'],
      'readonly',
      async (tx) => {
        const map = (await request(tx.objectStore('maps').get(revisionHash))) as
          | StoredMap
          | undefined;
        if (!map) throw new StorageError('NOT_FOUND', 'Карта не найдена.');
        const definitions = [];
        for (const hash of map.definitionHashes) {
          const definition = await request(tx.objectStore('definitions').get(hash));
          if (!definition)
            throw new StorageError('MISSING_DEFINITION', 'Отсутствует определение модуля.');
          definitions.push(definition);
        }
        return { map, definitions };
      },
    );
    try {
      if (!supported(stored.map.versions))
        throw new StorageError('UNSUPPORTED_VERSION', 'Версия геометрии не поддерживается.');
      const document = normalizeDocument({
        ...stored.map.document,
        definitions: stored.definitions.map((d) => parseDefinition(d)),
      });
      if (documentHashes(document, stored.map.versions).revisionHash !== revisionHash)
        throw new StorageError('HASH_MISMATCH', 'Карта повреждена.');
      return {
        revisionHash,
        document,
        versions: stored.map.versions,
        validationSummary: stored.map.validationSummary,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError(
        'CORRUPT_MAP',
        'Не удалось прочитать карту; остальные записи доступны.',
      );
    }
  }
  async listMaps(query: ListQuery = {}): Promise<Page<MapSummary>> {
    return this.list('mapSummaries', 'revisionHash', query);
  }
  async listWalks(query: ListQuery = {}): Promise<Page<WalkSummary>> {
    return this.list('walkSummaries', 'sessionId', query);
  }
  private async list<T extends MapSummary | WalkSummary>(
    store: 'mapSummaries' | 'walkSummaries',
    idKey: 'revisionHash' | 'sessionId',
    query: ListQuery,
  ): Promise<Page<T>> {
    const limit = query.limit ?? 30,
      sort = query.sort ?? 'updated-desc';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new StorageError('INVALID_LIMIT', 'Размер страницы — 1–100.');
    const search = normalizeTitle(query.search ?? ''),
      filter = canonical({ search, status: query.status ?? null, mapHash: query.mapHash ?? null });
    if (query.cursor && (query.cursor.sort !== sort || query.cursor.filter !== filter))
      throw new StorageError(
        'INVALID_CURSOR',
        'Параметры списка изменились. Начните с первой страницы.',
      );
    let range: IDBKeyRange | undefined;
    if (query.cursor)
      range =
        sort === 'updated-desc'
          ? this.ranges.upperBound(query.cursor.key, true)
          : this.ranges.lowerBound(query.cursor.key, true);
    return transaction(
      this.database,
      [store],
      'readonly',
      (tx) =>
        new Promise<Page<T>>((resolve, reject) => {
          const index = tx
              .objectStore(store)
              .index(sort === 'updated-desc' ? 'updatedAt-id' : 'title-id'),
            cursor = index.openCursor(range, sort === 'updated-desc' ? 'prev' : 'next'),
            items: T[] = [];
          const key = (item: T): [string | number, string] => [
            sort === 'updated-desc' ? item.updatedAt : item.titleNormalized,
            (item as unknown as Record<string, string>)[idKey]!,
          ];
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) {
              resolve({ items, nextCursor: null });
              return;
            }
            const item = c.value as T;
            if (
              (!search || item.titleNormalized.includes(search)) &&
              (!query.status || item.status === query.status) &&
              (!query.mapHash || ('mapHash' in item && item.mapHash === query.mapHash))
            ) {
              if (items.length === limit) {
                const nextCursor: ListCursor = { sort, key: key(items[items.length - 1]!), filter };
                resolve({ items, nextCursor });
                return;
              }
              items.push(item);
            }
            c.continue();
          };
        }),
      query.signal,
    );
  }
  async saveDraft(
    projectId: string,
    value: unknown,
    baseRevisionHash: string | null,
    commandRevision: number,
    now = Date.now(),
  ): Promise<void> {
    const document = normalizeDocument(value);
    if (!Number.isSafeInteger(commandRevision) || commandRevision < 0)
      throw new StorageError('INVALID_REVISION', 'Invalid command revision');
    timestamp(now);
    await transaction(this.database, ['drafts'], 'readwrite', async (tx) => {
      const previous = (await request(tx.objectStore('drafts').get(projectId))) as
        | Draft
        | undefined;
      if (previous && previous.commandRevision > commandRevision)
        throw new StorageError('STALE_DRAFT', 'Более новый черновик уже сохранён.');
      if (
        previous &&
        previous.commandRevision === commandRevision &&
        canonical(previous.document) !== canonical(document)
      )
        throw new StorageError('DRAFT_CONFLICT', 'Одинаковая ревизия имеет разные изменения.');
      tx.objectStore('drafts').put({
        projectId,
        document,
        commandRevision,
        baseRevisionHash,
        updatedAt: now,
      } satisfies Draft);
    });
  }
  async getDraft(projectId: string): Promise<Draft | null> {
    const draft = await transaction(
      this.database,
      ['drafts'],
      'readonly',
      async (tx) => (await request(tx.objectStore('drafts').get(projectId))) as Draft | undefined,
    );
    if (!draft) return null;
    return { ...draft, document: normalizeDocument(draft.document) };
  }
  async listDrafts(): Promise<Draft[]> {
    return transaction(
      this.database,
      ['drafts'],
      'readonly',
      async (tx) => (await request(tx.objectStore('drafts').getAll())) as Draft[],
    );
  }
  async listDraftSummaries(): Promise<DraftSummary[]> {
    return transaction(
      this.database,
      ['drafts'],
      'readonly',
      async (tx) =>
        new Promise<DraftSummary[]>((resolve, reject) => {
          const result: DraftSummary[] = [],
            cursor = tx.objectStore('drafts').openCursor();
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) {
              resolve(
                result.sort(
                  (a, b) => b.updatedAt - a.updatedAt || (a.projectId < b.projectId ? -1 : 1),
                ),
              );
              return;
            }
            const draft = current.value as Draft;
            result.push({
              projectId: draft.projectId,
              title:
                typeof draft.document?.metadata?.title === 'string'
                  ? draft.document.metadata.title
                  : 'Повреждённый черновик',
              commandRevision: draft.commandRevision,
              baseRevisionHash: draft.baseRevisionHash,
              updatedAt: draft.updatedAt,
              modules: Array.isArray(draft.document?.instances)
                ? draft.document.instances.length
                : 0,
            });
            current.continue();
          };
        }),
    );
  }
  async getProject(projectId: string): Promise<Project | null> {
    return transaction(
      this.database,
      ['projects'],
      'readonly',
      async (tx) => ((await request(tx.objectStore('projects').get(projectId))) as Project) ?? null,
    );
  }
  async renameProject(projectId: string, value: string, now = Date.now()): Promise<void> {
    const name = title(value);
    timestamp(now);
    await transaction(this.database, ['projects', 'mapSummaries'], 'readwrite', async (tx) => {
      const project = (await request(tx.objectStore('projects').get(projectId))) as
        | Project
        | undefined;
      if (!project) throw new StorageError('NOT_FOUND', 'Проект не найден.');
      tx.objectStore('projects').put({ ...project, title: name, updatedAt: now });
      const summary = (await request(
        tx.objectStore('mapSummaries').get(project.currentRevisionHash),
      )) as MapSummary | undefined;
      if (summary?.projectId === projectId)
        tx.objectStore('mapSummaries').put({
          ...summary,
          title: name,
          titleNormalized: normalizeTitle(name),
          updatedAt: now,
        });
    });
  }
  /** Preview is required by the UI before calling the explicit deletion method. */
  async deletionPreview(
    projectId: string,
  ): Promise<{ project: Project; walks: number; retainedMap: boolean }> {
    return transaction(this.database, ['projects', 'sessions'], 'readonly', async (tx) => {
      const project = (await request(tx.objectStore('projects').get(projectId))) as
        | Project
        | undefined;
      if (!project) throw new StorageError('NOT_FOUND', 'Проект не найден.');
      const projects = (await request(tx.objectStore('projects').getAll())) as Project[],
        sessions = (await request(tx.objectStore('sessions').getAll())) as Session[];
      const walks = sessions.filter((s) => s.mapHash === project.currentRevisionHash).length;
      return {
        project,
        walks,
        retainedMap:
          walks > 0 ||
          projects.some(
            (p) =>
              p.projectId !== projectId && p.currentRevisionHash === project.currentRevisionHash,
          ),
      };
    });
  }
  async deleteProject(projectId: string): Promise<void> {
    await transaction(this.database, ['projects', 'drafts'], 'readwrite', async (tx) => {
      tx.objectStore('projects').delete(projectId);
      tx.objectStore('drafts').delete(projectId);
    });
    await this.collectGarbage();
  }
  async deleteWalk(sessionId: string): Promise<void> {
    await transaction(
      this.database,
      ['sessions', 'walkSummaries', 'walkChunks'],
      'readwrite',
      async (tx) => {
        tx.objectStore('sessions').delete(sessionId);
        tx.objectStore('walkSummaries').delete(sessionId);
        tx.objectStore('walkChunks').delete(
          this.ranges.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]),
        );
      },
    );
    await this.collectGarbage();
  }
  async collectGarbage(): Promise<void> {
    await transaction(
      this.database,
      ['projects', 'drafts', 'sessions', 'maps', 'mapSummaries', 'definitions', 'analyses'],
      'readwrite',
      async (tx) => {
        const projects = (await request(tx.objectStore('projects').getAll())) as Project[],
          drafts = (await request(tx.objectStore('drafts').getAll())) as Draft[],
          sessions = (await request(tx.objectStore('sessions').getAll())) as Session[];
        const referenced = new Set([
            ...projects.map((p) => p.currentRevisionHash),
            ...drafts.flatMap((d) => (d.baseRevisionHash ? [d.baseRevisionHash] : [])),
            ...sessions.map((s) => s.mapHash),
          ]),
          definitionHashes = new Set<string>();
        const maps = (await request(tx.objectStore('maps').getAll())) as StoredMap[];
        for (const map of maps) {
          if (!referenced.has(map.revisionHash)) {
            tx.objectStore('maps').delete(map.revisionHash);
            tx.objectStore('mapSummaries').delete(map.revisionHash);
          } else map.definitionHashes.forEach((h) => definitionHashes.add(h));
        }
        for (const draft of drafts)
          draft.document.definitions.forEach((d) => definitionHashes.add(d.contentHash));
        const definitions = await request(tx.objectStore('definitions').getAllKeys());
        for (const hash of definitions)
          if (!definitionHashes.has(hash as string)) tx.objectStore('definitions').delete(hash);
      },
    );
  }
  async exportRawMap(hash: string): Promise<unknown> {
    return transaction(this.database, ['maps'], 'readonly', async (tx) =>
      request(tx.objectStore('maps').get(hash)),
    );
  }
  async cleanupStaging(): Promise<void> {
    await transaction(this.database, ['importStaging'], 'readwrite', async (tx) => {
      tx.objectStore('importStaging').clear();
    });
  }
}
