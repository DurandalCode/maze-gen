import { canonical, documentHashes, hashValue, navHash, worldHash, VERSIONS } from '../domain';
import type { MapRevision, Versions } from '../domain';
import { contourPolygon } from '../geometry/kernel/contour';
import { bounds } from '../geometry/predicates';
import { makeChunk } from '../session/format';
import type { Session, WalkChunk } from '../session/types';
import { MazeRepository } from '../repository/repository';
import { request, StorageError, transaction } from '../repository/schema';
import type { Store } from '../repository/schema';
import type { MapSummary, Project, WalkSummary, StoredMap } from '../repository/types';
import type { Definition } from '../domain';
import { hydrate } from './package';
import type { MazePackage, PackageCounts, ValidatedPackage } from './package';

export interface GeometryProof {
  revisionHash: string;
  worldHash: string;
  navHash: string;
  versions: Versions;
}
export interface ImportPreview {
  importId: string;
  counts: PackageCounts;
  duplicates: { definitions: number; maps: number; projects: number; sessions: number };
  projectCopies: { projectId: string; title: string }[];
  sessionConflicts: string[];
}
interface Header {
  importId: string;
  entityKey: '!header';
  value: { counts: PackageCounts; mapHashes: string[]; exportedAt: string; validated: boolean };
}
interface Entity {
  importId: string;
  entityKey: string;
  store: Store;
  value: unknown;
}
interface Write {
  store: Store;
  key: IDBValidKey;
  value: unknown;
}
interface Guard {
  store: Store;
  key: IDBValidKey;
  body: string;
}
interface Plan {
  preview: ImportPreview;
  writes: Write[];
  guards: Guard[];
}
const fail = (code: string, message: string): never => {
  throw new StorageError(code, message);
};
const json = (value: unknown) => (value === undefined ? 'undefined' : canonical(value));
const stores: Store[] = [
  'definitions',
  'maps',
  'mapSummaries',
  'projects',
  'sessions',
  'walkSummaries',
  'walkChunks',
  'importStaging',
];
export class ImportRepository {
  constructor(
    readonly repo: MazeRepository,
    private readonly ranges: typeof IDBKeyRange = IDBKeyRange,
  ) {}
  private range(id: string) {
    return this.ranges.bound([id, ''], [id, '\uffff']);
  }
  async stage(
    validated: ValidatedPackage,
    importId = crypto.randomUUID(),
  ): Promise<{ importId: string; counts: PackageCounts; mapHashes: string[] }> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(importId)) fail('INVALID_ID', 'Неверный importId');
    const p = validated.package,
      rows: Entity[] = [];
    for (const d of p.definitions)
      rows.push({
        importId,
        entityKey: `definition:${d.contentHash}`,
        store: 'definitions',
        value: d,
      });
    for (const m of p.maps)
      rows.push({ importId, entityKey: `map:${m.revisionHash}`, store: 'maps', value: m });
    for (const project of p.projects)
      rows.push({
        importId,
        entityKey: `project:${project.projectId}`,
        store: 'projects',
        value: project,
      });
    for (const s of p.sessions)
      rows.push({ importId, entityKey: `session:${s.sessionId}`, store: 'sessions', value: s });
    for (const c of p.chunks)
      rows.push({
        importId,
        entityKey: `chunk:${c.sessionId}:${c.sequence}`,
        store: 'walkChunks',
        value: c,
      });
    const mapHashes = p.maps.map((m) => m.revisionHash);
    const header: Header = {
      importId,
      entityKey: '!header',
      value: { counts: validated.counts, mapHashes, exportedAt: p.exportedAt, validated: false },
    };
    await transaction(this.repo.database, ['importStaging'], 'readwrite', async (tx) => {
      const staging = tx.objectStore('importStaging');
      if (await request(staging.get([importId, '!header'])))
        fail('IMPORT_EXISTS', 'Такой импорт уже подготовлен');
      staging.add(header);
      for (const row of rows) staging.add(row);
    });
    return { importId, counts: validated.counts, mapHashes };
  }
  private async read(importId: string): Promise<{ header: Header; package: MazePackage }> {
    const rows = (await transaction(this.repo.database, ['importStaging'], 'readonly', async (tx) =>
      request(tx.objectStore('importStaging').getAll(this.range(importId))),
    )) as (Header | Entity)[];
    const header = rows.find((r) => r.entityKey === '!header') as Header | undefined;
    if (!header)
      return fail('IMPORT_NOT_FOUND', 'Подготовленный импорт не найден. Выберите файл ещё раз.');
    const select = <T>(store: Store) =>
      rows.filter((r) => 'store' in r && r.store === store).map((r) => r.value as T);
    const p: MazePackage = {
      kind: 'maze-reboot-package',
      schemaVersion: 1,
      exportedAt: header.value.exportedAt,
      definitions: select('definitions'),
      maps: select('maps'),
      projects: select('projects'),
      sessions: select('sessions'),
      chunks: select('walkChunks'),
      manifest: { counts: header.value.counts, entityHashes: {} },
    };
    return { header, package: p };
  }
  async map(importId: string, hash: string): Promise<MapRevision> {
    const { map, definitions } = await transaction(
      this.repo.database,
      ['importStaging'],
      'readonly',
      async (tx) => {
        const store = tx.objectStore('importStaging');
        const row = (await request(store.get([importId, `map:${hash}`]))) as Entity | undefined;
        const map = (row ?? fail('MISSING_MAP', 'Нет карты в выбранном пакете')).value as StoredMap,
          definitions: Definition[] = [];
        for (const h of map.definitionHashes) {
          const d = (await request(store.get([importId, `definition:${h}`]))) as Entity | undefined;
          definitions.push(
            (d ?? fail('MISSING_DEPENDENCY', 'Нет staged определения')).value as Definition,
          );
        }
        return { map, definitions };
      },
    );
    return {
      revisionHash: hash,
      document: hydrate(map, definitions),
      versions: map.versions,
      validationSummary: map.validationSummary,
    };
  }
  /** Proofs are the results of the application's compute-worker jobs, never flags read from JSON. */
  async validateGeometry(importId: string, proofs: GeometryProof[]): Promise<ImportPreview> {
    const { header, package: p } = await this.read(importId);
    if (
      !Array.isArray(proofs) ||
      proofs.length !== p.maps.length ||
      new Set(proofs.map((p) => p.revisionHash)).size !== proofs.length
    )
      fail('IMPORT_NOT_VALIDATED', 'Не все карты проверены compute-worker');
    for (const map of p.maps) {
      const proof = proofs.find((p) => p.revisionHash === map.revisionHash);
      const document = hydrate(map, p.definitions),
        hashes = documentHashes(document),
        expectedWorld = worldHash(hashes.layoutHash);
      if (
        !proof ||
        proof.revisionHash !== hashes.revisionHash ||
        proof.worldHash !== expectedWorld ||
        proof.navHash !== navHash(expectedWorld, document.physicalProfile.playerRadiusM) ||
        canonical(proof.versions) !== canonical(VERSIONS)
      )
        fail('IMPORT_NOT_VALIDATED', 'Результат compute-worker не соответствует staged-карте');
    }
    const { preview } = await this.plan(importId, p, false);
    await transaction(this.repo.database, ['importStaging'], 'readwrite', async (tx) => {
      header.value.validated = true;
      tx.objectStore('importStaging').put(header);
    });
    return preview;
  }
  private async plan(
    importId: string,
    p: MazePackage,
    copyConflicts: boolean,
    signal?: AbortSignal,
  ): Promise<Plan> {
    const preview: ImportPreview = {
        importId,
        counts: p.manifest.counts,
        duplicates: { definitions: 0, maps: 0, projects: 0, sessions: 0 },
        projectCopies: [],
        sessionConflicts: [],
      },
      writes: Write[] = [],
      guards: Guard[] = [];
    const read = async <T>(store: Store, key: IDBValidKey): Promise<T | undefined> => {
      if (signal?.aborted) fail('CANCELLED', 'Импорт отменён до коммита');
      const value = (await transaction(this.repo.database, [store], 'readonly', async (tx) =>
        request(tx.objectStore(store).get(key)),
      )) as T | undefined;
      guards.push({ store, key, body: json(value) });
      return value;
    };
    for (const d of p.definitions) {
      const old = await read('definitions', d.contentHash);
      if (old) {
        if (canonical(old) !== canonical(d))
          fail('CORRUPT_DEFINITION', 'Существующее определение с таким hash повреждено');
        preview.duplicates.definitions++;
      } else writes.push({ store: 'definitions', key: d.contentHash, value: d });
    }
    const projects = [...p.projects];
    // A package containing only a map still receives a project so it remains in the library/GC roots.
    for (const m of p.maps)
      if (!projects.some((project) => project.currentRevisionHash === m.revisionHash))
        projects.push({
          projectId: `import-${m.revisionHash.slice(0, 32)}`,
          title: m.document.metadata.title,
          currentRevisionHash: m.revisionHash,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
    for (const m of p.maps) {
      const old = await read('maps', m.revisionHash);
      if (old) {
        await this.repo.getMap(m.revisionHash);
        preview.duplicates.maps++;
      } else writes.push({ store: 'maps', key: m.revisionHash, value: m });
    }
    const projectTargets = new Map<string, Project>();
    for (const project of projects) {
      const old = await read<Project>('projects', project.projectId);
      if (
        old &&
        old.currentRevisionHash === project.currentRevisionHash &&
        old.title === project.title
      ) {
        preview.duplicates.projects++;
        projectTargets.set(project.currentRevisionHash, old);
        continue;
      }
      let target = project;
      if (old) {
        target = {
          ...project,
          projectId: `import-${hashValue([project.projectId, project.currentRevisionHash, project.title]).slice(0, 48)}`,
          title: `${project.title.slice(0, 220)} (импорт: ${project.projectId.slice(0, 16)})`,
          originId: project.projectId,
        };
        let existingCopy = await read<Project>('projects', target.projectId);
        if (existingCopy) {
          if (
            existingCopy.currentRevisionHash !== target.currentRevisionHash ||
            existingCopy.title !== target.title
          ) {
            const alternatives = (await transaction(
              this.repo.database,
              ['projects'],
              'readonly',
              async (tx) => request(tx.objectStore('projects').getAll()),
            )) as Project[];
            const match = alternatives.find(
              (p) =>
                p.originId === project.projectId &&
                p.currentRevisionHash === target.currentRevisionHash &&
                p.title === target.title,
            );
            existingCopy = match ? await read<Project>('projects', match.projectId) : undefined;
          }
          if (existingCopy) {
            preview.duplicates.projects++;
            projectTargets.set(target.currentRevisionHash, existingCopy);
            continue;
          }
          target = { ...target, projectId: crypto.randomUUID() };
          if (await read('projects', target.projectId)) fail('ID_COLLISION', 'Повторите импорт');
        }
        preview.projectCopies.push({ projectId: project.projectId, title: project.title });
      }
      writes.push({ store: 'projects', key: target.projectId, value: target });
      projectTargets.set(target.currentRevisionHash, target);
    }
    for (const m of p.maps) {
      const old = await read<MapSummary>('mapSummaries', m.revisionHash);
      if (old) continue;
      const project = projectTargets.get(m.revisionHash)!;
      const b = bounds(contourPolygon(m.document.site.boundaryLoops)[0]!);
      const summary: MapSummary = {
        revisionHash: m.revisionHash,
        projectId: project.projectId,
        title: project.title,
        titleNormalized: project.title.normalize('NFC').toLowerCase(),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        status: 'ready',
        widthM: b.maxX - b.minX,
        depthM: b.maxZ - b.minZ,
        modules: m.document.instances.length,
        connections: m.document.connections.length,
      };
      writes.push({ store: 'mapSummaries', key: m.revisionHash, value: summary });
    }
    for (const s of p.sessions) {
      const old = await read<Session>('sessions', s.sessionId),
        chunks = p.chunks
          .filter((c) => c.sessionId === s.sessionId)
          .sort((a, b) => a.sequence - b.sequence);
      let duplicate = !!old && canonical(old) === canonical(s);
      if (duplicate)
        for (const c of chunks) {
          const existing = await read<WalkChunk>('walkChunks', [s.sessionId, c.sequence]);
          if (
            !existing ||
            existing.contentHash !== c.contentHash ||
            canonical(existing) !== canonical(c)
          ) {
            duplicate = false;
            break;
          }
        }
      if (duplicate) {
        preview.duplicates.sessions++;
        continue;
      }
      let target = s;
      if (old) {
        preview.sessionConflicts.push(s.sessionId);
        if (!copyConflicts) continue;
        target = { ...s, sessionId: crypto.randomUUID(), originId: s.sessionId };
        if (await read('sessions', target.sessionId))
          fail('ID_COLLISION', 'Повторите подготовку импорта');
      }
      writes.push({ store: 'sessions', key: target.sessionId, value: target });
      const summary: WalkSummary = {
        sessionId: target.sessionId,
        mapHash: target.mapHash,
        title: target.originId ? 'Импортированная копия прохождения' : 'Прохождение',
        titleNormalized: target.originId ? 'импортированная копия прохождения' : 'прохождение',
        status: target.state,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
        elapsedMs: target.elapsedMs,
        distanceM: target.distanceM,
        lastCommittedSequence: target.lastCommittedSequence,
      };
      writes.push({ store: 'walkSummaries', key: target.sessionId, value: summary });
      for (const [index, c] of chunks.entries()) {
        if (index % 32 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (signal?.aborted) fail('CANCELLED', 'Импорт отменён до коммита');
        }
        const { contentHash: _, ...body } = c;
        const chunk =
          target.sessionId === s.sessionId
            ? c
            : makeChunk({ ...body, sessionId: target.sessionId });
        if (!old && (await read('walkChunks', [target.sessionId, c.sequence])))
          fail('CONFLICT', 'Часть попытки уже существует без заголовка');
        writes.push({ store: 'walkChunks', key: [target.sessionId, c.sequence], value: chunk });
      }
    }
    return { preview, writes, guards };
  }
  async commit(
    importId: string,
    copyConflictingSessions = false,
    signal?: AbortSignal,
  ): Promise<{ committed: true; inserted: number; preview: ImportPreview }> {
    const { header, package: p } = await this.read(importId);
    if (!header.value.validated)
      fail('IMPORT_NOT_VALIDATED', 'Сначала проверьте все карты compute-worker');
    const plan = await this.plan(importId, p, copyConflictingSessions, signal);
    if (plan.preview.sessionConflicts.length && !copyConflictingSessions)
      fail(
        'SESSION_CONFLICT',
        'Выберите импорт конфликтующих попыток как новых копий или отмените импорт',
      );
    // All schema/hash/geometry work, summaries and re-keyed chunk hashes are ready before opening the write transaction.
    return transaction(
      this.repo.database,
      stores,
      'readwrite',
      async (tx) => {
        if (!(await request(tx.objectStore('importStaging').get([importId, '!header']))))
          fail('IMPORT_NOT_FOUND', 'Импорт отменён');
        for (const guard of plan.guards) {
          const current = await request(tx.objectStore(guard.store).get(guard.key));
          if (json(current) !== guard.body)
            fail('CONFLICT_CHANGED', 'Библиотека изменилась. Повторите проверку конфликтов.');
        }
        for (const write of plan.writes) tx.objectStore(write.store).put(write.value);
        tx.objectStore('importStaging').delete(this.range(importId));
        return { committed: true, inserted: plan.writes.length, preview: plan.preview };
      },
      signal,
    );
  }
  async cancel(importId: string): Promise<void> {
    await transaction(this.repo.database, ['importStaging'], 'readwrite', async (tx) => {
      tx.objectStore('importStaging').delete(this.range(importId));
    });
  }
}
