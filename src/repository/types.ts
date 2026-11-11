import type { SessionState, Session, WalkChunk } from '../session/types';
import type { Definition, Document, MapRevision, Versions } from '../domain';
export interface Project {
  projectId: string;
  title: string;
  currentRevisionHash: string;
  createdAt: number;
  updatedAt: number;
  originId?: string;
}
export interface StoredMap {
  revisionHash: string;
  document: Omit<Document, 'definitions'>;
  definitionHashes: string[];
  versions: Versions;
  validationSummary: MapRevision['validationSummary'];
}
export interface MapSummary {
  revisionHash: string;
  projectId: string;
  title: string;
  titleNormalized: string;
  updatedAt: number;
  createdAt: number;
  status: 'ready';
  widthM: number;
  depthM: number;
  modules: number;
  connections: number;
}
export type {
  SessionState,
  Condition,
  Sample,
  WalkEvent,
  Session,
  WalkChunk,
  ChunkInput,
} from '../session/types';
export interface WalkSummary {
  sessionId: string;
  mapHash: string;
  title: string;
  titleNormalized: string;
  status: SessionState;
  updatedAt: number;
  createdAt: number;
  elapsedMs: number;
  distanceM: number;
  lastCommittedSequence: number;
}
export interface Draft {
  projectId: string;
  document: Document;
  commandRevision: number;
  baseRevisionHash: string | null;
  updatedAt: number;
}
export interface DraftSummary {
  projectId: string;
  title: string;
  commandRevision: number;
  baseRevisionHash: string | null;
  updatedAt: number;
  modules: number;
}
export interface ListQuery {
  limit?: number;
  cursor?: ListCursor | null;
  sort?: 'updated-desc' | 'title-asc';
  search?: string;
  status?: string;
  mapHash?: string;
  signal?: AbortSignal;
}
export interface ListCursor {
  sort: 'updated-desc' | 'title-asc';
  key: [string | number, string];
  filter: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: ListCursor | null;
}
export interface ImportEntity {
  importId: string;
  entityKey: string;
  store:
    | 'definitions'
    | 'maps'
    | 'mapSummaries'
    | 'projects'
    | 'sessions'
    | 'walkSummaries'
    | 'walkChunks';
  value: Definition | StoredMap | MapSummary | Project | Session | WalkSummary | WalkChunk;
}
