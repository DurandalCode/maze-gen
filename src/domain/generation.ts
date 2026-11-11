import type { Definition, PhysicalProfile, Point, Site } from './types';
export interface GenerationRequest {
  requestId: string;
  schemaVersion: 1;
  generatorVersion: 'frontier-v1' | 'prototype-grid-v1';
  geometryVersion: string;
  catalogSnapshots: { definition: Definition; weight: number }[];
  site: Site;
  physicalProfile: PhysicalProfile;
  seed: string;
  placement: { mode: 'free' | 'orthogonal'; baseRotationRad: number | null };
  topology: { mode: 'tree' | 'cyclic'; extraConnections: number };
  terminals: { mode: 'auto' } | { mode: 'fixed'; entrance: Point; exit: Point };
  allocation: {
    mode: 'site' | 'module-budget';
    maxModules: number;
    minModules: number;
    caps: Record<string, number>;
  };
  constraints: {
    coverageTarget: number;
    hardCoverage: boolean;
    maxStraightM: number | null;
    maxForcedM: number | null;
  };
  requestedVariants: number;
  budgets: { attemptsPerVariant: number; placementChecksPerVariant: number; watchdogMs: number };
}

export interface GenerationOrigin {
  schemaVersion: 1;
  sourceRevisionHash: string;
  requestHash: string;
  request: GenerationRequest;
  variantIndex: number;
  attemptIndex: number;
  variantSeed: string;
  counters: {
    placementChecks: number;
    roots: number;
    acceptedModules: number;
    cycleChecks: number;
    fullValidations: number;
  };
  unusedModules: Record<string, number>;
  stopReason: 'frontier-exhausted' | 'module-limit' | 'work-limit';
}
