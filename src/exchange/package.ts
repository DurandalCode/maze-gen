import { canonical, documentHashes, hashValue, normalizeDocument, VERSIONS } from '../domain';
import { normalizeGenerationOrigin } from '../generation/manifest';
import type { Definition, Document, MapRevision } from '../domain';
import { validateCatalogDefinition } from '../catalog/catalog';
import { parseChunk, parseCondition, normalizeSample } from '../session/format';
import type { Session, WalkChunk } from '../session/types';
import type { Project, StoredMap } from '../repository/types';
import { StorageError } from '../repository/schema';

export const PACKAGE_LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  maps: 100,
  sessions: 1000,
  samples: 1_000_000,
  chunks: 100_000,
  definitions: 2000,
});
export interface PackageEntities {
  definitions: Definition[];
  maps: StoredMap[];
  projects: Project[];
  sessions: Session[];
  chunks: WalkChunk[];
}
export interface PackageCounts {
  definitions: number;
  maps: number;
  projects: number;
  sessions: number;
  chunks: number;
  samples: number;
}
export interface MazePackage extends PackageEntities {
  kind: 'maze-reboot-package';
  schemaVersion: 1;
  exportedAt: string;
  manifest: { counts: PackageCounts; entityHashes: Record<string, string> };
  extensions?: Record<string, unknown>;
}
export interface ValidatedPackage {
  package: MazePackage;
  revisions: MapRevision[];
  counts: PackageCounts;
}
const error = (code: string, text: string): never => {
  throw new StorageError(code, text);
};
function object(value: unknown, fields: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return error('PACKAGE_SCHEMA', `${path}: ожидается объект`);
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o))
    if (!fields.includes(key)) error('UNKNOWN_FIELD', `${path}.${key}: неизвестное поле`);
  return o;
}
function text(value: unknown, path: string, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max)
    return error('PACKAGE_SCHEMA', `${path}: неверная строка`);
  return value;
}
function hash(value: unknown, path: string): string {
  const s = text(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(s)) error('PACKAGE_SCHEMA', `${path}: неверный hash`);
  return s;
}
function integer(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    return error('PACKAGE_SCHEMA', `${path}: неверное целое число`);
  return value as number;
}
function finite(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    return error('PACKAGE_SCHEMA', `${path}: неверное число`);
  return value;
}
function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return error('RESOURCE_LIMIT', `${path}: превышен лимит ${max}`);
  return value;
}
function unique<T>(items: T[], key: (item: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (result.has(id)) error('DUPLICATE_ID', `${path}: ${id}`);
    result.set(id, item);
  }
  return result;
}
function session(value: unknown): Session {
  const o = object(
    value,
    [
      'sessionId',
      'mapHash',
      'condition',
      'state',
      'elapsedMs',
      'distanceM',
      'lastCommittedSequence',
      'lastSample',
      'createdAt',
      'updatedAt',
      'originId',
    ],
    'session',
  );
  if (
    !['prepared', 'running', 'paused', 'interrupted', 'finished', 'stopped'].includes(
      o.state as string,
    )
  )
    error('PACKAGE_SCHEMA', 'Неверное состояние попытки');
  const elapsedMs = finite(o.elapsedMs, 'session.elapsedMs', 1e12),
    distanceM = finite(o.distanceM, 'session.distanceM', 1e9);
  const lastSample = o.lastSample === null ? null : normalizeSample(o.lastSample);
  const createdAt = integer(o.createdAt, 'session.createdAt'),
    updatedAt = integer(o.updatedAt, 'session.updatedAt');
  if (updatedAt < createdAt || (lastSample && lastSample.activeTimeMs > elapsedMs))
    error('TIME_ORDER', 'Неверное время попытки');
  return {
    sessionId: text(o.sessionId, 'sessionId'),
    mapHash: hash(o.mapHash, 'session.mapHash'),
    condition: parseCondition(o.condition),
    state: o.state as Session['state'],
    elapsedMs,
    distanceM,
    lastCommittedSequence: integer(o.lastCommittedSequence, 'sequence', 1e9, -1),
    lastSample,
    createdAt,
    updatedAt,
    ...(o.originId === undefined ? {} : { originId: text(o.originId, 'originId') }),
  };
}
export function counts(entities: PackageEntities): PackageCounts {
  return {
    definitions: entities.definitions.length,
    maps: entities.maps.length,
    projects: entities.projects.length,
    sessions: entities.sessions.length,
    chunks: entities.chunks.length,
    samples: entities.chunks.reduce((sum, c) => sum + c.samples.length, 0),
  };
}
export function entityHashes(entities: PackageEntities): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const d of entities.definitions) hashes[`definition:${d.contentHash}`] = hashValue(d);
  for (const m of entities.maps) hashes[`map:${m.revisionHash}`] = hashValue(m);
  for (const p of entities.projects) hashes[`project:${p.projectId}`] = hashValue(p);
  for (const s of entities.sessions) hashes[`session:${s.sessionId}`] = hashValue(s);
  for (const c of entities.chunks) hashes[`chunk:${c.sessionId}:${c.sequence}`] = hashValue(c);
  return hashes;
}
export function makePackage(
  entities: PackageEntities,
  exportedAt = new Date().toISOString(),
): MazePackage {
  return {
    kind: 'maze-reboot-package',
    schemaVersion: 1,
    exportedAt,
    ...entities,
    manifest: { counts: counts(entities), entityHashes: entityHashes(entities) },
  };
}
/** Runs in a worker. Byte limit is checked before JSON allocation and all array limits before walking entities. */
export function parsePackage(source: string): ValidatedPackage {
  if (
    typeof source !== 'string' ||
    source.length > PACKAGE_LIMITS.bytes ||
    new TextEncoder().encode(source).byteLength > PACKAGE_LIMITS.bytes
  )
    return error('FILE_TOO_LARGE', 'Один пакет не может превышать 32 MiB UTF-8.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return error('INVALID_JSON', 'Файл не является корректным JSON.');
  }
  return validatePackage(value);
}
export function validatePackage(value: unknown): ValidatedPackage {
  const o = object(
    value,
    [
      'kind',
      'schemaVersion',
      'exportedAt',
      'definitions',
      'maps',
      'projects',
      'sessions',
      'chunks',
      'manifest',
      'extensions',
    ],
    'package',
  );
  if (o.kind !== 'maze-reboot-package' || o.schemaVersion !== 1)
    return error(
      'UNSUPPORTED_FORMAT',
      'Поддерживаются только пакеты maze-reboot-package версии 1. Старые форматы не мигрируются.',
    );
  const exportedAt = text(o.exportedAt, 'exportedAt', 64);
  if (!Number.isFinite(Date.parse(exportedAt))) error('PACKAGE_SCHEMA', 'Неверная дата экспорта');
  const rawDefinitions = array(o.definitions, PACKAGE_LIMITS.definitions, 'definitions');
  const rawMaps = array(o.maps, PACKAGE_LIMITS.maps, 'maps');
  // Projects can share an immutable map; their count is bounded by the file's
  // byte limit, rather than incorrectly treating every project as another map.
  const rawProjects = array(o.projects ?? [], PACKAGE_LIMITS.bytes, 'projects');
  const rawSessions = array(o.sessions, PACKAGE_LIMITS.sessions, 'sessions');
  const rawChunks = array(o.chunks, PACKAGE_LIMITS.chunks, 'chunks');
  let sampleCount = 0;
  for (const c of rawChunks) {
    if (!c || typeof c !== 'object' || !('samples' in c)) error('PACKAGE_SCHEMA', 'Нет samples');
    sampleCount += array((c as { samples: unknown }).samples, 256, 'chunk.samples').length;
    if (sampleCount > PACKAGE_LIMITS.samples) error('RESOURCE_LIMIT', 'Превышен лимит samples');
  }
  const definitions = rawDefinitions.map(validateCatalogDefinition),
    byDefinition = unique(definitions, (d) => d.contentHash, 'definitions');
  const maps: StoredMap[] = [],
    revisions: MapRevision[] = [];
  for (const raw of rawMaps) {
    const m = object(
      raw,
      [
        'revisionHash',
        'document',
        'definitionHashes',
        'versions',
        'validationSummary',
        'generationOrigin',
      ],
      'map',
    );
    const revisionHash = hash(m.revisionHash, 'revisionHash');
    const hashes = array(m.definitionHashes, PACKAGE_LIMITS.definitions, 'definitionHashes').map(
      (v) => hash(v, 'definitionHash'),
    );
    if (new Set(hashes).size !== hashes.length) error('DUPLICATE_ID', 'Повтор definitionHash');
    const dependencies = hashes.map(
      (h) => byDefinition.get(h) ?? error('MISSING_DEPENDENCY', `Нет определения ${h}`),
    );
    if (canonical(m.versions) !== canonical(VERSIONS))
      error('UNSUPPORTED_VERSION', 'Версия геометрии/навигации не поддерживается');
    const body = object(
      m.document,
      [
        'schemaVersion',
        'documentId',
        'revision',
        'site',
        'instances',
        'openings',
        'connections',
        'freeWalls',
        'physicalProfile',
        'environment',
        'metadata',
      ],
      'map.document',
    );
    const document = normalizeDocument({ ...body, definitions: dependencies });
    if (documentHashes(document).revisionHash !== revisionHash)
      error('HASH_MISMATCH', 'Ревизия карты не совпадает с её содержимым');
    const validation = object(m.validationSummary, ['ready', 'diagnostics'], 'validationSummary');
    if (
      validation.ready !== true ||
      !Array.isArray(validation.diagnostics) ||
      validation.diagnostics.length
    )
      error('NOT_READY', 'Пакет содержит непроверенную карту');
    const origin = m.generationOrigin
      ? { generationOrigin: normalizeGenerationOrigin(m.generationOrigin) }
      : {};
    const { definitions: _, ...storedDocument } = document;
    maps.push({
      ...origin,
      revisionHash,
      document: storedDocument,
      definitionHashes: hashes,
      versions: { ...VERSIONS },
      validationSummary: { ready: true, diagnostics: [] },
    });
    revisions.push({
      ...origin,
      revisionHash,
      document,
      versions: { ...VERSIONS },
      validationSummary: { ready: true, diagnostics: [] },
    });
  }
  const byMap = unique(maps, (m) => m.revisionHash, 'maps');
  const projects = rawProjects.map((raw) => {
    const p = object(
      raw,
      ['projectId', 'title', 'currentRevisionHash', 'createdAt', 'updatedAt', 'originId'],
      'project',
    );
    const currentRevisionHash = hash(p.currentRevisionHash, 'currentRevisionHash');
    if (!byMap.has(currentRevisionHash)) error('MISSING_DEPENDENCY', 'Нет карты проекта');
    const title = text(p.title, 'project.title', 256).trim();
    if (!title) error('PACKAGE_SCHEMA', 'Пустое название');
    const createdAt = integer(p.createdAt, 'project.createdAt'),
      updatedAt = integer(p.updatedAt, 'project.updatedAt');
    if (updatedAt < createdAt) error('TIME_ORDER', 'Неверное время проекта');
    return {
      projectId: text(p.projectId, 'projectId'),
      title,
      currentRevisionHash,
      createdAt,
      updatedAt,
      ...(p.originId === undefined ? {} : { originId: text(p.originId, 'project.originId') }),
    };
  });
  unique(projects, (p) => p.projectId, 'projects');
  const sessions = rawSessions.map(session),
    bySession = unique(sessions, (s) => s.sessionId, 'sessions');
  for (const s of sessions) {
    const map = byMap.get(s.mapHash) ?? error('MISSING_DEPENDENCY', 'Нет карты попытки');
    if (canonical(s.condition.environment) !== canonical(map.document.environment))
      error('CONDITION_MISMATCH', 'Окружение попытки отличается от сохранённой карты');
  }
  const chunks = rawChunks.map(parseChunk);
  unique(chunks, (c) => `${c.sessionId}:${c.sequence}`, 'chunks');
  const groups = new Map<string, WalkChunk[]>();
  for (const c of chunks) {
    if (!bySession.has(c.sessionId)) error('MISSING_DEPENDENCY', 'Нет заголовка попытки');
    const group = groups.get(c.sessionId) ?? [];
    group.push(c);
    groups.set(c.sessionId, group);
  }
  for (const s of sessions) {
    const group = (groups.get(s.sessionId) ?? []).sort((a, b) => a.sequence - b.sequence);
    if (group.length !== s.lastCommittedSequence + 1)
      error('SEQUENCE_GAP', 'Пакет не содержит полную историю попытки');
    let elapsedMs = 0,
      distanceM = 0;
    for (let i = 0; i < group.length; i++) {
      const c = group[i]!;
      if (c.sequence !== i) error('SEQUENCE_GAP', 'Пропущена часть попытки');
      if (
        c.elapsedMs < elapsedMs ||
        c.distanceM < distanceM ||
        c.samples.some(
          (sample) => sample.activeTimeMs < elapsedMs || sample.inputMode !== s.condition.inputMode,
        )
      )
        error('TIME_ORDER', 'Нарушен порядок/условия записи');
      elapsedMs = c.elapsedMs;
      distanceM = c.distanceM;
    }
    const last = group.at(-1),
      lastSample = last?.samples.at(-1) ?? null;
    if (
      s.elapsedMs !== elapsedMs ||
      s.distanceM !== distanceM ||
      canonical(s.lastSample) !== canonical(lastSample)
    )
      error('SESSION_MISMATCH', 'Итог попытки не совпадает с подтверждёнными частями');
  }
  const entities = { definitions, maps, projects, sessions, chunks },
    actualCounts = counts(entities);
  const manifest = object(o.manifest, ['counts', 'entityHashes'], 'manifest');
  if (
    canonical(manifest.counts) !== canonical(actualCounts) ||
    canonical(manifest.entityHashes) !== canonical(entityHashes(entities))
  )
    error('HASH_MISMATCH', 'Manifest не совпадает с содержимым пакета');
  let extensions: Record<string, unknown> | undefined;
  if (o.extensions !== undefined) {
    if (!o.extensions || typeof o.extensions !== 'object' || Array.isArray(o.extensions))
      error('PACKAGE_SCHEMA', 'extensions должен быть объектом');
    extensions = o.extensions as Record<string, unknown>;
  }
  return {
    package: {
      kind: 'maze-reboot-package',
      schemaVersion: 1,
      exportedAt,
      ...entities,
      manifest: { counts: actualCounts, entityHashes: entityHashes(entities) },
      ...(extensions ? { extensions } : {}),
    },
    revisions,
    counts: actualCounts,
  };
}
export function storedRevision(revision: MapRevision): StoredMap {
  const { definitions, ...document } = revision.document;
  return {
    revisionHash: revision.revisionHash,
    document,
    definitionHashes: definitions.map((d) => d.contentHash),
    versions: revision.versions,
    validationSummary: revision.validationSummary,
    ...(revision.generationOrigin
      ? { generationOrigin: normalizeGenerationOrigin(revision.generationOrigin) }
      : {}),
  };
}
export function hydrate(map: StoredMap, definitions: Definition[]): Document {
  const byHash = new Map(definitions.map((d) => [d.contentHash, d]));
  return normalizeDocument({
    ...map.document,
    definitions: map.definitionHashes.map(
      (h) => byHash.get(h) ?? error('MISSING_DEPENDENCY', `Нет ${h}`),
    ),
  });
}
