import type { Diagnostic, Document, Point } from '../../domain';
import type { SpatialIndex } from '../spatial-index';
import type { Bounds } from '../predicates';
import type { MultiPolygon, Polygon } from '../kernel/contour';

export interface Solid {
  id: string;
  ownerIds: string[];
  kind: 'panel' | 'post-board' | 'upper-rail' | 'brace' | 'lower-rail';
  beam?: {
    from: Point & { y: number };
    to: Point & { y: number };
    widthM: number;
    thicknessM: number;
    normal: Point & { y: number };
  };
  footprint: Polygon;
  from: Point;
  to: Point;
  bottomM: number;
  topM: number;
  widthM: number;
  thicknessM: number;
}
export interface PhysicalOpening {
  id: string;
  instanceId: string;
  role: 'ordinary' | 'entrance' | 'exit';
  start: Point;
  end: Point;
  center: Point;
  normal: Point;
  clearWidthM: number;
}
export interface Room {
  id: string;
  floor: Polygon;
  maxSpanM: number;
}
export interface PhysicalConnection {
  id: string;
  openingA: string;
  openingB: string;
  direct: boolean;
  floor: Polygon;
  lengthM: number;
}
export interface Fastener {
  id: string;
  ownerIds: string[];
  position: Point & { y: number };
  normal: Point & { y: number };
  radiusM: number;
  thicknessM: number;
}
export interface PhysicalSnapshot {
  worldHash: string;
  layoutHash: string;
  sourceRevision: number;
  document: Document;
  rooms: Room[];
  connections: PhysicalConnection[];
  openPassages: PhysicalOpening[];
  floor: MultiPolygon;
  roof: MultiPolygon;
  solids: Solid[];
  fasteners: Fastener[];
  obstacles: MultiPolygon;
  accessibleRegions: MultiPolygon;
  bounds: Bounds;
  spatialIndex: SpatialIndex;
  segmentCount: number;
  quantities: {
    floorM2: number;
    roofM2: number;
    fabricM2: number;
    timberM3: number;
    panels: number;
    postBoards: number;
    rails: number;
    braces: number;
    fastenerCount: number;
    metalM3: number;
  };
}
export type CompileResult =
  | { ok: true; snapshot: PhysicalSnapshot }
  | { ok: false; diagnostics: Diagnostic[] };
