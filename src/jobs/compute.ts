import { VERSIONS, documentHashes, normalizeDocument } from '../domain';
import type { Diagnostic } from '../domain';
import { compileGeometry } from '../geometry/compile/compile';
import type { PhysicalSnapshot } from '../geometry/compile/types';
import { renderArtifacts } from './render-artifacts';
import type { MeshArtifact } from './render-artifacts';
export type { MeshArtifact } from './render-artifacts';
import { buildNavigation } from '../navigation/navmesh';
import type { NavigationSnapshot } from '../navigation/navmesh';
import { COMPUTE_OPERATIONS, response } from './protocol';
import type { JobRequest, JobResponse } from './protocol';

export interface PreparedWorld {
  revisionHash: string;
  physical: PhysicalSnapshot;
  navigation: NavigationSnapshot;
  floorMesh: MeshArtifact;
  roofMesh: MeshArtifact;
  groundMesh: MeshArtifact;
  versions: typeof VERSIONS;
  metrics: { routeLengthM: number; cycles: number; decisionCount: number; floorM2: number };
}
export type Preparation =
  | { ok: true; world: PreparedWorld }
  | { ok: false; diagnostics: Diagnostic[] };
export function prepareWorld(value: unknown): Preparation {
  const compiled = compileGeometry(value);
  if (!compiled.ok) return compiled;
  const navigation = buildNavigation(compiled.snapshot);
  if (!navigation.ok) return navigation;
  return {
    ok: true,
    world: {
      revisionHash: documentHashes(compiled.snapshot.document).revisionHash,
      physical: compiled.snapshot,
      navigation: navigation.snapshot,
      ...renderArtifacts(compiled.snapshot),
      versions: VERSIONS,
      metrics: {
        routeLengthM: navigation.snapshot.referenceLengthM,
        cycles: navigation.snapshot.semantic.cycles,
        decisionCount: navigation.snapshot.semantic.decisionCount,
        floorM2: compiled.snapshot.quantities.floorM2,
      },
    },
  };
}
export function compute(
  request: JobRequest,
  progress: (response: JobResponse) => void,
): { message: JobResponse; transfer: Transferable[] } {
  if (
    !COMPUTE_OPERATIONS.includes(request.operation as (typeof COMPUTE_OPERATIONS)[number]) ||
    request.operation === 'generate'
  )
    return {
      message: response(request, 'error', {
        code: 'UNSUPPORTED_OPERATION',
        operation: request.operation,
      }),
      transfer: [],
    };
  if (!request.input || typeof request.input !== 'object' || !('document' in request.input))
    return { message: response(request, 'error', { code: 'INVALID_REQUEST' }), transfer: [] };
  const input = request.input as {
    document: unknown;
    renderSource?: Pick<PhysicalSnapshot, 'bounds' | 'rooms' | 'floor' | 'layoutHash'>;
  };
  if (
    !input.document ||
    typeof input.document !== 'object' ||
    !('revision' in input.document) ||
    input.document.revision !== request.sourceRevision
  )
    return { message: response(request, 'error', { code: 'SOURCE_REVISION' }), transfer: [] };
  if (request.operation === 'identity') {
    const document = normalizeDocument(input.document),
      hashes = documentHashes(document);
    let visual: ReturnType<typeof renderArtifacts> | null = null;
    if (input.renderSource) {
      if (input.renderSource.layoutHash !== hashes.layoutHash)
        return { message: response(request, 'error', { code: 'STALE_LAYOUT' }), transfer: [] };
      visual = renderArtifacts({ ...input.renderSource, document });
    }
    return {
      message: response(request, 'result', { ok: true, ...hashes, versions: VERSIONS, visual }),
      transfer: visual
        ? [visual.floorMesh, visual.roofMesh, visual.groundMesh].flatMap((mesh) => [
            mesh.positions.buffer,
            mesh.indices.buffer,
          ])
        : [],
    };
  }
  progress(response(request, 'progress', { stage: 'preparing', workDone: 0 }));
  const prepared = prepareWorld(input.document);
  if (!prepared.ok) return { message: response(request, 'result', prepared), transfer: [] };
  if (request.operation === 'validate')
    return {
      message: response(request, 'result', {
        ok: true,
        revisionHash: prepared.world.revisionHash,
        worldHash: prepared.world.physical.worldHash,
        navHash: prepared.world.navigation.navHash,
        versions: VERSIONS,
      }),
      transfer: [],
    };
  if (request.operation === 'metrics')
    return {
      message: response(request, 'result', {
        ok: true,
        metrics: prepared.world.metrics,
        worldHash: prepared.world.physical.worldHash,
        versions: VERSIONS,
      }),
      transfer: [],
    };
  // One complete artifact, never duplicated in progress. No cached or active renderer buffer is transferred.
  const transfer = [
    prepared.world.floorMesh,
    prepared.world.roofMesh,
    prepared.world.groundMesh,
  ].flatMap((mesh) => [mesh.positions.buffer, mesh.indices.buffer]);
  return { message: response(request, 'result', prepared), transfer };
}
