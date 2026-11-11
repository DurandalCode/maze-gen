export interface Point {
  x: number;
  z: number;
}
export type Segment =
  | { id: string; kind: 'line'; from: Point; to: Point }
  | { id: string; kind: 'arc'; center: Point; radius: number; startAngle: number; sweep: number };
export interface BoundaryLoop {
  id: string;
  role: 'outer' | 'hole';
  segments: Segment[];
}
export interface Parameter {
  id: string;
  min: number;
  max: number;
  default: number;
}
export interface OpeningRegion {
  id: string;
  segmentId: string;
  uMin: number;
  uMax: number;
  wrap: boolean;
  minWidthM: number;
  maxWidthM: number;
  connectionClass: 'passage';
}
export interface ConstructionProfile {
  profileRef: 'physical-v1';
  maxSpanM: number;
  supportPattern: 'corners-and-openings';
}
export type Builder =
  | { kind: 'rectangle'; width: string; depth: string }
  | { kind: 'equilateralTriangle'; side: string }
  | { kind: 'circle'; radius: string }
  | { kind: 'explicitLoops' };
export interface Definition {
  id: string;
  version: number;
  contentHash: string;
  boundaryLoops: BoundaryLoop[];
  parameters: Parameter[];
  builder: Builder;
  openingRegions: OpeningRegion[];
  constructionProfile: ConstructionProfile;
}
export interface Instance {
  id: string;
  definitionHash: string;
  parameterValues: Record<string, number>;
  position: Point;
  rotationRad: number;
}
export interface Opening {
  id: string;
  instanceId: string;
  regionId: string;
  boundarySegmentId: string;
  uCenter: number;
  widthM: number;
  role: 'ordinary' | 'entrance' | 'exit';
}
export interface Connection {
  id: string;
  openingA: string;
  openingB: string;
}
export interface FreeWall {
  id: string;
  centerline: Segment;
  constructionProfileRef: 'physical-v1';
}
export interface PhysicalProfile {
  id: 'physical-v1';
  panelThicknessM: number;
  boardWidthM: number;
  boardThicknessM: number;
  postWidthM: number;
  headerDepthM: number;
  wallHeightM: number;
  playerRadiusM: number;
  eyeHeightM: number;
  minClearanceM: number;
  maxConnectionSpanM: number;
}
export interface Environment {
  roof: boolean;
  translucentFabric: boolean;
  wallColor: string;
  sun: { day: number; minutes: number };
  forest: { side: 'north' | 'east' | 'south' | 'west'; distance: number; offset: number };
}
export interface Site {
  boundaryLoops: BoundaryLoop[];
}
export interface Document {
  schemaVersion: 1;
  documentId: string;
  revision: number;
  site: Site;
  definitions: Definition[];
  instances: Instance[];
  openings: Opening[];
  connections: Connection[];
  freeWalls: FreeWall[];
  physicalProfile: PhysicalProfile;
  environment: Environment;
  metadata: { title: string; createdAt: string; updatedAt: string };
}
export interface Versions {
  geometry: string;
  approximation: string;
  navigation: string;
}
export interface MapRevision {
  revisionHash: string;
  document: Document;
  versions: Versions;
  validationSummary: { ready: boolean; diagnostics: Diagnostic[] };
}
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  objectIds?: string[];
  location?: Point | null;
  actual?: number;
  limit?: number;
}
export class DomainError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super(`${diagnostic.path}: ${diagnostic.message}`);
    this.name = 'DomainError';
    this.diagnostic = { objectIds: [], location: null, ...diagnostic };
  }
}
export const LIMITS = Object.freeze({
  definitions: 2000,
  instances: 2000,
  connections: 4000,
  openings: 8000,
  freeWalls: 1000,
  segments: 100_000,
  physicalSegments: 400_000,
  loops: 1024,
  parameters: 64,
  idLength: 128,
  coordinateM: 1_000_000,
});
