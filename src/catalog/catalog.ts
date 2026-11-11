import { canonical, createDefinition, fail, normalizeDocument, parseDefinition } from '../domain';
import type { BoundaryLoop, Builder, Definition, Document, Instance, Point } from '../domain';

function polygon(points: Point[]): BoundaryLoop[] {
  return [
    {
      id: 'boundary',
      role: 'outer',
      segments: points.map((from, i) => ({
        id: `edge-${i}`,
        kind: 'line',
        from,
        to: points[(i + 1) % points.length]!,
      })),
    },
  ];
}
/** All builders produce the same stable boundary representation. */
export function buildBoundary(
  builder: Builder,
  values: Record<string, number>,
  explicit: BoundaryLoop[] = [],
): BoundaryLoop[] {
  const n = (key: string): number => {
    const value = values[key];
    if (value === undefined || !Number.isFinite(value) || value <= 0)
      fail('RANGE', key, 'Builder parameter must be positive and finite');
    return value;
  };
  switch (builder.kind) {
    case 'rectangle': {
      const w = n(builder.width),
        d = n(builder.depth);
      return polygon([
        { x: -w / 2, z: -d / 2 },
        { x: w / 2, z: -d / 2 },
        { x: w / 2, z: d / 2 },
        { x: -w / 2, z: d / 2 },
      ]);
    }
    case 'equilateralTriangle': {
      const s = n(builder.side),
        h = (s * Math.sqrt(3)) / 2;
      return polygon([
        { x: -s / 2, z: -h / 3 },
        { x: s / 2, z: -h / 3 },
        { x: 0, z: (2 * h) / 3 },
      ]);
    }
    case 'circle':
      return [
        {
          id: 'boundary',
          role: 'outer',
          segments: [
            {
              id: 'edge-0',
              kind: 'arc',
              center: { x: 0, z: 0 },
              radius: n(builder.radius),
              startAngle: 0,
              sweep: 2 * Math.PI,
            },
          ],
        },
      ];
    case 'explicitLoops':
      return JSON.parse(JSON.stringify(explicit)) as BoundaryLoop[];
  }
}
export function expandDefinition(
  value: unknown,
  parameters?: Record<string, number>,
): BoundaryLoop[] {
  const definition = parseDefinition(value);
  const defaults = Object.fromEntries(definition.parameters.map((p) => [p.id, p.default]));
  const values = parameters ?? defaults;
  for (const key of Object.keys(values))
    if (!definition.parameters.some((p) => p.id === key))
      fail('UNKNOWN_PARAMETER', definition.id, key);
  for (const p of definition.parameters) {
    const n = values[p.id];
    if (n === undefined || !Number.isFinite(n) || n < p.min || n > p.max)
      fail('RANGE', definition.id, `Invalid parameter ${p.id}`);
  }
  const loops = buildBoundary(definition.builder, values, definition.boundaryLoops);
  // Reuse the exact schema normalization used on imported definitions.
  const { contentHash: _, ...payload } = definition;
  return createDefinition({ ...payload, boundaryLoops: loops }).boundaryLoops;
}
export function instanceBoundary(document: Document, instance: Instance): BoundaryLoop[] {
  const definition = document.definitions.find((d) => d.contentHash === instance.definitionHash);
  if (!definition) fail('MISSING_REFERENCE', instance.id, 'Definition not found');
  const loops = expandDefinition(definition, instance.parameterValues);
  const c = Math.cos(instance.rotationRad),
    s = Math.sin(instance.rotationRad);
  const transform = (p: Point): Point => ({
    x: p.x * c - p.z * s + instance.position.x,
    z: p.x * s + p.z * c + instance.position.z,
  });
  return loops.map((loop) => ({
    ...loop,
    segments: loop.segments.map((segment) =>
      segment.kind === 'line'
        ? { ...segment, from: transform(segment.from), to: transform(segment.to) }
        : {
            ...segment,
            center: transform(segment.center),
            startAngle: segment.startAngle + instance.rotationRad,
          },
    ),
  }));
}
function definition(
  id: string,
  builder: Builder,
  defaults: Record<string, number>,
  maxSpanM = 3,
): Definition {
  const parameters = Object.entries(defaults).map(([id, value]) => ({
    id,
    min: Math.min(value, 1),
    max: Math.max(value, 20),
    default: value,
  }));
  const loops = buildBoundary(builder, defaults);
  return createDefinition({
    id,
    version: 1,
    builder,
    parameters,
    boundaryLoops: loops,
    openingRegions: loops[0]!.segments.map((s) => ({
      id: `region-${s.id}`,
      segmentId: s.id,
      uMin: 0,
      uMax: 1,
      wrap: s.kind === 'arc',
      minWidthM: 1,
      maxWidthM: 3,
      connectionClass: 'passage',
    })),
    constructionProfile: {
      profileRef: 'physical-v1',
      maxSpanM,
      supportPattern: 'corners-and-openings',
    },
  });
}
export function controlCatalog(): Definition[] {
  return [
    definition(
      'square-2x2',
      { kind: 'rectangle', width: 'width', depth: 'depth' },
      { width: 2, depth: 2 },
    ),
    definition(
      'rectangle-2x6',
      { kind: 'rectangle', width: 'width', depth: 'depth' },
      { width: 2, depth: 6 },
      6,
    ),
    definition('triangle-4', { kind: 'equilateralTriangle', side: 'side' }, { side: 4 }),
    definition('circle-2', { kind: 'circle', radius: 'radius' }, { radius: 2 }),
  ];
}
export function instantiate(
  definition: Definition,
  id: string,
  position: Point = { x: 0, z: 0 },
  rotationRad = 0,
  parameterValues = Object.fromEntries(definition.parameters.map((p) => [p.id, p.default])),
): Instance {
  expandDefinition(definition, parameterValues);
  return {
    id,
    definitionHash: definition.contentHash,
    parameterValues: { ...parameterValues },
    position: { ...position },
    rotationRad,
  };
}
/** Check that serialized default contours agree with the declarative builder. */
export function validateCatalogDefinition(value: unknown): Definition {
  const definition = parseDefinition(value);
  const defaults = Object.fromEntries(definition.parameters.map((p) => [p.id, p.default]));
  const { contentHash: _, ...payload } = definition;
  const rebuilt = createDefinition({
    ...payload,
    boundaryLoops: buildBoundary(definition.builder, defaults, definition.boundaryLoops),
  });
  if (canonical(rebuilt.boundaryLoops) !== canonical(definition.boundaryLoops))
    fail('DEFINITION_MISMATCH', definition.id, 'Default contour differs from builder');
  return definition;
}
export function withCatalog(document: Document, definitions = controlCatalog()): Document {
  return normalizeDocument({ ...document, definitions });
}
