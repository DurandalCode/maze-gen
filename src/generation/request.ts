import {
  emptyDocument,
  normalizeDocument,
  fail,
  hashValue,
  VERSIONS,
  LIMITS,
  number,
} from '../domain';
import type { Definition, Document, PhysicalProfile, Point, Site } from '../domain';
import { controlCatalog, validateCatalogDefinition, expandDefinition } from '../catalog/catalog';
import { contourPolygon, polygonArea } from '../geometry/kernel/contour';
import { bounds, pointSegmentDistance, ringEdges } from '../geometry/predicates';

export const GENERATOR_VERSION = 'frontier-v1';
export type { GenerationRequest } from '../domain/generation';
import type { GenerationRequest } from '../domain/generation';
const object = (v: unknown, p: string, fields: string[]): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    fail('SCHEMA', p, 'Ожидается объект');
  for (const k of Object.keys(v))
    if (!fields.includes(k)) fail('UNKNOWN_FIELD', `${p}.${k}`, 'Неизвестное поле');
  return v as Record<string, unknown>;
};
const integer = (v: unknown, p: string, lo: number, hi: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < lo || v > hi)
    fail('RANGE', p, `Нужно целое число ${lo}…${hi}`);
  return v;
};
const text = (v: unknown, p: string): string => {
  if (typeof v !== 'string' || !v.length || v.length > 128)
    fail('SCHEMA', p, 'Нужна строка 1…128 символов');
  return v.normalize('NFC');
};
const choice = <T extends string>(v: unknown, p: string, values: T[]): T => {
  if (!values.includes(v as T)) fail('SCHEMA', p, `Ожидается ${values.join(' / ')}`);
  return v as T;
};
const boolean = (v: unknown, p: string): boolean => {
  if (typeof v !== 'boolean') fail('SCHEMA', p, 'Ожидается boolean');
  return v;
};
export function defaultRequest(
  requestId: string,
  seed: string,
  source: Document = emptyDocument('site'),
): GenerationRequest {
  return {
    requestId,
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    geometryVersion: VERSIONS.geometry,
    catalogSnapshots: controlCatalog()
      .slice(0, 2)
      .map((definition) => ({ definition, weight: 1 })),
    site: source.site,
    physicalProfile: source.physicalProfile,
    seed,
    placement: { mode: 'free', baseRotationRad: null },
    topology: { mode: 'cyclic', extraConnections: 8 },
    terminals: { mode: 'auto' },
    allocation: { mode: 'site', maxModules: LIMITS.instances, minModules: 1, caps: {} },
    constraints: { coverageTarget: 0.65, hardCoverage: false, maxStraightM: 12, maxForcedM: 20 },
    requestedVariants: 3,
    budgets: { attemptsPerVariant: 8, placementChecksPerVariant: 50_000, watchdogMs: 60_000 },
  };
}
export function normalizeRequest(value: unknown): GenerationRequest {
  const o = object(value, 'request', [
    'requestId',
    'schemaVersion',
    'generatorVersion',
    'geometryVersion',
    'catalogSnapshots',
    'site',
    'physicalProfile',
    'seed',
    'placement',
    'topology',
    'terminals',
    'allocation',
    'constraints',
    'requestedVariants',
    'budgets',
  ]);
  if (
    o.schemaVersion !== 1 ||
    ![GENERATOR_VERSION, 'prototype-grid-v1'].includes(o.generatorVersion as string) ||
    o.geometryVersion !== VERSIONS.geometry
  )
    fail('INCOMPATIBLE_VERSION', 'request', 'Несовместимая версия генератора/геометрии');
  const requestId = text(o.requestId, 'requestId'),
    seed = text(o.seed, 'seed');
  if (
    !Array.isArray(o.catalogSnapshots) ||
    !o.catalogSnapshots.length ||
    o.catalogSnapshots.length > LIMITS.definitions
  )
    fail('RESOURCE_LIMIT', 'catalogSnapshots', 'Нужно 1…2000 определений');
  const catalogSnapshots = o.catalogSnapshots
    .map((v, i) => {
      const e = object(v, `catalogSnapshots[${i}]`, ['definition', 'weight']);
      const definition = validateCatalogDefinition(e.definition);
      contourPolygon(expandDefinition(definition));
      return {
        definition,
        weight: number(e.weight, `catalogSnapshots[${i}].weight`, 0.000001, 1_000_000),
      };
    })
    .sort((a, b) => (a.definition.contentHash < b.definition.contentHash ? -1 : 1));
  if (
    new Set(catalogSnapshots.map((e) => e.definition.contentHash)).size !== catalogSnapshots.length
  )
    fail('DUPLICATE_ID', 'catalogSnapshots', 'Повтор определения');
  const doc = normalizeDocument({
    ...emptyDocument('generation-request'),
    site: o.site,
    physicalProfile: o.physicalProfile,
    definitions: catalogSnapshots.map((e) => e.definition),
  });
  const polygon = contourPolygon(doc.site.boundaryLoops),
    box = bounds(polygon[0]!);
  if (
    box.maxX - box.minX > 100 + 1e-6 ||
    box.maxZ - box.minZ > 100 + 1e-6 ||
    polygonArea(polygon) <= 0
  )
    fail(
      'SITE_LIMIT',
      'site',
      'Площадка должна иметь положительную площадь и габариты до 100×100 м',
    );
  const p = object(o.placement, 'placement', ['mode', 'baseRotationRad']);
  const placement = {
    mode: choice(p.mode, 'placement.mode', ['free', 'orthogonal']),
    baseRotationRad:
      p.baseRotationRad === null
        ? null
        : number(p.baseRotationRad, 'placement.baseRotationRad', -Math.PI * 2, Math.PI * 2, 1e9),
  };
  const t = object(o.topology, 'topology', ['mode', 'extraConnections']);
  const topology = {
    mode: choice(t.mode, 'topology.mode', ['tree', 'cyclic']),
    extraConnections: integer(
      t.extraConnections,
      'topology.extraConnections',
      0,
      LIMITS.connections,
    ),
  };
  if (
    (topology.mode === 'tree' && topology.extraConnections !== 0) ||
    (topology.mode === 'cyclic' && topology.extraConnections < 1)
  )
    fail('TOPOLOGY', 'topology', 'Для tree нужно 0 циклов, для cyclic — хотя бы 1');
  const tm = object(o.terminals, 'terminals', ['mode', 'entrance', 'exit']);
  const mode = choice(tm.mode, 'terminals.mode', ['auto', 'fixed']);
  let terminals: GenerationRequest['terminals'];
  if (mode === 'auto') {
    object(o.terminals, 'terminals', ['mode']);
    terminals = { mode };
  } else {
    const point = (v: unknown, name: string): Point => {
      const pt = object(v, name, ['x', 'z']);
      const result = { x: number(pt.x, `${name}.x`), z: number(pt.z, `${name}.z`) };
      if (!ringEdges(polygon[0]!).some(([a, b]) => pointSegmentDistance(result, a, b) <= 0.01))
        fail('TERMINAL_BOUNDARY', name, 'Fixed terminal должен лежать на внешней границе площадки');
      return result;
    };
    terminals = {
      mode,
      entrance: point(tm.entrance, 'terminals.entrance'),
      exit: point(tm.exit, 'terminals.exit'),
    };
  }
  const a = object(o.allocation, 'allocation', ['mode', 'maxModules', 'minModules', 'caps']);
  const allocation = {
    mode: choice(a.mode, 'allocation.mode', ['site', 'module-budget']),
    maxModules: integer(a.maxModules, 'allocation.maxModules', 1, LIMITS.instances),
    minModules: integer(a.minModules, 'allocation.minModules', 1, LIMITS.instances),
    caps: {} as Record<string, number>,
  };
  if (allocation.minModules > allocation.maxModules)
    fail('RANGE', 'allocation.minModules', 'Минимум больше максимума');
  const hashes = catalogSnapshots.map((c) => c.definition.contentHash);
  const caps = object(a.caps, 'allocation.caps', hashes);
  for (const h of Object.keys(caps).sort())
    allocation.caps[h] = integer(caps[h], `allocation.caps.${h}`, 0, LIMITS.instances);
  const c = object(o.constraints, 'constraints', [
    'coverageTarget',
    'hardCoverage',
    'maxStraightM',
    'maxForcedM',
  ]);
  const constraints = {
    coverageTarget: number(c.coverageTarget, 'constraints.coverageTarget', 0, 1),
    hardCoverage: boolean(c.hardCoverage, 'constraints.hardCoverage'),
    maxStraightM:
      c.maxStraightM === null
        ? null
        : number(c.maxStraightM, 'constraints.maxStraightM', 0.1, 1000),
    maxForcedM:
      c.maxForcedM === null ? null : number(c.maxForcedM, 'constraints.maxForcedM', 0.1, 1000),
  };
  const b = object(o.budgets, 'budgets', [
    'attemptsPerVariant',
    'placementChecksPerVariant',
    'watchdogMs',
  ]);
  return {
    requestId,
    schemaVersion: 1,
    generatorVersion: o.generatorVersion as GenerationRequest['generatorVersion'],
    geometryVersion: VERSIONS.geometry,
    catalogSnapshots,
    site: doc.site,
    physicalProfile: doc.physicalProfile,
    seed,
    placement,
    topology,
    terminals,
    allocation,
    constraints,
    requestedVariants: integer(o.requestedVariants, 'requestedVariants', 1, 8),
    budgets: {
      attemptsPerVariant: integer(b.attemptsPerVariant, 'budgets.attemptsPerVariant', 1, 8),
      placementChecksPerVariant: integer(
        b.placementChecksPerVariant,
        'budgets.placementChecksPerVariant',
        1,
        50_000,
      ),
      watchdogMs: integer(b.watchdogMs, 'budgets.watchdogMs', 1, 300_000),
    },
  };
}
/** Scheduling/transport never changes deterministic work or the identity of a variant. */
export function requestHash(request: GenerationRequest): string {
  const { requestId: _, requestedVariants: __, budgets, ...source } = request;
  const { watchdogMs: ___, ...workBudget } = budgets;
  return hashValue({ ...source, budgets: workBudget });
}
