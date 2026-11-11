import type { Diagnostic, Document } from '../domain';
import type { GenerationRequest } from './request';
export interface WorkCounters {
  placementChecks: number;
  roots: number;
  acceptedModules: number;
  cycleChecks: number;
  fullValidations: number;
}
export interface GenerationMetrics {
  coverage: number;
  routeLengthM: number;
  routeQuality: 'reference-approximate';
  cycles: number;
  components: number;
  decisionCount: number;
  maxStraightM: number;
  maxForcedM: number;
  isolatedWallIslands: number;
  modulesByDefinition: Record<string, number>;
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
export interface GenerationVariant {
  status: 'ready' | 'target-not-met';
  document: Document;
  revisionHash: string;
  worldHash: string;
  navHash: string;
  diversityHash: string;
  metrics: GenerationMetrics;
  manifest: {
    requestHash: string;
    request: GenerationRequest;
    variantIndex: number;
    attemptIndex: number;
    variantSeed: string;
    counters: WorkCounters;
    unusedModules: Record<string, number>;
    stopReason: 'frontier-exhausted' | 'module-limit' | 'work-limit';
  };
}
export interface GenerationProgress {
  stage: 'root' | 'growth' | 'cycles' | 'validation' | 'variant';
  variantIndex: number;
  attemptIndex: number;
  workDone: number;
  workLimit: number;
  counters: WorkCounters;
  variant?: GenerationVariant;
}
export interface GenerationResult {
  status: 'complete' | 'exhausted' | 'interrupted' | 'invalid-request' | 'failed';
  requestHash: string;
  variants: GenerationVariant[];
  diagnostics: Diagnostic[];
  nextVariantIndex: number;
}
