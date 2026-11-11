import { canonical, normalizeDocument } from '../domain';
import type {
  Connection,
  Definition,
  Document,
  FreeWall,
  Instance,
  Opening,
  Point,
} from '../domain';
export type EntityField = 'definitions' | 'instances' | 'openings' | 'connections' | 'freeWalls';
export interface Entities {
  definitions: Definition;
  instances: Instance;
  openings: Opening;
  connections: Connection;
  freeWalls: FreeWall;
}
export type RootField = 'site' | 'physicalProfile' | 'environment' | 'metadata';
export type Change =
  | { [K in EntityField]: { field: K; id: string; value: Entities[K] | null } }[EntityField]
  | { [K in RootField]: { field: K; value: Document[K] } }[RootField];
export interface Selection {
  field: EntityField;
  id: string;
}
export interface Transform {
  position: Point;
  rotationRad: number;
}
export interface Gesture {
  instanceId: string;
  sourceRevision: number;
  original: Transform;
  preview: Transform;
}
export interface EditorState {
  document: Document;
  geometryRevision: number;
  visualRevision: number;
  metadataRevision: number;
  uiRevision: number;
  selection: Selection | null;
  gesture: Gesture | null;
  undoLabel: string | null;
  redoLabel: string | null;
}
interface Patch {
  change: Change;
  before: Change;
}
interface Entry {
  label: string;
  patches: Patch[];
  physical: boolean;
  visual: boolean;
  metadata: boolean;
}
const entityFields: EntityField[] = [
  'definitions',
  'instances',
  'openings',
  'connections',
  'freeWalls',
];
const entity = (field: string): field is EntityField => entityFields.includes(field as EntityField);
const key = (field: EntityField, value: Entities[EntityField]) =>
  field === 'definitions' ? (value as Definition).contentHash : value.id;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function current(document: Document, change: Change): Change {
  if ('id' in change)
    return {
      field: change.field,
      id: change.id,
      value: document[change.field].find((e) => key(change.field, e) === change.id) ?? null,
    } as Change;
  return { field: change.field, value: document[change.field] } as Change;
}
function apply(document: Document, changes: Change[]): Document {
  const next = { ...document, revision: document.revision + 1 };
  const seen = new Set<string>();
  for (const change of changes) {
    const identity = `${change.field}:${'id' in change ? change.id : ''}`;
    if (seen.has(identity)) throw new Error('Одна команда не может менять одно поле дважды');
    seen.add(identity);
    if ('id' in change) {
      if (
        !entity(change.field) ||
        (change.value !== null && key(change.field, change.value) !== change.id)
      )
        throw new Error('Неверный ключ объекта команды');
      const values = (next[change.field] as Entities[EntityField][]).filter(
        (value) => key(change.field, value) !== change.id,
      );
      if (change.value) values.push(change.value);
      (next as unknown as Record<string, unknown>)[change.field] = values;
    } else (next as unknown as Record<string, unknown>)[change.field] = change.value;
  }
  // Domain validity is required; global physical validity is intentionally a separate worker job.
  return normalizeDocument(next);
}
/** A hundred inverse patches, never a hundred complete documents or renderer snapshots. */
export class CommandStore {
  private state: EditorState;
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private listeners = new Set<() => void>();
  constructor(
    value: unknown,
    readonly limit = 100,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('История ограничена 1–100 командами');
    this.state = freeze({
      document: normalizeDocument(value),
      geometryRevision: 0,
      visualRevision: 0,
      metadataRevision: 0,
      uiRevision: 0,
      selection: null,
      gesture: null,
      undoLabel: null,
      redoLabel: null,
    });
  }
  getSnapshot = (): EditorState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  private publish(document: Document, entry: Entry): void {
    let selection = this.state.selection;
    if (
      selection &&
      !document[selection.field].some((value) => key(selection!.field, value) === selection!.id)
    )
      selection = null;
    this.state = freeze({
      ...this.state,
      document,
      selection,
      gesture: null,
      geometryRevision: this.state.geometryRevision + Number(entry.physical),
      visualRevision: this.state.visualRevision + Number(entry.visual),
      metadataRevision: this.state.metadataRevision + Number(entry.metadata),
      undoLabel: this.undoEntries.at(-1)?.label ?? null,
      redoLabel: this.redoEntries.at(-1)?.label ?? null,
    });
    this.notify();
  }
  execute(label: string, changes: Change[]): boolean {
    if (!label.trim() || label.length > 256) throw new Error('Неверное название команды');
    if (this.state.gesture) throw new Error('Сначала завершите или отмените жест');
    const document = apply(this.state.document, changes);
    const patches: Patch[] = [];
    for (const change of changes) {
      const before = current(this.state.document, change),
        after = current(document, change);
      if (canonical(before) !== canonical(after)) patches.push({ change: after, before });
    }
    if (!patches.length) return false;
    const entry: Entry = freeze({
      label,
      patches,
      physical: patches.some(
        (p) => p.change.field !== 'environment' && p.change.field !== 'metadata',
      ),
      visual: patches.some((p) => p.change.field === 'environment'),
      metadata: patches.some((p) => p.change.field === 'metadata'),
    });
    this.undoEntries.push(entry);
    if (this.undoEntries.length > this.limit) this.undoEntries.shift();
    this.redoEntries = [];
    this.publish(document, entry);
    return true;
  }
  undo(): boolean {
    if (this.state.gesture) {
      this.cancelGesture();
      return false;
    }
    const entry = this.undoEntries.at(-1);
    if (!entry) return false;
    const document = apply(
      this.state.document,
      entry.patches.map((p) => p.before),
    );
    this.undoEntries.pop();
    this.redoEntries.push(entry);
    this.publish(document, entry);
    return true;
  }
  redo(): boolean {
    if (this.state.gesture) return false;
    const entry = this.redoEntries.at(-1);
    if (!entry) return false;
    const document = apply(
      this.state.document,
      entry.patches.map((p) => p.change),
    );
    this.redoEntries.pop();
    this.undoEntries.push(entry);
    this.publish(document, entry);
    return true;
  }
  select(selection: Selection | null): void {
    if (
      selection &&
      !this.state.document[selection.field].some(
        (value) => key(selection.field, value) === selection.id,
      )
    )
      throw new Error('Объект выделения не найден');
    if (canonical(selection) === canonical(this.state.selection)) return;
    this.state = freeze({ ...this.state, selection, uiRevision: this.state.uiRevision + 1 });
    this.notify();
  }
  beginGesture(instanceId: string): void {
    if (this.state.gesture) throw new Error('Жест уже начат');
    const instance = this.state.document.instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error('Модуль не найден');
    const original = { position: { ...instance.position }, rotationRad: instance.rotationRad };
    this.state = freeze({
      ...this.state,
      gesture: {
        instanceId,
        sourceRevision: this.state.document.revision,
        original,
        preview: original,
      },
    });
    this.notify();
  }
  previewTransform(transform: Transform): void {
    const gesture = this.state.gesture;
    if (!gesture) throw new Error('Жест не начат');
    if (
      ![transform.position.x, transform.position.z, transform.rotationRad].every(Number.isFinite) ||
      Math.max(Math.abs(transform.position.x), Math.abs(transform.position.z)) > 1e6
    )
      throw new Error('Неверное положение');
    this.state = freeze({
      ...this.state,
      gesture: {
        ...gesture,
        preview: { position: { ...transform.position }, rotationRad: transform.rotationRad },
      },
    });
    this.notify();
  }
  cancelGesture(): void {
    if (!this.state.gesture) return;
    this.state = freeze({ ...this.state, gesture: null });
    this.notify();
  }
  endGesture(): boolean {
    const gesture = this.state.gesture;
    if (!gesture) return false;
    const instance = this.state.document.instances.find((i) => i.id === gesture.instanceId);
    this.cancelGesture();
    if (!instance || gesture.sourceRevision !== this.state.document.revision)
      throw new Error('Исходная ревизия жеста изменилась');
    return this.execute('Перемещение модуля', [
      { field: 'instances', id: instance.id, value: { ...instance, ...gesture.preview } },
    ]);
  }
  historyStats(): { undo: number; redo: number; patches: number; bytes: number } {
    const entries = [...this.undoEntries, ...this.redoEntries];
    return {
      undo: this.undoEntries.length,
      redo: this.redoEntries.length,
      patches: entries.reduce((sum, e) => sum + e.patches.length, 0),
      bytes: canonical(entries).length,
    };
  }
}
export function removal(document: Document, selection: Selection): Change[] {
  const changes: Change[] = [{ field: selection.field, id: selection.id, value: null } as Change];
  const openingIds = new Set<string>();
  if (selection.field === 'instances')
    for (const op of document.openings)
      if (op.instanceId === selection.id) {
        openingIds.add(op.id);
        changes.push({ field: 'openings', id: op.id, value: null });
      }
  if (selection.field === 'openings') openingIds.add(selection.id);
  if (openingIds.size)
    for (const connection of document.connections)
      if (openingIds.has(connection.openingA) || openingIds.has(connection.openingB))
        changes.push({ field: 'connections', id: connection.id, value: null });
  return changes;
}
export function snapped(transform: Transform, enabled: boolean): Transform {
  if (!enabled) return { position: { ...transform.position }, rotationRad: transform.rotationRad };
  const round = (value: number, step: number) => Math.round(value / step) * step;
  return {
    position: { x: round(transform.position.x, 0.1), z: round(transform.position.z, 0.1) },
    rotationRad: round(transform.rotationRad, Math.PI / 12),
  };
}
