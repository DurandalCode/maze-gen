import { controlCatalog, instantiate } from '../catalog/catalog';
import {
  Random,
  variantSeed,
  emptyDocument,
  normalizeDocument,
  documentHashes,
  VERSIONS,
  DomainError,
  canonical,
} from '../domain';
import type { GenerationRequest, Opening, Diagnostic } from '../domain';
import { compileGeometry } from '../geometry/compile/compile';
import { buildNavigation, route } from '../navigation/navmesh';
import { distance } from '../geometry/predicates';
import { defaultRequest, normalizeRequest, requestHash } from './request';
import { diversityHash, generationMetrics } from './metrics';
import type {
  GenerationProgress,
  GenerationResult,
  GenerationVariant,
  WorkCounters,
} from './types';

export const PROTOTYPE_VERSION = 'prototype-grid-v1';
export type PrototypeSize = 12 | 30;
export function prototypeRequest(
  requestId: string,
  seed: string,
  size: PrototypeSize = 12,
): GenerationRequest {
  const source = emptyDocument('prototype-site'),
    points = [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 20 },
      { x: 0, z: 20 },
    ];
  source.site.boundaryLoops[0]!.segments = points.map((from, i) => ({
    id: `site-${i}`,
    kind: 'line',
    from,
    to: points[(i + 1) % 4]!,
  }));
  const r = defaultRequest(requestId, seed, source);
  return normalizeRequest({
    ...r,
    generatorVersion: PROTOTYPE_VERSION,
    catalogSnapshots: [{ definition: controlCatalog()[0]!, weight: 1 }],
    placement: { mode: 'orthogonal', baseRotationRad: 0 },
    topology: { mode: 'tree', extraConnections: 0 },
    terminals: { mode: 'auto' },
    allocation: { mode: 'module-budget', maxModules: size, minModules: size, caps: {} },
    constraints: { coverageTarget: 0, hardCoverage: false, maxStraightM: null, maxForcedM: null },
    requestedVariants: 1,
    budgets: { attemptsPerVariant: 1, placementChecksPerVariant: 50_000, watchdogMs: 30_000 },
  });
}
const diag = (code: string, message: string): Diagnostic => ({ code, path: 'generation', message });
function supported(r: GenerationRequest): boolean {
  const size = r.allocation.maxModules;
  if (size !== 12 && size !== 30) return false;
  const expected = prototypeRequest(r.requestId, r.seed, size),
    { requestedVariants: _, budgets, ...body } = r,
    { requestedVariants: __, budgets: ___, ...expectedBody } = expected;
  return (
    canonical(body) === canonical(expectedBody) &&
    r.requestedVariants === 1 &&
    budgets.attemptsPerVariant === 1 &&
    budgets.placementChecksPerVariant === 50_000
  );
}
interface Cell {
  id: string;
  col: number;
  row: number;
}
/** Explicit bounded web profile: randomized spanning tree of a compact rectangular room grid. */
export function* generatePrototype(
  request: GenerationRequest,
  startVariantIndex = 0,
): Generator<GenerationProgress, GenerationResult> {
  const hash = requestHash(request),
    variants: GenerationVariant[] = [];
  if (!supported(request) || startVariantIndex !== 0)
    return {
      status: 'invalid-request',
      requestHash: hash,
      variants,
      diagnostics: [
        diag(
          'PROTOTYPE_PROFILE',
          'Поддерживаются 12 или 30 квадратных комнат, ортогональное дерево и один вариант.',
        ),
      ],
      nextVariantIndex: startVariantIndex,
    };
  const size = request.allocation.maxModules,
    columns = size === 12 ? 4 : 6,
    rows = size / columns,
    seed = variantSeed(request.seed, PROTOTYPE_VERSION, 0, 0),
    random = new Random(seed),
    prefix = `grid-${seed.slice(0, 16)}`,
    doc = emptyDocument(`generated-${seed.slice(0, 32)}`, 'Лабиринт · ' + size + ' комнат'),
    definition = request.catalogSnapshots[0]!.definition,
    counters: WorkCounters = {
      placementChecks: 0,
      roots: 1,
      acceptedModules: 0,
      cycleChecks: 0,
      fullValidations: 0,
    };
  doc.site = request.site;
  doc.definitions = [definition];
  doc.physicalProfile = request.physicalProfile;
  const progress = (stage: GenerationProgress['stage']): GenerationProgress => ({
    stage,
    variantIndex: 0,
    attemptIndex: 0,
    workDone: counters.placementChecks,
    workLimit: size,
    counters: { ...counters },
  });
  try {
    yield progress('root');
    const cells: Cell[] = Array.from({ length: size }, (_, i) => ({
        id: `${prefix}/room-${i}`,
        col: i % columns,
        row: Math.floor(i / columns),
      })),
      width = columns * 2 + (columns - 1) * 0.4,
      depth = rows * 2 + (rows - 1) * 0.4,
      origin = { x: 10 - width / 2 + 1, z: 10 - depth / 2 + 1 };
    for (const cell of cells) {
      doc.instances.push(
        instantiate(definition, cell.id, {
          x: origin.x + cell.col * 2.4,
          z: origin.z + cell.row * 2.4,
        }),
      );
      counters.placementChecks++;
      counters.acceptedModules++;
      yield progress('growth');
    }
    const opening = (cell: Cell, edge: number, role: Opening['role'] = 'ordinary'): Opening => ({
      id: `${cell.id}/edge-${edge}`,
      instanceId: cell.id,
      regionId: `region-edge-${edge}`,
      boundarySegmentId: `edge-${edge}`,
      uCenter: 0.5,
      widthM: 1.4,
      role,
    });
    const neighbors = (cell: Cell): Cell[] =>
        cells.filter((c) => Math.abs(c.col - cell.col) + Math.abs(c.row - cell.row) === 1),
      root = cells[Math.floor(random.next() * rows) * columns]!,
      seen = new Set([root.id]),
      frontier = neighbors(root).map((b) => ({ a: root, b })),
      adjacency = new Map<string, string[]>();
    while (frontier.length) {
      const selected = Math.floor(random.next() * frontier.length),
        { a, b } = frontier.splice(selected, 1)[0]!;
      if (seen.has(b.id)) continue;
      const edge = b.col > a.col ? 1 : b.col < a.col ? 3 : b.row > a.row ? 2 : 0,
        oa = opening(a, edge),
        ob = opening(b, (edge + 2) % 4);
      doc.openings.push(oa, ob);
      doc.connections.push({
        id: `${prefix}/connection-${doc.connections.length}`,
        openingA: oa.id,
        openingB: ob.id,
      });
      adjacency.set(a.id, [...(adjacency.get(a.id) ?? []), b.id]);
      adjacency.set(b.id, [...(adjacency.get(b.id) ?? []), a.id]);
      seen.add(b.id);
      frontier.push(
        ...neighbors(b)
          .filter((c) => !seen.has(c.id))
          .map((c) => ({ a: b, b: c })),
      );
    }
    if (seen.size !== size) throw new Error('Disconnected grid');
    doc.openings.push(opening(root, 3, 'entrance'));
    const candidates = cells
      .flatMap((cell) => [
        ...(cell.row === 0 ? [opening(cell, 0, 'exit')] : []),
        ...(cell.row === rows - 1 ? [opening(cell, 2, 'exit')] : []),
        ...(cell.col === 0 && cell.id !== root.id ? [opening(cell, 3, 'exit')] : []),
        ...(cell.col === columns - 1 ? [opening(cell, 1, 'exit')] : []),
      ])
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    doc.openings.push(candidates[0]!);
    yield progress('validation');
    counters.fullValidations++;
    let compiled = compileGeometry(doc);
    if (!compiled.ok)
      return {
        status: 'failed',
        requestHash: hash,
        variants,
        diagnostics: compiled.diagnostics,
        nextVariantIndex: 0,
      };
    let nav = buildNavigation(compiled.snapshot);
    if (!nav.ok)
      return {
        status: 'failed',
        requestHash: hash,
        variants,
        diagnostics: nav.diagnostics,
        nextVariantIndex: 0,
      };
    let exit = candidates[0]!,
      longest = -1;
    for (const candidate of candidates) {
      const cell = doc.instances.find((i) => i.id === candidate.instanceId)!,
        edge = Number(candidate.boundarySegmentId.slice(5)),
        inward = [
          { x: 0, z: 1 },
          { x: -1, z: 0 },
          { x: 0, z: -1 },
          { x: 1, z: 0 },
        ][edge]!,
        point = { x: cell.position.x - inward.x * 0.55, z: cell.position.z - inward.z * 0.55 },
        path = route(nav.snapshot, nav.snapshot.entrance, point),
        length = path.slice(1).reduce((n, p, i) => n + distance(path[i]!, p), 0);
      if (path.length && length > longest + 1e-8) {
        longest = length;
        exit = candidate;
      }
    }
    if (longest < 0) throw new Error('No reachable exit');
    doc.openings[doc.openings.length - 1] = exit;
    yield progress('validation');
    counters.fullValidations++;
    compiled = compileGeometry(doc);
    if (!compiled.ok)
      return {
        status: 'failed',
        requestHash: hash,
        variants,
        diagnostics: compiled.diagnostics,
        nextVariantIndex: 0,
      };
    nav = buildNavigation(compiled.snapshot);
    if (!nav.ok)
      return {
        status: 'failed',
        requestHash: hash,
        variants,
        diagnostics: nav.diagnostics,
        nextVariantIndex: 0,
      };
    if (nav.snapshot.semantic.cycles !== 0 || nav.snapshot.semantic.components !== 1)
      throw new Error('Invalid tree');
    const variant: GenerationVariant = {
      status: 'ready',
      document: normalizeDocument(doc),
      revisionHash: documentHashes(doc).revisionHash,
      worldHash: compiled.snapshot.worldHash,
      navHash: nav.snapshot.navHash,
      diversityHash: diversityHash(compiled.snapshot),
      metrics: generationMetrics(compiled.snapshot, nav.snapshot, 400),
      manifest: {
        requestHash: hash,
        request,
        variantIndex: 0,
        attemptIndex: 0,
        variantSeed: seed,
        counters: { ...counters },
        unusedModules: {},
        stopReason: 'module-limit',
      },
    };
    variants.push(variant);
    yield { ...progress('variant'), variant };
    return {
      status: 'complete',
      requestHash: hash,
      variants,
      diagnostics: [],
      nextVariantIndex: 1,
    };
  } catch (error) {
    return {
      status: 'failed',
      requestHash: hash,
      variants,
      diagnostics: [
        error instanceof DomainError
          ? error.diagnostic
          : diag(
              'INTERNAL_ERROR',
              'Не удалось создать проверенную карту. Исходный проект сохранён; попробуйте другой seed.',
            ),
      ],
      nextVariantIndex: 0,
    };
  }
}
