import { compareId, hashValue } from './hash';
import { DomainError, LIMITS } from './types';
import type {
  BoundaryLoop,
  Builder,
  Connection,
  ConstructionProfile,
  Definition,
  Document,
  Environment,
  FreeWall,
  Instance,
  Opening,
  OpeningRegion,
  Parameter,
  PhysicalProfile,
  Point,
  Segment,
} from './types';

type Obj = Record<string, unknown>;
export function fail(
  code: string,
  path: string,
  message: string,
  actual?: number,
  limit?: number,
): never {
  throw new DomainError({
    code,
    path,
    message,
    ...(actual === undefined ? {} : { actual }),
    ...(limit === undefined ? {} : { limit }),
  });
}
function obj(value: unknown, path: string, fields: string[]): Obj {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail('SCHEMA', path, 'Expected a plain object');
  const object = value as Obj;
  for (const key of Object.keys(object))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`, 'Unknown field');
  return object;
}
function text(value: unknown, path: string, max: number = LIMITS.idLength): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail('SCHEMA', path, `Expected nonempty string of at most ${max} code units`);
  return value.normalize('NFC');
}
function hash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    fail('SCHEMA', path, 'Expected lowercase SHA-256');
  return value;
}
export function number(
  value: unknown,
  path: string,
  min: number = -LIMITS.coordinateM,
  max: number = LIMITS.coordinateM,
  precision: number = 1e6,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail('NON_FINITE', path, 'Expected finite number');
  if (value < min || value > max) fail('RANGE', path, `Expected ${min}…${max}`, value, max);
  const normalized = Math.round(value * precision) / precision;
  if (normalized < min || normalized > max) fail('RANGE', path, 'Normalization would exceed range');
  return normalized === 0 ? 0 : normalized;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail('SCHEMA', path, `Expected safe integer ${min}…${max}`);
  return value;
}
function choice<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  code = 'SCHEMA',
): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    fail(code, path, `Expected ${values.join(' | ')}`);
  return value as T;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('SCHEMA', path, 'Expected boolean');
  return value;
}
function list<T>(
  value: unknown,
  path: string,
  max: number,
  parse: (value: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) fail('SCHEMA', path, 'Expected array');
  if (value.length > max)
    fail('RESOURCE_LIMIT', path, 'Array exceeds resource limit', value.length, max);
  return value.map((item, i) => parse(item, `${path}[${i}]`));
}
function unique<T>(items: T[], path: string, key: (item: T) => string): T[] {
  const keys = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (keys.has(k)) fail('DUPLICATE_ID', path, `Duplicate ${k}`);
    keys.add(k);
  }
  return items.sort((a, b) => compareId(key(a), key(b)));
}
export function parsePoint(value: unknown, path: string): Point {
  const o = obj(value, path, ['x', 'z']);
  return { x: number(o.x, `${path}.x`), z: number(o.z, `${path}.z`) };
}
export function parseSegment(value: unknown, path: string): Segment {
  const raw = obj(value, path, [
    'id',
    'kind',
    'from',
    'to',
    'center',
    'radius',
    'startAngle',
    'sweep',
  ]);
  const kind = choice(raw.kind, `${path}.kind`, ['line', 'arc'], 'UNSUPPORTED_PRIMITIVE');
  const o = obj(
    value,
    path,
    kind === 'line'
      ? ['id', 'kind', 'from', 'to']
      : ['id', 'kind', 'center', 'radius', 'startAngle', 'sweep'],
  );
  const id = text(o.id, `${path}.id`);
  if (kind === 'line') {
    const from = parsePoint(o.from, `${path}.from`),
      to = parsePoint(o.to, `${path}.to`);
    if (Math.hypot(to.x - from.x, to.z - from.z) <= 1e-6)
      fail('DEGENERATE', path, 'Line segment too short');
    return { id, kind, from, to };
  }
  const sweep = number(o.sweep, `${path}.sweep`, -2 * Math.PI, 2 * Math.PI, 1e9);
  if (Math.abs(sweep) < 1e-9) fail('DEGENERATE', path, 'Arc sweep is zero');
  return {
    id,
    kind,
    center: parsePoint(o.center, `${path}.center`),
    radius: number(o.radius, `${path}.radius`, 1e-6, 10000),
    startAngle: number(o.startAngle, `${path}.startAngle`, -1e6, 1e6, 1e9),
    sweep,
  };
}
/** Segment order is topological and is never sorted. */
export function parseLoops(value: unknown, path: string): BoundaryLoop[] {
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) {
      const segments = (item as Obj | null)?.segments;
      if (Array.isArray(segments)) total += segments.length;
      if (total > LIMITS.segments)
        fail('RESOURCE_LIMIT', path, 'Segment limit exceeded', total, LIMITS.segments);
    }
  }
  const loops = list(value, path, LIMITS.loops, (item, p) => {
    const o = obj(item, p, ['id', 'role', 'segments']);
    const segments = list(o.segments, `${p}.segments`, LIMITS.segments, parseSegment);
    if (!segments.length) fail('DEGENERATE', p, 'Empty boundary');
    const ids = new Set<string>();
    for (const segment of segments) {
      if (ids.has(segment.id)) fail('DUPLICATE_ID', p, segment.id);
      ids.add(segment.id);
    }
    return {
      id: text(o.id, `${p}.id`),
      role: choice(o.role, `${p}.role`, ['outer', 'hole']),
      segments,
    };
  });
  if (loops.filter((l) => l.role === 'outer').length !== 1)
    fail('SCHEMA', path, 'Exactly one outer loop required');
  unique(loops, path, (l) => l.id);
  const ids = new Set<string>();
  for (const loop of loops)
    for (const s of loop.segments) {
      if (ids.has(s.id)) fail('DUPLICATE_ID', path, `Segment ${s.id} is ambiguous`);
      ids.add(s.id);
    }
  return loops;
}
function parameter(value: unknown, path: string): Parameter {
  const o = obj(value, path, ['id', 'min', 'max', 'default']),
    min = number(o.min, `${path}.min`, 1e-6, 10000),
    max = number(o.max, `${path}.max`, min, 10000);
  return {
    id: text(o.id, `${path}.id`),
    min,
    max,
    default: number(o.default, `${path}.default`, min, max),
  };
}
function builder(value: unknown, path: string): Builder {
  const raw = obj(value, path, ['kind', 'width', 'depth', 'side', 'radius']);
  const kind = choice(
    raw.kind,
    `${path}.kind`,
    ['rectangle', 'equilateralTriangle', 'circle', 'explicitLoops'],
    'UNSUPPORTED_PRIMITIVE',
  );
  const fields = {
    rectangle: ['width', 'depth'],
    equilateralTriangle: ['side'],
    circle: ['radius'],
    explicitLoops: [],
  }[kind];
  const o = obj(value, path, ['kind', ...fields]);
  if (kind === 'rectangle')
    return { kind, width: text(o.width, `${path}.width`), depth: text(o.depth, `${path}.depth`) };
  if (kind === 'equilateralTriangle') return { kind, side: text(o.side, `${path}.side`) };
  if (kind === 'circle') return { kind, radius: text(o.radius, `${path}.radius`) };
  return { kind };
}
function openingRegion(value: unknown, path: string): OpeningRegion {
  const o = obj(value, path, [
    'id',
    'segmentId',
    'uMin',
    'uMax',
    'wrap',
    'minWidthM',
    'maxWidthM',
    'connectionClass',
  ]);
  const minWidthM = number(o.minWidthM, `${path}.minWidthM`, 1, 3);
  const result = {
    id: text(o.id, `${path}.id`),
    segmentId: text(o.segmentId, `${path}.segmentId`),
    uMin: number(o.uMin, `${path}.uMin`, 0, 1),
    uMax: number(o.uMax, `${path}.uMax`, 0, 1),
    wrap: bool(o.wrap, `${path}.wrap`),
    minWidthM,
    maxWidthM: number(o.maxWidthM, `${path}.maxWidthM`, minWidthM, 3),
    connectionClass: choice(o.connectionClass, `${path}.connectionClass`, ['passage']),
  };
  if (result.uMin > result.uMax && !result.wrap)
    fail('RANGE', path, 'Reversed opening interval needs wrap');
  return result;
}
export function definitionPayload(
  value: unknown,
  path = 'definition',
): Omit<Definition, 'contentHash'> {
  const o = obj(value, path, [
    'id',
    'version',
    'boundaryLoops',
    'parameters',
    'builder',
    'openingRegions',
    'constructionProfile',
  ]);
  const loops = parseLoops(o.boundaryLoops, `${path}.boundaryLoops`);
  const parameters = unique(
    list(o.parameters, `${path}.parameters`, LIMITS.parameters, parameter),
    `${path}.parameters`,
    (p) => p.id,
  );
  const b = builder(o.builder, `${path}.builder`);
  const parameterIds = new Set(parameters.map((p) => p.id));
  for (const key of b.kind === 'rectangle'
    ? [b.width, b.depth]
    : b.kind === 'circle'
      ? [b.radius]
      : b.kind === 'equilateralTriangle'
        ? [b.side]
        : [])
    if (!parameterIds.has(key)) fail('MISSING_REFERENCE', path, `Unknown parameter ${key}`);
  const regions = unique(
    list(o.openingRegions, `${path}.openingRegions`, 8000, openingRegion),
    `${path}.openingRegions`,
    (r) => r.id,
  );
  const segments = new Map(loops.flatMap((l) => l.segments).map((s) => [s.id, s]));
  for (const region of regions) {
    const s = segments.get(region.segmentId);
    if (!s) fail('MISSING_REFERENCE', path, `Unknown segment ${region.segmentId}`);
    if (region.wrap && (s.kind !== 'arc' || Math.abs(Math.abs(s.sweep) - 2 * Math.PI) > 1e-9))
      fail('RANGE', path, 'Wrap requires a full-circle arc');
  }
  const cp = obj(o.constructionProfile, `${path}.constructionProfile`, [
    'profileRef',
    'maxSpanM',
    'supportPattern',
  ]);
  const constructionProfile: ConstructionProfile = {
    profileRef: choice(
      cp.profileRef,
      `${path}.constructionProfile.profileRef`,
      ['physical-v1'],
      'UNSUPPORTED_PROFILE',
    ),
    maxSpanM: number(cp.maxSpanM, `${path}.constructionProfile.maxSpanM`, 1, 6),
    supportPattern: choice(cp.supportPattern, `${path}.constructionProfile.supportPattern`, [
      'corners-and-openings',
    ]),
  };
  return {
    id: text(o.id, `${path}.id`),
    version: integer(o.version, `${path}.version`, 1, 1_000_000),
    boundaryLoops: loops,
    parameters,
    builder: b,
    openingRegions: regions,
    constructionProfile,
  };
}
export function createDefinition(value: unknown): Definition {
  const payload = definitionPayload(value);
  return { ...payload, contentHash: hashValue(payload) };
}
export function parseDefinition(value: unknown, path = 'definition'): Definition {
  const o = obj(value, path, [
    'id',
    'version',
    'contentHash',
    'boundaryLoops',
    'parameters',
    'builder',
    'openingRegions',
    'constructionProfile',
  ]);
  const { contentHash, ...rest } = o,
    payload = definitionPayload(rest, path),
    expected = hash(contentHash, `${path}.contentHash`);
  if (hashValue(payload) !== expected)
    fail('HASH_MISMATCH', path, 'Definition contents do not match hash');
  return { ...payload, contentHash: expected };
}
function instance(value: unknown, path: string): Instance {
  const o = obj(value, path, [
    'id',
    'definitionHash',
    'parameterValues',
    'position',
    'rotationRad',
  ]);
  if (
    !o.parameterValues ||
    typeof o.parameterValues !== 'object' ||
    Array.isArray(o.parameterValues)
  )
    fail('SCHEMA', `${path}.parameterValues`, 'Expected numeric parameter map');
  const keys = Object.keys(o.parameterValues);
  if (keys.length > LIMITS.parameters) fail('RESOURCE_LIMIT', path, 'Too many parameters');
  const values: Record<string, number> = {};
  for (const key of keys.sort(compareId)) {
    text(key, path);
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      fail('SCHEMA', path, 'Unsafe parameter key');
    values[key] = number(
      (o.parameterValues as Obj)[key],
      `${path}.parameterValues.${key}`,
      1e-6,
      10000,
    );
  }
  return {
    id: text(o.id, `${path}.id`),
    definitionHash: hash(o.definitionHash, `${path}.definitionHash`),
    parameterValues: values,
    position: parsePoint(o.position, `${path}.position`),
    rotationRad: number(o.rotationRad, `${path}.rotationRad`, -1e6, 1e6, 1e9),
  };
}
function opening(value: unknown, path: string): Opening {
  const o = obj(value, path, [
    'id',
    'instanceId',
    'regionId',
    'boundarySegmentId',
    'uCenter',
    'widthM',
    'role',
  ]);
  return {
    id: text(o.id, `${path}.id`),
    instanceId: text(o.instanceId, `${path}.instanceId`),
    regionId: text(o.regionId, `${path}.regionId`),
    boundarySegmentId: text(o.boundarySegmentId, `${path}.boundarySegmentId`),
    uCenter: number(o.uCenter, `${path}.uCenter`, 0, 1),
    widthM: number(o.widthM, `${path}.widthM`, 1, 3),
    role: choice(o.role, `${path}.role`, ['ordinary', 'entrance', 'exit']),
  };
}
function connection(value: unknown, path: string): Connection {
  const o = obj(value, path, ['id', 'openingA', 'openingB']);
  return {
    id: text(o.id, `${path}.id`),
    openingA: text(o.openingA, `${path}.openingA`),
    openingB: text(o.openingB, `${path}.openingB`),
  };
}
function freeWall(value: unknown, path: string): FreeWall {
  const o = obj(value, path, ['id', 'centerline', 'constructionProfileRef']);
  return {
    id: text(o.id, `${path}.id`),
    centerline: parseSegment(o.centerline, `${path}.centerline`),
    constructionProfileRef: choice(
      o.constructionProfileRef,
      `${path}.constructionProfileRef`,
      ['physical-v1'],
      'UNSUPPORTED_PROFILE',
    ),
  };
}
function physicalProfile(value: unknown, path: string): PhysicalProfile {
  const fields = [
    'id',
    'panelThicknessM',
    'boardWidthM',
    'boardThicknessM',
    'postWidthM',
    'headerDepthM',
    'wallHeightM',
    'playerRadiusM',
    'eyeHeightM',
    'minClearanceM',
    'maxConnectionSpanM',
  ];
  const o = obj(value, path, fields);
  const ranges: Record<string, [number, number]> = {
    panelThicknessM: [0.001, 0.1],
    boardWidthM: [0.12, 0.12],
    boardThicknessM: [0.04, 0.04],
    postWidthM: [0.12, 0.12],
    headerDepthM: [0.14, 0.14],
    wallHeightM: [1.8, 10],
    playerRadiusM: [0.25, 0.25],
    eyeHeightM: [1.7, 1.7],
    minClearanceM: [1, 1],
    maxConnectionSpanM: [3, 3],
  };
  const result: Obj = { id: choice(o.id, `${path}.id`, ['physical-v1'], 'UNSUPPORTED_PROFILE') };
  for (const [key, [min, max]] of Object.entries(ranges))
    result[key] = number(o[key], `${path}.${key}`, min, max);
  return result as unknown as PhysicalProfile;
}
export function normalizeEnvironment(value: unknown, path = 'environment'): Environment {
  const o = obj(value, path, ['roof', 'translucentFabric', 'wallColor', 'sun', 'forest']),
    sun = obj(o.sun, `${path}.sun`, ['day', 'minutes']),
    forest = obj(o.forest, `${path}.forest`, ['side', 'distance', 'offset']);
  if (typeof o.wallColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.wallColor))
    fail('SCHEMA', `${path}.wallColor`, 'Expected #rrggbb');
  return {
    roof: bool(o.roof, `${path}.roof`),
    translucentFabric: bool(o.translucentFabric, `${path}.translucentFabric`),
    wallColor: o.wallColor.toLowerCase(),
    sun: {
      day: integer(sun.day, `${path}.sun.day`, 1, 31),
      minutes: integer(sun.minutes, `${path}.sun.minutes`, 0, 1439),
    },
    forest: {
      side: choice(forest.side, `${path}.forest.side`, ['north', 'east', 'south', 'west']),
      distance: number(forest.distance, `${path}.forest.distance`, 2, 100),
      offset: number(forest.offset, `${path}.forest.offset`, -2000, 2000),
    },
  };
}
/** Schema validation accepts editable drafts; physical readiness is a separate compile result. */
export function normalizeDocument(value: unknown): Document {
  const p = 'document',
    o = obj(value, p, [
      'schemaVersion',
      'documentId',
      'revision',
      'site',
      'definitions',
      'instances',
      'openings',
      'connections',
      'freeWalls',
      'physicalProfile',
      'environment',
      'metadata',
    ]);
  if (o.schemaVersion !== 1)
    fail('UNSUPPORTED_SCHEMA', p, 'Only document schemaVersion 1 is supported');
  const site = obj(o.site, `${p}.site`, ['boundaryLoops']);
  // Bound arrays before deep parsing or allocating normalized copies.
  for (const key of ['definitions', 'instances', 'openings', 'connections', 'freeWalls'] as const) {
    if (!Array.isArray(o[key])) fail('SCHEMA', `${p}.${key}`, 'Expected array');
    if (o[key].length > LIMITS[key])
      fail(
        'RESOURCE_LIMIT',
        `${p}.${key}`,
        'Array exceeds resource limit',
        o[key].length,
        LIMITS[key],
      );
  }
  let count = 0;
  const checkLoops = (loops: unknown) => {
    if (Array.isArray(loops))
      for (const l of loops) {
        const segments = (l as Obj | null)?.segments;
        if (Array.isArray(segments)) count += segments.length;
        if (count > LIMITS.segments)
          fail('RESOURCE_LIMIT', p, 'Input segment limit exceeded', count, LIMITS.segments);
      }
  };
  checkLoops(site.boundaryLoops);
  for (const d of o.definitions as unknown[]) checkLoops((d as Obj | null)?.boundaryLoops);
  count += (o.freeWalls as unknown[]).length;
  if (count > LIMITS.segments)
    fail('RESOURCE_LIMIT', p, 'Input segment limit exceeded', count, LIMITS.segments);
  const metadata = obj(o.metadata, `${p}.metadata`, ['title', 'createdAt', 'updatedAt']);
  const d: Document = {
    schemaVersion: 1,
    documentId: text(o.documentId, `${p}.documentId`),
    revision: integer(o.revision, `${p}.revision`, 0, Number.MAX_SAFE_INTEGER),
    site: { boundaryLoops: parseLoops(site.boundaryLoops, `${p}.site.boundaryLoops`) },
    definitions: unique(
      list(o.definitions, `${p}.definitions`, LIMITS.definitions, parseDefinition),
      `${p}.definitions`,
      (x) => `${x.id}@${x.version}`,
    ),
    instances: unique(
      list(o.instances, `${p}.instances`, LIMITS.instances, instance),
      `${p}.instances`,
      (x) => x.id,
    ),
    openings: unique(
      list(o.openings, `${p}.openings`, LIMITS.openings, opening),
      `${p}.openings`,
      (x) => x.id,
    ),
    connections: unique(
      list(o.connections, `${p}.connections`, LIMITS.connections, connection),
      `${p}.connections`,
      (x) => x.id,
    ),
    freeWalls: unique(
      list(o.freeWalls, `${p}.freeWalls`, LIMITS.freeWalls, freeWall),
      `${p}.freeWalls`,
      (x) => x.id,
    ),
    physicalProfile: physicalProfile(o.physicalProfile, `${p}.physicalProfile`),
    environment: normalizeEnvironment(o.environment, `${p}.environment`),
    metadata: {
      title: text(metadata.title, `${p}.metadata.title`, 256),
      createdAt: text(metadata.createdAt, `${p}.metadata.createdAt`, 40),
      updatedAt: text(metadata.updatedAt, `${p}.metadata.updatedAt`, 40),
    },
  };
  const defs = new Map(d.definitions.map((x) => [x.contentHash, x])),
    instances = new Map(d.instances.map((x) => [x.id, x])),
    openings = new Map(d.openings.map((x) => [x.id, x]));
  for (const i of d.instances) {
    const def = defs.get(i.definitionHash);
    if (!def) fail('MISSING_REFERENCE', i.id, 'Missing definition');
    for (const key of Object.keys(i.parameterValues))
      if (!def.parameters.some((p) => p.id === key)) fail('UNKNOWN_PARAMETER', i.id, key);
    for (const p of def.parameters) {
      const v = i.parameterValues[p.id];
      if (v === undefined || v < p.min || v > p.max)
        fail('RANGE', i.id, `Missing/out-of-range parameter ${p.id}`);
    }
  }
  for (const op of d.openings) {
    const i = instances.get(op.instanceId),
      def = i && defs.get(i.definitionHash),
      region = def?.openingRegions.find((r) => r.id === op.regionId);
    if (!region || region.segmentId !== op.boundarySegmentId)
      fail('MISSING_REFERENCE', op.id, 'Opening has no matching owner/region/segment');
    if (op.widthM < region.minWidthM || op.widthM > region.maxWidthM)
      fail('WIDTH', op.id, 'Opening outside region width range');
  }
  const used = new Set<string>();
  for (const c of d.connections) {
    if (c.openingA === c.openingB) fail('INVALID_CONNECTION', c.id, 'Self connection');
    for (const id of [c.openingA, c.openingB]) {
      const op = openings.get(id);
      if (!op) fail('MISSING_REFERENCE', c.id, `Missing opening ${id}`);
      if (op.role !== 'ordinary')
        fail('INVALID_CONNECTION', c.id, 'External terminal cannot connect internally');
      if (used.has(id)) fail('INVALID_CONNECTION', c.id, 'Opening used by multiple connections');
      used.add(id);
    }
    if (openings.get(c.openingA)!.instanceId === openings.get(c.openingB)!.instanceId)
      fail('INVALID_CONNECTION', c.id, 'Connection must join different instances');
  }
  return d;
}
