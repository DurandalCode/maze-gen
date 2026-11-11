import { fail, variantSeed } from '../domain';
import type { GenerationOrigin } from '../domain';
import { normalizeRequest, requestHash } from './request';
import type { GenerationVariant } from './types';
export function generationOrigin(variant: GenerationVariant): GenerationOrigin {
  return normalizeGenerationOrigin({
    schemaVersion: 1,
    sourceRevisionHash: variant.revisionHash,
    ...variant.manifest,
  });
}
export function normalizeGenerationOrigin(value: unknown): GenerationOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('GENERATION_MANIFEST', 'origin', 'Неверный manifest генерации');
  const o = value as GenerationOrigin;
  const keys = [
    'schemaVersion',
    'sourceRevisionHash',
    'requestHash',
    'request',
    'variantIndex',
    'attemptIndex',
    'variantSeed',
    'counters',
    'unusedModules',
    'stopReason',
  ];
  if (Object.keys(o).some((key) => !keys.includes(key)) || o.schemaVersion !== 1)
    fail('GENERATION_MANIFEST', 'origin', 'Неизвестная версия/поля manifest');
  const request = normalizeRequest(o.request),
    hash = requestHash(request);
  if (o.requestHash !== hash || !/^[a-f0-9]{64}$/.test(o.sourceRevisionHash))
    fail('GENERATION_MANIFEST', 'origin', 'Неверный hash manifest');
  if (
    !Number.isSafeInteger(o.variantIndex) ||
    o.variantIndex < 0 ||
    o.variantIndex >= request.requestedVariants ||
    !Number.isSafeInteger(o.attemptIndex) ||
    o.attemptIndex < 0 ||
    o.attemptIndex >= request.budgets.attemptsPerVariant
  )
    fail('GENERATION_MANIFEST', 'origin', 'Неверные индексы поиска');
  if (
    o.variantSeed !==
    variantSeed(request.seed, request.generatorVersion, o.variantIndex, o.attemptIndex)
  )
    fail('GENERATION_MANIFEST', 'origin', 'Seed не соответствует запросу');
  const record = (v: unknown, fields: string[], max: number): Record<string, number> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      fail('GENERATION_MANIFEST', 'origin', 'Неверные счётчики');
    const result: Record<string, number> = {};
    for (const [key, n] of Object.entries(v)) {
      if (!fields.includes(key) || !Number.isSafeInteger(n) || n < 0 || n > max)
        fail('GENERATION_MANIFEST', 'origin', 'Неверный счётчик');
      result[key] = n as number;
    }
    return result;
  };
  const counterKeys = [
      'placementChecks',
      'roots',
      'acceptedModules',
      'cycleChecks',
      'fullValidations',
    ],
    counters = record(o.counters, counterKeys, 1_000_000);
  if (
    counterKeys.some((key) => !(key in counters)) ||
    counters.placementChecks! > request.budgets.placementChecksPerVariant
  )
    fail('GENERATION_MANIFEST', 'origin', 'Превышен детерминированный бюджет');
  const unusedModules = record(
    o.unusedModules,
    request.catalogSnapshots.map((e) => e.definition.contentHash),
    2000,
  );
  if (!['frontier-exhausted', 'module-limit', 'work-limit'].includes(o.stopReason))
    fail('GENERATION_MANIFEST', 'origin', 'Неверная причина окончания');
  return {
    schemaVersion: 1,
    sourceRevisionHash: o.sourceRevisionHash,
    requestHash: hash,
    request,
    variantIndex: o.variantIndex,
    attemptIndex: o.attemptIndex,
    variantSeed: o.variantSeed,
    counters: counters as GenerationOrigin['counters'],
    unusedModules,
    stopReason: o.stopReason,
  };
}
