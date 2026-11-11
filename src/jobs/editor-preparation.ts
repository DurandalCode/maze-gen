import type { Diagnostic } from '../domain';
import { CommandStore } from '../editor/commands';
import type { EditorState } from '../editor/commands';
import { JobManager } from './manager';
import type { Preparation, PreparedWorld } from './compute';
import type { MeshArtifact } from './render-artifacts';
export interface EditorPreparationState {
  status: 'pending' | 'ready' | 'invalid' | 'error';
  world: PreparedWorld | null;
  diagnostics: Diagnostic[];
  error: string | null;
  geometryRevision: number;
  visualRevision: number;
  sourceRevision: number;
}
interface Identity {
  ok: true;
  revisionHash: string;
  layoutHash: string;
  visual: { floorMesh: MeshArtifact; roofMesh: MeshArtifact; groundMesh: MeshArtifact } | null;
}
/** Physical jobs follow only geometry revisions. A color edit cannot restart a pending navmesh build. */
export class EditorPreparation {
  private unsubscribe: () => void;
  private physicsOwner: string;
  private identityOwner: string;
  private geometry = -1;
  private visual = -1;
  private documentRevision = -1;
  private base: PreparedWorld | null = null;
  private baseVisual = -1;
  private disposed = false;
  private epoch = 0;
  private state: EditorPreparationState = {
    status: 'pending',
    world: null,
    diagnostics: [],
    error: null,
    geometryRevision: -1,
    visualRevision: -1,
    sourceRevision: -1,
  };
  constructor(
    readonly store: CommandStore,
    private readonly jobs: JobManager,
    owner: string,
    private readonly changed: (state: EditorPreparationState) => void,
  ) {
    this.physicsOwner = `${owner}-p`;
    this.identityOwner = `${owner}-v`;
    this.unsubscribe = store.subscribe(() => this.update());
    this.update();
  }
  getState(): EditorPreparationState {
    return this.state;
  }
  private publish(state: EditorPreparationState): void {
    if (this.disposed) return;
    this.state = state;
    this.changed(state);
  }
  private pending(source: EditorState): void {
    this.publish({
      status: 'pending',
      world: null,
      diagnostics: [],
      error: null,
      geometryRevision: source.geometryRevision,
      visualRevision: source.visualRevision,
      sourceRevision: source.document.revision,
    });
  }
  private update(): void {
    if (this.disposed) return;
    const source = this.store.getSnapshot();
    if (source.geometryRevision !== this.geometry) {
      this.geometry = source.geometryRevision;
      this.visual = source.visualRevision;
      this.documentRevision = source.document.revision;
      this.preparePhysical(source);
      return;
    }
    if (source.visualRevision !== this.visual) {
      this.visual = source.visualRevision;
      this.documentRevision = source.document.revision;
      if (this.base) this.prepareIdentity(source);
      return;
    }
    if (source.document.revision !== this.documentRevision) {
      this.documentRevision = source.document.revision;
      this.publish({ ...this.state, sourceRevision: source.document.revision });
    }
  }
  private preparePhysical(source: EditorState): void {
    const epoch = ++this.epoch;
    this.jobs.disposeOwner(this.physicsOwner);
    this.jobs.disposeOwner(this.identityOwner);
    this.base = null;
    this.pending(source);
    const handle = this.jobs.submit(this.physicsOwner, source.document.revision, 'compile', {
      document: source.document,
    });
    void handle.result.then((outcome) => {
      if (
        this.disposed ||
        epoch !== this.epoch ||
        this.store.getSnapshot().geometryRevision !== source.geometryRevision
      )
        return;
      const latest = this.store.getSnapshot();
      if (outcome.state !== 'completed') {
        this.failure(outcome.payload, latest);
        return;
      }
      const result = outcome.payload as Preparation;
      if (!result.ok) {
        this.publish({
          status: 'invalid',
          world: null,
          diagnostics: result.diagnostics,
          error: null,
          geometryRevision: latest.geometryRevision,
          visualRevision: latest.visualRevision,
          sourceRevision: latest.document.revision,
        });
        return;
      }
      this.base = result.world;
      this.baseVisual = source.visualRevision;
      if (latest.visualRevision !== source.visualRevision) this.prepareIdentity(latest);
      else this.ready(result.world, latest);
    });
  }
  private prepareIdentity(source: EditorState): void {
    const base = this.base;
    if (!base) return;
    const epoch = ++this.epoch;
    this.jobs.disposeOwner(this.identityOwner);
    this.pending(source);
    const margin = (e: PreparedWorld['physical']['document']['environment']) =>
      Math.max(120, Math.abs(e.forest.offset) + e.forest.distance + 30);
    const renderSource =
      margin(base.physical.document.environment) !== margin(source.document.environment)
        ? {
            bounds: base.physical.bounds,
            rooms: base.physical.rooms,
            floor: base.physical.floor,
            layoutHash: base.physical.layoutHash,
          }
        : undefined;
    void this.jobs
      .submit(this.identityOwner, source.document.revision, 'identity', {
        document: source.document,
        ...(renderSource ? { renderSource } : {}),
      })
      .result.then((outcome) => {
        if (this.disposed || epoch !== this.epoch) return;
        const latest = this.store.getSnapshot();
        if (
          latest.geometryRevision !== source.geometryRevision ||
          latest.visualRevision !== source.visualRevision
        )
          return;
        if (outcome.state !== 'completed') {
          this.failure(outcome.payload, latest);
          return;
        }
        const identity = outcome.payload as Identity;
        if (!identity.ok || identity.layoutHash !== base.physical.layoutHash) {
          this.failure(
            { message: 'Физический снимок устарел. Измените геометрию или повторите проверку.' },
            latest,
          );
          return;
        }
        const world: PreparedWorld = {
          ...base,
          ...(identity.visual ?? {}),
          revisionHash: identity.revisionHash,
          physical: {
            ...base.physical,
            document: latest.document,
            sourceRevision: latest.document.revision,
          },
        };
        this.base = world;
        this.baseVisual = latest.visualRevision;
        this.ready(world, latest);
      });
  }
  private ready(world: PreparedWorld, source: EditorState): void {
    this.publish({
      status: 'ready',
      world,
      diagnostics: [],
      error: null,
      geometryRevision: source.geometryRevision,
      visualRevision: source.visualRevision,
      sourceRevision: source.document.revision,
    });
  }
  private failure(payload: unknown, source: EditorState): void {
    const error =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : payload && typeof payload === 'object' && 'code' in payload
          ? String(payload.code)
          : 'Не удалось проверить карту. Повторите проверку.';
    this.publish({
      status: 'error',
      world: null,
      diagnostics: [],
      error,
      geometryRevision: source.geometryRevision,
      visualRevision: source.visualRevision,
      sourceRevision: source.document.revision,
    });
  }
  retry(): void {
    const source = this.store.getSnapshot();
    if (
      this.base &&
      this.geometry === source.geometryRevision &&
      this.baseVisual !== source.visualRevision
    )
      this.prepareIdentity(source);
    else this.preparePhysical(source);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.unsubscribe();
    this.jobs.disposeOwner(this.physicsOwner);
    this.jobs.disposeOwner(this.identityOwner);
    this.base = null;
    this.state = { ...this.state, world: null };
  }
}
