import { hashValue } from '../domain';
import type { Definition } from '../domain';
import type { Project, Session, StoredMap } from '../repository/types';
import type { WalkChunk } from '../session/types';
import { MazeRepository } from '../repository/repository';
import { request, StorageError, transaction } from '../repository/schema';
import { PACKAGE_LIMITS, storedRevision } from './package';
import type { PackageCounts, PackageEntities } from './package';
export interface ExportSelection {
  mapHashes: string[];
  sessionIds: string[];
}
export interface ExportPacket {
  bytes: Uint8Array;
  counts: PackageCounts;
  number: number;
  last: boolean;
}
const fields = ['definitions', 'maps', 'projects', 'sessions', 'chunks'] as const;
type Field = (typeof fields)[number];
interface EncodedEntity {
  field: Field;
  key: string;
  json: string;
  bytes: number;
  hash: string;
  samples: number;
}
const encoder = new TextEncoder();
const fail = (code: string, message: string): never => {
  throw new StorageError(code, message);
};
function encode(field: Field, key: string, value: unknown, samples = 0): EncodedEntity {
  const json = JSON.stringify(value);
  return {
    field,
    key,
    json,
    bytes: encoder.encode(json).byteLength,
    hash: hashValue(value),
    samples,
  };
}
class Pack {
  private entities = new Map<string, EncodedEntity>();
  constructor(
    readonly exportedAt: string,
    readonly maxBytes: number,
  ) {}
  count(): PackageCounts {
    const counts: PackageCounts = {
      definitions: 0,
      maps: 0,
      projects: 0,
      sessions: 0,
      chunks: 0,
      samples: 0,
    };
    for (const entity of this.entities.values()) {
      counts[entity.field]++;
      counts.samples += entity.samples;
    }
    return counts;
  }
  get size() {
    return this.entities.size;
  }
  private structure() {
    const arrays = Object.fromEntries(
      fields.map((field) => [field, [...this.entities.values()].filter((e) => e.field === field)]),
    ) as Record<Field, EncodedEntity[]>;
    const entityHashes = Object.fromEntries([...this.entities].map(([key, e]) => [key, e.hash]));
    const prefix = `{"kind":"maze-reboot-package","schemaVersion":1,"exportedAt":${JSON.stringify(this.exportedAt)},`;
    const suffix = `"manifest":${JSON.stringify({ counts: this.count(), entityHashes })}}`;
    let bytes = encoder.encode(prefix).byteLength + encoder.encode(suffix).byteLength;
    for (const field of fields)
      bytes +=
        encoder.encode(`"${field}":[],`).byteLength +
        arrays[field].reduce((sum, e) => sum + e.bytes, 0) +
        Math.max(0, arrays[field].length - 1);
    return { arrays, prefix, suffix, bytes };
  }
  add(item: EncodedEntity[]): boolean {
    const added: string[] = [];
    for (const e of item) {
      if (this.entities.has(e.key)) continue;
      added.push(e.key);
      this.entities.set(e.key, e);
    }
    const counts = this.count();
    const fits =
      counts.maps <= PACKAGE_LIMITS.maps &&
      counts.sessions <= PACKAGE_LIMITS.sessions &&
      counts.samples <= PACKAGE_LIMITS.samples &&
      counts.chunks <= PACKAGE_LIMITS.chunks &&
      counts.definitions <= PACKAGE_LIMITS.definitions &&
      this.structure().bytes <= this.maxBytes;
    if (!fits) for (const key of added) this.entities.delete(key);
    return fits;
  }
  bytes(): Uint8Array {
    const { arrays, prefix, suffix } = this.structure();
    const source =
      prefix +
      fields
        .map((field) => `"${field}":[${arrays[field].map((e) => e.json).join(',')}],`)
        .join('') +
      suffix;
    const bytes = encoder.encode(source);
    if (bytes.byteLength > this.maxBytes)
      fail('ITEM_TOO_LARGE', 'Пакет превышает допустимый размер');
    return bytes;
  }
}
export class ExportRepository {
  constructor(readonly repo: MazeRepository) {}
  private async item(
    kind: 'map' | 'session',
    id: string,
    projects: Project[],
    maxBytes: number,
  ): Promise<EncodedEntity[]> {
    const session = kind === 'session' ? await this.repo.sessions.get(id) : null;
    const revision = await this.repo.getMap(session?.mapHash ?? id);
    const map = storedRevision(revision),
      result: EncodedEntity[] = [encode('maps', `map:${map.revisionHash}`, map)];
    result.push(
      ...revision.document.definitions.map((d: Definition) =>
        encode('definitions', `definition:${d.contentHash}`, d),
      ),
    );
    result.push(
      ...projects
        .filter((p) => p.currentRevisionHash === map.revisionHash)
        .map((p) => encode('projects', `project:${p.projectId}`, p)),
    );
    let size = result.reduce((sum, e) => sum + e.bytes, 0);
    if (session) {
      result.push(encode('sessions', `session:${session.sessionId}`, session));
      for await (const chunk of this.repo.sessions.chunks(session.sessionId)) {
        const encoded = encode(
          'chunks',
          `chunk:${chunk.sessionId}:${chunk.sequence}`,
          chunk,
          chunk.samples.length,
        );
        size += encoded.bytes;
        if (size > maxBytes)
          fail(
            'ITEM_TOO_LARGE',
            `Попытка ${session.sessionId} с полными зависимостями не помещается в один пакет. Файл не усечён.`,
          );
        result.push(encoded);
      }
      // The record may have advanced while chunks were read. Never export a torn header/history.
      const current = await this.repo.sessions.get(session.sessionId);
      if (hashValue(current) !== hashValue(session))
        fail(
          'EXPORT_CHANGED',
          'Попытка изменилась во время экспорта. Поставьте её на паузу и повторите.',
        );
    }
    return result;
  }
  async *packets(
    selection: ExportSelection,
    options: { maxBytes?: number; exportedAt?: string } = {},
  ): AsyncGenerator<ExportPacket> {
    if (
      !selection ||
      !Array.isArray(selection.mapHashes) ||
      !Array.isArray(selection.sessionIds) ||
      selection.mapHashes.length > 100_000 ||
      selection.sessionIds.length > 100_000 ||
      [...selection.mapHashes, ...selection.sessionIds].some(
        (id) => typeof id !== 'string' || !id || id.length > 128,
      )
    )
      fail('INVALID_SELECTION', 'Неверный выбор экспорта');
    const maxBytes = options.maxBytes ?? PACKAGE_LIMITS.bytes;
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > PACKAGE_LIMITS.bytes)
      fail('INVALID_LIMIT', 'Неверный размер пакета');
    const items = [
      ...[...new Set(selection.mapHashes)].sort().map((id) => ({ kind: 'map' as const, id })),
      ...[...new Set(selection.sessionIds)].sort().map((id) => ({ kind: 'session' as const, id })),
    ];
    if (!items.length) fail('EMPTY_SELECTION', 'Выберите карты или попытки для экспорта');
    const projects = (await transaction(this.repo.database, ['projects'], 'readonly', async (tx) =>
      request(tx.objectStore('projects').getAll()),
    )) as Project[];
    const exportedAt = options.exportedAt ?? new Date().toISOString();
    let pack = new Pack(exportedAt, maxBytes),
      number = 1;
    for (const item of items) {
      const encoded = await this.item(item.kind, item.id, projects, maxBytes);
      if (!pack.add(encoded)) {
        const next = new Pack(exportedAt, maxBytes);
        if (!next.add(encoded))
          fail(
            'ITEM_TOO_LARGE',
            `${item.id}: объект с полными зависимостями не помещается в 32 MiB. Файл не усечён.`,
          );
        if (pack.size)
          yield { bytes: pack.bytes(), counts: pack.count(), number: number++, last: false };
        pack = next;
      }
    }
    if (pack.size) yield { bytes: pack.bytes(), counts: pack.count(), number, last: true };
  }
}
